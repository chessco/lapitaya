# La Pitaya — License / Asset Audit (CIMA Runtime v0.2)

Method: inventory of everything the packaged app bundles (`electron-builder.yml` `files` +
`extraResources`, and the actual `out/renderer/assets/` build output), plus repo content that is
published with the public repository. No license is assumed: a right that could not be verified from
a file in the repo is **UNKNOWN**.

Classes: `SAFE` · `REQUIRES_LICENSE` · `REQUIRES_REPLACEMENT` · `UNKNOWN`.

## Bundled in the app

| Asset | Where | Evidence | Class |
| --- | --- | --- | --- |
| Tilesets `interiors.png`, `office-tileset.png`, `a5-office-floors-walls.png` | `src/renderer/src/assets/tilesets/` → `out/renderer/assets/*.png` | `LIMEZUASSETS-LICENSE.txt`: "Complete Version (purchased 2026-08-20)" — purchased by the **upstream author**; "YOU CAN'T RESELL OR **DISTRIBUTE THE ASSET TO OTHERS**"; "CREDITS ARE REQUIRED" | **REQUIRES_LICENSE** (PitayaCode needs its own LimeZu license) — and even then the raw PNGs must not sit in a public repo → **REQUIRES_REPLACEMENT** for public distribution |
| Tiled maps `office.tmj`, `brooklyn99.tmj` | `assets/maps/` | Vendored from `shahar061/the-office` (ISC per `ATTRIBUTION.md`); reference LimeZu tiles by gid | `office.tmj`: **REQUIRES_LICENSE** (depends on LimeZu). `brooklyn99.tmj`: **REQUIRES_REPLACEMENT** (named after and laid out as the *Brooklyn Nine-Nine* precinct, "Captain Holt's glass office" — NBCUniversal IP) |
| Cast portraits / walking sprites | `scene/office/portraitArt.ts`, `cast.ts` | Procedural MIT code, but the recipes are **drawn to resemble *The Office* characters** (Michael, Jim, Pam, Dwight…). 6 sprites now carry La Pitaya names; 9 keep upstream names | **REQUIRES_REPLACEMENT** (character likeness; no license from NBCUniversal or the actors) |
| Cafeteria / office lines | `scene/office/cafeteriaLines.ts` (237 lines), locale keys `office.gossip`, `office.suckUp` | Catchphrases and references: "that's what she said", "Dunder Mifflin, this is Pam", "Schrute Farms", "identity theft is not a joke", "world's best boss mug", "I DECLARE… a break" | **UNKNOWN** (short phrases may not be protectable, but they are unmistakably *The Office*; trademark/association risk) → recommended **REQUIRES_REPLACEMENT** |
| Theme `brooklyn99` in `themeRegistry.ts` | code | IP name + references (Holt) | **REQUIRES_REPLACEMENT** |
| Fonts Inter, JetBrains Mono, Press Start 2P | `assets/fonts/*.woff2` → bundled | `assets/fonts/LICENSE.txt`: SIL OFL 1.1 with copyright lines | **SAFE** (condition: OFL notice must travel with the binary — `LICENSE.txt` is NOT copied into `out/`; add it to `extraResources` before shipping) |
| App icons `build/icon.{png,ico,icns,svg}` | installer / window icon | `build/icon.svg`: "Munder Difflin — the brand mark"; `tools/make-logo.cjs`: "Michael's portrait on the brand yellow tile" | **REQUIRES_REPLACEMENT** (upstream trademark + character likeness) |
| Header / splash / favicon logo | was `docs/logo.png` (`@brand`) | same mark as above | **Replaced in v0.2** by `src/renderer/src/assets/lapitaya-mark.svg` (original pixel pitaya, PitayaCode) → **SAFE** |
| Bundled skills `resources/skills/*` | extraResources | Part of the MIT repo | **SAFE** |
| Production npm dependencies (497 packages) | `node_modules` in asar | `npm ls --omit=dev --all` + each `package.json` license (see `../licenses-prod-deps.txt`): MIT 460, ISC 21, BSD-3 6, Apache-2.0 4, BSD-2 2, BlueOak 1, Python-2.0 1, `(MIT OR WTFPL)` 1, `(BSD-2-Clause OR MIT OR Apache-2.0)` 1 | **SAFE** (all permissive; attribution notices to be collected into a THIRD_PARTY file before shipping) |
| Source code | repo | `LICENSE`: MIT © 2026 Chaitanya Giri | **SAFE** (keep the notice — kept) |

## Published with the repository (not bundled)

| Asset | Evidence | Class |
| --- | --- | --- |
| `docs/` website: `logo*.png/svg`, `banner.*`, `favicon-32.png`, `apple-touch-icon.png`, `media/*.mp4|webm|png|gif`, `screenshots/` | Upstream marketing for munderdiffl.in; show the Munder Difflin mark, the Office cast and the LimeZu floor | **REQUIRES_REPLACEMENT** (upstream brand; LimeZu art rendered in videos/screenshots) |
| `docs/CNAME` = `munderdiffl.in` | upstream's domain | **REQUIRES_REPLACEMENT** (must not be served from the fork — GitHub Pages is not enabled on `chessco/lapitaya`; leave it off or change the CNAME) |
| `blog/`, `seo/`, `landing-remotion/` | upstream marketing content | **UNKNOWN** rights for re-publication under La Pitaya; not needed by the app |
| `badge-github-trending.*`, Product Hunt badge in README | third-party badges about the upstream project | **REQUIRES_REPLACEMENT** (they describe Munder Difflin, not La Pitaya) |

## Verdict

**NOT_DISTRIBUTABLE.**

Blocking evidence: the LimeZu license bundled in the repo forbids distributing the asset to others,
and the license was purchased by the upstream author, not by PitayaCode. The tilesets are compiled
into every build (`out/renderer/assets/interiors-*.png`, `office-tileset-*.png`) and are present in
the public repository `chessco/lapitaya` (history included, since the initial push of `main`).
Secondary blockers: *The Office* / *Brooklyn Nine-Nine* likenesses, names and phrases, and the
Michael-portrait app icon.

## What is needed to become DISTRIBUTABLE

1. **Tilesets** — either (a) PitayaCode buys its own LimeZu Complete license **and** removes the raw
   PNGs from the public repo (the license forbids distributing the asset), fetching them at build time
   from a private location; or (b) replace them with original or CC0 art. Removing them from the
   already-public history requires a history rewrite of `chessco/lapitaya` — **a human decision**.
2. **Cast** — replace the 15 procedural recipes with original characters (the 6 La Pitaya agents
   first); drop the remaining upstream names.
3. **Phrases / themes** — rewrite `cafeteriaLines.ts` and `office.gossip|suckUp`; remove or rename
   `brooklyn99`.
4. **Icons** — regenerate `build/icon.*` from the La Pitaya mark.
5. **Notices** — ship `assets/fonts/LICENSE.txt` and a THIRD_PARTY notice file with the binary.
