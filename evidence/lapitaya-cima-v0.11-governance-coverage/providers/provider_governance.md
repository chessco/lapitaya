# Provider Spawn Governance Verification (CIMA v0.11)

## Objective
Verify that provider spawn capability decision (`spawnGovernanceDecision`) is directly connected to actual process spawn logic (`HiveManager.ensureAgent()` / `spawnInjection()`).

## Implementation Details
- Connected `spawnGovernanceDecision(provider, { allowUngoverned })` at the top of `spawnInjection()` in `src/main/hive.ts`.
- If `govDecision.allowed === false` (e.g. an unbridged provider like `kimi` or `copilot` attempting spawn without `allowUngovernedProviders: true`), spawn is blocked: logs `spawn_denied` and throws `LAPITAYA_GOVERNANCE_UNENFORCEABLE`.

## Q-CG4 Resolution
- **Q-CG4 (Non-blocking providers)**: Providers with `observe-only` or `none` enforcement cannot self-authorize. Spawning an ungoverned provider requires an explicit runtime configuration override (`allowUngovernedProviders: true`), which is logged and auditable.

## Test Suite Results
- `[COVERAGE-17] Provider governance is consulted during actual spawn`: Blocking providers allowed; unbridged providers rejected (**PASS**).
- `[COVERAGE-18] Blocking provider cannot execute without governance`: Spawning unbridged provider without override throws `LAPITAYA_GOVERNANCE_UNENFORCEABLE` (**PASS**).
- `[COVERAGE-19] Non-blocking provider cannot self-authorize`: Copilot rejected by default (**PASS**).
- `[COVERAGE-20] Explicit valid exception follows runtime policy`: Copilot allowed when `allowUngoverned: true` (**PASS**).
