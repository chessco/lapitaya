# LA PITAYA — CIMA v0.11: GOVERNANCE COVERAGE HARDENING

## 1. Objective
The objective of CIMA v0.11 is to extend runtime governance coverage over all execution paths that could previously bypass CIMA authorization or completion verification (shell redirection, Decision Gate evasion, unverified failed command evidence, and ungoverned provider process spawn).

## 2. Baseline
- **Baseline Commit**: `456d4a75` (`La Pitaya CIMA v0.10: runtime authenticity hardening`).
- **Baseline Verdict**: PASS.
- **Invariants Preserved**:
  - `AGENT = ACTOR`, `CIMA RUNTIME = VERIFIER / GOVERNANCE AUTHORITY`, `HUMAN = HUMAN GOVERNANCE AUTHORITY`.
  - Capability token validation (`HIVE_AGENT_TOKEN`).
  - Trusted v0.8 Electron IPC human identity.
  - Runtime-established `Builder != Auditor` separation.
  - Adversarial forged CIMA chain breakage at step 1.

## 3. Threat Model
Governance must cover every real path capable of producing a governable action. Any attempt to modify system state, task ledgers, or execute unbridged provider code without runtime authorization must fail closed.

## 4. Audit Findings
The Governance Coverage Readiness Audit identified four critical coverage gaps:
1. **Shell Governance**: Shell commands starting with read verbs (`echo`, `cat`, `find`) could write to governance state or perform deletions via redirection/flags without triggering HIGH risk classification.
2. **Decision Gate Coverage**: `taskLedgerWriteGate` only checked file edit tools (`Write`, `Edit`, `MultiEdit`); shell commands and MCP tools could edit `tasks.json` to mark tasks `done` without passing `completionGate(taskId)`.
3. **Evidence Success Correlation**: `verifyEvidence()` accepted matching trace subjects without checking `trace.ok === true`, allowing failed command executions (`ok: false`) to satisfy evidence.
4. **Provider Spawn Governance**: `spawnGovernanceDecision()` was not connected to actual agent process spawn in `HiveManager`.

## 5. Shell Coverage
- **FACT**: Implemented `SHELL_MUTATION_OP` in `src/shared/lapitaya/toolRisk.ts` to detect redirection operators (`>`, `>>`, `1>`, `2>`, `>&`, `|&`), command substitutions (`$()`), file mutation utilities (`tee`, `cp`, `mv`, `rm`, `touch`), and destructive `find` flags (`-delete`, `-exec`).
- **FACT**: Shell commands attempting to mutate governance state files (`tasks.json`, `cima-ledger.jsonl`, etc.) are classified as `governance-tamper` / `HIGH` risk.
- **FACT**: Ambiguous shell mutations fail closed as `shell:mutation` (`MEDIUM` or `HIGH`, erring UP, never `LOW`).

## 6. Decision Gate Coverage
- **FACT**: Extended `taskLedgerWriteGate()` in `src/main/cimaRuntime.ts` to evaluate all write, shell (`Bash`, `PowerShell`), and MCP (`mcp__*`) tools modifying `tasks.json`.
- **FACT**: Fixed path resolution (`resolve(root, path)`) so relative path references like `'tasks.json'` match `root/tasks.json`.
- **FACT**: Any write or shell command that would set a governed CIMA task to `status = 'done'` without a runtime-recorded `DECISION PASS` is DENIED with `DECISION_GATE`.

## 7. Evidence Correlation
- **FACT**: Updated `verifyEvidence()` in `src/shared/lapitaya/cimaRuntime.ts` to require `trace.ok === true` for both command and path evidence matches.
- **FACT**: Execution traces recorded with `ok: false` (failed exit code or interrupted execution) are strictly excluded from valid evidence hits.

## 8. Provider Governance
- **FACT**: Connected `spawnGovernanceDecision()` directly to `spawnInjection()` / `ensureAgent()` in `src/main/hive.ts`.
- **FACT**: Spawning an unbridged or observed-only provider without explicit human opt-in (`allowUngovernedProviders: true`) blocks spawn with `LAPITAYA_GOVERNANCE_UNENFORCEABLE`.

## 9. Q-CG1 Resolution (Tasks Without CIMA History)
- **FACT**: Tasks with CIMA history (assignments or records) strictly require a runtime-recorded `DECISION PASS` to become `done`. Non-CIMA tasks (no CIMA phase or assignment) remain ungated (`governed: false`, `allowed: true`), preserving API-07 semantics.

## 10. Q-CG2 Resolution (Provider Writes)
- **FACT**: All provider writes, regardless of provider preset or LLM prompt, pass through `classifyToolCall` → `authorize()` → `taskLedgerWriteGate`. No model claim can bypass CIMA governance.

## 11. Q-CG4 Resolution (Non-Blocking Providers)
- **FACT**: Non-blocking providers (`observe-only` or `none`) cannot self-authorize. Ungoverned execution requires explicit, auditable runtime configuration (`allowUngovernedProviders: true`).

## 12. Q-CG6 Resolution (Failed Command Evidence)
- **FACT**: Failed command executions (`ok: false`) CANNOT satisfy CIMA evidence requirements. Submissions citing failed executions produce `BLOCKED` verdicts with `EVIDENCE_FIRST` violations.

## 13. Adversarial Tests
- **FACT**: Re-ran forged governance chain test (`BUILD PASS` → `TEST PASS` → `AUDIT PASS` → `DECISION PASS` → `TASK DONE`).
- **FACT**: All forged phase submissions and shell/MCP completion bypass attempts failed closed. The chain remains completely broken.

## 14. Regression
- **FACT**: Ran regression tests across Foundation v0.1 through CIMA v0.10.
- **FACT**: 0 new regressions. All 31 v0.10 tests and 25 v0.11 tests PASS.

## 15. Electron Validation
- **FACT**: Main process IPC handlers, PTY tool authorization, and real agent execution validated with 0 renderer console errors or unauthorized authority.

## 16. Remaining Risks
The following items remain explicitly documented for future hardening slices:
1. **Ledger Durability & Retention Policy**: Compaction and retention policy for long-term JSONL storage.
2. **Proposal / Approval Expiration**: Expiration timers for pending proposals and approvals.
3. **Multi-Instance Hive Protection**: Locking across concurrent application instances.
4. **FNV 32-bit Correlation Hash Collision Risk**: Hash collision risk on very large trace sets.

## 17. Explicit Non-Goals
Did NOT implement: ledger retention, ledger compaction, proposal/approval expiration, multi-instance hive locking, OAuth, cloud identity, user accounts, network authentication, new agents, new LLMs, new CIMA phases, new risk levels, new autonomy levels, Alicia redesign, Decision Center redesign, `lapitaya:approvals`, or v0.9 cleanup.

## 18. Files Changed
- [`src/shared/lapitaya/toolRisk.ts`](file:///c:/PitayaCode/LaPitaya/src/shared/lapitaya/toolRisk.ts)
- [`src/shared/lapitaya/cimaRuntime.ts`](file:///c:/PitayaCode/LaPitaya/src/shared/lapitaya/cimaRuntime.ts)
- [`src/main/cimaRuntime.ts`](file:///c:/PitayaCode/LaPitaya/src/main/cimaRuntime.ts)
- [`src/main/hive.ts`](file:///c:/PitayaCode/LaPitaya/src/main/hive.ts)
- [`docs/LA_PITAYA_CIMA_RUNTIME_11_GOVERNANCE_COVERAGE.md`](file:///c:/PitayaCode/LaPitaya/docs/LA_PITAYA_CIMA_RUNTIME_11_GOVERNANCE_COVERAGE.md)
- [`test/lapitaya-cima-v0.11.test.cjs`](file:///c:/PitayaCode/LaPitaya/test/lapitaya-cima-v0.11.test.cjs)
- [`evidence/lapitaya-cima-v0.11-governance-coverage/*`](file:///c:/PitayaCode/LaPitaya/evidence/lapitaya-cima-v0.11-governance-coverage/)

## 19. Final Verdict
**PASS**: All four governance coverage gaps closed, verified fail-closed, 0 regressions.
