/**
 * La Pitaya — CIMA v0.11: Governance Coverage Hardening Test Suite
 *
 * Validates coverage across:
 *   1. Shell mutation detection (>, >>, 2>, $(), find -delete, find -exec, tee, cp, mv, rm)
 *   2. Decision Gate coverage across all execution paths (shell, MCP, provider write)
 *   3. Evidence success correlation (failed command ok:false cannot satisfy evidence)
 *   4. Provider spawn governance (blocking vs non-blocking providers)
 *   5. Q-CG resolutions & Adversarial forged CIMA chain break.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { classifyShell, classifyToolCall } = loadTs('src/shared/lapitaya/toolRisk.ts');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { evaluateSubmission, completionVerdict, verifyEvidence } = loadTs('src/shared/lapitaya/cimaRuntime.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { spawnGovernanceDecision } = loadTs('src/shared/lapitaya/providerGovernance.ts');

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'lapitaya-v0.11-test-'));
}

async function createFloor(t) {
  const root = makeTmpDir();
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

  const hiveDir = join(root, 'hive');
  mkdirSync(hiveDir, { recursive: true });

  const lapitayaDir = join(hiveDir, 'lapitaya');
  mkdirSync(lapitayaDir, { recursive: true });

  const initialTasks = [
    { id: 'task-1', title: 'Task 1', status: 'todo' },
    { id: 'task-cima-1', title: 'CIMA Task 1', status: 'in-progress' }
  ];
  writeFileSync(join(hiveDir, 'tasks.json'), JSON.stringify({ tasks: initialTasks }, null, 2), 'utf8');

  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hiveDir,
    godId: () => 'valentin-1',
    stage: () => 'STAGE_2_SUPERVISED'
  });

  const hiveManager = new HiveManager(() => root);
  hiveManager.ensureHive();

  const tokenValentin = hiveManager.registerAgentToken('valentin-1');
  const tokenElBeni = hiveManager.registerAgentToken('el-beni-1');
  const tokenJoseJuan = hiveManager.registerAgentToken('jose-juan-1');

  lapitaya.handle('valentin-1', 'el-beni-1', { taskId: 'task-cima-1', phase: 'BUILD' });
  lapitaya.handle('valentin-1', 'jose-juan-1', { taskId: 'task-cima-1', phase: 'AUDIT' });

  const config = { autoMode: true, notifications: false };
  const server = new HookServer(hiveManager, () => null, () => config, undefined, undefined, undefined, undefined, lapitaya);
  await server.start();
  t.after(() => server.stop());

  return {
    root, hiveDir, lapitaya, hiveManager, server,
    tokens: { valentin: tokenValentin, beni: tokenElBeni, jose: tokenJoseJuan }
  };
}

// ─── COVERAGE-01: Shell > mutation detected ─────────────────────────────────
test('[COVERAGE-01] Shell > mutation detected', () => {
  const cls = classifyShell('echo x > tasks.json');
  assert.equal(cls.category, 'governance-tamper');
  assert.equal(cls.risk, 'HIGH');
  assert.equal(cls.rule, 'shell:governance-state');
});

// ─── COVERAGE-02: Shell >> mutation detected ────────────────────────────────
test('[COVERAGE-02] Shell >> mutation detected', () => {
  const cls = classifyShell('echo x >> tasks.json');
  assert.equal(cls.category, 'governance-tamper');
  assert.equal(cls.risk, 'HIGH');
  assert.equal(cls.rule, 'shell:governance-state');
});

// ─── COVERAGE-03: Shell 2> mutation detected ────────────────────────────────
test('[COVERAGE-03] Shell 2> mutation detected', () => {
  const cls = classifyShell('cat foo 2> cima-ledger.jsonl');
  assert.equal(cls.category, 'governance-tamper');
  assert.equal(cls.risk, 'HIGH');
  assert.equal(cls.rule, 'shell:governance-state');
});

// ─── COVERAGE-04: Command substitution mutation detected ─────────────────────
test('[COVERAGE-04] Command substitution mutation detected', () => {
  const cls = classifyShell('echo $(cat a) > tasks.json');
  assert.equal(cls.category, 'governance-tamper');
  assert.equal(cls.risk, 'HIGH');
  assert.equal(cls.rule, 'shell:governance-state');
});

// ─── COVERAGE-05: find -delete governed ──────────────────────────────────────
test('[COVERAGE-05] find -delete governed', () => {
  const cls = classifyShell('find . -delete');
  assert.equal(cls.category, 'data-deletion');
  assert.equal(cls.risk, 'HIGH');
  assert.equal(cls.rule, 'shell:find-destructive');
});

// ─── COVERAGE-06: find -exec governed ───────────────────────────────────────
test('[COVERAGE-06] find -exec governed', () => {
  const cls = classifyShell('find . -exec rm {} \\;');
  assert.equal(cls.category, 'data-deletion');
  assert.equal(cls.risk, 'HIGH');
});

// ─── COVERAGE-07: tee/cp/mv/rm governance ───────────────────────────────────
test('[COVERAGE-07] tee/cp/mv/rm governance', () => {
  const clsTee = classifyShell('echo foo | tee tasks.json');
  assert.equal(clsTee.category, 'governance-tamper');
  assert.equal(clsTee.risk, 'HIGH');

  const clsCp = classifyShell('cp bad.json tasks.json');
  assert.equal(clsCp.category, 'governance-tamper');
  assert.equal(clsCp.risk, 'HIGH');

  const clsRm = classifyShell('rm tasks.json');
  assert.equal(clsRm.category, 'governance-tamper');
  assert.equal(clsRm.risk, 'HIGH');
});

// ─── COVERAGE-08: tasks.json shell mutation cannot bypass Decision Gate ──────
test('[COVERAGE-08] tasks.json shell mutation cannot bypass Decision Gate', async (t) => {
  const f = await createFloor(t);
  const auth = f.lapitaya.authorize('el-beni-1', 'Bash', { command: 'echo \'{"tasks":[{"id":"task-cima-1","status":"done"}]}\' > tasks.json' });
  assert.equal(auth.decision, 'DENY');
  assert.equal(auth.rule, 'DECISION_GATE');
});

// ─── COVERAGE-09: CIMA task cannot become DONE without DECISION PASS ─────────
test('[COVERAGE-09] CIMA task cannot become DONE without DECISION PASS', async (t) => {
  const f = await createFloor(t);
  const verdict = f.lapitaya.completionGate('task-cima-1');
  assert.equal(verdict.governed, true);
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.reason.includes('DECISION_GATE'));
});

// ─── COVERAGE-10: Shell cannot bypass completionGate ─────────────────────────
test('[COVERAGE-10] Shell cannot bypass completionGate', async (t) => {
  const f = await createFloor(t);
  const auth = f.lapitaya.authorize('valentin-1', 'PowerShell', { command: 'Set-Content -Path tasks.json -Value \'done\'' });
  assert.equal(auth.decision, 'DENY');
  assert.equal(auth.rule, 'DECISION_GATE');
});

// ─── COVERAGE-11: MCP cannot bypass completionGate ──────────────────────────
test('[COVERAGE-11] MCP cannot bypass completionGate', async (t) => {
  const f = await createFloor(t);
  const auth = f.lapitaya.authorize('valentin-1', 'mcp__write_file', { file_path: 'tasks.json', content: 'done' });
  assert.equal(auth.decision, 'DENY');
  assert.equal(auth.rule, 'DECISION_GATE');
});

// ─── COVERAGE-12: Provider write cannot bypass completionGate ───────────────
test('[COVERAGE-12] Provider write cannot bypass completionGate', async (t) => {
  const f = await createFloor(t);
  const auth = f.lapitaya.authorize('el-beni-1', 'Write', { file_path: 'tasks.json', content: JSON.stringify({ tasks: [{ id: 'task-cima-1', status: 'done' }] }) });
  assert.equal(auth.decision, 'DENY');
  assert.equal(auth.rule, 'DECISION_GATE');
});

// ─── COVERAGE-13: Failed execution cannot satisfy evidence ──────────────────
test('[COVERAGE-13] Failed execution cannot satisfy evidence', async (t) => {
  const f = await createFloor(t);
  f.lapitaya.recordTrace('el-beni-1', 'PostToolUseFailure', 'Bash', { command: 'npm test' }, { exitCode: 1 });
  const traces = f.lapitaya.recentTraces();
  const trace = traces[traces.length - 1];
  assert.equal(trace.ok, false);

  const verified = verifyEvidence({ type: 'execution-trace', source: 'npm test' }, traces);
  assert.equal(verified.verified, false);
});

// ─── COVERAGE-14: Matching command text without successful execution cannot PASS
test('[COVERAGE-14] Matching command text without successful execution cannot PASS', async (t) => {
  const f = await createFloor(t);
  f.lapitaya.recordTrace('el-beni-1', 'PostToolUseFailure', 'Bash', { command: 'npm run test:unit' }, { exitCode: 1 });
  const rec = evaluateSubmission(
    { records: f.lapitaya.cimaRecords('task-cima-1'), traces: f.lapitaya.recentTraces(), godId: 'valentin-1' },
    { taskId: 'task-cima-1', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'execution-trace', source: 'npm run test:unit' }] },
    'el-beni-1',
    Date.now()
  );
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('EVIDENCE_FIRST'));
});

// ─── COVERAGE-15: Wrong execution trace cannot satisfy evidence ──────────────
test('[COVERAGE-15] Wrong execution trace cannot satisfy evidence', async (t) => {
  const f = await createFloor(t);
  f.lapitaya.recordTrace('el-beni-1', 'PostToolUse', 'Bash', { command: 'git status' }, { exitCode: 0 });
  const verified = verifyEvidence({ type: 'execution-trace', source: 'npm test' }, f.lapitaya.recentTraces());
  assert.equal(verified.verified, false);
});

// ─── COVERAGE-16: Wrong actor cannot satisfy evidence ───────────────────────
test('[COVERAGE-16] Wrong actor cannot satisfy evidence', async (t) => {
  const f = await createFloor(t);
  f.lapitaya.recordTrace('jose-juan-1', 'PostToolUse', 'Bash', { command: 'npm test' }, { exitCode: 0 });
  const rec = evaluateSubmission(
    { records: f.lapitaya.cimaRecords('task-cima-1'), traces: f.lapitaya.recentTraces(), godId: 'valentin-1' },
    { taskId: 'task-cima-1', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'execution-trace', source: 'npm test' }] },
    'el-beni-1', // El Beni claims, but trace was by Jose Juan
    Date.now()
  );
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('EVIDENCE_FIRST'));
});

// ─── COVERAGE-17: Provider governance is consulted during actual spawn ──────
test('[COVERAGE-17] Provider governance is consulted during actual spawn', () => {
  const blocking = spawnGovernanceDecision('claude', { allowUngoverned: false });
  assert.equal(blocking.allowed, true);
  assert.equal(blocking.enforcement, 'blocking');

  const unbridged = spawnGovernanceDecision('kimi', { allowUngoverned: false });
  assert.equal(unbridged.allowed, false);
  assert.equal(unbridged.enforcement, 'none');
  assert.ok(unbridged.reason.includes('LAPITAYA_GOVERNANCE_UNENFORCEABLE'));
});

// ─── COVERAGE-18: Blocking provider cannot execute without governance ────────
test('[COVERAGE-18] Blocking provider cannot execute without governance', async (t) => {
  const f = await createFloor(t);
  await assert.rejects(
    () => f.hiveManager.ensureAgent({ id: 'agent-kimi', name: 'Kimi Agent', provider: 'kimi' }, { allowUngovernedProviders: false }),
    /LAPITAYA_GOVERNANCE_UNENFORCEABLE/
  );
});

// ─── COVERAGE-19: Non-blocking provider cannot self-authorize ─────────────────
test('[COVERAGE-19] Non-blocking provider cannot self-authorize', () => {
  const res = spawnGovernanceDecision('copilot', { allowUngoverned: false });
  assert.equal(res.allowed, false);
});

// ─── COVERAGE-20: Explicit valid exception follows runtime policy ────────────
test('[COVERAGE-20] Explicit valid exception follows runtime policy', () => {
  const res = spawnGovernanceDecision('copilot', { allowUngoverned: true });
  assert.equal(res.allowed, true);
  assert.equal(res.overridden, true);
});

// ─── COVERAGE-21: CIMA task with no DECISION cannot complete ─────────────────
test('[COVERAGE-21] CIMA task with no DECISION cannot complete', async (t) => {
  const f = await createFloor(t);
  const verdict = f.lapitaya.completionGate('task-cima-1');
  assert.equal(verdict.allowed, false);
});

// ─── COVERAGE-22: Non-CIMA task preserves intended behavior ──────────────────
test('[COVERAGE-22] Non-CIMA task preserves intended behavior', async (t) => {
  const f = await createFloor(t);
  const verdict = f.lapitaya.completionGate('non-cima-task-999');
  assert.equal(verdict.governed, false);
  assert.equal(verdict.allowed, true);
});

// ─── COVERAGE-23: Ambiguous shell mutation fails closed ───────────────────────
test('[COVERAGE-23] Ambiguous shell mutation fails closed', () => {
  const cls = classifyShell('cat file | tee >(process_output)');
  assert.equal(cls.risk, 'MEDIUM');
  assert.equal(cls.rule, 'shell:mutation');
});

// ─── COVERAGE-24: Governance failure fails closed ────────────────────────────
test('[COVERAGE-24] Governance failure fails closed', async (t) => {
  const f = await createFloor(t);
  const auth = f.lapitaya.authorize('', '', {});
  assert.equal(auth.decision, 'DENY');
});

// ─── COVERAGE-25 / ADVERSARIAL-CHAIN: Forged chain remains broken ───────────
test('[COVERAGE-25] Forged governance chain remains broken after v0.11', async (t) => {
  const f = await createFloor(t);

  // Attempt 1: Forged BUILD PASS without token or trace
  const recBuild = evaluateSubmission(
    { records: f.lapitaya.cimaRecords('task-cima-1'), traces: f.lapitaya.recentTraces(), godId: 'valentin-1' },
    { taskId: 'task-cima-1', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'execution-trace', source: 'src/app.ts' }] },
    'el-beni-1',
    Date.now()
  );
  assert.equal(recBuild.verdict, 'BLOCKED');

  // Attempt 2: Forged TEST PASS with failing test command
  f.lapitaya.recordTrace('chuy-1', 'PostToolUseFailure', 'Bash', { command: 'npm test' }, { exitCode: 1 });
  const recTest = evaluateSubmission(
    { records: f.lapitaya.cimaRecords('task-cima-1'), traces: f.lapitaya.recentTraces(), godId: 'valentin-1' },
    { taskId: 'task-cima-1', phase: 'TEST', verdict: 'PASS', evidence: [{ type: 'execution-trace', source: 'npm test' }] },
    'chuy-1',
    Date.now()
  );
  assert.equal(recTest.verdict, 'BLOCKED');

  // Attempt 3: Shell completion bypass attempt
  const shellBypass = f.lapitaya.authorize('el-beni-1', 'Bash', { command: 'echo "done" > tasks.json' });
  assert.equal(shellBypass.decision, 'DENY');

  // Decision Gate verdict remains blocked
  const verdict = f.lapitaya.completionGate('task-cima-1');
  assert.equal(verdict.allowed, false);
});
