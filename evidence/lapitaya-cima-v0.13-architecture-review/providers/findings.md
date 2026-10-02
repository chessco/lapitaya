# providers / MCP — findings

- Governance is provider-agnostic at the runtime (authorize takes agentId+tool+input); provider-specific part is the bridge last mile (`providerGovernance.ts`): `blocking` for hive-aware Claude and shims in the hard-coded set {codex, agy, gemini, grok} (:27); everything else observe-only/none → not spawned unless config `lapitayaAllowUngovernedProviders` (spawn path hive.ts:762-766).
- Provider = execution backend + evidence source (its hook payloads are the only evidence input). It has no authority path into approve/confirm/decide.
- New provider requires: agentProvider.ts preset/bridge, BLOCKING_SHIMS literal, the shim/hook wiring in hive.ts, tool-name handling in toolRisk.ts/cimaRuntime.ts (see probe4: shell naming).
- MCP: every `mcp__*` call reaches `authorize()` (cimaRuntime.ts:407) and is classified flat `shell-command/MEDIUM` (toolRisk.ts:176). That is coverage of the entry, not differentiated governance (probe3: `mcp__github__delete_repository` SUPERVISED; ALLOW at SEMI_AUTONOMOUS/AUTONOMOUS). MCP results are not an independent actor: the agent holds the call.
