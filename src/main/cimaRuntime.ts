/**
 * CimaRuntimeService — La Pitaya's governance + CIMA runtime in the main process.
 *
 * Three jobs, each at a boundary the agent does not control:
 *
 *   1. authorize()   — called by HookServer at EVERY PreToolUse. Classifies the
 *                      call, applies the autonomy policy and returns the decision
 *                      the hook sends back to the CLI (deny for HIGH until a human
 *                      approves). autoMode cannot bypass it: a hook deny stops the
 *                      call even when the CLI is in bypassPermissions.
 *   2. recordTrace() — called at PostToolUse / PostToolUseFailure. What the agent
 *                      really executed or read becomes an ExecutionTrace — the
 *                      only thing CIMA accepts as evidence.
 *   3. submit()      — called by the hive router when a message carries a `cima`
 *                      field. The claim is evaluated against the traces and the
 *                      ledger (shared/lapitaya/cimaRuntime.ts) and the RUNTIME's
 *                      verdict is recorded.
 *
 * Persistence reuses the hive (no new database): append-only JSONL under
 * `<hive>/lapitaya/` — cima-ledger.jsonl (governance decisions + CIMA records),
 * traces.jsonl, and approvals.json. The hive's own git commit versions them.
 *
 * No electron import — unit-testable.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { authorizeToolCall, denyAuthorization, isExecutable, type Approval, type Authorization } from '../shared/lapitaya/governance';
import type { ToolCallContext, ToolRisk } from '../shared/lapitaya/toolRisk';
import { DEFAULT_AUTONOMY_STAGE, type AutonomyStage } from '../shared/lapitaya/autonomy';
import { classifyToolCall } from '../shared/lapitaya/toolRisk';
import {
  evaluateSubmission, parseAssignment, completionVerdict, newlyCompleted, projectFileWrite,
  type CimaRecord, type CimaAssignment, type ExecutionTrace, type CimaState, type CompletionVerdict
} from '../shared/lapitaya/cimaRuntime';

/** Tools whose write to the task ledger is judged by the decision gate. */
const TASK_WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit']);
import type { CimaPhase } from '../shared/lapitaya/cima';
import type { IntentRecord } from '../shared/lapitaya/intent';

/** A governance decision as it lands in the ledger. */
export interface GovernanceRecord {
  kind: 'governance';
  ts: number;
  agentId: string;
  /** The agent's provider (claude, codex, …) — governance is the same for all. */
  provider?: string;
  taskId: string | null;
  phase: CimaPhase | null;
  tool: string;
  action: string;
  category: string;
  risk: string;
  mode: string;
  decision: string;
  rule: string;
  approvalId?: string;
}

export type LedgerEntry = CimaRecord | CimaAssignment | GovernanceRecord | IntentRecord;

export interface CimaRuntimeDeps {
  hiveRoot: () => string | null;
  godId: () => string;
  stage?: () => AutonomyStage;
  /** The CIMA phase an agent works in (from the La Pitaya roster), if known. */
  phaseOf?: (agentId: string) => CimaPhase | null;
  /** The task an agent is currently on (tasks.json: assignee + status doing). */
  taskOf?: (agentId: string) => string | null;
  /** Push a governance/CIMA event to the UI. */
  onEvent?: (e: { type: 'approval-request' | 'approval-decided' | 'supervised' | 'cima-record' | 'completion-blocked' | 'intent'; data: unknown }) => void;
  /** The provider an agent runs on, for the ledger. */
  providerOf?: (agentId: string) => string | null;
  /** Test seam: replaces the risk classifier. */
  classify?: (tool: string, input: unknown, ctx?: ToolCallContext) => ToolRisk;
  now?: () => number;
}

const MAX_TRACES_IN_MEMORY = 5000;
const OUTPUT_HEAD = 2000;

function outputHead(response: unknown): string {
  if (response == null) return '';
  if (typeof response === 'string') return response.slice(0, OUTPUT_HEAD);
  if (typeof response === 'object') {
    const r = response as Record<string, unknown>;
    const parts = [r.stdout, r.stderr, r.output, r.error, r.content].filter((x) => typeof x === 'string') as string[];
    if (parts.length) return parts.join('\n').slice(0, OUTPUT_HEAD);
  }
  try { return JSON.stringify(response).slice(0, OUTPUT_HEAD); } catch { return ''; }
}

export class CimaRuntimeService {
  private traces: ExecutionTrace[] = [];
  private records: CimaRecord[] = [];
  private approvals: Approval[] = [];
  private assignments: CimaAssignment[] = [];
  private loadedFor: string | null = null;
  private seq = 0;

  constructor(private readonly deps: CimaRuntimeDeps) {}

  private now(): number { return this.deps.now ? this.deps.now() : Date.now(); }

  private dir(): string | null {
    const root = this.deps.hiveRoot();
    return root ? join(root, 'lapitaya') : null;
  }

  /** (Re)load persisted state when the hive root changes. */
  private load(): void {
    const dir = this.dir();
    if (dir === this.loadedFor) return;
    this.loadedFor = dir;
    this.traces = [];
    this.records = [];
    this.approvals = [];
    this.assignments = [];
    if (!dir) return;
    const readLines = (f: string): unknown[] => {
      const p = join(dir, f);
      if (!existsSync(p)) return [];
      return readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
        try { return [JSON.parse(l)]; } catch { return []; }
      });
    };
    this.traces = (readLines('traces.jsonl') as ExecutionTrace[]).slice(-MAX_TRACES_IN_MEMORY);
    const ledger = readLines('cima-ledger.jsonl') as LedgerEntry[];
    this.records = ledger.filter((e): e is CimaRecord => e?.kind === 'cima');
    this.assignments = ledger.filter((e): e is CimaAssignment => e?.kind === 'cima-assignment');
    try {
      const a = JSON.parse(readFileSync(join(dir, 'approvals.json'), 'utf8'));
      if (Array.isArray(a)) this.approvals = a;
    } catch { /* none yet */ }
  }

  /** Append one JSON line. Returns false when it could not be written — callers
   *  that need an audit trail (authorization) deny on false. */
  private append(file: string, entry: unknown): boolean {
    const dir = this.dir();
    if (!dir) return false;
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, file), JSON.stringify(entry) + '\n');
      return true;
    } catch (e) {
      console.error('[lapitaya] ledger write failed:', e);
      return false;
    }
  }

  private saveApprovals(): boolean {
    const dir = this.dir();
    if (!dir) return false;
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, 'approvals.json.tmp');
      writeFileSync(tmp, JSON.stringify(this.approvals, null, 2));
      renameSync(tmp, join(dir, 'approvals.json'));
      return true;
    } catch (e) {
      console.error('[lapitaya] approvals write failed:', e);
      return false;
    }
  }

  private nextId(prefix: string): string {
    return `${prefix}-${this.now().toString(36)}-${(++this.seq).toString(36)}`;
  }

  // ─── 1. authorization at PreToolUse ──────────────────────────────────────

  /**
   * The runtime's decision for ONE tool call. v0.3 contract: this always returns
   * an explicit decision, and every condition that prevents establishing
   * authorization — missing governance state, missing identity, an unusable risk
   * classification, a ledger that cannot record the decision, an approval that
   * cannot be durably consumed — returns DENY. Never ALLOW by default.
   */
  authorize(agentId: string, tool: string, input: unknown): Authorization {
    const deny = (code: string, detail: string): Authorization => {
      const d = denyAuthorization(code, detail, agentId || '?', tool || '?', input);
      this.recordDecision(agentId || '?', tool || '?', d); // best effort: the call is denied either way
      return d;
    };
    const root = this.deps.hiveRoot();
    if (!root) return deny('GOVERNANCE_STATE_UNAVAILABLE', 'no hive root');
    if (!agentId || !tool) return deny('GOVERNANCE_STATE_UNAVAILABLE', `missing ${!agentId ? 'agent identity' : 'tool name'}`);
    try { this.load(); } catch (e) {
      return deny('GOVERNANCE_STATE_UNAVAILABLE', `cannot load governance state: ${String(e).slice(0, 120)}`);
    }

    let auth = authorizeToolCall({
      agentId,
      tool,
      input,
      stage: this.deps.stage?.() ?? DEFAULT_AUTONOMY_STAGE,
      approvals: this.approvals,
      ctx: { hiveRoot: root },
      classify: this.deps.classify
    });

    // Decision gate at the tool boundary: a write to the task ledger that would
    // mark a CIMA task done without a runtime DECISION PASS does not run.
    if (isExecutable(auth.decision) && TASK_WRITE_TOOLS.has(tool)) {
      const gate = this.taskLedgerWriteGate(root, tool, input);
      if (gate) auth = denyAuthorization('DECISION_GATE', gate, agentId, tool, input);
    }

    if (auth.decision === 'APPROVED' && auth.approvalId) {
      // One-shot: the approval must be durably consumed BEFORE the call runs,
      // or it could be replayed. If that cannot be persisted, deny.
      const a = this.approvals.find((x) => x.id === auth.approvalId);
      if (!a) return deny('GOVERNANCE_STATE_UNAVAILABLE', 'approval vanished');
      a.status = 'consumed';
      if (!this.saveApprovals()) {
        a.status = 'approved';
        return deny('LEDGER_UNAVAILABLE', `cannot persist consumption of approval ${a.id}`);
      }
    }
    if (auth.decision === 'HUMAN_APPROVAL_REQUIRED') {
      const pending = this.requestApproval(agentId, tool, auth);
      auth.approvalId = pending.id;
      auth.reason = `${auth.reason} (approval ${pending.id})`;
    }
    if (auth.decision === 'SUPERVISED') {
      this.deps.onEvent?.({ type: 'supervised', data: { agentId, tool, summary: auth.summary, category: auth.category } });
    }

    // Every executed call must be auditable: if the decision cannot be written
    // to the ledger, the call does not run.
    if (!this.recordDecision(agentId, tool, auth) && isExecutable(auth.decision)) {
      if (auth.decision === 'APPROVED' && auth.approvalId) {
        const a = this.approvals.find((x) => x.id === auth.approvalId);
        if (a) { a.status = 'approved'; this.saveApprovals(); }
      }
      return denyAuthorization('LEDGER_UNAVAILABLE', 'the governance ledger could not record this decision', agentId, tool, input);
    }
    return auth;
  }

  /** The pending human-approval request for one exact call by one agent. One
   *  pending request per distinct call — a retry loop must not spam the human. */
  private requestApproval(agentId: string, tool: string, auth: Authorization): Approval {
    let pending = this.approvals.find((x) => x.status === 'pending' && x.agentId === agentId && x.fingerprint === auth.fingerprint);
    if (!pending) {
      pending = {
        id: this.nextId('apr'),
        agentId, tool,
        fingerprint: auth.fingerprint,
        category: auth.category,
        risk: auth.risk,
        summary: auth.summary,
        status: 'pending',
        createdAt: this.now()
      };
      this.approvals.push(pending);
      this.saveApprovals();
      this.deps.onEvent?.({ type: 'approval-request', data: pending });
    }
    return pending;
  }

  // ─── intent boundary (v0.4.1) ────────────────────────────────────────────

  /** The risk classification the runtime applies to a call (with the hive context). */
  classifyCall(tool: string, input: unknown): ToolRisk {
    return (this.deps.classify ?? classifyToolCall)(tool, input, { hiveRoot: this.deps.hiveRoot() });
  }

  /**
   * What governance says about a PROPOSED call by `executorId`, without running
   * it: same classifier, autonomy stage and decision-gate projection as
   * authorize(). Never consumes an approval and writes no governance record
   * (the intent record carries the decision). With `raiseApproval`, a
   * HUMAN_APPROVAL_REQUIRED call raises the same pending approval authorize()
   * would, so the human approves the exact call the executor will make.
   */
  evaluateProposedCall(executorId: string, tool: string, input: unknown, opts: {
    raiseApproval?: boolean;
    classify?: (tool: string, input: unknown, ctx?: ToolCallContext) => ToolRisk;
  } = {}): Authorization {
    const root = this.deps.hiveRoot();
    if (!root) return denyAuthorization('GOVERNANCE_STATE_UNAVAILABLE', 'no hive root', executorId || '?', tool || '?', input);
    if (!executorId || !tool) return denyAuthorization('GOVERNANCE_STATE_UNAVAILABLE', 'missing executor or tool', executorId || '?', tool || '?', input);
    try { this.load(); } catch (e) {
      return denyAuthorization('GOVERNANCE_STATE_UNAVAILABLE', `cannot load governance state: ${String(e).slice(0, 120)}`, executorId, tool, input);
    }
    let auth = authorizeToolCall({
      agentId: executorId, tool, input,
      stage: this.deps.stage?.() ?? DEFAULT_AUTONOMY_STAGE,
      approvals: [],
      ctx: { hiveRoot: root },
      classify: opts.classify ?? this.deps.classify
    });
    if (isExecutable(auth.decision) && TASK_WRITE_TOOLS.has(tool)) {
      const gate = this.taskLedgerWriteGate(root, tool, input);
      if (gate) auth = denyAuthorization('DECISION_GATE', gate, executorId, tool, input);
    }
    if (auth.decision === 'HUMAN_APPROVAL_REQUIRED' && opts.raiseApproval) {
      auth.approvalId = this.requestApproval(executorId, tool, auth).id;
    }
    return auth;
  }

  /** Append one intent record to the ledger and publish it on the event stream. */
  recordIntent(rec: IntentRecord): boolean {
    const ok = this.append('cima-ledger.jsonl', rec);
    this.deps.onEvent?.({ type: 'intent', data: rec });
    return ok;
  }

  /** Append one governance decision to the ledger. Returns false if it could not be written. */
  private recordDecision(agentId: string, tool: string, auth: Authorization): boolean {
    let taskId: string | null = null;
    let phase: CimaPhase | null = null;
    let provider: string | null = null;
    try { taskId = this.deps.taskOf?.(agentId) ?? null; } catch { /* optional context */ }
    try { phase = this.deps.phaseOf?.(agentId) ?? null; } catch { /* optional context */ }
    try { provider = this.deps.providerOf?.(agentId) ?? null; } catch { /* optional context */ }
    const rec: GovernanceRecord = {
      kind: 'governance',
      ts: this.now(),
      agentId,
      ...(provider ? { provider } : {}),
      taskId,
      phase,
      tool,
      action: auth.summary,
      category: auth.category,
      risk: auth.risk,
      mode: auth.mode,
      decision: auth.decision,
      rule: auth.rule,
      ...(auth.approvalId ? { approvalId: auth.approvalId } : {})
    };
    return this.append('cima-ledger.jsonl', rec);
  }

  // ─── decision gate ───────────────────────────────────────────────────────

  private cimaState(): CimaState {
    return { records: this.records, traces: this.traces, godId: this.deps.godId(), assignments: this.assignments };
  }

  /** May this task be marked done? (Runtime-recorded DECISION PASS only.) */
  completionGate(taskId: string): CompletionVerdict {
    this.load();
    return completionVerdict(this.cimaState(), taskId);
  }

  /**
   * Judge a change of the task ledger (before → after text). Returns the tasks
   * whose move to 'done' is NOT allowed, with the reason. An unreadable `after`
   * cannot be judged and is reported as a violation for `*`.
   */
  blockedCompletions(beforeText: string | null, afterText: string): Array<{ taskId: string; reason: string }> {
    this.load();
    let done: string[];
    try { done = newlyCompleted(beforeText, afterText); } catch (e) {
      return [{ taskId: '*', reason: `DECISION_GATE: cannot parse the resulting task ledger (${String(e).slice(0, 80)})` }];
    }
    const state = this.cimaState();
    return done.flatMap((taskId) => {
      const v = completionVerdict(state, taskId);
      return v.allowed ? [] : [{ taskId, reason: v.reason }];
    });
  }

  /** Log a completion the runtime blocked (from any path: tool, hive API, reconciler). */
  recordBlockedCompletion(taskId: string, reason: string, via: string, agentId = 'runtime'): void {
    this.append('cima-ledger.jsonl', {
      kind: 'governance', ts: this.now(), agentId, taskId, phase: 'DECISION' as CimaPhase, tool: via,
      action: `complete task ${taskId}`, category: 'governance-tamper', risk: 'HIGH', mode: 'HUMAN_APPROVAL',
      decision: 'DENY', rule: 'DECISION_GATE'
    } satisfies GovernanceRecord);
    this.deps.onEvent?.({ type: 'completion-blocked', data: { taskId, reason, via } });
  }

  /** PreToolUse view of the gate: returns a denial reason, or null to allow. */
  private taskLedgerWriteGate(root: string, tool: string, input: unknown): string | null {
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const path = typeof i.file_path === 'string' ? i.file_path : '';
    const tasksPath = join(root, 'tasks.json');
    if (!path || resolve(path).toLowerCase() !== resolve(tasksPath).toLowerCase()) return null;
    let current: string | null = null;
    try { current = existsSync(tasksPath) ? readFileSync(tasksPath, 'utf8') : null; } catch {
      return 'DECISION_GATE: cannot read the current task ledger';
    }
    const next = projectFileWrite(tool, input, current);
    if (next === null) return 'DECISION_GATE: cannot determine the resulting task ledger from this edit';
    const blocked = this.blockedCompletions(current, next);
    if (!blocked.length) return null;
    for (const b of blocked) this.recordBlockedCompletion(b.taskId, b.reason, tool);
    return blocked.map((b) => b.reason).join('; ');
  }

  // ─── human approval ──────────────────────────────────────────────────────

  listApprovals(): Approval[] {
    this.load();
    return this.approvals.slice().sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The human's explicit decision. Only a PENDING request can be decided. */
  decide(id: string, approve: boolean, by = 'human'): Approval | null {
    this.load();
    const a = this.approvals.find((x) => x.id === id);
    if (!a || a.status !== 'pending') return null;
    a.status = approve ? 'approved' : 'rejected';
    a.decidedAt = this.now();
    a.decidedBy = by;
    this.saveApprovals();
    this.append('cima-ledger.jsonl', {
      kind: 'governance', ts: a.decidedAt, agentId: a.agentId, taskId: null, phase: null,
      tool: a.tool, action: a.summary, category: a.category, risk: a.risk, mode: 'HUMAN_APPROVAL',
      decision: approve ? 'HUMAN_APPROVED' : 'HUMAN_REJECTED', rule: 'human', approvalId: a.id
    } satisfies GovernanceRecord);
    this.deps.onEvent?.({ type: 'approval-decided', data: a });
    return a;
  }

  // ─── 2. traces at PostToolUse / PostToolUseFailure ───────────────────────

  recordTrace(agentId: string, event: string, tool: string, input: unknown, response: unknown): ExecutionTrace | null {
    if (!agentId || !tool) return null;
    this.load();
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const cls = classifyToolCall(tool, input, { hiveRoot: this.deps.hiveRoot() });
    const isShell = tool === 'Bash' || tool === 'PowerShell';
    const path = typeof i.file_path === 'string' ? i.file_path : typeof i.path === 'string' ? i.path : '';
    const kind: ExecutionTrace['kind'] = isShell ? 'command'
      : ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool) ? 'write'
      : path ? 'read' : 'tool';
    const interrupted = !!(response && typeof response === 'object' && (response as Record<string, unknown>).interrupted);
    const trace: ExecutionTrace = {
      id: this.nextId('trc'),
      ts: this.now(),
      agentId,
      kind,
      tool,
      subject: (isShell ? String(i.command ?? '') : path || tool).slice(0, 2000),
      ok: event !== 'PostToolUseFailure' && !interrupted,
      outputHead: outputHead(response)
    };
    // Coordination writes inside the hive are not "modifying code".
    if (kind === 'write' && cls.category === 'hive-coordination') trace.kind = 'tool';
    this.traces.push(trace);
    if (this.traces.length > MAX_TRACES_IN_MEMORY) this.traces.splice(0, this.traces.length - MAX_TRACES_IN_MEMORY);
    this.append('traces.jsonl', trace);
    return trace;
  }

  // ─── 3. CIMA submissions from the router ─────────────────────────────────

  /** Route one `cima` field: a phase ASSIGNMENT (no verdict) is logged as a
   *  transition hand-off; anything else is a claim and is evaluated. */
  handle(from: string, to: string, cima: unknown, messageId?: string): CimaRecord | CimaAssignment {
    this.load();
    const assignment = parseAssignment(cima, from, to, this.now(), messageId);
    if (assignment) {
      this.assignments.push(assignment);
      this.append('cima-ledger.jsonl', assignment);
      this.deps.onEvent?.({ type: 'cima-record', data: assignment });
      return assignment;
    }
    return this.submit(from, cima, messageId);
  }

  submit(agentId: string, cima: unknown, messageId?: string): CimaRecord {
    this.load();
    const rec = evaluateSubmission(this.cimaState(), cima, agentId, this.now(), messageId);
    this.records.push(rec);
    this.append('cima-ledger.jsonl', rec);
    this.deps.onEvent?.({ type: 'cima-record', data: rec });
    return rec;
  }

  ledger(limit = 200): LedgerEntry[] {
    const dir = this.dir();
    if (!dir) return [];
    const p = join(dir, 'cima-ledger.jsonl');
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-limit).flatMap((l) => {
      try { return [JSON.parse(l) as LedgerEntry]; } catch { return []; }
    });
  }

  cimaRecords(taskId?: string): CimaRecord[] {
    this.load();
    return taskId ? this.records.filter((r) => r.taskId === taskId) : this.records.slice();
  }
}
