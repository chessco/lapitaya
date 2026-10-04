# La Pitaya — FASE 8 · Remediación focalizada POLICY-31

Estado: **REMEDIATION PASS** · FASE 8 **NO CERRADA** · Acceptance Gate **BLOQUEADO en §26 (nuevo hallazgo)** · FASE 9 **NO AUTORIZADA**

- Rama: `lapitaya/virtual-company-v0.8-autonomous-operations`
- Base FASE 7: `caa851b4` · Implementación FASE 8: `bc0ca522` · Acceptance fallido (preservado): `f1f4fb3c`
- Secuencia histórica: FASE 8 IMPLEMENTED → ACCEPTANCE FAIL (`f1f4fb3c`) → **REMEDIATION (este documento)** → ACCEPTANCE RETRY (pendiente)
- Evidencia: `evidence/lapitaya-autonomous-operations-fase8-remediation-policy31/`

## 1. Hallazgo

`test/lapitaya-cima-v0.16.test.cjs` daba 49/50: falló `POLICY-31` en la línea 494 con `actual: 'autonomy:getSnapshot'` (`02-policy31-analysis/before-policy31-focused.txt`).

## 2. Causa raíz

`bc0ca522` registró en `src/main/index.ts` cinco handlers `ipcMain.handle` en el namespace `autonomy:` (`getSnapshot`, `listEnvelopes`, `getEnvelope`, `listOperations`, `getOperation`). POLICY-31 prohíbe cualquier canal IPC, en preload o en main, cuyo nombre contenga `policy|capabilit|risk|autonomy`.

- El preload **no** exponía ningún canal `autonomy:*` (la línea 492 pasaba), así que los handlers eran inalcanzables desde el renderer y no tenían consumidores en `src/`, `test/` ni scripts.
- La observación de autonomía ya existía por la proyección canónica `company:getSnapshot` / `company:getOperations` → `operations.autonomy` (`CompanyOperationsService.projection()`).
- Diagnóstico: desajuste arquitectónico. FASE 8 duplicó una vía de lectura dentro de un namespace reservado de gobernanza, en lugar de usar el patrón establecido. No era un defecto explotable hoy, pero sí superficie IPC muerta: exponerla más adelante en el preload habría abierto un canal de gobernanza sin revisión de CIMA.
- El test es correcto y no se modificó.

## 3. Invariante de seguridad

"El renderer no puede redefinir política": no existe ningún canal IPC en el espacio de gobernanza (policy / capability / risk / autonomy). La autoridad vive solo en el runtime CIMA y en el registro congelado (`POLICY_REGISTRY`, `DEFAULT_POLICY` frozen).

## 4. Patrón IPC existente

| Fase | Canales de lectura en main | ¿Expuestos en preload? | Vía del renderer |
|---|---|---|---|
| F4/F5 | `company:getSnapshot`, `company:getOperations` | Sí | directa |
| F6 | `projects:list`, `projects:getSnapshot`, `missions:getSnapshot` | No | `company:getOperations` |
| F7 | `learning:getSnapshot`, `learning:listCandidates`, `skills:list/get/getProposal` | No | `company:getOperations` |
| F8 (antes) | `autonomy:*` ×5 | No | `company:getOperations` → `operations.autonomy` |

El patrón establecido es: la observación del renderer pasa por la proyección canónica de compañía, de solo lectura. Detalle en `03-ipc-classification/ipc-classification.md`.

## 5. Clasificación de `autonomy:getSnapshot`

Es de solo lectura, una proyección, no autoritativa y no mutante (verificado en §6). Aun así, como canal propio infringía el invariante de namespace. Por eso se clasifica como **vía de lectura redundante**: su función ya la cumple la proyección canónica, que sí es conforme.

## 6. Pureza del snapshot

`04-snapshot-purity/snapshot_purity.cjs` usa un servicio temporal, nunca el almacenamiento del usuario, con estado real creado por la API del servicio: 2 envelopes y 1 operación. Ejecuta 100 veces cada ruta de lectura (`snapshot`, `listEnvelopes`, `getEnvelope` ×3, `listOperations`, `getOperation` ×2 y `CompanyOperations.projection`) y compara 18 campos autoritativos: envelopes, estados, operaciones, consumo de budget, iteraciones/pasos, decisiones pendientes, scope expansions, asignaciones, WorkRequests, historial, Execution Awake, requests/deliveries de compañía, hash y mtime de `autonomy.json`, hashes de `projects.json` y `learning.json`, y llamadas a `onStateChanged`.

Resultado: **0 mutaciones** (`mutatedFields: []`). Además se confirmó que la proyección canónica incluye la autonomía (`canonicalProjectionCarriesAutonomy: true`).

## 7. Remediación

Se aplicó la opción C/D del prompt: separar la proyección de lectura de la superficie IPC y dejar como única vía visible para el renderer la proyección canónica. En `src/main/index.ts` se eliminaron los 5 handlers `autonomy:*` (+4 / −18 líneas, incluido el comentario explicativo). `AutonomousOperationsService`, el preload, los tests y CIMA no cambiaron.

Descartadas:
- Renombrar los canales: evade la heurística.
- Allowlist en el test: sería un mecanismo de excepción paralelo, y POLICY-31 no tiene allowlist.
- Exponer los canales en el preload: amplía la superficie de gobernanza.

## 8. Por qué CIMA no se debilitó

- `test/lapitaya-cima-v0.16.test.cjs` no cambió: sin skips, sin cambiar 50 por 49 y sin allowlist ni wildcard.
- No se tocaron sandbox, `contextIsolation`, `nodeIntegration` ni el registro de política.
- La superficie IPC se **redujo** en 5 canales.

## 9. Pruebas de seguridad negativa

`05-negative-security/negative-security.txt`:
- El preload y main no tienen ningún canal que coincida con `/autonom|envelope|policy|capabilit|risk/i`.
- Los 24 canales candidatos, `autonomy:{activateEnvelope, authorizeEnvelope, increaseRisk, increaseIterationBudget, increaseRetryBudget, addCapability, addSkill, addPath, resetBudget, markCompleted, approveHigh, writeLedger, createEnvelope, narrowEnvelope, startOperation, pauseOperation, resumeOperation, cancelOperation, consumeIteration, consumeRetry, recordWorkRequest, recordDecision, evaluateContinuation, setExecutionAwake}`, dan **NOT EXPOSED** en preload, main y `companionPreload`.
- Ningún método mutante de `AutonomousOperationsService` se referencia desde los archivos de superficie IPC.

## 10. Resultado POLICY-31

Focalizado: **1/1 PASS** (antes 0/1) — `06-policy31-focused/after-policy31-focused.txt`.

## 11. Resultado CIMA

- `lapitaya-cima-v0.16`: **50/50 PASS**, 0 skipped (`07-cima/cima-v0.16-full.txt`).
- Las 26 suites `test/lapitaya-*.test.cjs`, que cubren CIMA v0.10 a v0.16, el runtime CIMA, Alicia v04 a v09, REQUEST/HIGH, identidad humana, Decision Gate, Builder != Auditor, Learner != Auditor, ledger/eventos, proyectos y aprendizaje: **1003/1003 PASS** (`07-cima/lapitaya-all-suites.tap`).

## 12. Regresión FASE 8

Valores reales de `08-fase8-regression/all-suites.tap`:

| ENV8 | AUTO8 | RETRY8 | SKAUTO8 | PERSIST8 | ALI8 | GOV8 | DESK8 | REG8 | Total |
|---|---|---|---|---|---|---|---|---|---|
| 15/15 | 20/20 | 10/10 | 10/10 | 15/15 | 15/15 | 15/15 | 10/10 | 15/15 | **125/125** |

- Companion (`npm run test:companion`): **296/296 PASS**.
- Repositorio completo (136 archivos, `node --test test/*.test.cjs`): 1854 tests · 1822 pass · 21 fail · 11 skipped. Las 21 fallas están en 8 archivos ajenos a FASE 8 y a CIMA: `fs-path-containment` (10, symlinks), `worktree-deps` (5, symlinks), `agent-token-cap`, `arabic-terminal`, `hire-import`, `model-catalog-remote`, `release-notes` y `telemetry-message-count`. Son **preexistentes**: al correr esos 8 archivos sobre `f1f4fb3c` sin el cambio se obtiene el mismo conjunto exacto de fallas (22/107 en ambos casos; `baseline-f1f4fb3c-failing-files.tap` frente a `remediated-failing-files.tap`, con `diff` vacío).
- Nota de baseline: las cifras previas "491 + 125 = 616" del acta de FASE 8 no se pueden reproducir con los conteos medidos, porque companion (296) + FASE 8 (125) = 421. Se registran aquí los conteos reales y no se repiten los esperados.

## 13. Typecheck

- `typecheck:node`: **PASS**
- `typecheck:web`: **PASS**

Fuente: `09-typecheck-build/typecheck.txt`.

## 14. Build

`npm run build`: **PASS** (`09-typecheck-build/build.txt`). No se generaron artefactos temporales (`electron.vite.config.*.mjs` no existe).

## 15. Diff de producción

`src/main/index.ts` únicamente: +4 / −18 (`10-final/production-diff.patch`). El diff `bc0ca522..f1f4fb3c` es solo documentación y evidencia (`01-preflight/preflight.txt`).

## 16. Evidencia

```
01-preflight/            git status/branch/HEAD/log, clasificación del diff
02-policy31-analysis/    aserción, invariante, causa, ejecución "antes"
03-ipc-classification/   comparación de patrones y trazado end-to-end
04-snapshot-purity/      script aislado y salida antes/después (0 mutaciones)
05-negative-security/    inventario de canales y exposición de mutaciones
06-policy31-focused/     POLICY-31 después
07-cima/                 CIMA v0.16 50/50, lapitaya-* 1003/1003
08-fase8-regression/     suite completa (TAP/spec), comparación con baseline, companion
09-typecheck-build/      typecheck y build
10-final/                diff y veredicto
```

## 17. Veredicto

**REMEDIATION PASS**

- POLICY-31: 50/50 PASS
- CIMA: PASS
- Lectura de autonomía: SOLO LECTURA VERIFICADA, vía proyección canónica
- Mutaciones del snapshot: 0
- Canales mutantes: NOT EXPOSED
- Regresión FASE 8: 125/125
- Typecheck: PASS
- Build: PASS
- Hallazgos bloqueantes de la remediación: NINGUNO

## 18. Estado de reanudación del Acceptance Gate

Se reanudó el mismo gate desde el punto bloqueado (§25–26) y se detuvo **antes de crear estado**, por un hallazgo nuevo e independiente de POLICY-31:

**F8-ACC-BLOCK-02 — No existe ninguna ruta de producción para proponer ni autorizar un AutonomyEnvelope.**
- `createEnvelope`, `authorizeEnvelope`, `narrowEnvelope`, `startOperation`, `pauseOperation`, `resumeOperation` y `cancelOperation` no tienen ningún llamador en `src/`; solo los invocan los tests.
- No hay UI, canal preload ni handler (tampoco `lapitaya:decide`) que cree o autorice un envelope.
- Consecuencia: no se puede crear un envelope "real" desde La Pitaya, y el humano no tiene dónde autorizarlo en la interfaz. Crear uno por script en el almacenamiento del usuario sería inyección de estado, que el acta previa prohíbe explícitamente, y el checkpoint no sería alcanzable por el humano.

**F8-ACC-BLOCK-03 — Autorización implícita en `createEnvelope` (`src/main/autonomousOperations.ts:183-220`).**
- Si no se indica `createdBy`/`provenance`, se asume `'HUMAN'`, y `HUMAN` implica `isAuthorized` → `status: 'ACTIVE'`, `authorizedBy: 'human'`, `authorizedAt: now`, sin ninguna identidad humana confiable.
- Reproducido en `04-snapshot-purity` (el envelope creado sin provenance quedó `ACTIVE`).
- Contradice "no implicit authorization" (§27): el estado inicial debe ser `PENDING_AUTHORIZATION` y la autorización solo puede llegar desde la frontera humana confiable.

Ninguno de los dos se corrigió aquí. Son defectos de implementación de FASE 8 fuera del alcance de la remediación focalizada de POLICY-31, y corregirlos exige diseñar la ruta de autorización humana.

- Proyecto / misión / envelope de aceptación: **no creados**
- Autorización humana: **inexistente**
- Checkpoint humano: **no alcanzado**

**FASE 8 CERRADA: NO** · **Acceptance Gate: BLOQUEADO (F8-ACC-BLOCK-02, F8-ACC-BLOCK-03)** · **Siguiente: remediación de la ruta de autorización del envelope** · **FASE 9: NO AUTORIZADA**
