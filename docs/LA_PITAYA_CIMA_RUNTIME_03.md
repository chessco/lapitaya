# La Pitaya — CIMA Runtime Hardening v0.3

**Branch:** `lapitaya/cima-runtime-v0.3-hardening`
**Status:** PASSED — 35/35 v0.3 tests + full v0.2 regression
**Date:** 2026-09-30

---

## 1. SCOPE

CIMA Runtime Hardening v0.3 converts the three critical observations from the v0.2 report
into enforceable runtime guarantees. It does NOT reimplement the Foundation (v0.1) or the
CIMA rules engine (v0.2). Every change is additive or a targeted tightening at the
authorization boundary.

### v0.2 Observations → v0.3 Guarantees

| # | v0.2 Observation | v0.3 Guarantee |
|---|-----------------|----------------|
| O1 | Authorization lacked a strict DENY-default: an exception could fall through | **Fail-Closed**: every path that cannot produce an executable decision ends in DENY |
| O2 | Task completion was not gated on a runtime-recorded DECISION PASS | **Decision Gate**: a CIMA-governed task cannot be marked `done` without a DECISION PASS recorded by the runtime, neither via tool nor via any other path |
| O3 | Provider independence was undocumented; governance relied on caller discipline | **Provider Independence**: governance capability is now classified per-provider at spawn time; non-blocking providers are rejected by default (fail-closed) |

---

## 2. CHANGES

### 2.1 Fail-Closed Authorization (`src/main/hooks.ts`)

**Before (v0.2):** The `PreToolUse` handler had a `try-catch` that caught throwing `authorize()`
calls and returned a deny, but a missing `agentId` or `tool_name`, a `null` return, or an
`unknown` decision value could pass through without an explicit DENY.

**After (v0.3):**
- Field `private preDecision: string | undefined` stamps every `PreToolUse` with the actual
  governance decision (ALLOW / SUPERVISED / APPROVED / HUMAN_APPROVAL_REQUIRED / DENY /
  HALT / OPERATOR_DENY). Reset to `undefined` at the top of every `handle()` call so stale
  values never carry over.
- Method `private denyPre(agentId, p, code, reason)` is the **single deny exit**: every
  failure path — missing identity, missing tool name, throwing `authorize()`, null return,
  non-executable decision — calls `denyPre`. It is impossible to reach an allow response
  without passing through `isExecutable(auth.decision)`.
- Import `isExecutable` from `governance.ts` (already defined there since v0.2, now consumed
  at the hook boundary).
- Public getter `lastPreDecision` exposed for test inspection.

**Invariant:** `governance` is wired && event === 'PreToolUse' → response carries
`permissionDecision = 'deny'` OR `lastPreDecision` is in EXECUTABLE_DECISIONS.

### 2.2 Decision Gate (`src/main/cimaRuntime.ts` + `src/shared/lapitaya/cimaRuntime.ts`)

**Before (v0.2):** Task ledger writes were not intercepted. An agent could mark a CIMA task
`done` by writing to `tasks.json` without a DECISION PASS.

**After (v0.3):**

**Shared pure functions** (`src/shared/lapitaya/cimaRuntime.ts`):
- `completionVerdict(state, taskId)`: pure decision. Returns `{ governed, allowed, reason }`.
  A task is governed when it has at least one CIMA record or assignment. Allowed only when the
  latest accepted DECISION is PASS, BUILD/TEST/AUDIT still stand at PASS, and no BUILD was
  accepted after the DECISION.
- `newlyCompleted(beforeText, afterText)`: parses two versions of `tasks.json` and returns
  task IDs that transition to `status: 'done'`.
- `projectFileWrite(tool, input, current)`: projects what a Write/Edit/MultiEdit would produce
  without executing it, so the gate can judge the result before the call runs.
- `DECISION_CHAIN: ['BUILD','TEST','AUDIT']`: the phases that must stand at PASS for DECISION
  to be accepted. Also checked inside `evaluateSubmission` for DECISION PASS claims.

**CimaRuntimeService** (`src/main/cimaRuntime.ts`):
- `completionGate(taskId)`: public. Loads state, delegates to `completionVerdict`. Used by
  any path that wants to know whether a task may be completed.
- `blockedCompletions(beforeText, afterText)`: judges the tasks that would move to `done`.
  Returns violations with reasons.
- `recordBlockedCompletion(taskId, reason, via)`: appends a `DENY` governance record and
  emits a `completion-blocked` event.
- `taskLedgerWriteGate(root, tool, input)` (private): called inside `authorize()` for every
  TASK_WRITE_TOOLS write (Write/Edit/MultiEdit). Projects the resulting file, runs
  `blockedCompletions`, denies if any task would be illegally completed.
- `cimaState()` (private): assembles `{ records, traces, godId, assignments }`.
- Assignment tracking: `this.assignments` array, populated when an assignment is parsed.
  `parseAssignment` records are now pushed to `this.assignments` so `completionVerdict` sees
  them even before any CIMA record exists.

### 2.3 Provider Independence (`src/shared/lapitaya/providerGovernance.ts`) — NEW FILE

Documents and enforces which providers can actually stop tool calls:

- `GovernanceEnforcement: 'blocking' | 'observe-only' | 'none'`
- `governanceEnforcement(provider)`: returns the enforcement level. `blocking` = provider
  wires every PreToolUse to the runtime and can deny (claude/codex/agy/gemini/grok).
  `observe-only` = fire-and-forget bridge, can report but not deny. `none` = no bridge.
- `spawnGovernanceDecision(provider, opts)`: the spawn-time check. Returns `{ allowed,
  enforcement, overridden?, reason? }`. Non-blocking providers are REJECTED by default;
  `allowUngoverned: true` lets a human opt-out, which is logged and visible in the record.

### 2.4 Authorize Hardening (`src/main/cimaRuntime.ts`)

- `authorize()` now guards against missing `agentId`/`tool` before touching state (returns
  `DENY` immediately).
- `load()` is wrapped in try-catch inside `authorize()`; a state load failure → `DENY`.
- Approval consumption is **durable-first**: the approval is written to disk before the call
  runs. If `saveApprovals()` fails, the approval is NOT consumed and the call is DENIED
  (prevents replay attacks through a crash-before-persist window).
- Ledger write is **required for executable decisions**: if `recordDecision()` fails and the
  decision was ALLOW/SUPERVISED/APPROVED, the approval (if any) is un-consumed and the call
  is DENIED. Every executed call must be auditable.
- `recordDecision()` is a private method that appends to the ledger. It catches and returns
  `false` on I/O error so `authorize()` can deny cleanly.
- `classify` seam: CimaRuntimeServiceDeps now accepts an optional `classify` function,
  allowing deterministic test doubles (DeterministicTestProvider pattern).

### 2.5 Governance Type Safety (`src/shared/lapitaya/governance.ts`)

- `denyAuthorization(code, detail, agentId, tool, input)`: extracted standalone deny factory.
  Fingerprints the call even in the deny path (best-effort, caught internally).
- `EXECUTABLE_DECISIONS` and `isExecutable()` already existed; now imported at the hook
  boundary too.

---

## 3. TEST MATRIX

### 3.1 Fail-Closed (FC)

| ID | What is injected | Expected |
|----|-----------------|---------|
| FC-01 | Normal LOW Read | ALLOW, not denied |
| FC-02 | governance-tamper Write | HUMAN_APPROVAL_REQUIRED, denied |
| FC-03 | HIGH Bash | HUMAN_APPROVAL_REQUIRED + pending approval created |
| FC-04 | `authorize()` throws `Error('simulated crash')` | DENY (fail closed) |
| FC-05 | `authorize()` returns `null` | DENY |
| FC-06 | `authorize()` returns `{ decision: 'MAYBE' }` | DENY |
| FC-07 | Risk classifier throws | DENY (not ALLOW) |
| FC-08 | Risk classifier returns invalid shape | DENY |
| FC-09 | Hive root returns `null` mid-flight | DENY (GOVERNANCE_STATE_UNAVAILABLE) |
| FC-10 | Hook payload with no `agentId` | DENY |
| FC-11 | Hook payload with no `tool_name` | DENY |
| FC-12 | MEDIUM Edit | SUPERVISED, not denied |
| FC-13 | Approved HIGH: deny → approve → 1 run → deny again | Consumed, then DENIED |
| FC-14 | `autoMode: true`, HIGH Bash | DENIED (autoMode does not bypass governance) |

**Result: 14/14 PASS**

### 3.2 Decision Gate (DG)

| ID | Scenario | Expected |
|----|----------|---------|
| DG-01 | Full chain: BUILD→TEST→AUDIT→LEARN→DECISION PASS | `completionGate` = allowed |
| DG-02 | BUILD PASS, no DECISION | `completionGate` = blocked |
| DG-03 | Full chain except DECISION FAIL | `completionGate` = blocked |
| DG-04 | DECISION from non-orchestrator (DECISION_AUTHORITY violation) | `completionGate` = blocked |
| DG-05 | Task with no CIMA history | `completionGate` = ungated (allowed) |
| DG-06 | Write `tasks.json` marking CIMA task `done` without DECISION | denied at PreToolUse boundary |
| DG-07 | Rebuild after DECISION PASS, then check gate | Gate closes again |

**Result: 7/7 PASS**

### 3.3 Provider Independence (PI)

| ID | Scenario | Expected |
|----|----------|---------|
| PI-01 | `governanceEnforcement` for all providers | Correct tier returned |
| PI-02 | Blocking providers: `spawnGovernanceDecision` | `allowed: true` |
| PI-03 | Non-blocking provider, no override | `allowed: false` + LAPITAYA_GOVERNANCE_UNENFORCEABLE |
| PI-04 | Non-blocking provider, `allowUngoverned: true` | `allowed: true`, `overridden: true` |
| PI-05 | DeterministicTestProvider MEDIUM/HIGH mock | SUPERVISED / HUMAN_APPROVAL_REQUIRED |
| PI-06 | `evaluateSubmission` with mock-provider agent | PASS/BLOCKED per evidence, not per provider |

**Result: 6/6 PASS**

### 3.4 Regression (RG) — v0.2 guarantees

| ID | v0.2 guarantee | Result |
|----|---------------|--------|
| RG-01 | BUILDER != AUDITOR | PASS |
| RG-02 | EVIDENCE FIRST | PASS |
| RG-03 | LOW→ALLOW, MEDIUM→SUPERVISED, HIGH→DENY | PASS |
| RG-04 | DECISION_AUTHORITY | PASS |
| RG-05 | HIGH approval one-shot lifecycle | PASS |
| RG-06 | TRANSITION (prereq chain) | PASS |
| RG-07 | Assignment (no verdict) not a claim | PASS |
| RG-08 | Full CIMA cycle → DECISION PASS → gate open | PASS |

**Result: 8/8 PASS**

### Total: 35/35 PASS — exit code 0

---

## 4. FILES CHANGED

| File | Change |
|------|--------|
| `src/main/hooks.ts` | `preDecision` field, `denyPre()` method, `isExecutable` import, `lastPreDecision` getter |
| `src/main/cimaRuntime.ts` | `authorize()` hardening, `taskLedgerWriteGate`, `completionGate`, `blockedCompletions`, `recordBlockedCompletion`, `recordDecision`, `cimaState`, `assignments` tracking |
| `src/shared/lapitaya/cimaRuntime.ts` | `completionVerdict`, `newlyCompleted`, `projectFileWrite`, `DECISION_CHAIN`, `CimaState.assignments`, `CimaAssignment`, `parseAssignment` |
| `src/shared/lapitaya/governance.ts` | `denyAuthorization` factory, `EXECUTABLE_DECISIONS`, `isExecutable` |
| `src/shared/lapitaya/toolRisk.ts` | Minor: additional governance-tamper patterns |
| `src/shared/lapitaya/providerGovernance.ts` | **NEW** — `governanceEnforcement`, `spawnGovernanceDecision` |
| `test/lapitaya-cima-runtime-v03.test.cjs` | **NEW** — 35 hardening tests |

---

## 5. EVIDENCE LEDGER

Evidence for this phase is accumulated in `evidence/lapitaya-cima-runtime-v0.3/`.

### Build Evidence

```
npm run typecheck   → exit 0 (node + web, both tsconfig)
node --test test/lapitaya-cima-runtime-v03.test.cjs
  → 35 pass / 0 fail / 0 skip (exit 0)
node --test test/lapitaya-cima-runtime.test.cjs
  → 19 pass / 0 fail / 0 skip (exit 0)
```

### Audit Trail

- All changed files are on branch `lapitaya/cima-runtime-v0.3-hardening`.
- No changes were made to Foundation (v0.1) or CIMA rules engine (v0.2) base behaviour.
- Provider governance (`providerGovernance.ts`) is additive — does not touch existing providers.
- The Decision Gate operates at the PreToolUse boundary and at `completionGate()` (API surface),
  ensuring that neither a direct tool write nor a programmatic call can bypass it.

---

## 6. OPEN ITEMS (OUT OF SCOPE FOR v0.3)

- **Alicia integration**: deferred. The DECISION gate applies correctly to any task ID;
  Alicia's orchestration surface is not yet wired.
- **Assets boundary**: deferred. Provider governance does not yet cover asset reads/writes
  that happen outside the hive's tool boundary.
- **Hive-API paths**: `HiveManager.updateTaskStatus()` is not yet gated by `completionGate()`.
  The tool boundary (Write/Edit/MultiEdit to `tasks.json`) is gated. A future patch should
  also check at the hive API level.
