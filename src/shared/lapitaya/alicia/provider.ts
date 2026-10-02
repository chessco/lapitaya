/**
 * AliciaProvider — the model boundary. INTERFACE ONLY in v0.4.
 *
 * The harness's existing provider layer (AgentProvider: claude, codex, gemini,
 * …) launches CLI agents in a PTY; it is not a request/response model API, so
 * Alicia cannot reuse it. Nor may she couple to one vendor: the UI talks to
 * AliciaConversation, the conversation talks to this port, and a host decides
 * which provider sits behind it.
 *
 * Provider output is UNTRUSTED. Text is shown as text; suggested actions are
 * re-parsed with parseAliciaIntent() and go through El Inge and governance;
 * citations are filtered with groundedCitations(). A provider has no tool
 * access through Alicia, because Alicia has none to give.
 */

import type { AliciaContext } from './context';
import type { AliciaCitation } from './conversation';

export interface AliciaProviderRequest {
  /** The locale the answer must be written in (Alicia uses uiLocale for chat). */
  locale: string;
  context: AliciaContext;
  messages: readonly { role: 'user' | 'assistant'; text: string }[];
  /** The fixed boundary rules, sent with every request. */
  system: string;
}

export interface AliciaProviderResponse {
  text: string;
  citations?: readonly AliciaCitation[];
  /** Raw, untrusted proposals — parse with parseAliciaIntent(). */
  suggestedActions?: readonly unknown[];
}

export interface AliciaProvider {
  /** e.g. 'anthropic', 'openai', 'local'. Never branched on by governance. */
  readonly id: string;
  readonly model: string;
  generate(request: AliciaProviderRequest): Promise<AliciaProviderResponse>;
}

/** The rules a provider is always given. Enforcement does NOT depend on the
 *  model obeying them — Alicia has no execution path to misuse. */
export const ALICIA_SYSTEM_BOUNDARY =
  'You are Alicia, the AI companion of La Pitaya (PitayaCode, Sonora, Mexico). You explain system state, ' +
  'agent results, evidence and governance decisions to the human. You are not a CIMA agent and not the ' +
  'orchestrator: El Inge orchestrates, the runtime decides. You cannot approve, decide, execute tools or ' +
  'change CIMA state. Never invent evidence; cite only records present in the context. Keep technical ' +
  'identifiers (phase, verdict, risk, rule, decision) exactly as given.';
