# La Pitaya — Identidad

**La Pitaya** · _Sonoran Multi-Agent AI Harness_ · un proyecto de **PitayaCode** · Sonora, México.

La Pitaya es un harness multi-agente para automatizar progresivamente el desarrollo de software con
agentes especializados, orquestación, evidencia, auditoría y aprendizaje. Está construido sobre
[Munder Difflin](https://github.com/chaitanyagiri/munder-difflin) (MIT, © 2026 Chaitanya Giri), cuyo
runtime se conserva.

El nombre **La Pitaya** es un nombre propio: nunca se traduce, en ningún idioma.

## Fuente única de la marca

Toda la identidad visible sale de [`src/shared/lapitaya/brand.ts`](../src/shared/lapitaya/brand.ts):

| Constante | Valor |
| --- | --- |
| `LA_PITAYA_NAME` | `La Pitaya` |
| `LA_PITAYA_TAGLINE` | `Sonoran Multi-Agent AI Harness` |
| `LA_PITAYA_ORGANIZATION` | `PitayaCode` |
| `LA_PITAYA_ORIGIN` | `Sonora, Mexico` |
| `LA_PITAYA_VERSION` | `0.1.0-foundation` (versión de la capa La Pitaya) |
| `LA_PITAYA_REPOSITORY` | `chessco/lapitaya` |
| `LA_PITAYA_UPSTREAM` | atribución MIT al upstream |

La consumen: título de ventana (`src/main/index.ts`), `<title>` y `document.title`, alt del logo
(`App.tsx`, `main.tsx`), toast de release (`ReleaseDrop.tsx`), updater (`updater.ts`,
`updateState.ts`, `UpdateToast.tsx`), link de GitHub (`SettingsHeroCard.tsx`), prompt de hire con
IA (`AddAgentModal.tsx`), prompts de voz (`realtime/session.ts`, `realtime/tools.ts`) y el aviso
`RUNNING BUILD` del hive (`hive.ts`).

`<title>` en `src/renderer/index.html` es HTML estático (no puede importar TS); `main.tsx` lo
sobrescribe con `LA_PITAYA_NAME` al cargar.

## Qué cambió

| Superficie | Antes | Ahora |
| --- | --- | --- |
| Nombre visible | Munder Difflin | La Pitaya |
| Orquestador por defecto | Michael | El Inge |
| Locales `en`/`zh-CN`/`ar` | "Munder Difflin" | "La Pitaya" (salvo el anuncio de Munder Difflin Pro, que es del producto upstream) |
| `electron-builder.yml` | `in.munderdiffl.app`, `Munder Difflin`, updater → `chaitanyagiri/munder-difflin` | `mx.pitayacode.lapitaya`, `La Pitaya`, updater → `chessco/lapitaya`, instaladores `La-Pitaya-*` |
| `package.json` | autor, homepage y repo upstream | PitayaCode + contributor upstream; repo `chessco/lapitaya` |

El updater se reapuntó porque, sin cambio, una build empaquetada de La Pitaya se "actualizaría" a
Munder Difflin.

## Qué NO cambió (a propósito)

Estos identificadores están persistidos en disco o viven en links que otras instalaciones ya
tienen; renombrarlos rompería datos o hires compartidos sin aportar nada visible:

| Identificador | Dónde | Motivo |
| --- | --- | --- |
| `"name": "munder-difflin"` | `package.json` | En dev, Electron deriva la carpeta de userData (`%APPDATA%/munder-difflin`) del nombre del paquete |
| `munderdifflin://` | deep links de hire | Links ya compartidos |
| `munder-difflin/hire@1` | spec de manifests | Manifests ya publicados |
| `cth.*` | claves de localStorage / IPC `window.cth` | Estado del usuario |
| ids de sprites (`michael`, `jim`…) | `registry.json` por agente | Persistidos |
| URLs de `model-catalog.json` / `hero.json` | `modelCatalog.ts`, `hero.ts` | Datos útiles del upstream; mover cuando PitayaCode publique los suyos |
| Nombres de componentes (`MichaelBooting`, `RealtimeMichaelToggle`) | código | Internos; renombrar es ruido de diff |

Plan de migración: una fase posterior introduce un alias (`lapitaya://`, `lapitaya/hire@1`)
aceptando ambos, y migra userData con copia + marcador de versión.

## Assets y licencias

Ver [LA_PITAYA_FORK_BASELINE.md §7](LA_PITAYA_FORK_BASELINE.md#7-assets-y-licencias). Resumen de
obligaciones y riesgos:

- **Código MIT**: conservar `LICENSE` con el copyright de Chaitanya Giri. Se hizo.
- **Tilesets LimeZu**: la licencia la compró el autor upstream. **PitayaCode debe comprar su propia
  licencia LimeZu o reemplazar los tilesets** antes de distribuir binarios. El crédito a
  <https://limezu.itch.io/> es obligatorio y se mantiene.
- **Elenco de _The Office_**: los sprites son código MIT procedural, pero nombres, blurbs, frases
  (`cafeteriaLines.ts`), el tema `brooklyn99` y la apariencia evocan propiedad de NBCUniversal.
  En esta fase los seis sprites que usan los agentes de La Pitaya ya muestran nombres y roles de La
  Pitaya; **el resto del elenco, sus frases y la apariencia se reemplazarán** con arte propio de
  PitayaCode.
- **Logo** (`docs/logo.png`, alias `@brand`): es la marca Munder Difflin. Pendiente: logo de La
  Pitaya. El alt y el título ya dicen La Pitaya.
- **Fuentes**: OFL 1.1, reutilizables con su aviso (`assets/fonts/LICENSE.txt`).
