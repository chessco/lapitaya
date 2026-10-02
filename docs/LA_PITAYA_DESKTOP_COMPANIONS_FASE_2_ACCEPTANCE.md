# LA PITAYA — DESKTOP COMPANIONS · FASE 2 ACCEPTANCE GATE

Labels: **FACT** (verified in code or by execution), **OBSERVATION** (observed behaviour in the real app), **INFERENCE** (reasoned consequence), **NOT PERFORMED** (validation that could not be executed, with the reason).

No product code was changed by this gate. FASE 3 was not started. Governance was not touched.

**Final verdict: `FAIL`** (§17).

## 1. Objective

Decide whether FASE 2 — Living Desktop Experience can be formally closed, using objective evidence from: automated regression, typecheck, build, the real Electron runtime, real runtime event flow, CIMA governance isolation and human UX behaviour.

## 2. Branch

`lapitaya/desktop-companions-v0.2-living-desktop` — verified with `git branch --show-current`. Working tree clean at start. No upstream configured (branch not pushed). `main` untouched.

## 3. Commit

Validated HEAD: `b201329e La Pitaya Desktop Companions v0.2: living desktop experience` (2026-10-02).

Companion range on top of `bfb4daf8` (CIMA v0.15):

| Commit | Subject |
|---|---|
| `a8262862` | feat(desktopCompanions): implement FASE 1 Desktop Presence Foundation |
| `8522a9b3` | chore: add test:companion script to package.json |
| `afa146a3` | feat(desktopCompanions): auto-show companion on boot & add interactive pet gallery switcher |
| `b201329e` | La Pitaya Desktop Companions v0.2: living desktop experience |

## 4. Validation environment

| | |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| Node / npm | v24.14.0 / 11.9.0 |
| Displays | 3 — primary `0,0 1920×1080` (work area 1920×1032), `-1920,0 1920×1080`, `-3840,0 1280×720` |
| Runtime | `npm run dev` (electron-vite, renderer on `localhost:5174`) |
| Interaction driver | Win32 `SetCursorPos` / `mouse_event` (real OS mouse input) + `CopyFromScreen` screenshots + `EnumWindows`/`GetWindowRect` for window geometry |

**Environment note (FACT):** the first `npm run dev` crashed with `TypeError: Cannot read properties of undefined (reading 'setAsDefaultProtocolClient')` because the VS Code integrated terminal exports `ELECTRON_RUN_AS_NODE=1`. This is a tooling artifact, not a La Pitaya defect; every subsequent run used `env -u ELECTRON_RUN_AS_NODE npm run dev`.

## 5. Automated test results

The gate prompt names `npm test -- test/lapitaya-desktop-companions.test.cjs`; the repo has no `test` script. The equivalent `npm run test:companion` (`node --test test/lapitaya-desktop-companions.test.cjs`) was used.

**FACT: 58/58 PASS** (COMP-01…COMP-50, ADV-01…ADV-08), 0 fail, 0 skipped. Evidence: `evidence/lapitaya-desktop-companions-fase2-acceptance/regression/test-companion.txt`.

**OBSERVATION — test coverage vs. real behaviour.** The suite passes while the defects of §8–§11 exist, because:

* it runs `DesktopPresenceService` against a mocked `BrowserWindow`, so window transparency (COMP-26 only checks `isWindowVisible()`), click handling and rendering are never exercised;
* COMP-36…COMP-40 call `triggerVerifiedRuntimeFact()` directly — the method has **no production caller** (§10);
* COMP-36 asserts `entries[0].visualState === 'WORKING'` with `entries[0]` = Alicia, i.e. it confirms Alicia (not El Beni) changes state;
* COMP-42…COMP-46 and ADV-02…ADV-07 test the string validator `isAllowedCompanionChannel()` / `isGovernanceIpcChannel()`, which is **not on the runtime IPC path** (§12).

Supplementary (governance health on this HEAD): `lapitaya-cima-v0.16` 50/50, `v0.15` 43/43, `v0.14` 46/46 PASS — `evidence/…/governance/cima-suites.txt`.

## 6. Typecheck result

**FACT: PASS** — `npm run typecheck` (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`), exit 0, 0 errors. Evidence: `regression/typecheck.txt`.

## 7. Build result

**FACT: BUILD SUCCESS** — `npm run build`, exit 0 (main 1,019 kB, preload `companionPreload.js` 1.87 kB, renderer built in 55 s, `copy:main-assets` OK). Evidence: `regression/build.txt`.

## 8. Electron validation

| ID | Result | Evidence |
|---|---|---|
| **E2E-01 Companion startup** | **FAIL** | Electron starts, main window usable, companion auto-appears at `100,100` (`desktopPresence.show('MINI')`, `src/main/index.ts`). But the companion is an **opaque 340×340 cream panel** (pixel `#FFF8E7`, alpha 255) over the desktop — a permanent card, not a desktop-integrated presence. Screenshot `01-startup-companion-opaque.png`. |
| **E2E-02 Alicia presence** | **FAIL** | Fox avatar visible; idle bob animation and walk offset render. Transparency: FAIL (above). Interaction: FAIL (§9). The label under the avatar reads **"FOX"** (species), not "Alicia". |
| **E2E-03 Animation states** | **NOT PERFORMED** (blocked by §10) | In the real runtime only `IDLE` and the renderer-local sleep (`zZz` after 45 s) were observable. No real runtime path changes the companion state (§10), and the window exposes no developer control to set a state. `WORKING/THINKING/CELEBRATING/CONCERNED/ATTENTION` could not be produced in Electron. |
| **E2E-04 Desktop movement** | **FAIL** | Idle walking (±40 px inside the window) works. Drag: 1 of 3 real drag attempts moved the window (`100,100 → 575,290`); 2 later attempts did not move it. **Position is not persisted**: after restart the window was back at `100,100` (`GetWindowRect`). Screen clamping is not applied to OS drags. Multi-monitor: §15. Screenshot `04-after-drag-moved.png`. |

**Root cause of E2E-01 (FACT):** `src/renderer/src/design/global.css:11` sets `html, body, #root { background: var(--cth-cream-100) }` (+ a noise `background-image` on `body`). The companion window loads the same renderer bundle (`index.html?companion=1#companion`); only `CompanionApp`'s inner `div` is `background: transparent`. The `BrowserWindow` itself is correctly configured (`transparent: true`, `frame: false`, `backgroundColor: '#00000000'`).

## 9. Interaction validation

Three real left-clicks on the fox (at its rendered centre) produced **no speech bubble and no menu**; the companion stayed in sleep (`zZz`), which the click handler would have reset. Screenshots `02-after-click-no-menu.png`, `03-after-repeat-click-no-menu.png`.

**Root cause (FACT + INFERENCE):** the clickable element (`CompanionApp.tsx:405-421`) carries `WebkitAppRegion: 'drag'`. On Windows, Electron hands `-webkit-app-region: drag` areas to the OS window manager, so DOM `click` events do not fire there. The successful drag in §8 confirms the region is a drag region.

| Action | Result | Notes |
|---|---|---|
| Click Alicia → bubble | **FAIL** | Menu unreachable. |
| Hablar | **NOT PERFORMED** (unreachable) + **static FAIL** | Code (`CompanionApp.tsx:134-148`) does not open a conversation; it shows a random canned line (§10). It does not call any CIMA/IPC path (governance-safe). |
| Abrir La Pitaya | **NOT PERFORMED** (unreachable) | Static: `OPEN_MAIN` → `main.restore()/focus()` — correct by code. |
| Galería Dev | **NOT PERFORMED** (unreachable) | Static: toggles a local overlay listing `snapshot.entries`; label is "Ver Galería Dev". |
| Ocultar | **NOT PERFORMED** (unreachable) | Static: `HIDE` → `setMode('OFF')` → `hideWindow()`; does not terminate La Pitaya — correct by code. No UI path exists to show the companion again after hiding (only the next app start). |

## 10. Event validation

**FACT: no real runtime event reaches the companion.**

* `DesktopPresenceService.triggerVerifiedRuntimeFact()` (`desktopPresence.ts:172`) — the only place that maps `BUILD_*`, `TEST_*`, `AUDIT_*`, `REQUEST_PENDING`, `HUMAN_APPROVAL_REQUIRED` — has **zero callers** outside the test file (`grep` over `src/`).
* The other input, `setupAliciaSubscription()` (`desktopPresence.ts:518`), requires `aliciaCompanion.subscribeObservability`. The real object from `createAliciaCompanion()` (`src/shared/lapitaya/alicia/companion.ts`) exposes `snapshot / notify / markRead / explain / submit / setPreferences` — **no `subscribeObservability`**. The subscription returns early; it is dead in production.

| Expected mapping | Real runtime | Static (unit, called directly) |
|---|---|---|
| BUILD_STARTED → El Beni WORKING | **FAIL** (not wired) | Sets the *primary* (Alicia) state to WORKING; El Beni's entry is always `IDLE` (`desktopPresence.ts:257`). |
| BUILD_COMPLETED → Alicia CELEBRATING | **FAIL** (not wired) | Matches. |
| TEST_STARTED / TEST_COMPLETED → Margarito | **FAIL** (not wired) | Alicia's state changes; Margarito stays `IDLE`. |
| AUDIT_STARTED / AUDIT_COMPLETED → José Juan | **FAIL** (not wired) | Same; AUDIT_COMPLETED bubble says "Auditoría aprobada con evidencia." — asserts an approval outcome the fact name does not carry. |
| REQUEST_PENDING / HUMAN_APPROVAL_REQUIRED → Alicia ATTENTION | **FAIL** (not wired) | Matches. |

**Factual speech (§7 of the gate):**

* **PASS (static):** unknown facts do not change state (`default:` branch); main-process bubbles carry a `sourceFact`.
* **FAIL:** "Hablar" emits invented runtime-sounding statements with no source fact — "Todo tranquilo en La Pitaya.", "El Inge y los agentes están atentos." (`CompanionApp.tsx:136-141`). These assert runtime/agent state without a verified event.
* **OBSERVATION:** `TRIGGER_BUBBLE` lets the renderer put arbitrary text in Alicia's bubble with no `sourceFact` (`desktopPresence.ts:488`). The renderer does not currently call it.
* **OBSERVATION:** `autoDismissMs: 6000` is never consumed by the renderer; once shown, a bubble stays until replaced.

## 11. Mode validation

No UI exposes a mode switch; the renderer never calls `setMode`. Validation is static only.

| Mode | Result |
|---|---|
| MINI | **PASS** (real runtime): Alicia only, default at boot. |
| COMPANY | **FAIL (static)**: `getPresentation()` returns up to 3 entries (`MAX_VISIBLE_COMPANIONS = 3` respected, COMP-50), but `CompanionApp` renders only `entries[0]` (`CompanionApp.tsx:159`); the others appear only inside the Dev Gallery overlay. All companions share one 340×340 window; there is no per-companion window/position. Not validated in Electron. |
| FOCUS | **FAIL (static)**: shows `activePhaseAgent`, but a non-primary entry's state is always `IDLE`, so the phase agent never shows WORKING/CELEBRATING. Since no phase event is wired (§10), FOCUS always shows Alicia in practice. Not validated in Electron. |

**OBSERVATION:** `SET_MODE` accepts any string without validation (`desktopPresence.ts:498`); an unknown value falls through to the Alicia-only branch.

## 12. IPC validation

**FACT: IPC isolation holds.**

* The companion `BrowserWindow` uses `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` and its own preload `companionPreload.ts`; the main `src/preload/index.ts` (which carries the governance API) is **not** loaded in it, so `window.api` does not exist in the companion renderer.
* `companionPreload.ts` exposes only `window.companionBridge`: `onSnapshot`, `onSetState`, `positionChanged`, `open`, `triggerBubble`, `dismissBubble`, `setMode`, `hide` — each bound to a fixed `lapitaya:companion:*` channel. No generic `send/invoke`, no channel parameter.
* Main-side handlers for those 8 channels touch only presentation state (mode, bubble, position, window show/hide, focus main window).

Companion → presentation / position / snapshot / open-focus / hide-show: **present**. Companion → authorization / approval / tool execution / governance mutation: **absent**.

ADV-01…ADV-08: **8/8 PASS**. **OBSERVATION:** ADV-02…ADV-07 validate a string filter that is not enforced at runtime; isolation is actually guaranteed by the fixed preload surface. The "security boundary" `ipcMain.on('lapitaya:companion:*', …)` (`desktopPresence.ts:509`) is dead code — Electron does not support wildcard channels.

## 13. Governance validation

**FACT: the governance boundary is intact for FASE 2.**

* `b201329e` (FASE 2) touches only: the companion doc, `desktopPresence.ts`, `companionPreload.ts`, `CompanionApp.tsx`, `animalAvatar.ts`, desktop companion `ipc.ts` / `types.ts`, and the companion test. No protected file.
* Static review of `desktopPresence.ts`, `companionPreload.ts`, `CompanionApp.tsx`, companion IPC/types, the (unwired) event adapter and the speech layer: no path to approve, authorize, execute, mutate tasks, modify risk, modify CIMA state, read secrets/approval tokens/HMAC, write the ledger or bypass the Decision Center. `getPresentation()` contains no governance fields (ADV-08).
* The only main-process dependency handed to the service is `aliciaCompanion` (read-only views + `submit` → IntentBoundary). The service does not call `submit`.
* CIMA suites v0.14/v0.15/v0.16: 139/139 PASS on this HEAD.

**OBSERVATION — traceability (not a bypass, outside FASE 2):** commit `a8262862` ("feat(desktopCompanions): implement FASE 1…") also contains the **CIMA v0.16 Governance Policy Registry** work — `src/main/cimaRuntime.ts`, `src/shared/lapitaya/governance.ts`, `policyRegistry.ts` (new), `toolRisk.ts`, `providerGovernance.ts`, `autonomy.ts`, `authSubject.ts`, `hive.ts`, `alicia/observability.ts`, `test/lapitaya-cima-v0.16.test.cjs` and `evidence/lapitaya-cima-v0.16-…`. None of it references the companion. Governance changes therefore have no commit of their own and no `docs/LA_PITAYA_CIMA_RUNTIME_16_*.md`. Recommended to be acknowledged in the CIMA review, not in this gate.

## 14. UX observations

| | Answer | Basis |
|---|---|---|
| A. Desktop presence vs floating dashboard? | **No.** | Opaque 340×340 cream panel reads as a small window/card. |
| B. Companion vs another application window? | **Partly.** | Avatar and idle bob/sleep are charming; the opaque panel and inability to click it make it feel like a stuck window. |
| C. Reactions understandable without technical knowledge? | **Not assessable.** | No reaction to real events occurs (§10). |
| D. Noticeable but not intrusive? | **Intrusive.** | Always-on-top opaque panel covers 340×340 px of whatever is beneath (observed over the IDE editor) and cannot be dismissed (menu unreachable). |
| E. Desktop visually usable? | **Degraded.** | Same as D; covered area is not click-through. |
| F. More alive without distracting? | **Not yet.** | Motion is subtle and pleasant, but without real reactions the "alive" part is decorative only. |

## 15. Known limitations

1. Window background not transparent (renderer global CSS). — **blocking**
2. Companion not clickable on Windows (`-webkit-app-region: drag` on the click target). — **blocking**
3. Runtime facts not wired to `DesktopPresenceService`; Alicia observability subscription dead. — **blocking**
4. Non-primary companions never leave `IDLE`; COMPANY renders one creature; FOCUS cannot show phase state.
5. "Hablar" invents runtime-sounding statements; no conversational flow.
6. Drag position not persisted; OS drag not clamped; drag intermittent (1/3).
7. `ensureOnScreen` uses the primary display only (`desktopPresence.ts:311`) — a companion placed on a secondary monitor would be clamped back to the primary on restore. Not exercised in Electron (no drag reached a secondary monitor).
8. Bubbles never auto-dismiss; label shows species ("FOX") instead of name.
9. No way to show the companion again after "Ocultar" except restarting.
10. `SET_MODE` unvalidated; wildcard IPC guard is dead code; unit tests do not exercise the runtime paths they name.

**Performance / stability (OBSERVATION, 10 s idle sample, 8 cores):** 5 Electron processes, ~638 MB working set total; per-process CPU 0.0–1.5 %. No crash, renderer error or companion error in the main-process log over two runs, one restart and repeated click/drag input. Sleep/resume (OS suspend) **NOT PERFORMED**. Long-run memory trend **NOT PERFORMED**. Unrelated log line seen: `[config] Could not safely update Claude config … settings.json: Unexpected token '﻿'` (BOM in a user settings file; not a companion issue).

## 16. Evidence

`evidence/lapitaya-desktop-companions-fase2-acceptance/`

| File | Content |
|---|---|
| `regression/test-companion.txt` | 58/58 PASS |
| `regression/typecheck.txt` | typecheck, exit 0 |
| `regression/build.txt` | build log, exit 0 |
| `governance/cima-suites.txt` | CIMA v0.14/v0.15/v0.16 suites, 139/139 PASS |
| `electron/dev-run1-main.txt`, `dev-run2-main.txt` | main-process logs of both real runs |
| `electron/screenshots/01-startup-companion-opaque.png` | companion at boot: opaque cream panel |
| `electron/screenshots/02-after-click-no-menu.png` | after real click: no bubble/menu, still sleeping |
| `electron/screenshots/03-after-repeat-click-no-menu.png` | after 2 more clicks: unchanged |
| `electron/screenshots/04-after-drag-moved.png` | after the one successful drag (575,290) |

Screenshots are cropped to the companion area; full-desktop captures were discarded because they contained unrelated personal content.

Window geometry (`GetWindowRect`): run 1 boot `100,100,440,440` → after drag `575,290,915,630` → after 2 further drags unchanged; run 2 (restart) `100,100,440,440`.

## 17. Final verdict

# `FAIL`

Reproducible functional defects exist in the real Electron runtime (§15 items 1–3): the companion is not transparent, cannot be clicked (so the whole interaction layer is unreachable), and no real runtime event reaches it. Automated tests, typecheck and build pass, and the governance boundary and IPC isolation are intact — the failure is functional, not a governance violation.

**FASE 2 is NOT ready for closure.** FASE 3 was not started. A FASE 2 remediation slice is needed (transparent companion root background, a no-drag click target with a separate drag handle, wiring real runtime facts into `DesktopPresenceService`, per-companion state), followed by a re-run of this gate.
