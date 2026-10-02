# extensibility — conceptual simulation (code-derived, nothing implemented)

| Change | Files that must change | Central registry? |
|---|---|---|
| new provider | agentProvider.ts (preset/bridge), providerGovernance.ts (BLOCKING_SHIMS literal), hive.ts (shim/hook install), possibly toolRisk.ts + cimaRuntime.ts (tool names) | partial (presets), no for governance capability |
| new tool | toolRisk.ts sets/rules; cimaRuntime.ts TASK_WRITE_TOOLS / isShell literals (×3) / recordTrace kind list | no |
| new risk rule | toolRisk.ts + autonomy.ts ACTION_RISK (table is central: good) + intent.ts ACTION_RULES for the text reading | partial |
| new governance rule | inline in `CimaRuntimeService.authorize` (no rule list/interface) | no |
| new agent | roster/agents.ts (`phaseForAgent`), hive registry | yes (roster) |
| new human decision type | humanGovernanceIpc.ts, index.ts IPC, preload, renderer decisionCenter, runtime method, ledger record type, observability | no (≥5 layers) |
