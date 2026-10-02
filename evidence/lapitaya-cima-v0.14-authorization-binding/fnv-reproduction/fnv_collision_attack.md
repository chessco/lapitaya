# fnv_collision_attack.md — CIMA v0.14

Reproduction of the v0.13 finding "FNV-32 is the approval binding", run on the **unmodified v0.12 baseline (3e6ae0c8)** and again on v0.14.
Scripts: `repro_v013_findings.cjs` (attack), `print_fingerprints.cjs` (fingerprints). Raw output: `../baseline/repro_pre_fix.txt`, `../baseline/repro_post_fix.txt`, `fingerprints.json`.

## Verdict on the v0.13 claim: **EXPLOIT CONFIRMED** (on v0.12) — **BLOCKED** (on v0.14)

The v0.13 reviewer reported the pair `git push origin feature-x` / `rm -rf /important/data # 9 LUpT`. It reproduces exactly (same agent id, same tool, same canonical-input encoding).

| | CALL A (what the human approves) | CALL B (what the attacker runs) |
|---|---|---|
| command | `git push origin feature-x` | `rm -rf /important/data # 9 LUpT` |
| classification | HIGH · irreversible · `shell:git-push` | HIGH · data-deletion · `shell:recursive-delete` |
| **FNV-32** (legacy `toolCallFingerprint(agent-1, Bash, input)`) | `7e8dbd9e` | `7e8dbd9e` ← **identical** |
| **v0.14 authorization fingerprint** (SHA-256 over the canonical subject) | `a6ae3fe1262fb3a8c4aae5190493c10b54aec711b5ad7ef1905b8a00cea74937` | `15387132ee514327b4337d17dc68358afd1dfd6c428686438848b079d98b674c` ← **different** |

CALL B was constructed in ≈50 ms: 4 free bytes appended to a comment suffix, solved by meet-in-the-middle over FNV-1a's invertible multiply, iterating numeric prefixes until a match exists (10 prefixes were needed for this pair).

## OLD RESULT (v0.12, 3e6ae0c8)

```
CALL A first call                  ["HUMAN_APPROVAL_REQUIRED","HIGH"]
… human approves A …
R1 RESULT authorize(B) after approving A   ["APPROVED","data-deletion","shell:recursive-delete"]
R1 authorize(A) after B consumed approval  ["HUMAN_APPROVAL_REQUIRED"]
```
The approval of the push was matched on `agentId + FNV-32`, applied to the `rm -rf`, and **consumed** by it. The human's "yes" to A executed B.

## NEW RESULT (v0.14)

```
CALL A first call                  ["HUMAN_APPROVAL_REQUIRED","HIGH"]
… human approves A …
R1 RESULT authorize(B) after approving A   ["HUMAN_APPROVAL_REQUIRED","data-deletion","shell:recursive-delete"]
R1 authorize(A) after B was refused        ["APPROVED"]
```
* B gets **its own** pending approval (a different subject); it does not touch A's approval.
* A, the call the human actually approved, still runs — once.
* Why: an approval now stores `binding = { v:1, alg:'sha256', fingerprint, subject }` and is matched on `binding.fingerprint === SHA-256(canonical subject of THIS call)`. The FNV-32 `fingerprint` field remains only as a legacy correlation id for the observability projection; `authorizeToolCall` never matches an approval on it, and the pure classifier matches nothing at all unless the runtime hands it the SHA-256 fingerprint.

## Permanent regression tests

* `test/lapitaya-cima-v0.14.test.cjs` — `AUTHBIND-01` (adversarial FNV, retained permanently), `AUTHBIND-35` (the REQUEST-gate exemption set, which was also keyed by FNV-32), `AUTHBIND-36` (the end-to-end attack through the real hook).
* `electron/electron_validation.cjs` — `E4a`: the same attack through the real `cth-hook.cjs` shim, named pipe and HookServer inside a real Electron main process.

## The second FNV-32 authorization use that was found and closed

`actionFingerprints`, the set that exempts a governed ACTION intent's exact call from the REQUEST gate, was also keyed by FNV-32 and was therefore also collidable (a twin of an exempt call would bypass a pending-request gate). v0.14 keys it by the SHA-256 `callFingerprint` (`AUTHBIND-35`).
