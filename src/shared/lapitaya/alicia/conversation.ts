/**
 * Conversation boundary — INTERFACES ONLY in v0.4.
 *
 * Fixes the shape of a turn so a future implementation (and any provider) plugs
 * in without touching CIMA, the hive or the UI. Explicitly NOT here: memory,
 * vector search / RAG, a personality engine, voice, multimodal input, planning.
 *
 * Two guarantees are defined now because they are about governance, not about
 * conversation quality:
 *   - suggested actions are AliciaIntents: they go through toOrchestratorRequest
 *     and governance like anything else, never straight to a tool;
 *   - citations must point at evidence the runtime already recorded
 *     (groundedCitations) — a response cannot bring its own evidence.
 */

import type { AliciaContext } from './context';
import type { AliciaIntent } from './intent';

export interface AliciaUserMessage {
  id: string;
  text: string;
  ts: number;
  /** The uiLocale the human wrote in. */
  locale: string;
}

/** A pointer to something the runtime recorded. Alicia cites; she never creates. */
export interface AliciaCitation {
  kind: 'cima-record' | 'evidence' | 'governance' | 'approval' | 'task';
  /** The id in its source (message id, trace id, approval id, task id). */
  ref: string;
  taskId?: string;
}

export interface AliciaAssistantResponse {
  id: string;
  text: string;
  locale: string;
  citations: readonly AliciaCitation[];
  /** Proposals only — each still has to go through El Inge and governance. */
  suggestedActions: readonly AliciaIntent[];
  /** Ids of notifications this answer refers to. */
  notificationIds: readonly string[];
}

export interface AliciaTurn {
  message: AliciaUserMessage;
  context: AliciaContext;
  response: AliciaAssistantResponse;
}

/** What a conversation implementation will provide. Not implemented in v0.4. */
export interface AliciaConversation {
  respond(message: AliciaUserMessage, context: AliciaContext): Promise<AliciaAssistantResponse>;
}

/** Keep only citations whose ref is known to the runtime-backed context. */
export function groundedCitations(citations: readonly AliciaCitation[], knownRefs: ReadonlySet<string>): { grounded: AliciaCitation[]; rejected: AliciaCitation[] } {
  const grounded: AliciaCitation[] = [];
  const rejected: AliciaCitation[] = [];
  for (const c of citations) (knownRefs.has(c.ref) ? grounded : rejected).push(c);
  return { grounded, rejected };
}

/** Every ref the context can vouch for: record/message ids, trace ids, approval ids, task ids. */
export function knownRefs(context: AliciaContext): Set<string> {
  const refs = new Set<string>();
  for (const e of context.recentEvents) {
    if (e.ref) refs.add(e.ref);
    if (e.taskId) refs.add(e.taskId);
    if (e.technical?.approvalId) refs.add(e.technical.approvalId);
    for (const ev of e.evidence ?? []) if (ev.traceId) refs.add(ev.traceId);
  }
  if (context.currentTask) refs.add(context.currentTask.id);
  return refs;
}
