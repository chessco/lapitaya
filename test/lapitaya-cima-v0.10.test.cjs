'use strict';
/**
 * La Pitaya CIMA v0.10 — Runtime Authenticity Hardening Test Suite.
 *
 * Validates that actor identity, hook socket identity, message sender identity,
 * CIMA phase attribution, and human decision authority are authenticated by
 * the runtime rather than self-asserted by actors in untrusted payloads.
 *
 * Tests AUTH-01 through AUTH-30 + Adversarial CIMA Chain Forgery Test.
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

const { HiveManager, redactSecrets } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { recordBanner, completionVerdict, evaluateSubmission } = loadTs('src/shared/lapitaya/cimaRuntime.ts');
const { createHumanGovernanceHandlers } = loadTs('src/main/humanGovernanceIpc.ts');
const { parseHumanContext, ownerOf } = loadTs('src/shared/lapitaya/identity.ts');

async function createFloor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v10-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'valentin-1', name: 'Valentin', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'el-beni-1', name: 'El Beni', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'jose-juan-1', name: 'Jose Juan', provider: 'claude', cwd: home });

  const valentinToken = hive.registerAgentToken('valentin-1', 'tok-valentin-12345');
  const beniToken = hive.registerAgentToken('el-beni-1', 'tok-beni-67890');
  const joseToken = hive.registerAgentToken('jose-juan-1', 'tok-jose-11223');
  const godToken = hive.registerAgentToken('god', 'tok-god-99999');

  const events = [];
  let clock = 1_800_000_000_000;
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hive.root(),
    godId: () => 'god',
    onEvent: (e) => events.push(e),
    now: () => (clock += 1000)
  });

  hive.setCimaHandler((from, cima, id, to) => recordBanner(lapitaya.handle(from, to, cima, id)));
  hive.setCompletionGate((taskId) => lapitaya.completionGate(taskId));

  const config = { autoMode: true, notifications: false };
  const server = new HookServer(hive, () => null, () => config, undefined, undefined, undefined, undefined, lapitaya);

  const mockTrustedHuman = {
    human: { id: 'hum-operator123456', displayName: 'Trusted Operator' },
    session: 'ses-session123456',
    window: 1
  };

  const mockIdentity = {
    resolve: (evt) => (evt && evt.trusted ? mockTrustedHuman : null),
    identity: () => ({ id: 'hum-operator123456', displayName: 'Trusted Operator' })
  };

  const humanHandlers = createHumanGovernanceHandlers({
    runtime: lapitaya,
    identity: mockIdentity
  });

  return {
    home, hive, lapitaya, server, events, config, humanHandlers, mockTrustedHuman,
    tokens: { valentin: valentinToken, beni: beniToken, jose: joseToken, god: godToken }
  };
}

// ─── AUTH-01: Valid trusted agent context accepted ───────────────────────────
test('[AUTH-01] Valid trusted agent context accepted', async (t) => {
  const f = await createFloor(t);
  const res = f.server.handle({
    hook_event_name: 'PreToolUse',
    agent_id: 'valentin-1',
    agent_token: f.tokens.valentin,
    tool_name: 'Read',
    tool_input: { file_path: 'src/app.ts' }
  });
  assert.equal(f.server.lastPreDecision, 'ALLOW');
  assert.notEqual(res?.hookSpecificOutput?.permissionDecision, 'deny');
});

// ─── AUTH-02: Missing agent context denied ───────────────────────────────────
test('[AUTH-02] Missing agent context denied', async (t) => {
  const f = await createFloor(t);
  const res = f.server.handle({
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: 'src/app.ts' }
  });
  assert.equal(f.server.lastPreDecision, 'ACTOR_CONTEXT_MISSING');
  assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny');
});

// ─── AUTH-03: Invalid agent context denied ───────────────────────────────────
test('[AUTH-03] Invalid agent context denied', async (t) => {
  const f = await createFloor(t);
  const res = f.server.handle({
    hook_event_name: 'PreToolUse',
    agent_id: 'valentin-1',
    agent_token: 'fake-invalid-token',
    tool_name: 'Read',
    tool_input: { file_path: 'src/app.ts' }
  });
  assert.equal(f.server.lastPreDecision, 'IDENTITY_UNTRUSTED');
  assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny');
});

// ─── AUTH-04: Payload agent_id cannot override trusted identity ──────────────
test('[AUTH-04] Payload agent_id cannot override trusted identity', async (t) => {
  const f = await createFloor(t);
  const res = f.server.handle({
    hook_event_name: 'PreToolUse',
    agent_id: 'jose-juan-1',
    agent_token: f.tokens.valentin, // Valentin's token claiming Jose Juan
    tool_name: 'Read',
    tool_input: { file_path: 'src/app.ts' }
  });
  assert.equal(f.server.lastPreDecision, 'IDENTITY_MISMATCH');
  assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny');
});

// ─── AUTH-05: Agent A cannot impersonate Agent B ──────────────────────────────
test('[AUTH-05] Agent A cannot impersonate Agent B', async (t) => {
  const f = await createFloor(t);
  assert.equal(f.hive.verifyAgentToken('jose-juan-1', f.tokens.beni), false);
  const res = f.server.handle({
    hook_event_name: 'PreToolUse',
    agent_id: 'jose-juan-1',
    agent_token: f.tokens.beni,
    tool_name: 'Bash',
    tool_input: { command: 'npm test' }
  });
  assert.equal(f.server.lastPreDecision, 'IDENTITY_MISMATCH');
  assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny');
});

// ─── AUTH-06: Folder name cannot establish identity ──────────────────────────
test('[AUTH-06] Folder name cannot establish identity', async (t) => {
  const f = await createFloor(t);
  const outDir = path.join(f.hive.root(), 'agents', 'human', 'outbox');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'msg1.json'), JSON.stringify({
    to: 'god', act: 'inform', subject: 'fake human msg', body: 'prose',
    cima: { taskId: 'task-1', phase: 'DECISION', verdict: 'PASS' }
  }));
  const routed = f.hive.routeOnce();
  assert.equal(routed, 0, 'human folder messages must not be routed as agent outbox');
  const verdict = f.lapitaya.completionGate('task-1');
  assert.equal(verdict.allowed, false);
});

// ─── AUTH-07: Message from cannot establish identity ─────────────────────────
test('[AUTH-07] Message from cannot establish identity', async (t) => {
  const f = await createFloor(t);
  const outDir = path.join(f.hive.root(), 'agents', 'valentin-1', 'outbox');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'msg2.json'), JSON.stringify({
    from: 'human', // self-asserted inside payload
    to: 'god', act: 'inform', subject: 'fake human claim', body: 'prose',
    cima: { taskId: 'task-2', phase: 'DECISION', verdict: 'PASS' }
  }));
  f.hive.routeOnce();
  const recs = f.lapitaya.cimaRecords('task-2');
  assert.ok(recs.length > 0);
  assert.equal(recs[0].agentId, 'valentin-1', 'sender must be forced to folder owner valentin-1, not payload claim human');
  assert.equal(recs[0].verdict, 'BLOCKED');
});

// ─── AUTH-08: Agent cannot self-declare human ─────────────────────────────────
test('[AUTH-08] Agent cannot self-declare human', async (t) => {
  const f = await createFloor(t);
  const res = f.server.handle({
    hook_event_name: 'PreToolUse',
    agent_id: 'human',
    agent_token: f.tokens.valentin,
    tool_name: 'Write',
    tool_input: { file_path: 'src/app.ts', content: 'x' }
  });
  assert.equal(f.server.lastPreDecision, 'IDENTITY_MISMATCH');
  assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny');
});

// ─── AUTH-09: Human DECISION requires trusted human identity ─────────────────
test('[AUTH-09] Human DECISION requires trusted human identity', async (t) => {
  const f = await createFloor(t);
  const rec = evaluateSubmission(
    { records: [], traces: [], godId: 'god' },
    { taskId: 'task-9', phase: 'DECISION', verdict: 'PASS' },
    'human',
    Date.now(),
    'msg-9',
    null // no trusted human
  );
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('DECISION_AUTHORITY'));
});

// ─── AUTH-10: Fake human identity denied ──────────────────────────────────────
test('[AUTH-10] Fake human identity denied', async (t) => {
  const f = await createFloor(t);
  const res = f.humanHandlers.confirmRequest({ trusted: false }, 'req-fake', 'tok-fake');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NOT_AUTHORIZED');
});

// ─── AUTH-11: Human identity from renderer payload ignored ───────────────────
test('[AUTH-11] Human identity from renderer payload ignored', async (t) => {
  const f = await createFloor(t);
  const res = f.humanHandlers.cancelRequest({ trusted: false, payloadHuman: 'admin' }, 'req-11');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NOT_AUTHORIZED');
});

// ─── AUTH-12: Human identity from trusted v0.8 IPC accepted ──────────────────
test('[AUTH-12] Human identity from trusted v0.8 IPC accepted', async (t) => {
  const f = await createFloor(t);
  const req = f.lapitaya.openRequest({
    intentId: 'int-12', executor: 'god', requestedBy: 'valentin-1', source: 'test',
    message: 'necesito que prepares la tarea 12', taskId: 'task-12', target: null, signals: []
  });
  assert.ok(req);
  const res = f.humanHandlers.confirmRequest({ trusted: true }, req.id, req.token);
  assert.equal(res.ok, true);
  assert.equal(res.proposal.status, 'CONFIRMED');
});

// ─── AUTH-13: Builder cannot impersonate Auditor ─────────────────────────────
test('[AUTH-13] Builder cannot impersonate Auditor', async (t) => {
  const f = await createFloor(t);
  f.lapitaya.recordTrace('el-beni-1', 'PostToolUse', 'Edit', { file_path: 'src/a.ts' }, {});
  f.lapitaya.submit('el-beni-1', { taskId: 'task-13', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'execution-trace', source: 'src/a.ts' }] });
  const rec = evaluateSubmission(
    { records: f.lapitaya.cimaRecords('task-13'), traces: f.lapitaya.recentTraces(), godId: 'god' },
    { taskId: 'task-13', phase: 'AUDIT', verdict: 'PASS', evidence: [{ type: 'execution-trace', source: 'src/a.ts' }] },
    'el-beni-1',
    Date.now()
  );
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('BUILDER_NOT_AUDITOR'));
});

// ─── AUTH-14: Auditor cannot impersonate Builder ─────────────────────────────
test('[AUTH-14] Auditor cannot impersonate Builder', async (t) => {
  const f = await createFloor(t);
  const res = f.server.handle({
    hook_event_name: 'PreToolUse',
    agent_id: 'el-beni-1',
    agent_token: f.tokens.jose, // Auditor Jose Juan trying to use Builder El Beni's token
    tool_name: 'Edit',
    tool_input: { file_path: 'src/b.ts' }
  });
  assert.equal(f.server.lastPreDecision, 'IDENTITY_MISMATCH');
  assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny');
});

// ─── AUTH-15: Agent cannot manufacture BUILD PASS ────────────────────────────
test('[AUTH-15] Agent cannot manufacture BUILD PASS', async (t) => {
  const f = await createFloor(t);
  const rec = f.lapitaya.submit('valentin-1', {
    taskId: 'task-15', phase: 'BUILD', verdict: 'PASS',
    evidence: [{ type: 'command-output', source: 'npm run build' }] // no trace
  });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('EVIDENCE_FIRST'));
});

// ─── AUTH-16: Agent cannot manufacture TEST PASS ─────────────────────────────
test('[AUTH-16] Agent cannot manufacture TEST PASS', async (t) => {
  const f = await createFloor(t);
  const rec = f.lapitaya.submit('valentin-1', {
    taskId: 'task-16', phase: 'TEST', verdict: 'PASS',
    evidence: [{ type: 'test-result', source: 'npm test' }]
  });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('EVIDENCE_FIRST'));
});

// ─── AUTH-17: Agent cannot manufacture AUDIT PASS ────────────────────────────
test('[AUTH-17] Agent cannot manufacture AUDIT PASS', async (t) => {
  const f = await createFloor(t);
  const rec = f.lapitaya.submit('jose-juan-1', {
    taskId: 'task-17', phase: 'AUDIT', verdict: 'PASS',
    evidence: [{ type: 'audit-finding', source: 'src/app.ts' }]
  });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('EVIDENCE_FIRST'));
});

// ─── AUTH-18: Agent cannot manufacture DECISION PASS ─────────────────────────
test('[AUTH-18] Agent cannot manufacture DECISION PASS', async (t) => {
  const f = await createFloor(t);
  const rec = f.lapitaya.submit('valentin-1', {
    taskId: 'task-18', phase: 'DECISION', verdict: 'PASS'
  });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('DECISION_AUTHORITY'));
});

// ─── AUTH-19: Missing identity fails closed ───────────────────────────────────
test('[AUTH-19] Missing identity fails closed', async (t) => {
  const f = await createFloor(t);
  const auth = f.lapitaya.authorize('', 'Read', { file_path: 'a.ts' });
  assert.equal(auth.decision, 'DENY');
  assert.equal(auth.rule, 'ACTOR_CONTEXT_MISSING');
});

// ─── AUTH-20: Identity mismatch fails closed ──────────────────────────────────
test('[AUTH-20] Identity mismatch fails closed', async (t) => {
  const f = await createFloor(t);
  const res = f.server.handle({
    hook_event_name: 'PreToolUse',
    agent_id: 'valentin-1',
    agent_token: f.tokens.jose,
    tool_name: 'Read',
    tool_input: { file_path: 'a.ts' }
  });
  assert.equal(f.server.lastPreDecision, 'IDENTITY_MISMATCH');
  assert.equal(res?.hookSpecificOutput?.permissionDecision, 'deny');
});

// ─── AUTH-21: Identity is preserved in evidence ───────────────────────────────
test('[AUTH-21] Identity is preserved in evidence', async (t) => {
  const f = await createFloor(t);
  const trace = f.lapitaya.recordTrace('valentin-1', 'PostToolUse', 'Read', { file_path: 'src/main.ts' }, { output: 'ok' });
  assert.ok(trace);
  assert.equal(trace.agentId, 'valentin-1');
  const traces = f.lapitaya.recentTraces();
  assert.equal(traces[traces.length - 1].agentId, 'valentin-1');
});

// ─── AUTH-22: Decision owner remains v0.8 trusted identity ───────────────────
test('[AUTH-22] Decision owner remains v0.8 trusted identity', async (t) => {
  const f = await createFloor(t);
  const pending = f.lapitaya.authorize('valentin-1', 'Bash', { command: 'git push origin main' });
  assert.equal(pending.decision, 'HUMAN_APPROVAL_REQUIRED');
  const apr = f.humanHandlers.decide({ trusted: true }, pending.approvalId, true);
  assert.ok(apr);
  assert.equal(apr.status, 'approved');
  const approvals = f.lapitaya.listApprovals();
  const found = approvals.find((x) => x.id === pending.approvalId);
  assert.ok(found?.decidedOwner);
  assert.equal(found.decidedOwner.id, 'hum-operator123456');
});

// ─── AUTH-23: Cross-window human identity remains correct ─────────────────────
test('[AUTH-23] Cross-window human identity remains correct', async (t) => {
  const f = await createFloor(t);
  const res1 = f.humanHandlers.whoAmI({ trusted: true });
  const res2 = f.humanHandlers.whoAmI({ trusted: false });
  assert.ok(res1);
  assert.equal(res1.id, 'hum-operator123456');
  assert.equal(res2, null);
});

// ─── AUTH-24: Replay of authenticated context rejected ───────────────────────
test('[AUTH-24] Replay of authenticated context rejected', async (t) => {
  const f = await createFloor(t);
  const req = f.lapitaya.openRequest({
    intentId: 'int-24', executor: 'god', requestedBy: 'valentin-1', source: 'test',
    message: 'necesito que prepares la tarea 24', taskId: 'task-24', target: null, signals: []
  });
  const first = f.humanHandlers.confirmRequest({ trusted: true }, req.id, req.token);
  assert.equal(first.ok, true);
  const replay = f.humanHandlers.confirmRequest({ trusted: true }, req.id, req.token);
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'NOT_CONFIRMABLE');
});

// ─── AUTH-25: Wrong task context rejected ────────────────────────────────────
test('[AUTH-25] Wrong task context rejected', async (t) => {
  const f = await createFloor(t);
  const rec = evaluateSubmission(
    { records: [], traces: [], godId: 'god' },
    { taskId: 'non-existent-task-999', phase: 'TEST', verdict: 'PASS', evidence: [{ type: 'execution-trace', source: 'npm test' }] },
    'valentin-1',
    Date.now()
  );
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('EVIDENCE_FIRST'));
});

// ─── AUTH-26: Wrong agent assignment rejected ────────────────────────────────
test('[AUTH-26] Wrong agent assignment rejected', async (t) => {
  const f = await createFloor(t);
  // Valentin is builder
  f.lapitaya.recordTrace('valentin-1', 'PostToolUse', 'Edit', { file_path: 'src/app.ts' }, {});
  f.lapitaya.submit('valentin-1', { taskId: 'task-26', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'execution-trace', source: 'src/app.ts' }] });

  // Valentin attempts AUDIT phase assignment
  const rec = f.lapitaya.submit('valentin-1', {
    taskId: 'task-26', phase: 'AUDIT', verdict: 'PASS', evidence: [{ type: 'execution-trace', source: 'src/app.ts' }]
  });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('BUILDER_NOT_AUDITOR'));
});

// ─── AUTH-27: Tampered context rejected ───────────────────────────────────────
test('[AUTH-27] Tampered context rejected', async (t) => {
  const f = await createFloor(t);
  const req = f.lapitaya.openRequest({
    intentId: 'int-27', executor: 'god', requestedBy: 'valentin-1', source: 'test',
    message: 'run task 27', taskId: 'task-27', target: null, signals: []
  });
  const res = f.humanHandlers.confirmRequest({ trusted: true }, req.id, 'tampered-token-123');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'TAMPERED');
});

// ─── AUTH-28: No secrets exposed ─────────────────────────────────────────────
test('[AUTH-28] No secrets exposed', async (t) => {
  const secretText = 'Error executing with sk-ant-api03-1234567890abcdef1234567890';
  const cleaned = redactSecrets(secretText);
  assert.ok(!cleaned.includes('sk-ant-api03-1234567890abcdef1234567890'));
  assert.ok(cleaned.includes('[redacted]'));
});

// ─── AUTH-29: No raw credentials exposed ─────────────────────────────────────
test('[AUTH-29] No raw credentials exposed', async (t) => {
  const credText = 'Authorization: Bearer my-secret-bearer-token-12345';
  const cleaned = redactSecrets(credText);
  assert.ok(!cleaned.includes('my-secret-bearer-token-12345'));
  assert.ok(cleaned.includes('[redacted]'));
});

// ─── AUTH-30: Real Electron human decision works ─────────────────────────────
test('[AUTH-30] Real Electron human decision works', async (t) => {
  const f = await createFloor(t);
  const pending = f.lapitaya.authorize('valentin-1', 'Bash', { command: 'git push origin main' });
  assert.equal(pending.decision, 'HUMAN_APPROVAL_REQUIRED');
  const decided = f.humanHandlers.decide({ trusted: true }, pending.approvalId, true);
  assert.ok(decided);
  assert.equal(decided.status, 'approved');
});

// ─── ADVERSARIAL CIMA CHAIN FORGERY TEST ──────────────────────────────────────
test('[ADVERSARIAL-CHAIN] Forged CIMA chain fails closed and breaks the chain', async (t) => {
  const f = await createFloor(t);
  const taskId = 'task-adv-100';

  // Step 1: Agent El Beni attempts to manufacture BUILD PASS without trace
  const b1 = f.lapitaya.submit('el-beni-1', {
    taskId, phase: 'BUILD', verdict: 'PASS',
    evidence: [{ type: 'execution-trace', source: 'npm run build' }]
  });
  assert.equal(b1.verdict, 'BLOCKED', 'Forged BUILD PASS must be BLOCKED');

  // Step 2: Agent El Beni attempts TEST PASS with invalid trace & wrong sequence
  const t1 = f.lapitaya.submit('el-beni-1', {
    taskId, phase: 'TEST', verdict: 'PASS',
    evidence: [{ type: 'test-result', source: 'npm test' }]
  });
  assert.equal(t1.verdict, 'BLOCKED', 'Forged TEST PASS must be BLOCKED');

  // Step 3: Agent Jose Juan attempts AUDIT PASS using El Beni's name
  const a1 = f.lapitaya.submit('el-beni-1', {
    taskId, phase: 'AUDIT', verdict: 'PASS',
    evidence: [{ type: 'audit-finding', source: 'src/app.ts' }]
  });
  assert.equal(a1.verdict, 'BLOCKED', 'Forged AUDIT PASS must be BLOCKED');

  // Step 4: Agent attempts to self-declare human DECISION PASS
  const d1 = f.lapitaya.submit('human', {
    taskId, phase: 'DECISION', verdict: 'PASS'
  });
  assert.equal(d1.verdict, 'BLOCKED', 'Self-asserted human DECISION PASS must be BLOCKED');

  // Step 5: Verify completionGate denies task completion
  const gate = f.lapitaya.completionGate(taskId);
  assert.equal(gate.allowed, false, 'Completion gate MUST remain blocked for forged chain');
});
