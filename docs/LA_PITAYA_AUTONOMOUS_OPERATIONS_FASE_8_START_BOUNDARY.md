# LA PITAYA — FASE 8.2 Production Autonomous Operation Start Boundary

## Verdict

FASE 8.2: **CLOSED**. FASE 8: **OPEN — ACCEPTANCE GATE RESUME REQUIRED**.
FASE 9 implementation: **NOT AUTHORIZED**.

## Blocker and root cause

The previous gate had a real ACTIVE envelope and a complete autonomous
operations service, but no production caller connected El Inge's mission
orchestration to `startOperation`. Tests called the service directly, which
was not valid live evidence.

## Architectural decision and authority model

`CompanyOperationsService.requestAutonomousOperationStart` is the narrow
production boundary. `confirmMission(..., 'el-inge')` is the production
orchestration decision point: it looks up only an ACTIVE envelope bound to the
same project and mission, then submits a separate start request. Human
authorization does not auto-start work. El Inge requests; CIMA decides;
`AutonomousOperationsService` creates the bounded operation.

No new human identity, approval token, risk model, capability registry, ledger,
or renderer authority channel was added. The existing human attribution,
authorization binding, CIMA runtime, and canonical `operations.autonomy`
projection remain in use.

## Start contract and validation

`AutonomousOperationStartRequest` carries envelope, project, mission, objective,
risk, required capabilities, requested skills, requested paths, pinned skills,
and an idempotency key. Before operation creation the boundary validates ACTIVE
status, project/mission/objective binding, integrity hash, authorization
binding, expiration, risk ceiling, capability/skill/path subsets, and budget.
Failed validation creates no operation and consumes no budget.

LOW remains autonomous only inside the authorized envelope and after CIMA.
MEDIUM remains supervised. HIGH is rejected/escalated and is never covered by
a LOW envelope. ACTIVE envelope alone leaves Execution Awake inactive.

## Idempotency, persistence, restart, and UI boundaries

Stable idempotency keys return the existing matching operation and prevent a
duplicate operation. Persisted operations retain the key and are not recreated
after restart. No `autonomy:*` authority IPC, renderer start button, Alicia
authority, agent authority, or auto-start-on-authorization path was added.
Alicia remains read-only for status and explanation.

## Evidence and verification

- START8: **26/26 PASS**.
- `npm.cmd run test:autonomy`: **132/132 PASS**.
- `npm.cmd run typecheck`: **PASS**.
- `npm.cmd run build`: **PASS**; known `store.ts` static/dynamic import warning.
- POLICY-31 focused check: **1/1 PASS**.
- Full CIMA v0.16: timed out after five minutes in this environment while
  emitting known EPERM errors for `.codex` session directories; not counted as
  PASS.
- `npm.cmd run test:focused`: timed out at the 15-minute limit with no
  incremental output; not counted as PASS and does not block the focused START8
  remediation result.
- Real Electron smoke: launched with `ELECTRON_RUN_AS_NODE` cleared for the
  child process; real Electron processes/window were responsive. No operation
  was started.

Detailed evidence is in
`evidence/lapitaya-autonomous-operations-fase8-start-boundary/`.

## Acceptance resume point

Resume the remaining live FASE 8 sections using the existing real authorized
envelope only after confirming it is still ACTIVE, valid, unexpired, and
integrity-valid. Do not close FASE 8 from this remediation and do not begin
FASE 9 implementation.
