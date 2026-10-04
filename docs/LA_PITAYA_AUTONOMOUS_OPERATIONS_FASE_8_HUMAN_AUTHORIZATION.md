# FASE 8.1 — Human Autonomy Authorization Boundary

Estado: **FASE 8.1 CLOSED — human checkpoint reached live (full FASE 8 acceptance, sections 27-40, still open)**

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

Electron real arrancó con ventana `La Pitaya` responsive. No se automatizó la creación de `LP-F8-ACC-PROJECT`, `LP-F8-ACC-M1` ni la autorización, porque la especificación prohíbe simular al humano o inyectar envelopes: el humano creó la propuesta pulsando "Proponer envelope de autonomía acotada" en la pestaña Alicia ("pregúntame") y decidió pulsando AUTHORIZE sobre la tarjeta real del envelope.

### Bug encontrado y corregido en esta sesión

La tarjeta `PENDING_AUTHORIZATION` no aparecía tras pulsar el botón, aunque el backend sí creaba el envelope (confirmado en `autonomy.json`: 3 envelopes `PENDING_AUTHORIZATION` acumulados de clics previos). Causa: `AliciaPanel.tsx` leía `snapshot.autonomy.envelopes`, un campo raíz que `company:getSnapshot` ya no llena desde la remediación POLICY-31 — la ruta canónica es `snapshot.operations.autonomy.envelopes` (ver comentario en `index.ts` junto al handler). Corregido en una línea; `test:autonomy` 132/132 PASS tras el fix.

### Checkpoint humano real — REACHED

- `envelopeId`: `env-1791134931220-v3boz`
- Decisión: **AUTHORIZE**, vía `lapitaya:decide`, identidad resuelta en main (`hum-faacbd7f5de85c8d0bba`, "chess")
- `authorizationBinding`: `663fdbb5421ad1e991b09ac0702bf6dfa2db51172d2301ed180927ec6982fbe9`
- Estado resultante: `ACTIVE`
- Los otros dos envelopes creados por clics previos (`env-1791135018010-5rfrz`, `env-1791135129567-jmt4n`) quedan `PENDING_AUTHORIZATION`, sin decidir.

**FASE 8.1 (Human Autonomy Authorization Boundary) queda cerrada**: el checkpoint humano es real y verificable en el estado persistido, no simulado.

**FASE 8 (aceptación completa, 40 secciones) sigue sin cerrarse**: la evidencia `lapitaya-autonomous-operations-fase8-acceptance` quedó bloqueada en la sección 26; las secciones 27-40 (consumo/agotamiento de presupuesto, pausa/resume/cancelación, auto-expansión de alcance, integridad, recuperación tras restart, idempotencia, aislamiento de proyectos, rendimiento, regresión final) nunca se ejecutaron en vivo y quedan fuera del alcance de esta sesión.

FASE 9 no está autorizada.
