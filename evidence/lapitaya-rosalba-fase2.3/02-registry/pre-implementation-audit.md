# FASE 2.3 — Pre-implementation audit (before any edit)

Base `b13585b2` · branch `lapitaya/desktop-companions-v0.2.3-rosalba-senior-developer`.

| # | SYSTEM | CURRENT SOURCE OF TRUTH | CHANGE REQUIRED | NO CHANGE REQUIRED |
|---|---|---|---|---|
| 1 | Canonical agent registry | `src/shared/lapitaya/agents.ts` · `LA_PITAYA_AGENTS` / `LA_PITAYA_AGENT_BY_ID` | add `rosalba` entry | — |
| 2 | Agent IDs | `LaPitayaAgentId` union (same file) | extend union with `'rosalba'` | — |
| 3 | Agent definitions (role, phases, prompt) | `LaPitayaAgent` (role · roleLabel · runtime · cimaPhases · character · description · goal) | Rosalba = `role: 'builder'`, `cimaPhases: ['BUILD']`, `runtime: 'hire-preset'`, sprite `pam`; optional `seniority`/title fields | `LaPitayaRole` union (no new role, no SENIOR authority) |
| 4 | Animal avatar registry | `desktopCompanions/animalAvatar.ts` · `ANIMAL_AVATAR_REGISTRY` (`Record<LaPitayaAgentId,…>`) | `AnimalSpecies` += `'dog'`; entry `rosalba → dog 🐶` | visual-state enum (reuse `ALL_VISUAL_STATES`) |
| 5 | Desktop Companion roster | `src/main/desktopPresence.ts` · `COMPANY_FILL_ORDER`, `getVisibleAgents`, `MAX_VISIBLE_COMPANIONS_DEFAULT = 3` | append `rosalba` to fill order; presentation carries the role title | max 3, MINI = Alicia only, relay mechanism |
| 6 | CIMA role model | `src/shared/lapitaya/cimaRuntime.ts` — Builder != Auditor by **identity** (`buildersOf(task)` vs submitting `agentId`), not by roster role | — | protected; Rosalba's worker id is covered automatically |
| 7 | Capability registry | `src/shared/lapitaya/policyRegistry.ts` (per provider / tool / operation, deep-frozen, no per-agent grants) | — | Rosalba gets exactly the worker capabilities; HIGH → HUMAN_APPROVAL unchanged |
| 8 | Spawn contract | `src/main/index.ts` `SpawnRequest` (`name`, `cima`, …) → `processSpawnRequest` → hive registry `agents[workerId].name` | none in code; PROTOCOL text documents `name: "Rosalba"` for senior BUILD | spawn path itself |
| 9 | Structured cima assignment | `src/main/spawnAssignment.ts` → `CimaRuntimeService.handle()` → `cima-assignment` (from, to=workerId, taskId, phase, hash, MAC) | — | no new event type, no parallel ledger |
| 10 | Runtime event mapping | `alicia/events.ts` `fromRuntimeEvent` (assignment `agentId = to`) → `desktopCompanions/runtimeFacts.ts` `companionFactsFromAliciaEvent` | **phase-only mapping** (`phaseOwner('BUILD')` = El Beni, text "El Beni está construyendo.") must honour the event's agent; resolver injected from main (hive registry name → `agentByName`) | event shapes, verdict semantics PASS/FAIL/BLOCKED |
| 11 | FOCUS selection | `desktopPresence.getVisibleAgents` → `activePhaseAgent` (set from the fact effect's `phaseAgent`) | follows the resolved agent (Rosalba) | pending-human → Alicia rule |
| 12 | COMPANY selection | same, recency + fill order, capped at 3 | fill order only | cap |
| 13 | i18n | `src/renderer/src/i18n/locales/lapitaya/{es-MX,en-US}.json` (`roles.<role>`) | add per-agent title `Desarrolladora Senior` / `Senior Software Developer` | role strings |
| 14 | Tests affected | `lapitaya-foundation` (hire preset list), `lapitaya-desktop-companions` (`phaseOwner('BUILD') = el-beni` must stay true), `lapitaya-alicia-v04` (phase owners exclude Alicia) | foundation preset list gains `rosalba` (intended roster change) | CIMA v0.14/v0.15/v0.16 |
| — | Office sprite | `src/renderer/src/scene/office/cast.ts` (`pam` unused by La Pitaya) | `pam` displays as Rosalba | sprite ids (persisted) |
| — | Protected governance | `cima.ts`, `cimaRuntime.ts` core, `intentBoundary.ts`, `humanGovernanceIpc.ts`, policy, ledger | — | **untouched** |

## Findings that shape the design

* F-A: governance never reads the La Pitaya roster → adding Rosalba needs **no** governance change (STOP condition 1 not triggered).
* F-B: `phaseOwner()` returns the *first* hire preset owning a phase. Inserting Rosalba before El Beni would silently move the default BUILD owner → the default owner must stay explicit (El Beni).
* F-C: BUILD presentation is hard-wired to El Beni (STOP condition 6 currently TRUE for any non-El-Beni builder). Fix in the presentation adapter only: the agent comes from the verified event (`agentId` = assignment `to` / record `agentId`), resolved through the hive registry name, never from text.
* F-D: unknown / unresolvable worker → keep the FASE 2.2 behaviour (phase default owner); an agent that does not own the phase is ignored (no cross-phase spoofing).
