/**
 * Alicia's side of the intent boundary (v0.4.1): turn what the human said into
 * a structured AliciaIntent — and nothing more.
 *
 *   USER → ALICIA → AliciaIntent ──ports.submitIntent──▶ runtime intent boundary
 *
 * Alicia labels the intent with the shared deterministic classifier so her own
 * UI can react, but the label is a CLAIM: the runtime re-classifies every
 * intent, owns the risk and the decision, and is the only one that can forward
 * it to El Inge. This module imports no governance function, builds no hive
 * message and has no way to execute (asserted structurally by the v0.4.1 tests).
 */

import { classifyIntentMessage, type AliciaIntent, type IntentTarget } from '../intent';
import type { RiskLevel } from '../autonomy';
import { ALICIA_ACTOR_ID } from './identity';

export interface AliciaIntentOptions {
  id: string;
  now: number;
  taskId?: string | null;
  phase?: string | null;
  uiLocale?: string | null;
  target?: IntentTarget | null;
  /** A risk the caller wants to suggest. The runtime never takes it as given. */
  suggestedRisk?: RiskLevel | null;
}

export function createAliciaIntent(message: string, o: AliciaIntentOptions): AliciaIntent {
  const text = message.trim().slice(0, 4000);
  return {
    id: o.id,
    source: ALICIA_ACTOR_ID,
    type: classifyIntentMessage(text, o.target).type,
    message: text,
    context: {
      ...(o.taskId ? { taskId: o.taskId } : {}),
      ...(o.phase ? { phase: o.phase } : {}),
      ...(o.uiLocale ? { uiLocale: o.uiLocale } : {})
    },
    requestedBy: 'human',
    target: o.target ? { ...o.target } : null,
    risk: o.suggestedRisk ?? null,
    status: 'RECEIVED',
    createdAt: o.now
  };
}
