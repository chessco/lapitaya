# La Pitaya — FASE 4 Virtual Software Company
## Autonomous Acceptance Gate

### Verdict

**INCONCLUSIVE / NOT CLOSED**

The automated baseline and CIMA regression pass, and real Electron starts with a clean test-process environment. The required live copilot chain through the normal composer and real Alicia UI questions was not completed in this run, so the gate cannot be closed as PASS.

### Baseline

- Branch: `lapitaya/virtual-company-v0.4-company-awareness`
- HEAD: `86d312eb9df8968d395a6640e40f9d28dc90943a`
- Main HEAD: `2a5a5858ddf11885fe9c3980df0b9b1dfdace9a8`
- Working tree: clean before acceptance documentation.
- No source, governance, CIMA, policy, ledger, or authorization changes were made during this gate.

### Automated validation

- `npm.cmd run test:companion`: **229/229 PASS**.
- `npm.cmd run typecheck`: **PASS** for Node and Web.
- `npm.cmd run build`: **PASS**.
- Relevant CIMA suites: **302/302 PASS**.

The CIMA run emitted existing environment warnings when the harness attempted to create directories beneath `.codex`; assertions remained green and the process exited successfully.

### Electron and environment

The inherited environment had `ELECTRON_RUN_AS_NODE=1`. The test process removed that variable without changing the machine globally. Electron then reached the real app startup, built the renderer, and produced responsive Electron processes. A second instance encountered an already occupied Vite port and Hive named pipe from an existing app instance; this is recorded as an environment/runtime-session observation.

### Acceptance coverage

The following are supported by automated evidence: CompanySession and CompanySnapshot projection, project honesty, active team, expected-versus-assigned semantics, bounded timeline, deterministic read-only company answers, O-1 filtering, IPC boundary, two-session model, FOCUS/COMPANY policy, Execution Awake regression, living desktop regression, typecheck, build, and CIMA governance regression.

The following live-gate requirements remain **NOT EXECUTED in this run**: normal composer → real El Inge dispatch, real BUILD → TEST → AUDIT workflow, real UI question capture Q1–Q13, adversarial UI questions, human-attention UI checkpoint, real concurrent task isolation, and screenshot/performance capture tied to that live workflow. No synthetic event was promoted as live evidence.

### Closure decision

FASE 4 remains implemented but this autonomous acceptance gate is not closed. FASE 5 planning is not authorized by this report until the missing live chain is executed and evidenced.
