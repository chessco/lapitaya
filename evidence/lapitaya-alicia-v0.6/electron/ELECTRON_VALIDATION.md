# Alicia v0.6 — Electron / renderer validation

This was run on the real built app (`electron.exe .` on this branch's `out/`) and driven over CDP.

**Isolation.** The app used a throwaway `--user-data-dir`, pointing at a temporary hive (`<e2e3>`)
with El Inge registered by the real `HiveManager`. The user's hive was never touched. Opening the
hive started the **real El Inge CLI**, which worked on that throwaway floor during the run.

**How the facts were produced.** They all come from the real runtime in the app's main process:

| Fact | How it was produced |
|---|---|
| REQUEST and confirmations | The Alicia UI: text box + Enter, then acknowledge + Confirm. |
| Forged confirmation | The preload bridge, `lapitayaConfirmRequest(id, 'fff…')`, as a hostile renderer would do it. |
| Tool calls (blocked, HIGH, executed) | One JSON frame per call on the hive's HookServer pipe: **the same transport and frame the CLI hook shim uses**. The app's HookServer → `authorize()` / `recordTrace()` handled them. |
| El Inge's own calls | The real CLI's calls, which showed up in the same projection. |
| Stale proposal | Opened before launch by the real `CimaRuntimeService` on the same hive. This is the "rules changed since" case, which the UI cannot produce. The UI then confirmed it. |

| # | Check (§31) | Result | Screenshot / file |
|---|---|---|---|
| 1 | Pending REQUEST | ✅ Card `PENDING`. The governance block explains `REQUEST_PROPOSED`: why, scope `LOW`, risk "No disponible" (a REQUEST has no risk until an action exists), next, what is needed from you, evidence `EVT-…`. | (panel at start) |
| 2 | State explanation | ✅ "¿Qué ocurrió? / ¿Por qué? / Estado / Riesgo / Autonomía / Regla / ¿Qué sigue? / ¿Qué necesita de ti? / Evidencia" on the cards and in *Actividad de gobernanza*. | 01–07 |
| 3 | Risk | ✅ Shown only when the runtime recorded it: `LOW` for the blocked `npm test`, `HIGH` for `rm -rf`, `MEDIUM` for El Inge's `mv`. "No disponible" otherwise. | 01, 04, 06 |
| 4 | Governance rule | ✅ `REQUEST_CONFIRMATION_REQUIRED`, `STALE_PROPOSAL`, `TAMPERED`, `shell:recursive-delete`, `shell:other`, verbatim. | 01–04 |
| 5 | Reason | ✅ From the deterministic rule → key mapping, e.g. "Nada se ejecuta hasta que confirmes la propuesta…". | 01 |
| 6 | Next action | ✅ For example "No se ejecutó ninguna herramienta.", or "Revisa la aprobación en Aprobaciones de gobernanza. Confirmar el REQUEST no aprobó esta acción HIGH." | 01, 04 |
| 7 | Evidence reference | ✅ **13/13** `EVT-…` / `trc-…` references in the DOM resolve to a real line of the app's `cima-ledger.jsonl` or to a real `traces.jsonl` id. | `ledger.jsonl`, `traces-redacted.json` |
| 8 | HIGH approval | ✅ `HUMAN_APPROVAL_REQUIRED`, `HIGH`, `HUMAN_APPROVAL`, "requiere aprobación HIGH", no approve control in Alicia; the approval stayed pending for the Governance panel. After the fix below, the confirmed card **leads with the pending HIGH**, even after later work. | 04, 07 |
| 9 | Blocked request | ✅ A blocked `npm test` appeared **live**: the runtime's `governance` signal on the existing stream triggered the refresh. | 01 |
| 10 | Stale proposal | ✅ Confirm → `STALE_PROPOSAL` → card `STALE`; governance explains `REQUEST_BLOCKED` with rule `STALE_PROPOSAL`, and next "La propuesta está cerrada…". | 02 |
| 11 | Tampered proposal | ✅ Forged token → `TAMPERED`; *Actividad* explains `REQUEST_CONFIRMATION_DENIED` with rule `TAMPERED`. | 03 |
| 12 | es-MX | ✅ | 01–05, 07 |
| 13 | en-US | ✅ After switching the persisted language and reloading, everything renders in English, including the timeline toggle. | 06 |
| 14 | No renderer errors | ✅ `[]` in all three monitors: the es-MX flow (7 min), en-US (reload), and the final build after the fix. | `renderer-errors-*.json` |

Also verified:

- **Timeline by keyboard.** Focus on the `summary`, then Enter, opens it: `open=true`, a labelled
  `<ol>` "(solo lectura)", 0 controls inside, and a visible focus ring. It listed 10 real facts in
  order, ending in `EXECUTION_COMPLETED` linked to its trace. (05)
- **Real agent linkage.** After the confirmation, the real El Inge ran a `mv` (MEDIUM, SUPERVISED,
  under the confirmed MEDIUM scope). Its PostToolUse trace was linked to that exact decision by
  fingerprint and shown as `EXECUTION_COMPLETED`. (06)
- **No leaks in the DOM.** No command (`rm -rf`, `npm …`), no hive path, no `C:\Users`, no
  proposal token and no call fingerprint appeared anywhere in the panel's HTML.

## Found during this validation and fixed

- **A pending HIGH could stop being the card's "state now".** Screenshot 06 showed the confirmed
  card leading with El Inge's later execution while a HIGH approval was still pending. The pending
  HIGH was still visible in the v0.5 alert, the timeline and the activity list, so it was not
  hidden. Even so, §11 says "no ocultar HIGH".
  - The card's latest fact is now **the newest fact that still requires a human action**, and
    only if there is none, the newest relevant fact.
  - OBS-07 covers this.
  - The app was rebuilt, and screenshot 07 shows the fixed card.

## Environment notes (ENVIRONMENT)

- Reloading the renderer brings back the app's launch-time hive picker ("open"). This is existing
  app behaviour, unrelated to v0.6.
- One HIGH approval (`rm -rf /srv/e2e-data`) was left pending on the throwaway floor on purpose.
