/**
 * CIMA — La Pitaya's operating methodology.
 *
 * Core loop:       BUILD → TEST → LEARN → ITERATE
 * Full workflow:   CONTEXT → ARCHITECT → BUILD → TEST → AUDIT → LEARN → DECISION → ITERATE
 *
 * Phase identifiers are STABLE, UPPERCASE and never translated — code, hive
 * messages and evidence files use them verbatim. Only the visible label is
 * localized (i18n key `lapitaya.cima.phases.<PHASE>`).
 *
 * This module is the minimal, dependency-free contract: phase order, the
 * Builder != Auditor rule and the Evidence First rule as pure functions. It is
 * deliberately NOT a workflow engine — the upstream hive (El Inge + inboxes +
 * tasks.json) still does the routing. See docs/CIMA/.
 */

/** The four-step core loop. */
export const CIMA_CORE = ['BUILD', 'TEST', 'LEARN', 'ITERATE'] as const;

/** The full workflow, in order. ITERATE loops back to CONTEXT. */
export const CIMA_WORKFLOW = [
  'CONTEXT', 'ARCHITECT', 'BUILD', 'TEST', 'AUDIT', 'LEARN', 'DECISION', 'ITERATE'
] as const;

export type CimaPhase = (typeof CIMA_WORKFLOW)[number];
export type CimaCorePhase = (typeof CIMA_CORE)[number];

export function isCimaPhase(value: unknown): value is CimaPhase {
  return typeof value === 'string' && (CIMA_WORKFLOW as readonly string[]).includes(value);
}

/** The phase after `phase` in the full workflow (ITERATE wraps to CONTEXT). */
export function nextPhase(phase: CimaPhase): CimaPhase {
  const i = CIMA_WORKFLOW.indexOf(phase);
  return CIMA_WORKFLOW[(i + 1) % CIMA_WORKFLOW.length];
}

/** The four principles, as stable ids (docs/CIMA/PRINCIPLES.md). */
export const CIMA_PRINCIPLES = [
  'BUILDER_NOT_AUDITOR', 'EVIDENCE_FIRST', 'HUMAN_GOVERNANCE', 'PROGRESSIVE_AUTONOMY'
] as const;
export type CimaPrinciple = (typeof CIMA_PRINCIPLES)[number];

// ─── Evidence First ─────────────────────────────────────────────────────────

export type EvidenceKind =
  | 'test-output' | 'command-output' | 'exit-code' | 'build-output' | 'audit-findings' | 'reproduction';

/** One piece of evidence. `raw` is the ORIGINAL output — never translated,
 *  summarized or reformatted. Explanations go in `note`, in any language. */
export interface Evidence {
  kind: EvidenceKind;
  /** The command or check that produced it, verbatim. */
  source: string;
  /** Unmodified output (or the exit code as a string). */
  raw: string;
  exitCode?: number;
  /** Optional human-language explanation. Never replaces `raw`. */
  note?: string;
}

export type Verdict = 'PASS' | 'PASS_WITH_OBSERVATIONS' | 'FAIL';

/** Evidence First: a verdict of PASS* is only admissible with at least one
 *  piece of evidence that has non-empty raw output. FAIL needs no proof. */
export function isVerdictBacked(verdict: Verdict, evidence: readonly Evidence[]): boolean {
  if (verdict === 'FAIL') return true;
  return evidence.some((e) => e.raw.trim().length > 0);
}

/** A successful exit is 0; a check with a non-zero exit cannot back PASS. */
export function evidenceAllowsPass(evidence: readonly Evidence[]): boolean {
  if (!evidence.some((e) => e.raw.trim().length > 0)) return false;
  return evidence.every((e) => e.exitCode === undefined || e.exitCode === 0);
}

// ─── Builder != Auditor ──────────────────────────────────────────────────────

export interface ApprovalRequest {
  /** Hive id of the agent that implemented the change. */
  builderId: string;
  /** Hive id of the agent trying to approve / close it. */
  approverId: string;
}

/** Builder != Auditor: whoever built a change may never approve it. Ids are
 *  compared case-insensitively and trimmed; an empty id can never approve. */
export function canApprove({ builderId, approverId }: ApprovalRequest): boolean {
  const b = builderId.trim().toLowerCase();
  const a = approverId.trim().toLowerCase();
  if (!a) return false;
  return a !== b;
}
