# La Pitaya — FASE 3: Living Desktop

Estado: implementada y validada en la rama `lapitaya/desktop-companions-v0.3-living-desktop`.

## Alcance

- Ocho personalidades declarativas de presentación: movimiento, descanso, pensamiento, celebración y estilo de trabajo.
- Movimiento ambiental únicamente para companions en `IDLE`, lento, cancelable y limitado al display propio y a su radio de hogar.
- Sueño visual únicamente sin ejecuciones, sin decisión humana pendiente y después del umbral de inactividad.
- `ExecutionAwakeService` mantiene `prevent-app-suspension` solo mientras existe trabajo autoritativo de CIMA, worker o turno hook; no simula entrada humana.
- Preferencia persistente `keepAwakeDuringExecution`, activada por defecto, con indicador ☕ en Alicia.

## Evidencia

- `test/lapitaya-living-desktop.test.cjs`: LIVE-01…15 y AWAKE-01…30, 45/45.
- `npm run test:companion`: 176/176.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `evidence/lapitaya-desktop-companions-fase3/01-real-electron-awake.json`: Electron real + blocker real + medición de proceso.

La regresión global (`npm run test:focused`) no terminó dentro de 300 s. En su salida aparecen dos fallos no relacionados con FASE 3 (`agent-token-cap` y RTL “turning it off”) y errores `EPERM` del entorno al escribir bajo `C:\Users\chess\.codex`; las suites nuevas y `test:companion` pasan.

## O-1

Clasificación: **B — ruido del ciclo de vida**. La reasignación “clear to release” llega después de un `PASS` del mismo worker para la misma tarea/fase. Execution Awake la ignora mediante su conjunto de fases aprobadas. La presentación de companions conserva la observabilidad del evento. Una corrección de fondo corresponde a CIMA/orquestador y queda como recomendación separada; no se implementa en FASE 3.

## Rendimiento

El harness Electron real midió 114,256 KB RSS del proceso principal en la prueba y dos transiciones del blocker. El scheduler ambiental es de baja frecuencia (20 s) y cada paso de paseo usa 60 ms; el paseo se cancela ante trabajo, drag, ocultamiento o destrucción.
