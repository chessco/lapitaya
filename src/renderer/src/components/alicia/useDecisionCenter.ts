import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Approval } from '@shared/lapitaya/governance';
import type { ObservabilityView } from '@shared/lapitaya/alicia/observability';
import type { ConfirmationSnapshot } from './confirmationController';
import { buildDecisionCenter, createApprovalController, type ApprovalController, type ApprovalPort, type DecisionCenterModel } from './decisionCenter';
import { markDecisionCenterMounted } from './decisionCenterPresence';

/**
 * La Pitaya Alicia v0.7 — the Decision Center's IPC. The existing human
 * channels only:
 *   - HIGH approval: lapitaya:decide (by 'human' fixed in main; pending-only, one-shot)
 *   - pending HIGH facts: lapitaya:observability (v0.6 read-only projection)
 * REQUEST confirmation stays on the v0.5 controller (lapitaya:confirmRequest /
 * lapitaya:cancelRequest). Nothing here can execute, authorize, classify or
 * write the ledger.
 */
export function ipcApprovalPort(): ApprovalPort {
  return { decide: (id, approve) => window.cth.lapitayaDecide(id, approve) };
}

/** Pending HIGH approvals as the v0.5 REQUEST card needs them (status/risk/time) —
 *  from the read-only projection, so the renderer never asks for the approvals'
 *  raw summaries (commands) or fingerprints. */
export async function fetchPendingHighApprovals(): Promise<Pick<Approval, 'id' | 'status' | 'risk' | 'createdAt'>[]> {
  const view = await window.cth.lapitayaObservability();
  return (view.pendingApprovals ?? []).flatMap((o) => (o.approvalId && o.risk
    ? [{ id: o.approvalId, status: 'pending' as const, risk: o.risk, createdAt: o.timestamp ?? 0 }] : []));
}

/** Pending human decisions (REQUEST confirmations + HIGH approvals), for the tab badge. */
export async function fetchPendingDecisionCount(): Promise<number> {
  const [requests, view] = await Promise.all([window.cth.lapitayaRequests(), window.cth.lapitayaObservability()]);
  return requests.filter((p) => p.status === 'PROPOSED').length + (view.pendingApprovals?.length ?? 0);
}

export function useDecisionCenter(requests: ConfirmationSnapshot, view: ObservabilityView | null): {
  model: DecisionCenterModel; controller: ApprovalController;
} {
  const ref = useRef<ApprovalController | null>(null);
  if (!ref.current) ref.current = createApprovalController(ipcApprovalPort());
  const controller = ref.current;
  const approvals = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => markDecisionCenterMounted(), []);
  return { model: buildDecisionCenter(requests, view, approvals), controller };
}
