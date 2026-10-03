# FASE 3 — Handoff (paused at the user's session limit)

Branch `lapitaya/desktop-companions-v0.3-living-desktop` (base `11f009be`). **Nothing committed yet.** main untouched.
State verified at pause: `npm run typecheck` PASS; `npm run test:companion` 131/131 PASS (existing + ROS).

## Done (uncommitted)
- `src/shared/lapitaya/desktopCompanions/personality.ts` — declarative personalities for all 8 agents (ranges in `PERSONALITY_RANGES`, `WORK_STYLE_CUE`).
- `src/shared/lapitaya/desktopCompanions/behavior.ts` — pure engine: `BEHAVIOR_PRIORITY`, `displayedBehavior`, `seededRandom`, `nextAmbientBeat`, `mayMoveAmbiently`, `shouldStroll`, `planStroll` (inside its own display's workArea and within `roamRadius` of home), `strollPath`, `companionSleepAllowed`.
- `src/main/executionAwake.ts` — `ExecutionAwakeService`:
  - a Set of execution ids;
  - sources: CIMA `cima-record` assignment/verdict/DECISION, worker spawn/teardown, and hook turns `UserPromptSubmit`…`Stop`/`SessionEnd`;
  - an O-1 re-assignment after PASS is ignored;
  - 6 h safety sweep; every start/end is idempotent; `dispose()`.
- `src/main/index.ts`:
  - `syncKeepAwake()` now delegates to the service (it used to fire whenever any PTY was alive).
  - Wired inputs: runtime `onEvent`, HookServer `onEvent`, `workerStarted` in `processSpawnRequest`, `agentEnded` in `teardownPty`, and `onConfigWritten` → `setEnabled`.
  - Cleanup: `dispose` in `will-quit` and in `teardownAndQuit`.
  - A 30 s timer feeds OS idle time to `desktopPresence.setLivingContext` and calls `sweep`.
  - Read-only IPC `lapitaya:executionAwake:state`; diagnostics file `userData/lapitaya-execution-awake.json`.
  - `ambientScheduler: true` for DesktopPresence.
- `src/main/config.ts` — `keepAwakeDuringExecution: boolean`, DEFAULT `true` (an explicit choice is persisted).
- `src/main/desktopPresence.ts` — `setLivingContext`, `livingContext`, a testable `ambientTick`, and `living` in the presentation. Strolls use 60 ms steps, abort on non-IDLE, drag or hide, and are never persisted as the home position.
- `types.ts` — `CompanionLivingContext`; preferences `ambientMovement` and `sleepAfterMs`.
- Renderer:
  - `CompanionApp.tsx`: engine-driven beats; sleep only when main allows it; ☕ indicator on Alicia; Focus action.
  - `CompanionCreature.tsx`: 💭 thinking, resting pose, work cue, awake indicator, tooltip with the verified state, 🎯 Enfoque menu.
- Settings → Autonomy & Budgets: toggle "Mantener el equipo activo durante ejecuciones" with live status (`data-setting="keep-awake-during-execution"`). The existing `strongKeepalive` (General) now only escalates the blocker type while Execution Awake is active. i18n `lapitaya:executionAwake.*` in es-MX and en-US.
- `src/preload/index.ts` — read-only `lapitayaExecutionAwakeState()`.

## Remaining
1. Write `test/lapitaya-living-desktop.test.cjs` (LIVE-01…15, AWAKE-01…30) and add it to `test:companion` in package.json. Plan:
   - a counting fake blocker for the service;
   - real `CimaRuntimeService` + `recordSpawnAssignment` for AWAKE-10/11/12/15/25;
   - `config.readConfig`/`writeConfig` with electron `app.getPath` mocked to a temp dir for AWAKE-02/03;
   - presence with a mocked `screen.getDisplayMatching` (two displays, one at x=-1920), `random: () => 0.01` and `ambientTick()` for LIVE-01/03/04/15;
   - static source checks: no input simulation (SendInput, mouse_event, keybd_event, SetCursorPos, robotjs, sendInputEvent, SetThreadExecutionState, powercfg); governance files never reference powerMonitor or idle; only one awake IPC channel (`:state`).
2. Full regression (20 lapitaya suites, CIMA 46/43/50) and `npm run build`.
3. Real Electron harness (scenarios A–F with the real `powerSaveBlocker.isStarted`), live-agent chain reading `lapitaya-execution-awake.json`, and performance (CPU/memory of the electron processes, idle vs working).
4. Commits (suggested split in FASE 3 prompt §55), docs `docs/LA_PITAYA_DESKTOP_COMPANIONS_FASE_3_LIVING_DESKTOP.md`, evidence folders 01–15.
5. Document the O-1 finding:
   - Classification **B (lifecycle noise)**: the "clear to release" assignment follows a PASS by the same worker for the same task/phase.
   - Execution Awake ignores it; the companion presentation still shows it faithfully.
   - Recommendation: a separate CIMA/orchestrator change (not done here).
