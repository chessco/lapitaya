# Alicia v0.7 — Electron validation (DC-29, DC-30, §29)

This ran on the real built app (`electron.exe .` on this branch's `out/`), driven over CDP. It used a
throwaway `--user-data-dir` and hive (`<e2e4>`); the user's hive was not touched. The real El Inge
CLI was running on that floor.

**How each fact was produced.** Every fact came from the app's own runtime in main:

| Fact | Produced by |
|---|---|
| REQUESTs | The Alicia UI (text box + Enter). |
| Confirm / cancel / approve / reject | The Decision Center's buttons, clicked or operated by keyboard (CDP `Input.dispatchKeyEvent`). |
| HIGH calls | One hook frame each on the hive's HookServer pipe: the same transport and frame as the CLI hook shim. |
| Forged, replayed and "other window" decisions | The preload bridge (`lapitayaConfirmRequest`, `lapitayaDecide`), as a second renderer would send them. |
| The stale proposal | Opened before launch by the real `CimaRuntimeService`. |

| # | Check (§29) | Result | Screenshot / file |
|---|---|---|---|
| 1 | Alicia / Decision Center visible | ✅ "DECISIONES HUMANAS" section in the #human tab, with counts and the REQUEST ≠ HIGH distinction. The classic Governance panel **stood down** (`data-lapitaya-governance` absent), so there is no duplicate set of controls. | 01 |
| 2 | Pending REQUEST appears | ✅ Card `REQUEST_CONFIRMATION`, `PENDING`; badge `1` on the tab. | 01, 02 |
| 3 | REQUEST explanation | ✅ The v0.6 explanation: why, scope `MEDIUM`, next, what is needed from you. | 02 |
| 4 | REQUEST evidence | ✅ `cima-ledger.jsonl · EVT-…`. | 02 |
| 5 | REQUEST confirmed | ✅ Acknowledge, then Confirm, **double-clicked**: one confirmation; the counts went to "No hay decisiones pendientes". | ledger |
| 6 | REQUEST cancelled | ✅ By keyboard: focus Cancel, then Enter → `CANCELLED`; Alicia: "Solicitud cancelada." | ledger |
| 7 | Pending HIGH approval appears | ✅ After a HIGH call through the HookServer: a `HIGH_APPROVAL` card, `HUMAN_APPROVAL_REQUIRED`; counts "acciones HIGH por aprobar: 1"; badge `1`. | 03 |
| 8 | HIGH risk shown correctly | ✅ `data-risk="HIGH"`, "HIGH · Riesgo alto", rule `shell:recursive-delete`, operation `Bash · data-deletion`, agent `god`, related REQUEST. | 03 |
| 9 | HIGH explanation | ✅ What, why, autonomy `HUMAN_APPROVAL`, next, what is needed from you, evidence `EVT-…`. Plus "Autorizas UNA sola ejecución de esta llamada HIGH exacta…" and "el comando no se muestra aquí". | 03 |
| 10 | HIGH approval through the existing mechanism | ✅ Acknowledge, then Approve (**double-clicked**) → `lapitaya:decide` → exactly **one** `HUMAN_APPROVED (rule human)` in the ledger. The agent's retry → `APPROVED`, run once. The next attempt → `HUMAN_APPROVAL_REQUIRED` again (one-shot). The approval's timeline: `HUMAN_APPROVAL_REQUIRED → APPROVAL_GRANTED → ACTION_AUTHORIZED → EXECUTION_COMPLETED`. | 04 |
| 11 | HIGH rejection | ✅ By keyboard: focus Reject, then Enter → `HUMAN_REJECTED`. Tab skips the disabled Approve. The retry stays blocked (a new pending approval). | 05 |
| 12 | REQUEST confirmation ≠ HIGH approval | ✅ With the REQUEST already confirmed, the HIGH call still got `HUMAN_APPROVAL_REQUIRED`. The card says "Confirmar ese REQUEST no aprobó esta acción." | 03 |
| 13 | Stale decision | ✅ Confirming the seeded proposal → `STALE_PROPOSAL`, card `STALE`, no Confirm button. | ledger |
| 14 | Replay rejected | ✅ The used REQUEST token → `NOT_CONFIRMABLE`; re-deciding the approved approval → `null`. | ledger |
| 15 | Tampered rejected | ✅ A forged token → `TAMPERED`. | ledger |
| 16 | es-MX | ✅ | 01–05 |
| 17 | en-US | ✅ "HUMAN DECISIONS", "HIGH-RISK HUMAN APPROVAL", "Show resolved decisions (7)", … after switching the persisted language and reloading. | 06–08 |
| 18 | No renderer errors | ✅ `[]`: a 10-minute monitor over the full flow, plus a final reload. | `renderer-errors-*.json` |
| 19 | No sensitive-data leakage | ✅ Panel DOM checked twice: **0** leaks of commands, `/srv/`, hive paths, approval summaries, approval or call fingerprints, or proposal tokens. | `dom-check-*.json` |
| 20 | State updates after the runtime responds | ✅ Every decision re-read the runtime. A **stale-UI race** was tested: a second window rejected through the bridge while this UI clicked Approve in the same instant. The runtime applied only the rejection; this card turned `ALREADY_RESOLVED`, with no buttons and no retry, and Alicia said "That approval was already resolved…". | 07 |

**Evidence references.** In the live DOM, 25/25 resolved before the en-US switch and 28/28 after
it. Each is a real `cima-ledger.jsonl` line, `traces.jsonl` id or `approvals.json` id.
(`dom-check-*.json`)

**History.** The resolved-decisions list showed exactly what happened, newest first: 2 approvals
rejected, 1 granted, the cancellation, 2 refused confirmations (the tampered token and the replay),
the confirmation, and the stale proposal. (08)

## ENVIRONMENT notes

- Reloading the renderer brings back the app's hive picker. This is existing behaviour.
- No approval was left pending on the throwaway floor: the last one was resolved by the race in check 20.
