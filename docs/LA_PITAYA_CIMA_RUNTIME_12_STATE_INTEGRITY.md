# LA PITAYA — CIMA v0.12: STATE INTEGRITY, DURABILITY & RECOVERY

## 1. EXECUTIVE SUMMARY

CIMA v0.12 hardens La Pitaya's governance state against filesystem crashes, corrupted ledger/state files, lost updates under multi-instance access, stale approvals/proposals, and partial writes.

Key achievements:
- **Atomic JSON State Writes**: `writeState()` uses process/random-isolated temporary files (`.tmp.${randomBytes(4).toString('hex')}`), `writeSync`, `fsyncSync`, and atomic `renameSync`.
- **Durable Ledger Writes**: `append()` uses `openSync`, `writeSync`, `fsyncSync`, and `closeSync` to guarantee durability, propagating failures cleanly (`LEDGER_UNAVAILABLE`).
- **Corruption Fail-Closed Enforcement**: Unparseable or malformed JSON in `cima-ledger.jsonl`, `traces.jsonl`, `proposals.json`, or `approvals.json` marks the file corrupted in `corruptedFiles`, forcing governance calls, execution gates, and completion gates to fail closed (`GOVERNANCE_STATE_CORRUPT`).
- **Expiration Policy**: Enforces 24-hour TTL for `PROPOSED` requests and `pending` approvals. Expired items transition to `EXPIRED` status and cannot be confirmed, approved, or executed.
- **Multi-Instance Locking**: Re-entrant file locking (`.governance.lock`) with 5-second stale-lock auto-recovery prevents lost updates and race conditions across multiple processes.
- **Verification**: 38/38 v0.12 dedicated tests PASS, 31/31 v0.10 tests PASS, 25/25 v0.11 tests PASS, TypeScript typecheck PASS, Build PASS.

---

## 2. BASELINE

- **Baseline Branch**: `lapitaya/cima-v0.11-governance-coverage-hardening`
- **Baseline Commit**: `00ab8202`
- **Active Branch**: `lapitaya/cima-v0.12-state-integrity-recovery`
- **Authenticity Guarantees**: Preserved all v0.10 identity authenticity and v0.11 governance coverage guarantees.

---

## 3. THREAT MODEL

The threat model assumes:
- `AGENT = ACTOR`
- `CIMA RUNTIME = GOVERNANCE AUTHORITY`
- `HUMAN = HUMAN GOVERNANCE AUTHORITY`
- `FILESYSTEM / PROCESS CRASH = FAILURE CONDITION`
- `MULTI-INSTANCE RUNTIME = CONCURRENT ACTOR`

The runtime does NOT assume writes are atomic or succeed by default, nor that files are never corrupted or truncated. All unresolvable state inconsistencies fail closed.

---

## 4. STATE INVENTORY

| File | Owner | Writer | Reader | Authority | Recovery Behavior | Corruption Behavior | Concurrency Behavior |
|------|-------|--------|--------|-----------|-------------------|---------------------|----------------------|
| `cima-ledger.jsonl` | Runtime | Runtime | Runtime | High | Re-reads append log | Fails closed (`GOVERNANCE_STATE_CORRUPT`) | Locked via `.governance.lock` |
| `traces.jsonl` | Runtime | Runtime | Runtime | High | Truncates to in-memory limit | Ignores bad lines/marks corrupted | Locked via `.governance.lock` |
| `proposals.json` | Runtime | Runtime | Runtime / UI | High | Re-reads array | Fails closed (`GOVERNANCE_STATE_CORRUPT`) | Locked via `.governance.lock` |
| `approvals.json` | Runtime | Runtime | Runtime / UI | High | Re-reads array | Fails closed (`GOVERNANCE_STATE_CORRUPT`) | Locked via `.governance.lock` |
| `tasks.json` | Hive | Agent / Runtime | Agent / Runtime | High (Gated) | Re-reads task array | Gate denies unreadable ledger | Protected via task ledger write gate |

---

## 5. DURABILITY

Critical writes in `CimaRuntimeService` (`append` and `writeState`) issue `fsyncSync` to flush kernel buffers to non-volatile storage before returning `true`. Failed writes propagate `false` to callers, causing authorization to return `LEDGER_UNAVAILABLE` or `DENY`.

---

## 6. ATOMIC WRITES

`writeState(file, value)` follows the sequence:
1. Serialize JSON.
2. Open unique tmp file: `${file}.tmp.${randomBytes(4).toString('hex')}`.
3. Write payload with `writeSync`.
4. Flush buffers with `fsyncSync`.
5. Close file handle with `closeSync`.
6. Atomic `renameSync(tmp, file)`.

If any step fails, the existing target file remains untouched.

---

## 7. LEDGER INTEGRITY

- `append()` writes single newline-delimited JSON entries with `fsyncSync`.
- If an append operation fails, `authorize()` returns `denyAuthorization('LEDGER_UNAVAILABLE', ...)`.
- Malformed or truncated ledger entries encountered during `load()` add `cima-ledger.jsonl` to `corruptedFiles`.

---

## 8. PROPOSAL INTEGRITY

- Proposals are gated by FNV-32 fingerprints and single-use confirmation tokens.
- Malformed `proposals.json` causes `openRequest()`, `confirmRequest()`, and `authorize()` to fail closed (`GOVERNANCE_STATE_CORRUPT`).

---

## 9. APPROVAL INTEGRITY

- One-shot approval consumption: `a.status = 'consumed'` must be persisted via `saveApprovals()` BEFORE the call runs. If `saveApprovals()` fails, status reverts to `'approved'` and the call is DENIED (`LEDGER_UNAVAILABLE`).
- Malformed `approvals.json` causes `authorize()` to fail closed.

---

## 10. EXPIRATION

- `REQUEST_PROPOSAL_TTL_MS`: 24 hours (86,400,000 ms).
- `APPROVAL_REQUEST_TTL_MS`: 24 hours (86,400,000 ms).
- Proposals and approvals older than 24h transition to `EXPIRED` / `expired`.
- Neither agents, providers, nor renderer payloads can extend or bypass expiration.

---

## 11. MULTI-INSTANCE

Multiple runtime instances operating on the same Hive directory synchronize using file-based locking (`.governance.lock`).
Mutative methods reset `loadedFor = null` upon acquiring lock to guarantee fresh reads from disk.

---

## 12. LOCKING

- Lock File: `<hive>/lapitaya/.governance.lock`.
- Acquisition: `openSync(lockPath, 'wx')`.
- Re-entrancy: Tracked via `lockDepth` counter in `CimaRuntimeService`.
- Stale Lock Recovery: Locks older than 5,000 ms (`STALE_LOCK_MS`) are automatically purged on startup/acquisition.

---

## 13. CRASH RECOVERY

- On startup/reload, state files are parsed.
- Stale `.tmp.*` files are ignored.
- Unlinked or missing governance records never invent facts: missing DECISION or missing trace evidence results in `allowed: false` or `verdict: BLOCKED`.

---

## 14. STATE MACHINES

Enforced transitions:
- **REQUEST**: `PROPOSED` → `CONFIRMED` | `CANCELLED` | `EXPIRED` | `SUPERSEDED` | `BLOCKED`
- **REQUEST**: `CONFIRMED` → `COMPLETED` | `CANCELLED`
- **Approval**: `pending` → `approved` | `rejected` | `expired` | `consumed`

Illegal state transitions (e.g. `CANCELLED` → `CONFIRMED`, `EXPIRED` → `CONFIRMED`, `rejected` → `approved`) are strictly rejected.

---

## 15. IDEMPOTENCY

- Confirming a request twice returns `NOT_CONFIRMABLE` on the second attempt.
- Deciding an approval twice returns `null` on the second attempt.
- Cancelling after approval or confirmation cleanly transitions state without duplicating authority.

---

## 16. ADVERSARIAL TESTS

- `ADVERSARIAL-01`: Corrupting `proposals.json` blocks proposal creation and execution after restart (`GOVERNANCE_STATE_CORRUPT`).
- `ADVERSARIAL-02`: Corrupting `approvals.json` blocks HIGH tool authorization after restart.
- `ADVERSARIAL-03`: Deleting DECISION evidence from `cima-ledger.jsonl` blocks task `DONE` transition after restart.

---

## 17. REGRESSION

| Test Suite | Total Tests | Passed | Failed | Status |
|------------|-------------|--------|--------|--------|
| `lapitaya-cima-v0.10.test.cjs` | 31 | 31 | 0 | PASS |
| `lapitaya-cima-v0.11.test.cjs` | 25 | 25 | 0 | PASS |
| `lapitaya-cima-v0.12.test.cjs` | 38 | 38 | 0 | PASS |

- **Typecheck**: PASS (`npm run typecheck`)
- **Build**: PASS (`npm run build`)
- **Pre-existing Failures**: 0
- **New Regressions**: 0

---

## 18. ELECTRON VALIDATION

- Main process CimaRuntimeService unit test suite executes cleanly without electron GUI dependencies.
- Human IPC boundary (v0.8 context) enforces trusted DecisionOwner context across main process IPC handlers.
- Renderer authority is 0: renderer cannot confirm proposals, decide approvals, or alter timestamps directly.

---

## 19. REMAINING RISKS

- **Cryptographic Evidence Hashing**: Ledger correlation uses FNV-32 fast hash rather than SHA-256 cryptographic signatures. This is documented and left for a future dedicated slice.

---

## 20. NON-GOALS

The following were explicitly excluded from v0.12:
- Distributed database or Redis locking.
- Remote governance API service.
- PostgreSQL migration.
- New CIMA phases or risk levels.
- UI or Alicia redesign.

---

## 21. FILES CHANGED

- `src/shared/lapitaya/intent.ts`: Added `'EXPIRED'` to `REQUEST_STATUSES` union type.
- `src/main/cimaRuntime.ts`: Implemented `withLock`, atomic `writeState`, durable `append`, `checkExpirations`, `corruptedFiles` tracking, and fail-closed checks. Added `'EXPIRED'` to `RequestTransitionRecord`.
- `test/lapitaya-cima-v0.12.test.cjs`: Created dedicated test suite (38 tests).
- `evidence/lapitaya-cima-v0.12-state-integrity/`: Populated test evidence logs.
- `docs/LA_PITAYA_CIMA_RUNTIME_12_STATE_INTEGRITY.md`: Documentation artifact.

---

## 22. FINAL VERDICT

**VERDICT**: **PASS**

All state integrity, durability, locking, expiration, crash recovery, and fail-closed invariants are fully satisfied and verified by automated tests.
