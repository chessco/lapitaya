# FASE 3 validation record

- LIVE/AWAKE: `node --test test/lapitaya-living-desktop.test.cjs` → **45 passed, 0 failed**.
- Companion gate: `npm.cmd run test:companion` → **176 passed, 0 failed**.
- Typecheck: `npm.cmd run typecheck` → **PASS**.
- Build: `npm.cmd run build` → **PASS**.
- Real Electron: `01-real-electron-awake.cjs` → `pass: true`, blocker held/released, RSS 114256 KB, 2 transitions.

The full `test:focused` run was attempted twice (120 s and 300 s). Both runs exceeded the execution window; output also showed pre-existing failures in `agent-token-cap` and the Arabic UI toggle test plus environment `EPERM` writes under `.codex`. No FASE 3 test failed.
