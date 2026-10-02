# failure — matrix source data

Verified by probe unless marked CODE.

| Failure | Behaviour | Fail closed? | Evidence |
|---|---|---|---|
| missing hive root / identity | `GOVERNANCE_STATE_UNAVAILABLE` / `ACTOR_CONTEXT_MISSING` | yes | CODE cimaRuntime.ts:374-375 |
| invalid / missing token | `IDENTITY_UNTRUSTED` (hook path only) | yes | probe5: legacy fixture gets IDENTITY_UNTRUSTED |
| claimed id, **no tokens registered at all** | falls back to the claimed id | NO (by design: `hasRegisteredTokens()` false) | CODE hooks.ts:225-230 |
| classifier throws / invalid | `RISK_CLASSIFICATION_UNAVAILABLE` | yes | CODE governance.ts:139-146 |
| ledger write fails on a decision | `LEDGER_UNAVAILABLE`, approval reverted | yes | CODE cimaRuntime.ts:434-440 |
| ledger write fails on transition / trace / human decision record / CIMA record / blocked-completion | ignored (`append` return not checked) | NO | CODE :539, :853, :890, :913, :926, :777 |
| corrupt ledger tail | all authorize() DENY, all instances, no repair path | yes (and no recovery) | probe1 P6 |
| corrupt proposals/approvals | DENY / refuse | yes | CODE :379-381, :555 |
| submit()/handle() under corrupt state | evaluates and appends anyway | NO | probe1 P6 |
| expired pending approval/proposal | `expired`/`EXPIRED`, call re-asks | yes | probe2 P11 |
| approved-but-unconsumed approval, 30 days old | still `APPROVED` | NO (no TTL) | probe1 P7 |
| concurrent runtime, fresh lock held | proceeds without the lock, leaves the lock | NO | probe1 P4 |
| stale lock (>5 s mtime) | deleted then re-acquired (no owner/pid) | partially | CODE :171-178 |
| crash mid state write | stale `*.tmp.*` ignored, never cleaned | yes | CODE :339; test STATE-23 |
| provider without blocking bridge | not spawned unless human opt-out | yes (opt-out is a config flag) | CODE providerGovernance.ts:47-65 |
| shell classification failure (indirect/obfuscated) | MEDIUM `shell-command` | NO | probe1 P9 |
| renderer failure | n/a to authorization (renderer holds no authority) | n/a | CODE humanGovernanceIpc.ts |
| invalid transition | `NOT_CONFIRMABLE` / null | yes | CODE :643, :689, :837 |
