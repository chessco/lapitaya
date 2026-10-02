# LA PITAYA — DESKTOP COMPANIONS · FASE 2 REMEDIATION

Labels: **FACT** (verified in code or by execution), **OBSERVATION** (observed behaviour), **INFERENCE** (reasoned consequence), **NOT PERFORMED** (not executed, with the reason).

Scope: remediation of the FASE 2 Acceptance Gate (`docs/LA_PITAYA_DESKTOP_COMPANIONS_FASE_2_ACCEPTANCE.md`, verdict **FAIL**, kept unchanged as the record of the failed gate). FASE 3 was not started. CIMA governance was not modified.

**Final verdict: `PASS_WITH_OBSERVATIONS`** (§11).

| | |
|---|---|
| Branch | `lapitaya/desktop-companions-v0.2-living-desktop` |
| Base | `b201329e` (FASE 2) + `b51c10a8`, `c6346ef4` (gate report) |
| Environment | Windows 11 Pro 10.0.26200 · Node 24.14.0 · 3 displays: 1920×1080 @100 % (primary), 1920×1080 @100 %, 1920×1080 @150 % |

## 1. Original defects

From the gate (§15 of the acceptance report): (1) opaque cream window; (2) companion not clickable; (3) runtime events never reach the companion; (4) non-primary companions always `IDLE`, COMPANY renders one creature, FOCUS cannot show phase state; (5) "Hablar" invents runtime statements; (6) drag position not persisted / not clamped / intermittent; (7) primary-display-only clamping; (8) bubbles never auto-dismiss, label "FOX"; (9) no way back after "Ocultar"; (10) `SET_MODE` unvalidated, dead wildcard IPC guard.

Found during this remediation in the real app (not in the gate report): (11) the transparent window still swallowed clicks over its whole 340×340 area; (12) positions were never restored because `PersistStore` opens in `whenReady`, after the service is constructed; (13) a renderer subscribing after load missed its first snapshot (blank companion); (14) a native drag region breaks click-through hover tracking; (15) dragging across displays with different scale factors mis-placed the window.

## 2. Root causes

| # | Root cause (FACT) |
|---|---|
| 1 | `design/global.css` paints `html, body, #root` cream; the companion windows load the same bundle. |
| 2 | The avatar itself was `-webkit-app-region: drag`; Windows gives drag regions to the window manager, so DOM `click` never fires. |
| 3 | `triggerVerifiedRuntimeFact()` had no production caller; `setupAliciaSubscription()` needed `subscribeObservability`, which the real Alicia companion does not have. |
| 4 | One presentation state (`primaryVisualState`) applied to `entries[0]`; one window for all companions; the renderer drew only `entries[0]`. |
| 5 | `handleSpeak` picked canned runtime-sounding lines; bubbles had no kind. |
| 6, 12 | The renderer never reported drags and the window had no `moved` listener; `restorePositions()` ran before the store was open (`getKv` → `undefined`). |
| 7 | `ensureOnScreen` used `getPrimaryDisplay()` only. |
| 8 | `autoDismissMs` was never consumed; the label rendered `species.toUpperCase()`. |
| 9 | No restore mechanism existed. |
| 10 | `SET_MODE` accepted any string; Electron has no wildcard channels. |
| 11 | A transparent `BrowserWindow` on Windows still hit-tests its full rectangle. |
| 13 | `did-finish-load` fires before React's `useEffect` registers the snapshot listener. |
| 14 | Entering a `-webkit-app-region: drag` area fires DOM `mouseleave` (non-client area), which re-enabled click-through just before the press. |
| 15 | A renderer's `screenX` changes units when its window crosses to a display with another scale factor. |

## 3. Changes made

Governance-protected files: **none touched** (FACT: `git diff --name-only` contains no `cima*`, `intentBoundary`, `humanGovernanceIpc`, `ledger*`, `policy*`, `governance*`, `autonomy`, `hooks.ts`, `preload/index.ts`).

| File | Change |
|---|---|
| `src/shared/lapitaya/desktopCompanions/runtimeFacts.ts` (new) | Pure, read-only adapter `AliciaEvent → CompanionFact` over the **existing** stream (`CimaRuntimeService.onEvent → fromRuntimeEvent`). Explicit targets: BUILD → El Beni, TEST → Margarito, AUDIT → José Juan (derived from `LA_PITAYA_AGENTS[].cimaPhases`), REQUEST/APPROVAL → Alicia. Resolutions (`approval.granted/denied`, `request.confirmed/closed`) clear the matching pending ref. A non-PASS verdict maps to `*_FAILED` → `CONCERNED` (never celebrated). Unknown events → no fact. |
| `src/main/index.ts` | 3 lines: the existing `onEvent` now hands the same `fromRuntimeEvent` output to `desktopPresence.observeAliciaEvents` (try/catch, never breaks governance); `aliciaCompanion` dependency removed; `desktopPresence.installTray()` after boot. |
| `src/main/desktopPresence.ts` | Per-companion state and bubbles; one transparent window per visible companion (shown after `did-finish-load`); COMPANY = Alicia + most recently active + CIMA order, capped at `MAX_VISIBLE_COMPANIONS = 3`; FOCUS = phase companion (Alicia while a human request is pending); Alicia **relays** the state of an off-screen companion (`relayedFrom`), so MINI still shows a build in progress; a pending human request outranks everything on Alicia until the runtime resolves it; bubble auto-dismiss (6 s) except sticky human-request bubbles; CELEBRATING → rest after 8 s; `setMode` validates against `COMPANION_MODES` (reject → no mutation); `ensureOnScreen` uses `getDisplayMatching`; positions re-read when the first window is created; window `moved` and drag end → clamp to that display + persist; click-through (`setIgnoreMouseEvents(true, {forward:true})`); every renderer channel is sender-scoped to a companion window; tray (show/hide, modes, open La Pitaya); dead wildcard guard and Alicia-subscription removed. |
| `src/shared/lapitaya/desktopCompanions/{types,ipc,index}.ts` | `COMPANION_MODES` + `isCompanionMode`; bubble `kind` (`runtime-fact` \| `conversation`); entry `displayName`, `relayedFrom`; channels `REQUEST_SNAPSHOT`, `SET_INTERACTIVE`, `DRAG` added; `TRIGGER_BUBBLE` removed (it let the renderer put arbitrary text in a bubble). |
| `src/preload/companionPreload.ts` | Bridge = `onSnapshot` (also requests the current snapshot), `open`, `dismissBubble`, `setMode`, `hide`, `setInteractive`, `drag`. Removed: `triggerBubble`, `positionChanged`, `onSetState`. Still `sandbox` + `contextIsolation`, no `window.api`, no generic IPC. |
| `src/renderer/src/companions/companionDocument.ts` (new) + `main.tsx` | Transparent `html/body/#root` scoped to `?companion=1` (class + injected style); main app background unchanged. |
| `src/renderer/src/companions/CompanionCreature.tsx` (new) | Pure view: clickable avatar (no drag region anywhere), separate drag handle (pointer-captured, never animated, outside the avatar group), identity label = agent name + species, `✓ hecho verificado` only on `runtime-fact` bubbles, sticky bubble carries "Abrir La Pitaya", 2×2 menu (Hablar / Abrir La Pitaya / Galería Dev / Ocultar), hover → interactive. |
| `src/renderer/src/companions/CompanionApp.tsx` | One companion per window (`?agent=`); bubble from the snapshot; local `conversation` bubbles (greeting / Hablar) auto-dismiss; name via `agentDisplayName(id, i18n.language)`; pointer drag. |
| `src/renderer/src/companions/companionConversation.ts` (new) | Conversation lines that state no runtime fact. |
| `src/main/desktopPresenceTrayIcon.ts` (new) | 32 px tray icon (from `build/icon.png`, inlined: `build/` is not packaged). |

**Deviations from the remediation prompt (deliberate, measured):**

* **Drag handle is a pointer-captured drag, not `-webkit-app-region: drag`.** With the native drag region the handle worked (5/5) until click-through was added; then 0/3, because the drag region fires `mouseleave` (root cause 14). The requirement — avatar clickable *and* reliable drag — is met (§6).
* **New IPC channels** `REQUEST_SNAPSHOT`, `SET_INTERACTIVE`, `DRAG` — presentation only, explicit, sender-scoped, validated.
* **Alicia relay rule** — keeps the original COMP-36…38 valid *as product behaviour* (in MINI only Alicia is visible, so she shows that El Beni is working), while El Beni's own entry carries `WORKING` (COMP-54/58).

## 4. Tests added

24 new tests; the original 58 are unchanged.

| ID | What it proves |
|---|---|
| COMP-51 | Companion root transparent (scoped CSS, idempotent, main app untouched); window `transparent`, frameless, `#00000000`. |
| COMP-52 | Avatar `onClick` reaches its handler; avatar and its group are `no-drag`; menu actions wired. |
| COMP-53 | No native drag region; handle drag moves the window, persists, clamps on release; junk/foreign drags ignored; OS `moved` persisted. |
| COMP-54…57 | BUILD → El Beni, TEST → Margarito, AUDIT → José Juan, REQUEST/APPROVAL → Alicia (until each ref is resolved). |
| COMP-58 | Independent states coexist (Alicia ATTENTION + El Beni WORKING). |
| COMP-59 | COMPANY: 3 distinct companions, 3 windows, independent positions, cap never exceeded. |
| COMP-60 | FOCUS follows BUILD → TEST → AUDIT with real states; pending human request → Alicia. |
| COMP-61 | Invalid modes rejected (API and IPC), no mutation. |
| COMP-62 | Bubble auto-dismiss at 6 s; celebration ends; sticky approval bubble survives. |
| COMP-63 | Hide → restore (tray, IPC) without restart, in the previous mode. |
| COMP-64 | Identity renders the agent name (`Alicia`, `José Juan`/`Jose Juan`), not `FOX`. |
| COMP-65, 66 | Multi-monitor clamping to the matching display; restart restores on its own display. |
| COMP-67 | Real runtime payload shapes through `fromRuntimeEvent` drive the companions; `index.ts` wiring present. |
| COMP-68 | A late-subscribing renderer gets its snapshot; nobody else can pull it. |
| COMP-69 | Click-through by default; only companion senders with a boolean toggle it; every interactive part reports hover. |
| COMP-70 | Positions saved by a previous run are restored although the store opens after construction. |
| COMP-71 | Drag deltas come from main's cursor point (one coordinate space across DPI); size kept. |
| ADV-09 | Preload exposes exactly the presentation bridge; every send is an allowed, non-governance channel; window sandboxed/isolated with its own preload; no wildcard channels. |
| ADV-10 | Forged payloads on every companion channel change no state and create no runtime fact; foreign senders ignored; unknown facts rejected; no `TRIGGER_BUBBLE`. |
| ADV-11 | A conversation bubble with runtime wording stays `conversation` without `sourceFact`; only runtime facts carry the verified mark; conversation lines contain no runtime claims. |

## 5. Automated results

| | Result (FACT) | Evidence |
|---|---|---|
| `npm run test:companion` | **82/82 PASS** (58 original + 24 new) | `evidence/lapitaya-desktop-companions-fase2-remediation/regression/test-companion.txt` |
| `npm run typecheck` | **PASS**, 0 errors | `regression/typecheck.txt` |
| `npm run build` | **BUILD SUCCESS**, exit 0 | `regression/build.txt` |
| CIMA v0.16 / v0.15 / v0.14 | **50/50, 43/43, 46/46 PASS** | `governance/cima-suites.txt` |

## 6. Electron validation (real app, `npm run dev`)

Real OS input (`mouse_event`), window geometry (`GetWindowRect`), foreground window (`GetForegroundWindow`). Details per run: `electron/real-app/measurements.txt`; logs `dev-run*-main.txt`; cropped screenshots `electron/real-app/*.png`.

| | Result | Evidence |
|---|---|---|
| A. Startup | **PASS** — transparent (pixels show the desktop/IDE behind; gate: opaque `#FFF8E7`), no cream panel, avatar + "Alicia / Fox" + handle. | `00-startup-transparent.png` |
| B. Click | **PASS** — bubble + menu (`01-…`). Hablar → conversation line, auto-dismissed after 6 s (`02-`, `03-`). Galería Dev (`04-`). Abrir La Pitaya → main window foreground, 4/4. | screenshots, measurements |
| C. Drag | **PASS** — 9/9 handle drags moved the window by the exact delta; avatar still clickable after them (`05-…`). | measurements (run dev8) |
| Click-through | **PASS** — a click on the transparent area reaches the window underneath; the avatar still takes clicks. | measurements |
| D. Hide | **PASS** — companion gone, La Pitaya (main window, 5 processes) alive. | measurements |
| E. Restore | **PASS** — tray icon (notification overflow) restores at the same position; tray menu switches MINI/COMPANY/FOCUS. | measurements |
| COMPANY in the app | **PASS** — 3 separate named windows (El Beni, Margarito, Alicia). | measurements |
| Position persistence | **PASS** — restored after 3 restarts (528,233 · far-left display · 222,692). | measurements |

## 7. Real event validation

**Real runtime, real Electron — harness** `electron/real_runtime_companions.cjs` (precedent: CIMA v0.14–v0.16 Electron harnesses). Real: Electron main; real `CimaRuntimeService` (sandbox hive in a temp dir, own seal key) emitting through `onEvent`; real `fromRuntimeEvent`; real `DesktopPresenceService` with real transparent windows loading the **built** renderer and preload; real commands run and recorded through the runtime's own `authorize()` / `recordTrace()`; real CIMA claims through `handle()` with verified evidence; a real HIGH-risk `authorize()` (never executed); a real REQUEST through the real `IntentBoundary`. Reproduced (not real): the one-line `index.ts` wiring; agents' tool calls are played by the harness (no agent CLI). No human decision was forged.

**FACT: 14/14 PASS** — `electron/real_runtime_companions.txt|json`, per-step captures `electron/captures/*.png` (window contents only).

| | Real runtime fact | Companion |
|---|---|---|
| R2 | BUILD assignment | El Beni **WORKING**, Alicia IDLE |
| R3 | BUILD PASS (evidence: `tsc --noEmit -p tsconfig.node.json`, verified) | Alicia **CELEBRATING**, El Beni released |
| R4, R5 | TEST assignment / PASS (`node --test test/lapitaya-desktop-companions.test.cjs`, verified) | Margarito **WORKING → CELEBRATING** |
| R6, R7 | AUDIT assignment / PASS (`git diff --stat`, verified) | José Juan **WORKING → CELEBRATING** |
| R8 | FOCUS + TEST assignment | only Margarito, **WORKING** |
| R9, R10 | REQUEST proposed (`IntentBoundary` → `openRequest`) / withdrawn by the runtime | Alicia **ATTENTION** → IDLE |
| R11 | `git push --force origin main` → `HUMAN_APPROVAL_REQUIRED` | Alicia **ATTENTION**, sticky runtime-fact bubble |
| R12 | Companion renderer probe | bridge keys = presentation only; `window.api`/`require`/`process` undefined; forged calls → approval **still pending** |
| R1, R13, R14 | — | COMPANY 3 transparent windows (corner alpha 0); hide/restore; no renderer console errors |

**NOT PERFORMED:** the same flow inside the user's real hive with live agents (El Inge/El Beni/Margarito/José Juan running real work). Reason: it would drive real agents and raise real approvals in the user's working harness; the sandbox harness exercises the same runtime code with no effect on the user's state. The `index.ts` wiring is verified statically (COMP-67) and reproduced in the harness.

## 8. Governance validation

* **FACT:** no protected file changed; CIMA suites 139/139.
* **FACT:** companions only *observe* verified events (main process); no companion channel reaches `authorize`, `decide`, ledger, tasks or risk (ADV-09/10, R12).
* **FACT:** the renderer can no longer create bubble text at all (`TRIGGER_BUBBLE` removed); a runtime-fact bubble exists only via `triggerVerifiedRuntimeFact` in main (ADV-11).
* **FACT:** a pending human request is shown (sticky, "Abrir La Pitaya") but never decided by the companion; the Decision Center remains the authority (R11–R12).

## 9. Multi-monitor validation

| | Result | Evidence |
|---|---|---|
| Unit | **PASS** — clamp to the matching display (incl. a smaller far-left one); restart restores on its own display (COMP-65/66). | tests |
| Real app | **PASS** — dragged primary → left → far-left (150 %): window 510×510 physical = 340 DIP, rendered correctly; back far-left → left → primary; restart restored on the 150 % display; drop below the primary's bottom clamped to y = 692 (1032 − 340); drop above the top clamped to y = 0. | measurements (runs dev8–dev10) |

## 10. Remaining observations

1. **Live-agent event run not performed** (§7) — sandbox real-runtime harness instead.
2. **Idle cost:** 15 s MINI sample: 5 processes, total CPU ≈ 5 % of 8 cores (max 2.4 % per process), 614 MB. Gate run: 0–1.5 % per process. Not optimized (no concrete defect). COMPANY not sampled.
3. **Mixed-DPI drag** works but relies on Electron's DIP mapping; only one 150 % display was available.
4. **"Hablar"** is a friendly line, not yet a conversation; the conversational path is "Abrir La Pitaya" (Alicia's chat lives in the main window).
5. **One "Abrir La Pitaya" attempt** in a hot-reloaded dev renderer left focus on the companion; 4/4 after restart.
6. **Mode is not persisted** across restarts (boots in MINI); positions are.
7. **Tray icon** lands in the Windows notification overflow by default.
8. Unrelated to companions, seen in logs: `[config] … settings.json: Unexpected token '﻿'` (BOM in a user settings file); one `EADDRINUSE` on the hook pipe right after force-killing a previous instance (not reproduced).
9. `docs/LA_PITAYA_DESKTOP_COMPANIONS.md` (the FASE 1/2 spec) predates this remediation; this document is the reference for the changed interaction model (per-companion windows, pointer drag, click-through, tray).

## 11. Final verdict

# `PASS_WITH_OBSERVATIONS`

Every blocking defect of the failed gate was reproduced, fixed and **objectively validated**: transparency and clicking in the real app; drag, click-through, hide/restore, COMPANY, persistence and multi-monitor in the real app; runtime events end-to-end through the real `CimaRuntimeService` in real Electron. Five further defects found while validating in the real app were fixed and validated too. Tests 82/82, typecheck, build and CIMA 139/139 pass; governance is untouched and isolated.

It is not `PASS` because one validation was deliberately not run: the event flow with live agents in the user's own hive (§7, observation 1).

FASE 3 was not started.
