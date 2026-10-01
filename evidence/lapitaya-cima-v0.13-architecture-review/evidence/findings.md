# evidence model — findings

- Evidence = ExecutionTrace (PostToolUse/PostToolUseFailure payload from the provider bridge → `recordTrace`) + CimaRecord (runtime verdict on an agent claim) + GovernanceRecord (decision) + Intent/Request records. Types in src/shared/lapitaya/cimaRuntime.ts:56-109.
- Correlation: GovernanceRecord.fingerprint == trace.fingerprint (FNV-32 of agent+tool+canonical input). Evidence verification for CIMA claims is textual: `verifyEvidence` substring-matches the cited command/path against this agent's traces in a time window (cimaRuntime.ts shared :236-257).
- Reproducible/auditable: yes for decisions (deterministic pure functions + ledger). Immutable "enough": no — append-only by convention only (no chain, no signature, no OS protection beyond classifier).
- Auditability gap: `consumed` approvals and state→ledger ordering failures leave no ledger record; WHO/WHAT/WHEN/RISK/RULE/RESULT/HUMAN are present on decisions; WHY for approvals is only `summary` (the classifier line).
- Provider coupling: traces classify `kind: 'command'` only for tool names Bash|PowerShell (cimaRuntime.ts:868); `shell`/`run_shell_command` become `tool` (probe4) → those providers' command-evidence claims end BLOCKED/EVIDENCE_FIRST.
- FNV: see report §31.
