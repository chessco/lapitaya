# CIMA v0.13 — Architecture Maturity Review

Revisión de arquitectura. **No se implementó ni se modificó código fuente.** Convención: **FACT** (verificado en código o ejecución), **OBSERVATION** (comportamiento observado), **INFERENCE** (consecuencia razonada), **RECOMMENDATION** (acción futura). Evidencia en `evidence/lapitaya-cima-v0.13-architecture-review/`; las sondas ejecutables están en `tests/probes/` y operan solo sobre hives temporales.

---

## 1. Executive Summary

**Veredicto: ARCHITECTURAL GAPS REQUIRE ANOTHER HARDENING SLICE.**

- **FACT** — CIMA es un runtime de gobernanza coherente: una sola autoridad (`CimaRuntimeService`), reglas puras compartidas, fail-closed en los caminos que llegan al hook, Alicia sin autoridad, humano como única fuente de approve/confirm/cancel. La estructura no requiere rediseño.
- **FACT** — v0.10–v0.12 cierran bien el riesgo accidental (corrupción, crash a mitad de escritura, expiración, idempotencia). Sus suites pasan: 31/31, 25/25, 38/38 (re-ejecutadas aquí).
- **FACT** — La aprobación humana HIGH se enlaza a la llamada solo mediante FNV-32 (agente + hash de 32 bits). Se construyó en 52 ms un comando `rm -rf …` con el mismo fingerprint que un `git push` aprobado y `authorize()` lo devolvió `APPROVED`. No es un riesgo de "correlación"; es el límite de autorización.
- **FACT** — La identidad del remitente en el canal de mensajes no está verificada por el runtime (directorio outbox / `from` del renderer); escribir en el outbox de otro agente es `ALLOW/LOW`. El claim de v0.10 sobre `routeOnce()` no coincide con el código.
- **FACT** — 93 de 315 tests de las suites `lapitaya-*` fallan en HEAD (11 suites anteriores a v0.10; causa: `IDENTITY_UNTRUSTED`). El "0 regresiones" de v0.12 cubre solo v0.10–v0.12.
- **INFERENCE** — Producto: **HARDENED**. El diseño soporta bien los niveles de amenaza 1 y 6 parcial; el nivel 2 (agente malicioso) tiene dos brechas verificadas (FNV, canal de mensajes). Pasar a evolución de producto sin cerrarlas construiría sobre un límite de autorización que no resiste a un actor adversarial.

## 2. Audited Baseline

| Item | Valor |
|---|---|
| Rama | `lapitaya/cima-v0.12-state-integrity-recovery` |
| HEAD | `3e6ae0c8` (previos: v0.11 `00ab8202`, v0.10 `456d4a75`) |
| Árbol al inicio | limpio |
| Ejecutado | sondas (hives temporales); `node --test test/lapitaya-*.test.cjs`; suites v0.10/0.11/0.12 por separado |
| No ejecutado | typecheck, build, Electron, CLIs de providers, sockets de hook reales, contención multi-proceso real |

## 3. CIMA Evolution

| Slice | Pregunta | Efecto verificado en código |
|---|---|---|
| v0.10 | ¿Quién eres? | Token por agente (`HIVE_AGENT_TOKEN`, `hive.ts:431-463`), validado en `hooks.ts:210-235`; contexto humano de IPC (`humanIdentity.ts`). **Solo en hooks e IPC humano.** |
| v0.11 | ¿Qué puedes hacer? | Clasificación de shell/mutación, gate de `tasks.json` para shell y `mcp__*`, gate de spawn por provider. |
| v0.12 | ¿Se puede confiar en el estado? | `writeState` atómico, `append` con fsync, `corruptedFiles`, TTL 24 h, `withLock`. |

Cada slice responde a su pregunta en su perímetro; las brechas de este informe están en las costuras entre perímetros (canal de mensajes, enlace de aprobación, estado sin etiqueta de integridad).

## 4. Architecture Model

`ACTOR → IDENTITY → EXECUTION CONTEXT → INTENT → CLASSIFICATION → AUTHORIZATION → GOVERNANCE → EXECUTION → EVIDENCE → STATE → HUMAN DECISION → RECOVERY`

| Componente | Archivo | Responsabilidad / autoridad | Persistencia | Fallo |
|---|---|---|---|---|
| Identity (agente) | `main/hooks.ts`, `main/hive.ts` (registry de tokens, en memoria) | Autentica hooks | memoria | deny `IDENTITY_*`; **sin tokens registrados → usa el id declarado** (`hooks.ts:225-230`) |
| Identity (humano) | `main/humanIdentity.ts` | Ventana propia + URL de confianza | `humanId` en config | `null` → rechazo |
| Classification | `shared/lapitaya/toolRisk.ts`, `intent.ts` | Riesgo por regex/tablas | — | `RISK_CLASSIFICATION_UNAVAILABLE` |
| Autonomy | `shared/lapitaya/autonomy.ts` | riesgo → modo | — | — |
| Authorization | `shared/.../governance.ts` + `main/cimaRuntime.ts:366` | Decisión por llamada | ledger + approvals.json | DENY |
| Intent boundary | `main/intentBoundary.ts` | Alicia→runtime, no ejecuta | ledger | DENY/DELIVERY_FAILED |
| Evidence | `main/cimaRuntime.ts` (`recordTrace`), `shared/.../cimaRuntime.ts` | Trazas + veredicto de claims | traces.jsonl, ledger | ver §15 |
| State | `cimaRuntime.ts` (`writeState`, `append`) | proposals/approvals/ledger | archivos | fail-closed por corrupción |
| Human decision | `main/humanGovernanceIpc.ts` | adapta IPC → runtime | — | `NOT_AUTHORIZED` |
| Recovery | — | **no existe** como rutina | — | — |

## 5. Authority Model

Matriz derivada del código (`evidence/authority/findings.md`):

| Operación | Agent | El Inge | Alicia | Human | Runtime | Provider |
|---|---|---|---|---|---|---|
| propose | mensajes hive | mensajes hive | `alicia:submit` (intent) | vía Alicia/Decision Center | abre la proposal (`openRequest`) | — |
| classify | — | — | claim ignorado (`stricterType`) | — | **único** | — |
| authorize | — | — | — | indirecto (approvals) | **único** (`authorize`) | — |
| execute | tools | tools | **nada** (`intentBoundary.ts:13`) | — | no ejecuta | ejecuta tras allow |
| approve / reject | — | — | — | **solo** (`lapitaya:decide`) | registra | — |
| confirm / cancel / complete REQUEST | — | — | — | **solo** (`by==='human'`) | registra | — |
| write evidence | claims | claims | — | — | **único** (traces desde payloads del provider) | emite payloads |
| write state | `tasks.json` vía tools | ídem | — | — | proposals/approvals/ledger | — |
| expire | — | — | — | — | `checkExpirations` | — |
| recover | — | — | — | manual | **sin rutina** | — |
| delegate | mensajes / `Task` | ídem | — | — | `parseAssignment` (acepta de cualquier remitente) | — |

- **FACT** — El runtime (`decide`, `confirmRequest`) acepta contexto humano opcional/`by` como string; el requisito de identidad humana vive en el adaptador IPC, no en el método.
- **FACT** — `listRequests()` devuelve la proposal completa **incluido `token`** al renderer (`cimaRuntime.ts:611`, `index.ts:4077`): el token de confirmación no es un factor humano separado.

## 6. Governance Boundary

- **Authority boundary**: `CimaRuntimeService` (main process). **Enforcement boundary**: el hook PreToolUse (`hooks.ts:391-411`) + gates de `HiveManager` para tasks. **Evidence boundary**: `traces.jsonl`/ledger. **State boundary**: `<hive>/lapitaya/*`.
- **FACT** — Es una combinación: policy engine puro + máquina de estados de proposals/approvals + servicio de ledger. No es un kernel con tabla de reglas.
- Rutas que entran a governance y salen sin ella / ejecutan antes: **ninguna para tools que llegan al hook**. Rutas **fuera** del boundary: outbox (S-2), `hive:send` (`from` del renderer), escritura directa de `tasks.json`/`lapitaya/*` por procesos no gobernados, providers `observe-only` con opt-out humano.

## 7. Governance Pipeline

`hook identity → HALT → operator gate → authorize [state ok → classify → mode → approval lookup → REQUEST gate → task-ledger gate → consume approval → raise approval → record decision] → execute → PostToolUse trace → CIMA claim → ledger → gate de DONE`.

- Obligatorios: identidad, clasificación, registro de la decisión (si falla el append, una decisión ejecutable se niega, `:434-440`).
- Opcionales/derivados: REQUEST gate, gate de tasks, estado de fases (derivado del ledger en cada `load()`).
- Pueden faltar: el ledger de `transition`, `trace`, `HUMAN_APPROVED`, record CIMA y bloqueo de completion se escriben **ignorando el resultado** (`:539, :853, :890, :913, :926, :777`).
- Repetibles/fuera de orden: transiciones de request protegidas; fases CIMA sin orden salvo TEST/AUDIT/DECISION.
- Duplicación (FACT): lista de nombres de shell ×4, lista de write-tools ×3, FNV-1a ×2, regla Builder≠Auditor ×2 (`cima.ts canApprove` sin uso en runtime).

## 8. Phase Model

- **FACT** — Las 8 fases son etiquetas en registros del ledger y roles de agente (`phaseForAgent`); no hay registro de fase por tarea (se deriva). No hay estado duplicado.
- Avanzar: cualquier agente puede enviar cualquier fase de cualquier tarea (**sin vínculo a asignación**, probe3); DECISION: solo god (o human con contexto confiable, que el router nunca pasa — `index.ts:314` llama `handle(from,to,cima,id)` sin `humanCtx`).
- Evidencia: `EVIDENCE_FIRST` para PASS/FAIL. Orden: solo TEST←BUILD, AUDIT←TEST, DECISION←AUDIT+cadena; LEARN exige algún AUDIT; CONTEXT/ARCHITECT/ITERATE sin reglas.
- Repetir: sí (último registro sin violaciones gana). Retroceder: un FAIL/BLOCKED genuino posterior invalida el PASS previo; rebuild tras DECISION bloquea DONE.
- **INFERENCE** — Modelo conceptual y runtime están alineados en el núcleo BUILD→TEST→AUDIT→DECISION; el resto del ciclo es vocabulario, no enforcement.

## 9. Builder vs Auditor

- **FACT** — Enforced por runtime, persistente (ledger), basado en identidad del hook. Fallas verificadas: (a) "builder" = quien **envió** BUILD, no quien modificó código — W escribió código, Y envió BUILD, W pasó TEST (probe3); (b) la atribución de claims depende del outbox (S-2).
- **RECOMMENDATION (implicación, sin nuevos roles)** — la separación debería anclarse a quién modificó (trazas `write`) y no solo a quién declaró. También hay separación implícita no modelada: quien aprueba un HIGH vs quien lo propone (humano único hoy).

## 10. Human Governance

- Alicia **no** es autoridad (FACT: `AUTHORITY_FIELDS`, `authority:*` → `NOT_AUTHORIZED`, intentBoundary no ejecuta). Puede proponer (intent), mostrar (observabilidad), pero no confirmar/aprobar/cancelar/ejecutar.
- Confirmación (REQUEST: PROPOSED→CONFIRMED, token de un solo uso + fingerprint), aprobación (HIGH: one-shot por fingerprint), rechazo y cancelación son mecanismos distintos con transiciones distintas (FACT). Una confirmación nunca equivale a aprobación HIGH (`requestGate`, `intent.ts:394`).
- **OBSERVATION** — La "identidad humana" = ventana propia + URL propia (`humanIdentity.ts:resolve`). Un renderer comprometido es el humano; el nivel 4 no está diseñado.

## 11. Progressive Autonomy

- **FACT** — Riesgo y autonomía están separados (`ACTION_RISK` + `modeFor`). `HIGH + AUTO` es imposible por construcción (`autonomy.ts:97`; verificado en 4 stages, probe3). Combinación inválida no impedida: ninguna.
- **OBSERVATION** — `mcp__*` es MEDIUM plano → `AUTO` en SEMI_AUTONOMOUS/AUTONOMOUS (probe3). `WebFetch/WebSearch` LOW (exfiltración por URL no modelada).
- Stage viene de config (`index.ts:262`); el opt-out `lapitayaAllowUngovernedProviders` es otra palanca humana fuera de la tabla.

## 12. Evidence Model

Ver `evidence/evidence/findings.md`. Evidencia = traza (payload del provider) + record CIMA + decisión + transiciones. Reproducible y auditable: sí para decisiones. "Inmutable lo bastante": no — append-only por convención, sin cadena/firma. Correlada: por FNV-32 (decisión↔traza) y por coincidencia textual (claims↔trazas). Recuperable: parcialmente (§16).
**Hecho adicional** — providers cuyo tool de shell se llama `shell`/`run_shell_command` generan trazas `kind:'tool'`; sus claims de evidencia por comando terminan `BLOCKED/EVIDENCE_FIRST` (probe4).

## 13. State Model

| Almacén | Escritor | Atómico | Lock CIMA | Integridad |
|---|---|---|---|---|
| ledger / traces | `append` (fsync) | append | sí (fail-open) | parseo por línea |
| proposals / approvals | `writeState` | tmp+fsync+rename | sí | parseo + FNV-32 en proposals |
| tasks.json | `HiveManager.writeJson` | **no** | **no** | ninguna |
| registry.json | `atomicWriteJson` | rename sin fsync | no | ninguna |

- **FACT** — No hay fuente única: estado de proposal/approval vive en JSON **y** en transiciones del ledger; el JSON es authoritative para ejecución, el ledger para hechos CIMA. El estado se escribe antes que el ledger y el fallo del ledger se ignora.
- **FACT** — No hay etiqueta de integridad: un `approvals.json` escrito a mano con `status:'approved'` y el fingerprint correcto devuelve `APPROVED` (probe1 P3).

## 14. Event Model

- **FACT** — No hay modelo de eventos: sin `id` de evento, sin secuencia ni hash previo; orden = posición en archivo + `ts` local; ids `now.toString(36)-seq` con `seq` por proceso (`nextId`, `:353`), sin deduplicación ni replay que reconstruya estado.
- **INFERENCE** — El ledger se *parece* a event sourcing (append-only, transiciones nombradas) pero no lo es; reconstruir proposals/approvals desde él requeriría ids, orden y causalidad que hoy no existen. No es defecto mientras no se prometa recovery por replay.

## 15. Failure Model

Matriz completa en `evidence/failure/findings.md`. Resumen:

| Falla | Comportamiento | Fail closed | Recuperable |
|---|---|---|---|
| identidad ausente/token inválido | deny | sí | sí |
| **sin tokens registrados** | usa id declarado | **no** | n/a |
| autorización/clasificador falla | deny | sí | sí |
| ledger falla en decisión | `LEDGER_UNAVAILABLE` | sí | sí |
| ledger falla en transición/traza/human-record/claim | ignorado | **no** | divergencia silenciosa |
| ledger corrupto (cola truncada) | deny global, todas las instancias | sí | **manual**; el siguiente append pega y rompe otro registro (probe2 P6b) |
| proposals/approvals corruptos | deny | sí | manual |
| `submit()/handle()` con estado corrupto | evalúa y añade igual | **no** | — |
| approval pendiente/proposal vencidos | `expired`/`EXPIRED` | sí | n/a |
| approval **aprobado** sin consumir (30 días) | sigue `APPROVED` | **no** | — |
| runtime concurrente con lock fresco | continúa sin lock y lo deja | **no** | — |
| lock obsoleto (>5 s mtime) | se borra y se retoma, sin owner/pid | parcial | sí |
| crash en escritura | `.tmp.*` ignorado, nunca limpiado | sí | sí |
| provider sin bridge bloqueante | no spawn (salvo opt-out) | sí | humano |
| shell indirecto/ofuscado | MEDIUM | **no** | — |
| renderer falla | sin efecto en autorización | n/a | n/a |
| transición inválida | `NOT_CONFIRMABLE`/null | sí | n/a |

**INFERENCE** — Existe un modelo coherente de *denegar ante duda* en el camino de autorización; no existe un modelo coherente para *escrituras secundarias* (ledger de transiciones, trazas, records CIMA), que no tienen garantía de escritura.

## 16. Recovery Model

- **FACT** — v0.12 implementa detección + fail-closed + atomicidad. **No implementa recovery**: ninguna rutina repara cola truncada, divergencia estado/ledger, `consumed` sin registro ni deriva de `tasks.json`; los `*.tmp.*` no se limpian.
- Recuperable hoy: nada automático. Requiere humano: ledger truncado, approvals/proposals corruptos. Reconstruible en principio (INFERENCE): estado de request/approval desde transiciones **si** hubiera ids/orden. Nunca debe reconstruirse solo: DECISION/PASS, aprobaciones, confirmaciones (el código y STATE-25/26/29 coinciden).
- **RECOMMENDATION** — tratar "recovery" como capacidad separada y explícita (procedimiento iniciado por humano con evidencia preservada), no como extensión del fail-closed.

## 17. Multi-Instance

- **FACT** (código `:151-204`, probe1 P4) — `.governance.lock` con `openSync(…,'wx')`; 5 intentos **sin espera**; si no se adquiere, **la operación sigue sin lock** (`acquired=false`, `lockDepth=1`) y el lock ajeno permanece. Sin owner/pid; obsolescencia por mtime >5 s (una operación legítima más larga pierde el lock); sin fairness; deadlock imposible (nunca bloquea) pero **exclusión mutua no garantizada**.
- Lecturas sin lock devuelven caché obsoleta entre instancias (probe2 P5b: 0 vs 1 en disco): `listApprovals`, `listRequests`, `completionGate`, `blockedCompletions`, `recentTraces`, `cimaRecords` — alimentan Decision Center/Alicia y el gate de DONE.
- **INFERENCE** — Suficiente como mitigación sin garantía de exclusión para un Electron local de una instancia más una secundaria ocasional; **no** suficiente como garantía de exclusión, y no extensible a runtime distribuido. Los tests de multi-instancia son secuenciales (§24).

## 18. Provider Architecture

- Provider = backend de ejecución + fuente de evidencia; sin camino de autoridad hacia approve/confirm/decide (FACT). La gobernanza del runtime es agnóstica; el acoplamiento está en el *bridge* (`providerGovernance.ts`: `BLOCKING_SHIMS` literal) y en los nombres de tools.
- Nuevo provider: ver §23. **OBSERVATION** — el desacople es correcto en el runtime pero depende de listas manuales y de nombres de tool (probe4).

## 19. MCP

- **FACT** — Todo `mcp__*` pasa por `authorize()` y por el gate de tasks (`:407`): el *entry* está gobernado. Pero se clasifica plano `shell-command/MEDIUM` sin distinguir servidor ni herramienta (`mcp__github__delete_repository` → SUPERVISED; AUTO en stages superiores).
- **INFERENCE** — MCP está integrado al mismo boundary, pero como *transporte no clasificado*; su riesgo real queda en manos del agente. "`authorize()` existe" no equivale a "MCP está gobernado con granularidad".

## 20. Tool Governance

`toolRisk → autonomy.modeFor → governance.authorizeToolCall → cimaRuntime.authorize → hooks → (providerGovernance en spawn) → completionGate (solo tasks)`. **INFERENCE** — cadena coherente para el flujo principal; `providerGovernance` y `completionGate` son módulos relacionados pero independientes (distintos puntos de aplicación). Duplicaciones listadas en §7.

## 21. Observability

- **FACT** — Alicia v0.6 es proyección pura sobre `ledger(3000)`, `recentTraces`, approvals, requests (`index.ts:4115`); sin modelo, sin texto libre; "sin evidencia, sin claim".
- **FACT** — `ledger()` descarta líneas malformadas en silencio (`cimaRuntime.ts:932-940`) y los lectores sin lock pueden estar obsoletos; la proyección puede presentar un ledger parcial/obsoleto sin señal de corrupción ni de antigüedad. FACT (producto) vs EXPLANATION (texto) están bien separados; FACT (estado) vs "estado confiable" no.

## 22. Auditability

Una decisión reconstruye WHO/WHAT/WHEN/RISK/RULE/RESULT/HUMAN desde el ledger sin memoria de modelo, UI ni provider. Faltan: WHY de aprobaciones más allá del `summary` de la clasificación; registro de `consumed`; vínculo de integridad (sin cadena ni firma, por lo que la ausencia de líneas no es detectable); orden causal estricto.

## 23. Extensibility

Ver `evidence/extensibility/findings.md`. Nuevo provider: ≥4 archivos (preset/bridge, `BLOCKING_SHIMS`, hive shim, nombres de tool). Nuevo tool: sets en toolRisk + literales ×3 en cimaRuntime. Nuevo riesgo: `ACTION_RISK` central (bien) + `ACTION_RULES`. Nueva regla de gobernanza: inline en `authorize()`. Nuevo tipo de decisión humana: ≥5 capas. **No hay registro central ni interfaz de extensión** para reglas.

## 24. Test Architecture

- v0.10/0.11/0.12: 31/38/25 verdes (re-ejecutadas).
- **FACT** — 93 de 315 fallan en las 11 suites anteriores (cima-runtime-v03 18, alicia-v07 13, cima-runtime 12, alicia-v042 11, alicia-v06 9, alicia-v08 7, alicia-v04 7, alicia-v09 5, v031 4, alicia-v041 4, alicia-v05 3); causa `IDENTITY_UNTRUSTED` (fixtures sin token, probe5). **INFERENCE** — introducido por v0.10; no bisecado.
- Cobertura: unitaria/integración del runtime sí; adversarial v0.10–0.12 sí; concurrencia **no real** (STATE-18/19/21/22 secuenciales en un proceso); recovery limitado a "no se inventan hechos"; sin tests de colisión, normalización de rutas, suplantación de outbox, lock retenido, cola truncada + append, lectura obsoleta, edad de approvals; sin pruebas Electron/IPC end to end.
- **INFERENCE** — Los tests v0.10–0.12 demuestran invariantes del happy-adversarial *dentro del modelo de amenaza declarado*; no demuestran los invariantes de autorización (binding) ni de canal.

## 25. Security Boundary

| Componente | ¿Confiable? | Por qué | Boundary |
|---|---|---|---|
| Agent | No | actor | hook + token |
| Provider (CLI/shim) | Parcial | origen de los payloads de traza; se confía en el shim | bridge |
| Renderer | No para autoridad / sí para identidad humana | `resolve` confía en ventana+URL propia; recibe tokens de confirmación | IPC |
| IPC main | Sí | frontera de identidad humana | `humanGovernanceIpc` |
| Filesystem `lapitaya/*` | No debería | sin integridad (S-4); protección solo por clasificador (S-3) | ninguno |
| Shell | No | clasificación léxica (S-5) | hook |
| MCP | No | MEDIUM plano | hook |
| Human | Sí | autoridad | IPC |
| Task / tasks.json | No | sin lock, sin integridad | gate en API + hook |
| Evidence/ledger | Sí por convención | append-only no verificado | runtime |

## 26. Threat Model Maturity

| Nivel | Diseñado | Evidencia |
|---|---|---|
| 1 accidental failure | **Sí** | v0.12 |
| 2 malicious agent | **Parcial** | gate PreToolUse sólido; brechas S-1, S-2, S-3, S-5 |
| 3 malicious provider | No | payloads de traza confiados (INFERENCE: no hay verificación de que el shim diga la verdad) |
| 4 compromised renderer | No | el renderer es el humano y ve los tokens |
| 5 local process attacker | No | estado sin integridad; socket/archivos |
| 6 multi-instance race | Parcial | lock fail-open, lecturas obsoletas |

## 27. Performance / Scalability

- **FACT** (probe1 P8) — Cada `authorize()` reparsea ledger+traces completos: 15.7 ms (2k líneas totales), 64.4 ms (20k), 267.8 ms (100k), lineal; el ledger no rota; `ledger()` lee el archivo entero en cada llamada de la UI.
- Cuellos de botella (sin extrapolar tamaños de hive): relectura completa por llamada, un solo archivo de ledger, `tasks.json` reescrito completo + commit git síncrono por escritura (`hive.ts:1913`, `writeTasksInternal`), `traces` 5000 en memoria. No se evaluaron 10/100/1.000/10.000 tareas con benchmark.

## 28. Operability

- Los bloqueos devuelven `rule` y razón textual y quedan en el ledger (ERROR→RULE sí; →EVIDENCE parcial; →NEXT ACTION solo en texto para el agente). Con ledger corrupto un operador ve `GOVERNANCE_STATE_CORRUPT` con el nombre del archivo, pero **no hay herramienta ni procedimiento** de diagnóstico/reparación; todo agente queda denegado hasta intervención manual.

## 29. Documentation Consistency

Detalle en `evidence/documentation/findings.md`: (1) v0.10 afirma identidad verificada en `send()`/`routeOnce()`: no implementado; (2) FNV descrito como riesgo de correlación; (3) tabla v0.12 de traces; (4) TTL solo para pendientes; (5) "multi-instancia sincronizada" vs lock fail-open; (6) tests de concurrencia secuenciales; (7) "0 fallos preexistentes" vs 93; (8) cabecera de `cimaRuntime.ts` desactualizada. No se corrigió documentación.

## 30. Architectural Debt

**CRITICAL**
- C1 FNV-32 como binding de aprobación (probe2 P1). C2 Identidad de remitente en canal de mensajes no verificada (S-2). C3 `classifyWritePath` sin normalización + estado sin integridad (S-3/S-4; cadena no ejecutada contra un CLI real).

**HIGH**
- H1 Lock fail-open sin espera/owner; lecturas obsoletas sin lock. H2 Escrituras secundarias de ledger ignoradas; `submit/handle` ignoran corrupción; cola truncada = deny global sin reparación y pegado del siguiente registro. H3 Clasificación de shell léxica; `tasks.json` sin reconciliación posterior (S-5). H4 Suites legadas rojas (93). H5 Recarga completa por llamada, ledger sin rotación.

**MEDIUM**
- M1 Builder = quien envió BUILD; fases enviables por cualquier agente sobre cualquier tarea. M2 Nombres de tool de provider (`shell`) sin trazas de comando. M3 MCP plano MEDIUM; `WebFetch` LOW. M4 Approvals `approved` sin TTL; `actionFingerprints` sin poda. M5 Observabilidad sin señal de corrupción/antigüedad. M6 Token de confirmación expuesto al renderer. M7 Sin modelo de eventos (ids/orden/causalidad). M8 Política duplicada (nombres de shell ×4, FNV ×2, Builder≠Auditor ×2). M9 Sin registro de extensión.

**LOW**
- L1 `*.tmp.*` no se limpian. L2 `parseAssignment` acepta asignaciones de cualquier remitente. L3 DECISION humana por el router no cableada. L4 `nextId` con `seq` por proceso.

## 31. FNV-32

1. **Dónde**: `governance.ts:95-116` (fingerprint de llamada), `cimaRuntime.ts:530` (huella de proposal), `intent.ts requestGate` (`actionFingerprints`), `alicia/observability.ts:21` (copia).
2. **Qué protege**: la identidad "misma llamada" de las aprobaciones HIGH; la integridad de proposals; la exención del REQUEST gate.
3. **Qué correlaciona**: decisión↔traza (`fingerprint` en ambos).
4. **Colisión**: una colisión de aprobación hace que la aprobación de A ejecute B.
5. **¿Security boundary?** **Sí** (aprobación). 6. **¿Integrity boundary?** Sí (proposal; con token de un solo uso como segunda defensa). 7. No es solo optimización de lookup.
8. **¿Una colisión produce autorización?** **FACT**: sí (probe2: `git push origin feature-x` aprobado → `rm -rf /important/data # 9 LUpT` `APPROVED`, 52 ms, 10 variantes de prefijo). Precondición: el agente obtiene una aprobación humana de *alguna* llamada HIGH propia y conoce el algoritmo (código abierto en el repo).
9. **Mitigación existente**: `agentId` en la clave y un solo uso; ninguna frente a un colisionador deliberado. No se compara el texto ni la categoría de la llamada.
- **Determinación basada en evidencia: ARCHITECTURAL BLOCKER** para cualquier afirmación de seguridad frente a agente malicioso (nivel 2) y para "plataforma". No es solo "mejora futura". (Lo dicho no implementa nada; el cambio es de la clase "slice de binding", ver §34.)

## 32. Product Maturity

**HARDENED** — evidencia: fail-closed consistente en el camino de autorización, estado atómico, tests adversariales v0.10–0.12, separación Alicia/humano/runtime. **No PRODUCTION-CAPABLE** frente a agentes adversariales: el binding de aprobación (C1), el canal de mensajes (C2) y las suites legadas rojas (H4) lo impiden. **No PLATFORM-READY**: sin registro de extensión, sin modelo de eventos, lock local.

## 33. Recommended Direction

Decision Gate: **A — continuar hardening técnico**, con el contenido de **B (slice de binding/correlación)** como primer elemento por dependencia arquitectónica. **No C** todavía; **no D** (la estructura es coherente: una autoridad, reglas puras, fail-closed). Razón: C1/C2 son brechas de autorización que cualquier evolución de producto (más providers, MCP, multi-agente) multiplica; H4 impide demostrar regresiones.

## 34. Future Slices

1. **S1 — Authorization binding.** *Objetivo*: que una aprobación (y las huellas de proposal/exención) identifique la llamada exacta de forma resistente a colisiones y verifique categoría/contenido. *Por qué*: C1. *Dependencias*: ninguna. *No-objetivos*: firma criptográfica del ledger, cambio de UX. *Riesgo*: migración de approvals existentes y de la correlación traza↔decisión.
2. **S2 — Channel identity & path canonicalization.** *Objetivo*: remitente verificado en outbox/`hive:send`; normalización de rutas antes de clasificar; protección de `outbox/` ajenos; endurecer la clasificación de escrituras indirectas a estado de gobernanza. *Por qué*: C2, C3(parte), H3. *Dependencias*: S1 no; comparte el token de v0.10. *No-objetivos*: sandbox de SO. *Riesgo*: romper flujos legítimos del hive.
3. **S3 — Lock & write-path semantics.** *Objetivo*: lock que no continúa sin exclusión, lecturas consistentes, propagar fallos de escritura secundarios, no agregar sobre estado corrupto, procedimiento de recovery explícito iniciado por humano, ledger incremental/rotado. *Por qué*: H1, H2, H5. *Dependencias*: ninguna fuerte. *No-objetivos*: DB distribuida, event sourcing. *Riesgo*: latencia de hooks; comportamiento ante lock retenido.
4. **S0 — Test baseline restoration** (puede ir primero, es pequeña). *Objetivo*: que las 11 suites legadas vuelvan a ejecutar sus invariantes (fixtures con identidad válida) y añadir tests de colisión/rutas/outbox/lock multi-proceso. *Por qué*: H4. *No-objetivos*: nuevas features. *Riesgo*: descubrir regresiones latentes.

Tras S0–S3 y con la evidencia correspondiente, la evaluación de pasar a evolución de producto (opción C) tendría base.

## 35. Final Verdict

**ARCHITECTURAL GAPS REQUIRE ANOTHER HARDENING SLICE**

La arquitectura es coherente y no requiere rediseño. Las brechas verificadas están en el enlace aprobación↔llamada (FNV-32), en la identidad del canal de mensajes, en la clasificación de rutas/estado sin integridad, y en la semántica fail-open del lock y de las escrituras secundarias. Limitaciones de esta revisión: la cadena S-3→S-4 y la suplantación vía outbox se verificaron por eslabón sin ejecutar un CLI/hook real; typecheck, build y Electron no se re-ejecutaron.
