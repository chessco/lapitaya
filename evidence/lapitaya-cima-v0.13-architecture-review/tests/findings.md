# tests — findings

Command: `node --test test/lapitaya-*.test.cjs` → `lapitaya-suites-run.txt` (315 tests, 222 pass, 93 fail, 120 s).
Per-suite re-runs (sequential): v0.10 31/31, v0.11 25/25, v0.12 38/38 PASS (matches the v0.12 report).

## T-1 The legacy suites are red on HEAD
Failing tests per file (from `test at ...` lines): cima-runtime-v03 18, alicia-v07 13, cima-runtime 12, alicia-v042 11, alicia-v06 9, alicia-v08 7, alicia-v04 7, alicia-v09 5, cima-runtime-v031 4, alicia-v041 4, alicia-v05 3 = 93. foundation and v0.10–v0.12 are green.
Cause (probe5): fixtures call `HookServer.handle({agent_id})` without `agent_token`; after `hive.ensureAgent` `hasRegisteredTokens()` is true, so the hook returns `IDENTITY_UNTRUSTED` (99 mentions in the run log). The v0.12 report's "pre-existing failures 0 / regressions 0" holds for the v0.10–v0.12 suites only; the invariants those 11 suites encoded (fail-closed hook, REQUEST gate, Decision Gate through the router, Alicia boundary) are not currently executing green.
INFERENCE: the failures were introduced when v0.10 added token enforcement (cause is v0.10's behaviour change); not bisected.

## T-2 What the green suites do and do not demonstrate
- v0.12 STATE-18/19 "races", STATE-21 "concurrent ledger append", STATE-22 "multi-instance": single process, sequential calls (test/lapitaya-cima-v0.12.test.cjs:286-356). No test spawns two processes or holds the lock.
- No test for hash collision, path normalization, outbox impersonation, lock-held behaviour, tail-glue after truncation, unlocked stale reads, approved-approval age.
- All suites inject `now`; real clock/ordering not exercised.
- No Electron/IPC-level test (humanGovernanceIpc is tested through its factory).
- Typecheck/build/Electron results of the v0.12 report were NOT re-run in this review.
