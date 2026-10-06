# FASE 8 — Handoff to Codex

Estado al momento de este handoff: **FASE 8.1 (Human Autonomy Authorization
Boundary) CERRADA.** **FASE 8 completa (gate de 40 secciones) ABIERTA**,
bloqueada en la sección 26. **FASE 9 NO autorizada.**

Commit de referencia: `b3ac1630` en
`lapitaya/virtual-company-v0.8-autonomous-operations`
("fix(autonomy): close FASE 8.1 human checkpoint, fix autonomy snapshot read path").

## Qué se cerró en esta sesión (FASE 8.1)

El checkpoint humano de autorización de autonomía quedó **demostrado en
vivo, no simulado**:

- El humano pulsó "Proponer envelope de autonomía acotada" en la pestaña
  Alicia ("pregúntame") de la app real (Electron, `npm run dev`).
- El humano pulsó **AUTHORIZE** sobre la tarjeta real del envelope.
- Resultado persistido en `autonomy.json` (bajo el `hive.root()` del
  usuario, fuera del repo): envelope `env-1791134931220-v3boz` con
  `status: ACTIVE`, `authorizedBy: hum-faacbd7f5de85c8d0bba`,
  `authorizationBinding` (SHA-256 del scope exacto) y `decisionId` reales.

Evidencia actualizada:
`evidence/lapitaya-autonomous-operations-fase8-human-authorization/{15-real-proposal,16-human-checkpoint,17-final}`.
Narrativa completa en
`docs/LA_PITAYA_AUTONOMOUS_OPERATIONS_FASE_8_HUMAN_AUTHORIZATION.md`.

### Bug de producción encontrado y corregido

`src/renderer/src/components/alicia/AliciaPanel.tsx` leía
`snapshot.autonomy.envelopes` (campo raíz). Desde la remediación POLICY-31
(`78118e0b`), `company:getSnapshot` ya no llena ese campo — la ruta
canónica es `snapshot.operations.autonomy.envelopes` (ver comentario junto
al handler en `src/main/index.ts` ~línea 897). El backend creaba los
envelopes correctamente todo este tiempo (3 `PENDING_AUTHORIZATION`
acumulados de clics previos sin fix); solo la UI no los mostraba. Fix de
una línea. `npm run test:autonomy` → 132/132 PASS después del cambio.

## Restricción de diseño que Codex debe respetar

La especificación de este proyecto **prohíbe explícitamente simular al
humano o inyectar envelopes/decisiones** mediante automatización, tests
que llamen directo al servicio, o scripts. El `AutonomyEnvelope` solo
puede pasar a `ACTIVE` mediante una decisión humana real a través del
canal `lapitaya:decide`, nunca inyectada desde main o desde un agente.
Cualquier checkpoint humano restante (abajo) tiene que resolverse con un
humano real haciendo clic en la ventana real de la app — no con
automatización de UI ni con inyección directa de estado, aunque sea
técnicamente posible.

Arquitectura de autoridad (sin cambios):
`Alicia UI → alicia:submit (proposal-only) → main trusted human identity →
pending AutonomyEnvelope → lapitaya:decide → authorizeEnvelope/rejectEnvelope`.

## Qué queda abierto

### 1. Gate de aceptación completo de FASE 8 (40 secciones)

`evidence/lapitaya-autonomous-operations-fase8-acceptance/` — leer
`README.md` primero, luego cada `NN-*/status.txt` para ver qué está
hecho. Quedó **bloqueado en la sección 26**; las secciones 27-40 (y
algunos huecos antes de 26) nunca se ejecutaron en vivo:

- Consumo y agotamiento de presupuesto (budget consumption/exhaustion)
- Pausa / resume / cancelación de una operación autónoma activa
- Auto-expansión de alcance (self-expansion) y su escalamiento
- Integridad del envelope bajo manipulación
- Recuperación tras restart de la app (pre-restart / restart)
- Idempotencia de operaciones
- Aislamiento entre proyectos
- Rendimiento y regresión final, CIMA final

Documento guía:
`docs/LA_PITAYA_AUTONOMOUS_OPERATIONS_FASE_8_ACCEPTANCE_GATE.md`.

### 2. Limpieza de datos de prueba

En `autonomy.json` quedan dos envelopes duplicados sin decidir
(`env-1791135018010-5rfrz`, `env-1791135129567-jmt4n`), creados por
clics repetidos antes del fix. Decidir si se rechazan (REJECT, vía UI
real) antes de continuar, para no ensuciar la evidencia de las
secciones siguientes.

### 3. FASE 9

No autorizada. Depende de que el gate completo de FASE 8 cierre.

## Gotcha de entorno (te va a pasar a ti también)

Si lanzas `npm run dev` desde un shell que heredó
`ELECTRON_RUN_AS_NODE=1` (común en harnesses de agentes basados en
Electron), el proceso Electron arranca como Node puro:
`require('electron').app` queda `undefined` y revienta en
`src/main/config.ts:500` (`app.getPath('userData')`). Solución:
limpiar esa variable antes de lanzar, p. ej. `env -u
ELECTRON_RUN_AS_NODE npm run dev` (bash) o equivalente en PowerShell.

## Comandos útiles

```
npm run typecheck        # node + web
npm run test:autonomy    # 132 tests (REG8/AUTH8/UIAUTH8) — correr tras cualquier cambio en el boundary
npm run test:focused     # toda la suite test/*.test.cjs
npm run build
```
