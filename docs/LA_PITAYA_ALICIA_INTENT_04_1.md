# LA PITAYA — ALICIA v0.4.1
## Intent & CIMA Governance Boundary

**PitayaCode — Sonora, Mexico**
**Branch**: `lapitaya/alicia-v0.4.1-intent-boundary` (from `lapitaya/alicia-v0.4`, `50365b9f`)
**Date**: September 30, 2026
**Evidence**: [`evidence/lapitaya-alicia-v0.4.1/`](../evidence/lapitaya-alicia-v0.4.1/)

> Alicia can turn human conversation into a structured intent, but only CIMA can turn a
> governable intent into an authorized action.

---

## 1. Problem

The v0.4 validation found that **requests could reach El Inge without CIMA judging them**:

- `HiveManager.send()` delivers a message without evaluating it. Only outbox routing
  (`routeOnce`) runs the CIMA handler.
- In v0.4, Alicia held a `sendToOrchestrator` port that called `hive.send(msg, 'alicia')`
  directly. The runtime was never asked what a request meant or how risky it was.
- The v0.4 governance *preview* was computed **inside Alicia's layer** (`previewGovernance`),
  so the producer of the request also computed its risk.
- The renderer's `hive:send` IPC accepted any sender id, so a message "from alicia" could be
  created without going through anything.

Nothing executed on that path, because every tool call is still gated at PreToolUse. But the
**classification and the risk** of what the human asked for came from the producer, not
from the runtime.

## 2. Conversation vs Request vs Action

| Type | Examples | Where it goes | Side effects |
|---|---|---|---|
| **CONVERSATION** | "¿Qué está haciendo El Beni?", "Explícame qué significa BLOCKED.", "Hola Alicia" | Back to Alicia, who answers | **None**: no ledger, no event, no El Inge, no approval, no risk evaluation |
| **REQUEST** | "Quiero que revisemos este proyecto.", "Analiza este problema.", "Quiero que El Beni implemente esto.", "Prepara una tarea para el equipo." | El Inge, stamped `PROPOSAL ONLY … WAIT for their go-ahead. Do not execute` | One ledger record, one event, one hive message |
| **ACTION** | "Modifica este archivo.", "Ejecuta los tests.", "Haz una migración.", "Despliega esto.", "Elimina estos datos." | CIMA (risk → autonomy → authorization) first, **then** El Inge with the runtime's decision | One ledger record, one event, a pending approval for HIGH concrete calls, one hive message (or none if blocked) |

## 3. AliciaIntent

Contract: [`src/shared/lapitaya/intent.ts`](../src/shared/lapitaya/intent.ts). It is shared,
pure and names no provider.

| Field | Meaning |
|---|---|
| `id` | Unique intent id (`int-…`) |
| `source` | Producer (`'alicia'`, the only one accepted). Being a producer grants nothing |
| `type` | `CONVERSATION \| REQUEST \| ACTION`: the **producer's claim** |
| `message` | The human's words, verbatim |
| `context` | `taskId`, `phase`, `uiLocale` |
| `requestedBy` | Always `'human'` |
| `target` | `agent` (only El Inge is valid), `path`, `tool` + `input` (a proposed call, never run by the boundary), `taskId` |
| `risk` | The producer's **suggestion**; never authoritative |
| `status` | `RECEIVED` on submission; the runtime moves it to `CLASSIFIED`, `FORWARDED`, `GOVERNED`, `BLOCKED` or `COMPLETED` |
| `createdAt` | Timestamp |

The v0.4 `AliciaIntent` (`kind: explain|suggest|prepare|summarize|request`) was the closest
existing model. It was **replaced** by this one rather than kept in parallel. `previewGovernance`,
`toOrchestratorRequest` and `parseAliciaIntent` were removed from Alicia's layer.

## 4. Classification

`classifyIntentMessage(message, target)` is small, deterministic and needs no LLM:

- The message is folded to ASCII lower case, so `migración` becomes `migracion`.
- Word-bounded rules match Spanish imperative, infinitive and subjunctive verb forms plus
  English verbs. Spanish past tenses are left out on purpose: "¿por qué se borró?" is a question
  about history, not an instruction.
- **Every rule that fires is returned as a `signal`** (`action:delete`, `request:verb`,
  `frame:knowledge`, `demoted:knowledge-question`, …) and stored in the ledger. That is the audit
  trail of the decision.

Rules, in order of strength:

1. **Authority** (`authority:decision-pass`, `authority:approve`) and **task completion**
   (`action:complete-task`) make it an ACTION, handled specially (§6).
2. **Action categories** map to the existing `ActionCategory` values: delete → `data-deletion`,
   deploy → `production`, migrate → `destructive-migration`, run tests → `run-tests`, modify →
   `code-change`, push/merge → `irreversible`, secrets, permissions, infrastructure, and a
   generic run → `shell-command`. When several match, the strictest wins.
3. **Request verbs** (quiero que, revisa, analiza, prepara, implementa, audita, review, analyze…).
4. Anything else is **CONVERSATION**.

The classifier leans toward the stricter type. The only demotion is a pure knowledge question
("Explícame cómo desplegar a producción") with **no chained instruction**. "Explícame por qué
falló **y luego** borra la base de datos" stays an ACTION. The demotion is safe because a
CONVERSATION has no execution path, and it shows up as a signal.

## 5. El Inge Boundary

```text
ALICIA ── AliciaIntent ──▶ IntentBoundary (runtime, src/main/intentBoundary.ts)
                              │
                              ├── CONVERSATION → back to Alicia → answer
                              ├── REQUEST      → El Inge: proposal, WAIT
                              └── ACTION       → CIMA → El Inge with the runtime's decision
```

- Alicia's **only outbound port** is `submitIntent(intent)`, wired in `src/main/index.ts` to
  `intentBoundary.submit`. `sendToOrchestrator` no longer exists.
- Only the boundary delivers to El Inge (`hive.send(msg, 'alicia')`), and only after
  classification and governance. The first line of each message is the **runtime's stamp**:
  `[Intent boundary] intent <id> · ACTION (claimed CONVERSATION/LOW) · risk HIGH · decision
  HUMAN_APPROVAL_REQUIRED · rule … · approval apr-…`. It works like the CIMA router's banner:
  El Inge acts on the runtime's verdict, not on Alicia's label.
- The human's text is quoted with `> `, so it cannot imitate a banner.
- `target.agent` may only be El Inge. Addressing a worker (El Beni, José Juan…) or a tool is
  `BLOCKED INTENT_TARGET`.
- `hive:send` IPC **rejects the sender `alicia`**. Messages under Alicia's id can only come from
  the boundary.
- El Inge remains the orchestrator and the executor. The boundary only delivers.

## 6. CIMA Boundary

For an ACTION, the boundary asks `CimaRuntimeService` and nothing else:

| Case | What the runtime does |
|---|---|
| **Concrete call** (`target.tool` + `input`) | `evaluateProposedCall(El Inge, tool, input, {raiseApproval: true})`. This uses the same classifier, autonomy stage and decision-gate projection as `authorize()`, **for the executor**. It never consumes an approval and never executes |
| **No call yet** (text only, possibly a `path`) | The strictest reading of the words and any named path (`classifyWritePath`) is passed through the same `authorizeToolCall` policy (no approval raised). The eventual call is authorized again at PreToolUse |
| **Task completion** | `completionGate(taskId)`. If not allowed: `recordBlockedCompletion(…, 'intent-boundary')` and BLOCKED `DECISION_GATE`. If allowed: forwarded; the task is still marked done only through the existing gated paths |
| **Authority** (DECISION PASS, approve, or fields like `cima`, `decision`, `approvalId`, `execute`) | BLOCKED `NOT_AUTHORIZED` |
| **Words riskier than the call** ("borra la base de datos" + a `Read`) | BLOCKED `INTENT_MISMATCH`. The runtime cannot enforce the stricter reading at execution time, so it refuses |

**The boundary never executes.** It has no executor dependency. Its only side effects are one
ledger record, one runtime event and at most one hive message. Execution is always El Inge's own
tool call, and every one of those passes through `PreToolUse → authorize()`, which is unchanged.

The only change to `CimaRuntimeService` is additive. It gains three methods, `classifyCall`,
`evaluateProposedCall` and `recordIntent`, plus a private `requestApproval` helper extracted from
`authorize()` so both use the same approval code. `authorize()` behaves the same (the v0.2, v0.3
and v0.3.1 suites pass unchanged). `completionGate()` and `providerGovernance` are not modified.

The new governance code is itself protected: `toolRisk.ts` now classifies writes to
`src/main/intentBoundary.ts` and `src/shared/lapitaya/intent.ts`, and shell commands that touch
them, as `governance-tamper` (HIGH). This change only tightens protection.

## 7. Risk Reclassification

- **Type:** `stricterType(claimed, runtime)`. Alicia can raise the type but never lower it. A
  CONVERSATION label on "borra la base de datos" becomes ACTION.
- **Risk:** it comes **only** from the runtime classifier and policy. Alicia's `risk` is kept as
  `claimedRisk` for the audit and has no effect. Example: LOW claimed, HIGH detected →
  `HUMAN_APPROVAL_REQUIRED`.
- `reclassified: true` is recorded, and El Inge's banner shows the claim beside the verdict.

## 8. Human Approval

```text
ALICIA → ACTION INTENT → CIMA → HIGH → HUMAN_APPROVAL_REQUIRED (pending approval for El Inge + exact call)
       → ALICIA EXPLAINS (approval.required on the existing stream → APPROVAL_REQUIRED notification)
       → HUMAN APPROVES (existing lapitaya:decide / GovernancePanel)
       → EL INGE'S IDENTICAL CALL → PreToolUse → APPROVED → one execution → retry denied
```

This is the **v0.3 mechanism**: the same `Approval` records, the same fingerprint and the same
one-shot consumption. There is no second approval system. The approval is bound to the executor
(El Inge), never to Alicia. Alicia cannot approve: "Aprueba apr-…" is `NOT_AUTHORIZED`.

## 9. Evidence

Each governed intent writes an `IntentRecord` to `cima-ledger.jsonl` (`kind: 'intent'`):

`id, source, requestedBy, message, claimedType, type, reclassified, signals, claimedRisk, risk,
category, decision, rule, mode, reason, approvalId, fingerprint, target, taskId, executor, status,
trail[{status, ts}], forwardedTo, messageId`.

The chain intent → approval → authorization → execution is linked by ids that already exist:

- `approvalId` connects the intent record to the `HUMAN_APPROVED` / `APPROVED` governance records.
- `messageId` connects it to the message El Inge received.
- The execution is the executor's `ExecutionTrace`.

Alicia presents this chain from the event stream and cannot write to it.

## 10. Security

| Threat | Control |
|---|---|
| Alicia executes | No execution port; the boundary has no executor; the only execution entry is PreToolUse (structural tests) |
| Producer's label or risk is trusted | Runtime re-classification; the stricter type wins; risk comes from the runtime only |
| Harmless call hides a destructive request | `INTENT_MISMATCH` |
| Alicia addresses a worker or a tool | `INTENT_TARGET` |
| Alicia issues DECISION / approves | `NOT_AUTHORIZED` (text rules and authority fields); CIMA's `DECISION_AUTHORITY` still applies on the router path |
| Task completed without DECISION PASS | `completionGate()` at the boundary; plus every existing gated path |
| Messages forged as `alicia` | `hive:send` IPC rejects the sender; `routeOnce` still evaluates any `cima` in an `alicia` outbox |
| An agent edits the boundary | `intentBoundary.ts` and `intent.ts` are `governance-tamper` (HIGH) |
| Malformed or replayed intent | `INTENT_INVALID`: id, source, type, message, `requestedBy`, `status = RECEIVED` and `createdAt` are all required |
| Special trust | No `AliciaAdmin/Trusted/Bypass/Governor`; governance code never special-cases the `alicia` id (tested) |

## 11. Positive Tests

[`test/lapitaya-alicia-v041.test.cjs`](../test/lapitaya-alicia-v041.test.cjs) runs on the real
runtime, through the shared fixture [`test/fixtures/lapitaya-floor.cjs`](../test/fixtures/lapitaya-floor.cjs).

| ID | Scenario | Result |
|---|---|---|
| INTENT-CLS | 25 spec phrases classified as expected, deterministically, with signals | PASS |
| INTENT-01 | "Hola Alicia" → Alicia answers; 0 ledger lines, 0 events, 0 El Inge, 0 approvals, 0 traces | PASS |
| INTENT-02 | REQUEST → stamped `PROPOSAL ONLY` message to El Inge; ledger `RECEIVED→CLASSIFIED→FORWARDED`; nothing runs | PASS |
| INTENT-03 | ACTION LOW (`npm test`) → ALLOW → El Inge's PreToolUse ALLOW → trace by `god` | PASS |
| INTENT-04 | ACTION MEDIUM (Edit) → SUPERVISED, and PreToolUse agrees | PASS |
| INTENT-05 | ACTION HIGH → HUMAN_APPROVAL_REQUIRED → Alicia explains → human approves → one APPROVED run → retry denied; ledger linked by `approvalId` | PASS |

## 12. Negative Tests

| ID | Attempt | Result |
|---|---|---|
| INTENT-NEG-01 | Alicia executes HIGH directly (PreToolUse as `alicia`; intent with `execute: true`) | deny / `NOT_AUTHORIZED`; 0 traces |
| INTENT-NEG-02 | CONVERSATION/LOW label on "borra la base de datos"; LOW label on `rm -rf` | reclassified → ACTION, HIGH, `HUMAN_APPROVAL_REQUIRED`; mismatched call → `INTENT_MISMATCH` |
| INTENT-NEG-03 | Intent addressed to `Bash`, `tool:Bash`, `el-beni-1`, `jose-juan-1` | `BLOCKED INTENT_TARGET`; `hive:send` guard present |
| INTENT-NEG-04 | "Emite DECISION PASS…", "Record DECISION PASS…", "Aprueba apr-123"; `cima` / `decision` / `approvalId` fields | `NOT_AUTHORIZED`; no DECISION recorded; gate still closed |
| INTENT-NEG-05 | "Marca la tarea como terminada" without DECISION PASS | `BLOCKED DECISION_GATE`, recorded; after a real DECISION PASS the same intent is allowed through (the gate is the authority) |
| INTENT-NEG-06 | Missing id / source / type, unknown source or type, pre-governed status, empty message, not an object | `DENY INTENT_INVALID`, recorded, never forwarded |

Architecture tests. These check the code's structure, not just conventions:

- **INTENT-ARCH-01:** the Alicia layer's value imports are restricted to an allowlist. Her code
  never references `authorize`, `decide`, `send`, `routeOnce`, `updateTaskStatus`,
  `evaluateProposedCall`, `recordTrace`…
- **INTENT-ARCH-02:** given poisoned extra capabilities, the companion only ever calls
  `submitIntent`. A Proxy on the runtime shows the boundary never touches `authorize`,
  `recordTrace`, `submit`, `handle` or `decide`. Everything it forwards goes to El Inge, as
  `alicia`, stamped, with exactly `to/act/subject/body`. `main` wires the companion to the
  boundary only.
- **INTENT-ARCH-03:** the boundary files are governance-protected; governance code never names
  `alicia`; the intent contract names no provider.
- **INTENT-EVENTS:** intents appear on the existing stream; conversation stays silent.

## 13. Provider Independence

`AliciaIntent`, `IntentRecord` and `IntentOutcome` contain no provider field and name no vendor
(tested). The provider appears only where it did before: on the executor's tool calls
(`GovernanceRecord.provider`) and in `providerGovernance` at spawn time. There is no
`ClaudeIntent`, `GeminiIntent` or `CodexIntent`.

## 14. Event Stream

No new bus. `CimaRuntimeService.onEvent` gains one event type, `intent`, carrying the
`IntentRecord`. It flows on the existing `lapitaya:governance` IPC channel and through
`fromRuntimeEvent()` into Alicia. The record's `trail` becomes `intent.received`,
`intent.classified`, `intent.forwarded`, `intent.governed` and `intent.blocked`. `approval.required`,
`approval.granted` and `approval.denied` are the existing events. A CONVERSATION emits nothing.

i18n: every new event and rule has es-MX and en-US text (`lapitaya:alicia.notifications.intent_*`,
`alicia.explain.{NOT_AUTHORIZED, INTENT_*, ALLOW, …}`, `alicia.intentTypes.*`, `alicia.reply.*`).
The identifiers (`CONVERSATION`, `REQUEST`, `ACTION`, `LOW/MEDIUM/HIGH`, `ALLOW/DENY/BLOCKED`,
`PASS`) are never translated.

## 15. Future Extensions

- **An LLM classifier** can sit *in front of* the deterministic one, as a producer-side
  suggestion. The runtime keeps the deterministic re-check and the strictest-wins rule.
- **Runtime enforcement of "REQUEST = proposal only".** Today it is a stamped instruction to El
  Inge; every tool call he makes is still governed. A runtime link from a REQUEST to "no
  MEDIUM/HIGH until the human confirms" needs a task-scoped policy, which is out of scope.
- **Alicia UI:** `window.cth.aliciaSubmit(message, {taskId, target})` is ready.
- **Delegated approvals:** today an approval is bound to El Inge + the exact call. If he
  delegates the call to a worker, the worker's call raises its own approval (correct, but a
  second prompt).

## 16. Non-Goals

Not built: a full Alicia UI, avatar, pets, Tamagotchi, voice, desktop companion, hardware, RAG,
vector DB, long-term memory, autonomous Alicia, a new event bus, a workflow engine, a provider
framework, LangGraph/LangChain, Redis, or a new database. The following are unchanged:
Builder != Auditor, Evidence First, Human Governance, Progressive Autonomy,
LOW→AUTO / MEDIUM→SUPERVISED / HIGH→HUMAN_APPROVAL, `authorize()` (behaviour), `completionGate()`
and `providerGovernance`.

## 17. Final Verdict

### Validation

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | `validation/typecheck.txt` |
| `npm run build` | exit 0 | `validation/build.txt` |
| v0.4.1 suite | **16/16 PASS** | `validation/alicia-v041-suite.txt` |
| La Pitaya regression | Alicia v0.4 19/19 · Foundation 25/25 · CIMA v0.2 25/25 · Hardening v0.3 35/35 · API Gate v0.3.1 9/9 | `validation/lapitaya-regression.txt` |
| Full suite (`npm run test:focused`) | 980 tests: 948 pass, **21 fail**, 11 skipped | `validation/full-suite.txt` |
| Failure classification | 21 **PRE_EXISTING**: the same set as the recorded baseline. **0 NEW_REGRESSION**, 0 ENVIRONMENT. No test deleted | `validation/full-suite.txt` |
| Classification table | 22 spec phrases with type, category and signals | `classification/` |
| Flows on the real runtime | INTENT-01..05, and the HIGH approval chain step by step | `positive-tests/flows.json`, `governance/high-approval-chain.jsonl` |
| Refused intents | INTENT-NEG-01..06 outcomes and ledger records | `negative-tests/outcomes.json`, `governance/blocked-intents.jsonl` |

The Alicia v0.4 suite was **adapted, not weakened**. It now uses the shared fixture and
`companion.submit()` instead of `request()`, and three assertions became stricter:

- A HIGH request's approval must be bound to the executor, not to Alicia.
- "DECISION PASS" requests are refused before reaching El Inge.
- "mark done" is blocked by `completionGate` instead of merely relayed.

### Verdict: **PASS_WITH_OBSERVATIONS**

| PASS criterion | State |
|---|---|
| Conversation / Request / Action clearly separated | ✅ INTENT-CLS, INTENT-01/02 |
| `AliciaIntent` exists | ✅ `shared/lapitaya/intent.ts` |
| Alicia does not execute directly | ✅ INTENT-NEG-01, INTENT-ARCH-01/02 |
| El Inge receives structured intents | ✅ stamped `[Intent boundary]` messages (INTENT-02, ARCH-02) |
| ACTION enters CIMA | ✅ INTENT-03/04/05 |
| Risk revalidated by the runtime | ✅ INTENT-NEG-02 |
| HIGH requires approval | ✅ INTENT-05 (real v0.3 mechanism) |
| Alicia cannot issue DECISION | ✅ INTENT-NEG-04 |
| `completionGate` still works | ✅ INTENT-NEG-05 |
| Event stream reused | ✅ INTENT-EVENTS |
| Tests pass, no new regressions | ✅ |

Observations (future integrations, not boundary defects):

1. **"REQUEST = proposal only" is a stamped instruction, not a runtime lock.** El Inge's
   subsequent tool calls are still governed call by call at PreToolUse, but nothing at runtime
   stops a LOW or MEDIUM call he makes in response to a REQUEST (§15).
2. **The deterministic classifier is a heuristic.** It errs toward ACTION, and its signals are
   auditable. Wording it doesn't recognise falls back to the conservative defaults: unknown
   ACTION means HIGH, and a concrete call is always classified by `toolRisk`. The classifier's
   known limitation from v0.2 still applies: an unrecognized destructive shell command is MEDIUM.
3. **No UI consumes `aliciaSubmit` yet.** The boundary was validated at node level against the
   real runtime, not in a live Electron session.
4. The 21 pre-existing Windows/environment failures are unchanged.
