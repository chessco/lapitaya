/**
 * Provider governance capability — can La Pitaya actually STOP this provider's
 * tool calls?
 *
 * Every provider reaches the same governance runtime (HookServer →
 * CimaRuntimeService) through its bridge; the runtime itself is
 * provider-agnostic. What differs is the bridge's last mile:
 *
 *   blocking      the bridge WAITS for the runtime's PreToolUse decision and
 *                 translates a deny into the CLI's own blocking contract, failing
 *                 closed when the runtime is unreachable (cth-hook for
 *                 claude/codex; agy, gemini and grok shims).
 *   observe-only  the bridge reports tool calls but cannot stop them
 *                 (fire-and-forget plugins: pi, opencode; the proxy sidecar that
 *                 synthesizes events after the fact: qwen, crush).
 *   none          no bridge at all (kimi, copilot, cursor, custom).
 *
 * v0.16: the classification is no longer derived here — it is DECLARED in the
 * governance policy registry (policyRegistry.ts), which cross-checks every
 * declaration against the provider presets when it validates (a drifted bridge
 * is a policy conflict and fails closed). This module only reads it.
 *
 * Fail-closed rule: a hive agent whose provider is not `blocking` cannot have
 * its actions authorized, so it is not spawned — unless the human explicitly
 * opts out (`allowUngovernedProviders: true`), which the caller must log.
 * A provider id the policy does not know is NEVER spawned (PROVIDER_UNKNOWN),
 * not even with the opt-out: the opt-out accepts a KNOWN ungoverned bridge, not
 * an unknown one.
 */

import type { AgentProvider } from '../agentProvider';
import { POLICY_REGISTRY, type PolicyRegistry } from './policyRegistry';

export type GovernanceEnforcement = 'blocking' | 'observe-only' | 'none';

/** The provider's enforcement as the policy declares it. An unknown provider has none ('none'). */
export function governanceEnforcement(provider: AgentProvider | string, policy: PolicyRegistry = POLICY_REGISTRY): GovernanceEnforcement {
  return policy.getProviderPolicy(String(provider))?.enforcement ?? 'none';
}

export interface SpawnGovernanceDecision {
  allowed: boolean;
  enforcement: GovernanceEnforcement;
  /** Set when a human override let an ungoverned provider through. */
  overridden?: boolean;
  reason?: string;
  /** v0.16: structured refusal code (LAPITAYA_GOVERNANCE_UNENFORCEABLE · PROVIDER_UNKNOWN · POLICY_INVALID). */
  code?: string;
  /** v0.16: the capability judged (provider.spawn) and the policy version that judged it. */
  capability: 'provider.spawn';
  policyVersion: number;
}

export function spawnGovernanceDecision(
  provider: AgentProvider | string,
  opts: { allowUngoverned?: boolean; policy?: PolicyRegistry } = {}
): SpawnGovernanceDecision {
  const policy = opts.policy ?? POLICY_REGISTRY;
  const base = { capability: 'provider.spawn' as const, policyVersion: policy.version };
  if (!policy.valid) {
    return { ...base, allowed: false, enforcement: 'none', code: 'POLICY_INVALID',
      reason: `POLICY_INVALID — the governance policy v${policy.version} did not validate, so no agent is spawned (${policy.errors.slice(0, 2).join('; ')}).` };
  }
  const pp = policy.getProviderPolicy(String(provider));
  if (!pp) {
    return { ...base, allowed: false, enforcement: 'none', code: 'PROVIDER_UNKNOWN',
      reason: `PROVIDER_UNKNOWN — provider ${JSON.stringify(String(provider)).slice(0, 60)} is not in governance policy v${policy.version}; ` +
        'its calls cannot be governed, so the agent was not spawned. The ungoverned-provider opt-out does not apply to unknown providers.' };
  }
  const enforcement = pp.enforcement;
  if (enforcement === 'blocking') return { ...base, allowed: true, enforcement };
  if (opts.allowUngoverned === true) {
    return { ...base, allowed: true, enforcement, overridden: true,
      reason: `human override: ${provider} (${enforcement}) runs WITHOUT enforceable La Pitaya governance` };
  }
  return {
    ...base,
    allowed: false,
    enforcement,
    code: 'LAPITAYA_GOVERNANCE_UNENFORCEABLE',
    reason:
      `LAPITAYA_GOVERNANCE_UNENFORCEABLE — provider "${provider}" is ${enforcement === 'none' ? 'not bridged to' : 'only observed by'} ` +
      'the La Pitaya runtime: its tool calls cannot be authorized or denied, so the agent was not spawned. ' +
      'Use a provider with a blocking bridge (claude, codex, antigravity, gemini, grok), or have the human set ' +
      '`lapitayaAllowUngovernedProviders: true` to accept running it ungoverned.'
  };
}
