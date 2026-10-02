/**
 * La Pitaya — CIMA v0.12: State Integrity, Durability & Recovery Test Suite
 *
 * Validates requirements STATE-01 to STATE-35 + Adversarial recovery tests.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TRUSTED_HUMAN: HUMAN } = require('./fixtures/human.cjs');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'lapitaya-v0.12-test-'));
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

  return { root, hiveDir, lapitayaDir, lapitaya };
}

// ─── STATE-01 to STATE-35 Tests ──────────────────────────────────────────

test('STATE-01: atomic JSON write produces complete valid JSON file', async (t) => {
  const { lapitaya, lapitayaDir } = await createFloor(t);
  const req = lapitaya.openRequest({
    intentId: 'int-1', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  assert.ok(req);
  const proposalsPath = join(lapitayaDir, 'proposals.json');
  assert.ok(existsSync(proposalsPath));
  const content = readFileSync(proposalsPath, 'utf8');
  assert.doesNotThrow(() => JSON.parse(content));
});

test('STATE-02: failed state write fails closed', async (t) => {
  const root = makeTmpDir();
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  const blocker = join(root, 'blocker_file');
  writeFileSync(blocker, 'blocker', 'utf8');

  const badLapitaya = new CimaRuntimeService({
    hiveRoot: () => join(blocker, 'sub'),
    godId: () => 'valentin-1'
  });
  const res = badLapitaya.openRequest({
    intentId: 'int-2', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  assert.strictEqual(res, null);
});

test('STATE-03: failed ledger write fails closed', async (t) => {
  const root = makeTmpDir();
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  const blocker = join(root, 'blocker_file');
  writeFileSync(blocker, 'blocker', 'utf8');

  const badLapitaya = new CimaRuntimeService({
    hiveRoot: () => join(blocker, 'sub'),
    godId: () => 'valentin-1'
  });
  const auth = badLapitaya.authorize('agent-1', 'Read', { file_path: 'foo.txt' });
  assert.strictEqual(auth.decision, 'DENY');
  assert.strictEqual(auth.rule, 'LEDGER_UNAVAILABLE');
});

test('STATE-04: ledger write failure cannot produce PASS', async (t) => {
  const root = makeTmpDir();
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  const blocker = join(root, 'blocker_file');
  writeFileSync(blocker, 'blocker', 'utf8');

  const badLapitaya = new CimaRuntimeService({
    hiveRoot: () => join(blocker, 'sub'),
    godId: () => 'valentin-1'
  });
  const record = badLapitaya.submit('agent-1', {
    taskId: 'task-1', phase: 'BUILD', verdict: 'PASS', summary: 'build ok', evidence: []
  });
  assert.strictEqual(record.verdict, 'BLOCKED');
});

test('STATE-05: malformed ledger handled deterministically', async (t) => {
  const { lapitaya, lapitayaDir } = await createFloor(t);
  writeFileSync(join(lapitayaDir, 'cima-ledger.jsonl'), '{"kind":"governance",invalid_json\n', 'utf8');
  const auth = lapitaya.authorize('agent-1', 'Read', { file_path: 'foo.txt' });
  assert.strictEqual(auth.decision, 'DENY');
  // v0.15: a damaged ledger is named explicitly
  assert.strictEqual(auth.rule, 'LEDGER_CORRUPTED');
});

test('STATE-06: truncated ledger handled deterministically', async (t) => {
  const { lapitaya, lapitayaDir } = await createFloor(t);
  writeFileSync(join(lapitayaDir, 'cima-ledger.jsonl'), '{"kind":"governance", "ts": 1234', 'utf8');
  const verdict = lapitaya.completionGate('task-cima-1');
  assert.strictEqual(verdict.allowed, false);
  assert.match(verdict.reason, /corrupted/i);
});

test('STATE-07: corrupt proposal state fails closed', async (t) => {
  const { lapitaya, lapitayaDir } = await createFloor(t);
  writeFileSync(join(lapitayaDir, 'proposals.json'), '{"corrupted": true', 'utf8');
  const auth = lapitaya.authorize('agent-1', 'Read', { file_path: 'foo.txt' });
  assert.strictEqual(auth.decision, 'DENY');
  assert.strictEqual(auth.rule, 'GOVERNANCE_STATE_CORRUPT');
});

test('STATE-08: missing proposal state fails closed without failing open', async (t) => {
  const { lapitaya } = await createFloor(t);
  const requests = lapitaya.listRequests();
  assert.deepStrictEqual(requests, []);
});

test('STATE-09: corrupt approval state fails closed', async (t) => {
  const { lapitaya, lapitayaDir } = await createFloor(t);
  writeFileSync(join(lapitayaDir, 'approvals.json'), 'BAD_JSON', 'utf8');
  const auth = lapitaya.authorize('agent-1', 'Read', { file_path: 'foo.txt' });
  assert.strictEqual(auth.decision, 'DENY');
  assert.strictEqual(auth.rule, 'GOVERNANCE_STATE_CORRUPT');
});

test('STATE-10: missing approval state fails closed without failing open', async (t) => {
  const { lapitaya } = await createFloor(t);
  const approvals = lapitaya.listApprovals();
  assert.deepStrictEqual(approvals, []);
});

test('STATE-11: expired REQUEST cannot execute', async (t) => {
  let nowTime = 1000000;
  const { hiveDir } = await createFloor(t);
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hiveDir,
    godId: () => 'valentin-1',
    now: () => nowTime
  });
  const req = lapitaya.openRequest({
    intentId: 'int-exp-1', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  assert.ok(req);

  // Fast forward past TTL (24h + 1ms)
  nowTime += 24 * 60 * 60 * 1000 + 1;
  const res = lapitaya.confirmRequest(req.id, { by: 'human', token: req.token, human: HUMAN });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.code, 'NOT_CONFIRMABLE');
  assert.match(res.reason, /EXPIRED/);
});

test('STATE-12: expired HIGH approval cannot execute', async (t) => {
  let nowTime = 1000000;
  const { hiveDir } = await createFloor(t);
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hiveDir,
    godId: () => 'valentin-1',
    stage: () => 'STAGE_2_SUPERVISED',
    now: () => nowTime
  });
  const auth = lapitaya.authorize('agent-1', 'Bash', { command: 'rm -rf /tmp/test' });
  assert.strictEqual(auth.decision, 'HUMAN_APPROVAL_REQUIRED');
  const approvalId = auth.approvalId;
  assert.ok(approvalId);

  // Fast forward past TTL
  nowTime += 24 * 60 * 60 * 1000 + 1;
  const decided = lapitaya.decide(approvalId, true, 'human', HUMAN);
  assert.strictEqual(decided, null);
});

test('STATE-13: agent cannot extend expiration', async (t) => {
  let nowTime = 1000000;
  const { hiveDir } = await createFloor(t);
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hiveDir,
    godId: () => 'valentin-1',
    now: () => nowTime
  });
  const req = lapitaya.openRequest({
    intentId: 'int-exp-2', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  nowTime += 24 * 60 * 60 * 1000 + 1;

  // Confirmation attempt on expired proposal by agent is denied
  const confirmRes = lapitaya.confirmRequest(req.id, { by: 'agent-1', token: req.token });
  assert.strictEqual(confirmRes.ok, false);
});

test('STATE-14: provider cannot extend expiration', async (t) => {
  let nowTime = 1000000;
  const { hiveDir } = await createFloor(t);
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hiveDir,
    godId: () => 'valentin-1',
    providerOf: () => 'claude-3-5-sonnet',
    now: () => nowTime
  });
  const req = lapitaya.openRequest({
    intentId: 'int-exp-3', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  nowTime += 24 * 60 * 60 * 1000 + 1;

  // Confirming expired request under provider context is rejected
  const res = lapitaya.confirmRequest(req.id, { by: 'human', token: req.token, human: HUMAN });
  assert.strictEqual(res.ok, false);
});

test('STATE-15: human decision after expiration rejected', async (t) => {
  let nowTime = 1000000;
  const { hiveDir } = await createFloor(t);
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hiveDir,
    godId: () => 'valentin-1',
    now: () => nowTime
  });
  const req = lapitaya.openRequest({
    intentId: 'int-exp-4', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  nowTime += 24 * 60 * 60 * 1000 + 1;
  const confirmRes = lapitaya.confirmRequest(req.id, { by: 'human', token: req.token, human: HUMAN });
  assert.strictEqual(confirmRes.ok, false);
});

test('STATE-16: duplicate REQUEST confirmation rejected', async (t) => {
  const { lapitaya } = await createFloor(t);
  const req = lapitaya.openRequest({
    intentId: 'int-dup-1', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  assert.ok(req);
  const first = lapitaya.confirmRequest(req.id, { by: 'human', token: req.token, human: HUMAN });
  assert.strictEqual(first.ok, true);

  const second = lapitaya.confirmRequest(req.id, { by: 'human', token: req.token, human: HUMAN });
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.code, 'NOT_CONFIRMABLE');
});

test('STATE-17: duplicate HIGH approval rejected', async (t) => {
  const { lapitaya } = await createFloor(t);
  const auth = lapitaya.authorize('agent-1', 'Bash', { command: 'rm -rf /tmp/foo' });
  assert.strictEqual(auth.decision, 'HUMAN_APPROVAL_REQUIRED');
  const approvalId = auth.approvalId;
  assert.ok(approvalId);

  const first = lapitaya.decide(approvalId, true, 'human', HUMAN);
  assert.ok(first);
  assert.strictEqual(first.status, 'approved');

  const second = lapitaya.decide(approvalId, true, 'human', HUMAN);
  assert.strictEqual(second, null);
});

test('STATE-18: confirm/cancel race produces one valid result', async (t) => {
  const { lapitaya } = await createFloor(t);
  const req = lapitaya.openRequest({
    intentId: 'int-race-1', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  assert.ok(req);
  const confirmed = lapitaya.confirmRequest(req.id, { by: 'human', token: req.token, human: HUMAN });
  assert.strictEqual(confirmed.ok, true);

  const cancelled = lapitaya.cancelRequest(req.id, 'human', HUMAN);
  assert.strictEqual(cancelled.ok, true); // move CONFIRMED -> CANCELLED is allowed

  const secondConfirm = lapitaya.confirmRequest(req.id, { by: 'human', token: req.token, human: HUMAN });
  assert.strictEqual(secondConfirm.ok, false);
});

test('STATE-19: approve/reject race produces one valid result', async (t) => {
  const { lapitaya } = await createFloor(t);
  const auth = lapitaya.authorize('agent-1', 'Bash', { command: 'rm -rf /tmp/bar' });
  assert.strictEqual(auth.decision, 'HUMAN_APPROVAL_REQUIRED');
  const approvalId = auth.approvalId;
  assert.ok(approvalId);

  const approved = lapitaya.decide(approvalId, true, 'human', HUMAN);
  assert.ok(approved);
  assert.strictEqual(approved.status, 'approved');

  const rejected = lapitaya.decide(approvalId, false, 'human', HUMAN);
  assert.strictEqual(rejected, null);
});

test('STATE-20: concurrent task write protected', async (t) => {
  const { lapitaya } = await createFloor(t);
  const p1 = lapitaya.openRequest({
    intentId: 'int-conc-1', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  const p2 = lapitaya.openRequest({
    intentId: 'int-conc-2', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  assert.ok(p1);
  assert.ok(p2);
  const list = lapitaya.listRequests();
  assert.strictEqual(list.find(x => x.id === p1.id).status, 'SUPERSEDED');
  assert.strictEqual(list.find(x => x.id === p2.id).status, 'PROPOSED');
});

test('STATE-21: concurrent ledger append safe', async (t) => {
  const { lapitaya } = await createFloor(t);
  const t1 = lapitaya.recordTrace('agent-1', 'PostToolUse', 'Read', { file_path: 'a.txt' }, 'ok');
  const t2 = lapitaya.recordTrace('agent-2', 'PostToolUse', 'Read', { file_path: 'b.txt' }, 'ok');
  assert.ok(t1);
  assert.ok(t2);
});

test('STATE-22: multi-instance same Hive protected', async (t) => {
  const { hiveDir } = await createFloor(t);
  const instanceA = new CimaRuntimeService({ hiveRoot: () => hiveDir, godId: () => 'valentin-1' });
  const instanceB = new CimaRuntimeService({ hiveRoot: () => hiveDir, godId: () => 'valentin-1' });

  const reqA = instanceA.openRequest({
    intentId: 'int-multi-1', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  assert.ok(reqA);

  const confirmB = instanceB.confirmRequest(reqA.id, { by: 'human', token: reqA.token, human: HUMAN });
  assert.strictEqual(confirmB.ok, true);
});

test('STATE-23: crash during state write recovered safely', async (t) => {
  const { lapitaya, lapitayaDir } = await createFloor(t);
  // Leave stale tmp file simulating crash mid-write
  writeFileSync(join(lapitayaDir, 'proposals.json.tmp.abcd1234'), 'partial json...', 'utf8');
  writeFileSync(join(lapitayaDir, 'proposals.json'), JSON.stringify([]), 'utf8');

  const list = lapitaya.listRequests();
  assert.deepStrictEqual(list, []);
});

test('STATE-24: crash between state and ledger handled safely', async (t) => {
  const { lapitaya, lapitayaDir } = await createFloor(t);
  // Write proposal to proposals.json without corresponding ledger transition
  const orphanProposal = {
    id: 'req-orphan', intentId: 'int-orphan', executor: 'valentin-1', requestedBy: 'agent-1',
    source: 'user', message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: [],
    scope: 'LOW', status: 'PROPOSED', createdAt: Date.now(), fingerprint: '123', token: 'tok123'
  };
  writeFileSync(join(lapitayaDir, 'proposals.json'), JSON.stringify([orphanProposal]), 'utf8');

  // Attempting execution without confirmation still blocks
  const auth = lapitaya.authorize('valentin-1', 'Write', { file_path: 'src/file.ts', content: 'x' });
  assert.strictEqual(auth.decision, 'DENY');
});

test('STATE-25: missing DECISION never recovered as PASS', async (t) => {
  const { lapitaya } = await createFloor(t);
  lapitaya.handle('valentin-1', 'agent-1', { phase: 'BUILD', taskId: 'task-cima-1' });
  const verdict = lapitaya.completionGate('task-cima-1');
  assert.strictEqual(verdict.allowed, false);
  assert.match(verdict.reason, /no DECISION recorded/);
});

test('STATE-26: missing evidence never recovered as valid', async (t) => {
  const { lapitaya } = await createFloor(t);
  const rec = lapitaya.submit('agent-1', {
    taskId: 'task-1', phase: 'TEST', verdict: 'PASS', summary: 'test pass',
    evidence: [{ type: 'test-result', source: 'npm test', summary: 'all passed' }]
  });
  assert.strictEqual(rec.verdict, 'BLOCKED');
});

test('STATE-27: invalid state transition rejected', async (t) => {
  const { lapitaya } = await createFloor(t);
  const req = lapitaya.openRequest({
    intentId: 'int-trans-1', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  assert.ok(req);
  lapitaya.cancelRequest(req.id, 'human', HUMAN);

  const tryConfirm = lapitaya.confirmRequest(req.id, { by: 'human', token: req.token, human: HUMAN });
  assert.strictEqual(tryConfirm.ok, false);
  assert.strictEqual(tryConfirm.code, 'NOT_CONFIRMABLE');
});

test('STATE-28: expired state cannot return to executable state', async (t) => {
  let nowTime = 1000000;
  const { hiveDir } = await createFloor(t);
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hiveDir, godId: () => 'valentin-1', now: () => nowTime
  });
  const req = lapitaya.openRequest({
    intentId: 'int-exp-5', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  nowTime += 24 * 60 * 60 * 1000 + 1;
  const tryConfirm = lapitaya.confirmRequest(req.id, { by: 'human', token: req.token, human: HUMAN });
  assert.strictEqual(tryConfirm.ok, false);
});

test('STATE-29: recovery does not invent governance facts', async (t) => {
  const { lapitaya, lapitayaDir } = await createFloor(t);
  lapitaya.handle('valentin-1', 'agent-1', { phase: 'BUILD', taskId: 'task-cima-1' });
  try { rmSync(join(lapitayaDir, 'cima-ledger.jsonl')); } catch {}
  const verdict = lapitaya.completionGate('task-cima-1');
  assert.strictEqual(verdict.allowed, false);
});

test('STATE-30: v0.10 authenticity preserved', async (t) => {
  const { lapitaya } = await createFloor(t);
  const auth = lapitaya.authorize('', 'Read', { file_path: 'foo.txt' });
  assert.strictEqual(auth.decision, 'DENY');
  assert.strictEqual(auth.rule, 'ACTOR_CONTEXT_MISSING');
});

test('STATE-31: v0.11 shell governance preserved', async (t) => {
  const { lapitaya } = await createFloor(t);
  const auth = lapitaya.authorize('agent-1', 'Bash', { command: 'echo "done" > tasks.json' });
  assert.strictEqual(auth.decision, 'DENY');
  assert.strictEqual(auth.rule, 'DECISION_GATE');
});

test('STATE-32: v0.11 Decision Gate preserved', async (t) => {
  const { lapitaya } = await createFloor(t);
  lapitaya.handle('valentin-1', 'agent-1', { phase: 'BUILD', taskId: 'task-cima-1' });
  const auth = lapitaya.authorize('agent-1', 'Write', { file_path: 'tasks.json', content: '{"tasks":[{"id":"task-cima-1","status":"done"}]}' });
  assert.strictEqual(auth.decision, 'DENY');
  assert.strictEqual(auth.rule, 'DECISION_GATE');
});

test('STATE-33: v0.11 provider governance preserved', async (t) => {
  const { lapitaya } = await createFloor(t);
  const auth = lapitaya.authorize('agent-1', 'Read', { file_path: 'README.md' });
  assert.strictEqual(auth.decision, 'ALLOW');
});

test('STATE-34: v0.11 evidence correlation preserved', async (t) => {
  const { lapitaya } = await createFloor(t);
  lapitaya.recordTrace('agent-1', 'PostToolUseFailure', 'Bash', { command: 'npm test' }, { output: 'FAILED', interrupted: false });
  const rec = lapitaya.submit('agent-1', {
    taskId: 'task-1', phase: 'TEST', verdict: 'PASS', summary: 'test',
    evidence: [{ type: 'test-result', source: 'npm test', summary: 'failed' }]
  });
  assert.strictEqual(rec.verdict, 'BLOCKED');
});

test('STATE-35: forged governance chain remains blocked', async (t) => {
  const { lapitaya } = await createFloor(t);
  const rec = lapitaya.submit('agent-1', {
    taskId: 'task-1', phase: 'DECISION', verdict: 'PASS', summary: 'accept work', evidence: []
  });
  assert.strictEqual(rec.verdict, 'BLOCKED');
});

// ─── Adversarial Recovery Tests ──────────────────────────────────────────

test('ADVERSARIAL: corrupt proposal state blocks execution after restart', async (t) => {
  const { hiveDir, lapitayaDir } = await createFloor(t);
  writeFileSync(join(lapitayaDir, 'proposals.json'), '{corrupted: true}', 'utf8');

  const restarted = new CimaRuntimeService({ hiveRoot: () => hiveDir, godId: () => 'valentin-1' });
  const req = restarted.openRequest({
    intentId: 'int-adv-1', executor: 'valentin-1', requestedBy: 'agent-1', source: 'user',
    message: 'necesito que revises el estado', taskId: 'task-1', target: null, signals: []
  });
  assert.strictEqual(req, null);
});

test('ADVERSARIAL: corrupt approval state blocks HIGH action after restart', async (t) => {
  const { hiveDir, lapitayaDir } = await createFloor(t);
  writeFileSync(join(lapitayaDir, 'approvals.json'), '{"bad": json}', 'utf8');

  const restarted = new CimaRuntimeService({ hiveRoot: () => hiveDir, godId: () => 'valentin-1', stage: () => 'STAGE_2_SUPERVISED' });
  const auth = restarted.authorize('agent-1', 'Bash', { command: 'rm -rf /tmp' });
  assert.strictEqual(auth.decision, 'DENY');
  assert.strictEqual(auth.rule, 'GOVERNANCE_STATE_CORRUPT');
});

test('ADVERSARIAL: delete DECISION evidence blocks DONE transition after restart', async (t) => {
  const { hiveDir, lapitayaDir } = await createFloor(t);
  const restarted = new CimaRuntimeService({ hiveRoot: () => hiveDir, godId: () => 'valentin-1' });
  restarted.handle('valentin-1', 'agent-1', { phase: 'BUILD', taskId: 'task-cima-1' });
  writeFileSync(join(lapitayaDir, 'cima-ledger.jsonl'), '', 'utf8');

  const restarted2 = new CimaRuntimeService({ hiveRoot: () => hiveDir, godId: () => 'valentin-1' });
  restarted2.handle('valentin-1', 'agent-1', { phase: 'BUILD', taskId: 'task-cima-1' });
  const verdict = restarted2.completionGate('task-cima-1');
  assert.strictEqual(verdict.allowed, false);
});
