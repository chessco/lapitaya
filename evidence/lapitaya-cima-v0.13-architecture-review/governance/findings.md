# governance — pipeline findings

Real PreToolUse order (cimaRuntime.ts:366-443): withLock → state present → load → corrupt? → `authorizeToolCall` (classify → modeFor → approval lookup) → REQUEST gate (`requestGate`) → task-ledger write gate (Write/Edit/MultiEdit, shell, mcp__*) → approval consumption (persist before run) → raise pending approval → `recordDecision` (ledger) → return.
Before it (hooks.ts:203-380): identity (token) → operator HALT → operator tool gate (`control.toolDecision`). After execution: PostToolUse → `recordTrace`.

- Mandatory: identity, classification, ledger record of the decision (if the write fails an executable decision is denied).
- Optional/derived: REQUEST gate (only if proposals exist), task-ledger gate (only for tasks.json-touching calls), phase facts (derived from ledger on each load).
- Bypass-by-construction found: none for tools that reach the hook. Gaps are in classification quality (S-3, S-5, S-6) and in channels that never reach the hook (outbox, hive:send, direct tasks.json writes by any non-governed process).
- Duplicated policy: shell-tool-name list in toolRisk.ts:163, cimaRuntime.ts:406, :789 and (narrower) :868; builder≠auditor in `cima.ts canApprove` (unused outside cima.ts) and `evaluateSubmission`; FNV-1a in governance.ts and alicia/observability.ts:21; write-tool lists in toolRisk.ts:37, cimaRuntime.ts:39, :871.
- Pre-existing design property: REQUEST gate is floor-wide (intent.ts:364-404): any PROPOSED request blocks all non-planning calls of every agent.
- Phase model: the 8 phases are labels on ledger records + agent roles (phaseForAgent). Ordering rules exist only for TEST→BUILD, AUDIT→TEST, DECISION→AUDIT (+ chain check) and LEARN needs an AUDIT record. CONTEXT/ARCHITECT/ITERATE have no predecessor/evidence rules beyond EVIDENCE_FIRST. No per-task phase register (derived), so no duplicated phase state.
- Builder≠Auditor: runtime-enforced, identity-based (hook token) for tool evidence; but "builder" = agents that SUBMITTED a BUILD claim, not who modified code (probe3: author W passes TEST after Y submitted BUILD). Also sender attribution of claims relies on the outbox directory (S-2).
