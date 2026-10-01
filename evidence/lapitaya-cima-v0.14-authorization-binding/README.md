# CIMA v0.14 — Authorization Binding & Runtime Trust Hardening — evidence index

Base: `3e6ae0c8` (v0.12). Branch: `lapitaya/cima-v0.14-authorization-binding`. Document: `docs/LA_PITAYA_CIMA_RUNTIME_14_AUTHORIZATION_BINDING.md`.

| Folder | What it proves | Key files |
|---|---|---|
| `baseline/` | the v0.13 findings **reproduced before the fix**, and the same script after it | `repro_pre_fix.txt`, `repro_post_fix.txt` |
| `fnv-reproduction/` | **EXPLOIT CONFIRMED** on v0.12; BLOCKED on v0.14 | `fnv_collision_attack.md` (mandatory), `fingerprints.json`, `repro_v013_findings.cjs`, `print_fingerprints.cjs` |
| `authorization-binding/` | canonical subject, SHA-256 fingerprint, legacy fixtures on real identity, decision↔trace link | `tests-run.txt`, `lapitaya-cima-v0.14-run.txt` |
| `path-normalization/` | 18 spellings of the governance file → one canonical meaning or fail closed | `path_table.txt`, `path_table.cjs` (the `ambiguous` column is the *pure-lexical* verdict; the runtime additionally expands 8.3 names/symlinks through the filesystem — see the "exists" 8.3 row) |
| `message-authenticity/` | sender spoof (hook, outbox, router, renderer `hive:send`), human/provider spoof | `tests-run.txt` |
| `approval-replay/` | replay, consumed, modified, copied, expired, legacy, hand-written approvals | `tests-run.txt` |
| `lock/` | fail-closed lock; real second process; three real processes | `README.md`, `tests-run.txt` |
| `secondary-writes/` | audit of every secondary write and what now propagates | `audit.md`, `tests-run.txt` |
| `adversarial/` | every differing-call dimension, FNV, end-to-end attacks | `tests-run.txt` |
| `electron/` | real Electron: in-process harness with the real hook shim + named pipe (29/29, E9 NOT VALIDATED) and the real built app over CDP (13/13) | `electron_validation.txt/json`, `real_app_smoke.txt/json`, `*.cjs` |
| `regression/` | exact counts | `lapitaya-suites-summary.txt` (16 La Pitaya suites **361/361**), `full-repo-tests.txt` (**1212 tests · 1179 pass · 22 fail · 11 skipped**), `nonlapitaya-failing-tests.txt` + `baseline-v012-nonlapitaya-failing-files.txt` (the 22 are identical to v0.12), `typecheck.txt`, `build.txt` |

Reproduce: `node --test test/lapitaya-cima-v0.14.test.cjs` · `node evidence/…/regression/run_lapitaya_suites.cjs` · `env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron evidence/…/electron/electron_validation.cjs` · `node evidence/…/electron/real_app_smoke.cjs` (after `npm run build`).
Note: in some shells `ELECTRON_RUN_AS_NODE=1` is set (e.g. inside an editor extension host); Electron then runs as plain Node and `app` is undefined — unset it for the Electron scripts.
