# LA PITAYA — FASE 8 Autonomous Operations Acceptance Gate

Estado: **FAIL — REMEDIATION REQUIRED**

## 1. Objective y límites

Gate independiente de FASE 8 en modo validation-only. No se modificó código de producción, CIMA, governance, IPC ni la semántica de autoridad.

## 2. Baseline y preflight

- Branch: `lapitaya/virtual-company-v0.8-autonomous-operations`
- Base FASE 7: `caa851b4c9528be6a89c988a8d11c183cf666eb1`
- Implementation HEAD: `bc0ca522b0244dea1d842ee8e20878eb488cba2a`
- Acceptance HEAD: el commit documental de este gate.
- `main`: inspeccionado y no modificado.
- Working tree: limpio antes de la evidencia.

## 3. Implementation inspected

Se inspeccionaron `AutonomyEnvelope`, `AutonomousOperation`, budgets, continuation decisions, scope expansion, pause/resume/cancel, persistence, integrity hash, skill pinning, Alicia projection, IPC y Execution Awake. La implementación mantiene autonomía ≠ autoridad y envelope ≠ permiso ilimitado.

## 4. Baseline automatizado

`node --test test/lapitaya-autonomous-operations.test.cjs`: **125/125 PASS** — ENV8 15/15, AUTO8 20/20, RETRY8 10/10, SKAUTO8 10/10, PERSIST8 15/15, ALI8 15/15, GOV8 15/15, DESK8 10/10, REG8 15/15.

`npm.cmd run test:companion`: **296/296 PASS**.

`npm.cmd run typecheck:node`: **PASS**. `npm.cmd run typecheck:web`: **PASS**. `npm.cmd run build`: **PASS**. El build dejó únicamente el warning conocido de import dinámico/estático de `store.ts`.

## 5. CIMA final

Las suites focalizadas de autorización, REQUEST/HIGH, identidad humana, Decision Gate, Builder != Auditor, ledger/event integrity y capability/policy se ejecutaron. Pasaron REQ 19/19, identidad 13/13, runtime 25/25 y eventos 43/43. La suite `test/lapitaya-cima-v0.16.test.cjs` falló **49/50** en `POLICY-31`.

Fallo exacto: la prueba espera que la superficie renderer no exponga canales que coincidan con `policy|capabilit|risk|autonomy`, pero encuentra `autonomy:getSnapshot`. FASE 8 introduce ese canal read-only para consultar estado de autonomía. Es una regresión relevante de governance/IPC; no se clasifica como PASS ni se corrige durante el gate.

Clasificación CIMA: **FAIL — BLOCKING**.

## 6. Real Electron

Antes del arranque no había procesos Electron ni puertos 5173/5174 activos. Se lanzó `npm.cmd run dev` con `ELECTRON_RUN_AS_NODE` eliminado solo para ese proceso. El runner agotó timeout por la naturaleza persistente de Electron, pero la inspección posterior observó 5 procesos Electron, ventana `La Pitaya` y todos `Responding=True`; el puerto 5173 quedó escuchando.

No se inició una misión autónoma ni se creó una segunda instancia autoritativa.

## 7. Project, mission, envelope y live chain

`LP-F8-ACC-PROJECT`, `LP-F8-ACC-M1` y el envelope real no fueron creados. No se inyectó estado, no se creó autorización sintética y no se alteró el almacenamiento del usuario.

El checkpoint real de autorización humana **NO FUE ALCANZADO**. No se simularon identidad, aprobación ni estado ACTIVE. No se ejecutaron live continuación LOW, TEST FAIL/remediación, TEST PASS, AUDIT, scope expansion, WAITING_HUMAN, budgets, pause/resume/cancel, restart/recovery, idempotency ni preguntas de Alicia.

No es válido emitir `FASE 8 — HUMAN CHECKPOINT READY` porque no existe un envelope real pendiente creado por la interfaz.

## 8. Seguridad, invariantes y performance

ENV8/AUTO8/SKAUTO8/PERSIST8/GOV8/DESK8 verifican no-self-expansion, budgets acotados, pinning, no respuesta ≠ aprobación, restart ≠ reauthorization, CIMA como autoridad, no fake workers y Execution Awake inactivo al esperar al humano. Son evidencias automatizadas, no sustituyen el escenario live.

Se observó una instancia real con 5 procesos Electron; el proceso con ventana reportó RSS de 148,140,032 bytes (~141 MiB) y `Responding=True`. Renderer RSS, CPU, listeners y contadores live no se midieron.

## 9. Findings y closure

Bloqueo: `POLICY-31` falla porque la prueba de superficie IPC/gobernanza no reconoce el canal read-only legítimo `autonomy:getSnapshot`. La corrección debe decidirse fuera de este gate, actualizando el contrato de prueba para permitir lectura de autonomía pero seguir rechazando mutaciones/autoridad.

No se hizo ninguna corrección productiva durante el gate.

**FAIL — REMEDIATION REQUIRED**. FASE 8 no puede cerrarse. FASE 9 no está autorizada.

## 10. Continuación posterior al cleanup humano

El operador rechazó en la interfaz Electron real los dos envelopes duplicados
`env-1791135018010-5rfrz` y `env-1791135129567-jmt4n`. Codex no modificó el
almacenamiento ni inyectó decisiones.

La validación canónica `npm.cmd run test:autonomy` terminó **132/132 PASS** y
`npm.cmd run build` terminó **PASS**, con únicamente el warning conocido sobre
la importación estática/dinámica de `store.ts`.

La regresión completa agotó 15 minutos. Los dos fallos observados se
reprodujeron aisladamente y son ajenos a este gate: una expectativa de ruta
POSIX en Windows en `agent-token-cap.test.cjs` y una aserción de terminal árabe
en `arabic-terminal.test.cjs`.

El bloqueo decisivo permanece: no existe caller de producción para iniciar una
operación autónoma ni para encadenar `consumeIteration`, `consumeRetry` y
`evaluateContinuation`. Esos métodos solo aparecen en
`src/main/autonomousOperations.ts` y en tests. Invocarlos directamente no sería
una validación live válida bajo esta especificación. Por tanto, FASE 8 sigue
**FAIL — REMEDIATION REQUIRED** y FASE 9 sigue **NOT AUTHORIZED**.
