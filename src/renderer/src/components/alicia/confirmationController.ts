import type { RequestProposal, RequestStatus } from '@shared/lapitaya/intent';
import type { Approval } from '@shared/lapitaya/governance';

/**
 * La Pitaya Alicia v0.5 — the state behind the Human Confirmation UI.
 *
 * This is a HUMAN INTERFACE, not an authority. It holds no source of truth of
 * its own: the proposal list is whatever the runtime last returned
 * (`lapitaya:requests`), and the only things it can do are the four human-
 * channel IPC calls in `ConfirmationPort`. It never computes risk (the
 * proposal's `scope` is shown verbatim), never approves anything, never
 * executes, and never retries a refused confirmation on its own. Whether a
 * tool may run is decided by the runtime at PreToolUse — with or without
 * this UI.
 *
 * Framework-free so the same logic runs under React (useSyncExternalStore)
 * and under the Node test suite against the real runtime.
 */

export type RequestResult =
  | { ok: true; proposal: RequestProposal }
  | { ok: false; code: string; reason: string };

/** Everything the confirmation UI can reach — the existing human-channel IPC
 *  (preload: lapitayaRequests / lapitayaApprovals / lapitayaConfirmRequest /
 *  lapitayaCancelRequest). Nothing here executes, approves or decides. */
export interface ConfirmationPort {
  requests(): Promise<RequestProposal[]>;
  approvals(): Promise<Approval[]>;
  confirm(id: string, token: string): Promise<RequestResult>;
  cancel(id: string): Promise<RequestResult>;
}

/** What the card shows. Every state is the runtime's status, an operation in
 *  flight, or the runtime's own refusal code — nothing the backend did not say. */
export const CONFIRMATION_UI_STATES = [
  'PENDING', 'CONFIRMING', 'CONFIRMED', 'CANCELING', 'CANCELLED',
  'COMPLETED', 'SUPERSEDED', 'BLOCKED', 'STALE', 'ERROR'
] as const;
export type ConfirmationUiState = (typeof CONFIRMATION_UI_STATES)[number];

export type ConfirmationOp = 'confirm' | 'cancel';

export interface ConfirmationOutcome {
  op: ConfirmationOp;
  ok: boolean;
  /** The runtime's refusal code (TAMPERED, STALE_PROPOSAL, …), or IPC_ERROR. */
  code: string | null;
  reason: string | null;
}

/** Refusal codes the runtime already explains (lapitaya:alicia.explain.*). */
export const EXPLAINED_CODES: ReadonlySet<string> = new Set([
  'NOT_AUTHORIZED', 'INVALID_CONFIRMATION', 'UNKNOWN_PROPOSAL', 'WRONG_CONTEXT',
  'NOT_CONFIRMABLE', 'TAMPERED', 'STALE_PROPOSAL', 'REQUEST_CONFIRMATION_REQUIRED'
]);

export interface ProposalView {
  id: string;
  intentId: string;
  /** The human's words, verbatim. */
  message: string;
  /** Runtime-assigned scope (LOW | MEDIUM) — shown, never recomputed. */
  scope: RequestProposal['scope'];
  status: RequestStatus;
  createdAt: number;
  taskId: string | null;
  executor: string;
  target: RequestProposal['target'];
  uiState: ConfirmationUiState;
  /** The runtime still accepts a confirmation (PROPOSED with a live token). */
  canConfirm: boolean;
  canCancel: boolean;
  busy: boolean;
  outcome: ConfirmationOutcome | null;
  /** CONFIRMED only: HIGH approvals pending on the floor — decided separately. */
  pendingHighApprovals: number;
}

export interface ConfirmationSnapshot {
  loaded: boolean;
  loadError: boolean;
  /** Any confirm/cancel in flight — every decision button is disabled meanwhile. */
  busy: boolean;
  /** PROPOSED proposals: the floor is locked until the human decides. */
  pendingCount: number;
  /** Active (PROPOSED / CONFIRMED) first, then the most recent closed ones. */
  views: ProposalView[];
}

const ACTIVE: ReadonlySet<RequestStatus> = new Set(['PROPOSED', 'CONFIRMED']);

/** The card state for one proposal. The runtime's status always wins over
 *  what the UI last did: a proposal confirmed/cancelled/superseded elsewhere
 *  shows as such, whatever button was pressed here. */
export function deriveUiState(p: RequestProposal, inFlight: ConfirmationOp | undefined, outcome: ConfirmationOutcome | null): ConfirmationUiState {
  if (inFlight === 'confirm') return 'CONFIRMING';
  if (inFlight === 'cancel') return 'CANCELING';
  const failed = outcome && !outcome.ok ? outcome.code : null;
  switch (p.status) {
    case 'CONFIRMED': return 'CONFIRMED';
    case 'CANCELLED': return 'CANCELLED';
    case 'COMPLETED': return 'COMPLETED';
    case 'SUPERSEDED': return 'SUPERSEDED';
    case 'BLOCKED': return failed === 'STALE_PROPOSAL' ? 'STALE' : 'BLOCKED';
    case 'PROPOSED':
      if (failed === 'STALE_PROPOSAL') return 'STALE';
      return failed ? 'ERROR' : 'PENDING';
  }
  return 'ERROR';
}

export function createConfirmationController(port: ConfirmationPort, opts: { recentClosed?: number } = {}) {
  const recentClosed = opts.recentClosed ?? 3;
  let proposals: RequestProposal[] = [];
  let approvals: Approval[] = [];
  let loaded = false;
  let loadError = false;
  const inFlight = new Map<string, ConfirmationOp>();
  const outcomes = new Map<string, ConfirmationOutcome>();
  const listeners = new Set<() => void>();

  const compute = (): ConfirmationSnapshot => {
    const pendingHigh = approvals.filter((a) => a.status === 'pending' && a.risk === 'HIGH');
    const view = (p: RequestProposal): ProposalView => {
      const outcome = outcomes.get(p.id) ?? null;
      const op = inFlight.get(p.id);
      return {
        id: p.id, intentId: p.intentId, message: p.message, scope: p.scope, status: p.status,
        createdAt: p.createdAt, taskId: p.taskId, executor: p.executor, target: p.target,
        uiState: deriveUiState(p, op, outcome),
        canConfirm: !inFlight.size && p.status === 'PROPOSED' && !!p.token,
        canCancel: !inFlight.size && ACTIVE.has(p.status),
        busy: !!op,
        outcome,
        pendingHighApprovals: p.status === 'CONFIRMED'
          ? pendingHigh.filter((a) => a.createdAt >= (p.confirmedAt ?? p.createdAt)).length
          : 0
      };
    };
    const byNewest = [...proposals].sort((a, b) => b.createdAt - a.createdAt);
    const active = byNewest.filter((p) => ACTIVE.has(p.status));
    // A closed proposal the human just acted on stays visible so the result can be read.
    const closed = byNewest.filter((p) => !ACTIVE.has(p.status));
    const touched = closed.filter((p) => outcomes.has(p.id));
    const recent = [...touched, ...closed.filter((p) => !outcomes.has(p.id))].slice(0, Math.max(recentClosed, touched.length));
    return {
      loaded, loadError, busy: inFlight.size > 0,
      pendingCount: proposals.filter((p) => p.status === 'PROPOSED').length,
      views: [...active, ...recent].map(view)
    };
  };

  let snapshot = compute();
  const emit = () => { snapshot = compute(); for (const l of listeners) l(); };

  /** Re-read the runtime. The UI never edits a proposal locally. */
  async function refresh(): Promise<void> {
    try {
      const [r, a] = await Promise.all([port.requests(), port.approvals()]);
      proposals = Array.isArray(r) ? r : [];
      approvals = Array.isArray(a) ? a : [];
      loadError = false;
    } catch {
      loadError = true;
    }
    loaded = true;
    emit();
  }

  async function run(id: string, op: ConfirmationOp): Promise<RequestResult | null> {
    // One human decision at a time: a second click (same or other card) while
    // one is in flight is dropped here. The runtime's single-use token is the
    // real defence against replay; this only avoids sending it twice.
    if (inFlight.size) return null;
    const p = proposals.find((x) => x.id === id);
    if (!p) return null;
    if (op === 'confirm' && (p.status !== 'PROPOSED' || !p.token)) return null;
    if (op === 'cancel' && !ACTIVE.has(p.status)) return null;
    inFlight.set(id, op);
    outcomes.delete(id);
    emit();
    let res: RequestResult;
    try {
      res = op === 'confirm' ? await port.confirm(id, p.token as string) : await port.cancel(id);
      if (!res || typeof res !== 'object') res = { ok: false, code: 'IPC_ERROR', reason: 'no answer from the runtime' };
    } catch (e) {
      res = { ok: false, code: 'IPC_ERROR', reason: e instanceof Error ? e.message : String(e) };
    }
    inFlight.delete(id);
    outcomes.set(id, { op, ok: res.ok, code: res.ok ? null : res.code, reason: res.ok ? null : res.reason });
    if (res.ok) {
      const next = res.proposal;
      proposals = proposals.map((x) => (x.id === id ? next : x));
    }
    emit();
    // Whatever just happened, the runtime's list is what the card shows next.
    await refresh();
    return res;
  }

  return {
    getSnapshot: (): ConfirmationSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh,
    confirm: (id: string) => run(id, 'confirm'),
    cancel: (id: string) => run(id, 'cancel')
  };
}

export type ConfirmationController = ReturnType<typeof createConfirmationController>;

/** What Alicia says after a decision — an i18n key under lapitaya:alicia.confirmation.said.
 *  A confirmation is never worded as an approval: it lets the request go on to CIMA. */
export function aliciaLineKey(view: Pick<ProposalView, 'uiState' | 'outcome'>): string | null {
  const o = view.outcome;
  if (!o) return null;
  if (o.ok) return o.op === 'confirm' ? 'confirmed' : 'cancelled';
  if (view.uiState === 'STALE') return 'stale';
  if (o.code === 'NOT_CONFIRMABLE' || o.code === 'UNKNOWN_PROPOSAL') return 'changedElsewhere';
  return 'refused';
}
