# LA PITAYA — CIMA v0.14: AUTHORIZATION BINDING & RUNTIME TRUST HARDENING

Labels used throughout: **FACT** (verified in code or by execution), **OBSERVATION** (observed behaviour), **INFERENCE** (reasoned consequence), **RECOMMENDATION** (future action).

## 1. Objective

Make it impossible to reuse, forge or divert a human authorization to a call other than the one the human authorized:

> approval of CALL A can never authorize CALL B — not through a hash collision, a similar command, an equivalent path spelling, another agent, task, provider, tool, risk, autonomy stage or request, a copied/edited/replayed/expired approval, or a forged sender.

Single-agent implementation (BUILD → TEST → LEARN → ITERATE → DOCUMENT); no second auditor. Human governance remains authoritative.

## 2. Baseline

| | |
|---|---|
| Product / slice | La Pitaya — CIMA v0.14 |
| Parent | v0.12 — branch `lapitaya/cima-v0.12-state-integrity-recovery`, commit `3e6ae0c8` (HEAD verified before branching) |
| Branch | `lapitaya/cima-v0.14-authorization-binding` |
| Main | untouched |
| Review input | `docs/LA_PITAYA_CIMA_RUNTIME_13_ARCHITECTURE_MATURITY_REVIEW.md` (carried in this branch; it was untracked at the start) |

## 3. v0.13 findings — reproduced first (nothing assumed)

Reproduction script `evidence/…/fnv-reproduction/repro_v013_findings.cjs`, run on the **unmodified v0.12** (`baseline/repro_pre_fix.txt`) and again after the fix (`baseline/repro_post_fix.txt`).

| v0.13 finding | v0.12 result (reproduced) | Status |
|---|---|---|
| C1 FNV-32 is the approval binding | `git push origin feature-x` approved → `rm -rf /important/data # 9 LUpT` returned **APPROVED** and consumed it; built in ≈50 ms | **EXPLOIT CONFIRMED** |
| C2 sender identity | a governed `Write`/shell into `agents/god/outbox/` was `ALLOW`/`SUPERVISED`; the router attributed the file to `god`. A file in the attacker's **own** outbox claiming `from:'god'` was already delivered as the attacker | **CONFIRMED** for foreign outbox; **NOT REPRODUCED** as a bypass for a fake `from` in the own outbox (already neutralized). `hive:send` accepted any renderer-supplied `from` (code reading; now tested) |
| C3 path identity | `C:/Windows/../…/lapitaya/approvals.json` → `SUPERVISED / config-change`; relative `lapitaya/approvals.json` → `config-change`; **new variant found**: `…/lapitaya./approvals.json` (Win32 drops the trailing dot) → `ALLOW / hive-coordination` | **CONFIRMED** (+1 variant) |
| H4 lock semantics | foreign fresh lock → `authorize` returned `ALLOW` in 2–6 ms, lock left in place | **CONFIRMED fail-open** |
| H5 secondary writes | ledger down: `decide()` → approved, no ledger record; `submit()` → PASS | **CONFIRMED** |
| H6 ledger recovery | next append glued to a truncated tail (v0.13); deny-all on a corrupt tail | glue **CONFIRMED & fixed**; no-repair-procedure **remains** (§19) |
| H7 93 failing legacy tests | 93 of 315 in 11 suites on HEAD (`IDENTITY_UNTRUSTED`) | **CONFIRMED & recovered** (§15) |
| not run by v0.13 | typecheck, build, Electron, real hook sockets, multi-process contention | **now run** (§17, §18, §13) |

## 4. Threat model

| Level | v0.14 stance |
|---|---|
| 1 accidental failure | covered (v0.12) + lock/secondary-write fail-closed |
| 2 malicious agent **acting through governed tool calls** | **in scope, closed** for approval reuse/forgery, sender spoof and path spelling (tests + real Electron) |
| 2′ malicious agent with **arbitrary code execution** (e.g. `node x.js`, classified MEDIUM) | not a sandbox: it runs as the same OS user (see §19) |
| 3 malicious provider | unchanged: hook payloads are trusted evidence |
| 4 compromised renderer | unchanged: the renderer *is* the human channel; v0.14 stops it from claiming any other identity |
| 5 local process attacker | unchanged beyond sealing |
| 6 multi-instance | lock is fail-closed; real multi-process test |

Principle added: **the actor never supplies its own canonical identity** — the subject, fingerprint, path meaning and sender are all derived by the runtime from the trusted execution context.

## 5. FNV reproduction

See `evidence/…/fnv-reproduction/fnv_collision_attack.md` (mandatory artifact). Summary: CALL A and CALL B share FNV-32 `7e8dbd9e`; their v0.14 fingerprints are `a6ae3fe1…74937` and `15387132…b674c`. OLD: `APPROVED`. NEW: B → `HUMAN_APPROVAL_REQUIRED` (its own pending approval), A → still `APPROVED`.

## 6. Authorization subject

`src/shared/lapitaya/authSubject.ts` (shape + canonical encodings, pure) and `src/main/authBinding.ts` (SHA-256/HMAC, node:crypto). Built **only** by `CimaRuntimeService.subjectFor` from runtime state:

```
subject = { v: 1,
  call:    { agent, provider, tool, targets[], input },     // WHAT
  context: { task, risk, category, mode, stage, rule, request } }   // UNDER WHICH GOVERNANCE CONTEXT
```
* `agent` — the identity the hook established from the capability token (v0.10), never the payload.
* `provider` — the roster's provider for that agent (`providerOf`, now wired in `index.ts`).
* `targets` — canonical keys (realpath-aware) of every path the call names, sorted and unique.
* `input` — SHA-256 of the canonical JSON of the **raw** input: any change of command, argument, content, option or **spelling** is a different call.
* `task` — `taskOf(agent)`; `risk/category/mode/rule` — the classifier's and autonomy policy's verdict; `stage` — the autonomy stage; `request` — the confirmed REQUEST proposal in force (or null).
* The subject holds **digests, never raw input, tokens or secrets** (test `AUTHBIND-33`).

## 7. Canonical encoding

`canonicalJson`: object keys sorted, no insignificant whitespace, strings via `JSON.stringify`, only finite numbers; `undefined` members omitted; throws on functions, symbols, bigint, cycles, non-plain objects, depth > 32 (the runtime then fails closed). Structured, so `("ab","c")` and `("a","bc")` cannot collide (`AUTHBIND-33`). Version `v:1` is part of the subject; each digest has a domain-separation prefix.

## 8. Cryptographic fingerprint

* **Algorithm:** SHA-256 (`node:crypto`; no home-made crypto).
* **Authorization fingerprint** = `SHA-256("lapitaya/authsubject/v1\n" ‖ canonicalJson(subject))`, 64 hex chars.
* **Call fingerprint** = `SHA-256("lapitaya/authcall/v1\n" ‖ canonicalJson(subject.call))` — keys the REQUEST-gate exemption and links a decision to its PostToolUse trace.
* **Input digest** = `SHA-256("lapitaya/authinput/v1\n" ‖ canonicalJson(input))`.
* **Collision assumption:** standard SHA-256 collision/second-preimage resistance (≈2²⁵⁶ work for a second preimage); no 32-bit hash, CRC, timestamp or randomness-alone is used as a security binding.
* **FNV-32 is retained only as a legacy correlation id** (`Authorization.fingerprint`, the ledger `fingerprint` field the Alicia projection joins on). `authorizeToolCall` never matches an approval on it; it matches nothing at all unless the runtime passes the SHA-256 fingerprint.
* **Migration:** see §9.

## 9. Approval binding

An approval now carries: `id`, `agentId`, `tool`, `createdAt`, **`expiresAt`**, `status` (`pending | approved | rejected | consumed | expired | invalid`), **`binding {v, alg:'sha256', fingerprint, subject}`**, **`consumedAt`**, decision fields, and a **`seal`** = HMAC-SHA256 over `{id, agentId, tool, status, createdAt, expiresAt, decidedAt, decidedBy, decidedOwner, consumedAt, binding.fingerprint}`.

An approval is **usable** only if: `status==='approved'`, same `agentId`, `binding.fingerprint === SHA-256(subject of THIS call)`, unexpired, binding recomputes from its stored subject (`bindingValid`), **and** the seal verifies (`approvalTrusted`). The actor cannot change fingerprint, task, agent, tool, target, risk or context after issue: any edit breaks the binding or the seal and the approval becomes `invalid / SEAL_MISMATCH`. When an approval exists for the *exact input* but under a different context the denial says `APPROVAL_CONTEXT_MISMATCH` and a new pending approval is raised (`AUTHBIND-08/10`).

* **Legacy approvals (v0.10–v0.12 state, FNV-only): hard invalidation.** At load, any `pending`/`approved` approval without binding/seal becomes `invalid / LEGACY_UNBOUND` (a `DENY APPROVAL_INVALID` ledger record is written). They are kept as history, can no longer be decided or consumed. **Operational consequence:** approvals pending at upgrade time must be requested again (the agent's retry raises a fresh one). A FNV-only approval can never authorize a new execution (`AUTHBIND-31`).
* **Seal key:** production wires it **outside the hive** (`<userData>/lapitaya-governance-seal.key`, created once, `0600`). Without the dependency the runtime keeps `<hive>/lapitaya/.seal.key` (tests, tools). No key → no approval can be created or trusted → fail closed.
* **TTL:** `pending` **and `approved`** approvals expire 24 h after creation (v0.12 expired only `pending`; an approved-but-unused approval lived forever).
* `REQUEST` proposals: the proposal fingerprint was FNV-32; it is now a **keyed HMAC-SHA256** over the canonical proposal content, so a hand-edited `proposals.json` cannot be re-signed; a legacy 8-hex fingerprint is refused as `STALE_PROPOSAL` (`AUTHBIND-40`).
* The REQUEST-gate exemption set (`actionFingerprints`) was **also** keyed by FNV-32; it is keyed by the SHA-256 call fingerprint (`AUTHBIND-35`).

## 10. Replay protection

Consumption is one-shot and durable *before* execution (v0.12), now sealed and rolled back if the decision cannot be recorded (§14). A consumed approval turned back into `approved` on disk fails the seal (`AUTHBIND-14`). Replaying CALL A raises a **new** pending approval and denies; CALL B is denied; a new request with the same command is a new authorization (denied until the human decides) (`AUTHBIND-13`). Expired approvals cannot be decided or used (`AUTHBIND-17`).

## 11. Path normalization

`canonicalizePath` (pure) + `CimaRuntimeService.canonicalPath` (filesystem-aware), computed **before** risk classification, authorization, binding, the task-ledger gate and the sender check.

* separators, duplicate separators, `.`/`..`, case, Win32 trailing dots/spaces, `\\?\`/`//?/` prefixes, UNC, drive designators, relative paths resolved against the agent's cwd (`cwdOf`), then the **real location** of the part that exists (symlinks, junctions, 8.3 short names via `realpath.native`).
* **Ambiguous → fail closed:** percent-encoded separators, `file:` URLs, NTFS streams/colons, drive-relative (`C:foo`), segments of only dots/spaces, a `..` above the root, 8.3 names that cannot be expanded, control characters. The call cannot even be bound to a subject: `DENY AUTH_SUBJECT_UNAVAILABLE` (no approval can unlock it).
* A relative path with no known cwd is judged as itself **and** as if it sat in the hive; the stricter classification wins.
* Governance state (`tasks.json`, `proposals.json`, `approvals.json`, ledger, traces, `bin/`, `registry.json`, agent `settings/identity/cursor`, `.seal.*`) is matched on the canonical key, not on strings; `taskLedgerWriteGate` compares canonical paths too.
* An approval for path A does **not** authorize an alternate spelling of A (the raw input digest differs) (`AUTHBIND-19`, `38`).
* Evidence: `path-normalization/path_table.txt` (18 spellings), `AUTHBIND-18/19/19b/19c` (junction to the governance dir is judged by its real location).

## 12. Sender authenticity

Sender identity comes from trusted execution context, never from payload, folder name or message text:

1. **Hook** — token ↔ `agent_id` (v0.10). v0.14 closes the "no tokens registered yet → trust the claimed id" fallback when governance is wired (`hooks.ts`).
2. **Outbox write boundary** — an agent sends only through **its own** outbox. A governed `Write/Edit/MultiEdit/NotebookEdit`, or a mutating shell command, that targets **another agent's `outbox`/`inbox`** is `DENY SENDER_IDENTITY` (no approval path) (`AUTHBIND-20`: 7 victims incl. `god`, `alicia`, 2 boxes, 6 call shapes).
3. **Router** — attribution = the owning directory (unchanged); a file that *claims* another known sender (`from`, `agent_id`, `sender`, `actor`) is logged `sender-spoof` and neutralized; a file carrying a capability token that is not the owner's is quarantined; a capability token is never relayed (`AUTHBIND-22`).
4. **Renderer `hive:send`** — `resolveRendererSender`: the renderer may speak **only as `human`**, only with a trusted human context resolved in main; any agent/orchestrator/Alicia identity, or a payload `from` that disagrees, is refused (`AUTHBIND-23/26`, real app `A4–A7`).

The human governance IPC (`decide/confirm/cancel/complete`) is unchanged: WHO decided is main's, never an argument (`AUTHBIND-26`).

## 13. Lock behavior

See `evidence/…/lock/README.md`. v0.12 failed open (confirmed). v0.14: **the operation does not run without the lock**; bounded wait (default 3 s) with back-off; owner token in the lock file, only the owner removes it; every entry point returns its own refusal (`DENY LOCK_UNAVAILABLE`, null, `{ok:false,code:'LOCK_UNAVAILABLE'}`, `BLOCKED/STATE_UNAVAILABLE`). Verified with a foreign lock, a stale lock, **a real second process** holding the lock, and **three real processes × 15 governed calls** (45 decisions + 45 traces, none lost, torn or glued) — `AUTHBIND-27/27b/27c/27d`.

## 14. Secondary writes

Each write audited (`evidence/…/secondary-writes/audit.md`). Propagating now: the human decision record (rollback to `pending`), the request confirm/cancel/complete records (rollback, token kept), the CIMA verdict and assignment (`BLOCKED / STATE_UNAVAILABLE`, never kept in memory), the trace (only durable traces count), pending-approval creation, and consumption (un-consumed and re-sealed when the decision record fails). Kept best-effort **by design** (they only move toward less authority): superseded/blocked/expired transitions, blocked-completion and deny records. Also fixed: a record is never glued onto a truncated tail.

## 15. Legacy tests

* **11 La Pitaya suites (93 failures at HEAD)** — fixtures called `HookServer.handle({agent_id})` with no capability token; v0.10 correctly refuses that. Fixed by making every fixture agent authenticate **with the production registry** (`hive.registerAgentToken(agentId)` → `agent_token`); no mock identity, no bypass flag, no test-only token (`AUTHBIND-29` asserts that, and that the same fixture without the token is refused). v0.10 security was **not** weakened.
* **Stale assertions updated to v0.10/v0.11 contracts (4):** `FC-10` (absent actor → `ACTOR_CONTEXT_MISSING`), `REQ-ARCH` (gate-before-approvals structure), `INTENT-NEG-03` (hive:send Alicia guard), `OBS-11` (the runtime's own `.seal.key`).
* **One production-semantics repair found while restoring the baseline:** v0.11's "a failed run cannot satisfy evidence" also made a **FAIL** claim unrecordable (a tester reporting a genuinely failing run got `BLOCKED`). `verifyEvidence(…, verdict)` now lets a FAIL cite a failing run; **PASS still requires a successful one** (`COVERAGE-13` unchanged).
* **26 non-La-Pitaya tests** that v0.10/v0.11 had broken the same way — HookServer tests without tokens (`hooks-notification`, `hive-roster-injection`, `standing-goal-injection`) and provider-fixture tests that spawn observe-only providers without the explicit human opt-out (`tui-theme-hint`, `crush-provider-config`, `hive-pi-models`, `hive-windows-prompt`, `proxy-bridge-retry` → `allowUngovernedProviders: true`, the production flag).

## 16. Adversarial attacks (all in `test/lapitaya-cima-v0.14.test.cjs`)

`AUTHBIND-01` FNV collision (permanent) · `03–12` every subject dimension · `13–17` replay/consumed/modified/copied/expired · `15/16` forged records incl. a fully consistent re-fingerprinted copy for another agent/task/provider (stopped by the seal) · `18/19/38/39` path attacks · `20–26` sender/human/provider/renderer spoof · `27*` lock · `28*` write failure · `30` forged v0.10 chain · `31/32` legacy and hand-written approvals · `33` canonical encoding/secrets · `34` decision↔trace link · `35` REQUEST-gate exemption · `36/37/38` the three end-to-end attacks required by the spec · `40` proposal binding.

## 17. Electron

Two real-Electron validations (Electron 32.3.3, Chromium 128), `evidence/…/electron/`:

* **`electron_validation.cjs`** — real Electron main process, real trusted and untrusted `BrowserWindow`s, real `ipcMain/ipcRenderer`, the real `humanIdentity` fed with real sender facts, the real `HookServer` on the hive's real **named pipe** and the real `<hive>/bin/cth-hook.cjs` shim spawned with the agent's `HIVE_AGENT_TOKEN` (the same path an agent CLI uses). **29 of 29 checks PASS** (E0–E8; E9 = real El Inge, reported NOT VALIDATED): human identity, REQUEST confirm/replay, HIGH approval, consumption, replay, the FNV twin through the real hook, other-agent use, modified approvals.json, path mutation, outbox spoof, renderer sender spoof, no renderer authority channel, no token/seal/key ever crossing IPC, no renderer errors.
* **`real_app_smoke.cjs`** — boots the **real built application** (`out/main/index.js`) in an isolated profile and drives its real renderer over CDP: bridge present (207 methods, none authorize/execute), the real renderer is the human, `hive:send` as `god`/`alicia`/mismatched `from` refused, as `human` accepted, no console errors, no main-process crash, no token in the main log. **13 of 13 PASS** (A0–A12).
* **NOT VALIDATED — real El Inge execution.** No agent CLI/provider credentials are run; the harness reproduces `index.ts`'s governance IPC wiring line for line (the real app run covers the actual `hive:send` wiring).

## 18. Regression

Exact counts: `evidence/…/regression/` — per-suite (`lapitaya-suites-summary.txt`), whole repository (`full-repo-tests.txt`), typecheck (`typecheck.txt`: `npm run typecheck` exit 0), build (`build.txt`: `npm run build` exit 0). Summary lines are in the final report. The 22 failures that remain in the whole-repository run are **identical, test for test, to the failures on the v0.12 baseline** (`baseline-v012-nonlapitaya-failing-files.txt`, run from a `git archive` of `3e6ae0c8`) and none involves governance: 15 need symlink privilege on Windows (`fs-path-containment` 10, `worktree-deps` 5 — `EPERM … symlink`), and 7 are stale structural/data assertions (`telemetry-message-count` 2, `hire-import`, `arabic-terminal`, `agent-token-cap`, `model-catalog-remote`, `release-notes`). They were not touched.

## 19. Remaining risks

1. **Arbitrary code execution is not sandboxed (FACT).** Shell classification is lexical (v0.13 S-5, shell redesign is a non-goal): `node fix.js`, obfuscated names and shell variables (`$D/outbox`) classify MEDIUM. Code an agent runs this way executes as the same OS user and can read the seal key and write the hive. The binding and sender rules are enforced at the governed tool boundary; they are not an OS sandbox (Level 2′/5).
2. **A non-governed filesystem actor can still plant a file in another agent's outbox**; the router can only attribute by directory. Governed writes there are refused; out-of-band writes are Level 5.
3. **Seal-key placement.** Production keeps it outside the hive; the fallback inside the hive (tests/tools) is only as private as the hive directory.
4. **The renderer is the human channel (Level 4):** `lapitaya:requests` returns the proposal's confirmation token to the renderer; a compromised renderer *is* the human. v0.14 prevents it from claiming any other identity.
5. **Proposal `status` is not sealed** (the proposal *content* is HMAC-bound). A writer of `proposals.json` could mark a request `CONFIRMED`; that bounds only non-HIGH work — every HIGH call still needs a sealed, bound approval.
6. **Double fault:** if a rollback write also fails after a ledger failure, state and ledger can diverge.
7. Unchanged from v0.13: a corrupt ledger tail denies every agent with no repair procedure; unlocked readers (`listApprovals`, `completionGate`, …) can be stale across instances; every governed call reparses the ledger (O(N)); providers whose shell tool is `shell`/`run_shell_command` produce no command evidence; `mcp__*` is a flat MEDIUM; `WebFetch` is LOW; `actionFingerprints` is never pruned.
8. FNV-32 remains in two **non-security** places: the legacy `fingerprint` correlation id and Alicia's `EVT-` event ids.
9. Real El Inge execution not validated (§17).

## 20. Non-goals (kept)

No new CIMA phases, agents, LLMs, Alicia/Decision Center redesign, distributed DB/Redis, cloud auth/OAuth, remote governance, event sourcing, ledger redesign, shell redesign, provider-architecture redesign, risk or autonomy levels. The only semantic change outside binding is the FAIL-evidence repair (§15), required to restore a green baseline.

## 21. Files changed

**New:** `src/shared/lapitaya/authSubject.ts`, `src/main/authBinding.ts`, `test/lapitaya-cima-v0.14.test.cjs`, `test/fixtures/lapitaya-contend.cjs`, `evidence/lapitaya-cima-v0.14-authorization-binding/*`, this document, and the v0.13 review (`docs/…13_ARCHITECTURE_MATURITY_REVIEW.md`, `evidence/lapitaya-cima-v0.13-architecture-review/*`).

**Modified (source):** `src/main/cimaRuntime.ts` (lock, subject/binding, seal, canonical paths, sender check, secondary writes, proposal HMAC, expiry), `src/shared/lapitaya/toolRisk.ts` (canonical-path classification, foreign-mailbox detector), `src/shared/lapitaya/governance.ts` (binding fields; approvals match only on the SHA-256 fingerprint), `src/shared/lapitaya/intent.ts`, `src/shared/lapitaya/cimaRuntime.ts` (`STATE_UNAVAILABLE`, FAIL evidence), `src/main/hooks.ts`, `src/main/hive.ts` (router sender claims), `src/main/humanGovernanceIpc.ts` (`resolveRendererSender`), `src/main/index.ts` (wiring: seal key, `cwdOf`, `providerOf`, `hive:send`), `src/main/intentBoundary.ts`.

**Modified (tests/fixtures):** `test/fixtures/lapitaya-floor.cjs`, `lapitaya-cima-runtime{,-v03,-v031}`, `lapitaya-alicia-v041/v042/v06`, `hooks-notification`, `hive-roster-injection`, `standing-goal-injection`, `tui-theme-hint`, `crush-provider-config`, `hive-pi-models`, `hive-windows-prompt`, `proxy-bridge-retry` (`*.test.cjs`).

## 22. Final verdict

**PASS_WITH_OBSERVATIONS**

Every critical security invariant listed in the slice passes and is evidenced: FNV twins and every other differing call are denied; exact-call binding, replay, copy, mutation, expiry, path-spelling and sender-spoof attacks fail — in unit/adversarial tests, in a real Electron main process with the real hook shim and named pipe, and against the real built application's IPC; the lock and the critical secondary writes fail closed; v0.10, v0.11 and v0.12 suites are green. The observations that keep this from an unqualified PASS are non-critical and documented: real El Inge/agent-CLI execution was **not** validated (§17), 22 unrelated tests were already failing at the v0.12 baseline (§18), and the residual risks of §19 — chiefly that arbitrary code an agent runs through the shell is not sandboxed — remain.
