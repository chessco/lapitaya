import type { GovernanceObservation, ObservabilityView } from '@shared/lapitaya/alicia/observability';
import type { ConfirmationSnapshot, ProposalView } from './confirmationController';

/**
 * La Pitaya Alicia v0.7 — Human Governance & Decision Center (state).
 *
 * One place for the human's pending decisions, with two runtime mechanisms
 * that stay DISTINCT:
 *   - REQUEST confirmation  → lapitaya:confirmRequest / lapitaya:cancelRequest (v0.5 controller)
 *   - HIGH-risk approval    → lapitaya:decide (the existing CIMA human approval)
 * Nothing here decides, classifies, approves or executes: every fact comes
 * from the runtime's v0.6 projection or the v0.5 runtime proposal list, and
 * every decision goes to the runtime, whose answer (and later state) wins.
 */

/** Ids the human ticked "I reviewed it" for (UI-only; required before Approve). */
export type AcknowledgedIds = ReadonlySet<string>;

/** The runtime's answer to lapitaya:decide — never the call's command or fingerprint. */
export type ApprovalDecisionResult = { id: string; status: string; decidedAt: number | null; decidedBy: string | null } | null;

/** The one human-approval channel the Decision Center may use. */
export interface ApprovalPort {
  decide(id: string, approve: boolean): Promise<ApprovalDecisionResult>;
}

export const HIGH_UI_STATES = [
  'HUMAN_APPROVAL_REQUIRED', 'APPROVING', 'REJECTING', 'APPROVED', 'REJECTED', 'ALREADY_RESOLVED', 'ERROR'
] as const;
export type HighUiState = (typeof HIGH_UI_STATES)[number];
export type HighOp = 'approve' | 'reject';

export interface HighOutcome {
  op: HighOp;
  /** The runtime applied THIS decision. */
  ok: boolean;
  /** ALREADY_RESOLVED: the runtime had nothing pending under that id (decided elsewhere, unknown). */
  code: 'ALREADY_RESOLVED' | 'IPC_ERROR' | null;
}

export function createApprovalController(port: ApprovalPort) {
  const inFlight = new Map<string, HighOp>();
  const outcomes = new Map<string, HighOutcome>();
  const listeners = new Set<() => void>();
  let snapshot = { inFlight: new Map(inFlight), outcomes: new Map(outcomes) };
  const emit = () => { snapshot = { inFlight: new Map(inFlight), outcomes: new Map(outcomes) }; for (const l of listeners) l(); };

  async function run(id: string, op: HighOp, stillPending: boolean): Promise<ApprovalDecisionResult | undefined> {
    // One human decision at a time, and only for what the runtime still lists as
    // pending. The runtime's `decide` (pending-only, one-shot) is the real guard.
    if (inFlight.size || !stillPending) return undefined;
    inFlight.set(id, op);
    outcomes.delete(id);
    emit();
    let res: ApprovalDecisionResult;
    let failed = false;
    try { res = await port.decide(id, op === 'approve'); } catch { res = null; failed = true; }
    inFlight.delete(id);
    const applied = !!res && res.status === (op === 'approve' ? 'approved' : 'rejected');
    outcomes.set(id, { op, ok: applied, code: failed ? 'IPC_ERROR' : applied ? null : 'ALREADY_RESOLVED' });
    emit();
    return res;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
    approve: (id: string, stillPending: boolean) => run(id, 'approve', stillPending),
    reject: (id: string, stillPending: boolean) => run(id, 'reject', stillPending)
  };
}
export type ApprovalController = ReturnType<typeof createApprovalController>;
export type ApprovalSnapshot = ReturnType<ApprovalController['getSnapshot']>;

export interface HighDecisionView {
  approvalId: string;
  /** The runtime fact that raised it (HUMAN_APPROVAL_REQUIRED) — or, once decided, its latest fact. */
  fact: GovernanceObservation;
  timeline: readonly GovernanceObservation[];
  uiState: HighUiState;
  /** The runtime's own final decision, when there is one (APPROVAL_GRANTED / APPROVAL_REJECTED). */
  resolution: 'APPROVAL_GRANTED' | 'APPROVAL_REJECTED' | null;
  pending: boolean;
  canDecide: boolean;
  busy: boolean;
  outcome: HighOutcome | null;
}

export interface DecisionCenterModel {
  counts: { total: number; requests: number; high: number };
  /** Pending HIGH approvals first (newest first), then any the human acted on this session. */
  high: readonly HighDecisionView[];
  /** REQUEST cards (v0.5 views: pending, in progress, recently closed). */
  requests: readonly ProposalView[];
  /** Resolved human decisions from the runtime (v0.6 projection), newest first. */
  history: readonly GovernanceObservation[];
  /** The projection was available (no projection → no claims, only the v0.5 REQUEST data). */
  observed: boolean;
}

/** Card state for one HIGH approval. The runtime's facts always win over what this UI did. */
export function deriveHighState(pending: boolean, resolution: HighDecisionView['resolution'], inFlight: HighOp | undefined, outcome: HighOutcome | null): HighUiState {
  if (inFlight === 'approve') return 'APPROVING';
  if (inFlight === 'reject') return 'REJECTING';
  if (outcome?.code === 'IPC_ERROR') return pending ? 'ERROR' : resolution === 'APPROVAL_GRANTED' ? 'APPROVED' : resolution === 'APPROVAL_REJECTED' ? 'REJECTED' : 'ERROR';
  if (outcome?.code === 'ALREADY_RESOLVED') return 'ALREADY_RESOLVED';
  if (pending) return 'HUMAN_APPROVAL_REQUIRED';
  if (resolution === 'APPROVAL_GRANTED') return 'APPROVED';
  if (resolution === 'APPROVAL_REJECTED') return 'REJECTED';
  return 'ALREADY_RESOLVED';
}

export function buildDecisionCenter(requests: ConfirmationSnapshot, view: ObservabilityView | null, approvals: ApprovalSnapshot): DecisionCenterModel {
  const pendingFacts = view?.pendingApprovals ?? [];
  const pendingIds = new Set(pendingFacts.map((o) => o.approvalId as string));
  const touched = [...approvals.outcomes.keys(), ...approvals.inFlight.keys()].filter((aid) => !pendingIds.has(aid));
  const high: HighDecisionView[] = [];
  for (const aid of [...pendingIds, ...new Set(touched)]) {
    const entry = view?.byApproval?.[aid];
    const fact = pendingFacts.find((o) => o.approvalId === aid) ?? entry?.latest ?? null;
    if (!fact) continue; // no runtime fact → no card (no evidence, no claim)
    const timeline = entry?.timeline ?? [fact];
    const decided = [...timeline].reverse().find((o) => o.category === 'APPROVAL_GRANTED' || o.category === 'APPROVAL_REJECTED');
    const resolution = (decided?.category ?? null) as HighDecisionView['resolution'];
    const pending = pendingIds.has(aid);
    const op = approvals.inFlight.get(aid);
    const outcome = approvals.outcomes.get(aid) ?? null;
    high.push({
      approvalId: aid, fact, timeline, resolution, pending,
      uiState: deriveHighState(pending, resolution, op, outcome),
      canDecide: pending && approvals.inFlight.size === 0,
      busy: !!op, outcome
    });
  }
  const pendingRequests = requests.views.filter((v) => v.status === 'PROPOSED').length;
  return {
    counts: { total: pendingRequests + pendingIds.size, requests: pendingRequests, high: pendingIds.size },
    high, requests: requests.views, history: view?.history ?? [], observed: !!view
  };
}

/** What Alicia says after a HIGH decision (i18n key under lapitaya:alicia.decisions.said). */
export function highLineKey(d: Pick<HighDecisionView, 'outcome'>): string | null {
  const o = d.outcome;
  if (!o) return null;
  if (o.code === 'IPC_ERROR') return 'failed';
  if (o.code === 'ALREADY_RESOLVED') return 'alreadyResolved';
  return o.op === 'approve' ? 'approved' : 'rejected';
}
