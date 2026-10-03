# LA PITAYA — FASE 3 Living Desktop — Final Acceptance Gate

## 1. Objective

Independent validation only. No implementation, CIMA, governance, or Desktop Companions changes were made during this gate; only acceptance evidence and this report were added.

## 2. Baseline

- Branch: `lapitaya/desktop-companions-v0.3-living-desktop`
- HEAD: `c7f4a8d630dd7987ad1a54767bdf8b933b8a11cf`
- `main`: `2a5a5858ddf11885fe9c3980df0b9b1dfdace9a8`
- Working tree at gate start: clean.
- Main was not checked out or modified.

## 3. Environment

Windows, PowerShell, Node/Electron installed. Real Electron runs emit unrelated Chromium GPU/OS-crypt diagnostics; the dedicated awake harness still completes successfully.

## 4–7. Living Desktop, personalities, ambient movement, attention

The existing LIVE-01…15 suite passes 15/15. It covers all eight declarative personalities, IDLE-only movement, bounded strolls, own-display workArea, home radius, reduced motion, pending human attention, cancellation, and runtime-state priority. Existing companion coverage validates FOCUS, COMPANY, verified facts, and human attention behavior.

## 8. Visual sleep

LIVE coverage confirms sleep requires no active execution, no human decision, and the idle threshold. Runtime states remain dominant. Sleep is presentation-only and is not connected to the OS blocker.

## 9–11. Execution Awake architecture and setting

AWAKE coverage passes 30/30. The implementation uses Electron `powerSaveBlocker` with `prevent-app-suspension`, tracks CIMA/worker/hook lifecycle identities, persists `keepAwakeDuringExecution` with default `true`, and exposes only read-only state to the renderer. Static checks find no mouse or keyboard simulation APIs.

## 12–17. OFF, ON, multiple executions, toggle

Real Electron acceptance harness passes: OFF tracks work while holding no blocker; ON holds the blocker only while work exists; simultaneous executions transition 0→1→2→1→0 without premature release; ON→OFF→ON during active work stops and restarts the blocker while execution continues.

## 18–19. Shutdown and screen lock

`dispose()` cleanup is validated in AWAKE tests and the real harness. A Windows screen-lock round trip was not exercised in this unattended environment; no claim is made beyond the blocker/runtime lifecycle evidence.

## 20–21. O-1

O-1 is classified B — lifecycle noise. After a real phase PASS, the same task/phase/worker reassignment is ignored by Execution Awake and does not reactivate the blocker. The ledger/presentation event remains observable; no CIMA semantics were changed.

## 22–25. Performance, multi-monitor, COMPANY, FOCUS

Real Electron main-process RSS was 115,148 KB in this gate (prior evidence: 114,256 KB). CPU reported 0% at the sampled idle point. LIVE tests cover 20 s ambient scheduling, 60 ms walk steps, multi-monitor workAreas, bounded home radius, COMPANY ≤3 and FOCUS assignment ownership. No tight loop, timer storm, or window leak was observed.

## 26–27. Verified facts and governance

Companion tests and AWAKE static checks pass. Renderer inputs cannot create execution activity or forge runtime facts. Execution Awake is infrastructure only; no CIMA authority, Decision Gate, IntentBoundary, risk, authorization, ledger, or event-integrity path was changed during acceptance.

## 28–32. Global regression triage

`npm run test:focused` was attempted twice and timed out at 120 s and 300 s. Independent triage:

- `test/agent-token-cap.test.cjs`: 2/3 pass, 1 failure because the Windows actual path `C:\workspace\project` differs from the test's POSIX expected `/workspace/project`. This is a platform/environment mismatch, not an Execution Awake or FASE 3 setting failure.
- `test/arabic-terminal.test.cjs`: 12/13 pass, 1 failure in unrelated `terminalPool` renderer disposal behavior. It does not touch FASE 3 files or `keepAwakeDuringExecution`.
- CIMA selected suites: 69/69 pass. They emit known `EPERM` warnings while attempting `mkdir` under `C:\Users\chess\.codex\sessions` and `archived_sessions`; these are environment failures, not weakened filesystem behavior.

Classification: global regression is `PASS_WITH_DOCUMENTED_NON-FASE-3_EXCEPTIONS`; no FASE 3-caused failure or Execution Awake defect was found.

## 33–34. Acceptance baseline and protected files

- LIVE: 15/15.
- AWAKE: 30/30.
- FASE 3 total: 45/45.
- `test:companion`: 176/176.
- Typecheck: PASS.
- Build: PASS.
- CIMA selected suites: 69/69.
- Protected implementation files: unchanged during this gate.

## 35. Evidence matrix

- `evidence/lapitaya-desktop-companions-fase3-acceptance/12-electron/acceptance-awake.json`: real Electron OFF/ON, multiple executions, toggle, CIMA chain and O-1.
- `evidence/lapitaya-desktop-companions-fase3-acceptance/12-electron/acceptance-awake.cjs`: reproducible acceptance harness.
- `evidence/lapitaya-desktop-companions-fase3/01-real-electron-awake.json`: prior real Electron blocker/RSS evidence.
- `evidence/lapitaya-desktop-companions-fase3/02-validation.md`: automated validation record.
- `test/lapitaya-living-desktop.test.cjs`: LIVE/AWAKE test source.

## 36–38. Findings, observations, verdict and closure

Blocking findings: NONE.

Observations: screen-lock round trip not exercised; global runner remains time-limited with unrelated platform/environment exceptions; Chromium GPU diagnostics prevent the inherited visual harness from starting in this environment.

Final verdict: **PASS_WITH_OBSERVATIONS**.

Closure decision: **FASE 3 CLOSED**. FASE 4 implementation was not started; only FASE 4 planning is authorized.
