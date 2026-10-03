# FASE 4 — Evidence

## Automated gate

Command: `npm.cmd run test:companion`

Result: **229 passed, 0 failed**.

Coverage includes:

- COMPANY4-01…15
- ALICIA4-01…15
- TEAM4-01…15
- REG4-01…08
- FASE 3 companion, Rosalba, LIVE and Execution Awake regression tests

Additional commands:

- `npm.cmd run typecheck` — PASS
- `npm.cmd run build` — PASS

## Electron smoke validation

`npm.cmd run dev` reached the real Electron process and the app remained responsive. The shared environment initially exported `ELECTRON_RUN_AS_NODE=1`; after removing that variable, Electron started normally. The app was left active for manual inspection.

No synthetic input, CIMA mutation, assignment, approval, or ledger write was performed by the company projection.
