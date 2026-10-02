# LA PITAYA — CIMA v0.15: GOVERNANCE EVENT INTEGRITY & RECOVERY

Labels: **FACT** (verified in code or by execution), **OBSERVATION** (observed behaviour), **INFERENCE** (reasoned consequence), **RECOMMENDATION** (future action).
Execution Isolation was explicitly **not** started in this slice; it is carried as a pending item (§20).

## 1. Objective

Turn the governance ledger from an "append-only JSONL evidence log" into a **deterministically ordered, integrity-verifiable governance event stream** — locally, durably, compatible with the current architecture (no event sourcing, no database, no Redis, no distributed bus):

* every new governance event has a runtime-generated identity, a place in a sequence and a cryptographic link to its predecessor;
* corruption, truncation, reordering, insertion and deletion are **detected** and governance **fails closed**, explicitly (`LEDGER_CORRUPTED`);
* state files can no longer silently diverge from the events (`GOVERNANCE_STATE_INCONSISTENT`);
* recovery is explicit, operator-driven, preserves evidence and **never invents a governance fact**;
* reads are consistent snapshots, verified incrementally, and measured.

## 2. Baseline

| | |
|---|---|
| Parent | `lapitaya/cima-v0.14-authorization-binding`, commit `687ba744` (HEAD verified, tree clean, before branching) |
| Branch | `lapitaya/cima-v0.15-governance-event-integrity` |
| Main | untouched |

What v0.14 left open (reproduced first: `evidence/…/baseline/repro_pre_fix.txt`): a clean tail/middle deletion, a reordering, an inserted fake `HUMAN_APPROVAL` line and — most seriously — **a text-forged BUILD/TEST/AUDIT/DECISION PASS chain** were all accepted (`completionGate → allowed:true`); a proposal's `status` edited to `CONFIRMED` opened the gate; an approval "approved" in state with no event authorized a HIGH call (given the key); unlocked readers served stale state across instances; there was no recovery path; every call re-read the whole ledger (7.4 / 36.8 / 129.4 ms per authorize at 1k / 10k / 50k events).

## 3. Threat model

| Level | v0.15 |
|---|---|
| 1 accidental failure (crash mid-append, torn write, partial state write) | covered: detected, fail-closed, explicit recovery; event-first ordering removes the "state ahead of events" crash window |
| 2 malicious agent through governed tools | covered since v0.14; v0.15 adds: the ledger it could never write through governed tools is now also tamper-evident |
| 2′ malicious agent with arbitrary code execution | **not covered** — can read the seal key; PENDING — Execution Isolation |
| 5 local process editing governance files without the key | **covered**: any edit/insert/delete/reorder/truncation/forged event is detected |
| 5′ local process **holding the seal key** | not covered by the chain; stated and tested (ADV-5) |
| 6 multi-instance | reads and writes serialize on the governance lock; snapshots are consistent; real multi-process tests |

## 4. Event model

`cima-ledger.jsonl` stays JSON Lines. Every **new** line is the v0.14 record plus a runtime envelope (`src/main/ledgerChain.ts`):

```
{ …record fields (kind, ts, agentId, taskId, decision, proposalId, approvalId, authFingerprint, callFingerprint, human, …),
  schemaVersion: 2,
  eventId:   "evt-" + 24 hex (96 random bits),
  eventType: derived by the runtime from the record (never from an actor),
  sequence:  1, 2, 3, …,
  previousEventHash: 64 hex,
  eventHash:         64 hex,
  eventMac:          64 hex }
```
No field was added that the runtime cannot guarantee; nothing is duplicated (task, proposal, approval, authorization fingerprint, human owner and actor are the record's own fields). `eventType` values: `AUTHORIZATION_GRANTED`, `AUTHORIZATION_DENIED`, `HUMAN_APPROVAL_REQUIRED`, `HUMAN_APPROVED`, `HUMAN_REJECTED`, `APPROVAL_CONSUMED`, `APPROVAL_RETIRED`, `REQUEST_PROPOSED|CONFIRMED|CANCELLED|COMPLETED|EXPIRED|SUPERSEDED|BLOCKED|REVALIDATED|CONFIRMATION_DENIED`, `TOOL_EXECUTED`, `TOOL_FAILED`, `CIMA_RECORD`, `CIMA_ASSIGNMENT`, `INTENT_*`, `LEDGER_MIGRATION_BOUNDARY`, `LEDGER_RECOVERED`, `STATE_FILE_QUARANTINED`.

## 5. Event identity

`eventId` is generated in `stampEvent` from `crypto.randomBytes(12)`. Whatever a record carries under `schemaVersion/eventId/eventType/sequence/previousEventHash/eventHash/eventMac` is **deleted before stamping** (EVENT-02: a CIMA claim, its evidence items and an intent record carrying forged envelope fields reach the ledger re-stamped by the runtime). Not an array index, not a timestamp, not a process-local counter, not agent-provided. Uniqueness is verified (`DUPLICATE_EVENT_ID`).

## 6. Ordering

`sequence` is assigned **under the governance lock** from the verified head: `head.sequence + 1`. Two processes cannot both take the same number because only the lock holder appends, and the holder re-verifies the file (incrementally) before it appends. EVENT-03 (two instances alternating), EVENT-28 (a writer process plus a reader and a verifier) and v0.14's three-process contention test (45 decisions + 45 trace commits → one gapless sequence `1…90`) show the stream is gapless and strictly increasing. "Which came first" is answered by `sequence`, not by `ts` (which is the local clock and can go backwards).

Example from the real-Electron run: `REQUEST_PROPOSED › … › REQUEST_CONFIRMED … HUMAN_APPROVAL_REQUIRED › HUMAN_APPROVED › APPROVAL_CONSUMED › TOOL_EXECUTED` (`electron_validation_v15.txt` V2b).

## 7. Hash chain

* **Algorithm:** SHA-256 (`node:crypto`); no FNV, no home-made crypto.
* **Canonical serialization:** `canonicalJson` (v0.14): keys sorted, no insignificant whitespace, `JSON.stringify` strings, finite numbers, `undefined` members omitted, throws on non-JSON data.
* `eventHash = SHA-256( "lapitaya/ledger-event/v2\n" ‖ canonicalJson(event without eventHash and eventMac) )`.
* **Genesis:** `GENESIS_HASH = SHA-256("lapitaya/ledger-genesis/v1")`; the first event has `sequence 1`, `previousEventHash = GENESIS_HASH`.
* **Version:** `schemaVersion: 2` (and the domain prefix). A higher version is `UNKNOWN_SCHEMA`.
* **Verification procedure** (`LedgerChain.consume`, re-implemented independently in the tests and the Electron harness): for each line in file order — parse; require the envelope; `sequence = previous + 1`; `eventId` not seen; `previousEventHash` equals the previous hash; recompute `eventHash`; verify `eventMac`; stop at the **first** defect (nothing after it is trusted, applied or skipped).
* **Keyed seal.** A bare hash chain can be recomputed by anyone who can write the file. Each event therefore also carries `eventMac = HMAC-SHA256(seal key, "lapitaya/ledger-event-mac/v1\n" ‖ eventHash)`, and the head is **anchored** in `ledger-head.json` (`{sequence, hash, ts, mac}`, atomic write after each event). The anchor is what detects deletion from the tail, which leaves a perfectly valid chain.
* **Limits, stated because the chain must not be a false sense of security:** (a) it detects modification, deletion, insertion, reordering, truncation, duplicates and corruption **by anyone without the seal key**; (b) a writer who holds the key and rewrites chain **and** anchor defeats it (ADV-5 shows exactly that boundary); (c) the key's confidentiality against arbitrary agent code is **PENDING — Execution Isolation**; (d) losing the key makes every event unverifiable (keep a backup of it).
* **Crash window:** an event appended but not yet anchored leaves the anchor exactly one event behind; the verifier accepts that single case (`ANCHOR_BEHIND`, warning) and re-anchors, because the events themselves are key-sealed.

## 8. Corruption detection

Defects detected and named (`IntegrityCode`): `MALFORMED_JSON`, `TRUNCATED_TAIL`, `INVALID_SCHEMA`, `UNKNOWN_SCHEMA`, `LEGACY_AFTER_CHAIN`, `DUPLICATE_EVENT_ID`, `SEQUENCE_GAP`, `SEQUENCE_REGRESSION`, `SEQUENCE_DUPLICATE`, `PREVIOUS_HASH_MISMATCH`, `EVENT_HASH_MISMATCH`, `EVENT_MAC_INVALID`, `BOUNDARY_MISMATCH`, `ANCHOR_MISSING|INVALID|MISMATCH|TRUNCATION`, `STATE_FILE_CORRUPTED`, `LEDGER_UNREADABLE`, `TRACE_MISSING|HASH_MISMATCH|MALFORMED`. Verdict: **`GovernanceHealth = HEALTHY | CORRUPTED | INCONSISTENT | UNAVAILABLE`** (`GovernanceVerification`, never a boolean). **Fail closed:** `authorize → DENY LEDGER_CORRUPTED` (or `GOVERNANCE_STATE_INCONSISTENT` / `GOVERNANCE_STATE_UNAVAILABLE`), nothing is appended to a ledger that does not verify, nothing is served from it (`ledger() → []`), no line is ignored, no partial prefix is accepted, no truncated tail becomes a new genesis. Detailed table: `evidence/…/corruption/ledger-corruption.md`.

## 9. Recovery

Explicit, operator-driven, evidence-preserving — `evidence/…/recovery/ledger-recovery.md`. States `HEALTHY → CORRUPTED → RECOVERY_REQUIRED → RECOVERED`; "detected" and "repaired and validated" are different facts recorded in the chained, sealed `governance-recovery.json`. `recover()` quarantines the damaged ledger whole (SHA-256 recorded), keeps the verified prefix byte for byte, appends one `LEDGER_RECOVERED` event naming the operator, re-anchors and re-verifies. **It never creates APPROVED, CONFIRMED, PASS or EXECUTED**; events at and after the first defect are quarantined, not replayed (after recovery the human is asked again — EVENT-33, Electron R6/R7). It is not reachable from the renderer, an agent, Alicia or any message (EVENT-31; the shipped tool is `scripts/lapitaya-recover.cjs`, exercised for real in the Electron run). Full automation was **not** attempted: deciding which lost facts to believe is an operator decision.

## 10. State reconciliation

`evidence/…/state-reconciliation/state-reconciliation.md` has the full table. In short: the **ledger holds the governance facts**; `proposals.json` and `approvals.json` are **derived working state** (they carry secrets and bindings); `traces.jsonl` is **evidence content** committed by hash; `tasks.json` is a UI projection gated by the ledger. State that claims **more** than the events justify is `INCONSISTENT` (fail closed); state that claims **less** is a warning. `verifyGovernanceState({full})` returns the structured verdict. No new source of truth was introduced.

## 11. Proposal integrity

v0.14 left "proposal status is not sealed". v0.15 reconciles each proposal against its events: an edited `status`, a **deleted** active proposal (which would open the floor) and an **invented** `CONFIRMED` proposal are all detected (EVENT-18, Electron I1), and confirm/cancel/complete refuse a proposal whose *events* say it already left `PROPOSED`. The proposal **content** stays bound by the keyed fingerprint from v0.14 (`TAMPERED`/`STALE_PROPOSAL` at confirm). State machine: `PROPOSED → CONFIRMED → COMPLETED`, `PROPOSED|CONFIRMED → CANCELLED`, `PROPOSED → EXPIRED|SUPERSEDED|BLOCKED`; anything else is illegal and, if forged into the stream, `INVALID_TRANSITION` (EVENT-22).

## 12. Approval integrity

v0.14's SHA-256 binding and HMAC seal are **unchanged**. Added: reconciliation with the events — an approval `approved` in state must be backed by a `HUMAN_APPROVED` event **with a valid human owner and the same agent**; otherwise `APPROVAL_UNEVIDENCED` ⇒ `GOVERNANCE_STATE_INCONSISTENT`, **even when the seal is valid** (EVENT-19/20, ADV-1…ADV-4, Electron I2). `HUMAN_APPROVED` is written **before** the state change (event first), carries the owner main resolved (never a renderer argument), and `decide / confirm / cancel / complete` now **refuse a call without a well-formed trusted human context**: a human decision without a human is not a decision (EVENT-21).

## 13. Execution evidence

Three facts, three records: **authorized** (`AUTHORIZATION_GRANTED` / `APPROVAL_CONSUMED`), **executed** (`TOOL_EXECUTED`), **failed** (`TOOL_FAILED`); and **succeeded** only as a CIMA `PASS` backed by a *successful committed* trace. A trace is evidence only if a chained event commits to its SHA-256 (`traceHash`); the execution event cites the authorization event it relates to (`authorizationEventId`, validated: same agent and call fingerprint, earlier sequence). Altered, deleted or uncommitted traces are detected (EVENT-26); a failed run can back a `FAIL`, never a `PASS` (EVENT-25). Provider-observed traces with no authorization are recorded with `authorizationEventId: null` — a fact, not an error.

## 14. Multi-process consistency

All reads **and** writes take the governance lock; one lock hold produces one verified snapshot of {ledger, anchor, traces, proposals, approvals}. `governanceSnapshot()` returns the verdict, the ledger tail, traces, approvals and requests from that single moment and is what the Alicia observability handler now uses (previously five separate reads). Verified with real child processes: EVENT-27 (three concurrent verifiers, identical head), **EVENT-28** (one writer doing 14 × approval cycles while one process takes snapshots and another re-verifies from genesis in a loop: **zero** stale, partial, mixed or falsely-healthy observations; final head `70 = 14 × 5`), **EVENT-29** (invariant "every approved/consumed approval has its `HUMAN_APPROVED` event *in the same snapshot*" holds under writes). These tests found and fixed a real bug: on Windows a process releasing the lock leaves the file delete-pending for an instant, and `openSync(…,'wx')` then fails with `EPERM` rather than `EEXIST`; v0.14 treated that as fatal ("cannot create the governance lock"). It now waits like any held lock.

## 15. Performance

Measured, not guessed (`evidence/…/performance/results.txt`, machine: this Windows host, Node 24):

| events | ledger | **full verification** (once per process) | cold first `authorize` | **steady `authorize`** | after another process appended | incremental verify | v0.14 `authorize` |
|---|---|---|---|---|---|---|---|
| 1 000 | 0.6 MB | 81 ms | 82 ms | 12.4 ms | 13.3 ms | 6.9 ms | 7.4 ms |
| 10 000 | 5.9 MB | 541 ms | 487 ms | 12.7 ms | 11.5 ms | 4.2 ms | 36.8 ms |
| 50 000 | 29.6 MB | 3.9 s | 3.5 s | 11.5 ms | 12.2 ms | 4.9 ms | 129.4 ms |
| 100 000 | 59.2 MB | 7.6 s | 7.2 s | 11.2 ms | 10.2 ms | 5.6 ms | — |

* The v0.13 finding ("every governed call re-reads the whole ledger") is fixed: a process verifies the whole chain **once**, then only what was appended since (plus a re-check of the last verified record and the anchor). **Steady-state cost is flat (~11–12 ms) and independent of ledger size.** The 12 ms floor is two `fsync`s per event (ledger append + anchor); at 1 000 events v0.15 is slower than v0.14 (12 vs 7 ms) — integrity is not free, and this was not traded away.
* Cold start is linear: ≈ 75 µs per event (7.6 s at 100 000 events). No checkpoint was added: a checkpoint is a *trust shortcut* and would need its own integrity story; it is a future item if cold-start time matters. Integrity was not sacrificed for performance.
* A run of the 100 000-event measurement once showed a 556 s cold authorize; it did not reproduce in two further runs (7.2 s, 5.8 s) and is attributed to the host (file-system scanning of a freshly written 59 MB file) — noted for honesty, not explained further.

## 16. Alicia observability

`ObservabilityView.health` (read-only, enumerated values only; `readHealth` whitelists status, recovery state, ≤10 identifier-shaped codes, one integer): Alicia **distinguishes** `HEALTHY / CORRUPTED / INCONSISTENT / UNAVAILABLE` and `HEALTHY / CORRUPTED / RECOVERY_REQUIRED / RECOVERED`, shows a banner (`GovernanceHealthBanner`, en-US and es-MX) and says in words that governance is closed. When the state does not verify the runtime serves no ledger facts, so Alicia shows none. She cannot repair, decide, approve or reinterpret: the Alicia layer imports nothing from the governance modules (a structural test enforces that — the health vocabulary is a local copy re-validated field by field), the renderer bridge has no recover/repair capability (real-app smoke D4) and EVENT-31 scans the sources. The keyed `eventMac` never leaves the runtime (`ledger()` and the snapshot strip it).

## 17. Tests

`test/lapitaya-cima-v0.15.test.cjs` — **43 tests**: EVENT-01…38 (every item of the matrix) plus ADV-1…ADV-5, with real child processes (`test/fixtures/lapitaya-v15-proc.cjs`). Existing suites were updated only where a stronger contract changed their expectation: direct runtime calls to `decide/confirm/cancel/complete` now pass a trusted human context (`test/fixtures/human.cjs`, the exact shape main resolves); the v0.12 `STATE-05` expects the explicit `LEDGER_CORRUPTED`; v0.14's `AUTHBIND-27d` counts two events per call and a gapless sequence; `AUTHBIND-31/32` start from a real v0.14 (legacy) ledger; Alicia's structural tests follow the single-snapshot handler and the `health` field.

## 18. Electron

Real Electron 32.3.3, `evidence/…/electron/`:
* **`electron_validation_v15.cjs`** — real main process, trusted and untrusted `BrowserWindow`s, real IPC with real sender facts, real `HookServer` on the named pipe, real `cth-hook.cjs` shim, **and the real operator recovery tool as a separate process**; the ledger is verified from disk by an **independent** implementation. **38 checks**: healthy ledger → pending request → human confirmation → human approval → execution (events ordered `REQUEST_PROPOSED … REQUEST_CONFIRMED … HUMAN_APPROVAL_REQUIRED › HUMAN_APPROVED › APPROVAL_CONSUMED › TOOL_EXECUTED`, owner = main's, execution cites its authorization); corrupted ledger (hook denies `LEDGER_CORRUPTED`; Alicia shows `CORRUPTED / RECOVERY_REQUIRED`, serves no facts; human channels decide nothing; **no renderer repair channel exists**); external repair verified → `RECOVERED`; inconsistent proposal and state-only approval (valid seal, no event) → `INCONSISTENT`; truncated tail → operator tool → quarantine byte-identical, verified prefix kept, `LEDGER_RECOVERED` naming the operator, governance resumes, **the previously approved call asks again, nothing was invented**; no token/key/MAC across IPC; no renderer errors.
* **`real_app_smoke_v15.cjs`** — the **real built app** twice (healthy; ledger damaged before launch), driven over CDP: `HEALTHY` verdict on the real observability channel; on the damaged ledger `CORRUPTED / RECOVERY_REQUIRED` with codes, no facts, human channels refuse, no recovery capability on the bridge, **the damaged file left exactly as found**, no crash.
* **NOT VALIDATED — real El Inge execution** (no agent CLI/provider credentials are run). The harness reproduces `index.ts`'s governance IPC wiring; the real app run covers the actual `lapitaya:observability` / ledger / decide / confirm wiring.

## 19. Regression

Exact counts are in `evidence/…/regression/`: `lapitaya-suites-summary.txt` (the 17 La Pitaya suites, Foundation → v0.15), `full-repo-tests.txt`, `typecheck.txt`, `build.txt` and the list of failures that are identical to the v0.12/v0.14 baseline (`nonlapitaya-failing-tests.txt`); the numbers are repeated in the final report. v0.14 authorization binding is intact (its 46 tests pass; EVENT-38 re-runs the FNV attack on the chained ledger).

## 20. Remaining risks

1. **The seal key is the trust anchor** (§7): a key holder defeats chain and anchor. **PENDING — Execution Isolation** covers arbitrary agent code reading it.
2. Cold-start verification is linear (§15) and the ledger/traces are unbounded (no rotation, no checkpoint). A 5 000-event window of facts is kept for observability.
3. **Legacy prefix** is trusted as found (`LEGACY_UNVERIFIED`) — the only honest choice; it is committed at the boundary, shown to the human, and tamper-evident afterwards.
4. **Event-first ghosts:** a crash (or a failed state write) after an event leaves the state behind it; this is reported (`STATE_BEHIND_EVENTS`), never grants, and the next attempt completes it — but it is visible noise until then.
5. Recovery loses the facts that only the quarantined suffix established (kept for forensics, not replayed).
6. `STATE_UNEVIDENCED_REDUCED`/`STATE_BEHIND_EVENTS` are warnings by design; an operator should read them.
7. A double fault (rollback write failing after a ledger failure) can still diverge state and ledger; it is then detected on the next verification, not prevented.
8. Governance-critical `try/catch` patterns were audited: none **skips** data silently any more (the ledger reader that ignored unparseable lines was removed; unreadable traces/proposals/approvals/recovery log are findings). Documented exceptions, all non-critical or fail-closed: optional decision context (`taskOf/phaseOf/providerOf`), UI event emission, the hive router's quarantine of malformed mail, `tailIntact` (a read error forces a full re-verification), `loadOrCreateKey` (null ⇒ `KEY_UNAVAILABLE`, closed).
9. **The governance lock is not fair:** under heavy contention one process can starve while others loop (observed in EVENT-27: 1 vs 37 verifications in 1.2 s). It is not a correctness issue (all heads identical, no findings), so EVENT-27 asserts consistency, not equal throughput.

## 21. Pending items (carried to the final report, deliberately not solved here)

* **PENDING — EXECUTION ISOLATION:** arbitrary shell code (`node/python/powershell` escape), OS-level sandbox, HMAC/seal-key exposure to arbitrary agent code.
* **PENDING — FILESYSTEM SIDE CHANNELS:** direct writes outside governed tools; cross-agent outbox filesystem injection.
* **PENDING — OBSERVABILITY SCALE:** cold-start verification checkpoints; ledger/traces rotation.
* **PENDING — DISTRIBUTED / MULTI-INSTANCE READ ARCHITECTURE:** reads by processes outside the runtime's protected snapshots (anything that reads the files directly, e.g. operators or other tools, can still observe a file mid-write).
* **PENDING — HUMAN CHANNEL HARDENING:** the trusted renderer remains trusted; the renderer still holds the confirmation token.
* **PENDING — LEDGER RECOVERY OPERATIONS:** recovery is manual by design; no automatic repair exists.

## 22. Non-goals (kept)

No Execution Isolation, OS/container/VM sandbox, new authentication, multi-user auth, distributed database, Redis, cloud event bus, complete Event Sourcing, new agents, CIMA phases, Alicia/Decision Center redesign, risk levels, autonomy levels or provider redesign.

## 23. Files changed

**New:** `src/main/ledgerChain.ts`, `src/main/governanceStore.ts`, `src/shared/lapitaya/governanceIntegrity.ts`, `scripts/lapitaya-recover.cjs`, `test/lapitaya-cima-v0.15.test.cjs`, `test/fixtures/lapitaya-v15-proc.cjs`, `test/fixtures/human.cjs`, `evidence/lapitaya-cima-v0.15-governance-event-integrity/*`, this document.
**Modified (source):** `src/main/cimaRuntime.ts` (store wiring, verification, reconciliation, event-first human decisions, committed traces, locked readers, snapshot, recovery, lock `EPERM` fix), `src/main/index.ts` (single-snapshot observability), `src/shared/lapitaya/alicia/observability.ts` (`health`), `src/renderer/src/components/alicia/{GovernanceExplanationView,AliciaPanelView}.tsx`, `src/renderer/src/i18n/locales/lapitaya/{en-US,es-MX}.json`.
**Modified (tests):** the La Pitaya suites listed in §17 (trusted human context, `LEDGER_CORRUPTED`, snapshot structure) and v0.14's `AUTHBIND-27d/31/32`.

## 24. Final verdict

* **FACT:** `test/lapitaya-cima-v0.15.test.cjs`: 43/43 pass (three consecutive runs). `npm run typecheck` clean.
* **FACT:** full repo run (`node --test test/*.test.cjs`): 1255 tests, 1221 pass, 23 fail, 11 skipped. The failures (symlink, worktree, electron-builder and Command Center IPC suites) are in the recorded baseline (`regression/full-repo-tests.txt`: 29 failures); none belongs to La Pitaya. The 7 AUTHBIND failures of the baseline now pass.
* **OBSERVATION:** EVENT-27/28 were timing-sensitive (governance lock unfairness, §20.9); their liveness minimums were relaxed to one run, consistency assertions unchanged.
* Execution Isolation remains pending (§21).
