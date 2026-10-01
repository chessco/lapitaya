# Evidence Success Correlation Verification (CIMA v0.11)

## Objective
Verify that evidence verification strictly requires verified successful execution (`t.ok === true`). A failed command execution (`ok: false`) or non-matching trace must NOT satisfy evidence requirements.

## Implementation Details
- Updated `verifyEvidence()` in `src/shared/lapitaya/cimaRuntime.ts` to require `t.ok === true` in both `commandMatch` and `pathMatch` predicates.
- Traces recorded via `PostToolUseFailure` or with interrupted execution flags have `ok: false` and are excluded from valid evidence hits.

## Q-CG6 Resolution
- **Q-CG6 (Failed command evidence)**: A failed command cannot satisfy evidence for CIMA phase submissions. If evidence cites a command whose execution trace failed (`ok: false`), `verifyEvidence()` returns `verified: false` and `evaluateSubmission()` returns `BLOCKED` with `EVIDENCE_FIRST` violation.

## Test Suite Results
- `[COVERAGE-13] Failed execution cannot satisfy evidence`: `verifyEvidence` returns `verified: false` on `ok: false` trace (**PASS**).
- `[COVERAGE-14] Matching command text without successful execution cannot PASS`: `evaluateSubmission` returns `BLOCKED` with `EVIDENCE_FIRST` (**PASS**).
- `[COVERAGE-15] Wrong execution trace cannot satisfy evidence`: `verifyEvidence` returns `verified: false` on unrelated command (**PASS**).
- `[COVERAGE-16] Wrong actor cannot satisfy evidence`: Trace from another agent does not satisfy submission (**PASS**).
