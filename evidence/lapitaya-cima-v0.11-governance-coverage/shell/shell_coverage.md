# Shell Governance Coverage Verification (CIMA v0.11)

## Objective
Verify that shell operations containing redirection (`>`, `>>`, `2>`), command substitution (`$()`), file mutations (`tee`, `cp`, `mv`, `rm`, `touch`), and destructive `find` options (`-delete`, `-exec`) are properly classified and governed before execution.

## Implementation Details
- Added `SHELL_MUTATION_OP` regex in `src/shared/lapitaya/toolRisk.ts` to detect mutation operators before `LOW_SHELL` evaluation.
- Added `find-destructive` rule to `HIGH_SHELL` for `find -delete` and `find -exec`.
- Enforced that shell commands touching `GOVERNANCE_STATE_REF` (`tasks.json`, `cima-ledger.jsonl`, etc.) with redirection or file mutations return `governance-tamper` / `HIGH` risk.
- Ambiguous shell mutations fail closed as `shell:mutation` (`code-change` / `MEDIUM` or `HIGH`, erring UP, never `LOW`).

## Test Suite Results
- `[COVERAGE-01] Shell > mutation detected`: `echo x > tasks.json` → `governance-tamper` / `HIGH` (`PASS`).
- `[COVERAGE-02] Shell >> mutation detected`: `echo x >> tasks.json` → `governance-tamper` / `HIGH` (`PASS`).
- `[COVERAGE-03] Shell 2> mutation detected`: `cat err 2> cima-ledger.jsonl` → `governance-tamper` / `HIGH` (`PASS`).
- `[COVERAGE-04] Command substitution mutation detected`: `echo $(cat a) > tasks.json` → `governance-tamper` / `HIGH` (`PASS`).
- `[COVERAGE-05] find -delete governed`: `find . -delete` → `data-deletion` / `HIGH` (`PASS`).
- `[COVERAGE-06] find -exec governed`: `find . -exec rm {} \;` → `data-deletion` / `HIGH` (`PASS`).
- `[COVERAGE-07] tee/cp/mv/rm governance`: `tee`, `cp`, `mv`, `rm` touching `tasks.json` → `governance-tamper` / `HIGH` (`PASS`).
- `[COVERAGE-23] Ambiguous shell mutation fails closed`: `cat file | tee >(process_output)` → `shell:mutation` / `MEDIUM` (`PASS`).
