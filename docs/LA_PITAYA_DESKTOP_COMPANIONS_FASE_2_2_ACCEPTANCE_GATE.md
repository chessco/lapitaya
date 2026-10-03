# LA PITAYA — DESKTOP COMPANIONS · FASE 2.2 ACCEPTANCE GATE

| | |
|---|---|
| Branch | `lapitaya/desktop-companions-v0.2.1-runtime-phase-assignment` |
| HEAD validated | `107cd9f7` (code `06c7c477` / `bfff279b`) |
| Gate type | Validation only — **no code changed** |
| Date | 2026-10-03 (UTC) |
| Verdict | **PASS_WITH_OBSERVATIONS** |

## 1. Objective

Formally validate the FASE 2.2 remediation and close the only open functional gap: **FOCUS following a real CIMA assignment produced by a real live agent (El Inge)**. Re-validate BUILD/TEST/AUDIT, PASS ≠ FAIL ≠ BLOCKED, REQUEST, HIGH, COMPANY and governance without modifying code.

## 2. Baseline

```
Branch:       lapitaya/desktop-companions-v0.2.1-runtime-phase-assignment
HEAD:         107cd9f78a2f7e5c76712acdabc82e46795fe5be
Working tree: clean at start; the only change produced by this gate is this report + its evidence folder
```

`git diff 107cd9f7` over tracked source: empty (`evidence/…/11-governance/governance-check.txt`).

## 3. Environment

Windows 11 Pro 10.0.26200 · Node v24.14.0 · Electron 32.3.3 · `npm run dev` (electron-vite) · real hive `C:\Users\chess\HarnessAgents` · El Inge = real Claude Code session (`god`) · workers spawned by the real HiveManager in `companion-gate-22` · three displays (the user moved windows between them during the run; see §16).

Observation tools (read-only): `live/watch_ledger.cjs` tails the real `cima-ledger.jsonl` and captures companion windows; a 1 fps screen recorder (scratch, not committed) supplied the contact sheets for short-lived states (bubble 6 s, CELEBRATING 8 s). Neither writes to the hive.

## 4. Automated Regression

| Check | Expected | Result |
|---|---|---|
| `npm run test:companion` | 95/95 | **95/95 PASS** |
| `npm run typecheck` | PASS | **PASS** (exit 0) |
| `npm run build` | PASS | **PASS** (exit 0) |
| CIMA v0.14 | 46/46 | **46/46** |
| CIMA v0.15 | 43/43 | **43/43** |
| CIMA v0.16 | 50/50 | **50/50** |

Evidence: `01-baseline/`.

## 5. CIMA Assignment Validation (F1 regression)

El Inge was messaged through the normal composer (`live/mensaje-el-inge-1.md`, `-2.md`). Result over the run: **9 real spawns → 9 `cima-assignment`** (hive `log.jsonl` spawn count = ledger assignment count; `02-cima-assignment/`). `cima` never disappeared.

| eventId | seq | agent | phase | task | eventHash | MAC |
|---|---|---|---|---|---|---|
| evt-0243ca9620da70ba8a013c4b | 614 | god → worker-companiongate-build1 | BUILD | LP-COMP-GATE-1 | 33921d1b8f00… | present |
| evt-53fd4443374726e950213b2e | 647 | god → worker-companiongate-test1 | TEST | LP-COMP-GATE-1 | 2eb9fab0eb5f… | present |
| evt-977a1f25cb9832d92d0c98b8 | 678 | god → worker-companiongate-audit1 | AUDIT | LP-COMP-GATE-1 | 2f4760022673… | present |
| evt-ad9d859e3792314870f70e01 | 733 | god → worker-companiongate-testfail1 | TEST | LP-COMP-GATE-FAIL | c7fb11b577ad… | present |
| evt-126726b286e273a3d6a85ded | 764 | god → worker-companiongate-build2 | BUILD | LP-COMP-GATE-2 | b0c27ab6c7a5… | present |
| evt-9d8d15b728db1448ad5d2606 | 786 | god → worker-companiongate-test2 | TEST | LP-COMP-GATE-2 | 69155b58c076… | present |
| evt-419204087f4034e8d4574a44 | 815 | god → worker-companiongate-audit2 | AUDIT | LP-COMP-GATE-2 | 30eafc8947e8… | present |
| evt-bee0b039680ccade9a59abc4 | 848 | god → worker-companiongate-audit2b | AUDIT | LP-COMP-GATE-2 | 6ef195d59695… | present |
| evt-b6ecbb49427344dcf24706b9 | 873 | god → worker-companiongate-blocked1 | BUILD | LP-COMP-GATE-BLOCKED | ee3ce4ed24cc… | present |

Every record carries `previousEventHash`, `eventHash` and `eventMac` (values truncated / not stored). The governance panel reported **ESTADO DE GOBERNANZA · HEALTHY** on the live hive (`11-governance/01-…png`).

## 6. BUILD

| Record | Companion | Result |
|---|---|---|
| assignment seq 614 (FOCUS) | El Beni **WORKING** (purple ring) | PASS |
| BUILD PASS seq 629 (FOCUS) | El Beni released → IDLE | PASS |
| assignment seq 764 (COMPANY) | El Beni WORKING + "✓ hecho verificado · El Beni está construyendo." | PASS |
| BUILD PASS seq 772 (COMPANY) | **Alicia CELEBRATING** (green) + "El build terminó con éxito." → IDLE; El Beni released | PASS |

Evidence: `03-build/`, `06-focus-live/01*`.

## 7. TEST

| Record | Companion | Result |
|---|---|---|
| assignment seq 647 (FOCUS) | **Margarito WORKING**, alone on screen | PASS |
| assignment seq 786 (COMPANY) | Margarito WORKING + "Margarito está ejecutando pruebas." | PASS |
| TEST PASS seq 804 (COMPANY) | **Margarito CELEBRATING** + "Las pruebas pasaron." → **IDLE** | PASS |

Evidence: `04-test/`, `06-focus-live/02*`.

## 8. AUDIT

| Record | Companion | Result |
|---|---|---|
| assignment seq 678 (FOCUS) | **José Juan WORKING**, alone on screen | PASS |
| AUDIT PASS seq 710 (FOCUS) | **José Juan CELEBRATING** + "La auditoría terminó con veredicto PASS." → **IDLE** | PASS |
| AUDIT seq 815 → BLOCKED seq 831 (runtime `EVIDENCE_FIRST`) → re-assigned seq 848 → PASS seq 855 | ledger only (screen locked, see §16) | records PASS |

Evidence: `05-audit/`, `06-focus-live/03*`, `04*`.

## 9. FOCUS (critical scenario)

FOCUS was activated from the tray ("Modo Enfoque", `06-focus-live/00-…png`) **before** El Inge received the task. Chain demonstrated live:

```
REAL EL INGE (god) → spawn-request with structured cima
  → REAL cima-assignment (ledger)        → REAL runtime event
  → DesktopPresence (FOCUS)              → correct companion, alone, WORKING
```

| Assignment | FOCUS shows | Validated before completion? | Result |
|---|---|---|---|
| BUILD seq 614 | El Beni WORKING | yes | **PASS** |
| **TEST seq 647** | **Margarito WORKING** (only window) | **yes** (TEST PASS came at seq 665) | **PASS** |
| AUDIT seq 678 | José Juan WORKING (Margarito hidden) | yes | **PASS** |
| TEST seq 733 | José Juan → Margarito WORKING within ~3 s, bubble "Margarito está ejecutando pruebas." | yes | **PASS** |

**FOCUS LIVE: PASS** — the FASE 2.2 gap is closed.

## 10. Verdict Semantics

| Verdict | Record | Companion | Result |
|---|---|---|---|
| PASS | seq 629/665/710/772/804 | CELEBRATING (green) → IDLE | **PASS** |
| FAIL | TEST FAIL seq 741 (deliberate `mul(2,2) === 5`) | Margarito **CONCERNED** (amber) + "Las pruebas no pasaron." | **PASS** |
| BLOCKED | BUILD BLOCKED seq 890 | El Beni **PAUSED** (grey), still PAUSED 7.5 h later; no CONCERNED, no failure text | **PASS** |

BLOCKED never produced "El build no pasó.": the only text path for BUILD_BLOCKED is "El build quedó en BLOCKED: sin validar todavía." (runtime fact table, COMP tests in the 95/95). The live bubble at seq 890 fell inside the locked-screen window (§16); the PAUSED state was captured live. Evidence: `07-verdict-semantics/`.

## 11. REQUEST

Alicia was asked from "pregúntame" → **REQUEST_PROPOSED** `req-musjhxn6-4a` (seq 972) → Alicia **ATTENTION** + sticky "Hay una solicitud que necesita tu confirmación." (still there 40 s later, beyond the 6 s auto-dismiss) → **REQUEST_CANCELLED by human** (seq 987) → Alicia back to normal (IDLE). While pending, El Inge's attempts to act were denied by the runtime (`REQUEST_CONFIRMATION_REQUIRED`, `11-governance/02-…png`). **PASS**. Evidence: `08-request/`.

## 12. HIGH

`git push origin main` by worker-companiongate-blocked1 → **2 × HUMAN_APPROVAL_REQUIRED** (seq 883/884, `apr-mus31dpq-37`, `apr-mus31kf4-38`, `shell:git-destructive`) → Alicia **ATTENTION**, sticky for **7.5 h** with no decision → **2 × HUMAN_REJECTED** in the Decision Center (seq 970/971, human session) → Alicia back to IDLE, El Beni stays PAUSED. Human decision → runtime transition → companion update; the companion never decided. **PASS**. Evidence: `09-high/`, `10-company/02-…png`.

## 13. COMPANY

COMPANY showed **3** companions max at all times (window log `live/window-log.txt`), with independent states, e.g.:

* Alicia CELEBRATING · Margarito CONCERNED (07:29:56, `03-build/02`);
* El Beni PAUSED · José Juan IDLE · Alicia ATTENTION (15:10, `10-company/01`);
* El Beni PAUSED · José Juan IDLE · Alicia IDLE after the rejections (`10-company/02`).

No state contamination. **PASS**.

## 14. Governance

* No code changed in this gate; protected files (`cima.ts`, `cimaRuntime.ts`, `humanGovernanceIpc.ts`, `intentBoundary.ts`) unchanged since the FASE 2.2 base.
* Companion preload exposes only `onSnapshot, open, dismissBubble, setMode, hide, setInteractive, drag`; main handles only presentation channels; no approve/authorize/decide/ledger/spawn/execute reference in companion code; `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
* Live: approvals and the REQUEST were resolved only through the human UI; the runtime denied god's out-of-scope actions (seq 748/749/978/986).

`Companion ≠ governance authority` — **PASS**. Evidence: `11-governance/governance-check.txt`.

## 15. Evidence

`evidence/lapitaya-desktop-companions-fase2.2-acceptance/`: `01-baseline` · `02-cima-assignment` · `03-build` · `04-test` · `05-audit` · `06-focus-live` · `07-verdict-semantics` · `08-request` · `09-high` · `10-company` · `11-governance` · `live/` (messages to El Inge, observer, `timeline.jsonl`, `watcher.txt`, `window-log.txt`, captures). Contact sheets carry the UTC time of each frame. No tokens, HMAC keys, MAC values or credentials are stored; captures taken while the PC was locked were deleted.

## 16. Observations (non-blocking)

1. **Worker JSON robustness** — the hive again dropped one worker message as malformed JSON (`drop malformed-json`, `done-LP-COMP-GATE-1.json`); the flow continued because the ledger record had already been written. Backlog.
2. **FOCUS first-show latency (dev)** — in FOCUS a phase companion's window is created on demand; on first creation in `npm run dev` it appeared ≈10–60 s after the assignment (José Juan: 07:16:44 → visible 07:16:55). Already-created windows switch in ~2–3 s. State was correct once shown. Performance backlog.
3. **UX (already fixed on `lapitaya/desktop-companions-v0.2.2-human-ui`)** — on v0.2.1 the "pregúntame" tab does not scroll with the wheel (reached by keyboard here); main-window zoom also scales companions.
4. **Run conditions** — the PC locked itself 07:33–14:59 UTC; states inside that window (AUDIT BLOCKED seq 831, AUDIT PASS seq 855 in COMPANY, HIGH/BLOCKED bubbles) are proven by ledger records and by the persisting states captured afterwards. The user moved the windows across displays mid-run.
5. **Human decisions** — HIGH rejections and the REQUEST cancel were made in the human UI by the user and by Claude at the user's explicit request.
6. **Ledger health** — now verified live (HEALTHY); the FASE 2.2 observation "not independently re-verified" is closed.

## 17. Final Verdict

# `PASS_WITH_OBSERVATIONS`

All functional criteria pass live, including the critical **FOCUS + real CIMA assignment + real El Inge → correct companion WORKING**. No blocking findings; only the robustness/performance/UX observations in §16 remain as backlog. FASE 2 can be considered technically closed.

**FASE 3: NOT STARTED.**
