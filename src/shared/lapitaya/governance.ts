/**
 * Runtime governance — the authorization decision for ONE tool call.
 *
 *   risk classification (toolRisk.ts)
 *          ↓
 *   autonomy policy (autonomy.ts: modeFor)
 *          ↓
 *   authorization decision (this file)
 *          ↓
 *   execute (ALLOW) · execute + log (SUPERVISED) · deny until a human approves (HUMAN_APPROVAL_REQUIRED)
 *
 * The decision is computed in the harness's main process at the PreToolUse
 * hook and returned to the CLI as a hook decision, so it holds regardless of
 * the agent's prompt and regardless of the CLI's own permission mode: with
 * `autoMode: true` the CLI skips its OWN prompts, but a PreToolUse `deny` still
 * stops the call. Precedence:
 *
 *   USER / SYSTEM GOVERNANCE → AUTONOMY POLICY → AGENT → TOOL → ACTION
 *
 * Pure: approvals are passed in; persistence lives in src/main/cimaRuntime.ts.
 */
import type { DecisionOwner } from './identity';

import { modeFor, DEFAULT_AUTONOMY_STAGE, type AutonomyMode, type AutonomyStage, type RiskLevel, type ActionCategory } from './autonomy';
import { classifyToolCall, type ToolCallContext, type ToolRisk } from './toolRisk';
import { ACTION_RISK } from './autonomy';

export type AuthorizationDecision =
  /** LOW: runs with no human involvement. */
  | 'ALLOW'
  /** MEDIUM: runs, is logged as supervised and surfaced to the human live. */
  | 'SUPERVISED'
  /** HIGH (or anything under HUMAN_CONTROLLED): denied until a human approves. */
  | 'HUMAN_APPROVAL_REQUIRED'
  /** A previously-approved HIGH call, consumed now (one-shot). */
  | 'APPROVED'
  /** Explicit refusal: authorization could not be established (state, risk
   *  classification or ledger unavailable) or a runtime gate said no. v0.3:
   *  every failure to authorize ends here — never in ALLOW. */
  | 'DENY';

/** The decisions that let a call run. Anything else — including a value that
 *  is not an AuthorizationDecision at all — means the call does not run. */
export const EXECUTABLE_DECISIONS: ReadonlySet<string> = new Set(['ALLOW', 'SUPERVISED', 'APPROVED']);

export function isExecutable(decision: unknown): boolean {
  return typeof decision === 'string' && EXECUTABLE_DECISIONS.has(decision);
}

export interface Approval {
  id: string;
  agentId: string;
  tool: string;
  fingerprint: string;
  category: ActionCategory;
  risk: RiskLevel;
  summary: string;
  /** `expired` (TTL) and `invalid` (legacy unbound, or its seal/binding does not verify) never authorize. */
  status: 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired' | 'invalid';
  createdAt: number;
  /** v0.14: after this instant the approval can be neither decided nor used (pending AND approved). */
  expiresAt?: number;
  consumedAt?: number;
  /** v0.14: the authorization subject this approval is bound to (SHA-256 over the canonical subject). */
  binding?: { v: number; alg: 'sha256'; fingerprint: string; subject: unknown };
  /** v0.14: HMAC-SHA256 seal over the fields that decide usability (written by the runtime only). */
  seal?: string;
  invalidReason?: string;
  decidedAt?: number;
  decidedBy?: string;
  /** v0.8: the trusted human who decided (runtime-recorded; write-once). */
  decidedOwner?: DecisionOwner;
}

export interface AuthorizationInput {
  agentId: string;
  tool: string;
  input: unknown;
  stage?: AutonomyStage;
  /** Approvals the human has granted and that are not consumed yet. */
  approvals?: readonly Approval[];
  ctx?: ToolCallContext;
  /** Test seam: replaces the risk classifier. */
  classify?: (tool: string, input: unknown, ctx?: ToolCallContext) => ToolRisk;
  /** v0.14: the runtime-computed authorization fingerprint of THIS call (src/main/authBinding.ts).
   *  Without it no approval can match: the legacy FNV fingerprint never authorizes. */
  authFingerprint?: string;
  now?: number;
}

export interface Authorization {
  decision: AuthorizationDecision;
  mode: AutonomyMode;
  risk: RiskLevel;
  category: ActionCategory;
  summary: string;
  rule: string;
  /** LEGACY correlation id (FNV-32). Links a decision to its trace for the observability projection;
   *  it is NOT an authorization binding and never authorizes anything (v0.14). */
  fingerprint: string;
  /** v0.14: SHA-256 authorization fingerprint — the only thing an approval is matched on. */
  authFingerprint?: string;
  /** v0.14: SHA-256 of the call part alone (agent, provider, tool, targets, input digest). */
  callFingerprint?: string;
  /** Set when an approval was consumed by this call. */
  approvalId?: string;
  /** What the agent is told when the call is denied. */
  reason?: string;
}

/** Stable, dependency-free hash (FNV-1a, 32-bit, hex). Identifies "the same
 *  call" so an approval covers exactly the call the human saw — not a different
 *  command sneaked in afterwards. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Canonical JSON (sorted keys) so key order never changes a fingerprint. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function toolCallFingerprint(agentId: string, tool: string, input: unknown): string {
  return fnv1a(`${agentId}\u0000${tool}\u0000${canonical(input)}`);
}

/** A DENY authorization — the single shape every fail-closed path returns. */
export function denyAuthorization(code: string, detail: string, agentId: string, tool: string, input: unknown): Authorization {
  let fingerprint = '00000000';
  try { fingerprint = toolCallFingerprint(agentId, tool, input); } catch { /* keep placeholder */ }
  return {
    decision: 'DENY', mode: 'HUMAN_APPROVAL', risk: 'HIGH', category: 'irreversible',
    summary: detail.slice(0, 300), rule: code, fingerprint,
    reason: `${code} — La Pitaya could not authorize this call, so it was NOT executed (${detail}). Report it to the human; do not work around it.`
  };
}

function validRisk(cls: unknown): cls is ToolRisk {
  if (!cls || typeof cls !== 'object') return false;
  const c = cls as Partial<ToolRisk>;
  return typeof c.category === 'string' && c.category in ACTION_RISK
    && ACTION_RISK[c.category as keyof typeof ACTION_RISK] === c.risk
    && typeof c.summary === 'string' && typeof c.rule === 'string';
}

export function authorizeToolCall(a: AuthorizationInput): Authorization {
  // Risk classification must succeed and be coherent; otherwise nothing runs.
  let cls: ToolRisk;
  try {
    const raw = (a.classify ?? classifyToolCall)(a.tool, a.input, a.ctx);
    if (!validRisk(raw)) return denyAuthorization('RISK_CLASSIFICATION_UNAVAILABLE', `invalid classification for ${a.tool}`, a.agentId, a.tool, a.input);
    cls = raw;
  } catch (e) {
    return denyAuthorization('RISK_CLASSIFICATION_UNAVAILABLE', `classifier failed for ${a.tool}: ${String(e).slice(0, 120)}`, a.agentId, a.tool, a.input);
  }
  const stage = a.stage ?? DEFAULT_AUTONOMY_STAGE;
  const mode = modeFor(cls.category, stage);
  const fingerprint = toolCallFingerprint(a.agentId, a.tool, a.input);
  const base = { mode, risk: cls.risk, category: cls.category, summary: cls.summary, rule: cls.rule, fingerprint };

  if (mode === 'AUTO') return { ...base, decision: 'ALLOW' };
  if (mode === 'SUPERVISED') return { ...base, decision: 'SUPERVISED' };

  // HUMAN_APPROVAL: only an explicit, matching, unconsumed approval lets it run.
  const now = a.now ?? Date.now();
  const approval = a.authFingerprint ? (a.approvals ?? []).find((x) =>
    x.status === 'approved' && x.agentId === a.agentId && !!x.binding && x.binding.fingerprint === a.authFingerprint
    && (x.expiresAt === undefined || now <= x.expiresAt)) : undefined;
  if (approval) return { ...base, decision: 'APPROVED', approvalId: approval.id };
  return {
    ...base,
    decision: 'HUMAN_APPROVAL_REQUIRED',
    reason:
      `HUMAN_APPROVAL_REQUIRED — La Pitaya governance blocked this ${cls.risk}-risk action ` +
      `(${cls.category}: ${cls.summary}). It was NOT executed. The human has been asked to approve it; ` +
      'do not work around this block. If they approve, retry the IDENTICAL call; otherwise continue without it.'
  };
}
