# Alicia v0.5 — Electron / renderer validation

Real app, real renderer, real main process, real runtime. Driven over the Chrome DevTools
Protocol (`--remote-debugging-port`): clicks and key presses go through the browser input
pipeline (`Input.dispatchKeyEvent`) or the DOM, never through a test port.

**Isolation.** Each run used a throwaway `--user-data-dir` whose `config.json` pointed
`harnessHome` at a temporary hive (El Inge registered with the real `HiveManager`). The user's
real hive was never touched. Local paths are replaced with `<e2e>` / `<e2e2>` / `<local-path>`
in the ledgers below.

**Build.** `out/` from `npm run build` on this branch (`electron.exe .`). Run 2 used the final
build (with the panel padding fix).

| Run | Files | Notes |
|---|---|---|
| 1 | `run1-ledger.jsonl`, `run1-renderer-errors.json`, `screenshots/run1-*` | Opening the hive started a **real El Inge CLI session**, so its tool calls hit the real PreToolUse hook. |
| 2 | `run2-ledger.jsonl`, `run2-renderer-errors.json`, `screenshots/run2-*` | Fresh hive, final build, full flow under a renderer-error monitor. |

## What was observed

| # | Check | Result | Where |
|---|---|---|---|
| 1 | Alicia appears in the **#human ("pregúntame")** tab | ✅ Panel renders, with presence "En espera" | run1-01, run2-01 |
| 2 | A REQUEST typed into Alicia becomes a pending proposal | ✅ `alicia:submit` → `PROPOSED` `req-…`; card `data-ui-state=PENDING`; tab badge shows `1`; Alicia replies with the proposalId | run1-02, run2-02 |
| 3 | The proposal shows runtime data | ✅ The human's words verbatim, scope `LOW`/`MEDIUM` as the runtime set it, status, executor `god`, proposalId, created | run1-02, run2-04 |
| 4 | **Nothing executes while PROPOSED** (real agent) | ✅ The real El Inge's calls were denied with `REQUEST_CONFIRMATION_REQUIRED`: Bash `cat >` into the hive (governance-tamper, HIGH) at 15:00:50, `mv` (MEDIUM) at 15:01:13 and 15:57:11. Planning (Read, `ls`, writes to its own outbox) stayed allowed. | run1-ledger |
| 5 | Confirm is hard to trigger by accident | ✅ Disabled until the acknowledgement box is ticked; placed after Cancel; Tab skips it while disabled; Enter on the checkbox does nothing, Space ticks it | run1 (keyboard), run2-04 |
| 6 | Confirm works | ✅ `PROPOSED(alicia) → REVALIDATED(runtime) → CONFIRMED(human)`; card → "REQUEST confirmado — continúa por la gobernanza de CIMA"; badge cleared; Alicia: "Confirmado. La solicitud continuará por el proceso de gobernanza." | run1-03, run2-03, ledgers |
| 7 | Double-click on Confirm | ✅ Two clicks in the same tick sent **one** confirmation; no `CONFIRMATION_DENIED` replay in either ledger | run1 / run2 ledgers |
| 8 | **HIGH after confirmation** | ✅ El Inge's next call (`AskUserQuestion`, unknown tool, so HIGH) got `HUMAN_APPROVAL_REQUIRED` under the confirmed proposal. The card shows "CIMA requiere tu aprobación para acciones HIGH (HUMAN_APPROVAL_REQUIRED): 1 pendientes… confirmar el REQUEST no las aprobó". The Alicia panel has **no approve button**; the approval was left pending in the Governance panel. | run1-04, run1-ledger 15:02:14 |
| 9 | Cancel works (keyboard) | ✅ Focus on Cancel + Enter → `CANCELLED(human)`; the card has no buttons left; Alicia: "Solicitud cancelada." | run1-05, run2-05 |
| 10 | Forged confirmation from the renderer | ✅ `lapitayaConfirmRequest(id, 'fff…')` → `TAMPERED`; empty token → `INVALID_CONFIRMATION`; the proposal stayed `PROPOSED` | run1-ledger 15:03:20 |
| 11 | Confirmed elsewhere | ✅ A confirmation came through the human channel outside the scripted steps (15:58:08, `by=human`). The panel's old token then got `NOT_CONFIRMABLE` and the card showed the runtime state (`CONFIRMED`). | run1-ledger |
| 12 | en-US | ✅ After switching the persisted UI language and reloading, the panel renders fully in English | run1-06 |
| 13 | No direct tool / El Inge access from the UI | ✅ The panel only offers Confirm / Cancel on proposals and a message box that goes through `alicia:submit` (intent boundary) | all screenshots |
| 14 | No renderer errors | ✅ `[]`: no uncaught exceptions, console errors/warnings or log errors, including across reloads (run 1: race + en-US; run 2: 240 s covering the whole flow) | run*-renderer-errors.json |

## Environment observations (ENVIRONMENT)

- **Cold first start.** On the very first start of a brand-new `--user-data-dir`, the main process
  sat at 100% CPU for several minutes and answered no IPC (including `getConfig`). A restart on the
  same data did not reproduce it, and neither did run 2. v0.5 changes only renderer code.
- **Remote Control message.** The El Inge CLI printed "Remote Control disconnected — Session
  creation failed (server 400)". This comes from the CLI's own remote-control feature, not from
  La Pitaya.
- **Pending approval left.** Run 1 left one HIGH approval (`AskUserQuestion`) pending on its
  throwaway floor. It was deliberately not decided.
