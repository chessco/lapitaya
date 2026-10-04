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

## 16. Veredicto y cierre

**INCONCLUSIVE / NOT CLOSED**. La evidencia automatizada es sólida, pero el gate exige evidencia live y un checkpoint humano que no se ejecutaron. Cierre: **FASE 5 REMEDIATION REQUIRED**. **FASE 6 NOT AUTHORIZED**. No se inició implementación de FASE 6.

