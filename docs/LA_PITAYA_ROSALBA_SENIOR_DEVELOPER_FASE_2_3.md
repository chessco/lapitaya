# LA PITAYA — FASE 2.3 · ROSALBA, SENIOR SOFTWARE DEVELOPER

| | |
|---|---|
| Branch | `lapitaya/desktop-companions-v0.2.3-rosalba-senior-developer` |
| Base | `b13585b2` (FASE 2.2 acceptance) · `main` untouched |
| Commits | `83413587` feat(agents): add Rosalba senior software developer · `320009eb` feat(desktopCompanions): add Rosalba dog companion |
| Verdict | **PASS_WITH_OBSERVATIONS** |

## 1. Objective

Add Rosalba — Senior Software Developer, 🐶 dog — to La Pitaya's virtual software company with the smallest possible change, keeping **Builder != Auditor**, **seniority ≠ governance authority** and **HIGH → human approval**.

## 2. Context

FASE 2.2 closed REAL AGENT → SPAWN → STRUCTURED CIMA ASSIGNMENT → RUNTIME → VERIFIED EVENT → DESKTOP PRESENCE (acceptance PASS_WITH_OBSERVATIONS). That pipeline chose the companion **from the phase alone** (BUILD → El Beni), which is exactly what a second builder breaks.

## 3. Organization Before

El Inge (orchestrator, 🦫) · Valentín (architect, 🦉) · El Beni (builder, 🐱) · Margarito (tester, 🐹) · José Juan (auditor, 🐢) · El Tutú (learner, 🐰) · Alicia (AI companion, 🦊) — 7 members.

## 4. Organization After

El Inge 🦫 → Valentín 🦉 → **Rosalba 🐶** → El Beni 🐱 → Margarito 🐹 → José Juan 🐢; transversal El Tutú 🐰 and Alicia 🦊 — **8 members**. This is specialization and work flow, not a chain of authority; CIMA remains the only governance authority, and the order is not a mandatory pipeline (El Inge routes each task).

## 5. Rosalba Identity

| Field | Value |
|---|---|
| Canonical ID | `rosalba` (no aliases) |
| Name | Rosalba (same in es-MX / en-US, ASCII-safe) |
| Role (CIMA) | `builder` · phases `['BUILD']` · `runtime: 'hire-preset'` |
| Title | Senior Software Developer — es-MX "Desarrolladora Senior", en-US "Senior Software Developer" (`lapitaya:titles.rosalba`) |
| Seniority | `seniority: 'senior'` — capability metadata only |
| Avatar | dog 🐶, `#A1887F`, mood CALM, traits sweet · serene · reliable · collaborative |
| Office sprite | `pam` (unused by La Pitaya until now) |

## 6. Senior Developer Responsibilities

Her hire-preset goal (agent prompt): complex features, integration across modules, hard debugging, important refactors, performance, technical debt; technical review of El Beni's work on request; respects Valentín's boundaries; never tests/audits/approves her own work; escalates HIGH steps to the human through El Inge. CIMA hard rules appended like every preset.

## 7. Builder Classification

Rosalba is `role: 'builder'` — the same CIMA classification as El Beni. No `SENIOR` role, phase, capability, approval, authority or governance rule exists anywhere (ROS-05). `defaultPhaseOwner()` makes El Beni BUILD's explicit default owner: a senior agent is never a phase's default, she works a phase only when dispatched to it.

## 8. Builder != Auditor

Enforced by the protected runtime **by identity**: `buildersOf(task)` (agents that submitted BUILD) cannot PASS that task's TEST or AUDIT. Rosalba's worker is covered with no change: self-AUDIT and self-TEST → `BLOCKED · BUILDER_NOT_AUDITOR` (ROS-06, ROS-33, Electron E11).

## 9. Relationship with El Inge

El Inge stays the orchestrator and decides the builder per task with the existing spawn-request: `"name": "El Beni"` (standard) or `"name": "Rosalba"` (complex). The CIMA briefing lists `Rosalba (Senior Software Developer, BUILD)`; PROTOCOL.md (regenerated on every bootstrap) documents the dispatch. Rosalba orchestrates nothing.

## 10. Relationship with Valentín

Valentín: WHAT / STRUCTURE (ARCHITECT). Rosalba: HOW / complex implementation (BUILD). Architect ≠ Builder is preserved (different roles and phases; Valentín's definition is unchanged).

## 11. Relationship with El Beni

Same role and governance; difference is capability/specialization. El Beni keeps standard implementation and stays BUILD's default owner (ROS-22). Their companion states are independent (ROS-25). A Rosalba code review of El Beni's work is advice, **not** a CIMA AUDIT.

## 12. Relationship with Margarito

Unchanged: TEST owner; tests Rosalba's BUILD like any other.

## 13. Relationship with José Juan

Unchanged: the only AUDIT owner; audits Rosalba's BUILD (ROS-33, E11). Code review ≠ audit.

## 14. CIMA Integration

No change to CIMA. The runtime's `phaseOf` (hive registry name → roster) stamps Rosalba's governance events with BUILD (seen live: every authorization of `worker-rosalba-stats-build1` carries phase BUILD).

## 15. Capability Model

The v0.16 policy/capability registry is per provider/tool/operation, deep-frozen, with no per-agent grants. Rosalba receives exactly a worker's capabilities. She cannot mutate the registry: it is frozen, and writing `policyRegistry.ts` is `governance-tamper` / HIGH → denied (ROS-35). Capability ≠ authority.

## 16. Risk Model

Unchanged LOW → AUTO, MEDIUM → SUPERVISED, HIGH → HUMAN_APPROVAL. A HIGH call by Rosalba is denied with `HUMAN_APPROVAL_REQUIRED` even in autoMode; only a trusted human context can decide it; her id is not one (ROS-07, ROS-08).

## 17. Spawn Integration

Existing path only: `spawn-requests/<id>.json` → `processSpawnRequest` → worker registered with `name` → dispatch message. No second mechanism; `index.ts` has no Rosalba special case (ROS-09).

## 18. Assignment Integration

Existing `recordSpawnAssignment` → `CimaRuntimeService.handle` → `cima-assignment` with from/to/taskId/phase/messageId, sequence, previousEventHash, eventHash, eventMac; chain verifies HEALTHY (ROS-10…14). No new event type, no parallel ledger.

## 19. Desktop Companion

* `runtimeFacts.ts`: a phase fact keeps the agent the verified event names (`agentId` = assignment `to` / record `agentId`), resolved by main from the hive registry name; `companionFactEffect()` puts that agent in the default owner's place (target, FOCUS agent, release, name in the text). States and semantics are unchanged: WORKING / Alicia CELEBRATING on BUILD PASS / CONCERNED on FAIL / PAUSED on BLOCKED with "sin validar todavía" text.
* Unknown or non-owning agent (or a failing resolver) → the phase's default owner, i.e. FASE 2.2 behaviour (ROS-32, ROS-34).
* `desktopPresence.ts`: `resolveAgent` dependency; `ALL_AGENTS` now derives from the canonical roster (it was a second hand-kept list — see §30 F1); `rosalba` appended to the COMPANY fill order (existing default seats unchanged, ROS-31).
* Renderer: `dog: '🐶'`; the identity label shows the localized title when an agent has one, else the species as before.

## 20. FOCUS

Phase alone is insufficient: FOCUS + BUILD + Rosalba → only Rosalba WORKING; FOCUS + BUILD + El Beni → only El Beni (ROS-20/21/22, Electron E12, live §28).

## 21. COMPANY

Still max 3 (preference cannot raise it), independent states, Rosalba can take a seat (ROS-23/24/25/26, Electron E13).

## 22. i18n

`titles.rosalba`: es-MX "Desarrolladora Senior", en-US "Senior Software Developer"; es-MX default / en-US fallback; existing strings untouched (ROS-29/30). The Add-Agent preset shows "Rosalba · Desarrolladora Senior".

## 23. Security Boundary

No new channel: the companion preload still exposes only `onSnapshot, open, dismissBubble, setMode, hide, setInteractive, drag`; no `rosalba:*` channel; `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; forged companion IPC changes nothing (ROS-27/28, E5). Protected governance files: **unchanged** (`11-governance/governance-check.txt`).

## 24. Test Matrix

`test/lapitaya-rosalba.test.cjs` — ROS-01…ROS-35 as specified, plus **ROS-36** (position save/restore) required by finding F1. Real HiveManager, HookServer, CimaRuntimeService, spawn path and DesktopPresence wired like `index.ts`. Mutation check: forcing the adapter to ignore the event's agent (BUILD hard-wired to El Beni) fails 11 ROS tests.

## 25. Automated Results

| Check | Result |
|---|---|
| Existing companion suite | **95/95** |
| ROS suite | **36/36** |
| `npm run test:companion` (now both suites) | **131/131** |
| All 20 `test/lapitaya-*` suites | **PASS** (foundation 25/25 after updating its pinned 7-member roster lists to 8 — the intended change) |
| CIMA | v0.14 **46/46** · v0.15 **43/43** · v0.16 **50/50** |
| `npm run typecheck` | **PASS**, 0 errors |
| `npm run build` | **PASS** |

## 26. Electron Validation

`06-desktop/real_electron_rosalba.cjs` (real Electron, built renderer + preload, real runtime, the resolver of `index.ts`): **16/16 PASS** — spawn "Rosalba" BUILD → WORKING (El Beni untouched); window shows 🐶 Rosalba · Desarrolladora Senior; transparent page, no opaque panel; verified bubble; sandboxed; click opens her menu; click-through (interactive only over the creature); drag keeps size; hide/restore; BUILD PASS → Alicia CELEBRATING, Rosalba released; Margarito TEST PASS, Rosalba self-AUDIT refused, José Juan AUDIT PASS; FOCUS follows the agent; COMPANY ≤ 3; position persists across a restart; Rosalba assignments chained + MAC'd, ledger HEALTHY; no console errors.

## 27. Runtime Validation

Real `CimaRuntimeService` in the ROS suite and the Electron harness. Live ledger records (no MAC values stored):

| eventId | seq | agent | phase | task | hash | MAC |
|---|---|---|---|---|---|---|
| evt-5228adfcbd703fdcfa99d2e5 | 1007 | god → worker-rosalba-stats-build1 (Rosalba) | BUILD (assignment) | LP-ROS-LIVE-1 | 57fa774964c8… | present |
| evt-7935e7a630676f981c14dcfa | 1030 | worker-rosalba-stats-build1 | BUILD **PASS** | LP-ROS-LIVE-1 | 0c31dc15ee82… | present |
| evt-a9084a788c0f15ffa64dd645 | 1047 | god → worker-margarito-stats-test1 | TEST (assignment) | LP-ROS-LIVE-1 | 05dccc8f128b… | present |
| evt-e802d87072ef51123f3e100b | 1093 | god → worker-margarito-stats-test1 | TEST (assignment) | LP-ROS-LIVE-1 | 2d16a15eba42… | present |

## 28. Live-Agent Validation

Real El Inge (messaged through the normal composer, `09-live-agent/mensaje-el-inge.md`), real hive, FOCUS on:

```
REAL EL INGE → spawn-request "name": "Rosalba" (hive log: spawn worker-rosalba-stats-build1, name Rosalba)
  → cima-assignment BUILD seq 1007 → runtime event → DesktopPresence (FOCUS)
  → 🐶 Rosalba · Desarrolladora Senior · WORKING, alone on screen     (07-focus/01)
  → Rosalba implemented stats.js (mean/median/stddev + validation), node --check + node -e
  → BUILD PASS seq 1030 → Rosalba released (IDLE)                      (07-focus/02)
  → El Inge dispatched TEST → Margarito; FOCUS switched to Margarito WORKING (07-focus/03)
```

**Rosalba path: PASS live.** TEST/AUDIT verdicts in the live run: **PENDING** — Margarito's run was stalled by the protected DECISION_GATE (§31-2) and the workstation then locked (LogonUI, ~17:19 UTC), so the run could not be driven further. Builder != Auditor and TEST → AUDIT after a Rosalba BUILD are proven with the real runtime (ROS-06/33) and real Electron (E11), not yet in this live run.

## 29. Governance Regression

CIMA suites green; protected files unchanged; no new authority vocabulary; seniority grants nothing; HIGH stays human; companion stays presentation-only; ledger chain HEALTHY in every rig. Live: Rosalba's calls were stamped phase BUILD and the runtime denied (fail-closed) her task-ledger-touching shell calls like any agent's.

## 30. Findings

* **F1 (fixed in `320009eb`)** — `desktopPresence.ts` kept its own hard-coded seat list `ALL_AGENTS`; Rosalba was missing, so her companion position was never saved/restored (Electron E14 failed on the first run). Now derived from `LA_PITAYA_AGENTS` (no duplicate roster array); ROS-36 guards it; E14 PASS.
* **F2 (design, fixed)** — BUILD presentation was hard-wired to El Beni via `phaseOwner()`; replaced by the event's agent with the FASE 2.2 owner as fail-closed fallback.

No STOP condition was hit.

## 31. Remaining Observations

1. **Live TEST/AUDIT pending** (§28) — to be completed in the FASE 2.3 ACCEPTANCE GATE.
2. **DECISION_GATE friction (pre-existing, protected)** — Bash calls whose effect on `tasks.json` the gate cannot simulate are denied with `cannot parse the resulting task ledger (Unexpected end of JSON input)` (seen for Rosalba, Margarito and El Inge; `tasks.json` itself is valid). Rosalba proceeded after a human note to report through the Write tool (`09-live-agent/nota-rosalba.md`). Not changed here (governance is protected); backlog for a CIMA phase.
3. **El Inge Remote Control prompt** — sending to an idle El Inge restarts his session behind a Claude Code "Remote Control" dialog that swallows the first message (as in the FASE 2.2 gate); dismissing it and resending works.
4. **FOCUS first-show latency (dev)** and **worker JSON robustness** — carried from FASE 2.2.
5. FOCUS after a BUILD PASS keeps the phase agent (Rosalba, IDLE) on screen; Alicia's CELEBRATING is visible in COMPANY — unchanged FASE 2.2 semantics.

## 32. Verdict

# `PASS_WITH_OBSERVATIONS`

Rosalba is integrated through the existing registry, spawn, assignment and companion pipelines; the central chain REAL EL INGE → STRUCTURED DISPATCH → ROSALBA → CIMA BUILD ASSIGNMENT → VERIFIED EVENT → DESKTOP PRESENCE → 🐶 ROSALBA WORKING → IMPLEMENTATION (BUILD PASS) ran live; Builder != Auditor, seniority ≠ authority and HIGH → human hold. Next: **FASE 2.3 ACCEPTANCE GATE** (including the live TEST → Margarito and AUDIT → José Juan). **FASE 3: NOT STARTED.**
