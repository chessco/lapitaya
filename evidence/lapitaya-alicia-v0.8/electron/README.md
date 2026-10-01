# Alicia v0.8 — Electron validation (ID-29, ID-30, spec §26)

Real built app (`electron.exe .` on this branch's `out/`), driven over CDP (`driver/`). Throwaway
`--user-data-dir` **and** a throwaway hive root (a temp folder written into the profile's `config.json`
before launch); the user's own hive was not used. HIGH calls were sent as hook frames on the hive's
HookServer pipe (the CLI hook shim's transport). Forged / replayed / "other window" decisions went
through the preload bridge (`window.cth.*`), the only channel a renderer has.

The OS user name appears as `<os-user>` in the text artifacts. The screenshots show it unredacted.

| Result file | What it covers |
|---|---|
| `flow8a-result.json` | One window: identity, REQUEST submit/confirm/cancel, HIGH approve/reject, spoof / replay / flip, ledger, DOM leaks |
| `flow8b-result.json` | Cross-window REQUEST (clean) — its HIGH half ran against an approval left over from an earlier aborted attempt and is **superseded** by `flow8c` / `flow8e` |
| `flow8c-result.json` | Cross-window HIGH: the other window rejects, the Decision Center follows |
| `flow8d-result.json` | Resolved history with owners (es-MX); the en-US reload switched only one window |
| `flow8e-result.json` | **Two Decision Centers at once, one es-MX and one en-US**: REQUEST confirmed in EN while ES follows; HIGH rejected in ES while EN follows; stale attempts refused |
| `ledger.jsonl` | The runtime's own `cima-ledger.jsonl` for the whole run (test data) |

| # | Check (§26) | Result |
|---|---|---|
| 1 | Trusted human identity exists | ✅ `lapitayaIdentity()` → `{id: hum-…, displayName, session: ses-…}`; the id equals `config.humanId` (persisted) |
| 2 | Decision Center shows the human context safely | ✅ "Decides como … (hum-…). La app resuelve esta identidad; esta pantalla no puede cambiarla." (id + name only; no session / window) |
| 3–4 | REQUEST confirmed, attributed | ✅ ledger `request/CONFIRMED` with `human.id` = the trusted id, `human.session` = this launch, `human.window` an integer; card shows "Solicitó" / "Confirmó" |
| 5–6 | REQUEST cancelled, attributed | ✅ ledger `CANCELLED` with `human`; card "Canceló" |
| 7–8 | HIGH approval / rejection attributed | ✅ ledger `HUMAN_APPROVED` / `HUMAN_REJECTED` (`rule: human`) with `human`; `approvals.json` `decidedOwner` = the same id; one-shot unchanged (retry allowed once, then approval required again) |
| 9 | Renderer cannot spoof identity | ✅ a forged token with an extra identity object / "mallory" → `TAMPERED`; "mallory" never reaches the ledger (0 occurrences); the only context recorded is main's |
| 10 | Second window sees the resolved state | ✅ `flow8e`: EN confirmed → ES card turned CONFIRMED with "Confirmó …" and no action; ES rejected → EN's pending card disappeared into history |
| 11 | Replay fails | ✅ the consumed token → `NOT_CONFIRMABLE` (same window and from the other window); a flipped / repeated decision → `null` |
| 12 | Stale decision fails | ✅ the other window's stale token → `NOT_CONFIRMABLE`; its stale approve → `null`; exactly one `CONFIRMED` and one `HUMAN_*` record each |
| 13 | No identity / token leakage in the DOM | ✅ both windows: no command, `/srv/`, hive path, session id or token |
| 14–15 | es-MX / en-US | ✅ both at once (EN: "You are deciding as …", "Requested by / Confirmed by / Cancelled by", "by …") |
| 16 | No renderer errors | ✅ `[]` in every window and run |
| — | Ownership across windows | ✅ the refused attempt is recorded with a **different** `window` than the confirmation; same `human.id` and `session`; ownership of the first decision unchanged |

Screenshots: `01` identity line · `02/03` REQUEST pending / confirmed · `04/05` HIGH pending / rejected ·
`06/07` M follows the other window · `09/10` history with owners (es / en) · `11–14` two windows (EN/ES)
at once, HIGH pending, history with owners.
