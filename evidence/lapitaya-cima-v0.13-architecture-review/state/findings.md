# state — findings

## ST-1 Stores and their writers (code-derived)
| Store | Writer | Atomic | Lock | Integrity check |
|---|---|---|---|---|
| lapitaya/cima-ledger.jsonl | CimaRuntimeService.append (cimaRuntime.ts:307) | append+fsync (no newline guard) | withLock (fail-open) | JSON.parse per line |
| lapitaya/traces.jsonl | same | same | same | same |
| lapitaya/proposals.json | writeState (tmp+fsync+rename, :334) | yes | same | JSON.parse + Array.isArray; FNV-32 fingerprint per proposal |
| lapitaya/approvals.json | writeState | yes | same | JSON.parse + Array.isArray |
| hive/tasks.json | HiveManager.writeJson (hive.ts:2791, plain writeFileSync) | NO | NOT the CIMA lock | none |
| hive/registry.json | atomicWriteJson (tmp+rename, no fsync) | rename only | none | none |

## ST-2 Single source of truth? — no. Same fact, several representations
- Proposal status: proposals.json (state) AND `kind:'request'` ledger transitions. State is written first; ledger append result is ignored (`transition()` :539). `probe`-less: code reading, cimaRuntime.ts:533-541.
- Approval status: approvals.json AND ledger `HUMAN_APPROVED/REJECTED` (decide(), :848 ignores append failure). `consumed` has no ledger record at all.
- Task done: tasks.json status vs ledger DECISION record; derived only at gate time.
- Authoritative today: the state JSON for execution gating; the ledger for CIMA phase facts (`records` are rebuilt from the ledger on every load()).

## ST-3 Event/state/transition
- No event id (ledger lines have no id/seq/prev-hash), ordering = file order + `ts` from the local clock, no replay function that rebuilds proposals/approvals from the ledger. Ids come from `now.toString(36)-seq` (`nextId`, :353) with `seq` per process.

## ST-4 Observed (probe1 P6, probe2 P6b)
- Truncated tail → every authorize() in every instance returns `DENY / GOVERNANCE_STATE_CORRUPT`; the next ledger append is glued to the truncated bytes (`append` writes `line + '\n'` with no check that the file ends in `\n`): 2 lines, 1 parseable, 1 line containing two records.
- `submit()/handle()` (cimaRuntime.ts:907-930) do not check `corruptedFiles` and append anyway.

## ST-5 Unlocked readers are stale across instances (probe2 P5b)
- `A.listApprovals()` and `A.cimaRecords()` returned 0 while disk had 1 (written by instance B); a fresh instance sees 1. `load()` early-returns when `loadedFor === dir` (cimaRuntime.ts:209); only `withLock` clears it. Unlocked callers: listApprovals, listRequests, completionGate, blockedCompletions, recentTraces, cimaRecords.

## ST-6 Cost (probe1 P8, per authorize(), ledger and traces both N lines)
2k lines total: 15.7 ms · 20k: 64.4 ms · 100k: 267.8 ms. `withLock` forces `loadedFor = null` so every governed call reparses both files. Ledger never rotates (only traces are trimmed in memory).
