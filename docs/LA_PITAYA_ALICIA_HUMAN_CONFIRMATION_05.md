# LA PITAYA — ALICIA v0.5
## Human Confirmation UI

**PitayaCode — Sonora, Mexico**
**Branch**: `lapitaya/alicia-v0.5-human-confirmation-ui` (from `lapitaya/alicia-v0.4.2-request-execution-gate`, `4cab5261`)
**Date**: September 30, 2026
**Evidence**: [`evidence/lapitaya-alicia-v0.5/`](../evidence/lapitaya-alicia-v0.5/)

> The interface lets the human express a decision; it does not turn that decision into
> execution. The runtime still decides whether an action may execute.

---

## 1. Objective

v0.4.2 made "REQUEST = proposal only" a runtime guarantee. It also left a gap: a human could
confirm a proposal only through the `lapitaya:confirmRequest` IPC, and nothing in the app called
it. v0.5 adds the **first visual Alicia surface** for that decision. With it, the human can:

- see that a REQUEST is pending and what it asks;
- see the scope and risk the runtime assigned;
- confirm or cancel it;
- see the runtime's answer and carry on talking to Alicia.

It adds **no new authority**. Confirm and Cancel call the existing human-channel IPC, and
nothing else.

## 2. Base branch

`lapitaya/alicia-v0.4.2-request-execution-gate` at `4cab5261` (verdict PASS_WITH_OBSERVATIONS).
`main` is untouched and nothing is merged.

## 3. Architecture

```text
USER ──types──▶ Alicia UI ──alicia:submit──▶ companion ──▶ IntentBoundary ──▶ runtime.openRequest ──▶ PROPOSED
                                                                                   │
                         (event 'request' on the existing lapitaya:governance stream)
                                                                                   ▼
                Alicia UI ◀──lapitaya:requests / lapitaya:approvals── runtime (source of truth)
                    │
          HUMAN ────┤ Cancel ──preload──▶ lapitaya:cancelRequest ──▶ runtime.cancelRequest(id,'human') ──▶ CANCELLED
                    └ Confirm ─preload──▶ lapitaya:confirmRequest ─▶ runtime.confirmRequest(id,{by:'human',token})
                                                                        ▼ revalidate → CONFIRMED
                                   agent tool call ──▶ PreToolUse ──▶ authorize() ──▶ requestGate + CIMA risk/autonomy ──▶ execution | deny | HUMAN_APPROVAL
```

New files (renderer only):

| File | Role |
|---|---|
| `src/renderer/src/components/alicia/confirmationController.ts` | Framework-free UI state. It keeps a **copy of the runtime's list**, the operation in flight, and the runtime's last answer. It never edits a proposal. |
| `src/renderer/src/components/alicia/AliciaPanelView.tsx` | Pure render of the panel. `t` is injected, and it uses no `window` or IPC. The Node tests render this component. |
| `src/renderer/src/components/alicia/AliciaPanel.tsx` | Container. It wires the view to `window.cth` (the IPC port) and adds the #human tab badge. |

Changed files:

- `CommandCenterPanel.tsx` mounts `<AliciaPanel />` above the Governance panel in the #human
  ("pregúntame") tab, and adds the pending badge to that tab.
- The locale files `lapitaya/{es-MX,en-US}.json` gain the new `alicia.confirmation.*` keys.

**No change** to the following:

- `src/main/**` and `src/preload/**`;
- CIMA, `authorize()`, risk classification, autonomy mapping and provider governance;
- the approval mechanism, `completionGate`, the intent boundary and the Alicia companion.

## 4. UI boundary

The UI is a **HUMAN INTERFACE, not an AUTHORITY**. By construction it has no way to:

- approve a tool;
- change risk or autonomy;
- write the ledger;
- execute or dispatch anything;
- touch tasks or providers;
- reach El Inge or the hive;
- raise or decide a HIGH approval;
- bypass `authorize()`, PreToolUse or `completionGate`.

What it may do:

- **Present**: the human's words verbatim, plus the proposal's runtime fields.
- **Explain**: what confirming means, and that it is not a HIGH approval.
- **Receive** the human's decision.
- **Reflect** the runtime's answer.

## 5. IPC boundary

The container's entire reach (`window.cth.*` in `components/alicia/`, checked by UI-13):

| Call | IPC | Main handler (unchanged since v0.4.2) |
|---|---|---|
| `lapitayaRequests()` | `lapitaya:requests` | `lapitaya.listRequests()` |
| `lapitayaApprovals()` | `lapitaya:approvals` | `lapitaya.listApprovals()` (read only) |
| `lapitayaConfirmRequest(id, token)` | `lapitaya:confirmRequest` | `lapitaya.confirmRequest(id, { by: 'human', token })` |
| `lapitayaCancelRequest(id)` | `lapitaya:cancelRequest` | `lapitaya.cancelRequest(id, 'human')` |
| `onLapitayaGovernance(cb)` | `lapitaya:governance` (existing event stream) | runtime `onEvent` |
| `aliciaSnapshot` / `aliciaMarkRead` / `aliciaSubmit` | `alicia:*` (v0.4 / v0.4.1) | companion; `submit` goes through the intent boundary |

The preload was **not** extended: v0.4.2 already exposed everything needed. The renderer never
receives `CimaRuntimeService`, the filesystem, the ledger, providers or HiveManager mutations.
The preload imports the runtime **as a type only**.

The UI has no way to say who confirms: the `by: 'human'` identity is fixed in the main handler.
A non-human `by` is refused by the runtime (`NOT_AUTHORIZED`).

## 6. State model

Every card state comes from one of three things:

1. the runtime's status;
2. an operation in flight;
3. the runtime's own refusal code.

The UI invents no states.

| UI state | Derived from |
|---|---|
| `PENDING` | runtime `PROPOSED` |
| `CONFIRMING` / `CANCELING` | this UI's call in flight |
| `CONFIRMED` | runtime `CONFIRMED` |
| `CANCELLED` / `COMPLETED` / `SUPERSEDED` | runtime status |
| `BLOCKED` | runtime `BLOCKED` |
| `STALE` | runtime answered `STALE_PROPOSAL` |
| `ERROR` | runtime refused (`TAMPERED`, `WRONG_CONTEXT`, `INVALID_CONFIRMATION`, `NOT_AUTHORIZED`, `LEDGER_UNAVAILABLE`), or the IPC failed (`IPC_ERROR`) |

The **runtime's status always wins**. For example, if the human presses Confirm and the answer
says the proposal was confirmed or cancelled elsewhere, the card shows the runtime's current
status. Every decision ends with a fresh `lapitaya:requests`.

## 7. Confirmation flow

1. The card shows the runtime scope, what confirming means, and the HIGH note.
2. **Confirm is disabled** until the human ticks "Leí la propuesta y entiendo que confirmar no
   aprueba acciones HIGH". It sits after Cancel, is never focused automatically, and has no
   keyboard shortcut.
3. On click, the controller sends **one** `lapitaya:confirmRequest(id, token)`, using the token
   from the runtime's latest list. While that call is in flight, every decision button on the
   panel is disabled, and a second click is dropped before it reaches IPC.
4. The runtime validates identity, context, status, token and fingerprint. It re-validates the
   classification, moves the proposal to `CONFIRMED` and consumes the token.
5. The card shows "REQUEST confirmado — continúa por la gobernanza de CIMA", and Alicia says:
   "Confirmado. La solicitud continuará por el proceso de gobernanza."

The single-use token is still the real protection against replay. The UI guard only avoids
sending the same confirmation twice.

## 8. Cancellation

This reuses v0.4.2's `lapitaya:cancelRequest`; no new IPC was added. It works on `PROPOSED`
proposals, and also on `CONFIRMED` ones, which withdraws the active scope. The runtime closes
the proposal (`CANCELLED`, `closedBy: 'human'`, token cleared) and writes the ledger entry.
Nothing is deleted or edited from React.

## 9. Stale and race conditions

| Situation | Runtime answer | UI |
|---|---|---|
| Words no longer read as a REQUEST (re-validation) | `STALE_PROPOSAL`, proposal `BLOCKED` | `STALE`, with the code shown |
| Confirmed elsewhere | `NOT_CONFIRMABLE` | shows `CONFIRMED` (runtime state), "cambió en otro lado" |
| Cancelled elsewhere | — | `CANCELLED` on the next refresh or event |
| Replaced by a newer REQUEST for the same task | — | `SUPERSEDED`, no buttons |
| Edited on disk / token forged | `TAMPERED` | `ERROR` with `role="alert"` and the code |
| IPC failure | — | `ERROR` (`IPC_ERROR`), "nada cambió" |

After any refusal the UI **does not retry**; it says "No se reintenta nada automáticamente". A
governance error is always shown with its code, never as a silent generic failure.

## 10. HIGH-risk behaviour

- A proposal's scope is only ever `LOW` or `MEDIUM`. **HIGH is never inside a confirmed
  scope**: every HIGH call still goes to `HUMAN_APPROVAL_REQUIRED` and needs its own one-shot
  approval.
- Before confirming, the card says so in bold: "Confirmar el REQUEST no equivale a aprobar una
  acción de alto riesgo…". After confirming, it says "esto no es una aprobación".
- When CIMA raises a HIGH approval after the confirmation, the card reads it from
  `lapitaya:approvals`. It then shows "CIMA requiere tu aprobación para acciones HIGH
  (HUMAN_APPROVAL_REQUIRED): N pendientes… confirmar el REQUEST no las aprobó". It offers
  **no** approve button: the decision stays in the existing Governance panel.
- The panel never says "acción aprobada" (UI-10).

## 11. i18n

- 51 new keys under `lapitaya:alicia.confirmation`, with **identical key trees** in es-MX and
  en-US (UI-15/16).
- Refusal explanations reuse the existing `alicia.explain.*` keys.
- The tests render every state with a strict i18next that has **no fallback language** and
  records every missing key; the result is none.
- The view's source has no visible text outside `t()`, except the technical id `proposalId`.
- Not translated: `REQUEST`, `CIMA`, `LOW`/`MEDIUM`/`HIGH`, `HUMAN_APPROVAL_REQUIRED`, the
  proposalId, status codes and refusal codes.
- The human's words are shown verbatim.

## 12. Accessibility

- Native `<button type="button">`, a checkbox inside a `<label>`, and a labelled text input.
  No `onKeyDown`, no `autoFocus`, no clickable `<div>`s.
- The panel is a `role="region"`, and each card a `<section aria-labelledby>`. The decision
  buttons are a labelled `role="group"`, and Confirm's `aria-describedby` points at the meaning
  and the HIGH note.
- Results are announced in live regions: `role="status"` (polite) for results, `role="alert"`
  (assertive) for refusals and pending HIGH approvals. `aria-busy` is set while in flight.
- Focus is visible (`:focus-visible` outline, 2 px, ink colour). "Ver propuesta" moves focus to
  the pending card's heading.
- The #human tab badge has an accessible name ("Propuestas REQUEST pendientes…: N").

## 13. Tests

`test/lapitaya-alicia-v05.test.cjs` has **18 tests, 18 passing**:

- The runtime-backed tests run the real runtime, hive, hook server, intent boundary and
  companion (`test/fixtures/lapitaya-floor.cjs`). The controller drives it through a port that
  makes the IPC handlers' exact calls; UI-04 checks that mapping structurally.
- The renderer tests render `AliciaPanelView.tsx` with `react-dom/server` and the shipped locale
  JSON.
- `test/load-ts.cjs` gained `.tsx` resolution and `jsx: react-jsx`. This is additive: `.ts`
  modules compile exactly as before.

| Test | Proves |
|---|---|
| UI-01 | A pending REQUEST appears: banner, card `PENDING`, and the runtime notification points to it |
| UI-02 | The card's fields equal the runtime proposal; the controller has no edit API |
| UI-03 | The risk shown is the runtime scope (LOW / MEDIUM); a changed runtime value is mirrored; no classifier in the UI |
| UI-04 | Confirm → only `confirm(id, token)`; preload → `lapitaya:confirmRequest` → `confirmRequest(id, { by: 'human', token })`; still one call site |
| UI-05 | Confirmation → `CONFIRMED` from the runtime; ledger shows `PROPOSED → REVALIDATED → CONFIRMED` |
| UI-06 | Cancellation → `CANCELLED` (closedBy human, token cleared); cannot be confirmed afterwards |
| UI-07 | Double-click → one IPC call and one ledger confirmation; buttons disabled and `aria-busy` while in flight |
| UI-08 | Stale → `STALE`; confirmed elsewhere → shows `CONFIRMED`; cancelled elsewhere; superseded; never retried |
| UI-09 | Tampered on disk / forged token → `TAMPERED` shown as an alert; IPC failure → `ERROR`; never retried |
| UI-10 | After confirmation, HIGH → `HUMAN_APPROVAL_REQUIRED`; the card says it is not an approval; the approval stays pending; no approve control |
| UI-11 | The port has exactly 4 functions; no execution or decision API in Alicia or her UI |
| UI-12 | UI modules import no main, node, electron, fs, hive or runtime code (`@shared` type-only); the preload imports the runtime as a type |
| UI-13 / 14 | `window.cth` usage is limited to the 8 human-channel / Alicia calls; no `hive:send`, dispatch, pty or decide; `alicia:submit` goes through the companion |
| UI-15 / 16 | Complete, identical es-MX / en-US trees; no missing keys, no fallbacks, no hardcoded text |
| UI-17 | Keyboard: native controls only; Confirm needs the acknowledgement; order is ack → Cancel → Confirm; Enter in the message form cannot decide |
| UI-18 | Region, section labels, `aria-describedby` targets exist, labelled group and checkbox, live regions, focus-visible CSS |
| UI-E2E | USER → Alicia UI → REQUEST → PROPOSED → Confirm → runtime → CIMA → authorize → PreToolUse → execution (LOW allowed; MEDIUM `REQUEST_SCOPE_EXCEEDED`) |
| UI-E2E-NEG | No confirm → LOW, MEDIUM, HIGH and delegated calls **all denied**, no approvals raised. The same on a floor where the UI was never mounted. A non-human confirmation is refused. |

Two checks were also mutation-tested:

- Removing the in-flight guard makes UI-07 fail.
- A missing key is recorded by the strict i18n `t`.

**Regression.** Foundation + v0.2 + v0.3 + v0.3.1 + v0.4 + v0.4.1 + v0.4.2 pass **148/148**.
This covers:

- Builder ≠ Auditor;
- Evidence First;
- Human Governance;
- Progressive Autonomy;
- LOW / MEDIUM / HIGH;
- `completionGate` and `authorize()` / PreToolUse;
- provider governance;
- the REQUEST gate.

**Full focused suite** (`npm run test:focused`): 1017 tests, 986 pass, 20 fail, 11 skipped.

- All 20 failures are **PRE_EXISTING**: the same tests fail in the v0.4.2 baseline (symlink / fs
  containment, worktree links, IPC-seam counters, model catalog).
- **0 NEW_REGRESSION.** One test that failed in the v0.4.2 run under full-suite load ("Command
  Center sets and clears one cap") passes now and passes alone every time (ENVIRONMENT).
- During development, the first version of the tab badge crashed the tab bar when mounted against
  a bridge without the proposal methods (`restart-terminal-preserve`). The badge now fails closed
  (it hides itself), and that test passes.

**Typecheck:** exit 0. **Build:** exit 0.

## 14. Electron validation

This was done on the real built app, in two runs, on throwaway user data and hives driven over
CDP. The full table is in
[`evidence/lapitaya-alicia-v0.5/electron/ELECTRON_VALIDATION.md`](../evidence/lapitaya-alicia-v0.5/electron/ELECTRON_VALIDATION.md).

- Alicia appears in the #human tab.
- A REQUEST typed into Alicia shows as a pending card, with the tab badge.
- While the proposal was PROPOSED, the **real El Inge CLI** had its MEDIUM and HIGH tool calls
  denied with `REQUEST_CONFIRMATION_REQUIRED`.
- Confirm stays disabled until the acknowledgement is ticked. A double-click sent **one**
  confirmation.
- El Inge's next HIGH call after confirmation went to `HUMAN_APPROVAL_REQUIRED`. The card said
  so, with no approve button.
- Keyboard Cancel → `CANCELLED`.
- A forged token sent from the renderer → `TAMPERED`.
- Confirmed elsewhere → the card showed the runtime state.
- en-US renders fully.
- **No renderer errors** in either run.

## 15. Evidence

`evidence/lapitaya-alicia-v0.5/`:

- **`reproduce.cjs`** regenerates everything in `ui/` from the real runtime, controller and view
  (`node evidence/lapitaya-alicia-v0.5/reproduce.cjs`).
- **`ui/`** holds:
  - `confirm-flow.json`: pending → no execution → double-click → confirmed → LOW allowed /
    MEDIUM scope-exceeded / HIGH approval required;
  - `cancel.json`;
  - `stale-and-tamper.json`;
  - `i18n-and-a11y.json`;
  - `html/`: static renders in es-MX and en-US.
- **`electron/`** holds the validation table, both runs' sanitised ledgers, the renderer-error
  logs and 11 screenshots.
- **`validation/`** holds the typecheck, build, v0.5 suite, regression and full-suite logs, plus
  the failure classification against the v0.4.2 baseline.

The screenshots are complementary. The primary evidence is the tests and the runtime ledger.

## 16. Observations

1. **The panel lives in the #human tab** of the Command Center, next to Governance approvals and
   AskMe, and a badge on that tab leads there. There is no app-wide Alicia surface yet.
2. **A confirmed scope stays active until the human cancels it.** The UI offers Cancel on
   confirmed cards. It deliberately offers no "complete" button, since that was out of this
   slice's scope; `lapitaya:completeRequest` still exists.
3. **The pending HIGH count** is shown on confirmed cards. It counts the pending HIGH approvals
   raised after that confirmation. Tool calls carry no request attribution, so this is
   floor-wide, the same conservative model as v0.4.2.
4. **The conversation lines** in the panel are transient and on screen only. They are not
   conversational memory.
5. **Electron cold start.** On the first start of a brand-new user-data directory, main was busy
   for minutes and answered no IPC. This did not reproduce (ENVIRONMENT).

## 17. Remaining limitations

- The renderer is trusted as the human channel, as in v0.4.2. A compromised renderer can still
  press Confirm; it cannot forge a token, confirm as someone else, or skip CIMA.
- Proposals do not expire (out of scope).
- The Command Center dispatch pause while a proposal is pending, and the lack of per-request
  correlation, are unchanged from v0.4.2 (out of scope).
- The UI is validated in Electron through CDP automation. No human usability study was run.
- The renderer tests are markup (SSR) tests; there is no DOM testing library in the repo.
  Interactive behaviour was covered in the real Electron renderer.

## 18. Final verdict

### Audit questions

| # | Question | Answer |
|---|---|---|
| Q1 | Can the renderer execute a tool directly? | **NO** |
| Q2 | Can Alicia's UI call El Inge directly? | **NO** |
| Q3 | Can Alicia confirm without IPC / runtime? | **NO** |
| Q4 | Can the user confirm a REQUEST through the existing mechanism? | **YES** |
| Q5 | Does the confirmation bypass CIMA? | **NO** |
| Q6 | Is confirming a REQUEST the same as approving HIGH? | **NO** |
| Q7 | Can an unconfirmed REQUEST execute tools? | **NO** |
| Q8 | Can a stale proposal be confirmed successfully? | **NO** |
| Q9 | Does the UI compute risk? | **NO** |
| Q10 | Is the runtime still the execution authority? | **YES** |

### Verdict: **PASS_WITH_OBSERVATIONS**

The flow works end to end in Node against the real runtime and in the real Electron renderer.
The observations in §16 are scope or UX notes, not failures of a guarantee.

### RUNTIME GUARANTEES (unchanged, enforced whether or not the UI exists)

- An unconfirmed REQUEST blocks every non-planning tool call on the floor (`requestGate` in
  `authorize()`, at PreToolUse).
- Only `by: 'human'` confirms: the identity is fixed in the IPC handler, and the token is
  single-use and fingerprinted.
- The runtime re-validates before confirming: stale proposals are blocked, tampered ones refused.
- A confirmed scope is LOW or MEDIUM. HIGH always requires its own HUMAN_APPROVAL.
- CIMA, the autonomy mapping, `completionGate` and provider governance are untouched.

### UI BEHAVIOUR (convenience and clarity, not security)

- It shows the runtime's proposals, scope and status verbatim, and never computes risk.
- It makes Confirm deliberate: acknowledgement required, no default focus, no shortcut.
- It drops a duplicate click before it reaches IPC.
- It reports refusals with their codes and never retries.
- It explains that confirming is not approving HIGH, and points to the Governance panel.

If this UI were removed or compromised, every runtime guarantee above would still hold. UI-E2E-NEG
checks that on a floor where the panel was never mounted.
