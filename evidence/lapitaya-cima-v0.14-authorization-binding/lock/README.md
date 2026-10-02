# Lock behaviour (v0.14)

**Reproduced on v0.12 first** (`../baseline/repro_pre_fix.txt`, R4): with another process holding a fresh `.governance.lock`,
`authorize()` returned `ALLOW` in 2–6 ms and left the foreign lock in place. The v0.12 loop made 5 immediate attempts and then ran
**without the lock** (`acquired=false`) — it failed open. Reviewer finding confirmed.

**v0.14** (`withLock`, `src/main/cimaRuntime.ts`):

| | v0.12 | v0.14 |
|---|---|---|
| not acquired | runs anyway | **the operation does not run**; the caller returns its own refusal |
| waiting | 5 immediate retries | bounded wait with back-off (default 3 s, `lockTimeoutMs`) |
| refusal shape | — | `authorize` → `DENY LOCK_UNAVAILABLE` (or `LEDGER_UNAVAILABLE` if the state dir cannot even hold a lock file); `evaluateProposedCall` → DENY; `openRequest`/`decide`/`recordTrace`/`recordIntent`/`attributeRequest` → null/false; `confirmRequest`/`closeRequest` → `{ok:false, code:'LOCK_UNAVAILABLE'}`; `submit`/`handle` → `BLOCKED` + `STATE_UNAVAILABLE` |
| ownership | none | the lock file holds `pid:random`; **only the owner removes it** (a stale-stolen lock is never deleted out from under its new holder) |
| stale | mtime > 5 s → delete | same threshold (real clock), delete then re-acquire |
| re-entrancy | `lockDepth` | unchanged; `lockDepth` is set only when the lock was actually acquired |
| expiry writes | unlocked readers could write | persisted only by the lock holder |

Tests (`test/lapitaya-cima-v0.14.test.cjs`): `AUTHBIND-27` (foreign lock → DENY, lock untouched, every state-changing entry point refuses),
`27b` (stale lock recovered), `27c` (**real second process** holds the lock for 0.9 s; the runtime waits, then proceeds),
`27d` (**three real processes × 15 governed calls** with a shared hive: 45 decisions + 45 traces, every line valid JSON, none glued, no lock left behind).
Not covered: fairness (none), cross-host locking (non-goal).
