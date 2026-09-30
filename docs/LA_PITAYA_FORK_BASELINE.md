# La Pitaya — Fork Baseline

_Estado del upstream **antes** de cualquier cambio de La Pitaya. Toda afirmación aquí
viene del repositorio o de un comando ejecutado; los logs crudos están en
[`evidence/lapitaya-foundation/`](../evidence/lapitaya-foundation/)._

## 1. Origen

| Campo | Valor |
| --- | --- |
| Upstream | `https://github.com/chaitanyagiri/munder-difflin` (remote `upstream`) |
| Fork | `https://github.com/chessco/lapitaya` (remote `origin`) |
| Commit base | `ed06e3e7618b3477a9fb325203e243a53037d5d2` — _seo-engine: rebuild blog for the OpenCode page_ (2026-09-29) |
| Rama base | `main` |
| Rama de trabajo | `lapitaya/foundation-v0.1` |
| Versión upstream | `munder-difflin@0.4.6` (`package.json`) |
| Working tree al iniciar | `package-lock.json` modificado (−23 líneas, producto de un `npm install` local previo; no se tocó) |

## 2. Toolchain

| Herramienta | Versión observada | Fuente |
| --- | --- | --- |
| Node | v24.14.0 (local) | `node --version` |
| Node en CI | 20 (ci/release), 22 (blog) | `.github/workflows/*.yml` |
| npm | 11.9.0 | `npm --version` |
| Package manager | npm (`package-lock.json`) | raíz |
| TypeScript | ^5.6.3 | `package.json` |
| Electron | ^32.2.0 | `package.json` |
| electron-vite / Vite | ^2.3.0 / ^5.4.8 | `package.json` |

No hay `engines` ni `.nvmrc`.

## 3. Comandos

| Propósito | Comando | Notas |
| --- | --- | --- |
| Instalar | `npm install` | `postinstall` ejecuta `electron-rebuild -f` + parches de `node-pty` |
| Desarrollo | `npm run dev` | `electron-vite dev` |
| Build | `npm run build` | `electron-vite build` + `tools/copy-main-assets.cjs` |
| Typecheck | `npm run typecheck` | `tsconfig.node.json` + `tsconfig.web.json` |
| Tests | `npm run test:focused` | `node --test test/*.test.cjs`; TS se carga con `test/load-ts.cjs` |
| Empaquetar | `npm run dist[:mac|:win|:linux]` | `electron-builder` |
| Links de release | `npm run check:links` | |

No existe script de lint.

## 4. Variables de entorno relevantes (leídas en `src/main`)

`HOME`, `USERPROFILE`, `LOCALAPPDATA`, `PATH`, `PATHEXT`, `SHELL`, `ELECTRON_RENDERER_URL`
(dev), `AGENT_ID`, `HIVE_SOCK`, `HIVE_AUTO_APPROVE`, `HIVE_PROXY_API`, `HIVE_PROXY_SESSION`,
`UPSTREAM_BASE_URL`, `MEMPALACE_EMBEDDING_DEVICE`, `MD_SLACK_REPLY_CONFIG`, `MD_DROP_PREVIEW`,
`DO_NOT_TRACK`. No hay `.env`: las llaves de proveedores (Groq, OpenAI Realtime, Slack…) se
guardan en la configuración de la app desde Settings.

## 5. Arquitectura detectada

Detalle completo en [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) y [`HIVE.md`](../HIVE.md) (upstream). Resumen:

| Capa | Evidencia | Descripción |
| --- | --- | --- |
| Shell | `electron.vite.config.ts`, `src/main/index.ts` (5.4k líneas) | App de escritorio Electron: main + preload + renderer |
| Frontend | `src/renderer/src` | React 18 + zustand (`store/store.ts`) + Pixi.js (office floor) + xterm.js + Monaco/CodeMirror |
| Runtime de agentes | `src/main/pty.ts` | Cada agente es un **CLI externo** (Claude Code, Codex, Antigravity, Cursor, Crush, Grok…) corriendo en un `node-pty` |
| Orquestador | `src/renderer/src/hooks/useHive.ts` (`GOD_ID = 'god'`), `src/shared/godIdentity.ts` | Un agente "god" (default `Michael`) que se auto-lanza, lee el inbox y delega |
| Comunicación | `src/main/hive.ts` (3.5k líneas) | Hive en disco: `registry.json`, inbox/outbox JSON por agente (FIPA-lite), `board.md`, `tasks.json`, `fleet.json` |
| Eventos | `src/main/hooks.ts` | Hook server: los CLIs postean eventos de ciclo de vida (`cth-hook`, `agy-hook`) |
| Memoria | `src/main/memory.ts`, `src/main/kg-core.cjs`, `MEMORY_GRAPH_SPEC.md` | `memory.md` por agente + CLI semántico `mempalace` + grafo de conocimiento; SQLite (`better-sqlite3`) |
| Agentes | `src/shared/hire.ts`, `AddAgentModal.tsx` | No hay agentes fijos: se "contratan" con nombre/rol/goal/proveedor; plantillas de briefing en el modal |
| Asistente | `isAssistant` en `hive.ts`/`store.ts` | "Prep assistant" send-only que enriquece prompts hacia el god |
| Voz | `src/renderer/src/realtime/*` | "Realtime Michael" con `@openai/agents-realtime` |
| Configuración | `src/main/config.ts`, `src/renderer/src/store/config.ts` | JSON en userData; `window.cth` IPC |
| i18n | `src/renderer/src/i18n` | i18next + react-i18next; locales `en` (default), `zh-CN`, `ar` (RTL); `{{godName}}` como variable default |
| Seguridad | `src/shared/hire.ts`, `fs.ts` | Manifests de hire como input no confiable; allowlists de flags/MCP; contención de paths |
| Telemetría | `src/main/telemetry.ts`, `TELEMETRY.md` | PostHog opt-in |
| Updater | `src/main/updater.ts`, `electron-builder.yml` | GitHub Releases de `chaitanyagiri/munder-difflin` |

Hallazgo clave para el mapeo de agentes: **el upstream no tiene agentes Architect / Builder /
Tester / Auditor / Learner como código**. Solo tiene el orquestador (`isGod`), el prep assistant
(`isAssistant`) y un elenco visual (`scene/office/cast.ts`, personajes de _The Office_) que se
asigna a agentes contratados dinámicamente.

## 6. Dependencias relevantes

Runtime: `electron`, `react`, `zustand`, `pixi.js`, `@xterm/*`, `node-pty`, `better-sqlite3`,
`i18next`/`react-i18next`, `@openai/agents-realtime`, `posthog-node`, `electron-updater`,
`localtunnel`/`tunnelmole`, `monaco-editor`, `@codemirror/*`. No hay LangChain, vector DB ni Redis.

## 7. Assets y licencias

| Elemento | Licencia | Observación |
| --- | --- | --- |
| Código | MIT © 2026 Chaitanya Giri (`LICENSE`) | Debe conservarse el aviso de copyright |
| Tilesets `src/renderer/src/assets/tilesets/*.png` | LimeZu Complete Version (`LICENSE-ASSETS`, `ATTRIBUTION.md`) | Licencia **comprada por el autor upstream**; crédito obligatorio; no revendible |
| Mapas `assets/maps/*.tmj` | Derivados de LimeZu; vendorizados de `shahar061/the-office` (ISC) | `brooklyn99.tmj` alude a otra IP de NBC |
| Sprites del elenco | MIT (procedurales, `portraitArt.ts`) | Nombres, blurbs y apariencia evocan a personajes de _The Office_ (NBCUniversal) |
| `cafeteriaLines.ts` | MIT | Frases/catchphrases de _The Office_ |
| Fuentes `assets/fonts` | Ver `fonts/LICENSE.txt` (Inter, JetBrains Mono, Press Start 2P — OFL) | Reutilizables |
| Logo `docs/logo.png` (`@brand`) | Sin licencia separada | Marca "Munder Difflin" |

## 8. Resultados del baseline (sin cambios de La Pitaya)

| Chequeo | Resultado | Log |
| --- | --- | --- |
| `npm run typecheck` | **exit 0** | `baseline-typecheck.log` |
| `npm run build` | **exit 0** (renderer 12.2 MB, `✓ built in 2m 26s`) | `baseline-build.log` |
| `npm run test:focused` | **exit 1** — 849 tests: 816 pass, **22 fail**, 11 skipped | `baseline-tests.log` |

### Fallas preexistentes (22), clasificadas

- **Symlinks en Windows (EPERM)** — 15 tests de `fs-path-containment`, `worktree-deps`, `git diff`
  symlink: el usuario de Windows no tiene privilegio de crear symlinks (sin Developer Mode).
- **Fin de línea CRLF** — tests que hacen regex sobre el código fuente
  (`telemetry-message-count`, `arabic-terminal`, `agent-token-cap`, `config` interleaved): el
  checkout en Windows convierte a CRLF y los patrones esperan `\n`.
- **Red / datos remotos** — `the remote file and the baked file agree on every model`: el catálogo
  remoto de modelos del upstream difiere del empaquetado.
- **Config** — `electron-builder points the release notes at a file that exists`.

Ninguna es causada por La Pitaya; sirven de referencia para detectar regresiones.

## 9. Limitaciones encontradas

1. No hay lint; la validación estática es solo `tsc`.
2. La suite no está limpia en Windows (ver §8), así que "tests pass" se mide como
   **sin fallas nuevas respecto al baseline**.
3. Los agentes reales requieren un CLI de IA instalado y autenticado (Claude Code, Codex…); la app
   no trae un modelo propio.
4. Varias rutas externas apuntan al upstream: updater (`updater.ts`, `updateState.ts`,
   `electron-builder.yml`), catálogo de modelos y hero (`raw.githubusercontent.com/chaitanyagiri/...`).
5. Identificadores internos (`munderdifflin://`, `munder-difflin/hire@1`, `cth.*`, `appId`,
   nombre del paquete) están persistidos en disco o en deep links; cambiarlos rompería
   compatibilidad de datos y se difiere.
