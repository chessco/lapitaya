# LA PITAYA — ALICIA v0.4
## Transversal AI Companion Architecture Foundation

**PitayaCode — Sonora, Mexico**
**Branch**: `lapitaya/alicia-v0.4` (from `lapitaya/cima-runtime-v0.3.1-api-gate`, `f25380bf`)
**Date**: September 29, 2026
**Evidence**: [`evidence/lapitaya-alicia-v0.4/`](../evidence/lapitaya-alicia-v0.4/)

---

## 1. Purpose

v0.4 sets up the architecture for **Alicia**, La Pitaya's AI companion. The goal is for Alicia to
grow in later phases (UI, conversation, desktop, device) without becoming a CIMA agent, taking El
Inge's place, or weakening governance. This phase adds **no autonomy**. It also does not change
CIMA or governance: those are consumed as stable infrastructure (Foundation v0.1, CIMA v0.2,
Hardening v0.3, API Gate v0.3.1).

### What the inspection found (before any change)

| Area | Reality in code | Consequence for v0.4 |
|---|---|---|
| Alicia seam | `src/shared/lapitaya/alicia.ts`: `alicia().notify()`, `registerAlicia()`, no-op default. **No caller anywhere.** | Kept as is (moved to `alicia/registry.ts`); wired for the first time |
| Event system | `CimaRuntimeService.onEvent` → `lapitaya:governance` IPC (`approval-request`, `approval-decided`, `supervised`, `cima-record`, `completion-blocked`); `HookServer` → `hive:hookEvent`; `HiveManager` emit → `hive:message` | **Reused.** No new bus: adapters translate these payloads |
| Task system | `hive/tasks.json` via `HiveManager.tasks()`; status writes gated by `completionGate` (v0.3.1) | Read-only for Alicia; diff adapter `taskEvents()` |
| Notifications | Native OS toasts in `hooks.ts` / `index.ts`, gated by `config.notifications` | Unchanged. Alicia's `AliciaNotification` is a presentation model, not a second toast system |
| Provider abstraction | `AgentProvider` (claude, codex, gemini…) launches **CLI agents in a PTY**; `providerGovernance.ts` classifies them | Not a request/response model API, so it cannot be reused for a companion → new narrow `AliciaProvider` port (interface only) |
| Orchestrator request path | `hive.send(partial, from)` (the path the Command Center uses) delivers **without** CIMA evaluation; only outbox routing (`routeOnce`) evaluates `cima` | Alicia's requests use `hive.send(…, 'alicia')` with no `cima` field; a `cima` from an `alicia` outbox would still be judged by the real router (NEG-02) |
| i18n | `uiLocale` = i18next language; `agentLocale` / `notificationLocale` in renderer `localStorage`; `lapitaya` namespace JSON (es-MX, en-US) | Alicia's strings go in the **same** namespace (`lapitaya:alicia.*`); the main process renders in whatever locales the renderer passes |
| UI shell | `CommandCenterPanel` + `GovernancePanel` (approvals) | Not modified; Alicia notifications point at the existing approvals panel |

## 2. Alicia Role

Alicia is a **transversal AI companion and human-facing intelligence layer**. She:

- tells the human about system state, agent results, CIMA progress, blocks and governance decisions;
- shows evidence the runtime recorded, word for word;
- keeps a small context of what is happening;
- passes the human's requests to El Inge.

She **may**: explain, suggest, prepare, summarize, request.
She **may not**: approve, decide, authorize tools, execute, modify governance or CIMA state, stand in for the auditor or the orchestrator.

## 3. Alicia vs CIMA

```text
HUMAN
  ├──────────► ALICIA ── Companion Layer ── context / explanation / notifications / assistance
  └──────────► CIMA ── El Inge ── Valentín · El Beni · Margarito → José Juan → El Tutú
```

| Property | CIMA agents | Alicia |
|---|---|---|
| Registry `runtime` | `god` / `hire-preset` | `capability` |
| `cimaPhases` | one or more | `[]` |
| Submits `cima` claims | yes | never (her request type has no `cima` field) |
| DECISION authority | El Inge / human only | none: a DECISION PASS under her id is `BLOCKED DECISION_AUTHORITY` |
| Hive agent (registry entry, PTY, inbox) | yes | no (sending a request does not enroll her) |

## 4. Alicia vs El Inge

El Inge stays the **primary orchestrator**. Alicia never messages Valentín, El Beni, Margarito,
José Juan or El Tutú. Her only outbound channel goes to the orchestrator:

```text
USER → ALICIA → AliciaIntent(prepare|request) → hive request {to: godId, act: 'request'} from 'alicia'
     → EL INGE → CIMA → AGENTS / GOVERNANCE
```

Each request starts with a fixed marker (`[Alicia · request relayed from the human — not an
approval, not a CIMA verdict, not an instruction to bypass governance]`). The human's text is
quoted with `> ` so it can never pass for a runtime banner. `explain`, `suggest` and `summarize`
stay local and generate no hive traffic.

## 5. Context Model

`AliciaContext` (`context.ts`) is **derived** (recomputed on every read), **minimal** (ids, labels,
bounded lists), **scoped** (one project, the task in focus, the recent past) and **auditable**
(`provenance` names the source of every field).

| Field | Source of truth |
|---|---|
| `user` | the human (`id: 'human'`) |
| `currentProject` | hive registry (El Inge's cwd) |
| `currentTask` | `hive/tasks.json` (the UI's focus, else the latest task in events) |
| `currentWorkflow` | `CimaStatus`: runtime records + `completionGate` + approvals |
| `currentAgent` | latest event's agent, displayed per `uiLocale` |
| `currentCimaPhase` | `currentWorkflow.phase`, else the latest event phase |
| `currentRisk` | pending approvals (runtime) |
| `lastDecision` | the latest DECISION record the runtime accepted |
| `notifications` | unread/total + latest 5 |
| `recentEvents` | last 20 events |
| `uiLocale` / `agentLocale` / `notificationLocale` | UI i18n settings (`resolveLocaleSettings`) |

The only state the companion keeps (`companion.ts`) is a bounded ring of locale-neutral events
(default 100) plus the ids the human has read. It is not a second database.

## 6. Event Model

`events.ts`: `task.created|started|blocked|completed`, `agent.started|completed|failed`,
`cima.phase.assigned|changed`, `governance.blocked|supervised`, `approval.required|granted|denied`,
`audit.completed`, `workflow.completed`, `error`.

Adapters from **existing** sources (no new bus):

| Adapter | Source | Wired in v0.4 |
|---|---|---|
| `fromRuntimeEvent(e)` | `CimaRuntimeService.onEvent` (same payload as `lapitaya:governance`) | **yes**, in `src/main/index.ts` |
| `fromHookEvent(h)` | `HookEvent` (`hive:hookEvent`) | adapter + tests; not wired (§16) |
| `taskEvents(before, after)` | two reads of `tasks.json` | adapter + tests; not wired (§16) |

Every event carries the runtime detail word for word in `technical` (`risk, category, mode,
decision, rule, tool, reason, violations, approvalId, claimed`), the recorded `evidence`, and a
`ref` back to its source record. A payload that is malformed or unknown produces **no** event:
Alicia stays silent instead of guessing.

## 7. Notification Model

`AliciaNotification` (`notifications.ts`): `id, eventType, type, severity, title, message,
timestamp, source, context, technical, evidence, action, read`.

- Types: `INFO, SUCCESS, WARNING, BLOCKED, APPROVAL_REQUIRED, ERROR`.
- They are rendered **at read time** in `notificationLocale`. Nothing localized is stored.
- `message` always names the rule (`La acción fue bloqueada por CIMA (DECISION_GATE).`), and
  `technical.reason` carries the runtime's own reason text. **Nothing about the real reason is
  hidden.**
- `action` only points to an existing surface (`open-approvals`, `open-task`) and is marked
  `humanOnly: true`.
- Examples produced by the tests: "El Beni terminó BUILD: PASS.", "José Juan terminó la auditoría:
  PASS.", "Se requiere aprobación humana. Esta acción requiere tu aprobación porque está
  clasificada como riesgo alto."

## 8. Conversation Boundary

`conversation.ts` contains **interfaces only**: `AliciaUserMessage`, `AliciaAssistantResponse
{text, citations, suggestedActions, notificationIds}`, `AliciaTurn`, and `AliciaConversation.respond()`.
Two guarantees are defined now because they concern governance:

- `suggestedActions` are `AliciaIntent`s. They go through `toOrchestratorRequest` and governance,
  never directly to a tool.
- `groundedCitations()` / `knownRefs()` only accept citations of records the runtime has already
  made. A response cannot bring its own evidence.

Not implemented: memory, RAG, vector search, a personality engine, voice, multimodal input, planning.

## 9. Provider Boundary

`AliciaProvider { id, model, generate(request) }` (`provider.ts`) is an **interface only**. The
UI talks to `AliciaConversation`, the conversation talks to this port, and the host decides
which vendor is behind it. Nothing depends on Claude, Gemini, OpenAI or Codex. Provider output
is **untrusted**: suggested actions are re-parsed with `parseAliciaIntent()`, and citations are
filtered. `ALICIA_SYSTEM_BOUNDARY` is the rule text a provider always receives; enforcement
does **not** depend on the model following it, because Alicia has no execution path to misuse.

## 10. Governance Boundary

```text
ALICIA → HIGH-RISK ACTION → CIMA GOVERNANCE → HUMAN APPROVAL        (always)
ALICIA → DIRECT EXECUTION                                          (does not exist)
```

What a host lends the companion (`AliciaPorts`) is **everything** she can reach:

| Port | Kind |
|---|---|
| `cimaStatus(taskId)` | read: derived, **deep-frozen** snapshot |
| `tasks()`, `project()`, `agentName()` | read |
| `autonomyStage()` | read, so the governance *preview* matches the runtime |
| `orchestratorId()`, `sendToOrchestrator(req)` | the **only** write: one hive request to El Inge, sent as `alicia` |

The ports include **no** `authorize` / `decide` / `submit` / `handle` / `updateTaskStatus` /
`patchTask` / `writeTasks` and no executor. For a proposed tool call, Alicia computes a
**preview** with the runtime's own `authorizeToolCall`, using her actor id and **no approvals**. A
HIGH call therefore previews as `HUMAN_APPROVAL_REQUIRED`. The preview is never persisted, never
creates or consumes an approval, and nothing executes (`executed: false` on every result).

The IPC surface (`src/main/index.ts`, `src/preload/index.ts`) is `alicia:snapshot`,
`alicia:markRead` and `alicia:request`, which validates its input with `parseAliciaIntent`.
Nothing more.

## 11. Presence Model

`AliciaPresence` (`presence.ts`): `IDLE, THINKING, NOTIFYING, WAITING_APPROVAL, CELEBRATING,
WARNING, BLOCKED`. It is **derived** from unread notifications, so it can never disagree with
the facts behind it. When several apply, the state that most needs the human wins: approval >
blocked > warning/error > celebrating (`workflow.completed`) > notifying > thinking > idle. This
is a model only: no avatar or surface uses it in v0.4.

## 12. Companion Protocol Boundary

Documented, **not implemented**:

```text
Alicia (shared, pure: events → state → snapshot)
   ↓  Companion Protocol
Desktop · Mobile · Future Device
```

Principles already in place:

1. **The host is decoupled from the UI.** The Alicia layer is pure TypeScript under
   `src/shared`. It has no Electron, DOM or fs import, and it is hosted in the main process.
   Electron's renderer is one consumer (through IPC), not the owner.
2. **Snapshot-shaped protocol.** A surface receives `AliciaCompanionState` (identity, context,
   presence, notifications) in its own locales, and sends back only `markRead` and intents.
3. **Surfaces have no more authority than Alicia.** A device can relay an intent. It cannot
   approve: approvals remain a human action on the governance surface.
4. **Locale travels with the request**, because surfaces may differ in language.

## 13. i18n

- `es-MX` and `en-US` are preserved. Alicia's strings live in the `lapitaya` namespace
  (`alicia.notifications|explain|evidence|presence`), with identical key sets in both locales
  (tested). The en-US strings contain no accents (tested).
- **`uiLocale`** is used for conversation, explanations (`explain()`) and context labels (agent
  names). **`notificationLocale`** is used for notifications. **`agentLocale`** is not used for
  Alicia's own words. The request she sends to El Inge has a fixed English marker, and the
  human's text is quoted as written.
- Technical identifiers are never translated: `risk=HIGH`, `decision=HUMAN_APPROVAL_REQUIRED`,
  `phase=BUILD` and `verdict=PASS` appear verbatim, even in Spanish sentences.
  Only `*Label` values (`riesgo alto`, `Construir`) are localized.
- Unknown locales fall back to en-US.

## 14. Security

- **No special permissions.** `governance.ts`, `autonomy.ts`, `toolRisk.ts`, `cimaRuntime.ts`
  (shared and main), `providerGovernance.ts` and `hooks.ts` contain no mention of Alicia (tested).
  The Alicia layer has no `AliciaAdmin`, `AliciaBypass` or `AliciaTrusted` (tested).
- **Same answer as any actor.** `authorize('alicia', HIGH)` produces the same decision, risk and
  rule as `authorize('el-beni', HIGH)` (tested).
- **Least capability.** The only things Alicia can do are the ones a host lends her (§10).
- **Snapshots are deep-frozen.** Writing to one throws, and the runtime's records are unchanged
  (tested).
- **Untrusted input** (IPC, future provider output) is validated: `parseAliciaIntent` bounds text
  length and only allows the 5 intent kinds.
- **No request injection.** The human's text is quoted in the request, so it cannot imitate a
  `[CIMA runtime]` banner.
- **Failure isolation.** `alicia().notify` contains any exception, and main wraps the adapter in
  `try`, so a failure in Alicia cannot break governance.

## 15. Test Strategy

[`test/lapitaya-alicia-v04.test.cjs`](../test/lapitaya-alicia-v04.test.cjs) runs against the
**real** `HiveManager` + `HookServer` + `CimaRuntimeService`, wired the same way `src/main/index.ts`
wires the companion.

| ID | Requirement | Result |
|---|---|---|
| ALICIA-01 | Reads CIMA status (pipeline BUILD/TEST/AUDIT PASS, gate verbatim) | PASS |
| ALICIA-02 | Presents existing evidence verbatim; an empty record stays empty | PASS |
| ALICIA-03 | Receives governance events (approval required/denied, completion blocked, real reason kept) | PASS |
| ALICIA-04 | Localized explanation (es-MX/en-US), technical detail intact, unknown rules named | PASS |
| ALICIA-05 | Cannot execute HIGH directly: no execution surface, preview only, same decision as any agent | PASS |
| ALICIA-06 | Not DECISION authority; no special-casing in governance; no Admin/Bypass/Trusted | PASS |
| ALICIA-07 | Not a CIMA worker (no phases, no preset, not enrolled in the hive) | PASS |
| ALICIA-08 | Respects `uiLocale` (and `notificationLocale`) without translating identifiers | PASS |
| ALICIA-09 | Cannot modify CIMA state (frozen snapshots, ledger untouched) | PASS |
| ALICIA-10 | An intent reaches El Inge as a hive request from `alicia` | PASS |
| NEG-01 | Alicia → HIGH tool at PreToolUse → deny `HUMAN_APPROVAL_REQUIRED` | PASS |
| NEG-02 | Alicia → DECISION PASS through the real router → `BLOCKED DECISION_AUTHORITY` | PASS |
| NEG-03 | Alicia → write ledger/approvals → `governance-tamper` HIGH, denied | PASS |
| NEG-04 | Alicia → bypass completionGate (request, `updateTaskStatus`, `patchTask`, Write to `tasks.json`) → blocked | PASS |
| + 5 | adapters, presence priority, bounded context, grounded citations, i18n parity | PASS |

Regression results are in §18.

## 16. Future Extensions

| Next | Builds on |
|---|---|
| Alicia UI panel + toasts | `window.cth.aliciaSnapshot()` / `aliciaMarkRead()`; `lapitaya:alicia.*` keys |
| Wire hook and task events | `fromHookEvent` at the HookServer emit point; `taskEvents` in the task-write path |
| Conversation | implement `AliciaConversation` on an `AliciaProvider`; citations through `groundedCitations` |
| Desktop / device | Companion Protocol over `AliciaCompanionState` (§12) |
| Presence visuals | `AliciaPresence` → avatar states |
| Persistence of read state | only if needed; today it resets on restart, by design |

## 17. Explicit Non-Goals

Not implemented, on purpose: pets, animals, transformations, a Tamagotchi lifecycle (aging,
descendants, death), hardware, a full desktop companion, a desktop avatar, voice, autonomous
Alicia, RAG, a vector database, long-term memory, a personality engine, LangGraph, LangChain,
Redis, a new database, a new event bus, and a new agent-provider system. No change to the autonomy
policy (LOW→AUTO, MEDIUM→SUPERVISED, HIGH→HUMAN_APPROVAL) or to the CIMA rules (Builder != Auditor,
Evidence First, Human Governance, Progressive Autonomy).

## 18. Final Verdict

### Validation

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | `tests/typecheck.txt` |
| `npm run build` | exit 0 (`✓ built in 41.01s`). The first attempt ran next to an evidence script and esbuild ran **out of memory** (ENVIRONMENT); the rerun alone passed | `tests/build.txt` |
| Alicia v0.4 suite | **19/19 PASS** | `tests/alicia-v04.txt` |
| La Pitaya regression | Foundation 25/25 · CIMA v0.2 25/25 · Hardening v0.3 35/35 · API Gate v0.3.1 9/9 | `tests/lapitaya-regression.txt` |
| Full suite (`npm run test:focused`; `package.json` has no `test` script) | 964 tests: 932 pass, **21 fail**, 11 skipped | `tests/full-suite.txt` |
| Failure classification | 21 **PRE_EXISTING**: the same set as the v0.2 baseline (Windows symlink EPERM, CRLF regexes, POSIX path, remote model catalog). **0 NEW_REGRESSION**. No test deleted or weakened | `tests/full-suite.txt` |
| Governance flows (real runtime) | NEG-01..04 and the preview / request path, recorded | `governance/negative-flows.md`, `governance/alicia-ledger.jsonl` |
| i18n renderings | The same facts in es-MX and en-US; identifiers intact | `i18n/renderings.json`, `i18n/evidence-presentation.json` |
| Boundary inventory | Files, exports, imports, host wiring, ports, zero Alicia mentions in governance | `architecture/boundary.txt` |

One Foundation test file was **updated, not weakened**. `test/lapitaya-foundation.test.cjs` now
loads the seam from `alicia/index.ts` and uses the v0.4 event shape. Its two assertions (disabled
by default; a throwing implementation is contained) are unchanged.

### Verdict: **PASS_WITH_OBSERVATIONS**

| PASS criterion | State |
|---|---|
| Clear architectural boundary | ✅ `src/shared/lapitaya/alicia/`, pure, host-agnostic |
| Not a CIMA agent | ✅ ALICIA-07 |
| Not the orchestrator | ✅ she only sends requests to El Inge (ALICIA-10) |
| No authority | ✅ ALICIA-06, NEG-02 |
| Cannot bypass governance | ✅ ALICIA-05/09, NEG-01..04 |
| Context model works | ✅ ALICIA-01/08, bounded-context test |
| Event / notification boundary works | ✅ ALICIA-03, wired to the live runtime event stream in `src/main/index.ts` |
| i18n works | ✅ ALICIA-04/08, key-parity test |
| Tests pass, no regressions | ✅ 0 new failures |

Observations (all are future integrations or pre-existing issues, none a defect in the boundary):

1. **No UI consumer yet.** `aliciaSnapshot` / `aliciaRequest` are exposed, but no panel renders
   them, so Alicia is live in the main process and invisible to the user.
2. **Hook and task adapters are not wired.** `fromHookEvent` and `taskEvents` are implemented and
   tested, but only the CIMA runtime stream feeds the companion today. Wiring them touches
   `hooks.ts` and the task-write path, which are governance-adjacent, so it was left for a
   dedicated change.
3. **Conversation and provider are interfaces only**, as the phase requires.
4. **Validated at node level, not in a live Electron session.** The tests drive the real
   `HiveManager`/`HookServer`/`CimaRuntimeService` stack. The app was not launched to watch
   Alicia receive a real agent's events.
5. The 21 pre-existing Windows/environment test failures still hide regressions in those areas
   (unchanged since v0.2).
