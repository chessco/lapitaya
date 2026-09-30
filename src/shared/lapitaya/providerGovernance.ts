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
 * Fail-closed rule: a hive agent whose provider is not `blocking` cannot have
 * its actions authorized, so it is not spawned — unless the human explicitly
 * opts out (config `lapitayaAllowUngovernedProviders: true`), which is logged.
 */

import { bridgeOf, providerPreset, type AgentProvider } from '../agentProvider';

export type GovernanceEnforcement = 'blocking' | 'observe-only' | 'none';

const BLOCKING_SHIMS: ReadonlySet<string> = new Set(['codex', 'agy', 'gemini', 'grok']);

export function governanceEnforcement(provider: AgentProvider | string): GovernanceEnforcement {
  const preset = providerPreset(provider as AgentProvider);
  // hiveAware = Claude Code: per-session settings wire every PreToolUse to cth-hook.
  if (preset.hiveAware) return 'blocking';
  const bridge = bridgeOf(provider as AgentProvider);
  if (!bridge) return 'none';
  if (bridge.kind === 'proxy') return 'observe-only';
  return BLOCKING_SHIMS.has(bridge.shim) ? 'blocking' : 'observe-only';
}

export interface SpawnGovernanceDecision {
  allowed: boolean;
  enforcement: GovernanceEnforcement;
  /** Set when a human override let an ungoverned provider through. */
  overridden?: boolean;
  reason?: string;
}

export function spawnGovernanceDecision(
  provider: AgentProvider | string,
  opts: { allowUngoverned?: boolean } = {}
): SpawnGovernanceDecision {
  const enforcement = governanceEnforcement(provider);
  if (enforcement === 'blocking') return { allowed: true, enforcement };
  if (opts.allowUngoverned === true) {
    return { allowed: true, enforcement, overridden: true,
      reason: `human override: ${provider} (${enforcement}) runs WITHOUT enforceable La Pitaya governance` };
  }
  return {
    allowed: false,
    enforcement,
    reason:
      `LAPITAYA_GOVERNANCE_UNENFORCEABLE — provider "${provider}" is ${enforcement === 'none' ? 'not bridged to' : 'only observed by'} ` +
      'the La Pitaya runtime: its tool calls cannot be authorized or denied, so the agent was not spawned. ' +
      'Use a provider with a blocking bridge (claude, codex, antigravity, gemini, grok), or have the human set ' +
      '`lapitayaAllowUngovernedProviders: true` to accept running it ungoverned.'
  };
}
