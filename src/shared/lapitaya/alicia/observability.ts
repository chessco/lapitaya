/**
 * La Pitaya Alicia v0.6 — governance observability.
 *
 *   RUNTIME ──▶ ledger / traces / approval & proposal state ──▶ observe() ──▶ Alicia ──▶ HUMAN
 *
 * A pure, read-only PROJECTION of facts the runtime already recorded:
 *   - cima-ledger.jsonl: governance decisions, intents, REQUEST transitions;
 *   - traces.jsonl: PostToolUse executions, linked to their decision only by
 *     the exact-call fingerprint both records carry (no time or name guessing);
 *   - approvals / proposals: only to know whether a human action is STILL due.
 *
 * It never decides, never writes, never reads Alicia's words, El Inge's
 * messages or UI state, and uses no model. Every output field is either an
 * enumerated value, an identifier that passed a strict pattern, or null
 * ("not available"). Free text (the runtime's reasons, commands, paths,
 * outputs, tokens) is never copied out: the "why" is an i18n key chosen by
 * the SAME deterministic rule → key mapping Alicia already uses
 * (messages.ts explanationKey). No evidence → no claim.
 */
import { aliciaText, explanationKey, riskLabel } from './messages';

/** FNV-1a, 32-bit, hex — the same algorithm the runtime uses for call
 *  fingerprints, kept local: the Alicia layer does not import governance code. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ─── categories ────────────────────────────────────────────────────────────

/** One per kind of fact the runtime records. Names reuse the runtime's own
 *  (intent trail statuses, REQUEST transitions, governance decisions/rules). */
export const OBSERVATION_CATEGORIES = [
  // intent boundary (v0.4.1): the intent record's trail
  'INTENT_RECEIVED', 'INTENT_CLASSIFIED', 'INTENT_FORWARDED', 'INTENT_GOVERNED', 'INTENT_BLOCKED', 'INTENT_COMPLETED',
  // REQUEST proposals (v0.4.2): the ledger's request transitions
  'REQUEST_PROPOSED', 'REQUEST_REVALIDATED', 'REQUEST_CONFIRMED', 'REQUEST_CONFIRMATION_DENIED',
  'REQUEST_CANCELLED', 'REQUEST_COMPLETED', 'REQUEST_SUPERSEDED', 'REQUEST_BLOCKED',
  // governance decisions at PreToolUse (and the task decision gate)
  'REQUEST_CONFIRMATION_REQUIRED', 'REQUEST_SCOPE_EXCEEDED', 'ACTION_AUTHORIZED', 'ACTION_SUPERVISED',
  'ACTION_DENIED', 'HUMAN_APPROVAL_REQUIRED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'COMPLETION_BLOCKED',
  // PostToolUse traces linked to a governed call
  'EXECUTION_COMPLETED', 'EXECUTION_FAILED',
  // a ledger fact whose decision this catalog does not know: shown, never interpreted
  'UNKNOWN_EVENT'
] as const;
export type ObservationCategory = (typeof OBSERVATION_CATEGORIES)[number];

export const HUMAN_ACTIONS = ['CONFIRM_REQUEST', 'DECIDE_APPROVAL', 'NONE'] as const;
export type RequiredHumanAction = (typeof HUMAN_ACTIONS)[number];

export const NEXT_STATES = [
  'WAITING_HUMAN_CONFIRMATION', 'WAITING_HUMAN_APPROVAL', 'CONTINUES_UNDER_CIMA', 'MAY_EXECUTE',
  'MAY_RUN_ONCE', 'APPROVAL_ON_ATTEMPT', 'NOT_EXECUTED', 'EXECUTED', 'EXECUTION_FAILED', 'CLOSED', 'TASK_NOT_COMPLETED',
  'SEE_LATER_EVENTS', 'NOT_AVAILABLE'
] as const;
export type NextState = (typeof NEXT_STATES)[number];

const RISKS = new Set(['LOW', 'MEDIUM', 'HIGH']);
const AUTONOMY = new Set(['AUTO', 'SUPERVISED', 'HUMAN_APPROVAL']);
const INTENT_TYPES = new Set(['CONVERSATION', 'REQUEST', 'ACTION']);
const EXECUTABLE = new Set(['ALLOW', 'SUPERVISED', 'APPROVED']);

/** What is always shown to the human (bloqueos, confirmaciones, approvals,
 *  state changes, completion blocked, execution of governed work). Routine
 *  facts (every ALLOW, every intent step) stay in the timeline only. */
export const RELEVANT_CATEGORIES: ReadonlySet<ObservationCategory> = new Set<ObservationCategory>([
  'INTENT_BLOCKED', 'REQUEST_PROPOSED', 'REQUEST_CONFIRMED', 'REQUEST_CONFIRMATION_DENIED', 'REQUEST_CANCELLED',
  'REQUEST_COMPLETED', 'REQUEST_SUPERSEDED', 'REQUEST_BLOCKED', 'REQUEST_CONFIRMATION_REQUIRED',
  'REQUEST_SCOPE_EXCEEDED', 'ACTION_DENIED', 'HUMAN_APPROVAL_REQUIRED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED',
  'COMPLETION_BLOCKED', 'EXECUTION_COMPLETED', 'EXECUTION_FAILED', 'UNKNOWN_EVENT'
]);

/** Is this fact something the human should see now (not only in a timeline)? */
export function isRelevant(o: Pick<GovernanceObservation, 'category' | 'decision' | 'proposalId' | 'approvalId'>): boolean {
  if (o.category === 'EXECUTION_COMPLETED' || o.category === 'EXECUTION_FAILED') return !!o.proposalId || !!o.approvalId;
  // An ACTION intent CIMA did not simply let through (e.g. HUMAN_APPROVAL_REQUIRED).
  if (o.category === 'INTENT_GOVERNED') return !!o.decision && !['ALLOW', 'SUPERVISED'].includes(o.decision);
  return RELEVANT_CATEGORIES.has(o.category);
}

/** Categories whose "why" is a property of the runtime itself (the gate, the
 *  transition) rather than a recorded rule — each has alicia.observe.why.<C>. */
export const CATEGORY_WHY: ReadonlySet<ObservationCategory> = new Set<ObservationCategory>([
  'INTENT_RECEIVED', 'INTENT_CLASSIFIED', 'INTENT_FORWARDED', 'INTENT_GOVERNED', 'INTENT_COMPLETED',
  'REQUEST_PROPOSED', 'REQUEST_REVALIDATED', 'REQUEST_CONFIRMED', 'REQUEST_CANCELLED', 'REQUEST_COMPLETED',
  'REQUEST_SUPERSEDED', 'EXECUTION_COMPLETED', 'EXECUTION_FAILED'
]);

// ─── the observation ───────────────────────────────────────────────────────

import { readOwner, safeOwner, type SafeDecisionOwner } from '../identity';

export interface ObservationEvidence {
  /** `EVT-<fnv1a of the exact ledger line>`, the trace's own id, or (v0.7) the approval's own id. */
  ref: string;
  source: 'cima-ledger.jsonl' | 'traces.jsonl' | 'approvals.json';
}

/** One runtime fact, human-safe. Every field is runtime data or null. */
export interface GovernanceObservation {
  eventId: string;
  category: ObservationCategory;
  timestamp: number | null;
  intentId: string | null;
  proposalId: string | null;
  approvalId: string | null;
  taskId: string | null;
  /** Who produced the fact (agent id, 'human', 'runtime', 'alicia'). */
  agent: string | null;
  /** `<tool> · <runtime category>` — never the command, path or payload. */
  operation: string | null;
  intentType: 'CONVERSATION' | 'REQUEST' | 'ACTION' | null;
  runtimeStatus: string | null;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  /** REQUEST proposals only: the scope the runtime assigned. */
  scope: 'LOW' | 'MEDIUM' | null;
  autonomy: 'AUTO' | 'SUPERVISED' | 'HUMAN_APPROVAL' | null;
  decision: string | null;
  rule: string | null;
  requiredHumanAction: RequiredHumanAction | null;
  nextState: NextState;
  /** v0.8: the trusted human behind a human decision (confirm / cancel / approve / reject / refused attempt),
   *  read from the runtime's own record. Id + display name only: never a session, window, token or fingerprint. */
  decisionOwner: SafeDecisionOwner | null;
  evidence: ObservationEvidence | null;
  /** Repeated identical facts collapsed into this one (agent retry loops). */
  count: number;
  /** The i18n keys (namespace lapitaya) that explain it — chosen here, deterministically. */
  keys: { what: string; why: string; next: string; autonomy: string | null; humanAction: string | null };
}

export interface ObservabilitySources {
  ledger: readonly unknown[];
  traces?: readonly unknown[];
  approvals?: readonly unknown[];
  requests?: readonly unknown[];
}

export interface ObservabilityView {
  /** Relevant facts, newest first, repeats collapsed. */
  recent: readonly GovernanceObservation[];
  /** Per REQUEST proposal: its read-only timeline (oldest first) and latest fact. */
  byProposal: Readonly<Record<string, { timeline: readonly GovernanceObservation[]; latest: GovernanceObservation | null }>>;
  /** v0.7 Decision Center: every HIGH approval STILL pending in the runtime,
   *  newest first, each as its HUMAN_APPROVAL_REQUIRED fact. */
  pendingApprovals?: readonly GovernanceObservation[];
  /** v0.7: per approval (pending or decided): its read-only timeline and latest fact. */
  byApproval?: Readonly<Record<string, { timeline: readonly GovernanceObservation[]; latest: GovernanceObservation | null }>>;
  /** v0.7: resolved human decisions (REQUEST confirmations/closures, HIGH approvals/rejections), newest first. */
  history?: readonly GovernanceObservation[];
}

/** The human decisions the Decision Center lists as resolved (runtime facts only). */
export const RESOLVED_DECISION_CATEGORIES: ReadonlySet<ObservationCategory> = new Set<ObservationCategory>([
  'REQUEST_CONFIRMED', 'REQUEST_CANCELLED', 'REQUEST_COMPLETED', 'REQUEST_CONFIRMATION_DENIED',
  'REQUEST_BLOCKED', 'REQUEST_SUPERSEDED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED'
]);

// ─── field guards (whitelist: nothing free-form leaves this module) ─────────

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
/** An identifier the runtime produced (ids, agent ids, rule codes, tool names). */
const id = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) && !looksSecret(v) ? v : null);
const inSet = <T extends string>(set: ReadonlySet<string>, v: unknown): T | null => (typeof v === 'string' && set.has(v) ? v as T : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Long hex runs, provider-style keys and bearer-ish tokens are never identifiers. */
function looksSecret(v: string): boolean {
  return /[0-9a-f]{24,}/i.test(v) || /^(sk|pk|rk|ghp|gho|xox[abp])[-_]/i.test(v) || /token|secret|password|apikey|api_key/i.test(v);
}

/** The evidence reference of a ledger record: the hash of its exact line. */
export function evidenceRef(record: unknown): string {
  return `EVT-${fnv1a(JSON.stringify(record))}`;
}

// ─── one record → observations ─────────────────────────────────────────────

interface Ctx {
  pendingProposals: ReadonlySet<string>;
  pendingApprovals: ReadonlySet<string>;
}

function whyKey(category: ObservationCategory, rule: string | null, decision: string | null, fromRecordRule: boolean): string {
  // A decision this catalog does not know is shown verbatim, never interpreted.
  if (category === 'UNKNOWN_EVENT') return 'alicia.observe.unavailable';
  if (fromRecordRule && (rule || decision)) return `alicia.explain.${explanationKey({ rule: rule ?? undefined, decision: decision ?? undefined })}`;
  if (CATEGORY_WHY.has(category)) return `alicia.observe.why.${category}`;
  return 'alicia.observe.unavailable';
}

function nextFor(o: Pick<GovernanceObservation, 'category' | 'proposalId' | 'approvalId' | 'decision'>, ctx: Ctx): { next: NextState; action: RequiredHumanAction } {
  const proposalPending = !!o.proposalId && ctx.pendingProposals.has(o.proposalId);
  const approvalPending = !!o.approvalId && ctx.pendingApprovals.has(o.approvalId);
  switch (o.category) {
    case 'REQUEST_PROPOSED':
      return proposalPending ? { next: 'WAITING_HUMAN_CONFIRMATION', action: 'CONFIRM_REQUEST' } : { next: 'SEE_LATER_EVENTS', action: 'NONE' };
    case 'REQUEST_CONFIRMATION_REQUIRED':
      return proposalPending ? { next: 'WAITING_HUMAN_CONFIRMATION', action: 'CONFIRM_REQUEST' } : { next: 'NOT_EXECUTED', action: 'NONE' };
    case 'HUMAN_APPROVAL_REQUIRED':
      return approvalPending ? { next: 'WAITING_HUMAN_APPROVAL', action: 'DECIDE_APPROVAL' } : { next: 'SEE_LATER_EVENTS', action: 'NONE' };
    case 'INTENT_GOVERNED':
      // An ACTION CIMA stopped for HIGH approval is waiting on the human until decided.
      if (o.decision === 'HUMAN_APPROVAL_REQUIRED') {
        // No concrete call yet → no approval exists; CIMA raises it when the call is attempted.
        if (!o.approvalId) return { next: 'APPROVAL_ON_ATTEMPT', action: 'NONE' };
        return approvalPending ? { next: 'WAITING_HUMAN_APPROVAL', action: 'DECIDE_APPROVAL' } : { next: 'SEE_LATER_EVENTS', action: 'NONE' };
      }
      return { next: 'CONTINUES_UNDER_CIMA', action: 'NONE' };
    case 'REQUEST_REVALIDATED': case 'REQUEST_CONFIRMED': case 'INTENT_FORWARDED':
      return { next: 'CONTINUES_UNDER_CIMA', action: 'NONE' };
    case 'ACTION_AUTHORIZED': case 'ACTION_SUPERVISED':
      return { next: 'MAY_EXECUTE', action: 'NONE' };
    case 'APPROVAL_GRANTED':
      return { next: 'MAY_RUN_ONCE', action: 'NONE' };
    case 'REQUEST_SCOPE_EXCEEDED': case 'ACTION_DENIED': case 'APPROVAL_REJECTED':
    case 'REQUEST_CONFIRMATION_DENIED': case 'INTENT_BLOCKED':
      return { next: 'NOT_EXECUTED', action: 'NONE' };
    case 'COMPLETION_BLOCKED':
      return { next: 'TASK_NOT_COMPLETED', action: 'NONE' };
    case 'REQUEST_CANCELLED': case 'REQUEST_COMPLETED': case 'REQUEST_SUPERSEDED': case 'REQUEST_BLOCKED':
      return { next: 'CLOSED', action: 'NONE' };
    case 'EXECUTION_COMPLETED':
      return { next: 'EXECUTED', action: 'NONE' };
    case 'EXECUTION_FAILED':
      return { next: 'EXECUTION_FAILED', action: 'NONE' };
    case 'INTENT_RECEIVED': case 'INTENT_CLASSIFIED': case 'INTENT_COMPLETED':
      return { next: 'SEE_LATER_EVENTS', action: 'NONE' };
    default:
      return { next: 'NOT_AVAILABLE', action: 'NONE' };
  }
}

function build(fields: Omit<GovernanceObservation, 'requiredHumanAction' | 'nextState' | 'count' | 'keys' | 'decisionOwner'> & { decisionOwner?: SafeDecisionOwner | null }, fromRecordRule: boolean, ctx: Ctx): GovernanceObservation {
  const { next, action } = nextFor(fields, ctx);
  const o: GovernanceObservation = {
    ...fields,
    decisionOwner: fields.decisionOwner ?? null,
    requiredHumanAction: action,
    nextState: next,
    count: 1,
    keys: {
      what: `alicia.observe.what.${fields.category}`,
      why: whyKey(fields.category, fields.rule, fields.decision, fromRecordRule),
      next: `alicia.observe.next.${next}`,
      autonomy: fields.autonomy ? `alicia.observe.autonomy.${fields.autonomy}` : null,
      humanAction: action !== 'NONE' ? `alicia.observe.action.${action}` : null
    }
  };
  return o;
}

function governanceCategory(decision: string | null, rule: string | null): ObservationCategory {
  if (rule === 'DECISION_GATE' && decision === 'DENY') return 'COMPLETION_BLOCKED';
  if (rule === 'REQUEST_CONFIRMATION_REQUIRED' && decision === 'DENY') return 'REQUEST_CONFIRMATION_REQUIRED';
  if (rule === 'REQUEST_SCOPE_EXCEEDED' && decision === 'DENY') return 'REQUEST_SCOPE_EXCEEDED';
  switch (decision) {
    case 'DENY': return 'ACTION_DENIED';
    case 'HUMAN_APPROVAL_REQUIRED': return 'HUMAN_APPROVAL_REQUIRED';
    case 'SUPERVISED': return 'ACTION_SUPERVISED';
    case 'ALLOW': case 'APPROVED': return 'ACTION_AUTHORIZED';
    case 'HUMAN_APPROVED': return 'APPROVAL_GRANTED';
    case 'HUMAN_REJECTED': return 'APPROVAL_REJECTED';
    default: return 'UNKNOWN_EVENT';
  }
}

/** Observations for one ledger record (an intent yields one per trail step). */
export function observeLedgerRecord(record: unknown, ctx: Ctx = { pendingProposals: new Set(), pendingApprovals: new Set() }): GovernanceObservation[] {
  const r = obj(record);
  const ref = evidenceRef(record);
  const evidence: ObservationEvidence = { ref, source: 'cima-ledger.jsonl' };
  if (r.kind === 'governance') {
    const decision = id(r.decision);
    const rule = id(r.rule);
    const tool = id(r.tool);
    const cat = id(r.category);
    return [build({
      eventId: ref, category: governanceCategory(decision, rule), timestamp: num(r.ts),
      intentId: null, proposalId: id(r.proposalId), approvalId: id(r.approvalId), taskId: id(r.taskId),
      agent: id(r.agentId), operation: tool ? (cat ? `${tool} · ${cat}` : tool) : null, intentType: null,
      runtimeStatus: decision, risk: inSet(RISKS, r.risk), scope: null, autonomy: inSet(AUTONOMY, r.mode),
      decision, rule, evidence,
      decisionOwner: decision === 'HUMAN_APPROVED' || decision === 'HUMAN_REJECTED' ? safeOwner(readOwner(r.human)) : null
    }, true, ctx)];
  }
  if (r.kind === 'request') {
    const transition = id(r.transition);
    const category = transition && (OBSERVATION_CATEGORIES as readonly string[]).includes(`REQUEST_${transition}`)
      ? `REQUEST_${transition}` as ObservationCategory : 'UNKNOWN_EVENT';
    const code = id(r.code);
    return [build({
      eventId: ref, category, timestamp: num(r.ts), intentId: id(r.intentId), proposalId: id(r.proposalId),
      approvalId: null, taskId: null, agent: id(r.by), operation: null, intentType: 'REQUEST',
      runtimeStatus: id(r.status), risk: null, scope: inSet(new Set(['LOW', 'MEDIUM']), r.scope), autonomy: null,
      decision: null, rule: code, evidence,
      decisionOwner: transition && HUMAN_TRANSITIONS.has(transition) ? safeOwner(readOwner(r.human)) : null
    }, !!code, ctx)];
  }
  if (r.kind === 'intent') {
    const trail = Array.isArray(r.trail) ? r.trail : [];
    const target = obj(r.target);
    return trail.flatMap((step, i) => {
      const status = id(obj(step).status);
      const category = status && (OBSERVATION_CATEGORIES as readonly string[]).includes(`INTENT_${status}`)
        ? `INTENT_${status}` as ObservationCategory : 'UNKNOWN_EVENT';
      // The decision/rule belong to the step that produced them (GOVERNED / BLOCKED).
      const decided = category === 'INTENT_GOVERNED' || category === 'INTENT_BLOCKED';
      const decision = decided ? id(r.decision) : null;
      const rule = decided ? id(r.rule) : null;
      return [build({
        eventId: `${ref}.${i}`, category, timestamp: num(obj(step).ts), intentId: id(r.id), proposalId: id(r.proposalId),
        approvalId: decided ? id(r.approvalId) : null, taskId: id(r.taskId), agent: id(r.source),
        operation: id(target.tool), intentType: inSet(INTENT_TYPES, r.type), runtimeStatus: status,
        risk: inSet(RISKS, r.risk), scope: null, autonomy: decided ? inSet(AUTONOMY, r.mode) : null,
        decision, rule, evidence: { ref: `${ref}.${i}`, source: 'cima-ledger.jsonl' }
      }, decided, ctx)];
    });
  }
  return [];
}

// ─── projection ────────────────────────────────────────────────────────────

/** REQUEST transitions a human performs (or attempts): the runtime records WHO beside them. */
const HUMAN_TRANSITIONS: ReadonlySet<string> = new Set(['CONFIRMED', 'CANCELLED', 'COMPLETED', 'CONFIRMATION_DENIED']);

const sameFact = (a: GovernanceObservation, b: GovernanceObservation) =>
  a.category === b.category && a.decisionOwner?.id === b.decisionOwner?.id && a.agent === b.agent && a.operation === b.operation && a.rule === b.rule &&
  a.decision === b.decision && a.proposalId === b.proposalId && a.approvalId === b.approvalId && a.nextState === b.nextState;

function collapse(list: GovernanceObservation[]): GovernanceObservation[] {
  const out: GovernanceObservation[] = [];
  for (const o of list) {
    const prev = out[out.length - 1];
    if (prev && sameFact(prev, o)) out[out.length - 1] = { ...prev, count: prev.count + 1 };
    else out.push(o);
  }
  return out;
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

/**
 * The whole read-only view. Deterministic for the same sources; inputs are
 * never mutated; the result is deeply frozen.
 */
export function projectObservability(src: ObservabilitySources, opts: { recentLimit?: number; timelineLimit?: number; historyLimit?: number } = {}): ObservabilityView {
  const recentLimit = opts.recentLimit ?? 12;
  const timelineLimit = opts.timelineLimit ?? 60;
  const ctx: Ctx = {
    pendingProposals: new Set((src.requests ?? []).map(obj).filter((p) => p.status === 'PROPOSED').map((p) => id(p.id)).filter((x): x is string => !!x)),
    pendingApprovals: new Set((src.approvals ?? []).map(obj).filter((a) => a.status === 'pending').map((a) => id(a.id)).filter((x): x is string => !!x))
  };

  const facts: GovernanceObservation[] = [];
  // Executable decisions awaiting their PostToolUse trace, by agent + exact-call fingerprint.
  const awaiting = new Map<string, { obs: GovernanceObservation; ts: number }[]>();
  for (const rec of src.ledger) {
    const r = obj(rec);
    for (const o of observeLedgerRecord(rec, ctx)) {
      facts.push(o);
      const fp = id(r.fingerprint);
      if (r.kind === 'governance' && fp && o.agent && o.decision && EXECUTABLE.has(o.decision)) {
        const k = `${o.agent}\u0000${fp}`;
        (awaiting.get(k) ?? awaiting.set(k, []).get(k)!).push({ obs: o, ts: o.timestamp ?? 0 });
      }
    }
  }
  // A trace becomes a fact only when it is provably the execution of a governed
  // call: same agent, same exact-call fingerprint, after that decision.
  for (const t of (src.traces ?? []).map(obj)) {
    const fp = id(t.fingerprint);
    const agent = id(t.agentId);
    const ts = num(t.ts);
    const traceId = id(t.id);
    if (!fp || !agent || ts === null || !traceId || typeof t.ok !== 'boolean') continue;
    const queue = awaiting.get(`${agent}\u0000${fp}`);
    // The latest not-yet-linked decision for this exact call before the trace
    // (an authorized call that never ran must not absorb a later execution).
    let i = -1;
    if (queue) for (let j = queue.length - 1; j >= 0; j--) if (queue[j].ts <= ts) { i = j; break; }
    if (!queue || i < 0) continue;
    const { obs: d } = queue.splice(i, 1)[0];
    facts.push(build({
      eventId: traceId, category: t.ok ? 'EXECUTION_COMPLETED' : 'EXECUTION_FAILED', timestamp: ts,
      intentId: null, proposalId: d.proposalId, approvalId: d.approvalId, taskId: d.taskId, agent,
      operation: d.operation, intentType: null, runtimeStatus: t.ok ? 'EXECUTED' : 'FAILED', risk: d.risk,
      scope: null, autonomy: d.autonomy, decision: d.decision, rule: d.rule,
      evidence: { ref: traceId, source: 'traces.jsonl' }
    }, false, ctx));
  }
  const ordered = facts.map((o, i) => ({ o, i }))
    .sort((a, b) => (a.o.timestamp ?? 0) - (b.o.timestamp ?? 0) || a.i - b.i).map((x) => x.o);

  // Intent ids of each proposal, so the intent's own trail joins its timeline.
  const intentOf = new Map<string, string>();
  for (const o of ordered) if (o.proposalId && o.intentId && o.category.startsWith('REQUEST_')) intentOf.set(o.proposalId, o.intentId);
  const byProposal: Record<string, { timeline: GovernanceObservation[]; latest: GovernanceObservation | null }> = {};
  for (const [pid, intentId] of intentOf) {
    // Its own facts, its intent's trail, and the human's decisions on approvals it raised.
    const approvals = new Set(ordered.filter((o) => o.proposalId === pid && o.approvalId).map((o) => o.approvalId as string));
    const timeline = collapse(ordered.filter((o) => o.proposalId === pid
      || (o.intentId === intentId && o.category.startsWith('INTENT_'))
      || (!!o.approvalId && approvals.has(o.approvalId) && (o.category === 'APPROVAL_GRANTED' || o.category === 'APPROVAL_REJECTED'))));
    const trimmed = timeline.slice(-timelineLimit);
    // The card's "state now": first whatever still needs the human (a pending
    // HIGH approval is never hidden behind later routine work), then the latest
    // RELEVANT fact (an intent trail step never hides the proposal's real state).
    const newestFirst = [...trimmed].reverse();
    const latest = newestFirst.find((o) => o.requiredHumanAction !== 'NONE' && o.requiredHumanAction !== null)
      ?? newestFirst.find(isRelevant) ?? trimmed[trimmed.length - 1] ?? null;
    byProposal[pid] = { timeline: trimmed, latest };
  }
  // Execution is shown when it belongs to governed work (a REQUEST or a HIGH approval), not for every ALLOW.
  const relevant = ordered.filter(isRelevant);
  const recent = collapse(relevant).reverse().slice(0, recentLimit);

  // ─── v0.7 Decision Center: pending HIGH approvals, per-approval timelines, history ───
  const approvalState = new Map<string, Record<string, unknown>>();
  for (const a of (src.approvals ?? []).map(obj)) { const aid = id(a.id); if (aid) approvalState.set(aid, a); }
  const pendingApprovals: GovernanceObservation[] = [];
  for (const [aid, a] of approvalState) {
    if (a.status !== 'pending') continue;
    const fact = [...ordered].reverse().find((o) => o.approvalId === aid && o.category === 'HUMAN_APPROVAL_REQUIRED');
    if (fact) { pendingApprovals.push(fact); continue; }
    // The ledger window no longer holds its decision record: the approval itself
    // (approvals.json, written by the runtime) is the evidence. Enumerated fields only.
    const tool = id(a.tool); const cat = id(a.category);
    pendingApprovals.push(build({
      eventId: aid, category: 'HUMAN_APPROVAL_REQUIRED', timestamp: num(a.createdAt), intentId: null, proposalId: null,
      approvalId: aid, taskId: null, agent: id(a.agentId), operation: tool ? (cat ? `${tool} · ${cat}` : tool) : null,
      intentType: null, runtimeStatus: 'pending', risk: inSet(RISKS, a.risk), scope: null, autonomy: 'HUMAN_APPROVAL',
      decision: 'HUMAN_APPROVAL_REQUIRED', rule: null, evidence: { ref: aid, source: 'approvals.json' }
    }, true, ctx));
  }
  pendingApprovals.sort((x, y) => (y.timestamp ?? 0) - (x.timestamp ?? 0));
  const approvalIds = new Set<string>([...pendingApprovals.map((o) => o.approvalId as string),
    ...ordered.filter((o) => o.approvalId && (o.category === 'APPROVAL_GRANTED' || o.category === 'APPROVAL_REJECTED')).map((o) => o.approvalId as string)]);
  const byApproval: Record<string, { timeline: GovernanceObservation[]; latest: GovernanceObservation | null }> = {};
  for (const aid of approvalIds) {
    const timeline = collapse(ordered.filter((o) => o.approvalId === aid)).slice(-timelineLimit);
    const pending = pendingApprovals.find((o) => o.approvalId === aid);
    byApproval[aid] = { timeline: timeline.length ? timeline : pending ? [pending] : [], latest: pending ?? timeline[timeline.length - 1] ?? null };
  }
  const history = collapse(ordered.filter((o) => RESOLVED_DECISION_CATEGORIES.has(o.category))).reverse().slice(0, opts.historyLimit ?? 20);
  return deepFreeze({ recent, byProposal, pendingApprovals, byApproval, history });
}

// ─── the same explanation as text (non-UI hosts, evidence, tests) ───────────

export interface ObservationText {
  what: string; why: string; next: string; risk: string | null; autonomy: string | null;
  rule: string | null; humanAction: string | null; evidence: string;
}

/** Variables every observation key may interpolate — runtime identifiers only. */
export function observationVars(o: GovernanceObservation): Record<string, string | number> {
  return {
    agent: o.agent ?? '—', operation: o.operation ?? '—', proposalId: o.proposalId ?? '—', approvalId: o.approvalId ?? '—',
    rule: o.rule ?? o.decision ?? '—', decision: o.decision ?? '—', risk: o.risk ?? '—', count: o.count
  };
}

/** Render one observation in a locale with the shipped catalog. The UI does the
 *  same with i18next and `o.keys`; both read the same keys and variables. */
export function explainObservation(o: GovernanceObservation, locale: string | null | undefined): ObservationText {
  const vars = { ...observationVars(o), riskLabel: o.risk ? riskLabel(locale, o.risk) : '' };
  const t = (key: string) => aliciaText(locale, key.replace(/^lapitaya:/, ''), vars);
  return {
    what: t(o.keys.what), why: t(o.keys.why), next: t(o.keys.next),
    risk: o.risk, autonomy: o.keys.autonomy ? t(o.keys.autonomy) : null, rule: o.rule,
    humanAction: o.keys.humanAction ? t(o.keys.humanAction) : null,
    evidence: o.evidence ? t('alicia.observe.evidence') + ` ${o.evidence.source} · ${o.evidence.ref}` : t('alicia.observe.noEvidence')
  };
}
