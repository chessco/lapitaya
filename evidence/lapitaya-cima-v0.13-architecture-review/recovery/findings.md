# recovery — findings

Fail-closed ≠ recovery. What the code does:
- Startup/first load: reads files, marks `corruptedFiles`, runs `checkExpirations` (skipped while corrupted). Does not delete or repair anything (cimaRuntime.ts:207-304).
- Atomic write leaves `*.tmp.<hex>` on crash; nothing removes them (accumulate; harmless).
- No routine for: truncated ledger tail, state-vs-ledger divergence (STATE-24 only asserts an orphan proposal does not become executable), consumed approval without ledger record, tasks.json drift.
- Probe: a truncated final ledger line yields a permanent DENY for all agents on all instances (probe1 P6). The only exit is a human editing the file; the next append otherwise corrupts one more record (probe2 P6b).
- Must never be auto-reconstructed: DECISION/PASS facts, approvals, human confirmations (the code agrees: STATE-25/26/29). Reconstructable in principle (INFERENCE): proposal/approval status from ledger transitions, only if events had ids and ordering (see state/findings ST-3).
