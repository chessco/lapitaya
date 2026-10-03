# LA PITAYA — DESKTOP COMPANIONS · FASE 2.2 REMEDIATION

## Runtime Phase Assignment & Verdict Semantics

Labels: **FACT** (verified by execution or in code), **OBSERVATION**, **INFERENCE**, **NOT PERFORMED**.

**Verdict: `PASS_WITH_OBSERVATIONS`** (§16). Per the phase rules this remediation cannot declare FASE 2 PASS; a **FASE 2.2 ACCEPTANCE GATE** (no code changes) must follow. FASE 3 was not started.

| | |
|---|---|
| Branch | `lapitaya/desktop-companions-v0.2.1-runtime-phase-assignment` (from `ec208a6e`) |
| Commits | `bfff279b` fix: wire live cima phase assignments to desktop companions · `06c7c477` fix: preserve blocked verdict semantics in companions |
| Validated HEAD | `06c7c477` (live run and harness) |
| Environment | Windows 11 Pro 10.0.26200 · Node 24.14.0 · Electron 32.3.3 · 3 displays (one at 150 %) |

## 1. Context

FASE 2 gate → FAIL; FASE 2 remediation → PASS_WITH_OBSERVATIONS; FASE 2.1 live-agent gate → FAIL on two findings only (automated, typecheck, build, CIMA and governance all PASS). The FASE 2.1 report (`docs/LA_PITAYA_DESKTOP_COMPANIONS_FASE_2_1_LIVE_AGENT_GATE.md`, commit `0ac74b25` on the previous branch) is unchanged.

## 2. FASE 2.1 findings

* **F1** — 0 `cima-assignment` in real operation: phase starts (BUILD/TEST/AUDIT → WORKING) never reached a companion; FOCUS could not follow a phase start.
* **F2** — a `BLOCKED` verdict was presented as a failure (CONCERNED, "El build no pasó.").

## 3. F1 root cause (FACT)

| Question (Part A) | Answer |
|---|---|
| Where is the worker created? | `processSpawnRequest` (`src/main/index.ts`), from `HIVE_ROOT/spawn-requests/<id>.json` written by El Inge |
| Where is the role known? | the request's `name` (agent identity); the CIMA phase was **not** carried anywhere structured |
| Where is the phase known? | only in El Inge's head / free text of `objective` |
| Where is the objective sent? | `hive.send({ to: workerId, … body: objective }, 'god')` — plain text |
| Where is the spawn recorded? | `log.jsonl` (`kind: spawn`), registry |
| Where is the ledger written? | `CimaRuntimeService` (hash-chained, MAC'd `cima-ledger.jsonl`) |
| Which existing event represents an assignment? | **`CimaAssignment`** (`kind: 'cima-assignment'`, `parseAssignment`, recorded by `CimaRuntimeService.handle()`, emitted as `cima-record`, translated by `fromRuntimeEvent` to `cima.phase.assigned`) |
| Does it exist but go unused? | **Yes.** Only the outbox router feeds it (`src/main/hive.ts`: a `cima` field without verdict on an outbox message → `cimaHandler` → `handle()`). The spawn path — the only way El Inge creates workers — had no structured field, and `PROTOCOL.md` documented result reporting only. |

## 4. F1 architecture analysis

No new concept and no parallel channel were needed: the runtime already has the assignment type, its ledger record, its event and its adapter. The missing link was one hop — getting a structured `{taskId, phase}` from the orchestrator's spawn request into `CimaRuntimeService.handle()`, exactly as the outbox router does. Authority stays with the runtime: it validates the shape (`parseAssignment`), writes the event (eventId, sequence, previousEventHash, eventHash, eventMac) and emits it. An assignment grants nothing: its only governance effect is making the task "governed", which makes the DECISION gate **apply** (stricter, never weaker). FACT: `completionVerdict` is the only consumer besides the observability adapters.

## 5. F1 implementation

* `src/main/spawnAssignment.ts` (new): `recordSpawnAssignment({ runtime, from, to, cima, messageId })` → `runtime.handle(from, to, cima, messageId)` only for a valid assignment; a `cima` carrying a **verdict** is refused (`not-an-assignment`) — the spawn path must never submit a claim in god's name.
* `src/main/index.ts` (`processSpawnRequest`): `SpawnRequest.cima?`; after `hive.send(...)` dispatches the objective, `recordSpawnAssignment({ runtime: lapitaya, from: godId, to: workerId, cima: raw.cima, messageId: dispatched.id })`; a refused/unrecorded `cima` is reported to god (the worker still runs).
* `src/main/hive.ts` (text only, regenerated into `PROTOCOL.md` on every bootstrap): new section *"CIMA (La Pitaya) — assigning a phase (orchestrator)"*; `cima` in the spawn-request example and El Inge's spawn instructions; "text in the objective is not recorded".
* **Not changed** (FACT): `CimaRuntimeService` (`src/main/cimaRuntime.ts`), `src/shared/lapitaya/cima.ts`, `IntentBoundary`, `humanGovernanceIpc.ts`, ledger chain, policy registry, autonomy, hooks, `preload/index.ts`, the companion preload/IPC/renderer.

## 6. F2 root cause (FACT)

`companionFactsFromAliciaEvent`: `ev.verdict === 'PASS' ? PASSED : FAILED` — every non-PASS verdict (FAIL **and** BLOCKED) became `*_FAILED`.

## 7. F2 semantic correction

`BY_VERDICT = { PASS → *_COMPLETED, FAIL → *_FAILED, BLOCKED → *_BLOCKED }`; any other verdict → no fact. `*_BLOCKED` → **PAUSED** with "… quedó en BLOCKED: sin validar todavía.". Decision (documented, no new business policy): PROTOCOL.md defines BLOCKED as "cannot validate (missing evidence, human approval needed) — BLOCKED is not FAIL"; FASE 2 already mapped Alicia's `BLOCKED` presence to `PAUSED`; PAUSED is the neutral grey state (not CONCERNED, not celebrated). A BLOCKED claim that the runtime **rejects** (violations) still arrives as `governance.blocked` and produces no companion fact — the task did not move.

## 8. Runtime flow

```text
El Inge ─writes─▶ spawn-requests/<id>.json { objective, cwd, name, cima:{taskId, phase} }
processSpawnRequest ─▶ spawnAgentCore(worker) ─▶ hive.send(objective) → messageId
                     ─▶ recordSpawnAssignment ─▶ CimaRuntimeService.handle(god, worker, cima, messageId)
                                                   └─▶ cima-ledger.jsonl  (chained + MAC'd)
                                                   └─▶ onEvent('cima-record', assignment)
```

## 9. Event flow

```text
onEvent ─▶ fromRuntimeEvent ─▶ cima.phase.assigned ─▶ companionFactsFromAliciaEvent ─▶ *_STARTED
        ─▶ DesktopPresence.observeAliciaEvents ─▶ phase owner WORKING (FOCUS follows it) ─▶ companion window
verdict: PASS ─▶ *_COMPLETED (CELEBRATING) · FAIL ─▶ *_FAILED (CONCERNED) · BLOCKED ─▶ *_BLOCKED (PAUSED)
```
The renderer, Alicia and the companion preload have no path into this flow (COMP-81, harness A11, ADV-09/10).

## 10. Test matrix

| ID | Proves | Runtime |
|---|---|---|
| COMP-72/73/74 | spawn assignment BUILD/TEST/AUDIT → El Beni / Margarito / José Juan WORKING | **real `CimaRuntimeService`** (temp hive), wired like `index.ts` |
| COMP-75 | FOCUS follows the assignment (not the completion) | real runtime |
| COMP-76 | COMPANY ≤ 3, independent states, an assignment never moves another companion | real runtime |
| COMP-77/78/79 | PASS / FAIL / BLOCKED → CELEBRATING / CONCERNED / PAUSED; unknown verdict → nothing | adapter + presence |
| COMP-80 | BLOCKED bubble: runtime-fact, `BUILD_BLOCKED`, no failure text | presence |
| COMP-81 | no assignment from the renderer (forged IPC on every channel) nor from a verdict-bearing spawn `cima`; nothing reaches the ledger | real runtime |
| COMP-82 | identity: `from: god`, `to: worker`, `messageId` = dispatch; companion fact `ref` = dispatch | real runtime |
| COMP-83 | task identity and phase normalised by the runtime | real runtime |
| COMP-84 | assignment carries eventId/sequence/previousEventHash/eventHash/eventMac; chain verifies HEALTHY; tampering detected; wired in `processSpawnRequest`; documented in PROTOCOL | real runtime |

## 11. Real Electron validation (harness, real runtime)

`evidence/lapitaya-desktop-companions-fase2.2/electron/real_runtime_assignment.cjs` — real HiveManager dispatch + real `recordSpawnAssignment` + real `CimaRuntimeService` + real DesktopPresence windows with the built renderer. **FACT: 13/13 PASS**: A1/A3/A5 spawn BUILD/TEST/AUDIT → WORKING; A2/A4/A6 PASS → CELEBRATING; A7 FOCUS + TEST assignment → only Margarito WORKING; A8 FAIL → CONCERNED "no pasaron"; A9 BLOCKED → PAUSED, BLOCKED text; A10 three distinct states; A11 verdict-bearing spawn `cima` refused, nothing recorded; A12 5 assignments chained/MAC'd, ledger HEALTHY; A13 no console errors. Captures `electron/captures/` (window contents only).

## 12. Live-agent validation (El Inge real, workers real, hive real, HEAD `06c7c477`)

F1-before (FACT, `live/F1-before.txt`): **0** `cima-assignment` in the real ledger (539 lines). El Inge was messaged through the normal composer (`live/mensaje-el-inge*.md`); the observer (`live/watch_ledger.cjs`) linked every capture to its ledger record (`live/timeline.jsonl`).

| # | Real record (ledger seq) | Companion | Result |
|---|---|---|---|
| — | **9 spawn requests, all with structured `cima`** → **9 `cima-assignment`** (seq 269, 295, 321, 360, 399, 424, 461, 505, 535), all `god → worker`, linked to the dispatch message, hashed + MAC'd | — | **PASS** (F1 live) |
| 014 | assignment BUILD LP-COMP-22-2 (399) | **El Beni WORKING** + "✓ hecho verificado · El Beni está construyendo." | **PASS** |
| 016 | BUILD claim BLOCKED **rejected** by runtime (`EVIDENCE_FIRST`, 444) | El Beni stays WORKING — no false failure | **PASS** |
| 020 | BUILD PASS (493) | Alicia CELEBRATING, El Beni released | **PASS** |
| 021 | assignment TEST (505) | **Margarito WORKING** (El Beni IDLE) | **PASS** |
| 024 | assignment AUDIT (535) | **José Juan WORKING** (Margarito IDLE) | **PASS** |
| 025 | AUDIT PASS (555) | José Juan CELEBRATING | **PASS** |
| 011/012 | BUILD **BLOCKED** LP-COMP-22-BLOCKED (379, no violations) | **El Beni PAUSED** (grey), not CONCERNED (`012-BLOCKED-el-beni-paused.png`) | **PASS** (F2 live) |
| 009/010 → 012/013 | 2 × HUMAN_APPROVAL_REQUIRED (git-push, git-destructive) → 2 × HUMAN_REJECTED via Decision Center | Alicia ATTENTION, sticky (`012-HIGH-…`) → calm after both rejections (`013-…`) | **PASS** |
| 018/019 | REQUEST `req-murnc8dq-2p` PROPOSED → CANCELLED | Alicia ATTENTION + sticky verified bubble → calm | **PASS** |
| COMPANY | throughout | ≤ 3, independent states (e.g. José Juan WORKING · Margarito IDLE · Alicia IDLE) | **PASS** |

Run notes (OBSERVATION): the first cycle (LP-COMP-22-1, seq 269–356) ran while the PC was **locked** (`LogonUI`); its ledger records are real but its screenshots showed the lock screen and were deleted — a second short cycle (LP-COMP-22-2) captured the WORKING states. The third BUILD attempt's result was dropped by the hive as malformed JSON (`log.jsonl: drop malformed-json`) and El Inge stalled until reminded. Human decisions were cancel/reject only: the REQUEST by the user, the two HIGH rejections by Claude through the Decision Center at the user's request.

## 13. Governance regression

* Companion suite **95/95** (82 previous + 13 new); typecheck **PASS**; build **PASS**.
* All 19 `test/lapitaya-*.test.cjs` suites PASS, incl. **CIMA v0.14 46/46, v0.15 43/43, v0.16 50/50**, CIMA runtime v0.3/v0.3.1/runtime, v0.10–v0.12, Alicia v0.4–v0.9, foundation (`regression/lapitaya-suites.txt`).
* **Protected files: UNCHANGED** (`regression/changed-files.txt`: `hive.ts`, `index.ts`, `spawnAssignment.ts`, `runtimeFacts.ts`, companion test).
* Stop conditions checked: no governance change; no renderer-emitted assignment (COMP-81, A11); no companion authority; BLOCKED ≠ FAIL; hash chain intact (COMP-84, A12); CIMA regression green; no forgeable event from the companion; no text parsing (the phase comes only from the structured `cima` field).

## 14. Evidence

`evidence/lapitaya-desktop-companions-fase2.2/` — `regression/` (tests, typecheck, build, suites, changed files) · `electron/` (harness, results, captures) · `live/` (F1-before, messages to El Inge, observer, `timeline.jsonl`, captures 012–025). No keys, tokens or HMAC material are stored.

## 15. Remaining observations

1. **FOCUS following an assignment** is validated with the real runtime (COMP-75, harness A7) but was **NOT PERFORMED live** (the live run stayed in COMPANY).
2. **Live ledger health** was not independently re-verified on the user's hive (the harness and COMP-84 verify HEALTHY on the same code path; every live assignment carries eventHash/eventMac/previousEventHash).
3. El Inge's compliance is protocol-driven: a spawn without `cima` still runs (no assignment, no WORKING) — by design, and god is told only when a `cima` is present but refused.
4. Hive robustness (outside companions): a worker's malformed outbox JSON is silently dropped and the orchestrator is not told.
5. Human-interface findings (outside companions, carried from FASE 2.1): "pregúntame" content is unreachable by wheel or Tab; Chromium zoom on the main window also shrinks the companions (same origin); the PC locking pauses visual evidence.

## 16. Verdict

# `PASS_WITH_OBSERVATIONS`

F1 and F2 are fixed and validated technically and **live**: real El Inge → real spawn with a structured `cima` → real `cima-assignment` in the chained ledger → real event → DesktopPresence → the correct companion in **WORKING** (El Beni, Margarito, José Juan), and PASS ≠ FAIL ≠ BLOCKED, without modifying CIMA authority. Observations §15 remain. Next: **FASE 2.2 ACCEPTANCE GATE** (no code changes). FASE 3 NOT STARTED.
