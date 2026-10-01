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

import { existsSync, mkdirSync, readFileSync, renameSync, openSync, closeSync, fsyncSync, fstatSync, readSync, realpathSync, rmSync, statSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { authorizeToolCall, denyAuthorization, isExecutable, toolCallFingerprint, type Approval, type Authorization } from '../shared/lapitaya/governance';
import {
  buildCall, buildSubject, callFingerprint, keyedDigest, loadOrCreateKey, makeBinding, bindingValid, sealApproval, sealMatches, subjectFingerprint,
  type SealedFields
} from './authBinding';
import { canonicalizePath, isInside, pathsOfInput, type AuthorizationSubject, type CanonicalPath } from '../shared/lapitaya/authSubject';
import type { ToolCallContext, ToolRisk } from '../shared/lapitaya/toolRisk';
import { DEFAULT_AUTONOMY_STAGE, type AutonomyStage } from '../shared/lapitaya/autonomy';
import { classifyToolCall, foreignAgentDirsInCommand, isShellMutation } from '../shared/lapitaya/toolRisk';
import {
  evaluateSubmission, parseAssignment, completionVerdict, newlyCompleted, projectFileWrite, stateUnavailableRecord,
  type CimaRecord, type CimaAssignment, type ExecutionTrace, type CimaState, type CompletionVerdict
} from '../shared/lapitaya/cimaRuntime';

/** Tools whose write to the task ledger is judged by the decision gate. */
const TASK_WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit']);
import type { CimaPhase } from '../shared/lapitaya/cima';
import { ownerOf, parseHumanContext, type DecisionOwner } from '../shared/lapitaya/identity';
import {
  requestGate, requestScope, classifyIntentMessage,
  type IntentRecord, type IntentTarget, type RequestProposal, type RequestStatus
} from '../shared/lapitaya/intent';

/** One transition of a REQUEST proposal, as it lands in the ledger (v0.4.2). */
export interface RequestTransitionRecord {
  kind: 'request';
  ts: number;
  proposalId: string;
  intentId: string;
  transition: 'PROPOSED' | 'REVALIDATED' | 'CONFIRMED' | 'CONFIRMATION_DENIED' | 'COMPLETED' | 'CANCELLED' | 'SUPERSEDED' | 'BLOCKED' | 'EXPIRED';
  status: RequestStatus;
  by: string;
  /** v0.8: the trusted human behind a human transition (confirm / cancel / complete / denied attempt). */
  human?: DecisionOwner;
  scope: 'LOW' | 'MEDIUM';
  code?: string;
  reason?: string;
}

export type RequestConfirmation =
  | { ok: true; proposal: RequestProposal }
  | { ok: false; code: string; reason: string };

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
  /** v0.4.2: the REQUEST proposal whose gate state governed this call. */
  proposalId?: string;
  /** v0.6: the exact-call fingerprint (as approvals use it), so the call's
   *  PostToolUse trace can be linked to this decision without guessing. */
  fingerprint?: string;
  /** v0.14: SHA-256 authorization fingerprint (HIGH decisions / approvals) and call fingerprint (all). */
  authFingerprint?: string;
  callFingerprint?: string;
  /** v0.8: the trusted human behind a HUMAN_APPROVED / HUMAN_REJECTED decision. */
  human?: DecisionOwner;
}

export type LedgerEntry = CimaRecord | CimaAssignment | GovernanceRecord | IntentRecord | RequestTransitionRecord;

export interface CimaRuntimeDeps {
  hiveRoot: () => string | null;
  godId: () => string;
  stage?: () => AutonomyStage;
  /** The CIMA phase an agent works in (from the La Pitaya roster), if known. */
  phaseOf?: (agentId: string) => CimaPhase | null;
  /** The task an agent is currently on (tasks.json: assignee + status doing). */
  taskOf?: (agentId: string) => string | null;
  /** Push a governance/CIMA event to the UI. */
  onEvent?: (e: { type: 'approval-request' | 'approval-decided' | 'supervised' | 'cima-record' | 'completion-blocked' | 'intent' | 'request' | 'governance' | 'trace'; data: unknown }) => void;
  /** The provider an agent runs on, for the ledger. */
  providerOf?: (agentId: string) => string | null;
  /** Test seam: replaces the risk classifier. */
  classify?: (tool: string, input: unknown, ctx?: ToolCallContext) => ToolRisk;
  now?: () => number;
  /** v0.14: the agent's working directory, so a relative path has exactly one meaning. */
  cwdOf?: (agentId: string) => string | null;
  /** v0.14: the approval-seal key, held OUTSIDE the hive. Absent → `<hive>/lapitaya/.seal.key`. */
  sealKey?: () => Buffer | null;
  /** v0.14: how long an operation waits for the governance lock before failing closed (default 3000 ms). */
  lockTimeoutMs?: number;
  /** v0.14: lifetime of an approval request/decision (default 24 h). */
  approvalTtlMs?: number;
}

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const LOCK_TIMEOUT_MS = 3000;
const STALE_LOCK_MS = 5000;

/** Block this thread for `ms` (the lock wait; no timers exist in this synchronous runtime). */
function sleepSync(ms: number): void {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* busy loop is worse than none */ }
}

/** Tools whose mutation of a path is a write for sender-authenticity purposes. */
const SENDER_WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

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
  /** v0.4.2: REQUEST proposals (proposals.json) and the exact calls of governed
   *  ACTION intents, which keep their own CIMA path while a request is open. */
  private proposals: RequestProposal[] = [];
  private actionFingerprints = new Set<string>();
  private loadedFor: string | null = null;
  private seq = 0;
  private corruptedFiles = new Set<string>();

  constructor(private readonly deps: CimaRuntimeDeps) {}

  private now(): number { return this.deps.now ? this.deps.now() : Date.now(); }

  private dir(): string | null {
    const root = this.deps.hiveRoot();
    return root ? join(root, 'lapitaya') : null;
  }

  private lockDepth = 0;
  private sealKeyCache: { dir: string; key: Buffer } | null = null;

  /**
   * Execute an operation holding the hive governance file lock. v0.14 FAIL-CLOSED: when the lock cannot
   * be had within the timeout the operation does NOT run; `unavailable` returns the caller's own refusal
   * (a DENY, null, false or a BLOCKED record). The lock file carries its owner's token and only that
   * owner removes it, so a stolen-after-stale lock is never deleted out from under its new holder.
   */
  private withLock<T>(unavailable: (detail: string) => T, fn: () => T): T {
    const dir = this.dir();
    if (!dir) return fn();
    if (this.lockDepth > 0) {
      this.lockDepth++;
      try { return fn(); } finally { this.lockDepth--; }
    }
    try { mkdirSync(dir, { recursive: true }); } catch { /* the open below reports the real failure */ }
    const lockPath = join(dir, '.governance.lock');
    const owner = `${process.pid}:${randomBytes(8).toString('hex')}`;
    const deadline = Date.now() + (this.deps.lockTimeoutMs ?? LOCK_TIMEOUT_MS);
    let delay = 2;
    let acquired = false;
    let why = 'timed out waiting for the governance lock';
    for (let attempt = 0; ; attempt++) {
      try {
        const fd = openSync(lockPath, 'wx');
        try { writeSync(fd, owner); } finally { closeSync(fd); }
        acquired = true;
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') { why = `cannot create the governance lock: ${String(e).slice(0, 100)}`; break; }
      }
      let stale = false;
      try { stale = Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS; } catch { stale = false; }
      if (stale) { try { rmSync(lockPath, { force: true }); } catch { /* retry */ } continue; }
      if (Date.now() >= deadline) break;
      sleepSync(delay);
      delay = Math.min(delay * 2, 50);
    }
    if (!acquired) return unavailable(why);

    this.lockDepth = 1;
    // Reset loadedFor so multi-instance updates on disk are re-read
    this.loadedFor = null;
    try {
      return fn();
    } finally {
      this.lockDepth = 0;
      try { if (readFileSync(lockPath, 'utf8') === owner) rmSync(lockPath, { force: true }); } catch { /* already gone */ }
    }
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
    this.proposals = [];
    this.actionFingerprints = new Set();
    this.corruptedFiles.clear();
    if (!dir) return;

    const readLines = (f: string): unknown[] => {
      const p = join(dir, f);
      if (!existsSync(p)) return [];
      try {
        const raw = readFileSync(p, 'utf8');
        const lines = raw.split('\n').filter(Boolean);
        const parsed: unknown[] = [];
        for (const line of lines) {
          try {
            parsed.push(JSON.parse(line));
          } catch {
            this.corruptedFiles.add(f);
          }
        }
        return parsed;
      } catch {
        this.corruptedFiles.add(f);
        return [];
      }
    };

    this.traces = (readLines('traces.jsonl') as ExecutionTrace[]).slice(-MAX_TRACES_IN_MEMORY);
    const ledger = readLines('cima-ledger.jsonl') as LedgerEntry[];
    this.records = ledger.filter((e): e is CimaRecord => e?.kind === 'cima');
    this.assignments = ledger.filter((e): e is CimaAssignment => e?.kind === 'cima-assignment');
    for (const e of ledger) {
      if (e?.kind === 'intent' && e.type === 'ACTION' && e.status === 'GOVERNED' && e.callFingerprint && e.target?.tool) this.actionFingerprints.add(e.callFingerprint);
    }
    const approvalsPath = join(dir, 'approvals.json');
    if (existsSync(approvalsPath)) {
      try {
        const a = JSON.parse(readFileSync(approvalsPath, 'utf8'));
        if (Array.isArray(a)) {
          this.approvals = a;
        } else {
          this.corruptedFiles.add('approvals.json');
        }
      } catch {
        this.corruptedFiles.add('approvals.json');
      }
    }
    const proposalsPath = join(dir, 'proposals.json');
    if (existsSync(proposalsPath)) {
      try {
        const r = JSON.parse(readFileSync(proposalsPath, 'utf8'));
        if (Array.isArray(r)) {
          this.proposals = r;
        } else {
          this.corruptedFiles.add('proposals.json');
        }
      } catch {
        this.corruptedFiles.add('proposals.json');
      }
    }

    this.vetApprovals();
    this.checkExpirations();
  }

  /**
   * v0.14: an approval that cannot authorize anything is retired, never trusted. Legacy approvals have
   * no authorization binding (they were matched on FNV-32 alone); any approval whose binding or seal
   * does not verify was not written by this runtime. Both become `invalid` — history stays, authority goes.
   */
  private vetApprovals(): void {
    if (this.corruptedFiles.size > 0 || !this.approvals.length) return;
    if (!this.sealKey()) return; // cannot verify anything: approvalTrusted() refuses every approval
    let changed = false;
    for (const a of this.approvals) {
      if (a.status !== 'pending' && a.status !== 'approved') continue;
      const reason = !a.binding && !a.seal ? 'LEGACY_UNBOUND' : !this.approvalTrusted(a) ? 'SEAL_MISMATCH' : null;
      if (!reason) continue;
      a.status = 'invalid';
      a.invalidReason = reason;
      changed = true;
      if (this.lockDepth > 0) this.append('cima-ledger.jsonl', {
        kind: 'governance', ts: this.now(), agentId: a.agentId, taskId: null, phase: null, tool: a.tool,
        action: `approval ${a.id} retired (${reason})`, category: 'governance-tamper', risk: 'HIGH', mode: 'HUMAN_APPROVAL',
        decision: 'DENY', rule: 'APPROVAL_INVALID', approvalId: a.id
      } satisfies GovernanceRecord);
    }
    if (changed && this.lockDepth > 0) this.saveApprovals();
  }

  private checkExpirations(): void {
    if (this.corruptedFiles.size > 0) return;
    const now = this.now();
    const TTL = APPROVAL_TTL_MS;
    const persist = this.lockDepth > 0;

    let proposalsChanged = false;
    for (const p of this.proposals) {
      if (p.status === 'PROPOSED' && (now - p.createdAt > TTL)) {
        p.status = 'EXPIRED';
        p.closedAt = now;
        p.closedBy = 'runtime';
        p.token = null;
        proposalsChanged = true;
        // v0.14: only the lock holder writes. An unlocked reader (a listing) sees the state in memory;
        // the next locked operation reloads from disk, derives the same expiry and persists it.
        if (persist) this.transition(p, 'EXPIRED', 'runtime', { reason: 'proposal expired' });
      }
    }
    if (proposalsChanged && persist) this.saveProposals();

    // v0.14: BOTH pending and approved approvals expire (v0.12 retired only pending ones).
    let approvalsChanged = false;
    for (const a of this.approvals) {
      if ((a.status === 'pending' || a.status === 'approved') && now > (a.expiresAt ?? a.createdAt + this.approvalTtl())) {
        a.status = 'expired';
        approvalsChanged = true;
      }
    }
    if (approvalsChanged && persist) this.saveApprovals();
  }

  private approvalTtl(): number { return this.deps.approvalTtlMs ?? APPROVAL_TTL_MS; }

  // ─── approval seal (v0.14) ───────────────────────────────────────────────

  private sealKey(): Buffer | null {
    const external = this.deps.sealKey?.();
    if (external) return external;
    const dir = this.dir();
    if (!dir) return null;
    if (this.sealKeyCache?.dir === dir) return this.sealKeyCache.key;
    const key = loadOrCreateKey(join(dir, '.seal.key'));
    if (key) this.sealKeyCache = { dir, key };
    return key;
  }

  private sealFields(a: Approval): SealedFields {
    return {
      id: a.id, agentId: a.agentId, tool: a.tool, status: a.status, createdAt: a.createdAt, expiresAt: a.expiresAt,
      decidedAt: a.decidedAt, decidedBy: a.decidedBy, decidedOwner: a.decidedOwner?.id, consumedAt: a.consumedAt,
      fingerprint: a.binding?.fingerprint ?? ''
    };
  }

  /** (Re)seal an approval after the runtime changed it. False when no key can be had. */
  private seal(a: Approval): boolean {
    const key = this.sealKey();
    if (!key) return false;
    a.seal = sealApproval(key, this.sealFields(a));
    return true;
  }

  /** An approval is trusted only if its binding recomputes AND the seal over its decisive fields verifies. */
  private approvalTrusted(a: Approval): boolean {
    const key = this.sealKey();
    return !!key && bindingValid(a.binding, a.agentId) && sealMatches(key, this.sealFields(a), a.seal);
  }

  private retire(a: Approval, status: 'expired' | 'invalid', reason?: string): void {
    a.status = status;
    if (reason) a.invalidReason = reason;
    this.saveApprovals();
  }

  // ─── canonical identities (v0.14) ────────────────────────────────────────

  private cwdFor(agentId: string | undefined): string | null {
    if (!agentId) return null;
    try { return this.deps.cwdOf?.(agentId) ?? null; } catch { return null; }
  }

  /**
   * ONE meaning for a path, computed before classification, authorization and binding: lexical
   * canonicalization, then the filesystem is asked for the real location of the part that exists
   * (symlinks, junctions, 8.3 short names, drive/case spelling). A path that cannot be resolved to
   * one object is flagged ambiguous and callers fail closed.
   */
  private canonicalPath(raw: string, cwd: string | null): CanonicalPath {
    const strict = canonicalizePath(raw, { base: cwd });
    const lex = canonicalizePath(raw, { base: cwd, shortNames: 'allow' });
    if (lex.ambiguous) return strict;
    if (!lex.absolute) return strict;
    let cur = lex.display;
    const tail: string[] = [];
    let real: string | null = null;
    for (let n = 0; n < 64; n++) {
      if (existsSync(cur)) {
        try { real = realpathSync.native(cur); } catch { return { ...strict, ambiguous: true, reason: 'realpath failed' }; }
        break;
      }
      const i = cur.lastIndexOf('/');
      if (i < 0) break;
      tail.unshift(cur.slice(i + 1));
      const parent = cur.slice(0, i);
      cur = i === 0 ? '/' : /^[a-zA-Z]:$/.test(parent) ? parent + '/' : parent;
    }
    if (real === null) return strict;
    return canonicalizePath([real, ...tail].join('/'));
  }

  /** The tool context every classifier call gets: hive, the caller's cwd and the realpath-aware resolver. */
  private toolCtx(agentId?: string): ToolCallContext {
    const cwd = this.cwdFor(agentId);
    return { hiveRoot: this.deps.hiveRoot(), cwd, resolvePath: (raw) => this.canonicalPath(raw, cwd) };
  }

  // ─── authorization subject (v0.14) ───────────────────────────────────────

  private callFor(agentId: string, tool: string, input: unknown) {
    const cwd = this.cwdFor(agentId);
    let provider: string | null = null;
    try { provider = this.deps.providerOf?.(agentId) ?? null; } catch { /* optional context */ }
    return buildCall({
      agent: agentId, provider, tool, input,
      resolvePath: (raw) => {
        const c = this.canonicalPath(raw, cwd);
        if (c.ambiguous) throw new Error(`ambiguous path (${c.reason})`);
        return c.key;
      }
    });
  }

  private callFingerprintFor(agentId: string, tool: string, input: unknown): string | undefined {
    try { return callFingerprint(this.callFor(agentId, tool, input)); } catch { return undefined; }
  }

  /** The canonical subject a human approval is bound to. Throws when it cannot be built (callers deny). */
  private subjectFor(agentId: string, tool: string, input: unknown, auth: Pick<Authorization, 'risk' | 'category' | 'mode' | 'rule'>, request: string | null): AuthorizationSubject {
    let task: string | null = null;
    try { task = this.deps.taskOf?.(agentId) ?? null; } catch { /* optional context */ }
    return buildSubject(this.callFor(agentId, tool, input), {
      task, risk: auth.risk, category: auth.category, mode: auth.mode,
      stage: this.deps.stage?.() ?? DEFAULT_AUTONOMY_STAGE, rule: auth.rule, request
    });
  }

  // ─── sender authenticity (v0.14) ─────────────────────────────────────────

  /**
   * An agent sends only through its OWN outbox, and the router attributes a message to the directory
   * it was found in. So a governed call that writes into ANOTHER agent's outbox/inbox is a forged
   * sender: refused outright (no approval can turn it into a legitimate message).
   */
  private senderSpoof(agentId: string, tool: string, input: unknown, root: string): string | null {
    const self = agentId.trim().toLowerCase();
    if (SENDER_WRITE_TOOLS.has(tool)) {
      const rootC = this.canonicalPath(root, null);
      if (!rootC.ambiguous && rootC.absolute) {
        const rk = rootC.key.replace(/\/+$/, '');
        const cwd = this.cwdFor(agentId);
        for (const raw of pathsOfInput(input)) {
          const cands = [this.canonicalPath(raw, cwd)];
          if (!cands[0].absolute && !cands[0].ambiguous) cands.push(canonicalizePath(raw, { base: rootC.display }));
          for (const c of cands) {
            if (c.ambiguous || !isInside(c.key, rk)) continue;
            const m = /^agents\/([^/]+)\/(?:outbox|inbox)(?:\/|$)/.exec(c.key.slice(rk.length + 1));
            if (m && m[1] !== self) return `SENDER_IDENTITY — ${agentId} may only write its own outbox; this path belongs to agent "${m[1]}"`;
          }
        }
      }
    }
    if (tool === 'Bash' || tool === 'PowerShell' || tool === 'shell' || tool === 'run_shell_command') {
      const cmd = String((input && typeof input === 'object' ? (input as Record<string, unknown>).command : '') ?? '');
      if (isShellMutation(cmd)) {
        const foreign = foreignAgentDirsInCommand(cmd, agentId);
        if (foreign.length) return `SENDER_IDENTITY — ${agentId} may only write its own outbox; the command writes into the outbox/inbox of ${foreign.map((f) => `"${f}"`).join(', ')}`;
      }
    }
    return null;
  }

  /** Append one JSON line with fsync durability. Returns false when write fails. */
  private append(file: string, entry: unknown): boolean {
    const dir = this.dir();
    if (!dir) return false;
    try {
      mkdirSync(dir, { recursive: true });
      const target = join(dir, file);
      const line = JSON.stringify(entry) + '\n';
      const fd = openSync(target, 'a+');
      try {
        // v0.14: a crash mid-append leaves a tail without its newline; the next record must start a
        // fresh line, or it would be glued to (and destroyed with) the truncated one.
        const size = fstatSync(fd).size;
        let prefix = '';
        if (size > 0) {
          const last = Buffer.alloc(1);
          readSync(fd, last, 0, 1, size - 1);
          if (last[0] !== 0x0a) prefix = '\n';
        }
        writeSync(fd, prefix + line);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      return true;
    } catch (e) {
      console.error('[lapitaya] ledger write failed:', e);
      return false;
    }
  }

  private saveApprovals(): boolean {
    return this.writeState('approvals.json', this.approvals);
  }

  private saveProposals(): boolean {
    return this.writeState('proposals.json', this.proposals);
  }

  /** Atomic JSON state write (tmp + writeSync + fsync + rename). */
  private writeState(file: string, value: unknown): boolean {
    const dir = this.dir();
    if (!dir) return false;
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, `${file}.tmp.${randomBytes(4).toString('hex')}`);
      const content = JSON.stringify(value, null, 2);
      const fd = openSync(tmp, 'w');
      writeSync(fd, content);
      fsyncSync(fd);
      closeSync(fd);
      renameSync(tmp, join(dir, file));
      return true;
    } catch (e) {
      console.error(`[lapitaya] ${file} write failed:`, e);
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
    // v0.14: no lock → no decision. A lock that merely times out is LOCK_UNAVAILABLE; a state directory that
    // cannot even hold the lock file is an unavailable ledger.
    return this.withLock((why) => denyAuthorization(/^cannot create/.test(why) ? 'LEDGER_UNAVAILABLE' : 'LOCK_UNAVAILABLE', `${why}; the call was not authorized`, agentId || '?', tool || '?', input), () => {
      const deny = (code: string, detail: string): Authorization => {
        const d = denyAuthorization(code, detail, agentId || '?', tool || '?', input);
        this.recordDecision(agentId || '?', tool || '?', d); // best effort: the call is denied either way
        return d;
      };
      const root = this.deps.hiveRoot();
      if (!root) return deny('GOVERNANCE_STATE_UNAVAILABLE', 'no hive root');
      if (!agentId || !tool) return deny('ACTOR_CONTEXT_MISSING', `missing ${!agentId ? 'agent identity' : 'tool name'}`);
      try { this.load(); } catch (e) {
        return deny('GOVERNANCE_STATE_UNAVAILABLE', `cannot load governance state: ${String(e).slice(0, 120)}`);
      }
      if (this.corruptedFiles.size > 0) {
        return deny('GOVERNANCE_STATE_CORRUPT', `governance state file corrupted: ${Array.from(this.corruptedFiles).join(', ')}`);
      }
      // v0.14 sender authenticity: an agent sends only through its own outbox.
      const spoof = this.senderSpoof(agentId, tool, input, root);
      if (spoof) return deny('SENDER_IDENTITY', spoof);

      // Approvals are NOT handed to the pure classifier: they are matched below on the
      // authorization fingerprint, after the REQUEST gate has said which request is in force.
      let auth = authorizeToolCall({
        agentId,
        tool,
        input,
        stage: this.deps.stage?.() ?? DEFAULT_AUTONOMY_STAGE,
        approvals: [],
        ctx: this.toolCtx(agentId),
        classify: this.deps.classify
      });
      auth.callFingerprint = this.callFingerprintFor(agentId, tool, input);

      // v0.4.2 REQUEST execution gate. An unconfirmed REQUEST blocks every
      // non-planning call on the floor (LOW included); a confirmed one bounds
      // non-HIGH calls by its scope. It runs BEFORE approvals, so it never raises
      // or consumes one, and a confirmation never stands in for a HIGH approval.
      let proposalId: string | undefined;
      if (auth.decision !== 'DENY') {
        const rg = requestGate(this.proposals, { category: auth.category, risk: auth.risk, fingerprint: auth.callFingerprint ?? '' }, this.actionFingerprints);
        proposalId = rg.proposalId;
        if (!rg.allow) auth = { ...auth, decision: 'DENY', rule: rg.code, reason: rg.reason, approvalId: undefined };
      }

      // v0.14 AUTHORIZATION BINDING. A HIGH call runs only under an approval bound (SHA-256 over the
      // canonical subject) to exactly this agent, provider, task, tool, input, target, risk, autonomy
      // and request context. Anything else is a different call and gets its own approval.
      let subject: AuthorizationSubject | null = null;
      if (auth.decision === 'HUMAN_APPROVAL_REQUIRED') {
        try {
          subject = this.subjectFor(agentId, tool, input, auth, proposalId ?? null);
          auth.authFingerprint = subjectFingerprint(subject);
          const usable = this.usableApproval(agentId, auth.authFingerprint);
          if (usable) auth = { ...auth, decision: 'APPROVED', approvalId: usable.id, reason: undefined };
          else {
            const hint = this.contextMismatchHint(agentId, tool, subject);
            if (hint) auth = { ...auth, reason: `${hint} ${auth.reason ?? ''}`.trim() };
          }
        } catch (e) {
          auth = denyAuthorization('AUTH_SUBJECT_UNAVAILABLE', `this call cannot be bound to one authorization subject: ${String(e).slice(0, 120)}`, agentId, tool, input);
        }
      }

      // Decision gate at the tool boundary: a write to the task ledger that would
      // mark a CIMA task done without a runtime DECISION PASS does not run.
      const isShell = tool === 'Bash' || tool === 'PowerShell' || tool === 'shell' || tool === 'run_shell_command';
      if (TASK_WRITE_TOOLS.has(tool) || isShell || tool.startsWith('mcp__')) {
        const gate = this.taskLedgerWriteGate(root, tool, input, agentId);
        if (gate) auth = denyAuthorization('DECISION_GATE', gate, agentId, tool, input);
      }

      if (auth.decision === 'APPROVED' && auth.approvalId) {
        // One-shot: the approval must be durably consumed BEFORE the call runs,
        // or it could be replayed. If that cannot be persisted, deny.
        const a = this.approvals.find((x) => x.id === auth.approvalId);
        if (!a) return deny('GOVERNANCE_STATE_UNAVAILABLE', 'approval vanished');
        const prev = { status: a.status, consumedAt: a.consumedAt, seal: a.seal };
        a.status = 'consumed';
        a.consumedAt = this.now();
        if (!this.seal(a) || !this.saveApprovals()) {
          a.status = prev.status; a.consumedAt = prev.consumedAt; a.seal = prev.seal;
          return deny('LEDGER_UNAVAILABLE', `cannot persist consumption of approval ${a.id}`);
        }
      }
      if (auth.decision === 'HUMAN_APPROVAL_REQUIRED') {
        const pending = subject ? this.requestApproval(agentId, tool, auth, subject) : null;
        if (!pending) return deny('LEDGER_UNAVAILABLE', 'cannot persist the approval request');
        auth.approvalId = pending.id;
        auth.reason = `${auth.reason} (approval ${pending.id})`;
      }
      if (auth.decision === 'SUPERVISED') {
        this.deps.onEvent?.({ type: 'supervised', data: { agentId, tool, summary: auth.summary, category: auth.category } });
      }

      // Every executed call must be auditable: if the decision cannot be written
      // to the ledger, the call does not run.
      if (!this.recordDecision(agentId, tool, auth, proposalId) && isExecutable(auth.decision)) {
        if (auth.decision === 'APPROVED' && auth.approvalId) {
          const a = this.approvals.find((x) => x.id === auth.approvalId);
          if (a) { a.status = 'approved'; a.consumedAt = undefined; this.seal(a); this.saveApprovals(); }
        }
        return denyAuthorization('LEDGER_UNAVAILABLE', 'the governance ledger could not record this decision', agentId, tool, input);
      }
      return auth;
    });
  }

  /** What listings and events show of an approval: never the seal. */
  private publicApproval(a: Approval): Approval {
    const { seal: _seal, ...rest } = a;
    return rest;
  }

  /** An approved, unexpired, unconsumed, trusted approval bound to exactly this authorization fingerprint. */
  private usableApproval(agentId: string, fingerprint: string): Approval | undefined {
    const now = this.now();
    return this.approvals.find((x) =>
      x.status === 'approved' && x.agentId === agentId && x.binding?.fingerprint === fingerprint
      && now <= (x.expiresAt ?? 0) && this.approvalTrusted(x));
  }

  /** An approval exists for this exact input, but its context (task, provider, risk, autonomy, request) differs. */
  private contextMismatchHint(agentId: string, tool: string, subject: AuthorizationSubject): string | null {
    const near = this.approvals.find((x) => {
      if (x.status !== 'approved' || x.agentId !== agentId || !this.approvalTrusted(x)) return false;
      const bs = x.binding!.subject as AuthorizationSubject;
      return bs.call.tool === tool && bs.call.input === subject.call.input;
    });
    return near ? 'APPROVAL_CONTEXT_MISMATCH — an approval exists for this exact input under a different task/provider/risk/autonomy/request context; it cannot be used.' : null;
  }

  /** The pending human-approval request for one exact authorization subject. One pending request per
   *  distinct subject — a retry loop must not spam the human. Null when it cannot be durably recorded. */
  private requestApproval(agentId: string, tool: string, auth: Authorization, subject: AuthorizationSubject): Approval | null {
    const fp = subjectFingerprint(subject);
    const now = this.now();
    let pending = this.approvals.find((x) =>
      x.status === 'pending' && x.agentId === agentId && x.binding?.fingerprint === fp && now <= (x.expiresAt ?? 0) && this.approvalTrusted(x));
    if (!pending) {
      const a: Approval = {
        id: this.nextId('apr'),
        agentId, tool,
        fingerprint: auth.fingerprint,
        category: auth.category,
        risk: auth.risk,
        summary: auth.summary,
        status: 'pending',
        createdAt: now,
        expiresAt: now + this.approvalTtl(),
        binding: makeBinding(subject)
      };
      if (!this.seal(a)) return null;
      this.approvals.push(a);
      if (!this.saveApprovals()) { this.approvals.pop(); return null; }
      this.deps.onEvent?.({ type: 'approval-request', data: this.publicApproval(a) });
      pending = a;
    }
    return pending;
  }

  // ─── intent boundary (v0.4.1) ────────────────────────────────────────────

  /** The risk classification the runtime applies to a call (with the hive context). */
  classifyCall(tool: string, input: unknown): ToolRisk {
    return (this.deps.classify ?? classifyToolCall)(tool, input, this.toolCtx());
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
    return this.withLock((why) => denyAuthorization('LOCK_UNAVAILABLE', why, executorId || '?', tool || '?', input), () => {
      const root = this.deps.hiveRoot();
      if (!root) return denyAuthorization('GOVERNANCE_STATE_UNAVAILABLE', 'no hive root', executorId || '?', tool || '?', input);
      if (!executorId || !tool) return denyAuthorization('GOVERNANCE_STATE_UNAVAILABLE', 'missing executor or tool', executorId || '?', tool || '?', input);
      try { this.load(); } catch (e) {
        return denyAuthorization('GOVERNANCE_STATE_UNAVAILABLE', `cannot load governance state: ${String(e).slice(0, 120)}`, executorId, tool, input);
      }
      if (this.corruptedFiles.size > 0) {
        return denyAuthorization('GOVERNANCE_STATE_CORRUPT', `governance state file corrupted: ${Array.from(this.corruptedFiles).join(', ')}`, executorId, tool, input);
      }
      let auth = authorizeToolCall({
        agentId: executorId, tool, input,
        stage: this.deps.stage?.() ?? DEFAULT_AUTONOMY_STAGE,
        approvals: [],
        ctx: this.toolCtx(executorId),
        classify: opts.classify ?? this.deps.classify
      });
      auth.callFingerprint = this.callFingerprintFor(executorId, tool, input);
      if (isExecutable(auth.decision) && TASK_WRITE_TOOLS.has(tool)) {
        const gate = this.taskLedgerWriteGate(root, tool, input, executorId);
        if (gate) auth = denyAuthorization('DECISION_GATE', gate, executorId, tool, input);
      }
      if (auth.decision === 'HUMAN_APPROVAL_REQUIRED' && opts.raiseApproval) {
        // The approval the human is asked for is bound to the subject the executor's own call will have
        // (an ACTION intent's exact call is exempt from the REQUEST gate, so no request is in force).
        let pending: Approval | null = null;
        try {
          const subject = this.subjectFor(executorId, tool, input, auth, null);
          auth.authFingerprint = subjectFingerprint(subject);
          pending = this.requestApproval(executorId, tool, auth, subject);
        } catch (e) {
          return denyAuthorization('AUTH_SUBJECT_UNAVAILABLE', `this call cannot be bound to one authorization subject: ${String(e).slice(0, 120)}`, executorId, tool, input);
        }
        if (!pending) return denyAuthorization('LEDGER_UNAVAILABLE', 'cannot persist the approval request', executorId, tool, input);
        auth.approvalId = pending.id;
      }
      return auth;
    });
  }

  /** Append one intent record to the ledger and publish it on the event stream. */
  recordIntent(rec: IntentRecord): boolean {
    return this.withLock(() => false, () => {
      this.load();
      if (this.corruptedFiles.size > 0) return false;
      const ok = this.append('cima-ledger.jsonl', rec);
      // A governed ACTION's exact call keeps its own CIMA path while a REQUEST is open.
      if (ok && rec.type === 'ACTION' && rec.status === 'GOVERNED' && rec.callFingerprint && rec.target?.tool) this.actionFingerprints.add(rec.callFingerprint);
      this.deps.onEvent?.({ type: 'intent', data: rec });
      return ok;
    });
  }

  // ─── REQUEST execution gate (v0.4.2) ─────────────────────────────────────

  /** v0.14: HMAC-SHA256 (runtime-held key) over the canonical content of the proposal — recomputing it
   *  needs the key, so a hand-edited proposals.json cannot be re-signed. (v0.12 used FNV-32.) Throws without a key. */
  private proposalFingerprint(p: RequestProposal): string {
    const key = this.sealKey();
    if (!key) throw new Error('no seal key');
    return keyedDigest(key, 'lapitaya/proposal/v1\n', [p.id, p.intentId, p.executor, p.requestedBy, p.source, p.message, p.taskId, p.target, p.scope, p.createdAt]);
  }

  /** Append one request transition to the ledger. False when the ledger could not record it. */
  private transition(p: RequestProposal, transition: RequestTransitionRecord['transition'], by: string, extra: { code?: string; reason?: string; human?: DecisionOwner | null } = {}): boolean {
    const { human, ...rest } = extra;
    const rec: RequestTransitionRecord = {
      kind: 'request', ts: this.now(), proposalId: p.id, intentId: p.intentId, transition,
      status: p.status, by, ...(human ? { human } : {}), scope: p.scope, ...rest
    };
    const ok = this.append('cima-ledger.jsonl', rec);
    this.deps.onEvent?.({ type: 'request', data: { ...rec, message: p.message, taskId: p.taskId, executor: p.executor } });
    return ok;
  }

  /**
   * Open the runtime proposal for a forwarded REQUEST. Ids and the confirmation
   * token are generated here, never taken from the producer. A newer request
   * for the same task supersedes an older unconfirmed one. Returns null if the
   * proposal cannot be persisted (the caller must then not forward it).
   */
  openRequest(input: {
    intentId: string; executor: string; requestedBy: string; source: string;
    message: string; taskId: string | null; target: IntentTarget | null; signals: string[];
  }): RequestProposal | null {
    return this.withLock(() => null, () => {
      this.load();
      if (this.corruptedFiles.size > 0) return null;
      const p: RequestProposal = {
        id: this.nextId('req'), intentId: input.intentId, executor: input.executor,
        requestedBy: input.requestedBy, source: input.source, message: input.message,
        taskId: input.taskId, target: input.target, signals: [...input.signals],
        scope: requestScope(input.message), status: 'PROPOSED', createdAt: this.now(),
        fingerprint: '', token: randomBytes(16).toString('hex')
      };
      try { p.fingerprint = this.proposalFingerprint(p); } catch { return null; } // no key / not canonical: no proposal
      const superseded = input.taskId
        ? this.proposals.filter((x) => x.status === 'PROPOSED' && x.taskId === input.taskId)
        : [];
      for (const x of superseded) { x.status = 'SUPERSEDED'; x.closedAt = p.createdAt; x.closedBy = 'runtime'; x.token = null; }
      this.proposals.push(p);
      if (!this.saveProposals()) {
        this.proposals.pop();
        for (const x of superseded) x.status = 'PROPOSED';
        return null;
      }
      for (const x of superseded) this.transition(x, 'SUPERSEDED', 'runtime', { reason: `superseded by ${p.id}` });
      this.transition(p, 'PROPOSED', input.source);
      return { ...p };
    });
  }

  /**
   * v0.8: record WHO submitted a REQUEST. Write-once, only for a proposal that is still
   * waiting, only with a well-formed trusted context. It changes no status, token,
   * scope or fingerprint and decides nothing.
   */
  attributeRequest(proposalId: unknown, human: unknown): boolean {
    return this.withLock(() => false, () => {
      this.load();
      if (this.corruptedFiles.size > 0) return false;
      const hc = parseHumanContext(human);
      const p = typeof proposalId === 'string' ? this.proposals.find((x) => x.id === proposalId) : undefined;
      if (!hc || !p || p.status !== 'PROPOSED' || p.requestedOwner) return false;
      p.requestedOwner = ownerOf(hc);
      if (!this.saveProposals()) { p.requestedOwner = undefined; return false; }
      return true;
    });
  }

  /** A proposal that never reached the orchestrator is withdrawn (intent boundary only). */
  withdrawRequest(proposalId: string, reason: string): void {
    this.withLock(() => undefined, () => {
      this.load();
      if (this.corruptedFiles.size > 0) return;
      const p = this.proposals.find((x) => x.id === proposalId && x.status === 'PROPOSED');
      if (!p) return;
      p.status = 'BLOCKED'; p.closedAt = this.now(); p.closedBy = 'runtime'; p.reason = reason; p.token = null;
      this.saveProposals();
      this.transition(p, 'BLOCKED', 'runtime', { reason });
    });
  }

  listRequests(): RequestProposal[] {
    this.load();
    return this.proposals.map((p) => ({ ...p })).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * The HUMAN's confirmation of one proposal. Authority is the caller: only the
   * human-facing IPC passes by='human'; no agent, intent producer or message can reach
   * this. Validates existence, context, confirmability, the single-use token
   * and the proposal's integrity; re-validates its classification; then moves
   * PROPOSED → CONFIRMED (durably) and consumes the token. Executes nothing and
   * raises no approval.
   */
  confirmRequest(proposalId: unknown, ctx: { by?: unknown; token?: unknown; intentId?: unknown; human?: unknown } = {}): RequestConfirmation {
    return this.withLock((why) => ({ ok: false, code: 'LOCK_UNAVAILABLE', reason: `${why}; nothing was confirmed` }), () => {
      this.load();
      if (this.corruptedFiles.size > 0) return { ok: false, code: 'GOVERNANCE_STATE_CORRUPT', reason: `governance state file corrupted: ${Array.from(this.corruptedFiles).join(', ')}` };
      const p = typeof proposalId === 'string' ? this.proposals.find((x) => x.id === proposalId) : undefined;
      // v0.8: the trusted human context (resolved in main, never by the renderer). Absent = legacy
      // callers; PRESENT but malformed = refused, never silently downgraded to anonymous.
      const hc = ctx.human === undefined ? null : parseHumanContext(ctx.human);
      const owner = hc ? ownerOf(hc) : null;
      const deny = (code: string, reason: string): RequestConfirmation => {
        if (p) this.transition(p, 'CONFIRMATION_DENIED', typeof ctx.by === 'string' ? ctx.by.slice(0, 50) : '?', { code, reason, human: owner });
        return { ok: false, code, reason };
      };
      if (ctx.by !== 'human') return deny('NOT_AUTHORIZED', 'only the human confirms a request');
      if (ctx.human !== undefined && !hc) return deny('NOT_AUTHORIZED', 'invalid human context');
      if (typeof proposalId !== 'string' || !proposalId) return deny('INVALID_CONFIRMATION', 'missing proposal id');
      if (!p) return deny('UNKNOWN_PROPOSAL', `no proposal ${proposalId.slice(0, 80)}`);
      if (ctx.intentId !== undefined && ctx.intentId !== p.intentId) return deny('WRONG_CONTEXT', `proposal ${p.id} belongs to intent ${p.intentId}`);
      if (p.executor !== this.deps.godId()) return deny('WRONG_CONTEXT', `proposal ${p.id} was made for orchestrator ${p.executor}`);
      if (p.status !== 'PROPOSED') return deny('NOT_CONFIRMABLE', `proposal ${p.id} is ${p.status}`);
      if (typeof ctx.token !== 'string' || !ctx.token) return deny('INVALID_CONFIRMATION', 'missing confirmation token');
      if (!p.token || ctx.token !== p.token) return deny('TAMPERED', 'the confirmation token does not match this proposal');
      if (/^[0-9a-f]{8}$/.test(String(p.fingerprint))) return deny('STALE_PROPOSAL', `proposal ${p.id} carries a legacy FNV-32 fingerprint; submit the request again`);
      let current: string | null = null;
      try { current = this.proposalFingerprint(p); } catch { current = null; }
      if (current === null || current !== p.fingerprint) return deny('TAMPERED', `proposal ${p.id} changed after it was proposed`);
      // Re-validation: the words must still read as a REQUEST under today's rules.
      const now = classifyIntentMessage(p.message, p.target);
      if (now.type !== 'REQUEST') {
        p.status = 'BLOCKED'; p.closedAt = this.now(); p.closedBy = 'runtime'; p.token = null;
        p.reason = `re-validation classified it as ${now.type}`;
        this.saveProposals();
        this.transition(p, 'BLOCKED', 'runtime', { code: 'STALE_PROPOSAL', reason: p.reason });
        return { ok: false, code: 'STALE_PROPOSAL', reason: p.reason };
      }
      this.transition(p, 'REVALIDATED', 'runtime', { reason: `still REQUEST; scope ${p.scope}` });
      const token = p.token;
      p.status = 'CONFIRMED'; p.confirmedAt = this.now(); p.confirmedBy = 'human'; p.token = null;
      if (owner) p.confirmedOwner = owner;
      if (!this.saveProposals()) {
        p.status = 'PROPOSED'; p.confirmedAt = undefined; p.confirmedBy = undefined; p.confirmedOwner = undefined; p.token = token;
        return deny('LEDGER_UNAVAILABLE', 'the confirmation could not be persisted');
      }
      if (!this.transition(p, 'CONFIRMED', 'human', { human: owner })) {
        // v0.14: a confirmation the ledger cannot evidence is not a confirmation.
        p.status = 'PROPOSED'; p.confirmedAt = undefined; p.confirmedBy = undefined; p.confirmedOwner = undefined; p.token = token;
        this.saveProposals();
        return deny('LEDGER_UNAVAILABLE', 'the confirmation could not be recorded in the ledger');
      }
      return { ok: true, proposal: { ...p } };
    });
  }

  /** The human withdraws a proposal (PROPOSED or CONFIRMED → CANCELLED). */
  cancelRequest(proposalId: unknown, by: unknown, human?: unknown): RequestConfirmation {
    return this.closeRequest(proposalId, by, ['PROPOSED', 'CONFIRMED'], 'CANCELLED', human);
  }

  /** The human closes a confirmed request once its work is done (CONFIRMED → COMPLETED). */
  completeRequest(proposalId: unknown, by: unknown, human?: unknown): RequestConfirmation {
    return this.closeRequest(proposalId, by, ['CONFIRMED'], 'COMPLETED', human);
  }

  private closeRequest(proposalId: unknown, by: unknown, from: RequestStatus[], to: 'CANCELLED' | 'COMPLETED', human?: unknown): RequestConfirmation {
    return this.withLock((why) => ({ ok: false, code: 'LOCK_UNAVAILABLE', reason: `${why}; nothing was changed` }), () => {
      this.load();
      if (this.corruptedFiles.size > 0) return { ok: false, code: 'GOVERNANCE_STATE_CORRUPT', reason: `governance state file corrupted: ${Array.from(this.corruptedFiles).join(', ')}` };
      if (by !== 'human') return { ok: false, code: 'NOT_AUTHORIZED', reason: 'only the human closes a request' };
      const hc = human === undefined ? null : parseHumanContext(human);
      if (human !== undefined && !hc) return { ok: false, code: 'NOT_AUTHORIZED', reason: 'invalid human context' };
      const owner = hc ? ownerOf(hc) : null;
      const p = typeof proposalId === 'string' ? this.proposals.find((x) => x.id === proposalId) : undefined;
      if (!p) return { ok: false, code: 'UNKNOWN_PROPOSAL', reason: 'no such proposal' };
      if (!from.includes(p.status)) return { ok: false, code: 'NOT_CONFIRMABLE', reason: `proposal ${p.id} is ${p.status}` };
      const prev = { status: p.status, token: p.token };
      p.status = to; p.closedAt = this.now(); p.closedBy = 'human'; p.token = null;
      if (owner) p.closedOwner = owner;
      if (!this.saveProposals()) {
        p.status = prev.status; p.token = prev.token; p.closedAt = undefined; p.closedBy = undefined; p.closedOwner = undefined;
        return { ok: false, code: 'LEDGER_UNAVAILABLE', reason: 'the change could not be persisted' };
      }
      if (!this.transition(p, to, 'human', { human: owner })) {
        p.status = prev.status; p.token = prev.token; p.closedAt = undefined; p.closedBy = undefined; p.closedOwner = undefined;
        this.saveProposals();
        return { ok: false, code: 'LEDGER_UNAVAILABLE', reason: 'the change could not be recorded in the ledger' };
      }
      return { ok: true, proposal: { ...p } };
    });
  }

  /** Append one governance decision to the ledger. Returns false if it could not be written. */
  private recordDecision(agentId: string, tool: string, auth: Authorization, proposalId?: string): boolean {
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
      ...(auth.approvalId ? { approvalId: auth.approvalId } : {}),
      ...(proposalId ? { proposalId } : {}),
      ...(auth.fingerprint ? { fingerprint: auth.fingerprint } : {}),
      ...(auth.authFingerprint ? { authFingerprint: auth.authFingerprint } : {}),
      ...(auth.callFingerprint ? { callFingerprint: auth.callFingerprint } : {})
    };
    if (!this.append('cima-ledger.jsonl', rec)) return false;
    // v0.6 observability: a signal that a decision was recorded, on the existing
    // stream (read-only consumers refresh; it raises no notification and decides
    // nothing). No action text or fingerprint: the ledger is the record.
    this.deps.onEvent?.({ type: 'governance', data: {
      ts: rec.ts, agentId, tool, decision: rec.decision, rule: rec.rule, risk: rec.risk,
      ...(rec.proposalId ? { proposalId: rec.proposalId } : {}), ...(rec.approvalId ? { approvalId: rec.approvalId } : {})
    } });
    return true;
  }

  // ─── decision gate ───────────────────────────────────────────────────────

  private cimaState(): CimaState {
    return { records: this.records, traces: this.traces, godId: this.deps.godId(), assignments: this.assignments };
  }

  /** May this task be marked done? (Runtime-recorded DECISION PASS only.) */
  completionGate(taskId: string): CompletionVerdict {
    this.load();
    if (this.corruptedFiles.size > 0) {
      return { governed: false, allowed: false, reason: `DECISION_GATE: governance state file corrupted (${Array.from(this.corruptedFiles).join(', ')})` };
    }
    return completionVerdict(this.cimaState(), taskId);
  }

  /**
   * Judge a change of the task ledger (before → after text). Returns the tasks
   * whose move to 'done' is NOT allowed, with the reason. An unreadable `after`
   * cannot be judged and is reported as a violation for `*`.
   */
  blockedCompletions(beforeText: string | null, afterText: string): Array<{ taskId: string; reason: string }> {
    this.load();
    if (this.corruptedFiles.size > 0) {
      return [{ taskId: '*', reason: `DECISION_GATE: governance state file corrupted (${Array.from(this.corruptedFiles).join(', ')})` }];
    }
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

  /** v0.14: does this path name the task ledger — under ANY canonical meaning (cwd-relative, hive-relative,
   *  symlinked, differently spelled)? A path with no single meaning is judged as if it did. */
  private pathIsTasks(raw: string, root: string, tasksPath: string, agentId?: string): boolean {
    const want = this.canonicalPath(tasksPath, null);
    const first = this.canonicalPath(raw, this.cwdFor(agentId));
    if (first.ambiguous) return true;
    const cands = [first];
    if (!first.absolute) cands.push(this.canonicalPath(raw, root));
    return cands.some((c) => c.ambiguous || c.key === want.key);
  }

  /** PreToolUse view of the gate: returns a denial reason, or null to allow. */
  private taskLedgerWriteGate(root: string, tool: string, input: unknown, agentId?: string): string | null {
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const tasksPath = join(root, 'tasks.json');
    const isShell = tool === 'Bash' || tool === 'PowerShell' || tool === 'shell' || tool === 'run_shell_command';
    const path = typeof i.file_path === 'string' ? i.file_path : typeof i.path === 'string' ? i.path : '';
    const cmd = isShell ? String(i.command ?? '') : '';
    const touchesTasks = (path !== '' && this.pathIsTasks(path, root, tasksPath, agentId)) ||
                         (isShell && /tasks\.json/i.test(cmd));
    if (!touchesTasks) return null;

    let current: string | null = null;
    try { current = existsSync(tasksPath) ? readFileSync(tasksPath, 'utf8') : null; } catch {
      return 'DECISION_GATE: cannot read the current task ledger';
    }

    if (isShell) {
      const isReadOnly = /^\s*(cat|type|head|tail|less|more|grep|rg|ag|jq|select-string|get-content)\b/i.test(cmd) && !/>|>>|1>|2>|>&|\|&|\$\(|\b(tee|cp|mv|rm|touch|truncate|sed|awk)\b/i.test(cmd);
      if (isReadOnly) return null;
      const blocked = this.blockedCompletions(current, '');
      if (blocked.length) {
        for (const b of blocked) this.recordBlockedCompletion(b.taskId, b.reason, tool);
        return blocked.map((b) => b.reason).join('; ');
      }
      return null;
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
    return this.approvals.map((a) => this.publicApproval(a)).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The human's explicit decision. Only a PENDING, unexpired, trusted request can be decided. */
  decide(id: string, approve: boolean, by = 'human', human?: unknown): Approval | null {
    return this.withLock(() => null, () => {
      this.load();
      if (this.corruptedFiles.size > 0) return null;
      // v0.8: a human context that is present but malformed decides nothing.
      const hc = human === undefined ? null : parseHumanContext(human);
      if (human !== undefined && !hc) return null;
      const a = this.approvals.find((x) => x.id === id);
      if (!a || a.status !== 'pending') return null;
      if (!this.approvalTrusted(a)) { this.retire(a, 'invalid', 'SEAL_MISMATCH'); return null; }
      if (this.now() > (a.expiresAt ?? 0)) { this.retire(a, 'expired'); return null; }
      const prev = { status: a.status, decidedAt: a.decidedAt, decidedBy: a.decidedBy, decidedOwner: a.decidedOwner, seal: a.seal };
      const undo = (): null => {
        a.status = prev.status; a.decidedAt = prev.decidedAt; a.decidedBy = prev.decidedBy; a.decidedOwner = prev.decidedOwner; a.seal = prev.seal;
        return null;
      };
      a.status = approve ? 'approved' : 'rejected';
      a.decidedAt = this.now();
      a.decidedBy = by;
      if (hc) a.decidedOwner = ownerOf(hc);
      if (!this.seal(a) || !this.saveApprovals()) return undo();
      // v0.14: a human decision the ledger cannot evidence is not a decision.
      const recorded = this.append('cima-ledger.jsonl', {
        kind: 'governance', ts: a.decidedAt, agentId: a.agentId, taskId: null, phase: null,
        tool: a.tool, action: a.summary, category: a.category, risk: a.risk, mode: 'HUMAN_APPROVAL',
        decision: approve ? 'HUMAN_APPROVED' : 'HUMAN_REJECTED', rule: 'human', approvalId: a.id,
        ...(a.binding ? { authFingerprint: a.binding.fingerprint } : {}),
        ...(a.decidedOwner ? { human: a.decidedOwner } : {})
      } satisfies GovernanceRecord);
      if (!recorded) { undo(); this.saveApprovals(); return null; }
      const pub = this.publicApproval(a);
      this.deps.onEvent?.({ type: 'approval-decided', data: pub });
      return pub;
    });
  }

  // ─── 2. traces at PostToolUse / PostToolUseFailure ───────────────────────

  recordTrace(agentId: string, event: string, tool: string, input: unknown, response: unknown): ExecutionTrace | null {
    if (!agentId || !tool) return null;
    return this.withLock(() => null, () => {
      this.load();
      if (this.corruptedFiles.size > 0) return null;
      const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      const cls = classifyToolCall(tool, input, this.toolCtx(agentId));
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
      // v0.6: the same exact-call fingerprint the PreToolUse decision recorded (legacy FNV correlation id)…
      try { trace.fingerprint = toolCallFingerprint(agentId, tool, input); } catch { /* unlinked trace */ }
      // …and (v0.14) the cryptographic call fingerprint, which links it to the decision unambiguously.
      trace.callFingerprint = this.callFingerprintFor(agentId, tool, input);
      // Coordination writes inside the hive are not "modifying code".
      if (kind === 'write' && cls.category === 'hive-coordination') trace.kind = 'tool';
      // v0.14: evidence that is not durable is not evidence — only a recorded trace can back a claim.
      if (!this.append('traces.jsonl', trace)) return null;
      this.traces.push(trace);
      if (this.traces.length > MAX_TRACES_IN_MEMORY) this.traces.splice(0, this.traces.length - MAX_TRACES_IN_MEMORY);
      // v0.6 observability: that a governed call ran — no command, path or output.
      this.deps.onEvent?.({ type: 'trace', data: { id: trace.id, ts: trace.ts, agentId, tool, ok: trace.ok } });
      return trace;
    });
  }

  /** The most recent execution traces (read-only; PostToolUse evidence). */
  recentTraces(limit = 500): ExecutionTrace[] {
    this.load();
    return this.traces.slice(-limit).map((t) => ({ ...t }));
  }

  // ─── 3. CIMA submissions from the router ─────────────────────────────────

  /** Route one `cima` field: a phase ASSIGNMENT (no verdict) is logged as a
   *  transition hand-off; anything else is a claim and is evaluated. */
  handle(from: string, to: string, cima: unknown, messageId?: string, humanCtx?: DecisionOwner | null): CimaRecord | CimaAssignment {
    return this.withLock((why) => stateUnavailableRecord(cima, from, this.now(), why, messageId), () => {
      this.load();
      if (this.corruptedFiles.size > 0) return stateUnavailableRecord(cima, from, this.now(), `governance state file corrupted: ${Array.from(this.corruptedFiles).join(', ')}`, messageId);
      const assignment = parseAssignment(cima, from, to, this.now(), messageId);
      if (assignment) {
        if (!this.append('cima-ledger.jsonl', assignment)) return stateUnavailableRecord(cima, from, this.now(), 'the ledger could not record the assignment', messageId);
        this.assignments.push(assignment);
        this.deps.onEvent?.({ type: 'cima-record', data: assignment });
        return assignment;
      }
      return this.submit(from, cima, messageId, humanCtx);
    });
  }

  submit(agentId: string, cima: unknown, messageId?: string, humanCtx?: DecisionOwner | null): CimaRecord {
    return this.withLock((why) => stateUnavailableRecord(cima, agentId, this.now(), why, messageId), () => {
      this.load();
      if (this.corruptedFiles.size > 0) return stateUnavailableRecord(cima, agentId, this.now(), `governance state file corrupted: ${Array.from(this.corruptedFiles).join(', ')}`, messageId);
      const rec = evaluateSubmission(this.cimaState(), cima, agentId, this.now(), messageId, humanCtx);
      // v0.14: a verdict the ledger cannot record is never returned as recorded.
      if (!this.append('cima-ledger.jsonl', rec)) return stateUnavailableRecord(cima, agentId, this.now(), 'the ledger could not record the verdict', messageId);
      this.records.push(rec);
      this.deps.onEvent?.({ type: 'cima-record', data: rec });
      return rec;
    });
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
