# documentation consistency — findings (not corrected)

1. docs/LA_PITAYA_CIMA_RUNTIME_10_AUTHENTICITY.md:31 says message transport (`send()` and `routeOnce()`) replaced folder/name-derived authority with runtime-verified actor context and that impersonation is denied (`NOT_AUTHORIZED`/`IDENTITY_UNTRUSTED`). Code: hive.ts:1829 still sets `msg.from` from the outbox directory; `IDENTITY_UNTRUSTED` exists only in hooks.ts; `hive:send` trusts the renderer-supplied `from` (index.ts:3567). → claim not implemented for the message channel.
2. v0.11 doc risk #4 and v0.12 doc "Remaining risks" describe FNV-32 as a correlation / "very large trace sets" collision risk. Code: FNV-32 is the approval binding, the REQUEST-gate exemption set and the proposal tamper check (probe2 P1). → risk mischaracterised.
3. v0.12 doc §table: traces.jsonl "Ignores bad lines/marks corrupted" — code marks corrupted (fail-closed); "Truncates to in-memory limit" is memory only, the file is unbounded.
4. v0.12 doc "Expired items ... cannot be ... approved, or executed" and TTL: applies to `pending` approvals only; `approved` unconsumed never expire (probe1 P7).
5. v0.12 doc "Multiple runtime instances ... synchronize using file-based locking ... prevents lost updates": lock is fail-open after 5 immediate attempts (probe1 P4) and read-only methods are unlocked/stale (probe2 P5b).
6. v0.12 doc "Concurrent ledger append safe / multi-instance protected" are backed by single-process sequential tests.
7. v0.12 report "Pre-existing failures: 0": see tests/findings.md T-1 (93 failing legacy tests on HEAD).
8. Governance code comment cimaRuntime.ts header lists three persistence files "approvals.json"... but proposals.json is also written; header predates v0.4.2 (minor).
9. docs/ALICIA/ holds only a README; Alicia architecture lives in docs/LA_PITAYA_ALICIA_*.md (not cross-checked line by line in this review).
