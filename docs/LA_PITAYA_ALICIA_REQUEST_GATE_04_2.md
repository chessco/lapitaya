# LA PITAYA — ALICIA v0.4.2
## REQUEST Execution Gate

**PitayaCode — Sonora, Mexico**
**Branch**: `lapitaya/alicia-v0.4.2-request-execution-gate` (from `lapitaya/alicia-v0.4.1-intent-boundary`, `6eddbbda`)
**Date**: September 30, 2026
**Evidence**: [`evidence/lapitaya-alicia-v0.4.2/`](../evidence/lapitaya-alicia-v0.4.2/)

> Alicia can express intent. El Inge can interpret and plan. A human can confirm a proposal.
> CIMA determines whether the resulting action is governable. Authorization determines whether it
> can execute.

---

## 1. Objective

v0.4.1 left one observation open. The rule "REQUEST = proposal only" was an **instruction in the
message** to El Inge. Nothing in the runtime stopped him from running a LOW or MEDIUM tool call in
response to a REQUEST. v0.4.2 turns that instruction into a **runtime guarantee**: an unconfirmed
REQUEST cannot become tool execution, even if El Inge tries.

## 2. Source Branch

`lapitaya/alicia-v0.4.1-intent-boundary` at `6eddbbda` (verdict PASS_WITH_OBSERVATIONS).

## 3. Architecture Before (v0.4.1)

```text
REQUEST → IntentBoundary → El Inge (message says "PROPOSAL ONLY … do not execute")
El Inge → any tool call → PreToolUse → authorize() → LOW: ALLOW · MEDIUM: SUPERVISED · HIGH: approval
```

The REQUEST state lived only in the text of a message. `authorize()` did not know a REQUEST existed.

## 4. Architecture After (v0.4.2)

```text
REQUEST → IntentBoundary → runtime opens PROPOSAL (PROPOSED)  ──▶  El Inge (message names the proposal)
                                   │
PreToolUse → authorize() → requestGate(proposals, call) ──▶ PROPOSED exists: non-planning call → DENY
                                   │                        (REQUEST_CONFIRMATION_REQUIRED)
HUMAN (IPC lapitaya:confirmRequest, token) → PROPOSED → CONFIRMED (re-validated, token consumed)
                                   │
PreToolUse → authorize() → requestGate → within scope → CIMA policy as before
                                          (LOW: ALLOW · MEDIUM: SUPERVISED · HIGH: HUMAN_APPROVAL_REQUIRED)
                                          beyond scope (non-HIGH) → DENY (REQUEST_SCOPE_EXCEEDED)
```

The gate is **one insertion inside `authorize()`**, next to the v0.3 decision gate. It runs before
approvals are consumed or created. `authorize()` is otherwise unchanged. So is
`completionGate()`. So are the provider governance and the risk model.

## 5. Request State Model

State: `<hive>/lapitaya/proposals.json`. It is written atomically and loaded with the rest of the
governance state. Its path is already `governance-tamper` (HIGH) for any agent.

| Status | Meaning | Gate effect |
|---|---|---|
| `PROPOSED` | Forwarded to El Inge, waiting for the human | **Every non-planning call on the floor is denied** |
| `CONFIRMED` | The human confirmed it | Non-HIGH calls up to its `scope` go through CIMA; above it, denied |
| `COMPLETED` / `CANCELLED` | Closed by the human | No effect |
| `SUPERSEDED` | A newer REQUEST for the same task replaced it | No effect; cannot be confirmed |
| `BLOCKED` | Failed re-validation, or was never delivered | No effect; cannot be confirmed |

**"Does this REQUEST have a valid human confirmation?"** is answered deterministically as
`status === 'CONFIRMED'`. Only `confirmRequest(…, {by: 'human', token})` can set it. Messages, Alicia's
flags, client metadata, `risk`, `type` and `status` fields are never read as confirmation.

A proposal records `id` (`req-…`, runtime-generated), `intentId`, `executor`, `requestedBy`,
`source`, `message`, `taskId`, `target`, `signals` (classification), `scope`, `status`,
`createdAt`, `fingerprint`, `token`, and `confirmedAt/By`, `closedAt/By`, `reason`.

**Planning** (always allowed, even while PROPOSED) means `read-code`, `analysis` and
`hive-coordination`. That covers reading and inspecting the code, read-only git, delegation
notes, and writing to El Inge's own hive files, such as his outbox for replying. Everything else,
**LOW execution included** (`npm test`, lint), is execution.

**Scope** comes from the REQUEST's words (`requestScope`):

- **MEDIUM** for change work: implementa, arregla, construye, agrega, escribe, actualiza,
  refactoriza, crea, modifica, prepara…
- **LOW** for inspection: revisa, analiza, investiga, audita, evalúa, planea…

## 6. Confirmation Authority

| Actor | Can confirm? | How it is refused |
|---|---|---|
| **Human** | **Yes** | IPC `lapitaya:confirmRequest(id, token)` → `confirmRequest(id, {by: 'human', token})`, the only call site in `src/` (structural test) |
| Alicia | No | No port. Her companion has no confirm method, and the Alicia layer never references `confirmRequest`. Words ("Confirma la propuesta req-…") and fields (`confirmed`, `confirmation`, `token`) are `NOT_AUTHORIZED` at the intent boundary. A direct `by: 'alicia'` is `NOT_AUTHORIZED` |
| El Inge / workers / any provider | No | They have no path to the service. `by: 'god'`, `'el-beni-1'`, `'codex-1'`… are `NOT_AUTHORIZED`. A message saying "confirmed" changes nothing. Writing `proposals.json` is governance-tamper, and while a proposal is PROPOSED it is denied outright |

Human authority is the **channel**, the same trust model as `lapitaya:decide` for approvals.
Cancel and complete are human-only too. `withdrawRequest` (used when a request was never
delivered) and `openRequest` are called only by the intent boundary; the structural test checks
that no IPC, hook or hive path calls them.

## 7. Runtime Enforcement

| Guarantee | Enforced by |
|---|---|
| While any REQUEST is PROPOSED, no agent executes a non-planning tool: LOW, MEDIUM and HIGH, El Inge and delegated workers, any provider | `requestGate` inside `authorize()` at PreToolUse |
| The denial raises and consumes no approval | The gate runs before approval handling |
| After confirmation, non-HIGH calls above the confirmed scope are denied | `REQUEST_SCOPE_EXCEEDED` |
| After confirmation, every call still goes through risk → autonomy → authorization | Unchanged `authorizeToolCall` |
| A confirmation is never a HIGH approval | HIGH always passes on to `HUMAN_APPROVAL_REQUIRED` and the v0.3 one-shot approval |
| A governed ACTION's exact call keeps its own CIMA path while a REQUEST is pending | Exemption by the ACTION intent's recorded call fingerprint |

The gate is **floor-wide**, and this is the key design decision. A tool call carries no link to
the REQUEST it serves, and El Inge can delegate to a worker. So the only rule the runtime can
actually guarantee is "nothing on the floor executes while an unconfirmed REQUEST exists." A
per-request rule would depend on El Inge labelling his own calls honestly, which is a
convention, not a guarantee.

## 8. Risk Handling

| | No confirmation | After human confirmation |
|---|---|---|
| LOW (e.g. `npm test`) | **BLOCKED** `REQUEST_CONFIRMATION_REQUIRED` | ALLOW (AUTO), if within scope |
| MEDIUM (e.g. Edit) | **BLOCKED** | SUPERVISED if the scope is MEDIUM; `REQUEST_SCOPE_EXCEEDED` if the scope is LOW |
| HIGH (e.g. `rm -rf`) | **BLOCKED** (no approval raised) | `HUMAN_APPROVAL_REQUIRED` → existing approval → one run → retry denied |

## 9. Reclassification

- Confirmation never freezes risk. Every call is classified as **the call it actually is**, at
  PreToolUse, by `toolRisk`. "REQUEST LOW → confirmed → actual HIGH" gets the HIGH policy (REQ-10).
- A harmless request cannot become broad authority. "Revisa los archivos" is a LOW scope, so a
  code edit is `REQUEST_SCOPE_EXCEEDED` (REQ-11), and a destructive call needs its own HIGH
  approval.
- At confirmation, the runtime **re-validates** the proposal. If its stored words no longer
  classify as a REQUEST, it is `STALE_PROPOSAL` and marked BLOCKED, not confirmed.
- The v0.4.1 intent protections (`INTENT_MISMATCH`, `INTENT_TARGET`, `NOT_AUTHORIZED`) are
  unchanged.

## 10. Replay Protection

- **One confirmation, one transition.** `PROPOSED → CONFIRMED` happens once. The single-use
  `token` is set to `null` in the same durable write, so replaying it gives `NOT_CONFIRMABLE`.
- The token is per proposal, so p1's token cannot confirm p2 (`TAMPERED`).
- A new REQUEST always starts `PROPOSED` and locks the floor again. An earlier confirmation cannot
  unlock it (REQ-07).
- **Integrity:** the proposal's content fingerprint is re-checked at confirmation. A proposal
  edited on disk (for example, a widened scope) is `TAMPERED`.
- **Context:** `WRONG_CONTEXT` if the confirmation names another intent, or if the proposal was
  made for a different orchestrator.
- **Stale:** CANCELLED, SUPERSEDED (a newer REQUEST for the same task), BLOCKED and COMPLETED
  proposals cannot be confirmed. There is **no expiry**, because the project has no expiry concept
  yet (out of scope, §15).
- The confirmation is **durable-first**: if `proposals.json` cannot be written, it is refused and
  the state rolls back.

## 11. Evidence

The ledger (`cima-ledger.jsonl`) now explains every allow and every deny:

| Required evidence | Where |
|---|---|
| REQUEST_RECEIVED / CLASSIFIED | `kind: 'intent'` record: `trail` and `signals` (v0.4.1) |
| REQUEST_PROPOSED | `kind: 'request', transition: 'PROPOSED'` |
| REQUEST_BLOCKED | `kind: 'governance', rule: 'REQUEST_CONFIRMATION_REQUIRED'` (or `REQUEST_SCOPE_EXCEEDED`), with `proposalId`, real `category` and `risk` |
| REQUEST_CONFIRMED | `transition: 'CONFIRMED', by: 'human'`; refused attempts are `CONFIRMATION_DENIED` with `code` and `by` |
| REQUEST_REVALIDATED | `transition: 'REVALIDATED'` |
| REQUEST_EXECUTION_AUTHORIZED | `kind: 'governance'`, `decision: ALLOW / SUPERVISED / APPROVED`, with `proposalId` |

Events travel on the **existing** stream: `CimaRuntimeService.onEvent` gains the type `request`,
carried on `lapitaya:governance`. Alicia maps them to `request.proposed` (an `APPROVAL_REQUIRED`
notification with a `humanOnly` action `open-requests`), `request.confirmed` and `request.closed`,
with es-MX and en-US text. No new bus.

To reproduce the evidence, run `node evidence/lapitaya-alicia-v0.4.2/reproduce.cjs` from the repo
root. It uses the real runtime through the test fixture.

## 12. Test Matrix

[`test/lapitaya-alicia-v042.test.cjs`](../test/lapitaya-alicia-v042.test.cjs). Every "execution
attempt" is a real `PreToolUse` hook call.

| ID | Scenario | Result |
|---|---|---|
| REQ-01 | REQUEST + LOW, unconfirmed → BLOCKED; Read, read-only git and outbox writes still allowed; denial recorded with `proposalId` | PASS |
| REQ-02 | REQUEST + MEDIUM, unconfirmed → BLOCKED | PASS |
| REQ-03 | REQUEST + HIGH, unconfirmed → BLOCKED, no approval raised | PASS |
| REQ-04 | Confirmed → LOW → ALLOW → trace by `god`; ledger PROPOSED → REVALIDATED → CONFIRMED | PASS |
| REQ-05 | Confirmed (change scope) → MEDIUM → SUPERVISED | PASS |
| REQ-06 | Confirmed → HIGH → HUMAN_APPROVAL_REQUIRED → separate approval → one run → retry denied | PASS |
| REQ-07 | Replay: second confirm refused; after completion a new REQUEST is gated again; p1's token cannot confirm p2 | PASS |
| REQ-08 | Alicia confirms (API, words, `confirmed` / `confirmation` / `token` fields) → NOT_AUTHORIZED | PASS |
| REQ-09 | El Inge confirms (API), "confirmed" message, write to `proposals.json` → no effect / denied | PASS |
| REQ-10 | Confirmed LOW request + actual HIGH → HIGH policy | PASS |
| REQ-11 | Confirmed "revisa" + Edit → `REQUEST_SCOPE_EXCEEDED`; in-scope work proceeds | PASS |
| REQ-12 | CONVERSATION: no proposal, no ledger, no gate | PASS |
| REQ-13 | ACTION unchanged, and its exact call is not captured by a pending REQUEST | PASS |
| REQ-14 | completionGate still blocks (intent and `updateTaskStatus`) | PASS |
| REQ-15 | Unconfirmed: god, el-beni, margarito, a `codex` agent and `alicia` are all denied | PASS |
| REQ-NEG | 11 non-human authorities; missing / null / unknown id; wrong context; missing / tampered token; cancelled; superseded; non-human cancel / complete; every refusal recorded | PASS |
| REQ-NEG-TAMPER | Proposal edited on disk → TAMPERED; re-validation → STALE_PROPOSAL + BLOCKED | PASS |
| REQ-ARCH | Structural checks: gate inside `authorize()` before approvals; PreToolUse → authorize → deny non-executable; `confirm/cancel/completeRequest` called only from `src/main/index.ts` IPC with `by: 'human'`; the lock can't be lifted from IPC, hooks, hive or preload; no confirmation or hive path in the Alicia layer; completionGate on `updateTaskStatus`; no provider names in the gate; gate code and state are governance-tamper | PASS |
| REQ-EVENTS | Transitions on the existing stream; Alicia shows them as `humanOnly` | PASS |

## 13. Regression Results

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | `validation/typecheck.txt` |
| `npm run build` | exit 0 (54 s) | `validation/build.txt` |
| v0.4.2 suite | **19/19 PASS** | `validation/alicia-v042-suite.txt` |
| v0.2 CIMA runtime | 25/25 | `validation/regression.txt` |
| v0.3 hardening | 35/35 | 〃 |
| v0.3.1 API gate | 9/9 | 〃 |
| v0.4 Alicia architecture | 19/19 | 〃 |
| v0.4.1 intent boundary | 16/16 | 〃 |
| Foundation v0.1 | 25/25 | 〃 |
| Full suite `npm run test:focused` | 999 tests: 967 pass, **21 fail**, 11 skipped; 198 s | `validation/full-suite.txt` |
| Failure classification | 21 **PRE_EXISTING**: the same set as the recorded baseline. **0 NEW_REGRESSION**, 0 ENVIRONMENT. No test was changed or removed to pass | 〃 |

## 14. Observations

1. **The floor-wide lock is deliberately conservative.** While a REQUEST waits for confirmation,
   *all* execution on the floor pauses, including work the human dispatched directly from the
   Command Center. Planning continues, and governed ACTION calls are exempt. The human releases the
   lock by confirming or cancelling.
2. **A confirmed request's scope stays active until the human completes or cancels it.** El Inge
   cannot close it himself. That is deliberate: otherwise he could escape the scope.
3. **No UI yet.** Confirm, cancel and complete exist as IPC and preload (`lapitayaRequests`,
   `lapitayaConfirmRequest`…), and Alicia points to them (`open-requests`), but there is no panel.
   Until one exists, a pending REQUEST can only be confirmed or cancelled programmatically.
4. **Scope comes from the REQUEST's words.** It is heuristic, but it can only narrow execution
   (LOW or MEDIUM). It never widens it, and it never covers HIGH.

## 15. Remaining Limitations

- **No expiry.** A PROPOSED request blocks the floor until the human acts. The project has no expiry
  concept yet, and inventing one was out of scope.
- **Human authority is the IPC channel.** The renderer is trusted as the human's surface, the same
  model as approvals since v0.2. Any renderer code can call `lapitaya:confirmRequest`.
- **Attribution.** Because calls cannot be linked to a request, the scope of a confirmed request
  applies to the whole floor while it is active.
- **The classifier limitation from v0.2 still applies to the actual calls:** an unrecognized
  destructive shell command classifies as MEDIUM. The gate blocks it while a REQUEST is
  unconfirmed. After confirmation, it is only as strong as `toolRisk`.

## 16. Final Verdict

### Audit questions

| # | Question | Answer | Proof |
|---|---|---|---|
| Q1 | Can El Inge execute any tool in response to an unconfirmed REQUEST? | **NO**. Only planning (read, analysis, hive files) runs | REQ-01/02/03/15 |
| Q2 | Can Alicia confirm a REQUEST? | **NO** | REQ-08, REQ-NEG, REQ-ARCH |
| Q3 | Can El Inge confirm a REQUEST? | **NO** | REQ-09, REQ-NEG |
| Q4 | Can a confirmed REQUEST bypass CIMA? | **NO**. Every call still goes through `authorize()` at PreToolUse | REQ-04/05/06, REQ-ARCH |
| Q5 | Can a confirmed LOW REQUEST authorize a HIGH actual action? | **NO**. The HIGH policy applies, and MEDIUM beyond the scope is denied | REQ-10/11 |
| Q6 | Can a confirmation be replayed? | **NO** | REQ-07, REQ-NEG |
| Q7 | Can an ACTION bypass REQUEST confirmation? | **ACTION follows its existing CIMA path.** Its exact governed call is exempt; nothing else is | REQ-13 |
| Q8 | Can a CONVERSATION create execution side effects? | **NO** | REQ-12 |
| Q9 | Does PreToolUse remain an independent enforcement layer? | **YES**. The gate lives inside `authorize()`, which PreToolUse calls for every tool call; non-executable → deny | REQ-ARCH, all REQ tests |
| Q10 | Does completionGate remain enforced? | **YES** | REQ-14, REQ-ARCH, v0.3.1 9/9 |

### Verdict: **PASS_WITH_OBSERVATIONS**

The critical criterion is met **as a runtime guarantee**: an unconfirmed REQUEST cannot become
tool execution, even when El Inge (or a worker he delegates to, on any provider) tries. That is
proven at the real PreToolUse boundary, not by prompt.

It is not PASS because of §14 and §15. The floor-wide lock is conservative, and it pauses unrelated
work while a REQUEST is pending. There is no confirmation UI yet. There is no expiry. And human
authority still rests on the renderer being the human's channel, as it has for approvals since
v0.2.

### GUARANTEED BY RUNTIME vs INSTRUCTION / CONVENTION

| Property | Runtime guarantee | Instruction / convention |
|---|---|---|
| Unconfirmed REQUEST → no tool execution (any agent, any risk, any provider) | ✅ `requestGate` in `authorize()` | |
| Only the human confirms | ✅ Only call site is the human IPC with `by: 'human'`; all other ids are `NOT_AUTHORIZED` | That the renderer is the human (as for approvals) |
| Confirmation ≠ HIGH approval | ✅ | |
| Replay / tamper / stale refused | ✅ | |
| Actual calls re-classified after confirmation | ✅ | |
| El Inge replies with a *proposal* (and not just silence) | | Message instruction |
| Which of El Inge's calls belong to which request | | Not attributable; the floor-wide lock makes it unnecessary |
