# baseline

- HEAD = 3e6ae0c8 (see head.txt), branch lapitaya/cima-v0.12-state-integrity-recovery, working tree clean at start.
- Files read for the review: src/main/cimaRuntime.ts, hooks.ts, intentBoundary.ts, humanGovernanceIpc.ts, humanIdentity.ts, hive.ts (token registry, spawn, router, task gates), index.ts (IPC, wiring), src/shared/lapitaya/{governance,toolRisk,autonomy,cimaRuntime,cima,intent,identity,providerGovernance}.ts, alicia/observability.ts (header), test/*.cjs (structure), docs v0.10–v0.12.
- Executed: probes in tests/probes (temp hives only); `node --test test/lapitaya-*.test.cjs`; per-suite runs of v0.10/v0.11/v0.12.
- NOT executed: typecheck, build, Electron, any provider CLI, real hook sockets, multi-process contention.
- Only additions under evidence/lapitaya-cima-v0.13-architecture-review/ and docs/LA_PITAYA_CIMA_RUNTIME_13_ARCHITECTURE_MATURITY_REVIEW.md.
