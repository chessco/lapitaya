# authority — findings (derived from code)

Pipeline owner: `CimaRuntimeService` (src/main/cimaRuntime.ts, 946 lines) + pure rules in src/shared/lapitaya/{governance,toolRisk,autonomy,cimaRuntime,intent,identity}.ts.

- classify: Runtime only. `classifyToolCall` (toolRisk.ts:161), `classifyIntentMessage` (intent.ts:257). Producer-claimed type/risk are claims; `stricterType` wins (intentBoundary.ts:98).
- authorize: Runtime only. `authorize()` is called from `HookServer.handle` for every PreToolUse (hooks.ts:397); `evaluateProposedCall` for intents (read-only).
- approve/reject: `decide()` (cimaRuntime.ts:830). Reached by IPC `lapitaya:decide` → `humanGov.decide` (index.ts:4072) with the sender resolved by `humanIdentity.resolve`. The runtime method itself accepts `human === undefined` (legacy), so the identity requirement lives in the IPC adapter, not in the runtime API.
- confirm/cancel/complete REQUEST: `by === 'human'` string check (:637, :683); identity requirement again in the IPC adapter.
- Alicia: `alicia:submit` → IntentBoundary (validate → reclassify → CIMA). Executes nothing (intentBoundary.ts:13); `AUTHORITY_FIELDS` and `authority:*` signals → `NOT_AUTHORIZED`.
- Provider: executes tool calls after an allow; contributes PostToolUse payloads that become traces (hooks.ts:323-328); `spawnGovernanceDecision` gates spawn.
- write evidence: Runtime appends traces from provider hook payloads; CIMA claims are evaluated by `evaluateSubmission` against traces.
- write state: Runtime for lapitaya/*; HiveManager (agent-driven tools, IPC) for tasks.json/registry.json.
- expire: Runtime at `load()` (checkExpirations). recover: no code path. delegate: hive messages/Task tool (`DELEGATE_TOOLS` → LOW `analysis`); `parseAssignment` accepts an assignment from any sender (cimaRuntime shared :142).
- HIGH + AUTO: impossible by construction, `modeFor` returns HUMAN_APPROVAL for HIGH at every stage (autonomy.ts:95-98). Verified probe3 (4 stages).
