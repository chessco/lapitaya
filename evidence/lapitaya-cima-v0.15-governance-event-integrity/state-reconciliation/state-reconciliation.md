# state-reconciliation.md — which file is the fact, which is derived

Code: `GovernanceEventStore.reconcile()` (`src/main/governanceStore.ts`) + `CimaRuntimeService.load()`.
Tests: EVENT-18…22, 26, ADV-1…ADV-4. Real Electron: `electron_validation_v15.txt` I1, I2.

## Source-of-truth map (FACT, from the code)

| File | Role | Authority |
|---|---|---|
| `cima-ledger.jsonl` | the hash-chained, MAC-sealed event stream | **AUTHORITATIVE governance facts** (decisions, human decisions, request transitions, CIMA verdicts, execution commits) |
| `ledger-head.json` | keyed anchor of the chain head | integrity witness for the ledger (detects tail deletion) |
| `traces.jsonl` | execution evidence CONTENT | **evidence** — a trace counts only if a chained `TOOL_EXECUTED`/`TOOL_FAILED` event commits to its SHA-256 |
| `proposals.json` | REQUEST working state (holds the single-use token, scope, content-bound fingerprint) | **derived state** — may never claim more than the events justify |
| `approvals.json` | approval working state (holds the SHA-256 binding and the HMAC seal) | **derived state** — same rule; v0.14's binding/seal stay the mechanism, reconciliation is added |
| `tasks.json` | the kanban | **UI projection**; "done" is gated by the ledger (`completionGate`), not derived from it |
| `governance-recovery.json` | detection/recovery history | operator record, chained and sealed; not a governance event stream |

No second source of truth was introduced: state files are checked **against** the ledger; the ledger is checked **against itself** (chain, MACs, anchor) and the traces against it.

## Reconciliation rule

State that claims MORE authority than the events justify ⇒ **INCONSISTENT** ⇒ governance fails closed (`GOVERNANCE_STATE_INCONSISTENT`).
State that claims LESS (a crash between an event and its state write) ⇒ warning (`STATE_BEHIND_EVENTS`, `STATE_UNEVIDENCED_REDUCED`), never blocks, never grants.

| State says | Events say | Verdict |
|---|---|---|
| proposal `CONFIRMED` | `PROPOSED` / terminal | `PROPOSAL_STATE_MISMATCH` (error) |
| proposal `CONFIRMED` | no event at all | `PROPOSAL_UNEVIDENCED` (error) |
| proposal absent | `PROPOSED` or `CONFIRMED` (the floor would open) | `PROPOSAL_MISSING` (error) |
| proposal `PROPOSED` | `CONFIRMED` / `CANCELLED` / … | `STATE_BEHIND_EVENTS` (warning); confirm/cancel refuse because the events are authoritative |
| approval `approved` | no `HUMAN_APPROVED` event (with a valid human owner, same agent) | `APPROVAL_UNEVIDENCED` (error) — **even with a valid seal** (EVENT-19, Electron I2) |
| approval `approved` | `HUMAN_REJECTED` only | `APPROVAL_STATE_MISMATCH` (error) |
| approval `consumed` | no approval event | warning (less authority) |
| approval `pending` | `HUMAN_APPROVED` | `STATE_BEHIND_EVENTS` (warning) |
| a stream event | an illegal transition (`CANCELLED → CONFIRMED`, `COMPLETED → PROPOSED`, …) | `INVALID_TRANSITION` (error) |
| `HUMAN_APPROVED`/`HUMAN_REJECTED` event | no valid human owner | `HUMAN_OWNER_INVALID` (error); such an event approves nothing |
| trace line | hash differs from the committed hash / missing / uncommitted | `TRACE_HASH_MISMATCH`, `TRACE_MISSING` (errors) / `TRACE_UNCOMMITTED` (warning, not evidence) |
| `TOOL_EXECUTED` | cites an authorization that does not authorize it | `AUTHORIZATION_LINK_INVALID` (error) |

## Ordering that makes the rule safe (event first)

Authority-granting writes are now **event first, state second**: `confirmRequest`, `cancel/completeRequest`, `decide`. A crash in between leaves the state *behind* its events (warning, grants nothing) rather than ahead of them (which would be INCONSISTENT and indistinguishable from tampering). Approval *consumption* stays state-first (it only removes authority); `openRequest` stays state-first (a stray `PROPOSED` only closes the floor).

## The state machine

REQUEST: `PROPOSED → CONFIRMED → COMPLETED`, `PROPOSED|CONFIRMED → CANCELLED`, `PROPOSED → EXPIRED|SUPERSEDED|BLOCKED`. Everything else is illegal (`isValidRequestTransition`, `src/shared/lapitaya/governanceIntegrity.ts`; table-tested in EVENT-22, enforced when events are applied, and by the runtime at confirm/cancel/complete).
Every human decision is an event with the runtime-resolved owner: `REQUEST_CONFIRMED`, `REQUEST_CANCELLED`, `REQUEST_COMPLETED`, `HUMAN_APPROVED`, `HUMAN_REJECTED`. `decide`/`confirm`/`cancel`/`complete` now **refuse** a call without a well-formed trusted human context (`NOT_AUTHORIZED` / `null`): a human decision without a human is not a decision. (v0.8 accepted "absent = legacy caller"; the in-process legacy path is closed.)

## Authorized ≠ executed ≠ succeeded

| Fact | Event | Written when |
|---|---|---|
| authorized | `AUTHORIZATION_GRANTED` (ALLOW/SUPERVISED), `APPROVAL_CONSUMED` (APPROVED) | PreToolUse decision |
| executed | `TOOL_EXECUTED` | PostToolUse reported the call ran (`ok: true`) and the trace was committed |
| failed | `TOOL_FAILED` | PostToolUseFailure / interrupted (`ok: false`) |
| succeeded (for CIMA) | a `PASS` record, only if the evidence is a *successful* committed trace | evaluateSubmission (v0.14: a failed run can back a FAIL, never a PASS) |

`TOOL_EXECUTED` carries `authorizationEventId` (the executable decision for the same agent and call fingerprint) — EVENT-23/24/25, Electron V2d.

## Legacy (v0.14) state — the explicit trust boundary

The first v0.15 write on a ledger without envelopes appends `LEDGER_MIGRATION_BOUNDARY`: its `previousEventHash` commits to the exact bytes of the legacy prefix, and it records `legacyEvents`, `legacyBytes`, `legacyDigest`, the `traces.jsonl` size/digest and the **baseline** statuses of every proposal and approval at that moment. Legacy records are **trusted as found** (`LEGACY_UNVERIFIED`, shown to the human), never re-labelled as original v0.15 events; from the boundary on they are tamper-evident (EVENT-32). Reconciliation of legacy-era state uses the baseline instead of events that were never written.
