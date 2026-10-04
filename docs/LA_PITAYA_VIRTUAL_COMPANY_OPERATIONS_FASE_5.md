# La Pitaya — FASE 5: Virtual Company Operations

## Resultado de implementación

FASE 5 extiende la interfaz conversacional de Alicia con una proyección operativa gobernada: una solicitud humana puede correlacionarse con el REQUEST existente, un plan de trabajo de El Inge, progreso semántico, fases reales y una entrega derivada de evidencia.

La capa no ejecuta, asigna ni aprueba. `IntentBoundary` continúa siendo la entrada única; la confirmación y cancelación siguen en los handlers humanos existentes; El Inge mantiene la orquestación; CIMA mantiene la autoridad.

## Modelo

- `CompanyWorkRequest`: objetivo, proyecto conocido o `null`, criterios y provenance (`HUMAN` o `EL_INGE_PROPOSED`), estado y correlación de proposal/task.
- `CompanyWorkPlan`: pasos esperados coordinados por El Inge. Un plan no crea asignaciones; una asignación solo aparece desde eventos CIMA reales.
- `CompanyProgress`: estado semántico derivado de sesión/fase/atención, sin porcentajes inventados.
- `CompanyDelivery`: resumen, outcome, artefactos y referencias de evidencia de una sesión terminal verificada.
- Múltiples solicitudes se conservan por `requestId`; la proyección selecciona foreground con la misma regla determinista de FASE 4 y expone las colecciones read-only.

## Alicia y Electron

Las preguntas operativas (`¿Qué pedí?`, `¿Cuál es el plan?`, `¿Cómo van?`, `¿Qué están haciendo?`, `¿Qué falta?`, `¿Ya terminaron?`, `¿Qué hicieron?`) usan hechos de la proyección. Las preguntas de estado no mutan runtime. Las solicitudes accionables siguen pasando por el clasificador y `IntentBoundary`; no hay canal Alicia → worker.

El renderer recibe `company:getSnapshot` y `company:getOperations`, ambos read-only. No existen setters de estado, plan, outcome, aprobación o ledger.

## Verificación de implementación

- REQ5: 12/12 PASS.
- PLAN5: 10/10 PASS.
- EXEC5: 12/12 PASS.
- ALI5: 12/12 PASS.
- GOV5: 10/10 PASS.
- REG5: 11/11 PASS.
- Suite FASE 3/4 preservada y FASE 5 incluida: 296/296 PASS.
- Typecheck Node/Web: PASS.
- Electron build: PASS.
- Electron real: procesos responsivos con `ELECTRON_RUN_AS_NODE` retirado solo en el proceso de prueba.

## Estado de aceptación

La implementación no cierra el Acceptance Gate. Falta ejecutar con un harness UI confiable el escenario real request → confirmación humana → El Inge → CIMA → delivery, además de rendimiento y la regresión CIMA completa. No se falsificó una confirmación ni se convirtió un timeout ambiental en PASS.
