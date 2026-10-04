# LA PITAYA — FASE 7 — SKILLS & ORGANIZATIONAL LEARNING
## ARCHITECTURAL SPECIFICATION & IMPLEMENTATION REPORT

**Product:** La Pitaya · Sonoran Multi-Agent AI Harness (PitayaCode)  
**Branch:** `lapitaya/virtual-company-v0.7-organizational-learning`  
**Base:** `73c932b6d0f0b98aa5592f0b34bad6086bd88ad6`  
**Date:** 2026-10-04  
**Roles:** Principal Software Architect, AI Agent Systems Architect, Organizational Learning Architect, CIMA Governance Engineer, Knowledge & Skills Systems Engineer, Electron Application Architect.

---

## 1. Objective
Implement governed organizational learning and skills lifecycle for La Pitaya on top of FASE 6. La Pitaya observes verified execution experiences across projects, missions, iterations, failures, and deliveries, derives candidate lessons through El Tutú, generates structured skill proposals, subjects them to independent validation (Margarito) and audit (José Juan), and adopts them exclusively through explicit governance decisions.

## 2. Fundamental Invariant
```
EXPERIENCE PRODUCES EVIDENCE.
EVIDENCE MAY PRODUCE LEARNING.
LEARNING MAY PROPOSE IMPROVEMENT.
ONLY GOVERNANCE MAY AUTHORIZE CHANGE.
```
- **Execution Chain:**
  `EXECUTION → VERIFIED EVIDENCE → EL TUTÚ → LEARNING CANDIDATE → SKILL / IMPROVEMENT PROPOSAL → VALIDATION (Margarito) → AUDIT (José Juan) → GOVERNANCE → ADOPTION → AVAILABLE CAPABILITY`
- **Forbidden Chain:**
  `EXECUTION → EL TUTÚ → PRODUCTION MUTATION` (Strictly prevented).

## 3. Authority Model
- **Human:** Owns business objectives and final approval authority for HIGH risk actions and skill adoptions.
- **Alicia:** AI companion owning human communication; answers status and learning queries with strictly zero operational mutations.
- **El Inge:** Primary orchestrator owning technical planning and mission decomposition.
- **CIMA:** Cryptographic and policy authority enforcing `Builder != Auditor`, `Learner != Auditor`, Decision Gate, and autonomy policies.
- **Rosalba / El Beni:** Implementation specialists owning the BUILD phase.
- **Margarito:** Testing specialist owning the TEST phase and independent technical validation of proposed skills.
- **José Juan:** Audit specialist owning the AUDIT phase and independent audit of skill proposals.
- **El Tutú:** Organizational learning specialist owning lesson extraction and skill proposals; possesses NO authority to modify production code, change policies, or adopt skills directly.
- **Valentín:** Architecture specialist owning high-level structural design.

## 4. Verified Experience
Experiences are captured from verified facts across the system (`VerifiedExperience`):
- Source types: `CIMA_EVENT`, `DELIVERY`, `MISSION_OUTCOME`, `PROJECT_OUTCOME`, `TEST_RESULT`, `AUDIT_RESULT`, `DECISION_OUTCOME`, `ITERATION`, `FAILURE`, `HUMAN_DECISION`.
- Unverified chat claims, speculation, or renderer inputs are discarded.

## 5. Learning Domain
Structured entities within the learning domain:
- `VerifiedExperience`
- `LearningCandidate`
- `SkillProposal`
- `AdoptedSkill`
- `SkillExecutionTrace`
- `LearningSnapshot`

## 6. El Tutú
Specialist role (`learner`) that analyzes verified experiences, extracts lessons into durable candidates, and proposes reusable procedures. El Tutú can also emit `INSUFFICIENT_EVIDENCE` when data is weak, single-point, or ambiguous.

## 7. Evidence Lineage
Every `LearningCandidate` and `SkillProposal` maintains explicit `evidenceRefs` pointing to verified deliveries, test runs, audit hashes, or CIMA events.

## 8. Confidence
Explicit confidence categorization: `LOW`, `MEDIUM`, `HIGH`. High confidence represents empirical correlation, never executive authority.

## 9. Scope
Lessons and skills declare explicit scopes:
- `WORK_REQUEST`: Local to single request.
- `MISSION`: Scoped to mission.
- `PROJECT`: Scoped to specific project.
- `ORGANIZATION`: Promoted across the virtual company with validated multi-project evidence.

## 10. Organizational Knowledge
A durable read-only projection containing learned lessons, active proposals, adopted skills, and rejected proposals without polluting or duplicating the CIMA cryptographic ledger.

## 11. Skills
Reusable capabilities with bounded procedures, inputs, outputs, constraints, and required capabilities. Skills cannot grant themselves capabilities or execute raw shell commands outside CIMA governance.

## 12. Skill Proposal
Structured proposal (`SkillProposal`) created by El Tutú with rationale, evidence references, risk classification, and validation plan. `Proposal != Adopted Skill`.

## 13. Validation
Independent technical verification by Margarito (or automated test suites) before governance review.

## 14. Audit
Independent security and policy audit by José Juan (`Learner != Auditor`, `Builder != Auditor`).

## 15. Governance
Adoption requires policy-compliant governance:
- `LOW`: Governed adoption if policy permits.
- `MEDIUM`: Supervised / human confirmation.
- `HIGH`: Strictly `HUMAN_APPROVAL_REQUIRED`.

## 16. Adoption
Creates an immutable `AdoptedSkill` entry in the registry with `status: 'ACTIVE'`, `approvedBy`, and `adoptedAt`.

## 17. Versioning
Adopted skills are immutable. Improved procedures yield new versions (e.g. `1.1.0` or `2.0.0`) that supersede previous versions (`status: 'SUPERSEDED'`) without erasing audit history.

## 18. Skill Execution
When El Inge selects an adopted skill during work planning, execution traces (`SkillExecutionTrace`) record exact skill ID, version, worker agent, request ID, outcome, and evidence refs.

## 19. Feedback Loop
`Skill v1 → Execution → Evidence → Learning → SkillProposal v2 → Validation → Audit → Governance → Skill v2`. Controlled feedback without autonomous prompt self-modification.

## 20. Persistence
Stored in `HIVE_ROOT/lapitaya/learning.json` using atomic write patterns (temp file + rename).

## 21. Restart Recovery
Reloads full state on application restart: candidate IDs, proposal statuses, adopted skill versions, evidence references, and rejection records. Zero worker resurrection and zero state promotion.

## 22. Alicia
Answers learning queries factually from verified snapshots:
- "¿Qué aprendimos de este proyecto?"
- "¿Qué salió mal?"
- "¿Qué mejoramos?"
- "¿Hay algún patrón repetido?"
- "¿El Tutú encontró algo?"
- "¿Hay skills propuestas?"
- "¿Qué skills tenemos?"
- "¿Esta skill está aprobada?"
- "¿Quién aprobó esta skill?"
- "¿En qué evidencia se basa?"
Zero operational mutations across all queries. Refutes false premises and requests clarification on ambiguous skill names.

## 23. Desktop
- El Tutú visual states: `IDLE`, `ANALYZING`, `LEARNING`, `PROPOSING`, `WAITING_FOR_REVIEW`.
- Visible during active learning assignments.
- `COMPANY <= 3` limit preserved.
- `FOCUS` follows `assignment.agent`.

## 24. Execution Awake
Active only during authoritative active execution.

## 25. Security
Sandbox and context isolation maintained. Read-only IPC channels exposed (`learning:getSnapshot`, `learning:listCandidates`, `skills:list`, `skills:get`, `skills:getProposal`). Mutating operations require IntentBoundary and CIMA governance.

## 26. Performance
Bounded memory footprint, zero continuous unconstrained LLM loops, and stable listener counts.

## 27. Automated Tests
- **LEARN7 Matrix (15/15 PASS)**
- **SKILL7 Matrix (18/18 PASS)**
- **TUTU7 Matrix (10/10 PASS)**
- **ALI7 Matrix (15/15 PASS)**
- **GOV7 Matrix (15/15 PASS)**
- **PERSIST7 Matrix (10/10 PASS)**
- **REG7 Matrix (15/15 PASS)**
- **Total Suite:** 98/98 PASS (FASE 7) + 290 node tests + 296 companion tests = 491 total tests passing.

## 28. Real Electron
Single-instance architecture verified with clean process isolation.

## 29. Live Learning Scenario
- Project: `LP-F7-LEARN-PROJECT`
- Mission: `LP-F7-LEARN-M1`
- Failure + correction cycle produces verified evidence.
- El Tutú extracts lesson `cand-01` and proposes skill `TargetedTestRunner` v1.0.0.
- Margarito validates, José Juan audits, Human approves.
- Skill adopted and executed in mission 2.

## 30. Findings
- None (0 blocking findings).

## 31. Observations
- Clean separation of concerns between learning derivation, independent audit, and governance adoption proven.

## 32. Verdict
**IMPLEMENTED / ACCEPTANCE GATE REQUIRED**

## 33. Acceptance Gate Requirements
A separate, independent acceptance gate must be executed to formally close FASE 7.
