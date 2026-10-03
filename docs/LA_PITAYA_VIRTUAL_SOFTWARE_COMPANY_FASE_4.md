# La Pitaya — FASE 4: Virtual Software Company

## Resultado

FASE 4 implementa una proyección verificable de compañía sobre el estado real de CIMA. La proyección incluye sesión, proyecto, equipo activo, fase, asignaciones, siguiente esperado, atención humana y una línea de tiempo acotada de eventos verificados.

La interfaz de Alicia consume únicamente esta proyección de lectura. No puede asignar agentes, aprobar acciones, cambiar fases, escribir el ledger ni ejecutar herramientas.

## Implementación

- `CompanyAwarenessService` mantiene sesiones independientes por `taskId` y deriva `CompanySnapshot` de eventos autoritativos.
- El contexto de proyecto es explícito y permanece `null` cuando no existe evidencia verificada.
- El equipo activo se deriva de participantes y asignaciones reales; el siguiente esperado nunca se presenta como asignado.
- Las respuestas factuales de Alicia son deterministas y devuelven hechos verificables junto con la versión de snapshot.
- La línea de tiempo es informativa y acotada; no es autoridad ni ledger.
- O-1 se registra como ruido de ciclo de vida y no reabre trabajo ni Execution Awake.
- La presencia de escritorio expone el snapshot de compañía como presentación de solo lectura.

## Verificación

- Typecheck Node/Web: PASS.
- Build Electron: PASS.
- `test:companion`: PASS, 229/229.
- Arranque Electron real: PASS después de retirar la variable ambiental `ELECTRON_RUN_AS_NODE=1`, que impedía que Electron inicializara `app`.

La corrección de fondo de O-1 en CIMA queda fuera de esta fase y se conserva como recomendación independiente.
