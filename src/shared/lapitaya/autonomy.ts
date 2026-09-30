/**
 * Autonomy policy — the minimal abstraction for Progressive Autonomy.
 *
 *   LOW risk    → AUTO            (agent proceeds on its own)
 *   MEDIUM risk → SUPERVISED      (agent proceeds, El Inge / the human reviews)
 *   HIGH risk   → HUMAN_APPROVAL  (nothing happens until a human says yes)
 *
 * This is a CLASSIFIER plus a table, not a policy engine: the upstream runtime
 * already enforces tool permissions per CLI (auto mode, sandbox flags). What La
 * Pitaya adds is one shared vocabulary so El Inge's prompt, the docs and future
 * enforcement all agree on what "high risk" means. Unknown actions are HIGH
 * risk — the safe default. See docs/CIMA/AUTONOMY.md for the roadmap.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type AutonomyMode = 'AUTO' | 'SUPERVISED' | 'HUMAN_APPROVAL';

/** The maturity stages La Pitaya can grow through. */
export const AUTONOMY_STAGES = ['HUMAN_CONTROLLED', 'SUPERVISED', 'SEMI_AUTONOMOUS', 'AUTONOMOUS'] as const;
export type AutonomyStage = (typeof AUTONOMY_STAGES)[number];

export type ActionCategory =
  // LOW
  | 'read-code' | 'analysis' | 'run-tests' | 'lint' | 'documentation' | 'generate-tests' | 'static-analysis'
  // MEDIUM
  | 'api-change' | 'broad-refactor' | 'structural-change' | 'major-dependency-change'
  // HIGH
  | 'production' | 'destructive-migration' | 'critical-security' | 'auth' | 'permissions'
  | 'infrastructure' | 'data-deletion' | 'multi-tenancy' | 'irreversible';

export const ACTION_RISK: Readonly<Record<ActionCategory, RiskLevel>> = Object.freeze({
  'read-code': 'LOW',
  analysis: 'LOW',
  'run-tests': 'LOW',
  lint: 'LOW',
  documentation: 'LOW',
  'generate-tests': 'LOW',
  'static-analysis': 'LOW',
  'api-change': 'MEDIUM',
  'broad-refactor': 'MEDIUM',
  'structural-change': 'MEDIUM',
  'major-dependency-change': 'MEDIUM',
  production: 'HIGH',
  'destructive-migration': 'HIGH',
  'critical-security': 'HIGH',
  auth: 'HIGH',
  permissions: 'HIGH',
  infrastructure: 'HIGH',
  'data-deletion': 'HIGH',
  'multi-tenancy': 'HIGH',
  irreversible: 'HIGH'
});

/** Risk → mode at the default stage (SUPERVISED). */
const DEFAULT_MODE: Readonly<Record<RiskLevel, AutonomyMode>> = Object.freeze({
  LOW: 'AUTO',
  MEDIUM: 'SUPERVISED',
  HIGH: 'HUMAN_APPROVAL'
});

export const DEFAULT_AUTONOMY_STAGE: AutonomyStage = 'SUPERVISED';

export function riskOf(action: string): RiskLevel {
  return (ACTION_RISK as Record<string, RiskLevel>)[action] ?? 'HIGH';
}

/**
 * The mode an action runs under at a given stage.
 *
 * - HUMAN_CONTROLLED: everything needs a human.
 * - SUPERVISED (default): the table above.
 * - SEMI_AUTONOMOUS: MEDIUM relaxes to AUTO.
 * - AUTONOMOUS: MEDIUM relaxes to AUTO.
 *
 * HIGH risk is HUMAN_APPROVAL at EVERY stage — Human Governance is not
 * something a higher autonomy stage can switch off.
 */
export function modeFor(action: string, stage: AutonomyStage = DEFAULT_AUTONOMY_STAGE): AutonomyMode {
  const risk = riskOf(action);
  if (risk === 'HIGH') return 'HUMAN_APPROVAL';
  if (stage === 'HUMAN_CONTROLLED') return 'HUMAN_APPROVAL';
  if (risk === 'MEDIUM' && (stage === 'SEMI_AUTONOMOUS' || stage === 'AUTONOMOUS')) return 'AUTO';
  return DEFAULT_MODE[risk];
}

export function requiresHuman(action: string, stage: AutonomyStage = DEFAULT_AUTONOMY_STAGE): boolean {
  return modeFor(action, stage) === 'HUMAN_APPROVAL';
}

/** One paragraph for El Inge's orientation prompt — the policy in plain English. */
export const AUTONOMY_PROMPT =
  'Autonomy policy (La Pitaya): LOW risk (reading code, analysis, tests, lint, docs, static analysis) — ' +
  'proceed. MEDIUM risk (API changes, broad refactors, structural changes, major dependency changes) — ' +
  'proceed under supervision and report to the human. HIGH risk (production, destructive migrations, ' +
  'critical security, auth, permissions, infrastructure, data deletion, multi-tenancy, anything ' +
  'irreversible) — STOP and ask the human for explicit approval first.';
