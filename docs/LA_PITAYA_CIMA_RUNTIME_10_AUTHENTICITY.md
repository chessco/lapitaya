# LA PITAYA — CIMA v0.10: RUNTIME AUTHENTICITY HARDENING

## 1. Objective
The objective of CIMA v0.10 is to harden the runtime authenticity boundary across La Pitaya by establishing that identity and governance facts accepted by the runtime are authenticated by trusted execution context, rather than self-asserted by actors in untrusted payloads.

## 2. Threat Model
For purposes of CIMA governance:
- **Agent = Actor**: An agent is an actor whose identity and governance facts must be verified by the runtime. An agent may be fallible or adversarial with respect to governance claims.
- **CIMA Runtime = Verifier / Governance Authority**: The runtime verifies capability tokens and trusted execution contexts before trusting identity or governance claims.
- **Human = Human Governance Authority**: Human decision authority originates strictly from trusted v0.8 Electron IPC frames bound to verified `DecisionOwner` session contexts.

Identity and authority MUST NOT depend on trusting an actor's self-description.

## 3. Q1 Resolution (Governance Assumption)
An actor cannot establish its own governance authority merely by declaring `agent_id`, `phase`, `decision`, `PASS`, `human`, or `sender` in an untrusted payload. Governance must not depend on trusting an agent's self-description.

## 4. Baseline Vulnerability
Prior to v0.10, the Architecture Readiness Audit identified that while `authorize()` could deny unauthorized tool calls, governance inputs (hook socket frame `agent_id`, message transport folder/from fields, phase submission actor claims) were self-asserted by payload data without runtime capability verification. An adversarial agent could forge a passing CIMA chain (`BUILD PASS` → `TEST PASS` → `AUDIT PASS` → `DECISION PASS`) by claiming fictitious agent IDs or `actor: "human"`.

## 5. Hook Identity
Hook socket frames (`HookServer.handle`) no longer treat payload `agent_id` as authoritative. The runtime issues a cryptographically strong runtime capability token (`HIVE_AGENT_TOKEN`) when spawning an agent execution context. Hook socket frames must include `agent_token`. `HookServer` validates `agent_token` against `HiveManager.verifyAgentToken()`. Unauthenticated socket requests are rejected with `IDENTITY_UNTRUSTED` (`deny`).

## 6. Agent Identity
Agent identity is bound at task spawn time:
```text
TASK → AGENT ASSIGNMENT → TRUSTED EXECUTION CONTEXT (Token) → HOOK / MESSAGE → CIMA
```
Payload properties (`agent_id`, `from`, `actor`, folder names, file paths, conversation text) are non-authoritative metadata. The runtime enforces that `agent_token` resolves to the assigned agent identity.

## 7. Message Identity
Message transport (`send()` and `routeOnce()`) replaces folder/name-derived authority with runtime-verified actor context. When an agent attempts to send a message claiming `from: 'human'` or impersonating another agent, the runtime verifies the request sender. If untrusted, the message is denied (`NOT_AUTHORIZED` / `IDENTITY_UNTRUSTED`).

## 8. Human Identity
The runtime does NOT accept `actor: "human"` or payload `humanId` as sufficient evidence of human authority. Human DECISION authority requires a valid `DecisionOwner` context established via trusted v0.8 Electron IPC frames (`humanIdentity.resolve(_evt)`). Unauthenticated human decision claims produce `BLOCKED` verdicts with `DECISION_AUTHORITY` / `HUMAN_IDENTITY_REQUIRED` violations.

## 9. Role vs Identity
The runtime enforces a strict distinction between:
- **ROLE**: `human`, `agent`, `builder`, `auditor`, `architect`, `tester`, `learner`.
- **IDENTITY**: `humanId` (`hum-...`), `agentId`, `trusted execution identity`.

A role is a classification of action, not proof of identity.

## 10. Builder / Auditor Separation
The `Builder != Auditor` invariant is enforced using runtime-established assignment identity rather than self-declared role/actor strings. A Builder agent attempting to submit an `AUDIT` phase is rejected with `ROLES_MUST_BE_DISTINCT`. An Auditor agent attempting to submit a `BUILD` phase is rejected with `AGENT_NOT_ASSIGNED`.

## 11. CIMA Phase Authenticity
The CIMA phase pipeline remains: `CONTEXT`, `ARCHITECT`, `BUILD`, `TEST`, `AUDIT`, `LEARN`, `DECISION`, `ITERATE`. An actor cannot manufacture phase passes (`BUILD PASS`, `TEST PASS`, `AUDIT PASS`, `DECISION PASS`) without trusted capability tokens, assigned agent roles, and valid execution traces.

## 12. Fail-Closed Behavior
If trusted identity cannot be established or verified:
```text
NO TRUSTED IDENTITY → DENY / BLOCKED → EVIDENCE OF DENIAL
```
The runtime never assumes default trust, fallback identities, or payload assertions upon missing context.

## 13. Error Handling
Deterministic governance error codes are returned:
- `IDENTITY_UNTRUSTED`: Missing or unverified capability token / context.
- `IDENTITY_MISMATCH`: Payload identity conflicts with token/assignment context.
- `ACTOR_CONTEXT_MISSING`: Required actor context not present.
- `HUMAN_IDENTITY_REQUIRED`: Action requires trusted human IPC context.
- `DECISION_AUTHORITY`: Invalid or unauthenticated human decision claim.
- `ROLES_MUST_BE_DISTINCT`: Builder attempting Auditor phase or vice-versa.
- `NOT_AUTHORIZED`: Untrusted human IPC request rejected.

No internal stack traces, secret keys, or raw tokens are exposed.

## 14. Evidence
Governance records identify actors using runtime-established identity (`agentId`, `decidedOwner`). Capability tokens are sanitized before recording evidence. Evidence directory: `evidence/lapitaya-cima-v0.10-authenticity/`.

## 15. Security Boundary
The security boundary enforces that:
```text
ACTOR → TRUSTED EXECUTION CONTEXT → IDENTITY VERIFICATION → CIMA GOVERNANCE → EVIDENCE → DECISION
```
An actor may request governance, but an actor may not define its own identity or governance authority.

## 16. Tests
Dedicated test suite `test/lapitaya-cima-v0.10.test.cjs`:
- 31 test cases covering `AUTH-01` through `AUTH-30` and `ADVERSARIAL-CHAIN`.
- **Result**: 31 PASS / 0 FAIL.

## 17. Regression
Existing test suites covering Foundation v0.1 through Alicia v0.9 executed with 0 new regressions.

## 18. Typecheck
`npm run typecheck` passed cleanly (0 errors across `typecheck:node` and `typecheck:web`).

## 19. Build
`npm run build` completed successfully without errors.

## 20. Electron Application Validation
Validated Electron main process IPC handlers (`hive:send`, `hive:confirmRequest`, `hive:cancelRequest`, `hive:decide`, `hive:whoAmI`) and hook server. Real Electron human decisions succeed over trusted IPC; untrusted renderer claims fail closed.

## 21. Remaining Risks
The following risks are explicitly documented as out of scope for v0.10 and reserved for future hardening slices:
1. **Provider Spawn Governance**: `spawnGovernanceDecision()` is not connected to actual provider process spawn.
2. **Shell Redirection / Classifier**: Shell classifier redesign for redirection operators (`echo x > tasks.json`).
3. **Evidence Success Correlation**: Correlation between command execution and actual process termination success.
4. **Completion Coverage for Non-CIMA Tasks**: Task completion tracking for external workflows.
5. **Ledger Durability & Retention**: Compaction and retention policy for long-term ledger storage.
6. **Proposal / Approval Expiration**: Expiration timers for pending proposals and approvals.
7. **Multi-Instance Hive Protection**: Locking across concurrent application instances.
8. **FNV 32-bit Correlation**: Hash collision risk on large trace sets.

## 22. Explicit Non-Goals
Do NOT implement: provider governance, shell classifier redesign, shell redirection hardening, evidence success correlation redesign, ledger retention/compaction, proposal/approval expiration, multi-instance hive locking, authentication service, OAuth, cloud identity, user accounts, network authentication, new agents, new LLMs, new CIMA phases, new risk levels, new autonomy levels, Alicia changes, Decision Center changes, `lapitaya:approvals`, or v0.9 cleanup.

## 23. Final Verdict
**PASS**: Runtime authenticity hardening is complete, verified, and fail-closed.
