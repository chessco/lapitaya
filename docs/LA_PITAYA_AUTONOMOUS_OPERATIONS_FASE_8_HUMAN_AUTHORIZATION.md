# FASE 8.1 — Human Autonomy Authorization Boundary

Estado: **REMEDIATION PASS — HUMAN CHECKPOINT PENDING**

## Findings remediados

F8-ACC-BLOCK-02 queda cubierto por un caller de producción desde Alicia/trusted UI: la UI solicita una propuesta acotada y main crea un envelope `PENDING_AUTHORIZATION`. La decisión usa el canal humano existente `lapitaya:decide`; no se agregó ningún `autonomy:*` IPC.

F8-ACC-BLOCK-03 queda cubierto para llamadas sin provenance: `createEnvelope(...)` sin provenance explícita falla safe y nunca crea `HUMAN/ACTIVE`. Las propuestas de UI usan `RUNTIME_DERIVED_FROM_HUMAN_SCOPE`, quedan pendientes y no tienen autoridad de ejecución.

## Authority architecture

`Alicia UI → alicia:submit (proposal-only target) → main trusted human identity → pending AutonomyEnvelope → lapitaya:decide → main identity resolution → authorizeEnvelope/rejectEnvelope`.

Alicia y El Inge no aprueban. El renderer no puede proporcionar una identidad confiable, `authorizedBy`, estado ACTIVE ni una decisión. La observación continúa exclusivamente por `company:getSnapshot`/`operations.autonomy`.

## Envelope lifecycle

- Proposal: `PENDING_AUTHORIZATION`, `authorizedBy = NONE`, `authorizedAt = NONE`.
- Approve: trusted identity, decision id, timestamp y binding SHA-256 del scope exacto; después `ACTIVE`.
- Reject: `REJECTED`, terminal para ejecución.
- Cambiar un campo authority-relevant después de aprobar invalida el binding y bloquea el inicio.
- La aprobación del envelope no es aprobación HIGH; CIMA sigue gobernando cada acción.

## UI

Alicia presenta project, mission, objective, risk, iteration/retry budgets, capabilities, skills, paths, stop/escalation conditions y controles explícitos `AUTHORIZE`/`REJECT`. Cerrar la UI o no responder no autoriza.

## Persistencia y restart

La propuesta, decisión, identidad, binding y estado usan el almacenamiento existente del servicio de autonomía. Los tests AUTH8 verifican rechazo, binding, integridad y terminalidad; el flujo real de restart queda pendiente del acceptance gate posterior.

## Tests

- AUTH8/UIAUTH8 + FASE 8: **132/132 PASS**.
- CIMA v0.16: **50/50 PASS**, incluido POLICY-31.
- Companion: **296/296 PASS**.
- Typecheck Node/Web: **PASS**.
- Build: **PASS**.

## Real Electron y checkpoint

Electron real arrancó con ventana `La Pitaya` responsive; se observaron 5 procesos y el proceso con ventana fue PID 20644. No se automatizó la creación de `LP-F8-ACC-PROJECT`, `LP-F8-ACC-M1` ni la autorización, porque la especificación prohíbe simular al humano o inyectar envelopes. El siguiente paso es usar el control real de Alicia para crear la propuesta; cuando aparezca `PENDING_AUTHORIZATION`, el gate debe detenerse y solicitar la decisión humana.

FASE 8 no está cerrada. FASE 9 no está autorizada.
