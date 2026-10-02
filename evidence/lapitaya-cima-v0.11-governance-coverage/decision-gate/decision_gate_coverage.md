# Decision Gate Coverage Verification (CIMA v0.11)

## Objective
Verify that `completionGate(taskId)` is the single source of truth for marking CIMA tasks `done`, covering shell, MCP, provider write, and programmatic paths.

## Implementation Details
- Extended `taskLedgerWriteGate()` in `src/main/cimaRuntime.ts` to check `TASK_WRITE_TOOLS`, `isShell`, and `mcp__*` tools touching `tasks.json`.
- Corrected path resolution (`resolve(root, path)`) so relative path references like `'tasks.json'` are mapped to `root/tasks.json`.
- Non-read-only shell commands touching `tasks.json` are evaluated against `blockedCompletions()`. If any governed CIMA task lacks `DECISION PASS`, the call is DENIED with `DECISION_GATE`.

## Q-CG Resolutions
- **Q-CG1 (Tasks without CIMA history)**: Non-CIMA tasks (no CIMA phase/assignment) remain ungated (`governed: false`, `allowed: true`), preserving API-07 semantics. Governed CIMA tasks strictly require a runtime-recorded `DECISION PASS`.
- **Q-CG2 (Provider writes)**: All provider writes, regardless of provider or model prompt, are passed through `classifyToolCall` → `authorize()` → `taskLedgerWriteGate`.

## Test Suite Results
- `[COVERAGE-08] tasks.json shell mutation cannot bypass Decision Gate`: **DENY** (`DECISION_GATE`).
- `[COVERAGE-09] CIMA task cannot become DONE without DECISION PASS`: **allowed: false** (`DECISION_GATE`).
- `[COVERAGE-10] Shell cannot bypass completionGate`: **DENY** (`DECISION_GATE`).
- `[COVERAGE-11] MCP cannot bypass completionGate`: **DENY** (`DECISION_GATE`).
- `[COVERAGE-12] Provider write cannot bypass completionGate`: **DENY** (`DECISION_GATE`).
- `[COVERAGE-21] CIMA task with no DECISION cannot complete`: **allowed: false** (`DECISION_GATE`).
- `[COVERAGE-22] Non-CIMA task preserves intended behavior`: **governed: false, allowed: true** (`PASS`).
