# Builder vs Auditor Separation Verification (CIMA v0.10)

## Objective
Verify that the `Builder != Auditor` invariant is enforced using runtime-established execution identity rather than self-declared role/actor fields in submission payloads.

## Test Suite Coverage
- `[AUTH-13] Builder cannot impersonate Auditor`: `el-beni-1` (assigned Builder) submits `BUILD PASS`, then attempts to submit `AUDIT PASS` claiming to be `AUDIT`. Evaluation rejects with `BLOCKED` (`ROLES_MUST_BE_DISTINCT`).
- `[AUTH-14] Auditor cannot impersonate Builder`: `jose-juan-1` (assigned Auditor) submits `AUDIT PASS` claiming to be `BUILD`. Evaluation rejects with `BLOCKED` (`AGENT_NOT_ASSIGNED` / `ROLES_MUST_BE_DISTINCT`).

## Verification Result
- Valid Builder (`el-beni-1`) submitting BUILD → `PASS`.
- Valid Auditor (`jose-juan-1`) submitting AUDIT after BUILD → `PASS`.
- Builder attempting to submit AUDIT phase → `DENY` (`ROLES_MUST_BE_DISTINCT`).
- Auditor attempting to submit BUILD phase → `DENY` (`AGENT_NOT_ASSIGNED`).
