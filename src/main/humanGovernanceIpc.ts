import type { HumanContext } from '../shared/lapitaya/identity';

/**
 * La Pitaya Alicia v0.8 — the human governance IPC handlers, as main wires them.
 *
 * Every handler takes ONLY what the human's UI can legitimately say (an id, a
 * boolean, the single-use token). Any extra argument — a userId, approvedBy,
 * confirmedBy, an identity object — is ignored: WHO decided is resolved from
 * the trusted sender (`identity.resolve`) and handed to the EXISTING runtime
 * method, which validates it, records it beside the decision and stays the
 * authority for everything else (state, token, one-shot, risk, autonomy).
 *
 * An untrusted sender is never turned into a human: confirm goes to the runtime
 * as `by: 'untrusted-sender'` so the existing gate refuses it (and records the
 * denial); cancel/complete are refused; decide returns null (nothing decided).
 */

/** The slice of CimaRuntimeService the human channel uses — all existing methods but `attributeRequest`. */
export interface HumanGovernanceRuntime {
  decide(id: string, approve: boolean, by?: string, human?: unknown): { id: string; status: string; decidedAt?: number; decidedBy?: string } | null;
  confirmRequest(proposalId: unknown, ctx?: { by?: unknown; token?: unknown; intentId?: unknown; human?: unknown }): unknown;
  cancelRequest(proposalId: unknown, by: unknown, human?: unknown): unknown;
  completeRequest(proposalId: unknown, by: unknown, human?: unknown): unknown;
  attributeRequest(proposalId: unknown, human: unknown): boolean;
}

export interface HumanGovernanceDeps {
  runtime: HumanGovernanceRuntime;
  identity: { resolve(evt: unknown): HumanContext | null; identity(): { id: string; displayName: string } };
}

const UNTRUSTED = { ok: false, code: 'NOT_AUTHORIZED', reason: 'untrusted sender' } as const;

export function createHumanGovernanceHandlers({ runtime, identity }: HumanGovernanceDeps) {
  return {
    /** lapitaya:decide — the outcome only (no summary, no fingerprint), plus who decided. */
    decide(evt: unknown, id: unknown, approve: unknown) {
      if (typeof id !== 'string' || typeof approve !== 'boolean') return null;
      const ctx = identity.resolve(evt);
      if (!ctx) return null;
      const a = runtime.decide(id, approve, 'human', ctx);
      return a ? { id: a.id, status: a.status, decidedAt: a.decidedAt ?? null, decidedBy: a.decidedBy ?? null } : null;
    },
    confirmRequest(evt: unknown, id: unknown, token: unknown) {
      const ctx = identity.resolve(evt);
      return runtime.confirmRequest(id, ctx ? { by: 'human', token, human: ctx } : { by: 'untrusted-sender', token });
    },
    cancelRequest(evt: unknown, id: unknown) {
      const ctx = identity.resolve(evt);
      return ctx ? runtime.cancelRequest(id, 'human', ctx) : UNTRUSTED;
    },
    completeRequest(evt: unknown, id: unknown) {
      const ctx = identity.resolve(evt);
      return ctx ? runtime.completeRequest(id, 'human', ctx) : UNTRUSTED;
    },
    /** After alicia:submit opened a proposal: record WHO submitted it (write-once; changes no state). */
    attributeSubmitted(evt: unknown, proposalId: unknown): boolean {
      const ctx = identity.resolve(evt);
      return !!ctx && runtime.attributeRequest(proposalId, ctx);
    },
    /** lapitaya:identity — read-only: who the Decision Center is acting for. */
    whoAmI(evt: unknown) {
      const ctx = identity.resolve(evt);
      return ctx ? { id: ctx.human.id, displayName: ctx.human.displayName, session: ctx.session } : null;
    }
  };
}
export type HumanGovernanceHandlers = ReturnType<typeof createHumanGovernanceHandlers>;

export type RendererSendDecision =
  | { ok: true; sender: string }
  | { ok: false; code: 'SENDER_NOT_PERMITTED' | 'HUMAN_IDENTITY_REQUIRED'; error: string };

/**
 * v0.14 — WHO a message sent from the renderer is from. The renderer is not a trusted actor: it can
 * speak as exactly one identity, the human, and only when main resolves a trusted human context for
 * the sending window. Every other identity (an agent, the orchestrator, Alicia, "system" by name) is
 * refused, and a `from` inside the payload that disagrees with the resolved sender is a forgery.
 * (A send with no `from` at all is the harness relaying on the human's behalf, as before.)
 */
export function resolveRendererSender(
  identity: { resolve(evt: unknown): HumanContext | null },
  evt: unknown,
  from: unknown,
  partial: unknown
): RendererSendDecision {
  const claimedInPayload = partial && typeof partial === 'object' ? (partial as { from?: unknown }).from : undefined;
  const requested = typeof from === 'string' ? from : undefined;
  const wantsHuman = requested === 'human' || claimedInPayload === 'human';
  if (requested !== undefined && requested !== 'human') {
    return { ok: false, code: 'SENDER_NOT_PERMITTED', error: `SENDER_NOT_PERMITTED — the renderer may only send as the human (not "${requested.slice(0, 40)}")` };
  }
  if (claimedInPayload !== undefined && claimedInPayload !== null && claimedInPayload !== '' && claimedInPayload !== (requested ?? 'system')) {
    return { ok: false, code: 'SENDER_NOT_PERMITTED', error: 'SENDER_NOT_PERMITTED — the message names a sender different from the one main resolved' };
  }
  if (wantsHuman && !identity.resolve(evt)) {
    return { ok: false, code: 'HUMAN_IDENTITY_REQUIRED', error: 'HUMAN_IDENTITY_REQUIRED — human message sender requires trusted human context' };
  }
  return { ok: true, sender: requested ?? 'system' };
}
