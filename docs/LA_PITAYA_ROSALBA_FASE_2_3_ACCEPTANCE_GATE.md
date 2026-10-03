# LA PITAYA — FASE 2.3 · ROSALBA SENIOR DEVELOPER · ACCEPTANCE GATE

| | |
|---|---|
| Branch | `lapitaya/desktop-companions-v0.2.3-rosalba-senior-developer` |
| HEAD validated | `861bc78e` (code `83413587` + `320009eb`, base `b13585b2`) |
| Gate type | Validation only — **no code changed** (`git diff 861bc78e -- src test package.json` empty) |
| Date | 2026-10-03 (UTC) |
| Verdict | **PASS_WITH_OBSERVATIONS** · **FASE 2.3 CLOSED** |

## 1. Objective

Independently validate Rosalba (Senior Software Developer, 🐶) and close the FASE 2.3 gap: a **live** BUILD (Rosalba) → TEST (Margarito) → AUDIT (José Juan) chain through the real El Inge, the real CIMA runtime and the real desktop companions, without bypassing CIMA.

## 2. Baseline

```
Branch:        lapitaya/desktop-companions-v0.2.3-rosalba-senior-developer
HEAD:          861bc78e05a4d4c623964961ec1b56f131892cae
Working tree:  clean
Main:          2a5a5858 — untouched; nothing pushed
```

## 3. Environment

Windows 11 Pro 10.0.26200 · Node v24.14.0 · Electron 32.3.3 · `npm run dev` · real hive `C:\Users\chess\HarnessAgents` · El Inge = real Claude Code session (`god`) · workers spawned by the real HiveManager in `companion-gate-22` · three displays. Observation (read-only): `live/watch_ledger.cjs` (ledger tail + window captures) and a 0.7 s screen recorder (scratch, not committed) for the contact sheets. Ledger health is checked with `02-ledger-health/verify_ledger.cjs`, which runs the product's `verifyGovernanceState({ full: true })` on a **temporary copy** of `hive/lapitaya`: the live hive is never opened, and the seal key is loaded with the product's `loadOrCreateKey` and never printed.

## 4. Initial Runtime State

| Item | Observed (17:45 UTC) |
|---|---|
| Application | running (dev, branch above) |
| Running agents | El Inge idle; workers of earlier gates archived |
| Active task / phase | none for Rosalba; the previous `LP-ROS-LIVE-1` had **continued on its own** while the PC was locked and reached DECISION PASS |
| Margarito / José Juan | not running |
| Pending REQUEST / HIGH / approvals | none / none / none |
| Companion states | FOCUS, idle |
| Ledger | HEALTHY (§5), last sequence 1292 |

`LP-ROS-LIVE-1` continued with no human message in between:

1. BUILD PASS 1030 (Rosalba).
2. TEST assignment 1047/1093 to a first Margarito, who stalled on DECISION_GATE denials.
3. El Inge spawned a fresh Margarito (`test2`).
4. TEST **BLOCKED** 1140 (EVIDENCE_FIRST: one cited file not observed).
5. TEST **PASS** 1166 (verified `node --test stats.test.js`).
6. AUDIT PASS 1228 (`audit2`, verified).
7. DECISION BLOCKED 1247 (no evidence).
8. DECISION PASS 1283.

This is legitimate, with no bypass, but it has **no companion captures** because the observer was stopped. A new, fully observed chain was therefore run (§9–§13).

## 5. Initial Ledger Health

`02-ledger-health/initial-ledger-health.json`:

* status **HEALTHY**, recovery HEALTHY, full re-verification;
* 1292 events, headSequence 1292;
* chain and MAC verified;
* only warning `LEGACY_UNVERIFIED`: 283 pre-v0.15 events, known and accepted since v0.15.

A first attempt reported CORRUPTED. That was an error in the verification script, which read the hex key file as raw bytes. It was fixed by using the product's key loader; nothing was repaired.

## 6. Automated Regression

| Check | Result |
|---|---|
| `npm run test:companion` | **131/131** (95 existing + 36 ROS) |
| `npm run typecheck` | **PASS**, 0 errors |
| `npm run build` | **PASS** |
| CIMA | v0.14 **46/46** · v0.15 **43/43** · v0.16 **50/50** |
| All 20 `test/lapitaya-*` suites | **PASS** |
| Real Electron harness (re-run) | **16/16 PASS** (`12-electron/`) |

## 7. Rosalba Identity

`03-identity/identity-roster.txt`:

| Field | Value |
|---|---|
| id | `rosalba` |
| display | Rosalba (es-MX / en-US) |
| es-MX title | "Desarrolladora Senior" |
| en-US title | "Senior Software Developer" |
| avatar | dog 🐶 |
| sprite | `pam` |
| CIMA role / phase | `builder` / `BUILD` |
| seniority | `seniority: 'senior'` (metadata only) |
| BUILD default owner | still `el-beni` |

**Seniority ≠ authority** (§15).

## 8. Canonical Roster

8 members: El Inge, Valentín, Rosalba, El Beni, Margarito, José Juan, El Tutú, Alicia. The seat list in `desktopPresence.ts` is `LA_PITAYA_AGENTS.map(a => a.id)`, so there is no duplicate list. **F1 re-validated**: Rosalba's position persists across a restart (Electron E14 PASS, ROS-36 PASS).

## 9. Live Spawn

Human → El Inge through the normal composer (`live/mensaje-el-inge.md`, `live/mensaje-el-inge-2.md`). El Inge dispatched every phase with a real spawn-request carrying the role `name` and a structured `cima` (hive log `04-live-spawn/live-spawns-hive-log.txt`):

| Task | Phase | Worker | name |
|---|---|---|---|
| LP-ROS-ACC-1 | BUILD | worker-rosalba-clamp-build1 | Rosalba |
| LP-ROS-ACC-1 | TEST | worker-margarito-clamp-test1 | Margarito |
| LP-ROS-ACC-1 | AUDIT | worker-josejuan-clamp-audit1 | Jose Juan |
| LP-ROS-ACC-2 | BUILD | worker-rosalba-lerp-build1 | Rosalba |
| LP-ROS-ACC-2 | TEST | worker-margarito-lerp-test1 | Margarito |
| LP-ROS-ACC-2 | AUDIT | worker-josejuan-lerp-audit1 | Jose Juan |

No phase was inferred from text, and Rosalba was never invoked directly.

## 10. Live BUILD

| Task | Assignment | Completion | Evidence (verified) | Companion |
|---|---|---|---|---|
| ACC-1 (FOCUS) | seq **1299** `evt-ab9cf92d625481f4fdae4a6a`, god → Rosalba | **BUILD PASS** seq 1322 `evt-85a3384f…` | `node --check clamp.js && node -e …` | 🐶 Rosalba **WORKING**, alone (`08-focus/01`, `02`) |
| ACC-2 (COMPANY) | seq **1442** `evt-a53269868f4e5aed6e30623e` | **BUILD PASS** seq 1458 `evt-8054d6ad…` | `node --check lerp.js && node -e …` | Rosalba WORKING + "Rosalba está construyendo." → released IDLE (`05-live-build/01`, `02`); Alicia bubble "El build terminó con éxito." (`05-live-build/03`, see O-1) |

Rosalba wrote `clamp.js` and `lerp.js` herself; the files exist in `companion-gate-22`.

## 11. Live TEST

| Task | Assignment | Completion | Evidence | Companion |
|---|---|---|---|---|
| ACC-1 | seq 1344 `evt-348385905499d0f334df51d2` → Margarito | **TEST PASS** seq 1379 `evt-a667e4bb…` | `node --test clamp.test.js` [verified] | hidden in FOCUS by Alicia ATTENTION (pending HIGH, §15) |
| **ACC-2** | seq **1481** `evt-197e91bdee317db445272275` → Margarito | **TEST PASS** seq **1497** `evt-935b357da802066038f02986` | `node --test lerp.test.js` [verified] | 🐹 Margarito **WORKING** + "Margarito está ejecutando pruebas." → **CELEBRATING** "Las pruebas pasaron." → **IDLE** (`06-live-test/01`, `02`) |

## 12. Live AUDIT

| Task | Assignment | Completion | Evidence | Companion |
|---|---|---|---|---|
| ACC-1 | seq 1398 `evt-9bcf307c92a9b5f40b4a0de6` → José Juan | **AUDIT PASS** seq 1414 `evt-d83958994aacc28af28a5dc5` | `node --test clamp.test.js` [verified] | hidden in FOCUS by Alicia ATTENTION |
| **ACC-2** | seq **1521** `evt-085ed63b3bbf4a3ef27454ad` → José Juan | **AUDIT PASS** seq **1567** `evt-2436f738366db5a5c5e50f98` | `node --test lerp.test.js` [verified] | 🐢 José Juan **WORKING** "José Juan está auditando." → **CELEBRATING** "La auditoría terminó con veredicto PASS." → **IDLE** (`07-live-audit/01`, `02`) |

El Inge's DECISION PASS: ACC-1 seq 1430 and ACC-2 seq 1585, both with verified evidence.

## 13. Full CIMA Chain

**LP-ROS-ACC-2** is the single coherent live chain:

```
HUMAN → EL INGE (composer) → spawn "Rosalba" → cima-assignment BUILD 1442 → 🐶 Rosalba WORKING
→ lerp.js implemented → BUILD PASS 1458 → spawn "Margarito" → TEST assignment 1481 → 🐹 Margarito WORKING
→ TEST PASS 1497 → CELEBRATING → IDLE → spawn "Jose Juan" → AUDIT assignment 1521 → 🐢 José Juan WORKING
→ AUDIT PASS 1567 → CELEBRATING → IDLE → DECISION PASS 1585
```

LP-ROS-ACC-1 is a second complete chain, with Rosalba WORKING live in FOCUS. All CIMA records of the Rosalba tasks (LIVE-1, ACC-1, ACC-2) carry eventId, sequence, previousEventHash, eventHash and eventMac (`04-live-spawn/live-chain-records.jsonl`; MAC values are not stored).

## 14. Builder != Auditor

Live: in both chains Rosalba did BUILD, Margarito did TEST and José Juan did AUDIT. There was no self-test and no self-audit. Regression evidence in `10-builder-auditor/`: ROS-06, ROS-33 and Electron E11 (Rosalba self-AUDIT → `BLOCKED · BUILDER_NOT_AUDITOR`). No dangerous live mutation was provoked.

## 15. Seniority != Authority

**Demonstrated live.** During the ACC-1 BUILD, Rosalba ran two shell commands on hive governance state: reading her own `outbox/.sent/bad-…json` and moving an inbox message.

* The runtime classified both as **HIGH / governance-tamper (`shell:governance-state`)** → **HUMAN_APPROVAL_REQUIRED** (seq 1315, 1324). Neither was auto-approved.
* Both were **rejected by a human decision** in the Decision Center (seq 1434, 1435), by Claude at the user's explicit request.
* Margarito did the same in ACC-2 (seq 1517, 1524); those were rejected the same way (seq 1589, 1590), with the user's authorization.

Regression: ROS-07 (an agent id cannot decide), ROS-08, and ROS-35 (the policy is frozen; writing it is governance-tamper). Rosalba has no path to approve, confirm a REQUEST, or change risk, policy or governance.

## 16. Code Review Boundary

Rosalba's preset goal and PROTOCOL.md define her review of El Beni's work as advice, **not** a CIMA AUDIT. AUDIT stays with José Juan, the only AUDIT owner; Rosalba owns BUILD only. Unchanged and confirmed (`03-identity`, ROS-05).

## 17. FOCUS

* **Live ACC-1:** FOCUS was active (`08-focus/00`). On Rosalba's BUILD assignment (1299), **only Rosalba was shown, WORKING** (`08-focus/01`).
* **Latency:** assignment at 17:53:05.069, visible with her bubble at 17:53:06.679 — **≈1.6 s**, because the window already existed (`08-focus/02`).
* **Regression:** BUILD + El Beni → El Beni and BUILD + Rosalba → Rosalba (ROS-20/21/22, Electron E12). `assignment.agent` = companion identity.

## 18. COMPANY

Live ACC-2 in COMPANY: at most 3 companions, with independent states. For example, at 18:26 **José Juan was WORKING while Alicia was in ATTENTION** for Margarito's pending HIGH (`09-company/01`); Rosalba appeared WORKING and IDLE beside the others. Regression: ROS-23/24/25/26, Electron E13.

## 19. Desktop Companion

Real Electron, 16/16:

* 🐶 Rosalba · Desarrolladora Senior, on a transparent window with no opaque panel;
* click opens her menu, and click-through holds elsewhere;
* verified speech bubble;
* drag keeps the window size; hide and restore work;
* her position persists across a restart;
* FOCUS and COMPANY behave as specified;
* the companion has no governance controls.

## 20. Electron Security

sandbox **true** · contextIsolation **true** · nodeIntegration **false** (E5). The preload exposes only `onSnapshot, open, dismissBubble, setMode, hide, setInteractive, drag`. There is no `rosalba:*` channel, and forged companion IPC changes nothing (ROS-27/28). See `11-governance/governance-check.txt`.

## 21. Decision Gate Observation

* **Gate chains (ACC-1, ACC-2): 0** DECISION_GATE denials to agents. The other denials were correct and recovered:
  * SENDER_IDENTITY (seq 1373): Margarito tried to write outside his own outbox.
  * TOOL_UNKNOWN (seq 1562): José Juan called `TaskStop`, which is not in policy v1.
* **`LP-ROS-LIVE-1`:** the gate denied (fail-closed) Bash calls it could not simulate on `tasks.json`, and the first Margarito stalled. El Inge recovered by spawning a fresh worker, which completed through the legitimate path.
* **Classification: CASE A — non-blocking observation.** The gate was not fixed, disabled or bypassed, and this gate never touched `tasks.json`.

## 22. Worker Robustness Observations

* **Malformed worker JSON — reproduced and recovered.** Rosalba's first ACC-1 BUILD report was invalid JSON because of an unescaped Windows path. The hive set it aside (`outbox/.sent/bad-lp-ros-acc-1-build-report.json`); she re-sent it as valid JSON and BUILD PASS was recorded (El Inge's summary: `live/el-inge-summary-acc1.png`). Non-blocking.
* **Remote Control prompt:** not reproduced in this gate; both messages were delivered on the first attempt.
* **FOCUS latency:** ≈1.6 s with an existing window. First-creation latency in dev remains a known observation.

## 23. Governance

CIMA remained the only authority:

* every phase result was evaluated by the runtime: EVIDENCE_FIRST blocked unverified claims and DECISION_GATE refused premature completion;
* HIGH stayed with the human;
* the companions only presented verified events.

No code changed. The protected files are **unchanged**: cima, CimaRuntimeService, IntentBoundary, Decision Gate, humanGovernanceIpc, authorization, policy, ledger and event integrity, and the preload. There is no path Rosalba → approve/authorize/human decision, and no path Companion → governance mutation.

## 24. Final Ledger Health

| | Initial | Final |
|---|---|---|
| Status | HEALTHY | **HEALTHY** |
| Recovery | HEALTHY | HEALTHY |
| Head sequence | 1292 | **1590** |
| Events verified (chain + MAC, full) | 1292 | 1590 |
| Warnings | LEGACY_UNVERIFIED (283) | LEGACY_UNVERIFIED (283) |

`14-final-ledger/final-ledger-health.json`.

## 25. Evidence Matrix

| Scenario | Real Agent | CIMA Event | Companion | Expected | Observed | Evidence | Result |
|---|---|---|---|---|---|---|---|
| Rosalba Spawn | El Inge | spawn `name: Rosalba` (log) | — | real spawn | ACC-1 + ACC-2 | 04-live-spawn | **PASS** |
| Rosalba BUILD Assignment | El Inge → Rosalba | 1299 / 1442 | — | assignment, hash+MAC | yes | 04-live-spawn/live-chain-records | **PASS** |
| Rosalba WORKING | — | 1299 (FOCUS) / 1442 (COMPANY) | 🐶 Rosalba | WORKING | WORKING + bubble | 08-focus/01 · 05-live-build/01 | **PASS** |
| BUILD PASS | Rosalba | 1322 / 1458 | Rosalba, Alicia | PASS, Rosalba released, Alicia celebrates | PASS; Rosalba IDLE; Alicia shows the "El build terminó con éxito." bubble but relays a stale WORKING (O-1) | 05-live-build/02, 03 | **PASS** (O-1) |
| Margarito TEST Assignment | El Inge → Margarito | 1344 / 1481 | — | assignment | yes | live-chain-records | **PASS** |
| Margarito WORKING | — | 1481 | 🐹 Margarito | WORKING | WORKING + bubble | 06-live-test/01 | **PASS** |
| TEST PASS | Margarito | 1379 / 1497 | Margarito | CELEBRATING → IDLE | CELEBRATING "Las pruebas pasaron." → IDLE | 06-live-test/02 | **PASS** |
| José Juan AUDIT Assignment | El Inge → José Juan | 1398 / 1521 | — | assignment | yes | live-chain-records | **PASS** |
| José Juan WORKING | — | 1521 | 🐢 José Juan | WORKING | WORKING + bubble | 07-live-audit/01 | **PASS** |
| AUDIT PASS | José Juan | 1414 / 1567 | José Juan | CELEBRATING → IDLE | CELEBRATING "…veredicto PASS." → IDLE | 07-live-audit/02 | **PASS** |
| FOCUS Rosalba | El Inge → Rosalba | 1299 | only Rosalba | WORKING | WORKING, ≈1.6 s | 08-focus | **PASS** |
| COMPANY | — | 1521 + 1517 | ≤ 3 | independent | José Juan WORKING · Alicia ATTENTION | 09-company | **PASS** |
| Builder != Auditor | Rosalba / Margarito / José Juan | live roles + ROS-06/33/E11 | — | no self-audit | none; self-audit BLOCKED in regression | 10-builder-auditor | **PASS** |
| Seniority != Authority | Rosalba | HUMAN_APPROVAL_REQUIRED 1315/1324 → HUMAN_REJECTED 1434/1435 | Alicia ATTENTION | HIGH → human | as expected | 11-governance | **PASS** |
| Ledger Health | — | full verification | — | HEALTHY | HEALTHY 1292 → 1590 | 02 / 14 | **PASS** |
| Governance | — | — | — | no new authority, no code change | confirmed | 11-governance | **PASS** |

## 26. Findings

**No blocking findings.** No code was changed, no STOP condition was hit, the Decision Gate was not bypassed, and the ledger stayed HEALTHY throughout.

## 27. Observations (non-blocking → backlog)

* **O-1 — Stale WORKING from "release" re-assignments.**
  * *What happens:* after each PASS, El Inge sent the worker a "PASS confirmed — clear to release" message carrying a `cima` `{taskId, phase}` without verdict. Under the existing contract the runtime records that as a new `cima-assignment` (ACC-1: 1333, 1389, 1424; ACC-2: 1472, 1512, 1579).
  * *Effect:* the released companion returns to WORKING (`05-live-build/04`). Under the FASE 2 relay rule (an off-screen WORKING outranks her CELEBRATING), Alicia showed the BUILD PASS bubble while relaying Margarito's stale WORKING (`05-live-build/03`, chip "• Margarito").
  * *Cause:* the presentation is faithful to real ledger events; FASE 2.3 code did not cause it.
  * *Backlog:* orchestrator guidance, and/or treat an assignment to a worker that already passed that task/phase as a no-op.
* **O-2 — DECISION_GATE friction** on `tasks.json` shell calls it cannot simulate (CASE A, §21).
* **O-3 — Agents touching hive governance state** (outbox/.sent, inbox moves, ledger grep) trigger HIGH approvals that need human rejection. Governance is correct; this is operational noise.
* **O-4 — Malformed worker JSON** reproduced and recovered (§22).
* **O-5 — Pending human outranks FOCUS:** while HIGH is pending, FOCUS shows Alicia ATTENTION instead of the active phase companion (FASE 2 rule). This is why ACC-1 TEST/AUDIT were not visible.
* **O-6 — Operator automation incident:** while driving the Decision Center, a stalled automation step left the approval checkbox of `apr-musq4cnb-61` checked, with focus on "Aprobar". Nothing was approved — verified in `approvals.json` and the ledger before acting — and both Margarito approvals were then rejected with a direct click on "Rechazar".
* **Carried:** FOCUS first-creation latency in dev; the v0.2.1 "pregúntame" wheel-scroll issue (fixed on the v0.2.2 UX branch).

## 28. Final Verdict

# `PASS_WITH_OBSERVATIONS`

All critical criteria pass live: Rosalba BUILD, Margarito TEST, José Juan AUDIT, FOCUS, COMPANY, Builder != Auditor, Seniority != Authority (live HIGH → human), governance, ledger HEALTHY, no CIMA regression and no code change. The remaining items are genuinely non-blocking.

## 29. Closure Decision

```
LIVE BUILD = PASS · LIVE TEST = PASS · LIVE AUDIT = PASS
GOVERNANCE = PASS · LEDGER = HEALTHY · BLOCKING FINDINGS = NONE
```

**FASE 2.3: CLOSED.** Observations O-1…O-6 become backlog. **FASE 3 PLANNING: AUTHORIZED. FASE 3 IMPLEMENTATION: NOT STARTED.**
