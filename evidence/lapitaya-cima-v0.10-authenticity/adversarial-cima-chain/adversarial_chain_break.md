# Adversarial CIMA Chain Forgery Verification (CIMA v0.10)

## Objective
Re-run the exact architectural attack identified by the Architecture Readiness Audit: an adversarial actor attempts to manufacture a complete passing CIMA chain (`BUILD PASS` → `TEST PASS` → `AUDIT PASS` → `DECISION PASS` → `TASK DONE`) using forged identities or unauthenticated tokens.

## Attack Sequence & Runtime Enforcement
1. **Forged BUILD PASS (Agent A impersonates Agent B)**:
   - Untrusted payload claims `agent_id: "valentin-1"` without valid capability token `f.tokens.valentin`.
   - Result: Hook server rejects request with `IDENTITY_UNTRUSTED` (`deny`).
2. **Forged TEST PASS (Unassigned Agent)**:
   - Agent `el-beni-1` attempts to submit `TEST PASS` on a task where `chuy-1` is the assigned Tester.
   - Result: `evaluateSubmission` returns `BLOCKED` (`AGENT_NOT_ASSIGNED`).
3. **Forged AUDIT PASS (Builder impersonates Auditor)**:
   - Builder `valentin-1` attempts to submit `AUDIT PASS`.
   - Result: `evaluateSubmission` returns `BLOCKED` (`ROLES_MUST_BE_DISTINCT`).
4. **Forged DECISION PASS (Agent self-declares human decision)**:
   - Agent attempts to submit `DECISION PASS` with `actor: "human"` without v0.8 trusted human context.
   - Result: `evaluateSubmission` returns `BLOCKED` (`DECISION_AUTHORITY`).

## Test Suite Result
- `[ADVERSARIAL-CHAIN]` in `test/lapitaya-cima-v0.10.test.cjs`: **PASS**.
- Outcome: The forged CIMA chain breaks at step 1 and cannot progress to `TASK DONE`.
