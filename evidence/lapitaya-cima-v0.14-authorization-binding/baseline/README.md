# baseline

* `git rev-parse HEAD` = `3e6ae0c8900c52f44f98fad63bf935502096df41` (v0.12) before the branch was created; branch created from it; `main` untouched.
* `repro_pre_fix.txt` — `fnv-reproduction/repro_v013_findings.cjs` on the **unmodified v0.12** (R1 FNV, R2 sender, R3 paths, R4 lock, R5 secondary writes). Taken before the R5 section was tightened to use a PASS claim with real evidence; R5's v0.12 result (`decide → approved`, no ledger record; `submit → PASS`) was re-confirmed with the final script on v0.12 before any edit.
* `repro_post_fix.txt` — the same script after the fix.
* v0.12 suites at baseline: v0.10 31/31, v0.11 25/25, v0.12 38/38; 93 of 315 La Pitaya tests failing (`IDENTITY_UNTRUSTED`, `evidence/lapitaya-cima-v0.13-architecture-review/tests/`); typecheck PASS.
