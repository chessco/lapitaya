# Electron re-validation of the code-review fixes (commit aad67b84)

Real built app (`electron.exe .`, `npm run build` of aad67b84), driven over CDP (`cdp.cjs`, `flow.cjs`,
`flow2.cjs`). Throwaway `--user-data-dir` AND a throwaway hive root (a temp folder seeded through the
profile's `config.json`); the user's hive was not used. HIGH calls were sent as hook frames on the
hive's HookServer pipe, the same transport as the CLI hook shim.

Results: `flow-result.json` (es-MX), `flow2-result.json` (cancel, forged/replayed/wrong-target, en-US).

| Check | Result |
|---|---|
| Decision Center visible in #human | pass |
| REQUEST from the Alicia UI appears; a tool call before confirmation is denied (REQUEST_CONFIRMATION_REQUIRED) | pass |
| Confirm by UI; second click on the same Confirm: element already gone (`missing`) | pass |
| REQUEST confirmed, then a HIGH call → HUMAN_APPROVAL_REQUIRED (confirmation did not approve) | pass |
| HIGH card shows, approve by UI; second Approve click `disabled` (code-review fix: no second decision) | pass |
| Retry after approval allowed once; the next attempt requires approval again (one-shot) | pass |
| Reject by UI; retry stays blocked | pass |
| Cancel a REQUEST by UI → CANCELLED | pass |
| Forged token → TAMPERED; unknown proposal → UNKNOWN_PROPOSAL; replay of a confirmed one → NOT_CONFIRMABLE; decide on unknown id / bad args → null | pass |
| ~~The renderer's request list carries no token~~ **CORRECTION**: `hasToken:false` was measured on CONFIRMED/CANCELLED proposals, whose token is already consumed. A PROPOSED proposal DOES hand its single-use token to the renderer (v0.5 design: the UI sends it back with `lapitaya:confirmRequest`). The token is never rendered in the DOM (leak check passes), but it is in renderer memory. | not a pass; see docs §25 |
| DOM: no command, `/srv/`, hive path or token (es-MX and en-US) | pass |
| Renderer errors, es-MX and en-US | none |
| en-US ("HUMAN DECISIONS …") after switching `cth.language` and reloading | pass |

Not repeated in this pass: the two-window race (see the earlier ELECTRON_VALIDATION.md, run on 29b42c3c).
