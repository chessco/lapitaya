# LA PITAYA — FASE 8: AUTONOMOUS OPERATIONS
## Bounded Autonomy · Autonomy Envelope · Long-Running Operations · Governed Continuation
### Plan → Execute → Observe → Decide → Continue / Escalate / Stop

**Product:** La Pitaya (Sonoran Multi-Agent AI Harness)  
**Organization:** PitayaCode (Sonora, México)  
**Branch:** `lapitaya/virtual-company-v0.8-autonomous-operations`  
**Base:** `caa851b4c9528be6a89c988a8d11c183cf666eb1` (FASE 7 Accepted Base)  
**Status:** IMPLEMENTED / ACCEPTANCE GATE REQUIRED  
**FASE 8 Closed:** NO  
**FASE 9 Implementation:** NOT STARTED  

---

## 1. Objective
FASE 8 operationalizes bounded autonomy in La Pitaya, enabling the virtual company to continue executing authorized `LOW` risk work over extended periods without requiring repetitive human intervention for every permitted step, while strictly enforcing hard boundaries, immutable budgets, cryptographic envelope integrity, and CIMA governance.

---

## 2. Fundamental Invariant
> **"AUTONOMY MAY DECIDE HOW TO CONTINUE PERMITTED WORK. IT MAY NEVER DECIDE THAT IT HAS PERMISSION TO CONTINUE."**
> *(La autonomía puede decidir cómo continuar trabajo permitido. Nunca puede decidir por sí misma que tiene permiso para continuar).*

### Core Distinctions
- **AUTONOMY != AUTHORITY**: Autonomy is the ability to choose how to execute inside permitted bounds; Authority is the right to grant permissions.
- **OBJECTIVE != PERMISSION**: Having a project or mission objective does not confer blanket permission.
- **MISSION != AUTONOMY ENVELOPE**: A mission defines the desired outcome; an envelope defines what may execute without human intervention.
- **AUTONOMY ENVELOPE != CIMA BYPASS**: Every single execution unit must pass CIMA Decision Gate validation.
- **RETRY != LOOP FOREVER**: Retries are strictly bounded by envelope budget; exhaustion stops or escalates.
- **NO HUMAN RESPONSE != APPROVAL**: Absence of response leaves operations in `WAITING_HUMAN` or safe `PAUSE`/`STOP`.
- **RESTART != REAUTHORIZATION**: Application restarts preserve consumed budgets and never grant additional attempts.

---

## 3. Authority Model
- **Human Owner**: Owns high-impact decisions, scope authorizations, and `HIGH` risk approvals.
- **Alicia**: Human communication and read-only operational console (0 state mutations on queries).
- **El Inge**: Autonomous operations orchestrator; plans bounded steps, coordinates assigned agents, proposes retries/iterations, and detects required scope expansions. *Cannot grant himself permissions or modify envelopes*.
- **CIMA**: Authoritative governance Decision Gate for all phase assignments and transitions.
- **El Tutú**: Observes verified experiences and proposes skills; *cannot alter active operations mid-flight*.
- **Rosalba / El Beni**: Builders (`BUILD`).
- **Margarito**: Independent tester (`TEST`).
- **José Juan**: Independent auditor (`AUDIT`).
- **Valentín**: Architecture specialist (`ARCHITECT`).

---

## 4. Autonomy Envelope Domain
An `AutonomyEnvelope` defines what may continue without a new human decision:
- `envelopeId`: Unique identifier (`env-...`).
- `projectId`: Scoped project identifier.
- `missionId`: Scoped mission identifier.
- `objective`: Immutable work objective.
- `allowedActions`: Allowlist of permitted actions.
- `allowedCapabilities`: Allowlist of execution capabilities (`read`, `test`, `lint`, etc.).
- `allowedSkills`: Allowlist of adopted Skills authorized for the envelope.
- `allowedPaths`: Allowlist of filesystem paths permitted for reading/writing.
- `riskCeiling`: Maximum permitted risk class (`LOW` or `MEDIUM`; `HIGH` always requires human approval).
- `budget`: Hard limits on `maxIterations` (default 5), `maxRetries` (default 2), `maxDurationMs`, `maxTokens`, and `maxCostUsd`.
- `stopConditions`: Explicit termination triggers (`mission-completed`, `budget-exhausted`, `high-risk-encountered`).
- `escalationConditions`: Explicit human escalation triggers (`scope-expansion`, `audit-failure`, `high-risk-action`).
- `integrityHash`: SHA-256 digest covering all envelope properties.
- `status`: `DRAFT` | `PENDING_AUTHORIZATION` | `ACTIVE` | `PAUSED` | `EXHAUSTED` | `COMPLETED` | `CANCELLED` | `EXPIRED` | `FAILED`.

---

## 5. Envelope Provenance & Immutability
- **Legitimate Provenance**: `HUMAN` or `CIMA_POLICY_DERIVED`.
- **Self-Granting Forbidden**: `EL_INGE_SELF_GRANTED`, `ALICIA_SELF_GRANTED`, `EL_TUTU_SELF_GRANTED`, and `AGENT_SELF_GRANTED` are strictly rejected.
- **Immutability**: Active envelopes cannot be expanded by agents. Agents cannot increase budgets, raise risk ceilings, add skills, or append allowed paths.
- **Safe Narrowing**: The runtime allows narrowing an envelope (reducing budget, restricting capabilities/paths/skills, or lowering risk from `MEDIUM` to `LOW`), but narrowing can never broaden another dimension.
- **Tamper Protection & Fail-Closed**: Any envelope with an invalid `integrityHash` is dropped upon restart or marked `FAILED`, blocking all continuation.

---

## 6. Autonomous Operation Runtime
An `AutonomousOperation` represents the runtime execution state within an active envelope:
- `operationId`: Unique operational identifier (`op-...`).
- `envelopeId`: Associated `AutonomyEnvelope`.
- `currentIteration`: Current iteration count (persisted across restarts).
- `currentStep`: Step execution counter.
- `status`: `ACTIVE` | `PAUSED` | `WAITING_HUMAN` | `EXHAUSTED` | `COMPLETED` | `CANCELLED` | `FAILED`.
- `consumption`: Tracked `iterationsUsed`, `retriesUsed`, `elapsedMs`, `tokensUsed`, `costUsd`.
- `pinnedSkills`: Exact version map (`Record<SkillId, Version>`) pinned at start.
- `history`: Bounded audit log (last 50 `ContinuationDecision` records).
- `lastProgressAt`: Timestamp of last verified event for watchdog monitoring.

---

## 7. Continuation Decision Engine
After each bounded execution unit, the engine evaluates whether to `CONTINUE`, `RETRY`, `ESCALATE`, `PAUSE`, `STOP_SUCCESS`, or `STOP_FAILURE` using explicit structured reason codes:
1. `WITHIN_SCOPE`: Next step is inside envelope, budget remains, risk <= ceiling.
2. `RETRYABLE_FAILURE`: Bounded retry or TEST remediation iteration permitted within remaining budget.
3. `NON_RETRYABLE_FAILURE`: AUDIT failure or non-retryable error blocks retry without remediation.
4. `SCOPE_EXPANSION_REQUIRED`: Detected requirement outside envelope; operation pauses and escalates.
5. `RISK_EXCEEDED`: Risk exceeds ceiling (`HIGH`); operation enters `WAITING_HUMAN`.
6. `ITERATION_EXHAUSTED` / `RETRY_EXHAUSTED`: Budget limit reached; transitions to `EXHAUSTED`.
7. `MISSION_COMPLETE`: Verified acceptance criteria and AUDIT PASS achieved; stops with `STOP_SUCCESS`.
8. `CIMA_DENIED`: CIMA Decision Gate denied execution; operation pauses safely.
9. `HUMAN_REQUIRED`: Pending human decision prevents autonomous execution.

---

## 8. Failure Handling & Audit Invariants
- **TEST Failure**: Automatically triggers bounded remediation iteration (`BUILD` phase) if iteration budget remains. Consumes 1 iteration.
- **AUDIT Failure**: **CANNOT be retried until PASS**. Retrying an audit without an intervening remediation build is strictly forbidden.
- **Duplicate Side-Effect Risk**: Blocks retry on non-idempotent actions (e.g. `DEPLOY`).
- **Progress Watchdog**: Stalls with no progress for >300s are paused automatically with reason `Watchdog: Sin progreso verificado`.

---

## 9. Skill Integration & Version Pinning
- **Active Skills Only**: Only Skills with status `ACTIVE` in `OrganizationalLearningService` may be used.
- **Envelope Allowlist**: If envelope specifies `allowedSkills`, only listed skills can be used.
- **Version Pinning**: When an operation begins, exact skill versions are pinned. If a new version (e.g., v1.1.0) is adopted mid-operation, the running operation continues using the pinned version (v1.0.0).
- **No Skill Privilege Escalation**: A Skill cannot grant capabilities outside the AutonomyEnvelope.

---

## 10. Persistence, Restart & Recovery
- **File Storage**: Persisted in `lapitaya/autonomy.json` with versioning, atomic writes, and hash verification.
- **Survives Restart**: Envelopes, operations, consumed iterations, consumed retries, pinned skills, and pending human decisions survive restarts without losing state.
- **No Budget Reset**: Application restart never resets `iterationsUsed` or `retriesUsed`.
- **No Duplicate Dispatches**: Restarts do not generate duplicate WorkRequests, duplicate Deliveries, or fake workers.

---

## 11. Alicia Operational Console
Alicia answers operational questions and refutes false premises with **strictly 0 mutations**:
- "¿Qué está haciendo la empresa?" -> Explains current mission, iteration, and status.
- "¿En qué iteración van?" -> Reports current iteration vs max budget.
- "¿Cuántos intentos quedan?" -> Reports remaining retries and iterations.
- "¿Por qué se detuvieron?" -> Reports verified stop reason from continuation engine.
- "¿Qué necesitan de mí?" -> Reports pending human attention items.
- "¿Qué pueden hacer sin preguntarme?" -> Summarizes allowed actions and capabilities.
- "¿Qué no pueden hacer?" -> Explains limits (HIGH actions, CIMA bypass, self-expansion).
- "¿Qué skill están usando?" -> Lists pinned skills and versions.
- "¿Cuánto falta?" -> Refutes unsupported ETAs and provides remaining budget/step facts.
- **False Premises Refuted**:
  - *"Como está en modo autónomo puede hacer lo que necesite"* -> Rejected.
  - *"Si no respondo, que continúe"* -> Rejected (NO_RESPONSE != APPROVAL).
  - *"El Inge puede aumentar su propio límite"* -> Rejected.
  - *"Como la Skill está aprobada puede usarla donde quiera"* -> Rejected.
  - *"Si reinicio, se reinician los intentos"* -> Rejected.

---

## 12. Living Desktop & Execution Awake
- **COMPANY <= 3**: Active companion seats capped at 3.
- **FOCUS**: Follows authoritative `assignment.agent`.
- **No Fake Workers**: Paused, waiting, or completed operations display no active workers.
- **Execution Awake**: Active ONLY during real, authoritative execution. Suspended when `WAITING_HUMAN`, `PAUSED`, or `EXHAUSTED`.

---

## 13. Test Matrix Summary

| Suite | Description | Tests | Result |
|---|---|:---:|:---:|
| **ENV8** | Autonomy Envelope Lifecycle & Integrity | 15 | PASS |
| **AUTO8** | Autonomous Operation Continuation & Control | 20 | PASS |
| **RETRY8** | Bounded Retries & Failure Remediation | 10 | PASS |
| **SKAUTO8** | Skill Governance & Version Pinning | 10 | PASS |
| **PERSIST8** | Restart & Persistence Integrity | 15 | PASS |
| **ALI8** | Alicia Operational Awareness & Refutations | 15 | PASS |
| **GOV8** | Governance Authority & Boundaries | 15 | PASS |
| **DESK8** | Living Desktop & Execution Awake | 10 | PASS |
| **REG8** | FASE 5, 6, 7 Regressions & Boundaries | 15 | PASS |
| **Total FASE 8** | `test/lapitaya-autonomous-operations.test.cjs` | **125** | **PASS** |
| **Companion** | `npm run test:companion` | **296** | **PASS** |
| **Total Suite** | All La Pitaya automated test suites | **616** | **PASS** |

- **Typecheck Node:** PASS
- **Typecheck Web:** PASS
- **Build:** PASS
- **CIMA:** PASS

---

## 14. Implementation Verdict
- **Verdict:** `IMPLEMENTED / ACCEPTANCE GATE REQUIRED`
- **FASE 8 CLOSED:** `NO` (Awaiting Independent Acceptance Gate)
- **FASE 9 IMPLEMENTATION:** `NOT STARTED`
