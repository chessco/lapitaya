# Clasificación IPC — patrón establecido vs autonomía

| Canal | Fase | En main | Expuesto en preload | Mutante | Ruta de observación del renderer |
|---|---|---|---|---|---|
| company:getSnapshot | F4 | sí | sí (companySnapshot) | no | directa |
| company:getOperations | F5 | sí | sí (companyOperations) | no | directa — incluye `autonomy` (F8), `learning`, `skills` (F7), projects/missions (F6) |
| projects:list / projects:getSnapshot | F6 | sí | NO | no | vía company:getOperations |
| missions:getSnapshot | F6 | sí | NO | no | vía company:getOperations |
| learning:getSnapshot / learning:listCandidates | F7 | sí | NO | no | vía company:getOperations |
| skills:list / skills:get / skills:getProposal | F7 | sí | NO | no | vía company:getOperations |
| autonomy:getSnapshot / listEnvelopes / getEnvelope / listOperations / getOperation | F8 | sí (ANTES) → eliminados | NO | no (verificado, 04-snapshot-purity) | vía company:getOperations → operations.autonomy |

## Patrón establecido
La observación del renderer se canaliza por la proyección canónica de compañía
(un único canal expuesto, solo lectura). F6/F7 pasan POLICY-31 porque sus
nombres no caen en el namespace de gobernanza.

## Decisión
Opción C/D del prompt (separar la proyección de lectura de la superficie IPC y
dejar como única vía visible la proyección canónica). Se eliminan los 5 handlers
`autonomy:*` de main, que eran inalcanzables y no tenían consumidores en src/, test/ ni scripts.

## Opciones descartadas
- Renombrar los canales (p. ej. `operations:getSnapshot`): evade la heurística sin cambiar la arquitectura.
- Allowlist explícita en el test: POLICY-31 no tiene allowlist; crearla sería un mecanismo de excepción paralelo.
- Exponer los canales en el preload: amplía superficie en un namespace de gobernanza.

## Trazado renderer → preload → IPC → main → servicio → proyección
renderer `window.api.companyOperations()` → preload `ipcRenderer.invoke('company:getOperations')`
→ main `companyOperations.projection()` → `CompanyOperationsService.projection()` (L565-590)
→ `autonomyService.snapshot()` → `AutonomousOperationsService.snapshot()` (L958-977):
solo lee los mapas en memoria, sin save(), sin onStateChanged, sin transiciones,
sin creación de operaciones ni cambios de Execution Awake.
