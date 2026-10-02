/**
 * La Pitaya CIMA v0.15 — governance event integrity: shared vocabulary (pure; no fs, no crypto).
 *
 * The runtime's verdict about its own governance state is ONE of four statuses, and — separately — where it
 * stands in the recovery lifecycle. Alicia and the UI show these values; they never compute or repair them.
 */

/** Version of the ledger event envelope written by v0.15. Lines without it are LEGACY (v0.14 and older). */
export const LEDGER_SCHEMA_VERSION = 2;

export const GOVERNANCE_HEALTH = ['HEALTHY', 'CORRUPTED', 'INCONSISTENT', 'UNAVAILABLE'] as const;
/**
 *  HEALTHY       — chain, anchor, state files and state/event reconciliation all verify.
 *  CORRUPTED     — the evidence itself is damaged (malformed/truncated/altered/reordered/missing events, bad anchor,
 *                  unreadable state file). Governance fails closed.
 *  INCONSISTENT  — the evidence is intact but a state file claims more than the events justify. Fails closed.
 *  UNAVAILABLE   — the runtime cannot check (no lock, no key, no hive). Fails closed.
 */
export type GovernanceHealth = (typeof GOVERNANCE_HEALTH)[number];

export const RECOVERY_STATES = ['HEALTHY', 'CORRUPTED', 'RECOVERY_REQUIRED', 'RECOVERED'] as const;
/**
 *  HEALTHY            — nothing detected, nothing recovered.
 *  CORRUPTED          — damage detected in THIS verification; not yet recorded as needing an operator.
 *  RECOVERY_REQUIRED  — detection is recorded (governance-recovery.json); only an explicit operator recovery clears it.
 *  RECOVERED          — an operator recovery was performed and the result verifies (history stays visible).
 */
export type RecoveryState = (typeof RECOVERY_STATES)[number];

export type IntegrityCode =
  // evidence damage (CORRUPTED)
  | 'MALFORMED_JSON' | 'TRUNCATED_TAIL' | 'INVALID_SCHEMA' | 'UNKNOWN_SCHEMA' | 'LEGACY_AFTER_CHAIN'
  | 'DUPLICATE_EVENT_ID' | 'SEQUENCE_GAP' | 'SEQUENCE_REGRESSION' | 'SEQUENCE_DUPLICATE'
  | 'PREVIOUS_HASH_MISMATCH' | 'EVENT_HASH_MISMATCH' | 'EVENT_MAC_INVALID' | 'BOUNDARY_MISMATCH'
  | 'ANCHOR_MISSING' | 'ANCHOR_INVALID' | 'ANCHOR_MISMATCH' | 'ANCHOR_TRUNCATION'
  | 'STATE_FILE_CORRUPTED' | 'LEDGER_UNREADABLE'
  | 'TRACE_MISSING' | 'TRACE_HASH_MISMATCH' | 'TRACE_MALFORMED'
  // state/event disagreement (INCONSISTENT)
  | 'INVALID_TRANSITION' | 'PROPOSAL_STATE_MISMATCH' | 'PROPOSAL_MISSING' | 'PROPOSAL_UNEVIDENCED'
  | 'APPROVAL_STATE_MISMATCH' | 'APPROVAL_UNEVIDENCED' | 'HUMAN_OWNER_INVALID' | 'AUTHORIZATION_LINK_INVALID'
  // cannot check (UNAVAILABLE)
  | 'LOCK_UNAVAILABLE' | 'KEY_UNAVAILABLE' | 'NO_HIVE'
  // informational (never block)
  | 'LEGACY_UNVERIFIED' | 'TRACE_UNCOMMITTED' | 'STATE_BEHIND_EVENTS' | 'STATE_UNEVIDENCED_REDUCED' | 'ANCHOR_BEHIND';

export type IntegritySeverity = 'error' | 'warning';

export interface IntegrityFinding {
  code: IntegrityCode;
  severity: IntegritySeverity;
  /** The file the finding is about (`cima-ledger.jsonl`, `proposals.json`, …). */
  file: string;
  detail: string;
  /** Event sequence the finding is about, when it has one. */
  sequence?: number;
  /** 1-based line of the ledger, when it has one. */
  line?: number;
}

export interface LedgerFacts {
  /** v0.15 events verified (the chain). */
  events: number;
  /** Highest verified sequence (0 = empty chain). */
  headSequence: number;
  /** Hash of the last verified event (the genesis hash for an empty chain). */
  headHash: string;
  /** Lines written by v0.14 and older: trusted as found, committed by the migration boundary, never proven. */
  legacyEvents: number;
  legacyUnverified: boolean;
}

export interface GovernanceVerification {
  status: GovernanceHealth;
  recovery: RecoveryState;
  findings: IntegrityFinding[];
  ledger: LedgerFacts;
  checkedAt: number;
  /** `incremental` re-verified only what was appended since the last verification of this process. */
  mode: 'incremental' | 'full';
}

/** What Alicia may show about governance health: enumerated values and codes only — never free text. */
export interface GovernanceHealthView {
  status: GovernanceHealth;
  recovery: RecoveryState;
  /** Distinct blocking finding codes (≤ 10), most relevant first. */
  codes: IntegrityCode[];
  headSequence: number;
  legacyUnverified: boolean;
}

// ─── REQUEST state machine (shared by the runtime's verification and its tests) ─────────────────────────

/** Allowed status changes of a REQUEST proposal, as ledger transitions. `REVALIDATED` and
 *  `CONFIRMATION_DENIED` record a step, not a status change. */
export const REQUEST_TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  CONFIRMED: ['PROPOSED'],
  COMPLETED: ['CONFIRMED'],
  CANCELLED: ['PROPOSED', 'CONFIRMED'],
  SUPERSEDED: ['PROPOSED'],
  BLOCKED: ['PROPOSED'],
  EXPIRED: ['PROPOSED']
});

/** Statuses that grant no further authority and from which nothing can move. */
export const REQUEST_TERMINAL: ReadonlySet<string> = new Set(['COMPLETED', 'CANCELLED', 'SUPERSEDED', 'BLOCKED', 'EXPIRED']);

/** May a proposal move from `from` to `to`? (`null` = a proposal that does not exist yet.) */
export function isValidRequestTransition(from: string | null, to: string): boolean {
  if (to === 'PROPOSED') return from === null;
  if (from === null) return false;
  return (REQUEST_TRANSITIONS[to] ?? []).includes(from);
}

export function healthView(v: GovernanceVerification): GovernanceHealthView {
  const codes: IntegrityCode[] = [];
  for (const f of v.findings) if (f.severity === 'error' && !codes.includes(f.code)) codes.push(f.code);
  return { status: v.status, recovery: v.recovery, codes: codes.slice(0, 10), headSequence: v.ledger.headSequence, legacyUnverified: v.ledger.legacyUnverified };
}
