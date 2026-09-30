# La Pitaya — Foundation 01 (Fork Initialization v0.1)

Rama: `lapitaya/foundation-v0.1` · base: `ed06e3e7` (upstream `main`) · fecha: 2026-09-29.
Evidencia cruda: [`evidence/lapitaya-foundation/`](../evidence/lapitaya-foundation/).

## 1. Executive Summary

El fork arranca, compila y pasa typecheck. Muestra **La Pitaya** en español (es-MX) por defecto, y
el orquestador **El Inge** ejecutó dos tareas reales en el hive: un análisis de arquitectura en
solo lectura y una modificación pequeña con pruebas. Los otros cinco agentes existen como presets
contratables verificados en la UI. CIMA, la política de autonomía, el modelo de tres idiomas y la
frontera de Alicia están implementados como módulos puros, probados y documentados.

La suite de pruebas **no tiene fallas nuevas**: las 21 que quedan ya existían en el baseline y
vienen del entorno Windows.

Veredicto: **PASS_WITH_OBSERVATIONS** (ver §16).

## 2. Original Baseline

Detalle en [LA_PITAYA_FORK_BASELINE.md](LA_PITAYA_FORK_BASELINE.md). Resumen: Electron 32 + React
18 + electron-vite, Node 24 local, npm. Cada agente es un CLI externo en `node-pty`, coordinado por
un hive de archivos. Baseline: typecheck exit 0, build exit 0, tests 816/849 pass con **22 fail
preexistentes** (EPERM de symlinks, regex sensibles a CRLF, catálogo remoto de modelos, config).

## 3. Changes Made

| Área | Archivos |
| --- | --- |
| Capa nueva La Pitaya | `src/shared/lapitaya/{brand,locales,agents,cima,cimaBriefing,autonomy,alicia,index}.ts` |
| Identidad visible | `index.html`, `main.tsx`, `App.tsx`, `main/index.ts` (título), `ReleaseDrop.tsx`, `UpdateToast.tsx`, `SettingsHeroCard.tsx`, `hive.ts`, `realtime/{session,tools}.ts`, `AddAgentModal.tsx` (prompt IA), `README.md` (encabezado) |
| Empaquetado / updater | `electron-builder.yml`, `package.json` (metadatos; `name` intacto), `updater.ts`, `updateState.ts` |
| Orquestador | `godIdentity.ts` (El Inge + migración de "Michael"), `useHive.ts` (`initialGodPrompt` con CIMA y autonomía), `agentRole.ts`, `engineAvailability.ts`, `main/index.ts` (protocolo Slack) |
| Agentes / elenco | `scene/office/cast.ts` (6 sprites con nombres y roles de La Pitaya, `castDisplayName`), `AddAgentModal.tsx` (fila "Equipo La Pitaya", ids sin diacríticos), `EditAgentModal.tsx` |
| i18n | `i18n/index.ts` (es-MX default, en-US fallback, alias `en`→`en-US`, namespace `lapitaya`, `getLocaleSettings`/`setAgentLocale`/`setNotificationLocale`), `locales/es-MX.json` (1,170 claves, nuevo), `locales/lapitaya/{es-MX,en-US}.json` (nuevos), marca en `en/zh-CN/ar.json`, `LocaleSettingsRows.tsx` (nuevo) + `SettingsModal.tsx` |
| Pruebas | `test/lapitaya-foundation.test.cjs` (nuevo, 25 pruebas); `i18n-god-name.test.cjs` y `arabic-ui.test.cjs` actualizados a la política es-MX; `fixtures/bug-14.renderer.js` fija en-US |
| Documentación | `docs/LA_PITAYA_FORK_BASELINE.md`, `LA_PITAYA_IDENTITY.md`, `AGENTS.md`, `CIMA/{README,PRINCIPLES,ROLES,WORKFLOW,EVIDENCE,AUTONOMY}.md`, `ALICIA/README.md`, este archivo |
| Hecho por El Inge (tarea 2) | `MEMORY_GRAPH_SPEC.md` (una línea de estado) |

## 4. Architecture Changes

```text
Munder Difflin Runtime   (intacto: main / preload / renderer, hive, PTYs, memoria)
        ↓
La Pitaya Identity       src/shared/lapitaya/brand.ts
        ↓
La Pitaya Agents         agents.ts → godIdentity.ts (El Inge) + presets en AddAgentModal
        ↓
CIMA Layer               cima.ts + autonomy.ts + cimaBriefing.ts → prompt de El Inge
        ↓
Future Alicia Layer      alicia.ts (frontera no-op)
```

Sin dependencias nuevas, sin cambios de framework y sin tocar el motor de mensajería.

## 5. Agent Mapping

| La Pitaya | Upstream | Runtime | Verificado |
| --- | --- | --- | --- |
| El Inge | Michael / god | god auto-lanzado | Lanzado en vivo. `log.jsonl`: `{"kind":"spawn","agentId":"god","name":"El Inge","isGod":true}`. El registro migró de "Michael" a "El Inge". Ejecutó 2 tareas |
| Valentín / El Beni / Margarito / José Juan / El Tutú | — (roles nuevos) | presets de hire | Botones en "Agregar agente" verificados en vivo: `["Valentín · Arquitecto","El Beni · Constructor","Margarito · Probador","José Juan · Auditor","El Tutú · Aprendiz"]`; al hacer clic en Valentín se llena `Valentín` + sprite (`add-agent-team.png`). **No se lanzaron** |
| Alicia | — (nueva) | capability no-op | Pruebas unitarias |

## 6. CIMA Integration

- Ids estables `CONTEXT…ITERATE`, núcleo `BUILD/TEST/LEARN/ITERATE` y `nextPhase()`.
- Builder != Auditor con `canApprove`, Evidence First con `isVerdictBacked`/`evidenceAllowsPass`,
  Human Governance (HIGH siempre requiere humano) y Progressive Autonomy (4 etapas).
- El Inge recibe el equipo, las reglas y la política en su prompt de arranque.
- Aplicado en la tarea 2: El Inge construyó y el auditor fue independiente (§12).
- **Todavía no se aplica en el runtime**: las funciones no se invocan desde `hive.ts`. Está
  documentado en `docs/CIMA/AUTONOMY.md` y El Inge lo señaló por su cuenta en su informe.

## 7. i18n Integration

- `es-MX` es el default (sin auto-detección del SO) y `en-US` el fallback. `zh-CN` y `ar` se
  conservan. `pt-BR, fr-FR, de-DE, ja-JP, zh-CN` están declarados en `PLANNED_LOCALES`.
- `es-MX.json` está completo: 1,170/1,170 claves, 0 placeholders perdidos y 0 diferencias de
  arrays (validado por script y por pruebas).
- `uiLocale`, `agentLocale` (default en-US) y `notificationLocale` se guardan por separado y se
  editan en Configuración → General.
- Nombres: es-MX con acentos, en-US en ASCII exacto; el namespace en-US no tiene acentos
  (probado).
- CIMA y la evidencia no se traducen: los ids son claves y la evidencia se cita textual.
- Verificado en vivo: `document.documentElement.lang = "es-MX"` y la UI dice "CENTRO DE MANDO",
  "El Inge dirige el piso", "Mensaje para El Inge".

## 8. Alicia Foundation

`alicia.ts` define `AliciaEvent`, `AliciaCapability`, `ALICIA_DISABLED`, `registerAlicia()` y
`alicia()` (con contención de excepciones). No hay UI ni se lanza nada. El roadmap está en
[ALICIA/README.md](ALICIA/README.md).

## 9. License / Asset Findings

| Hallazgo | Severidad | Acción |
| --- | --- | --- |
| Tilesets LimeZu con licencia **comprada por el autor upstream** | Alta (distribución) | PitayaCode compra su propia licencia o reemplaza los tilesets antes de distribuir binarios. El crédito se mantiene |
| Elenco, frases (`cafeteriaLines.ts`, `office.gossip`) y tema `brooklyn99` evocan IP de NBCUniversal | Media | 6 sprites ya renombrados; falta reemplazar arte, nombres restantes y frases |
| Logo `docs/logo.png` es la marca Munder Difflin | Media | Pendiente un logo de La Pitaya |
| Código MIT | — | `LICENSE` conservada y atribución en `brand.ts`, `package.json`, `electron-builder.yml` y README |
| Fuentes OFL 1.1 | — | Reutilizables con aviso |

## 10. Tests Executed

| Corrida | Resultado |
| --- | --- |
| Baseline `npm run test:focused` | 849 pruebas: 816 pass, **22 fail**, 11 skipped (exit 1) |
| Final `npm run test:focused` | 876 pruebas: 844 pass, **21 fail**, 11 skipped (exit 1) |
| Fallas nuevas vs baseline | **0** |
| Fallas del baseline que ya no fallan | 1: `electron-builder points the release notes at a file that exists`. **No es un arreglo**: editar `electron-builder.yml` con `sed` dejó su copia de trabajo en LF, y la prueba solo fallaba por CRLF |
| `test/lapitaya-foundation.test.cjs` + `i18n-god-name` + `arabic-ui` | todas pasan |
| Falla intermedia detectada y corregida | `restart-terminal-preserve` buscaba el botón en inglés "restart & continue" y la UI ya estaba en es-MX; el fixture ahora fija en-US |

## 11. Commands Executed

```text
npm run typecheck            # baseline y final → exit 0
npm run build                # baseline y final → exit 0
npm run test:focused         # baseline y final (ver §10)
node --test test/lapitaya-foundation.test.cjs test/i18n-god-name.test.cjs test/arabic-ui.test.cjs
env -u ELECTRON_RUN_AS_NODE npx electron-vite dev --remoteDebuggingPort 9333   # primera ejecución real
node cdp.mjs 9333 eval|shot   # inspección de la UI vía Chrome DevTools Protocol (script de scratchpad)
window.cth.hiveSend({to:'god',act:'request',…},'human')   # mismo canal que el botón "Despachar"
```

## 12. Evidence

**Build y typecheck finales**: `final-build.txt` (`✓ built in 1m 48s`, `build exit=0`) y
`final-typecheck.txt` (`typecheck exit=0`).

**UI en vivo** (`first-run-el-inge.png`):

```json
{ "title": "La Pitaya", "lang": "es-MX", "hasElInge": true, "hasMichael": false, "hasMunder": false,
  "snippet": "v0.4.6 … CENTRO DE MANDO\ninactivo\nEl Inge dirige el piso … EL INGE … JEFE …" }
```

**Tarea real 1** (solo lectura). Despachada a las 01:29:24Z; El Inge respondió
`"subject":"Arquitectura de La Pitaya"` a las 01:37:51Z. El informe completo está en
`first-task-reply.txt` y sus 25 llamadas a herramientas en `first-task-tools.txt`. **Ninguna
escritura en el repo**: sus `Write`/`Edit` fueron solo en su hive (outbox, `tasks.json`,
`board.md`, `memory.md`). Delegó el análisis a un subagente de investigación en solo lectura.

**Tarea real 2** (modificación pequeña). El Inge hizo de Builder: editó solo la línea `**Status:**`
de `MEMORY_GRAPH_SPEC.md` y entregó la salida cruda de `git diff --stat`, `git diff` y
`node --test` (36/36, `EXITCODE_NODETEST=0`). Está en `second-task-reply.txt`, con las llamadas en
`second-task-tools.txt`.

**Auditoría independiente de la tarea 2** (Builder != Auditor; auditor: Claude Code, no El Inge):

```text
$ git diff --numstat MEMORY_GRAPH_SPEC.md
1	1	MEMORY_GRAPH_SPEC.md
$ node --test test/lapitaya-foundation.test.cjs test/i18n-god-name.test.cjs
ℹ tests 36
ℹ pass 36
ℹ fail 0
```

Veredicto de la auditoría: PASS_WITH_OBSERVATIONS. El alcance se respetó y la ruta citada existe.
Observación: el componente del panel es `components/MemoryGraphPanel.tsx`; `memoryGraph/` solo
tiene la lógica.

## 13. Findings

1. **`ELECTRON_RUN_AS_NODE=1` heredado de VS Code** tumba la app (`app` es `undefined`). Es un
   problema de entorno, no del fork. Se arranca con `env -u ELECTRON_RUN_AS_NODE`, documentado en
   el README.
2. **Menú "Remote Control" de Claude Code** en el primer arranque de El Inge (comportamiento del
   upstream) retiene la entrega de mensajes hasta cerrarlo. Se cerró con Esc ("Never mind"); no se
   activó acceso remoto.
3. **Mensajes `to: human` no persisten su cuerpo** (`delivered: []` en `log.jsonl`). Para leer
   las respuestas hubo que ir al transcript de Claude Code.
4. **Pantallas con inglés fijo fuera de i18n** en el upstream: el selector de configuración del
   harness ("SELECT A HARNESS CONFIG") y "CLOCKING IN".
5. **CIMA y la autonomía no se aplican en el runtime** (conocido y documentado). Con
   `autoMode: true` en la configuración del usuario, la gobernanza de acciones HIGH depende del
   prompt.
6. **El Inge consideró inentregable el standup programado** (`to: "scheduler"`). Es un
   comportamiento del upstream: las misiones de sistema no tienen buzón.
7. **Hive del upstream con "Michael" persistido**: se resolvió con la migración del nombre
   heredado exacto; otros nombres se respetan.

## 14. Remaining Risks

- Licencias de assets (LimeZu, IP de NBC, logo): **bloqueante para distribuir binarios**, no para
  desarrollo.
- Identificadores persistidos `munder-difflin` / `munderdifflin://`: si ambas apps se instalan,
  compiten por el deep link.
- 21 fallas preexistentes en Windows (symlinks, CRLF, catálogo remoto) ocultan regresiones en esas
  áreas.
- `model-catalog.json` y `hero.json` todavía se descargan del repo upstream.
- Los presets de agente no se probaron lanzados en una ejecución CIMA completa con varios agentes.

## 15. Deferred Features

Pets (ciclo de vida, muerte, breeding), desktop companion, hardware y su protocolo, asistente de
voz de Alicia, marketplace de criaturas, personalidad avanzada de Alicia, despliegue autónomo a
producción y agentes que se modifican a sí mismos. También:

- aplicar CIMA y autonomía en `hive.ts`;
- renombrar los identificadores persistidos;
- traducir las pantallas con inglés fijo;
- reemplazar arte y logo.

Siguiente fase: `CIMA → AGENT AUTOMATION`.

## 16. Final Verdict

**PASS_WITH_OBSERVATIONS**

| Criterio | Estado |
| --- | --- |
| Repository: baseline, arquitectura, dependencias, licencia | ✅ |
| Identity: La Pitaya, PitayaCode, marca centralizada, assets revisados | ✅ (reemplazo de assets pendiente, §9) |
| Agents: El Inge operativo | ✅ con 2 tareas reales |
| Agents: Valentín, El Beni, Margarito, José Juan, El Tutú | ⚠️ presets contratables verificados en la UI; no se lanzaron |
| Agents: Alicia preparada | ✅ |
| CIMA: BUILD/TEST/LEARN/ITERATE + 4 principios | ✅ como contrato, prompt y documentación; ⚠️ sin aplicación en el runtime |
| i18n: es-MX, en-US, separación de idiomas, nombres, en-US sin acentos, locales futuros | ✅ |
| Runtime: instalación, dev, build, typecheck | ✅ (dev requiere quitar `ELECTRON_RUN_AS_NODE` bajo VS Code) |
| Runtime: tests | ⚠️ 0 fallas nuevas; 21 fallas preexistentes de entorno |
| Runtime: primera tarea real de agente | ✅ |

No hay fallas funcionales importantes. Las observaciones son las marcadas con ⚠️ y los riesgos de
§14.
