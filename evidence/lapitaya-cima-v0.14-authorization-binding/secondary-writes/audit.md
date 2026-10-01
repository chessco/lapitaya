# Secondary-write audit (v0.14)

Rule applied: **a write whose failure can invalidate a governance fact must propagate.** A write whose failure can only
leave the system with *less* authority (a gate stays closed, a call is denied) is kept best-effort and documented.

Reproduction on the v0.12 baseline (`../baseline/repro_pre_fix.txt`, section R5), ledger append failing with EIO:

```
R5 decide() with ledger down        ["approved"]       ← human approval recorded in approvals.json, no ledger record
R5 submit() with ledger down        ["PASS"]           ← verdict returned (and stamped on the message) though never recorded
R5 ledger has HUMAN_APPROVED?       false
```
After the fix (`../baseline/repro_post_fix.txt`): `decide() → null`, `approvals.json status → ["pending"]`, `submit() → BLOCKED/STATE_UNAVAILABLE`.

| # | Write | Method (cimaRuntime.ts) | v0.12 | v0.14 | Why |
|---|---|---|---|---|---|
| 1 | `HUMAN_APPROVED/REJECTED` ledger record | `decide` | result ignored | **propagates** — approval rolled back to `pending`, returns null | the approval would exist without durable evidence of who decided |
| 2 | approval consumption (state) | `authorize` | propagated | propagated, **sealed**, rolled back on failure | one-shot must be durable before the call runs |
| 3 | decision record of an executable call | `authorize` | propagated | propagated; the approval is **un-consumed** (re-sealed) when the record fails | "approval consumed + executed without durable evidence" cannot happen |
| 4 | pending-approval creation (state) | `requestApproval` | result ignored | **propagates** → `DENY LEDGER_UNAVAILABLE` | a request the human cannot see/decide must not be silently dropped |
| 5 | `CONFIRMED`, `CANCELLED`, `COMPLETED` transitions | `confirmRequest`, `closeRequest` | result ignored | **propagate** — proposal rolled back (confirmation token preserved), `LEDGER_UNAVAILABLE` | a human confirmation the ledger cannot evidence is not a confirmation |
| 6 | CIMA record (agent claim verdict) | `submit` | pushed in memory, result ignored | **propagates** → `BLOCKED` / `STATE_UNAVAILABLE`, not kept in memory | a PASS that is not recorded must not be stamped on the message |
| 7 | CIMA assignment | `handle` | pushed, result ignored | propagates (same record) | assignment makes a task "governed"; must be durable |
| 8 | execution trace | `recordTrace` | pushed first, result ignored | **only a durable trace is kept** (`null` otherwise) | evidence that vanishes on restart must not back a claim in memory |
| 9 | `PROPOSED`, `SUPERSEDED`, `BLOCKED`, `EXPIRED`, `REVALIDATED`, `CONFIRMATION_DENIED` transitions | `openRequest`, `withdrawRequest`, `checkExpirations`, `confirmRequest` | ignored | kept best-effort | each moves toward **less** authority (gate closed / call refused); a lost audit line cannot create authority |
| 10 | blocked-completion record | `recordBlockedCompletion` | ignored | kept best-effort | the completion is denied regardless |
| 11 | deny decision record | `authorize` (deny paths) | best effort | kept best-effort | the call is denied either way |
| 12 | intent record | `recordIntent` (called by IntentBoundary) | result ignored by the boundary | kept; the exempt call fingerprint is added **only if recorded** | an intent executes nothing; every call is re-authorized at PreToolUse |
| 13 | approval invalidation record | `vetApprovals` | n/a (new) | best-effort audit line | the approval is retired in state either way |
| 14 | ledger tail without a newline (crash mid-append) | `append` | next record glued to it (both lost) | next record starts a fresh line | `AUTHBIND-28b` |

Tests: `AUTHBIND-28` (1, 3, 5, 6, 8), `AUTHBIND-28b` (14), `AUTHBIND-27`/`27c`/`27d` (lock), v0.12 `STATE-02..04`.
Double fault not handled: if the rollback write itself fails after a ledger failure, state and ledger can diverge (documented in "Remaining risks").
