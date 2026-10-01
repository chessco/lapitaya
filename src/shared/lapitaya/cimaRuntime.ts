/**
 * CIMA runtime — the executable form of the CIMA cycle and its rules.
 *
 * Two kinds of facts feed it, and they are NOT equally trusted:
 *
 *   1. ExecutionTrace — what the HARNESS observed an agent actually do, taken
 *      from the CLI's PostToolUse / PostToolUseFailure hooks (a command that ran
 *      and its output, a file that was read or written). The runtime authenticates
 *      execution traces and actor identity at the tool and socket boundaries,
 *      ensuring identity and evidence are verified by the runtime rather than
 *      self-asserted by agents in untrusted payloads.
 *
 *   2. CimaSubmission — what an AGENT claims: "task T, phase TEST, verdict
 *      PASS, here is my evidence". Submitted as a `cima` field on a hive
 *      message and validated by the router before anyone sees it.
 *
 * evaluateSubmission() turns a claim into the verdict the runtime RECORDS. A
 * claim is only as good as the traces behind it:
 *
 *   - EVIDENCE FIRST: PASS/FAIL need evidence items whose `source` matches a
 *     trace this agent produced for this task. Prose is not evidence; an item
 *     that matches no trace makes the claim BLOCKED.
 *   - BUILDER != AUDITOR: a TEST/AUDIT PASS from an agent that submitted BUILD
 *     for the task is BLOCKED; so is an AUDIT PASS from an agent the harness saw
 *     modifying code after the build started.
 *   - TRANSITIONS: critical steps need their predecessors — TEST PASS needs
 *     BUILD PASS, AUDIT PASS needs TEST PASS, DECISION PASS (accepting the work)
 *     needs AUDIT PASS and must come from the orchestrator or the human.
 *   - BLOCKED is never turned into FAIL, and FAIL is never turned into PASS.
 *
 * Pure and deterministic: no fs, no clock (callers pass `now`).
 */

import { CIMA_WORKFLOW, isCimaPhase, type CimaPhase } from './cima';
import type { DecisionOwner } from './identity';

export type RuntimeVerdict = 'PASS' | 'FAIL' | 'BLOCKED';

export const EVIDENCE_TYPES = [
  'test-result', 'command-output', 'static-analysis', 'file-inspection',
  'diff', 'runtime-result', 'audit-finding', 'execution-trace'
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** Evidence as the spec defines it: type, source, description, result, timestamp. */
export interface EvidenceItem {
  type: EvidenceType;
  /** The command that was run, or the file that was inspected — verbatim. */
  source: string;
  description?: string;
  /** The observed result, quoted — never translated. */
  result?: string;
  timestamp?: string;
}

export interface ExecutionTrace {
  id: string;
  ts: number;
  agentId: string;
  kind: 'command' | 'read' | 'write' | 'tool';
  tool: string;
  /** Command line, or file path. */
  subject: string;
  /** false when the harness saw the call fail (PostToolUseFailure / interrupted). */
  ok: boolean;
  /** First part of the real output, as the tool returned it. */
  outputHead?: string;
  /** v0.6: exact-call fingerprint, equal to the PreToolUse governance record's. */
  fingerprint?: string;
}

export interface CimaSubmission {
  taskId: string;
  phase: CimaPhase;
  verdict: RuntimeVerdict;
  summary?: string;
  evidence?: EvidenceItem[];
}

export type CimaRuleId =
  | 'MALFORMED'
  | 'EVIDENCE_FIRST'
  | 'BUILDER_NOT_AUDITOR'
  | 'AUDITOR_MODIFIED_CODE'
  | 'TRANSITION'
  | 'DECISION_AUTHORITY';

export interface VerifiedEvidence extends EvidenceItem {
  verified: boolean;
  traceId?: string;
}

/** One entry of the CIMA ledger: the runtime's decision on one submission. */
export interface CimaRecord {
  kind: 'cima';
  ts: number;
  taskId: string;
  phase: CimaPhase;
  agentId: string;
  claimed: RuntimeVerdict;
  /** What the runtime recorded — may be stricter than the claim, never looser. */
  verdict: RuntimeVerdict;
  violations: CimaRuleId[];
  reasons: string[];
  evidence: VerifiedEvidence[];
  transition: { from: CimaPhase | null; to: CimaPhase };
  summary?: string;
  messageId?: string;
}

export interface CimaState {
  records: readonly CimaRecord[];
  traces: readonly ExecutionTrace[];
  /** Hive id of the orchestrator (El Inge). */
  godId: string;
  /** Phase hand-offs; a task with any is CIMA-governed (decision gate). */
  assignments?: readonly CimaAssignment[];
}

/** Evidence types whose `source` is a command the agent must have run. */
const COMMAND_EVIDENCE: ReadonlySet<EvidenceType> = new Set([
  'test-result', 'command-output', 'static-analysis', 'diff', 'runtime-result', 'execution-trace'
]);

const norm = (s: string): string => s.replace(/\\/g, '/').replace(/\s+/g, ' ').trim().toLowerCase();

/** A phase ASSIGNMENT: the orchestrator tagging a delegation with the task and
 *  phase it is handing over, without claiming any result. Not a verdict. */
export interface CimaAssignment {
  kind: 'cima-assignment';
  ts: number;
  taskId: string;
  phase: CimaPhase;
  from: string;
  to: string;
  messageId?: string;
}

/** A `cima` field with a valid taskId and phase but NO verdict is an
 *  assignment (seen live in v0.2: El Inge tags each delegation this way).
 *  Returns null when it is not one — then it is a claim to evaluate. */
export function parseAssignment(raw: unknown, from: string, to: string, now: number, messageId?: string): CimaAssignment | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.verdict !== undefined && r.verdict !== null && r.verdict !== '') return null;
  const taskId = typeof r.taskId === 'string' ? r.taskId.trim() : '';
  const phase = typeof r.phase === 'string' ? r.phase.trim().toUpperCase() : '';
  if (!taskId || !isCimaPhase(phase)) return null;
  return { kind: 'cima-assignment', ts: now, taskId: taskId.slice(0, 200), phase, from, to, messageId };
}

/** Parse an untrusted `cima` field. Returns null (→ MALFORMED) if unusable. */
export function parseSubmission(raw: unknown): CimaSubmission | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const taskId = typeof r.taskId === 'string' ? r.taskId.trim() : '';
  const phase = typeof r.phase === 'string' ? r.phase.trim().toUpperCase() : '';
  const verdict = typeof r.verdict === 'string' ? r.verdict.trim().toUpperCase() : '';
  if (!taskId || !isCimaPhase(phase) || !['PASS', 'FAIL', 'BLOCKED'].includes(verdict)) return null;
  const evidence = Array.isArray(r.evidence)
    ? r.evidence.slice(0, 50).flatMap((e): EvidenceItem[] => {
        if (!e || typeof e !== 'object') return [];
        const x = e as Record<string, unknown>;
        const type = typeof x.type === 'string' ? x.type : '';
        const source = typeof x.source === 'string' ? x.source : '';
        return [{
          type: (EVIDENCE_TYPES as readonly string[]).includes(type) ? (type as EvidenceType) : ('execution-trace' as EvidenceType),
          source: source.slice(0, 2000),
          description: typeof x.description === 'string' ? x.description.slice(0, 2000) : undefined,
          result: typeof x.result === 'string' ? x.result.slice(0, 4000) : undefined,
          timestamp: typeof x.timestamp === 'string' ? x.timestamp : undefined
        }];
      })
    : [];
  return {
    taskId: taskId.slice(0, 200),
    phase: phase as CimaPhase,
    verdict: verdict as RuntimeVerdict,
    summary: typeof r.summary === 'string' ? r.summary.slice(0, 4000) : undefined,
    evidence
  };
}

export function taskRecords(state: CimaState, taskId: string): CimaRecord[] {
  return state.records.filter((r) => r.taskId === taskId);
}

/** The phase results recorded so far for a task (latest record per phase wins).
 *  A record the runtime REJECTED (it has rule violations) is kept in the ledger
 *  for audit but does not move the task: otherwise a builder's refused attempt
 *  to pass its own TEST would overwrite the independent tester's PASS. A
 *  genuine BLOCKED or FAIL (no violations) does count — a later real failure
 *  must be able to invalidate an earlier PASS. */
export function taskPhaseVerdicts(state: CimaState, taskId: string): Partial<Record<CimaPhase, RuntimeVerdict>> {
  const out: Partial<Record<CimaPhase, RuntimeVerdict>> = {};
  for (const r of taskRecords(state, taskId)) if (r.violations.length === 0) out[r.phase] = r.verdict;
  return out;
}

/** Agents that submitted BUILD for the task — the builders. */
export function buildersOf(state: CimaState, taskId: string): Set<string> {
  return new Set(taskRecords(state, taskId).filter((r) => r.phase === 'BUILD').map((r) => r.agentId));
}

/** When the task's CIMA history began (its first record), or null. */
function taskStart(state: CimaState, taskId: string): number | null {
  const recs = taskRecords(state, taskId);
  return recs.length ? Math.min(...recs.map((r) => r.ts)) : null;
}

/**
 * The command an evidence `source` cites, without the annotations agents add
 * around it. Seen live in v0.2: `git diff --stat (cwd C:\sandbox)`,
 * `node --test x.cjs (aislado, para confirmar …)`, `$ npm test`. Only
 * decoration is removed — the command itself must still match a real trace.
 */
export function citedCommand(source: string): string {
  let s = source.trim();
  s = s.replace(/^\$\s*/, '');                       // "$ npm test"
  s = s.replace(/^`+|`+$/g, '');                     // `npm test`
  while (/\s*\([^()]*\)\s*$/.test(s)) s = s.replace(/\s*\([^()]*\)\s*$/, ''); // trailing "(…)"
  return s.trim();
}

/** File paths a `source` mentions (tokens with a directory separator or an
 *  extension), e.g. `Read file_path="C:\x\agents.ts"` or
 *  `Read src/shared/agents.ts lineas 170-205` → the path. */
export function citedPaths(source: string): string[] {
  const tokens = source.split(/[\s"'`=,;()[\]]+/).filter(Boolean);
  return tokens.filter((t) => /[\\/]/.test(t) || /\.[a-z0-9]{1,6}$/i.test(t)).map((t) => norm(t).replace(/:$/, ''));
}

/** Match one evidence item against this agent's traces. Command evidence needs a
 *  command trace that contains the cited command; file evidence needs a read or
 *  write of a cited path (or a command that touched it). */
export function verifyEvidence(item: EvidenceItem, traces: readonly ExecutionTrace[]): VerifiedEvidence {
  const cmd = norm(citedCommand(item.source));
  const paths = citedPaths(item.source).filter((p) => p.length >= 4);
  const commandMatch = (t: ExecutionTrace) => {
    if (t.kind !== 'command' || cmd.length < 3 || t.ok === false) return false;
    const subject = norm(t.subject);
    return subject.includes(cmd) || cmd.includes(subject);
  };
  const pathMatch = (t: ExecutionTrace) => {
    if (!paths.length || t.ok === false) return false;
    const subject = norm(t.subject);
    if (t.kind === 'read' || t.kind === 'write' || t.kind === 'tool') {
      return paths.some((p) => subject.endsWith(p) || p.endsWith(subject));
    }
    return t.kind === 'command' && paths.some((p) => subject.includes(p));
  };
  const newestFirst = [...traces].reverse();
  const hit = COMMAND_EVIDENCE.has(item.type)
    ? newestFirst.find(commandMatch)
    : newestFirst.find((t) => pathMatch(t) || commandMatch(t));
  return hit ? { ...item, verified: true, traceId: hit.id } : { ...item, verified: false };
}

const PREREQ: Partial<Record<CimaPhase, CimaPhase>> = {
  TEST: 'BUILD',
  AUDIT: 'TEST',
  DECISION: 'AUDIT'
};

/** Phases that must all stand at PASS for work to be accepted and completed. */
export const DECISION_CHAIN: readonly CimaPhase[] = ['BUILD', 'TEST', 'AUDIT'];

// ─── Decision gate (v0.3): when may a task be marked done? ──────────────────

export interface CompletionVerdict {
  /** The task has CIMA history (a record or an assignment) — the gate applies. */
  governed: boolean;
  allowed: boolean;
  reason: string;
}

/**
 * A CIMA-governed task may be COMPLETED only when the runtime itself recorded
 * DECISION PASS (never an agent's say-so): the latest accepted DECISION is PASS,
 * BUILD/TEST/AUDIT still stand at PASS, and nothing was rebuilt after the
 * decision. A task with no CIMA history is outside the workflow and ungated.
 */
export function completionVerdict(state: CimaState, taskId: string): CompletionVerdict {
  const recs = taskRecords(state, taskId);
  const assigned = (state.assignments ?? []).some((a) => a.taskId === taskId);
  const governed = recs.length > 0 || assigned;
  if (!governed) return { governed: false, allowed: true, reason: 'not a CIMA task' };
  const accepted = recs.filter((r) => r.violations.length === 0);
  const decision = [...accepted].reverse().find((r) => r.phase === 'DECISION');
  if (!decision) return { governed, allowed: false, reason: `DECISION_GATE: task ${taskId} has no DECISION recorded by the runtime` };
  if (decision.verdict !== 'PASS') {
    return { governed, allowed: false, reason: `DECISION_GATE: task ${taskId} DECISION is ${decision.verdict}, not PASS` };
  }
  const v = taskPhaseVerdicts(state, taskId);
  const broken = DECISION_CHAIN.filter((p) => v[p] !== 'PASS');
  if (broken.length) {
    return { governed, allowed: false, reason: `DECISION_GATE: task ${taskId} no longer stands — ${broken.map((p) => `${p}=${v[p] ?? 'none'}`).join(', ')}` };
  }
  const rebuilt = accepted.some((r) => r.phase === 'BUILD' && r.ts > decision.ts);
  if (rebuilt) return { governed, allowed: false, reason: `DECISION_GATE: task ${taskId} was rebuilt after its DECISION; decide again` };
  return { governed, allowed: true, reason: `DECISION PASS recorded at ${new Date(decision.ts).toISOString()}` };
}

interface TaskLike { id?: unknown; status?: unknown }

function statusMap(text: string): Map<string, string> {
  const parsed = JSON.parse(text) as { tasks?: TaskLike[] } | TaskLike[];
  const list = Array.isArray(parsed) ? parsed : parsed?.tasks;
  if (!Array.isArray(list)) throw new Error('tasks.json has no tasks array');
  const m = new Map<string, string>();
  for (const t of list) if (t && typeof t.id === 'string') m.set(t.id, typeof t.status === 'string' ? t.status : '');
  return m;
}

/** Tasks that move INTO 'done' between two versions of the task ledger. */
export function newlyCompleted(beforeText: string | null, afterText: string): string[] {
  const after = statusMap(afterText);
  let before = new Map<string, string>();
  if (beforeText) { try { before = statusMap(beforeText); } catch { before = new Map(); } }
  return [...after].filter(([id, s]) => s === 'done' && before.get(id) !== 'done').map(([id]) => id);
}

/**
 * Project what a Write/Edit/MultiEdit tool call would leave in a file, so the
 * gate can judge the RESULT before the call runs. Returns null when the result
 * cannot be determined (the edit would not apply) — callers deny on null.
 */
export function projectFileWrite(tool: string, input: unknown, current: string | null): string | null {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const applyEdit = (text: string, oldS: unknown, newS: unknown, all: unknown): string | null => {
    if (typeof oldS !== 'string' || typeof newS !== 'string' || !oldS) return null;
    if (!text.includes(oldS)) return null;
    return all === true ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
  };
  if (tool === 'Write' || typeof i.content === 'string') return typeof i.content === 'string' ? i.content : null;
  if (current === null) return null;
  if (tool === 'Edit') return applyEdit(current, i.old_string, i.new_string, i.replace_all);
  if (tool === 'MultiEdit') {
    if (!Array.isArray(i.edits)) return null;
    let text: string | null = current;
    for (const e of i.edits as Array<Record<string, unknown>>) {
      if (text === null) return null;
      text = applyEdit(text, e?.old_string, e?.new_string, e?.replace_all);
    }
    return text;
  }
  return null;
}

/**
 * Decide what the runtime records for one submission. Never throws.
 * @param agentId  the SENDER as the router knows it (the outbox owner), never a
 *                 value from the message body
 */
export function evaluateSubmission(
  state: CimaState,
  raw: unknown,
  agentId: string,
  now: number,
  messageId?: string,
  trustedHuman?: DecisionOwner | null
): CimaRecord {
  const sub = parseSubmission(raw);
  if (!sub) {
    // Keep the phase the sender named when it is valid, so the ledger shows
    // WHICH phase the malformed claim was about.
    const named = String((raw as { phase?: unknown })?.phase ?? '').toUpperCase();
    const phase: CimaPhase = isCimaPhase(named) ? named : 'CONTEXT';
    return {
      kind: 'cima', ts: now, taskId: String((raw as { taskId?: unknown })?.taskId ?? '?'), phase, agentId,
      claimed: 'BLOCKED', verdict: 'BLOCKED', violations: ['MALFORMED'],
      reasons: ['MALFORMED: a cima submission needs taskId, a phase in ' + CIMA_WORKFLOW.join('/') + ' and a verdict PASS|FAIL|BLOCKED.'],
      evidence: [], transition: { from: null, to: phase }, messageId
    };
  }

  const recs = taskRecords(state, sub.taskId);
  // The transition starts at the last phase the runtime ACCEPTED — a rejected
  // claim (violations) never moved the task, so it is not where it stands.
  const accepted = recs.filter((r) => r.violations.length === 0);
  const from = accepted.length ? accepted[accepted.length - 1].phase : null;
  const start = taskStart(state, sub.taskId);
  // Traces this agent produced; before the task existed they cannot be evidence
  // for it. (The first submission of a task may cite work done just before it.)
  const window = start === null ? 0 : start - 30 * 60 * 1000;
  const mine = state.traces.filter((t) => t.agentId === agentId && t.ts >= window && t.ts <= now);
  const evidence = (sub.evidence ?? []).map((e) => verifyEvidence(e, mine));
  const violations: CimaRuleId[] = [];
  const reasons: string[] = [];

  if (sub.verdict !== 'BLOCKED') {
    // EVIDENCE FIRST
    const verified = evidence.filter((e) => e.verified);
    const unverified = evidence.filter((e) => !e.verified);
    if (verified.length === 0) {
      violations.push('EVIDENCE_FIRST');
      reasons.push(`EVIDENCE_FIRST: ${sub.verdict} needs evidence the harness observed; none of the ${evidence.length} cited item(s) matches a command or file this agent actually ran or read.`);
    } else if (unverified.length > 0) {
      violations.push('EVIDENCE_FIRST');
      reasons.push(`EVIDENCE_FIRST: ${unverified.length} cited item(s) match nothing the harness observed: ${unverified.map((e) => JSON.stringify(e.source.slice(0, 80))).join(', ')}.`);
    }
  }

  if (sub.verdict === 'PASS') {
    // BUILDER != AUDITOR
    const builders = buildersOf(state, sub.taskId);
    if ((sub.phase === 'TEST' || sub.phase === 'AUDIT') && builders.has(agentId)) {
      violations.push('BUILDER_NOT_AUDITOR');
      reasons.push(`BUILDER_NOT_AUDITOR: ${agentId} built task ${sub.taskId} and cannot pass its own ${sub.phase}.`);
    }
    if (sub.phase === 'AUDIT') {
      const buildTs = recs.find((r) => r.phase === 'BUILD')?.ts ?? start ?? 0;
      const wrote = state.traces.some((t) => t.agentId === agentId && t.kind === 'write' && t.ts >= buildTs && t.ts <= now);
      if (wrote) {
        violations.push('AUDITOR_MODIFIED_CODE');
        reasons.push(`AUDITOR_MODIFIED_CODE: ${agentId} modified files after the build started; an auditor must not change what it audits.`);
      }
    }
    // TRANSITIONS
    const prereq = PREREQ[sub.phase];
    if (prereq) {
      const prior = taskPhaseVerdicts(state, sub.taskId)[prereq];
      if (prior !== 'PASS') {
        violations.push('TRANSITION');
        reasons.push(`TRANSITION: ${sub.phase} PASS requires ${prereq} PASS for task ${sub.taskId} (found ${prior ?? 'none'}).`);
      }
    }
    // v0.3: accepting work needs the WHOLE chain to stand right now — a later
    // genuine TEST/BUILD failure after the audit must stop a DECISION PASS.
    if (sub.phase === 'DECISION') {
      const v = taskPhaseVerdicts(state, sub.taskId);
      const broken = DECISION_CHAIN.filter((p) => v[p] !== 'PASS');
      if (broken.length && !violations.includes('TRANSITION')) {
        violations.push('TRANSITION');
        reasons.push(`TRANSITION: DECISION PASS requires ${DECISION_CHAIN.join(', ')} PASS for task ${sub.taskId}; not PASS: ${broken.map((p) => `${p}=${v[p] ?? 'none'}`).join(', ')}.`);
      }
    }
    if (sub.phase === 'DECISION' && agentId !== state.godId && agentId !== 'human') {
      violations.push('DECISION_AUTHORITY');
      reasons.push(`DECISION_AUTHORITY: only the orchestrator (${state.godId}) or the human may accept work; ${agentId} may propose via LEARN.`);
    }
    if (sub.phase === 'DECISION' && agentId === 'human' && !trustedHuman) {
      violations.push('DECISION_AUTHORITY');
      reasons.push(`DECISION_AUTHORITY: human DECISION requires trusted human identity from v0.8 IPC; self-asserted 'human' identity denied.`);
    }
  }
  if (sub.phase === 'LEARN' && sub.verdict === 'PASS' && !taskRecords(state, sub.taskId).some((r) => r.phase === 'AUDIT')) {
    violations.push('TRANSITION');
    reasons.push(`TRANSITION: LEARN needs an AUDIT record for task ${sub.taskId} to learn from.`);
  }

  const verdict: RuntimeVerdict = violations.length ? 'BLOCKED' : sub.verdict;
  return {
    kind: 'cima', ts: now, taskId: sub.taskId, phase: sub.phase, agentId,
    claimed: sub.verdict, verdict, violations, reasons, evidence,
    transition: { from, to: sub.phase }, summary: sub.summary, messageId
  };
}

/** One line the router stamps onto the delivered message, so every recipient
 *  sees the runtime's verdict instead of trusting the sender's. */
export function recordBanner(r: CimaRecord | CimaAssignment): string {
  if (r.kind === 'cima-assignment') {
    return `[CIMA runtime] task ${r.taskId} · ${r.phase} assigned by ${r.from} to ${r.to} (no verdict claimed)`;
  }
  const head = `[CIMA runtime] task ${r.taskId} · ${r.phase} · claimed ${r.claimed} → recorded ${r.verdict}`;
  const ev = `evidence verified ${r.evidence.filter((e) => e.verified).length}/${r.evidence.length}`;
  return r.reasons.length ? `${head} · ${ev}\n${r.reasons.map((x) => `  - ${x}`).join('\n')}` : `${head} · ${ev}`;
}
