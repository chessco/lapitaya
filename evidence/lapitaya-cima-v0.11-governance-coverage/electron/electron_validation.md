# Electron Application Validation (CIMA v0.11)

## Objective
Validate that the Electron main process, IPC handlers, real agent execution, and cross-window event propagation operate cleanly under CIMA v0.11 governance coverage hardening.

## Audit & Verification Points
1. **Alicia REQUEST Execution**:
   - REQUEST proposals re-validate intent classification; LOW/MEDIUM scope gating operates cleanly without unauthorized execution.
2. **Human Confirmation & Approvals**:
   - `confirmRequest` and `decide` require trusted v0.8 human IPC context (`DecisionOwner`).
3. **Shell Mutation Attempts**:
   - Shell commands targeting `tasks.json`, `cima-ledger.jsonl`, or governance files from renderer/PTY terminals are intercepted at PreToolUse and denied if violating `DECISION_GATE`.
4. **Provider Execution**:
   - Provider spawns verify `spawnGovernanceDecision()`; blocking providers run governed, unbridged providers fail closed unless explicitly overridden.
5. **Evidence Success Correlation**:
   - Traces from failed terminal commands (`PostToolUseFailure` / non-zero exit) are correctly marked `ok: false` and rejected during evidence verification.
6. **Cross-Window Event Propagation & UI Integrity**:
   - No renderer console errors, no secret leakage, no unauthorized renderer authority.

## Result
- Real Electron suite validation (**PASS**).
