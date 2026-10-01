# Baseline Gap Reproduction & Audit Verification (CIMA v0.11)

## Objective
Reproduce and verify the four governance coverage gaps identified in the Governance Coverage Readiness Audit prior to code modification.

## 1. Gap A — Shell Governance Coverage
- **Reproduction**: Analyzed `classifyShell()` in `src/shared/lapitaya/toolRisk.ts`.
- **Finding**: Shell commands starting with read verbs (`echo`, `cat`, `find`, `git status`) were matched per segment by `LOW_SHELL` rules before checking `GOVERNANCE_STATE_REF` or write/redirection operators.
- **Result**: `echo x > tasks.json` and `cat foo > cima-ledger.jsonl` were classified as `read-code` (LOW risk, AUTO allowed), bypassing edit/write gates.

## 2. Gap B — Decision Gate Coverage
- **Reproduction**: Analyzed `taskLedgerWriteGate()` in `src/main/cimaRuntime.ts`.
- **Finding**: `taskLedgerWriteGate()` was restricted to `TASK_WRITE_TOOLS` (`Write`, `Edit`, `MultiEdit`).
- **Result**: Modifying `tasks.json` via shell redirection (`echo ... > tasks.json`), MCP tools (`mcp__write_file`), or provider direct writes bypassed `completionGate(taskId)`.

## 3. Gap C — Evidence Success Correlation
- **Reproduction**: Analyzed `verifyEvidence()` in `src/shared/lapitaya/cimaRuntime.ts`.
- **Finding**: Evidence matching checked trace command/path subjects without verifying that `trace.ok === true`.
- **Result**: A failed command execution (`npm test` with exit code 1 / `ok: false`) satisfied evidence, allowing `PASS` verdicts on failed executions.

## 4. Gap D — Provider Spawn Governance
- **Reproduction**: Analyzed `spawnGovernanceDecision()` in `src/shared/lapitaya/providerGovernance.ts` vs `src/main/hive.ts`.
- **Finding**: `spawnGovernanceDecision()` was not called during `HiveManager.ensureAgent()` / `spawnInjection()`.
- **Result**: Unbridged or observed-only providers (`kimi`, `copilot`) could be spawned without runtime policy consultation.
