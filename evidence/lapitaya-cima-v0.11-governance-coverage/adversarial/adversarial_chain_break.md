# Adversarial Chain Break Verification (CIMA v0.11)

## Objective
Verify that the previously forged CIMA governance chain remains broken and that all bypass vectors (shell redirection, provider bypass, MCP bypass, failed command evidence) fail closed under v0.11.

## Attack Vectors Tested
1. **Forged BUILD PASS without trace**:
   - Result: `evaluateSubmission` returns `BLOCKED` (`EVIDENCE_FIRST`).
2. **Forged TEST PASS with failing command (`npm test` exit code 1)**:
   - Result: `verifyEvidence` excludes failed trace (`t.ok === false`); `evaluateSubmission` returns `BLOCKED` (`EVIDENCE_FIRST`).
3. **Shell completion bypass (`echo "done" > tasks.json`)**:
   - Result: `authorize()` returns `DENY` (`DECISION_GATE`).
4. **Final Decision Gate check**:
   - Result: `completionGate('task-cima-1')` returns `allowed: false` (`DECISION_GATE`).

## Test Suite Result
- `[COVERAGE-25]` in `test/lapitaya-cima-v0.11.test.cjs`: **PASS**.
- Outcome: The forged CIMA chain cannot progress to `TASK DONE` via any vector.
