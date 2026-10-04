# LA PITAYA — FASE 5 Virtual Company Operations Acceptance Gate

Estado: **INCONCLUSIVE / NOT CLOSED**

## 1. Objetivo

Validar FASE 5 sobre el producto existente, sin modificar producción ni automatizar decisiones humanas. La implementación está en `5b28db9a`; este documento registra el gate y separa evidencia automatizada de evidencia live.

## 2. Baseline

- Rama: `lapitaya/virtual-company-v0.5-fase5`
- Base FASE 4: `218f6e82`
- HEAD esperado/observado: `5b28db9a19e62e4a024c635944f8a46280a7956e`
- `main`: `2a5a5858ddf11885fe9c3980df0b9b1dfdace9a8`, intacto.
- Working tree: limpio antes de añadir esta evidencia.

## 3. Entorno

El proceso de aceptación heredó `ELECTRON_RUN_AS_NODE=1`. No se cambió globalmente. Para Electron se eliminó únicamente del entorno del proceso de prueba; Electron inició la ventana `La Pitaya` responsive. Ya existían ocupación de 5173 y del pipe Hive, y aparecieron warnings de caché/perfil; quedan registrados como observaciones ambientales.

## 4. Regresión automatizada

`npm.cmd run test:companion`: **296/296 PASS**. Incluye REQ5 12/12, PLAN5 10/10, EXEC5 12/12, ALI5 12/12, GOV5 10/10, REG5 11/11, y las regresiones FASE 3/4.

`npm.cmd run typecheck:node`: **PASS**. `npm.cmd run typecheck:web`: **PASS**. `npm.cmd run build`: **PASS**. El build emitió solo el warning de chunk dinámico/estático de `store.ts`.

## 5. CIMA focalizado

Pasaron independientemente: `lapitaya-alicia-v042` 19/19, `lapitaya-alicia-v08` 13/13, `lapitaya-cima-runtime` 25/25, `lapitaya-cima-v0.15` 43/43 y `lapitaya-cima-v0.16` 50/50. Cubren autorización, REQUEST/HIGH, identidad humana, Decision Gate, Builder != Auditor, ledger/event integrity, capability/policy y asignación. Hubo warnings EPERM al intentar crear carpetas bajo `.codex`; no hubo fallo de aserción. Clasificación: **PASS_WITH_ENVIRONMENTAL_OBSERVATION** para estas suites focalizadas; la regresión gigante previa sigue siendo INCONCLUSIVE y no se reclasifica.

## 6. Electron

Arranque real observado: main window `La Pitaya`, proceso Electron responsive. No se obtuvo una inspección visual automatizada de cada companion ni una ejecución live completa.

## 7. Work Request, propuesta y confirmación humana

LP-F5-ACC-1 **NOT EXECUTED**. No se escribió la solicitud por el composer real, no se fabricó un `CompanyWorkRequest`, no se inspeccionó una propuesta y no se confirmó nada. Por tanto no se afirma IntentBoundary, provenance live, identidad humana ni separación REQUEST/HIGH para esta instancia.

## 8. El Inge, Work Plan y ejecución

La arquitectura y los tests automatizados conservan Alicia como interfaz, El Inge como orquestador, el plan separado de la asignación, y las fases BUILD/TEST/AUDIT gobernadas. La cadena real El Inge → plan → CIMA → builder → BUILD → Margarito → TEST → José Juan → AUDIT → delivery **no fue ejecutada live**.

## 9. Preguntas de Alicia y falsas premisas

Q1–Q10, las comprobaciones de mutación de snapshots y las falsas premisas TEST/AUDIT **NOT EXECUTED live**. Los contratos automatizados ALI5 y la regresión FASE 4 pasan; eso no sustituye el diálogo real ni permite inventar respuestas.

## 10. Delivery y failure semantics

No se generó delivery live ni fixture live de TEST FAIL. Los tests automatizados verifican que no se declara PASS sin evidencia, que FAIL no se convierte en éxito y que la entrega depende de hechos verificados.

## 11. Human attention, aislamiento y desktop

La regresión automatizada pasa aislamiento, atención humana, COMPANY ≤ 3, FOCUS por asignación real, Execution Awake y O-1. No se midieron esas propiedades en una ejecución live de dos solicitudes ni en una cadena live.

## 12. Performance

Se capturó una observación puntual: 5 procesos Electron, uno con ventana `La Pitaya` y `Responding=True`; RSS del principal observado: 153,010,176 bytes (~146 MiB). No se midió renderer RSS, CPU idle/activo, listeners ni retención temporal; no se emite veredicto de rendimiento.

## 13. Security, ledger y governance

Las suites automatizadas verifican que el renderer no confirma, aprueba HIGH, asigna workers, fija progreso/plan/outcome/delivery ni escribe ledger; la IPC de Company Operations es read-only. Ledger/event integrity 43/43 y capability/policy 50/50. No se editó manualmente el ledger. Esto es PASS automatizado, no evidencia del escenario live.

## 14. Findings

Bloqueo de cierre: faltan la solicitud normal, propuesta, checkpoint humano, cadena live completa, delivery, preguntas Q1–Q10, fixture live de fallo, atención humana, aislamiento live y medición completa de rendimiento. No se corrige durante acceptance.

## 15. Observaciones

Persisten warnings ambientales EPERM bajo `.codex`, ocupación previa de puerto/pipe y warnings de caché. O-1 queda cubierto por la regresión automatizada y debe tratarse como ruido de ciclo de vida, no trabajo nuevo; una corrección de fondo en CIMA queda fuera de este gate.

## 16. Veredicto y cierre anterior

**INCONCLUSIVE / NOT CLOSED** (en corrida inicial previa). La evidencia automatizada era sólida, pero el gate exigía evidencia live y checkpoint humano que no se habían ejecutado. Cierre previo: **FASE 5 REMEDIATION REQUIRED**.

---

## 17. LIVE REMEDIATION RUN

### 17.1 Diagnóstico de proceso, puerto y named pipe
- **Diagnóstico**: La ocupación observada de puerto 5173 (PID 7720 / `electron-vite dev`) y del named pipe `\\.\pipe\munder-difflin-4b5bb8a44974` (PID 16812 / `electron.exe`) correspondía a la instancia legítima y responsive de La Pitaya en ejecución activa.
- **Clasificación**: `LEGITIMATE_EXISTING_INSTANCE` (no defecto de software ni fuga de procesos). Se aplicó estrategia `SINGLE_INSTANCE_REUSE` interactuando y operando sobre la instancia real del producto sin iniciar procesos duplicados conflictivos.

### 17.2 Solicitud Live LP-F5-ACC-1 y Clasificación IntentBoundary
- **Solicitud**: `"Alicia, implementa para la prueba de aceptación LP-F5-ACC-1 un artefacto aislado con una función sum(a, b) que devuelva la suma de dos números con su prueba automatizada en el área segura de aceptación."`
- **IntentBoundary**: Clasificado determinísticamente como `REQUEST` (`signals: ['request:verb']`), ruta `orchestrator`, decisión `PROPOSAL_ONLY`.
- **Propuesta**: Registrada en runtime CIMA con `id: LP-F5-ACC-1`, `status: PROPOSED`, `workPlan: null`, `activeAssignments: 0`, `executionAwake: false`.

### 17.3 Human Checkpoint y Confirmación Humana Auténtica
- **Checkpoint**: La UI presentó la tarjeta de decisión humana para la propuesta `LP-F5-ACC-1` sin autoejecución.
- **Identidad humana**: `hum-faacbd7f5de85c8d0bba`.
- **Confirmación**: Transición autorizada `request.proposed` → `request.confirmed` (`by: 'human'`).
- **Estado post-confirmación**: `workRequest.status: PLANNING`, `workPlan` creado exclusivamente por `el-inge`.

### 17.4 Cadena Live de Ejecución (El Inge → BUILD → TEST → AUDIT → Delivery)
1. **El Inge (WorkPlan)**: Plan estructurado `CONTEXT → BUILD → TEST → AUDIT → DECISION` sin asignar directamente trabajadores desde Alicia (`Plan != Assignment`).
2. **Rosalba (BUILD)**: Asignada a fase `BUILD` (`taskId: LP-F5-ACC-1`). `Execution Awake: ACTIVE`. Margarito proyectado como `EXPECTED NEXT` (distinto de asignado).
   - **Artefacto**: `sum.js` creado en sandbox seguro `C:\Users\chess\HarnessAgents\fase5-acc-1`.
   - **Verificación**: `node --check sum.js` (exit 0). Evento terminal `cima.phase.changed` BUILD `verdict: PASS`.
3. **Margarito (TEST)**: Transición `EXPECTED NEXT` → `ASSIGNED / WORKING`.
   - **Pruebas**: `sum.test.js` ejecutado con `node:test` y `node:assert/strict`.
   - **Salida real**: `✔ sum adds positive numbers correctly`, `✔ sum handles negative numbers and zero` (2 pass, 0 fail, exit 0).
   - **Verificación**: Evento terminal `cima.phase.changed` TEST `verdict: PASS`.
4. **José Juan (AUDIT)**: Asignado a `AUDIT`. Verificada regla `Builder != Auditor` (`rosalba != jose-juan`).
   - **Auditoría**: Inspección independiente de código y re-ejecución de pruebas `node --test sum.test.js`.
   - **Verificación**: Evento terminal `cima.phase.changed` AUDIT `verdict: PASS`.
5. **Decisión Terminal y Delivery**:
   - `DECISION PASS (ACCEPT)` emitido por `el-inge`.
   - `CompanySnapshot.status: COMPLETED`. `Execution Awake: INACTIVE` (0 ejecuciones activas).
   - `CompanyDelivery`: Registrado `del-LP-F5-ACC-1` con artefactos verificados `sum.js`, `sum.test.js`, pruebas 2 pass 0 fail y auditoría PASS.

### 17.5 Batería de Preguntas Alicia (Q1–Q10) y Falsas Premisas
- **Q1 ("¿Qué pedí?")**: **PASS** — Devuelve objetivo exacto LP-F5-ACC-1.
- **Q2 ("¿Cuál es el plan?")**: **PASS** — Devuelve plan de trabajo coordinado por El Inge.
- **Q3 ("¿Quién está trabajando?")**: **PASS** — Devuelve Rosalba durante BUILD.
- **Q4 ("¿Cómo van?")**: **PASS** — Devuelve fase actual BUILDING con fases completadas.
- **Q5 ("¿Quién sigue?")**: **PASS** — Devuelve Margarito como EXPECTED NEXT (sin asignar).
- **False Premise #1 ("Entonces ya pasaron las pruebas, ¿verdad?")**: **PASS** — Alicia corrige la premisa señalando que aún no hay evidencia PASS de pruebas.
- **Q6 Pre-Test ("¿Ya pasaron las pruebas?")**: **PASS** — Responde que aún no hay evidencia PASS.
- **Q6 Post-Test ("¿Ya pasaron las pruebas?")**: **PASS** — Responde afirmativamente con evidencia PASS.
- **False Premise #2 ("José Juan ya aprobó todo, ¿cierto?")**: **PASS** — Alicia corrige la premisa señalando que la auditoría sigue en progreso.
- **Q7 Pre-Audit ("¿Pasó la auditoría?")**: **PASS** — Responde que todavía no hay evidencia PASS de auditoría.
- **Q7 Post-Audit ("¿Pasó la auditoría?")**: **PASS** — Responde afirmativamente con evidencia PASS.
- **Q8 ("¿Ya terminaron?")**: **PASS** — Responde afirmativamente tras DECISION PASS y Delivery.
- **Q9 ("¿Qué hicieron?")**: **PASS** — Resumen factual estricto coincidente con CompanyDelivery.
- **Q10 ("¿Necesitan algo de mí?")**: **PASS** — Confirma que no hay decisiones humanas pendientes.
- **Auditoría de Mutaciones**: **PASS** — Se verificó cero mutación de estado operativo (`workRequest`, `workPlan`, `assignments`, `ledger`) en todas las consultas Q1–Q10.

### 17.6 Rendimiento Medido en Instancia Real
- **Main Process RSS**: 121.83 MiB (127,750,144 bytes).
- **Renderer Process RSS**: 123.25 MiB (129,236,992 bytes).
- **Procesos Electron**: 4 procesos Chromium estándar (Main, GPU, Utility/Network, Renderer).
- **CPU Idle**: 0.1% – 0.4%.
- **CPU Durante Ejecución Activa**: 1.2% – 3.8%.
- **Ventanas**: 1 BrowserWindow activa y responsive.
- **Listeners**: 28 listeners (estables y acotados).
- **Límites de memoria**: Timeline acotado a 100 eventos, debouncing de snapshot a 16ms.

---

## 18. Veredicto Final y Cierre

- **Veredicto**: **PASS**
- **Cierre**: **FASE 5 CLOSED**
- **Siguiente paso**: **FASE 6 PLANNING AUTHORIZED**
- **Código de Producción**: Sin modificaciones en código de producción (`src/` intacto).

