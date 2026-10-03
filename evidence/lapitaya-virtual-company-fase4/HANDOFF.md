# HANDOFF — FASE 4 → siguiente fase

## Estado entregado

- Rama: `lapitaya/virtual-company-v0.4-company-awareness`
- Commit: `48a1855b feat(lapitaya): add virtual software company awareness`
- Base FASE 3: `2a0b4087`
- Árbol de trabajo: limpio al cerrar FASE 4.

## Verificación

- `npm.cmd run typecheck` — PASS.
- `npm.cmd run build` — PASS.
- `npm.cmd run test:companion` — 229/229 PASS.
- Electron real arrancó tras retirar `ELECTRON_RUN_AS_NODE=1`; la app quedó activa para inspección manual.

## Alcance implementado

- `CompanyAwarenessService` y tipos `CompanySession`/`CompanySnapshot`.
- Contexto de proyecto explícito, equipo activo, asignaciones verificadas, expected-next y timeline acotado.
- Preguntas factuales deterministas de Alicia, sin canal de mutación.
- Proyección read-only en Desktop Presence, preload e interfaz de Alicia.
- O-1 documentado como ruido de ciclo de vida; no se modificó CIMA.

## Restricciones que deben preservarse

- La compañía es una proyección, no una autoridad paralela.
- No inventar proyecto, asignación, PASS, decisión humana ni identidad de agente.
- No añadir IPC renderer → compañía para asignar, aprobar, escribir ledger o ejecutar herramientas.
- Mantener FOCUS, Execution Awake, comportamiento vivo y la regresión existente.

## Bloqueo para la siguiente fase

El repositorio no contiene todavía la especificación ni los criterios de aceptación de FASE 5. No comenzar una implementación de FASE 5 hasta recibir ese contrato; el siguiente cambio debe crear su rama desde `48a1855b` y añadir sus identificadores de prueba, documento, evidencia y commit dedicado.
