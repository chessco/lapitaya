# FASE 3 — Pre-implementation audit

Base `11f009be` (FASE 2.3 acceptance) · branch `lapitaya/desktop-companions-v0.3-living-desktop` · main `2a5a5858` untouched · Electron **32.3.3**.

| SYSTEM | CURRENT SOURCE OF TRUTH | FASE 3 DECISION |
|---|---|---|
| Roster | `src/shared/lapitaya/agents.ts` (8 members) | reuse; personalities keyed by `LaPitayaAgentId` (`Record<>` forces all 8) |
| Visual states | `CompanionVisualState` (IDLE, WALKING, SLEEPING, THINKING, WORKING, CELEBRATING, SUGGESTING, CONCERNED, NOTIFYING, PAUSED, HAPPY, ATTENTION, OFFLINE) | reuse; no new enum |
| Runtime priority | `desktopPresence.ts` `RELAY_PRIORITY` ATTENTION 5 > CONCERNED 4 > WORKING 3 > CELEBRATING 2 > THINKING 1; pending human outranks everything on Alicia and FOCUS | **kept authoritative**; ambient behavior only when the runtime state is IDLE |
| Existing "living" | `CompanionApp.tsx`: in-window walk ±30 px every 120 ms while IDLE; local sleep after 45 s in ANY state (zZz even while WORKING) | replaced by a declarative behavior engine; sleep only when allowed by main (no execution, no pending human, user idle) |
| Movement bounds | `DesktopPresenceService.ensureOnScreen()` (display `workArea` via `screen.getDisplayMatching`) | reuse for ambient strolls |
| Preferences | `CompanionPreferences` (`reducedMotion`, `maxVisibleCompanions` …) | add `ambientMovement`; `reducedMotion` disables ambient movement |
| Keep-awake | `index.ts` `syncKeepAwake()` (#18): `powerSaveBlocker.start('prevent-app-suspension')` while **any PTY is alive** (El Inge's PTY ⇒ effectively always while a hive is open); `strongKeepalive` escalates to `prevent-display-sleep`; not user-switchable | **extend, not duplicate**: same function and blocker, now driven by authoritative executions + the new `keepAwakeDuringExecution` setting |
| Power API (32.3.3 typings) | `powerSaveBlocker.start('prevent-app-suspension' \| 'prevent-display-sleep'): number`, `stop(id): boolean`, `isStarted(id): boolean`; `powerMonitor.getSystemIdleTime(): number`, `isOnBatteryPower(): boolean` | `prevent-app-suspension` (least intrusive; display may sleep, session may lock) |
| Settings | `config.ts` `HarnessConfig` + `DEFAULTS` merged over the saved file; `config:update` IPC; `onConfigWritten` listeners; Settings → Autonomy & Budgets toggle pattern | add `keepAwakeDuringExecution` (default `true`; an explicit choice is persisted) |
| Execution lifecycle (authoritative) | CIMA runtime `onEvent` (`cima-record`: `cima-assignment`, `cima` verdict PASS/FAIL/BLOCKED); worker spawn (`processSpawnRequest`) / teardown (`teardownPty`); HookServer `onEvent(agentId, event)` callback in `index.ts` (token-authenticated agent id: `UserPromptSubmit` … `Stop`) | single `Set<executionId>` in a main-side `ExecutionAwakeService`; **no** second tracker existed |
| Governance | `hooks.ts`, `cimaRuntime.ts`, `intentBoundary.ts`, `humanGovernanceIpc.ts`, `policyRegistry.ts`, ledger | untouched; awake reads events, writes nothing to the ledger |
