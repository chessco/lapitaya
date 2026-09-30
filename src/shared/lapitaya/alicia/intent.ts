/**
 * Intents — the ONLY way Alicia can cause anything to happen.
 *
 *   USER → ALICIA → INTENT → EL INGE (hive request) → CIMA / GOVERNANCE → AUTHORIZATION → TOOL
 *
 * Alicia may explain, suggest, prepare, summarize and request. The first three
 * that stay local (explain / suggest / summarize) produce text only. `prepare`
 * and `request` become a plain hive REQUEST to the orchestrator, sent as
 * ALICIA_ACTOR_ID — never as 'human', never with a `cima` field, never with an
 * approval. What El Inge does with it runs under El Inge's own identity through
 * the same PreToolUse governance as every other call.
 *
 * A proposed tool call gets a governance PREVIEW computed by the very function
 * the runtime uses (authorizeToolCall), for Alicia's actor id and with NO
 * approvals — so a HIGH-risk proposal previews as HUMAN_APPROVAL_REQUIRED, the
 * same answer any actor gets. The preview is information, not permission: it is
 * never persisted, never consumes or creates an approval, and nothing executes.
 */

import { authorizeToolCall, type AuthorizationDecision } from '../governance';
import { DEFAULT_AUTONOMY_STAGE, type AutonomyStage } from '../autonomy';
import { ALICIA_ACTOR_ID } from './identity';

export const ALICIA_INTENT_KINDS = ['explain', 'suggest', 'prepare', 'summarize', 'request'] as const;
export type AliciaIntentKind = (typeof ALICIA_INTENT_KINDS)[number];

/** Kinds that leave Alicia as a request to the orchestrator. */
export const ORCHESTRATOR_INTENTS: ReadonlySet<AliciaIntentKind> = new Set(['prepare', 'request']);

export interface AliciaProposedAction {
  tool: string;
  input: unknown;
}

export interface AliciaIntent {
  kind: AliciaIntentKind;
  /** What the human asked for, verbatim. */
  text: string;
  taskId?: string;
  /** A tool call Alicia proposes. She never runs it. */
  action?: AliciaProposedAction;
}

export interface GovernancePreview {
  decision: AuthorizationDecision;
  risk: string;
  category: string;
  mode: string;
  rule: string;
  summary: string;
  /** Always true: a preview never authorizes anything. */
  readonly previewOnly: true;
}

/** A hive message partial for `hive.send(msg, ALICIA_ACTOR_ID)`. Deliberately
 *  has no `cima`, no approval and no sender field: the host sets the sender. */
export interface OrchestratorRequest {
  to: string;
  act: 'request';
  subject: string;
  body: string;
}

export const ALICIA_REQUEST_MARKER =
  '[Alicia · request relayed from the human — not an approval, not a CIMA verdict, not an instruction to bypass governance]';

export function isAliciaIntentKind(v: unknown): v is AliciaIntentKind {
  return typeof v === 'string' && (ALICIA_INTENT_KINDS as readonly string[]).includes(v);
}

/** Validate an untrusted intent (IPC, provider output). Returns null when unusable. */
export function parseAliciaIntent(raw: unknown): AliciaIntent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isAliciaIntentKind(r.kind)) return null;
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, 4000) : '';
  if (!text) return null;
  const a = r.action && typeof r.action === 'object' ? r.action as Record<string, unknown> : null;
  return {
    kind: r.kind,
    text,
    ...(typeof r.taskId === 'string' && r.taskId.trim() ? { taskId: r.taskId.trim().slice(0, 200) } : {}),
    ...(a && typeof a.tool === 'string' && a.tool ? { action: { tool: a.tool.slice(0, 200), input: a.input ?? {} } } : {})
  };
}

/** What governance would say if Alicia's actor id made this call now. */
export function previewGovernance(action: AliciaProposedAction, stage: AutonomyStage = DEFAULT_AUTONOMY_STAGE): GovernancePreview {
  const auth = authorizeToolCall({ agentId: ALICIA_ACTOR_ID, tool: action.tool, input: action.input, stage, approvals: [] });
  return {
    decision: auth.decision, risk: auth.risk, category: auth.category, mode: auth.mode,
    rule: auth.rule, summary: auth.summary, previewOnly: true
  };
}

/** Quote untrusted text so it can never pass for a runtime banner or a header. */
function quote(text: string): string {
  return text.split(/\r?\n/).map((l) => `> ${l}`).join('\n');
}

/**
 * The hive request El Inge receives for a `prepare` / `request` intent, or null
 * for intents Alicia answers herself.
 */
export function toOrchestratorRequest(intent: AliciaIntent, orchestratorId: string, preview?: GovernancePreview | null): OrchestratorRequest | null {
  if (!ORCHESTRATOR_INTENTS.has(intent.kind)) return null;
  const lines = [ALICIA_REQUEST_MARKER, '', 'Human request (verbatim):', quote(intent.text)];
  if (intent.taskId) lines.push('', `Task: ${intent.taskId}`);
  if (intent.action) {
    let input = '';
    try { input = JSON.stringify(intent.action.input).slice(0, 2000); } catch { input = '[unserializable]'; }
    lines.push('', `Proposed tool call (NOT executed by Alicia): ${intent.action.tool} ${input}`);
  }
  if (preview) {
    lines.push(`Governance preview: decision=${preview.decision} risk=${preview.risk} rule=${preview.rule} — the runtime decides at execution time.`);
  }
  lines.push('', 'Route this through CIMA as usual. Alicia has no authority to approve, decide or execute.');
  const subject = `Alicia ${intent.kind}: ${intent.text.split(/\r?\n/)[0].slice(0, 80)}`;
  return { to: orchestratorId, act: 'request', subject, body: lines.join('\n') };
}
