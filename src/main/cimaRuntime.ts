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
import { join } from 'node:path';
import { authorizeToolCall, type Approval, type Authorization } from '../shared/lapitaya/governance';
import { DEFAULT_AUTONOMY_STAGE, type AutonomyStage } from '../shared/lapitaya/autonomy';
import { classifyToolCall } from '../shared/lapitaya/toolRisk';
import {
  evaluateSubmission, parseAssignment, type CimaRecord, type CimaAssignment, type ExecutionTrace, type CimaState
} from '../shared/lapitaya/cimaRuntime';
import type { CimaPhase } from '../shared/lapitaya/cima';

/** A governance decision as it lands in the ledger. */
export interface GovernanceRecord {
  kind: 'governance';
  ts: number;
  agentId: string;
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

export type LedgerEntry = CimaRecord | CimaAssignment | GovernanceRecord;

export interface CimaRuntimeDeps {
  hiveRoot: () => string | null;
  godId: () => string;
  stage?: () => AutonomyStage;
  /** The CIMA phase an agent works in (from the La Pitaya roster), if known. */
  phaseOf?: (agentId: string) => CimaPhase | null;
  /** The task an agent is currently on (tasks.json: assignee + status doing). */
  taskOf?: (agentId: string) => string | null;
  /** Push a governance/CIMA event to the UI. */
  onEvent?: (e: { type: 'approval-request' | 'approval-decided' | 'supervised' | 'cima-record'; data: unknown }) => void;
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
    if (!dir) return;
    const readLines = (f: string): unknown[] => {
      const p = join(dir, f);
      if (!existsSync(p)) return [];
      return readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
        try { return [JSON.parse(l)]; } catch { return []; }
      });
    };
    this.traces = (readLines('traces.jsonl') as ExecutionTrace[]).slice(-MAX_TRACES_IN_MEMORY);
    this.records = (readLines('cima-ledger.jsonl') as LedgerEntry[]).filter((e): e is CimaRecord => e?.kind === 'cima');
    try {
      const a = JSON.parse(readFileSync(join(dir, 'approvals.json'), 'utf8'));
      if (Array.isArray(a)) this.approvals = a;
    } catch { /* none yet */ }
  }

  private append(file: string, entry: unknown): void {
    const dir = this.dir();
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, file), JSON.stringify(entry) + '\n');
    } catch (e) {
      console.error('[lapitaya] ledger write failed:', e);
    }
  }

  private saveApprovals(): void {
    const dir = this.dir();
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, 'approvals.json.tmp');
      writeFileSync(tmp, JSON.stringify(this.approvals, null, 2));
      renameSync(tmp, join(dir, 'approvals.json'));
    } catch (e) {
      console.error('[lapitaya] approvals write failed:', e);
    }
  }

  private nextId(prefix: string): string {
    return `${prefix}-${this.now().toString(36)}-${(++this.seq).toString(36)}`;
  }

  // ─── 1. authorization at PreToolUse ──────────────────────────────────────

  authorize(agentId: string, tool: string, input: unknown): Authorization {
    this.load();
    const auth = authorizeToolCall({
      agentId,
      tool,
      input,
      stage: this.deps.stage?.() ?? DEFAULT_AUTONOMY_STAGE,
      approvals: this.approvals,
      ctx: { hiveRoot: this.deps.hiveRoot() }
    });

    if (auth.decision === 'APPROVED' && auth.approvalId) {
      const a = this.approvals.find((x) => x.id === auth.approvalId);
      if (a) { a.status = 'consumed'; this.saveApprovals(); }
    }
    if (auth.decision === 'HUMAN_APPROVAL_REQUIRED') {
      // One pending request per distinct call — a retry loop must not spam the human.
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
      auth.approvalId = pending.id;
      auth.reason = `${auth.reason} (approval ${pending.id})`;
    }
    if (auth.decision === 'SUPERVISED') {
      this.deps.onEvent?.({ type: 'supervised', data: { agentId, tool, summary: auth.summary, category: auth.category } });
    }

    const rec: GovernanceRecord = {
      kind: 'governance',
      ts: this.now(),
      agentId,
      taskId: this.deps.taskOf?.(agentId) ?? null,
      phase: this.deps.phaseOf?.(agentId) ?? null,
      tool,
      action: auth.summary,
      category: auth.category,
      risk: auth.risk,
      mode: auth.mode,
      decision: auth.decision,
      rule: auth.rule,
      ...(auth.approvalId ? { approvalId: auth.approvalId } : {})
    };
    this.append('cima-ledger.jsonl', rec);
    return auth;
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
      this.append('cima-ledger.jsonl', assignment);
      this.deps.onEvent?.({ type: 'cima-record', data: assignment });
      return assignment;
    }
    return this.submit(from, cima, messageId);
  }

  submit(agentId: string, cima: unknown, messageId?: string): CimaRecord {
    this.load();
    const state: CimaState = { records: this.records, traces: this.traces, godId: this.deps.godId() };
    const rec = evaluateSubmission(state, cima, agentId, this.now(), messageId);
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
