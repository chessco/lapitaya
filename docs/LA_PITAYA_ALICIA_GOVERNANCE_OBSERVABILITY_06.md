# LA PITAYA — ALICIA v0.6
## Governance Observability & Explanation Layer

**PitayaCode — Sonora, Mexico**
**Branch**: `lapitaya/alicia-v0.6-governance-observability` (from `lapitaya/alicia-v0.5-human-confirmation-ui`, `39778d7a`)
**Date**: September 30, 2026
**Evidence**: [`evidence/lapitaya-alicia-v0.6/`](../evidence/lapitaya-alicia-v0.6/)

> Alicia can explain what the runtime knows. Alicia can never decide what is true about governance.
> **No Evidence → No Claim.**

---

## 1. Objective

v0.5 let the human confirm or cancel a REQUEST. v0.6 lets the human **understand** what governance
did, using only facts the runtime recorded:

- **what** happened;
- **why**;
- the **risk** CIMA determined;
- the **rule** that intervened;
- the **state** it is in;
- what comes **next**;
- what is needed **from the human**;
- the **evidence** behind it.

It does this deterministically: there is no model, and the result is reproducible, auditable and
localized. Alicia gains no authority.

## 2. Architecture

```text
RUNTIME (main)                                                   RENDERER
authorize() ─▶ cima-ledger.jsonl ─┐
recordTrace() ─▶ traces.jsonl ────┤                              useGovernanceObservability()
approvals / proposals (state) ────┼─▶ projectObservability() ──▶ lapitaya:observability ──▶ ObservationExplanation
                                  │      (pure, read only)        (read-only IPC)            ProposalGovernance (timeline)
onEvent ─▶ lapitaya:governance ───┴────────────── refresh signal only ──────────────────────▶ GovernanceActivity
```

The projection runs **in main**, next to the data, so raw records never reach Alicia's UI.

| File | Change |
|---|---|
| `src/shared/lapitaya/alicia/observability.ts` | **New.** Pure projection: categories, the observation model, trace linking, the timeline, relevance, and `explainObservation`. |
| `src/shared/lapitaya/alicia/messages.ts` | Exports the existing `explanationKey` (the rule → key mapping), so it is reused, not duplicated. |
| `src/main/cimaRuntime.ts` | **Additive, observability only.** No decision logic changed: `authorize()`'s body, the gate order and approvals are untouched. It adds: the exact-call `fingerprint` on the governance record and on the trace; the `governance` and `trace` signals on the existing stream (payloads without action, command or fingerprint); and `recentTraces()`. |
| `src/shared/lapitaya/cimaRuntime.ts` | `ExecutionTrace.fingerprint?` |
| `src/main/index.ts` | Read-only IPC `lapitaya:observability`. |
| `src/preload/index.ts` | `lapitayaObservability(opts)` (read only). |
| `src/renderer/src/components/alicia/useGovernanceObservability.ts` | **New.** Fetches the projection and refreshes on the existing stream (debounced). |
| `src/renderer/src/components/alicia/GovernanceExplanationView.tsx` | **New.** Renders `t(key, vars)`; contains no logic. |
| `AliciaPanelView.tsx` / `AliciaPanel.tsx` | An optional `observability` prop: without it, the v0.5 panel is unchanged. The v0.5 panel also no longer requests a companion snapshot on every per-call signal. |
| i18n `lapitaya/{es-MX,en-US}.json` | `alicia.observe.*` (80 keys, identical trees). |

## 3. Source of truth

**Sources:**

1. `cima-ledger.jsonl`: governance decisions (including the human's approval decisions and the
   decision gate), intents, and REQUEST transitions;
2. `traces.jsonl`: PostToolUse executions;
3. approval and proposal **state**, used only to know whether a human action is **still** due.

**Never used as sources:**

- Alicia's replies or notifications (OBS-NEG-01 feeds them in and gets nothing out);
- El Inge's messages;
- UI state;
- a model.

**No second ledger.** Alicia persists nothing. The hive's `lapitaya/` folder holds exactly the
same files as before (OBS-11).

**Exact linking.** A trace becomes an `EXECUTION_*` fact only when it provably belongs to a
governed call. That means the same agent and the same **exact-call fingerprint**, which the
PreToolUse record and the trace now both carry, with the trace coming after the decision. The
match is to the latest unlinked decision. There is no guessing by time or name: an unlinked trace
claims nothing (OBS-12).

## 4. Governance event mapping

26 categories. They reuse the runtime's own names: intent trail statuses, REQUEST transitions,
and governance decisions and rules.

| Runtime record | Category |
|---|---|
| intent `trail[i].status` | `INTENT_RECEIVED`, `INTENT_CLASSIFIED`, `INTENT_FORWARDED`, `INTENT_GOVERNED`, `INTENT_BLOCKED`, `INTENT_COMPLETED` |
| request `transition` | `REQUEST_PROPOSED`, `REQUEST_REVALIDATED`, `REQUEST_CONFIRMED`, `REQUEST_CONFIRMATION_DENIED`, `REQUEST_CANCELLED`, `REQUEST_COMPLETED`, `REQUEST_SUPERSEDED`, `REQUEST_BLOCKED` |
| governance `DENY` + `REQUEST_CONFIRMATION_REQUIRED` / `REQUEST_SCOPE_EXCEEDED` / `DECISION_GATE` | `REQUEST_CONFIRMATION_REQUIRED` / `REQUEST_SCOPE_EXCEEDED` / `COMPLETION_BLOCKED` |
| governance `DENY` (other rule) | `ACTION_DENIED` |
| governance `ALLOW`, `APPROVED` / `SUPERVISED` / `HUMAN_APPROVAL_REQUIRED` | `ACTION_AUTHORIZED` / `ACTION_SUPERVISED` / `HUMAN_APPROVAL_REQUIRED` |
| governance `HUMAN_APPROVED` / `HUMAN_REJECTED` | `APPROVAL_GRANTED` / `APPROVAL_REJECTED` |
| linked trace `ok` true / false | `EXECUTION_COMPLETED` / `EXECUTION_FAILED` |
| anything else | `UNKNOWN_EVENT`: shown verbatim, never interpreted |

The spec's suggested names map onto real facts:

- `ACTION_BLOCKED` is the runtime's `DENY`, surfaced as `ACTION_DENIED` or one of the specific
  rule categories.
- `SUPERVISED_REQUIRED` is `ACTION_SUPERVISED`. In this runtime a SUPERVISED call **runs** under
  supervision; "required" would misstate it.

## 5. Explanation model

`GovernanceObservation` has these fields: `eventId`, `category`, `timestamp`, `intentId`,
`proposalId`, `approvalId`, `taskId`, `agent`, `operation` (`<tool> · <runtime category>`),
`intentType`, `runtimeStatus`, `risk`, `scope`, `autonomy`, `decision`, `rule`,
`requiredHumanAction`, `nextState`, `evidence`, `count`, and `keys`
(`what`, `why`, `next`, `autonomy`, `humanAction`).

- **Whitelist, not blacklist.** Every field is one of three things:
  - an enumerated value;
  - an identifier that passed a strict pattern (identifiers that look like secrets are dropped);
  - `null`, which is shown as "No disponible".

  No free text leaves the projection: not the runtime's reason strings, commands, paths, outputs
  or tokens.
- **Why.** If the record has a rule or decision, the key comes from the **existing** deterministic
  mapping (`alicia.explain.<explanationKey>`). Otherwise it comes from a fixed category key
  (`alicia.observe.why.<C>`, only for facts whose "why" is a runtime property, such as the gate).
  Failing both, it is `alicia.observe.unavailable`: "No se puede confirmar el motivo con la
  evidencia disponible." An unknown rule is named, never guessed ("La regla X lo detuvo"). An
  unknown decision is always "unavailable".
- **Next and human action.** These come from a fixed table keyed on the category plus the
  **current** runtime state:
  - a HUMAN_APPROVAL_REQUIRED asks for a decision only while its approval is still pending;
  - a blocked call says "no se ejecutó" once the proposal is no longer pending;
  - an ACTION intent stopped for HIGH with **no approval yet** says `APPROVAL_ON_ATTEMPT` ("cuando
    El Inge intente esa acción, CIMA te pedirá la aprobación HIGH…") instead of asking for a
    decision that doesn't exist.
- **Deeply frozen** output. The inputs are never mutated (OBS-08).

## 6. Risk

Risk appears only when the record carries it, and only as `LOW`, `MEDIUM` or `HIGH` (anything
else becomes `null`). A REQUEST shows its **scope**, never a risk: it has none until an action
exists. The UI never computes, changes, softens or hides risk. A claimed risk in the words
(`suggestedRisk: 'LOW'`) does not change the observed runtime risk, which stays `HIGH` (OBS-09).

## 7. Autonomy

Autonomy is the record's `mode`: `AUTO`, `SUPERVISED` or `HUMAN_APPROVAL`, each explained by its
own key.

- **AUTO**: may continue if CIMA authorizes it.
- **SUPERVISED**: continues under supervision and is recorded.
- **HUMAN_APPROVAL**: needs explicit approval.

`SUPERVISED` is never shown as `AUTO`. `HUMAN_APPROVAL` is never shown as `CONFIRMED`.

The difference between REQUEST and ACTION, and between confirmation and approval, is kept in the
wording:

- `REQUEST_CONFIRMED` → "Tu confirmación permite que el trabajo continúe…; no es una aprobación HIGH".
- `HUMAN_APPROVAL_REQUIRED` → "Confirmar el REQUEST no aprobó esta acción HIGH".

## 8. Evidence

- For a ledger fact, the reference is `EVT-<FNV-1a of the exact ledger line>`, with `.n` for
  intent trail steps. Anyone can re-hash the ledger lines to find it.
- For an execution, the reference is the trace's own id (`trc-…`).
- Every fact carries its reference. Tests and the Electron run resolve **every** reference back
  to a real record: 13/13 in the live app.
- Without evidence the UI says "Sin evidencia registrada; no se afirma nada."
- The FNV-1a used here is a local copy, so the Alicia layer imports no governance code
  (INTENT-ARCH-01).

## 9. Timeline

Each REQUEST card has a native `<details>` "Ver línea de tiempo (N eventos)". Inside is an
`<ol aria-label="Línea de tiempo del REQUEST … (solo lectura)">` of:

- its intent's trail;
- its REQUEST transitions;
- every governance decision under it;
- the human's decisions on the approvals it raised;
- its linked executions.

Entries are in time order, and repeated identical facts collapse into `×N`. The timeline is
**read only**: frozen data, and no button, input or handler inside it (OBS-13/14).

The card's "state now" block puts **first whatever still needs the human**, for example a pending
HIGH. Otherwise it shows the latest relevant fact. This was found during the Electron validation
and fixed (§15).

## 10. Notifications

The existing notification system is unchanged, as are its events:

- REQUEST pending, confirmed and closed (including stale and blocked);
- HIGH approval required, deduplicated per exact call by the runtime;
- approval decided;
- completion blocked;
- supervised.

The new per-call signals (`governance`, `trace`) map to **no** Alicia event (`fromRuntimeEvent`
returns `[]`). Five blocked attempts add **0** notifications, and a retried HIGH call does not
notify twice (OBS-19). Per-call facts, including execution of governed work, go to *Actividad de
gobernanza* instead. That list shows only relevant facts, newest first, with repeats collapsed:

- blocks;
- confirmations;
- approvals required or decided;
- state changes;
- completion blocked;
- stopped ACTION intents;
- executions linked to a REQUEST or an approval.

Routine `ALLOW` calls and intent steps stay in timelines only.

## 11. Sensitive-data boundary

The projection runs in main and copies no free text.

- The new runtime signals carry no action, command, path or fingerprint.
- Tests and the live DOM check were searched for a proposal token, a bearer secret in a command,
  the command itself, tool output, the home and hive paths, `app.ts`, `outputHead`, `subject` and
  every call fingerprint: none appear (OBS-15, and the Electron check).
- Evidence files are sanitised: traces are exported as id, agent, tool, ok and linked only.

`lapitaya:ledger` (pre-existing) still exists for other consumers. Alicia's UI does not use it.

## 12. i18n

- `alicia.observe.*` has 80 keys with **identical trees** in es-MX and en-US.
- Every key the projection can emit exists in both: all categories, why keys, next states,
  autonomy values and actions.
- Rendering every category in both locales with a strict i18next (no fallback language) leaves
  no missing key and no raw key.
- Technical terms stay untranslated: CIMA, REQUEST, ACTION, LOW / MEDIUM / HIGH, AUTO,
  SUPERVISED, HUMAN_APPROVAL(_REQUIRED), rule codes and ids.
- The new view has no hardcoded text, and en-US has no accented characters (existing test).

## 13. Accessibility

Each observation is an `<article>` with an accessible name, and its facts are a `<dl>`.

- The activity list is a labelled `<section>` with an `aria-live="polite"` list.
- Blocking "next" steps are emphasised.
- The timeline is native `<details>`/`<summary>`: keyboard-operable (Enter), with a visible focus
  ring (checked in Electron) and a labelled `<ol>`.
- There are no clickable divs and no new controls.
- The v0.5 guarantees are unchanged: native buttons, acknowledgement, and the order
  ack → Cancel → Confirm (OBS-20).

## 14. Tests

`test/lapitaya-alicia-v06.test.cjs` has **19 tests, 19 passing**. They run against the real
runtime: real PreToolUse and PostToolUse through the HookServer. The projection is fed exactly
what the IPC handler feeds it (checked structurally), and the view is rendered with the shipped
catalogs.

| Test | Proves |
|---|---|
| OBS-01…07 | REQUEST_PROPOSED, REQUEST_CONFIRMATION_REQUIRED, REQUEST_SCOPE_EXCEEDED, STALE_PROPOSAL, TAMPERED, NOT_AUTHORIZED and HUMAN_APPROVAL_REQUIRED each produce the correct explanation, and each evidence reference resolves to the real record. For HIGH: approval → exact execution linked, and later routine work never hides a pending HIGH. |
| OBS-08/09/10 | Frozen output; inputs not mutated; the ledger unchanged; a claimed risk does not change the observed one; unknown values are not coerced; no write path. |
| OBS-11 | No second ledger or file; the handler only reads. |
| OBS-12 | Unlinked traces or a foreign agent's trace claim nothing; every fact has resolvable evidence; no evidence → "no se afirma nada". |
| OBS-13/14 | The timeline equals the real facts, in order, and is read only. |
| OBS-15 | No token, secret, command, path, output or fingerprint in the projection, the UI or the signals. |
| OBS-16/17 | es-MX and en-US complete; no fallback; no literals. |
| OBS-18 | No LLM, provider or network dependency. |
| OBS-19 | The event stream works; no notification spam; the preload and hook surfaces are minimal. |
| OBS-20/21 | Confirmation and HIGH behave exactly as in v0.5; without a projection, the v0.5 panel is unchanged. |
| OBS-22/23 | An unconfirmed REQUEST blocks every call; a floor or runtime with no UI or projection enforces the same. |
| OBS-NEG-01 | Alicia cannot fabricate PASS, DENY, HIGH, evidence, approval or confirmation (her words add only intent/request records); notifications project to nothing. |
| OBS-NEG-02 | Missing event, rule, risk or evidence, or an unknown code → "information unavailable", never an inference. |

Two guards were **mutation-checked**:

- Removing the identifier whitelist makes OBS-15 fail.
- Linking traces without the fingerprint makes OBS-12 fail.

During development, two **existing** tests caught mistakes in v0.6, and the code was fixed, not
the tests:

- a `×` in en-US (the no-accents rule);
- the Alicia layer importing `../governance` (INTENT-ARCH-01), now a local FNV-1a.

**Regression.** Foundation + v0.2 + v0.3 + v0.3.1 + v0.4 + v0.4.1 + v0.4.2 + v0.5 pass
**166/166**.

**Full focused suite.** 1036 tests, 1005 pass, 20 fail, 11 skipped. The 20 failures are exactly
the v0.5 baseline set (**PRE_EXISTING**), with **0 NEW_REGRESSION**
(`validation/failure-classification.txt`).

**Typecheck:** exit 0. **Build:** exit 0.

## 15. Electron validation

This was done on the real built app, isolated user data and hive, and the real El Inge CLI running.
See [`evidence/lapitaya-alicia-v0.6/electron/ELECTRON_VALIDATION.md`](../evidence/lapitaya-alicia-v0.6/electron/ELECTRON_VALIDATION.md).

All 14 checks of §31 pass:

- pending REQUEST;
- the state explanation;
- risk;
- rule;
- reason;
- next;
- evidence (13/13 references resolve);
- HIGH approval;
- a blocked call, shown live;
- stale;
- tampered;
- es-MX;
- en-US;
- **no renderer errors** in three monitors.

The timeline was also opened by keyboard, the real El Inge's own supervised execution was linked by
fingerprint, and the DOM contained no leaks.

**Found and fixed during the run.** The confirmed card's "state now" showed El Inge's later
execution while a HIGH approval was pending. That HIGH was still visible elsewhere, but §11 says
"no ocultar HIGH". The card now leads with the pending human action (OBS-07). The app was rebuilt
and re-validated (screenshot 07).

## 16. Observations

1. **Small, additive runtime changes for observability.** The additions are the fingerprint on
   governance records and traces, two stream signals, and `recentTraces()`. No decision, gate,
   risk, autonomy or approval behaviour changed (166/166 regression). Without the fingerprint,
   execution facts could only be inferred, which v0.6 forbids.
2. **An ACTION intent stopped for HIGH has no approval until El Inge attempts the exact call.**
   The explanation says exactly that (`APPROVAL_ON_ATTEMPT`) and does not ask for a decision that
   does not exist.
3. **Agent ids are shown as ids** (`god`), not display names. They are technical identifiers
   straight from the record.
4. **Records written before v0.6 have no fingerprint.** Their executions are not linked and claim
   nothing, which is by design.
5. **Scale.** The projection reads the last 3000 ledger lines and 1000 traces per refresh (the
   renderer debounces refreshes). Very long-lived floors only see that window.

## 17. Limitations

- There is no full observability dashboard; that was out of scope. The surfaces are the REQUEST
  cards and the recent activity list.
- Explanations are template-based. More natural phrasing (e.g. by a model) is explicitly **not**
  in v0.6.
- The renderer is still trusted as the human channel (v0.5 / v0.4.2).
- Tool calls still carry no per-REQUEST attribution, so floor-wide facts are attributed through
  the gate's `proposalId`, as in v0.4.2.
- Electron validation was CDP automation plus hook frames on the real pipe. There was no human
  usability study.

## 18. Final verdict

### Audit questions

| # | Question | Answer |
|---|---|---|
| Q1 | Can Alicia produce a CIMA decision? | **NO** |
| Q2 | Can Alicia change risk? | **NO** |
| Q3 | Can Alicia change autonomy? | **NO** |
| Q4 | Can Alicia invent a reason? | **NO** |
| Q5 | Can Alicia show an explanation based on real evidence? | **YES** |
| Q6 | Can Alicia show a HIGH decision as if it were an approval? | **NO** |
| Q7 | Is there a second Alicia ledger? | **NO** |
| Q8 | Can the timeline modify events? | **NO** |
| Q9 | Are tokens or secrets exposed? | **NO** |
| Q10 | Does removing Alicia UI remove the runtime guarantees? | **NO** |

### Verdict: **PASS_WITH_OBSERVATIONS**

The explanations are deterministic, come from runtime evidence, and are validated in Node and in
real Electron. The observations in §16 are design notes, not failures of a guarantee.

### RUNTIME AUTHORITY (decides; unchanged)

- `authorize()` at PreToolUse decides risk, autonomy, the REQUEST gate and approvals, and writes
  the ledger.
- Only the human confirms (single-use token) and approves (one-shot).
- `completionGate` decides whether work is done.
- The ledger and traces are the evidence.

### ALICIA EXPLANATION (reads; decides nothing)

- A pure projection of recorded facts into enumerated fields and i18n keys.
- It never writes, never mutates, and never copies free text.
- Unknown or missing information stays "unavailable".
- Its only human actions are v0.5's Confirm and Cancel, through the same IPC and runtime.

```text
RUNTIME ──▶ FACT ──▶ EXPLANATION ──▶ ALICIA ──▶ HUMAN        (never ALICIA ──▶ FACT)
```
