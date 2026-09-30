'use strict';
/**
 * La Pitaya CIMA Runtime v0.3.1 — API Completion Gate Hardening Tests.
 *
 * Tests that every programmatic path in HiveManager that updates a task status
 * to 'done' (updateTaskStatus, patchTask, writeTasks) enforces completionGate(taskId),
 * while preserving ungated behavior for non-CIMA tasks and direct tool boundary protection.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager }        = loadTs('src/main/hive.ts');
const { HookServer }         = loadTs('src/main/hooks.ts');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { recordBanner }       = loadTs('src/shared/lapitaya/cimaRuntime.ts');
const { phaseForAgent }      = loadTs('src/shared/lapitaya/agents.ts');

async function floor(t, config) {
  config = config || { autoMode: true, notifications: false };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v031-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  for (const [id, name] of [['valentin-1','Valentin'],['el-beni-1','El Beni'],
      ['margarito-1','Margarito'],['jose-juan-1','Jose Juan'],['el-tutu-1','El Tutu']]) {
    await hive.ensureAgent({ id, name, provider: 'claude', cwd: home });
  }
  const events = [];
  let clock = 1_800_000_000_000;
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hive.root(),
    godId:    () => 'god',
    phaseOf:  (agentId) => phaseForAgent(hive.registry(), agentId),
    onEvent:  (e) => events.push(e),
    now:      () => (clock += 1000),
  });
  hive.setCimaHandler((from, cima, messageId, to) => recordBanner(lapitaya.handle(from, to, cima, messageId)));
  hive.setCompletionGate(
    (taskId) => lapitaya.completionGate(taskId),
    (taskId, reason, via) => lapitaya.recordBlockedCompletion(taskId, reason, via)
  );

  const server = new HookServer(hive, () => null, () => config,
    undefined, undefined, undefined, undefined, lapitaya);
  const hook   = (agentId, payload) =>
    server.handle({ agent_id: agentId, session_id: 's-'+agentId, ...payload });
  const pre    = async (agentId, tool, input) =>
    await hook(agentId, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
  const ran    = async (agentId, command, stdout, failed) =>
    await hook(agentId, failed
      ? { hook_event_name:'PostToolUseFailure', tool_name:'Bash', tool_input:{command}, error:stdout }
      : { hook_event_name:'PostToolUse', tool_name:'Bash', tool_input:{command}, tool_response:{stdout,stderr:'',interrupted:false} });
  const wrote  = async (agentId, file) =>
    await hook(agentId, { hook_event_name:'PostToolUse', tool_name:'Edit',
      tool_input:{file_path:file,old_string:'a',new_string:'b'}, tool_response:{} });
  const send   = (from, cima, to) => {
    to = to || 'god';
    const out = path.join(hive.root(), 'agents', from, 'outbox');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'm-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.json'),
      JSON.stringify({ to, act:'inform', subject:cima.phase+' result', body:'agent prose', cima }));
    hive.routeOnce();
  };

  return { home, hive, lapitaya, server, events, pre, ran, wrote, send };
}

// Helper: read ledger records from hive root
function readCimaLedger(home) {
  const p = path.join(home, 'hive', 'lapitaya', 'cima-ledger.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('[API-01] CIMA task with FULL CIMA chain + DECISION PASS -> updateTaskStatus(done) ALLOWED', async (t) => {
  const f = await floor(t);
  const taskId = 'task-api-01';
  f.hive.addTask({ id: taskId, title: 'API Task 01', status: 'doing', assignee: 'valentin-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });

  await f.ran('valentin-1', 'npm test', 'PASS');
  await f.wrote('valentin-1', path.join(f.home, 'src', 'app.ts'));
  f.send('valentin-1', { phase: 'BUILD', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'npm test' }] });

  await f.ran('el-beni-1', 'npm run test:unit', 'PASS');
  f.send('el-beni-1', { phase: 'TEST', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'npm run test:unit' }] });

  await f.ran('margarito-1', 'git diff main', 'diff clean');
  f.send('margarito-1', { phase: 'AUDIT', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'git diff main' }] });

  await f.ran('jose-juan-1', 'git log -1', 'abc');
  f.send('jose-juan-1', { phase: 'LEARN', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'git log -1' }] });

  await f.ran('god', 'git diff --stat', ' 1 file changed');
  f.send('god', { phase: 'DECISION', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'diff', source: 'git diff --stat' }] }, 'human');

  const res = f.hive.updateTaskStatus(taskId, 'done');
  assert.equal(res.ok, true, 'updateTaskStatus should succeed when DECISION PASS exists');

  const tasks = f.hive.tasks().tasks;
  const card = tasks.find((x) => x.id === taskId);
  assert.equal(card.status, 'done', 'task status on disk must be done');
});

test('[API-02] CIMA task with BUILD/TEST/AUDIT PASS but NO DECISION -> updateTaskStatus(done) BLOCKED', async (t) => {
  const f = await floor(t);
  const taskId = 'task-api-02';
  f.hive.addTask({ id: taskId, title: 'API Task 02', status: 'doing', assignee: 'valentin-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });

  await f.ran('valentin-1', 'npm test', 'PASS');
  await f.wrote('valentin-1', path.join(f.home, 'src', 'app.ts'));
  f.send('valentin-1', { phase: 'BUILD', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'npm test' }] });

  await f.ran('el-beni-1', 'npm run test:unit', 'PASS');
  f.send('el-beni-1', { phase: 'TEST', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'npm run test:unit' }] });

  await f.ran('margarito-1', 'git diff main', 'diff clean');
  f.send('margarito-1', { phase: 'AUDIT', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'git diff main' }] });

  // NO DECISION issued
  const res = f.hive.updateTaskStatus(taskId, 'done');
  assert.equal(res.ok, false, 'updateTaskStatus should be BLOCKED when NO DECISION is recorded');
  assert.match(res.error, /DECISION_GATE/);

  const tasks = f.hive.tasks().tasks;
  const card = tasks.find((x) => x.id === taskId);
  assert.equal(card.status, 'doing', 'task status on disk must remain doing');
});

test('[API-03] DECISION FAIL -> updateTaskStatus(done) BLOCKED', async (t) => {
  const f = await floor(t);
  const taskId = 'task-api-03';
  f.hive.addTask({ id: taskId, title: 'API Task 03', status: 'doing', assignee: 'valentin-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });

  await f.ran('valentin-1', 'npm test', 'FAIL', true);
  f.send('valentin-1', { phase: 'BUILD', verdict: 'FAIL', taskId: taskId, evidence: [] });

  await f.ran('god', 'git log -1', 'abc');
  f.send('god', { phase: 'DECISION', verdict: 'FAIL', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'git log -1' }] }, 'human');

  const res = f.hive.updateTaskStatus(taskId, 'done');
  assert.equal(res.ok, false, 'updateTaskStatus must be BLOCKED when DECISION is FAIL');
  assert.match(res.error, /DECISION is FAIL/);

  const tasks = f.hive.tasks().tasks;
  const card = tasks.find((x) => x.id === taskId);
  assert.equal(card.status, 'doing', 'task status on disk must stay doing');
});

test('[API-04] DECISION BLOCKED -> updateTaskStatus(done) BLOCKED', async (t) => {
  const f = await floor(t);
  const taskId = 'task-api-04';
  f.hive.addTask({ id: taskId, title: 'API Task 04', status: 'doing', assignee: 'valentin-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });

  // Agent tries to send DECISION PASS (wrong sender) -> results in BLOCKED
  f.send('valentin-1', { phase: 'DECISION', verdict: 'PASS', taskId: taskId, evidence: [] });

  const res = f.hive.updateTaskStatus(taskId, 'done');
  assert.equal(res.ok, false, 'updateTaskStatus must be BLOCKED when DECISION is BLOCKED');

  const tasks = f.hive.tasks().tasks;
  const card = tasks.find((x) => x.id === taskId);
  assert.equal(card.status, 'doing', 'task status on disk must stay doing');
});

test('[API-05] DECISION PASS + BUILD after DECISION -> updateTaskStatus(done) BLOCKED', async (t) => {
  const f = await floor(t);
  const taskId = 'task-api-05';
  f.hive.addTask({ id: taskId, title: 'API Task 05', status: 'doing', assignee: 'valentin-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });

  await f.ran('valentin-1', 'npm test', 'PASS');
  await f.wrote('valentin-1', path.join(f.home, 'src', 'app.ts'));
  f.send('valentin-1', { phase: 'BUILD', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'npm test' }] });
  await f.ran('el-beni-1', 'npm run test:unit', 'PASS');
  f.send('el-beni-1', { phase: 'TEST', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'npm run test:unit' }] });
  await f.ran('margarito-1', 'git diff main', 'clean');
  f.send('margarito-1', { phase: 'AUDIT', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'git diff main' }] });
  await f.ran('jose-juan-1', 'git log -1', 'abc');
  f.send('jose-juan-1', { phase: 'LEARN', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'git log -1' }] });

  await f.ran('god', 'git diff --stat', ' 1 file changed');
  f.send('god', { phase: 'DECISION', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'diff', source: 'git diff --stat' }] }, 'human');

  // Re-build after decision!
  await f.ran('valentin-1', 'npm test', 'PASS');
  f.send('valentin-1', { phase: 'BUILD', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'npm test' }] });

  const res = f.hive.updateTaskStatus(taskId, 'done');
  assert.equal(res.ok, false, 'updateTaskStatus must be BLOCKED when rebuilt after DECISION');
  assert.match(res.error, /rebuilt after its DECISION/);

  const card = f.hive.tasks().tasks.find((x) => x.id === taskId);
  assert.equal(card.status, 'doing', 'task status must stay doing');
});

test('[API-06] unauthorized DECISION PASS -> updateTaskStatus(done) BLOCKED', async (t) => {
  const f = await floor(t);
  const taskId = 'task-api-06';
  f.hive.addTask({ id: taskId, title: 'API Task 06', status: 'doing', assignee: 'valentin-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });

  // valentin-1 is an agent, not god / authorized human
  f.send('valentin-1', { phase: 'DECISION', verdict: 'PASS', taskId: taskId, evidence: [] });

  const res = f.hive.updateTaskStatus(taskId, 'done');
  assert.equal(res.ok, false, 'updateTaskStatus must be BLOCKED for unauthorized DECISION sender');

  const card = f.hive.tasks().tasks.find((x) => x.id === taskId);
  assert.equal(card.status, 'doing', 'task status must remain doing');
});

test('[API-07] non-CIMA task -> updateTaskStatus(done) ALLOWED (ungated)', async (t) => {
  const f = await floor(t);
  const taskId = 'task-non-cima-99';
  f.hive.addTask({ id: taskId, title: 'Non CIMA Task', status: 'todo', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });

  const res = f.hive.updateTaskStatus(taskId, 'done');
  assert.equal(res.ok, true, 'non-CIMA task should be ungated and allowed to transition to done');

  const card = f.hive.tasks().tasks.find((x) => x.id === taskId);
  assert.equal(card.status, 'done', 'non-CIMA task status on disk must be done');
});

test('[API-08] tool boundary path (PreToolUse) continues to be protected', async (t) => {
  const f = await floor(t);
  const taskId = 'task-api-08';
  f.hive.addTask({ id: taskId, title: 'API Task 08', status: 'doing', assignee: 'valentin-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });

  // Make it a governed CIMA task by submitting a BUILD phase
  await f.ran('valentin-1', 'npm test', 'PASS');
  await f.wrote('valentin-1', path.join(f.home, 'src', 'app.ts'));
  f.send('valentin-1', { phase: 'BUILD', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'npm test' }] });

  const tasksPath = path.join(f.home, 'hive', 'tasks.json');
  const ed = await f.pre('valentin-1', 'Edit', {
    file_path: tasksPath,
    old_string: '"status": "doing"',
    new_string: '"status": "done"'
  });
  assert.equal(ed.hookSpecificOutput?.permissionDecision, 'deny', 'PreToolUse direct edit to tasks.json without DECISION must be denied');
  assert.match(ed.hookSpecificOutput?.permissionDecisionReason ?? '', /DECISION_GATE/);
});

test('[Negative Test — Direct API Bypass] updateTaskStatus, patchTask, writeTasks without DECISION PASS are ALL BLOCKED and recorded in ledger', async (t) => {
  const f = await floor(t);
  const taskId = 'task-negative-bypass';
  f.hive.addTask({ id: taskId, title: 'Direct Bypass Test Task', status: 'doing', assignee: 'valentin-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });

  // Make it a governed CIMA task by submitting a BUILD phase
  await f.ran('valentin-1', 'npm test', 'PASS');
  await f.wrote('valentin-1', path.join(f.home, 'src', 'app.ts'));
  f.send('valentin-1', { phase: 'BUILD', verdict: 'PASS', taskId: taskId, evidence: [{ type: 'execution-trace', source: 'npm test' }] });

  // 1. Attempt via updateTaskStatus()
  const r1 = f.hive.updateTaskStatus(taskId, 'done');
  assert.equal(r1.ok, false, 'updateTaskStatus bypass must be rejected');
  assert.equal(f.hive.tasks().tasks.find((x) => x.id === taskId).status, 'doing', 'status must remain doing after updateTaskStatus attempt');

  // 2. Attempt via patchTask()
  const r2 = f.hive.patchTask(taskId, { status: 'done' });
  assert.equal(r2, false, 'patchTask bypass must be rejected');
  assert.equal(f.hive.tasks().tasks.find((x) => x.id === taskId).status, 'doing', 'status must remain doing after patchTask attempt');

  // 3. Attempt via writeTasks()
  const r3 = f.hive.writeTasks([{ id: taskId, title: 'Direct Bypass Test Task', status: 'done', assignee: 'valentin-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() }]);
  assert.equal(r3, false, 'writeTasks bypass must be rejected');
  assert.equal(f.hive.tasks().tasks.find((x) => x.id === taskId).status, 'doing', 'status must remain doing after writeTasks attempt');

  // Verify evidence of blocked completion was recorded in cima-ledger.jsonl
  const records = readCimaLedger(f.home);
  const blockedRecs = records.filter((r) => r.taskId === taskId && r.rule === 'DECISION_GATE' && r.decision === 'DENY');
  assert.ok(blockedRecs.length >= 3, `Expected at least 3 blocked completion records in ledger, found ${blockedRecs.length}`);
  for (const rec of blockedRecs) {
    assert.equal(rec.category, 'governance-tamper');
    assert.equal(rec.risk, 'HIGH');
    assert.equal(rec.rule, 'DECISION_GATE');
  }
});
