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
  | 'read-code' | 'analysis' | 'run-tests' | 'lint' | 'documentation' | 'static-analysis'
  | 'hive-coordination'
  // MEDIUM
  | 'code-change' | 'config-change' | 'generate-tests' | 'shell-command'
  | 'api-change' | 'broad-refactor' | 'structural-change' | 'major-dependency-change'
  // HIGH
  | 'production' | 'destructive-migration' | 'critical-security' | 'auth' | 'permissions'
  | 'infrastructure' | 'data-deletion' | 'multi-tenancy' | 'irreversible'
  | 'secrets' | 'governance-tamper';

export const ACTION_RISK: Readonly<Record<ActionCategory, RiskLevel>> = Object.freeze({
  'read-code': 'LOW',
  analysis: 'LOW',
  'run-tests': 'LOW',
  lint: 'LOW',
  documentation: 'LOW',
  'static-analysis': 'LOW',
  // The agent's own hive workspace: outbox, memory.md, tasks.json, board.md.
  'hive-coordination': 'LOW',
  'code-change': 'MEDIUM',
  'config-change': 'MEDIUM',
  // v0.2: creating tests changes the repo, so it is supervised (was LOW in v0.1).
  'generate-tests': 'MEDIUM',
  // A shell command that is neither a known read/test command nor a known
  // destructive one. Supervised, not blocked: blocking every unknown command
  // would stop ordinary work (mkdir, node scripts, moving inbox files).
  'shell-command': 'MEDIUM',
  'api-change': 'MEDIUM',
  'broad-refactor': 'MEDIUM',
  'structural-change': 'MEDIUM',
  'major-dependency-change': 'MEDIUM',
  secrets: 'HIGH',
  // Editing the machinery that enforces governance (hooks, agent settings, the
  // CIMA ledger, approvals, the policy code itself). An agent must never be able
  // to switch its own guard off.
  'governance-tamper': 'HIGH',
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
  'Autonomy policy (La Pitaya, ENFORCED by the harness at every tool call): LOW risk (reading code, ' +
  'analysis, tests, lint, docs, static analysis) — runs automatically. MEDIUM risk (code/config changes, ' +
  'new tests, refactors, other shell commands) — runs under supervision and is logged. HIGH risk ' +
  '(production, destructive migrations, secrets, auth, permissions, infrastructure, data deletion, ' +
  'irreversible actions, editing governance/hook files) — the harness DENIES the call with ' +
  'HUMAN_APPROVAL_REQUIRED; ask the human, and retry the identical call only after they approve.';
