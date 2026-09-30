'use strict';
/**
 * La Pitaya CIMA Runtime v0.3 — hardening tests.
 *
 * Three categories, each targeting one of the three observations closed in v0.3:
 *
 *   1. FAIL-CLOSED authorization — every path that cannot establish a decision
 *      must DENY, never ALLOW by default.
 *
 *   2. DECISION GATE — a CIMA-governed task cannot be marked done without a
 *      runtime-recorded DECISION PASS.
 *
 *   3. PROVIDER INDEPENDENCE — governance runs the same regardless of provider.
 *      Demonstrated through a DeterministicTestProvider mock.
 *
 * Plus regression tests that confirm the v0.2 guarantees survive.
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
const { recordBanner, completionVerdict, evaluateSubmission } = loadTs('src/shared/lapitaya/cimaRuntime.ts');
const { authorizeToolCall, isExecutable }  = loadTs('src/shared/lapitaya/governance.ts');
const { phaseForAgent }      = loadTs('src/shared/lapitaya/agents.ts');
const { governanceEnforcement, spawnGovernanceDecision } = loadTs('src/shared/lapitaya/providerGovernance.ts');

// ─── shared fixture ──────────────────────────────────────────────────────────

async function floor(t, config) {
  config = config || { autoMode: true, notifications: false };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v03-'));
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
  hive.setCimaHandler((from, cima, id, to) => recordBanner(lapitaya.handle(from, to, cima, id)));
  const server = new HookServer(hive, () => null, () => config,
    undefined, undefined, undefined, undefined, lapitaya);
  const hook   = (agentId, payload) =>
    server.handle({ agent_id: agentId, session_id: 's-'+agentId, ...payload });
  const pre    = (agentId, tool, input) =>
    hook(agentId, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
  const ran    = (agentId, command, stdout, failed) =>
    hook(agentId, failed
      ? { hook_event_name:'PostToolUseFailure', tool_name:'Bash', tool_input:{command}, error:stdout }
      : { hook_event_name:'PostToolUse', tool_name:'Bash', tool_input:{command}, tool_response:{stdout,stderr:'',interrupted:false} });
  const wrote  = (agentId, file) =>
    hook(agentId, { hook_event_name:'PostToolUse', tool_name:'Edit',
      tool_input:{file_path:file,old_string:'a',new_string:'b'}, tool_response:{} });
  const send   = (from, cima, to) => {
    to = to || 'god';
    const out = path.join(hive.root(), 'agents', from, 'outbox');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'm-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.json'),
      JSON.stringify({ to, act:'inform', subject:cima.phase+' result', body:'agent prose', cima }));
    hive.routeOnce();
    const recs = lapitaya.cimaRecords();
    return recs[recs.length - 1];
  };
  const denied = (r) => !!(r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny');
  return { home, hive, lapitaya, server, events, pre, ran, wrote, send, denied, hook };
}

// ─── SECTION 1: FAIL-CLOSED ─────────────────────────────────────────────────

test('[FC-01] normal LOW authorization -> ALLOW', async (t) => {
  const f = await floor(t);
  const r = await f.pre('valentin-1', 'Read', { file_path: 'src/a.ts' });
  assert.equal(f.denied(r), false, 'LOW read must not be denied');
  assert.equal(f.server.lastPreDecision, 'ALLOW');
});

test('[FC-02] governance-tamper -> HUMAN_APPROVAL_REQUIRED (denied)', async (t) => {
  const f = await floor(t);
  const settings = path.join(f.hive.root(), 'agents', 'el-beni-1', 'settings.json');
  const r = await f.pre('el-beni-1', 'Write', { file_path: settings, content: '{}' });
  assert.equal(f.denied(r), true, 'governance-tamper must be denied');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /HUMAN_APPROVAL_REQUIRED/);
});

test('[FC-03] HIGH risk -> REQUIRE_HUMAN_APPROVAL, NOT executed, pending approval created', async (t) => {
  const f = await floor(t);
  const call = { command: 'rm -rf dist/' };
  const r = await f.pre('el-beni-1', 'Bash', call);
  assert.equal(f.denied(r), true);
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /HUMAN_APPROVAL_REQUIRED/);
  assert.ok(f.lapitaya.listApprovals().some(a => a.status === 'pending'));
  assert.ok(f.events.some(e => e.type === 'approval-request'));
});

test('[FC-04] authorize() throws -> DENY (fail closed)', async (t) => {
  const f = await floor(t);
  const orig = f.lapitaya.authorize.bind(f.lapitaya);
  f.lapitaya.authorize = () => { throw new Error('simulated crash'); };
  const r = await f.pre('valentin-1', 'Read', { file_path: 'src/a.ts' });
  assert.equal(f.denied(r), true, 'throw in authorize() must deny');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /GOVERNANCE_ERROR/);
  assert.equal(f.server.lastPreDecision, 'DENY');
  f.lapitaya.authorize = orig;
  assert.equal(f.denied(await f.pre('valentin-1', 'Read', { file_path: 'src/a.ts' })), false);
});

test('[FC-05] authorize() returns null (invalid) -> DENY', async (t) => {
  const f = await floor(t);
  f.lapitaya.authorize = () => null;
  const r = await f.pre('el-beni-1', 'Edit', { file_path: 'src/a.ts' });
  assert.equal(f.denied(r), true, 'null authorization must deny');
  assert.equal(f.server.lastPreDecision, 'DENY');
});

test('[FC-06] authorize() returns non-executable decision -> DENY', async (t) => {
  const f = await floor(t);
  f.lapitaya.authorize = () => ({ decision:'MAYBE', risk:'LOW', category:'docs', summary:'', rule:'', fingerprint:'' });
  const r = await f.pre('el-beni-1', 'Read', { file_path: 'src/a.ts' });
  assert.equal(f.denied(r), true, 'unknown decision must deny');
  assert.equal(f.server.lastPreDecision, 'DENY');
});

test('[FC-07] risk classifier throws -> DENY (not ALLOW)', () => {
  const auth = authorizeToolCall({
    agentId: 'x', tool: 'UnknownTool', input: {},
    classify: () => { throw new Error('classifier unavailable'); }
  });
  assert.equal(auth.decision, 'DENY');
  assert.ok(auth.rule.includes('RISK_CLASSIFICATION_UNAVAILABLE'));
});

test('[FC-08] risk classifier returns invalid shape -> DENY', () => {
  const auth = authorizeToolCall({
    agentId: 'x', tool: 'Edit', input: {},
    classify: () => ({ category:'INVALID', risk:'UNKNOWN', summary:'', rule:'' })
  });
  assert.equal(auth.decision, 'DENY');
});

test('[FC-09] governance state unavailable (null hive root) -> DENY', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v03-noroot-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  const rootSpy = { returns: home };
  const lapitaya = new CimaRuntimeService({ hiveRoot: () => rootSpy.returns, godId: () => 'god' });
  const server = new HookServer(hive, () => null, () => ({ autoMode:true, notifications:false }),
    undefined, undefined, undefined, undefined, lapitaya);
  const hook = (agentId, payload) => server.handle({ agent_id: agentId, session_id: 's-'+agentId, ...payload });
  // Normal call works
  const r0 = hook('god', { hook_event_name:'PreToolUse', tool_name:'Read', tool_input:{file_path:'x'} });
  assert.ok(!r0 || r0.hookSpecificOutput === undefined || r0.hookSpecificOutput.permissionDecision !== 'deny', 'LOW read allowed');
  // Hive root disappears
  rootSpy.returns = null;
  const r = hook('god', { hook_event_name:'PreToolUse', tool_name:'Read', tool_input:{file_path:'x'} });
  assert.equal(r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /GOVERNANCE_STATE_UNAVAILABLE/);
});

test('[FC-10] PreToolUse with no agentId -> DENY', async (t) => {
  const f = await floor(t);
  const r = f.server.handle({ hook_event_name:'PreToolUse', tool_name:'Read', tool_input:{file_path:'x'} });
  assert.equal(r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /GOVERNANCE_STATE_UNAVAILABLE/);
});

test('[FC-11] PreToolUse with no tool name -> DENY', async (t) => {
  const f = await floor(t);
  const r = f.server.handle({ agent_id:'valentin-1', hook_event_name:'PreToolUse' });
  assert.equal(r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision, 'deny');
});

test('[FC-12] MEDIUM -> SUPERVISED, not denied', async (t) => {
  const f = await floor(t);
  const r = await f.pre('el-beni-1', 'Edit', { file_path:'src/shared/foo.ts', old_string:'a', new_string:'b' });
  assert.equal(f.denied(r), false, 'MEDIUM must not be denied');
  assert.equal(f.server.lastPreDecision, 'SUPERVISED');
  assert.ok(f.events.some(e => e.type === 'supervised'));
});

test('[FC-13] approved HIGH runs exactly once, then requires approval again', async (t) => {
  const f = await floor(t);
  const call = { command: 'git push origin lapitaya/v0.3' };
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', call)), true);
  const [pending] = f.lapitaya.listApprovals();
  f.lapitaya.decide(pending.id, true);
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', call)), false);
  assert.equal(f.lapitaya.listApprovals().find(a => a.id === pending.id).status, 'consumed');
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', call)), true);
});

test('[FC-14] autoMode:true does not bypass HIGH governance', async (t) => {
  const f = await floor(t, { autoMode:true, notifications:false });
  const r = await f.pre('margarito-1', 'Bash', { command:'terraform apply -auto-approve' });
  assert.equal(f.denied(r), true, 'autoMode must not bypass HIGH');
});

// ─── SECTION 2: DECISION GATE ────────────────────────────────────────────────

test('[DG-01] DECISION PASS -> task completion ALLOWED', async (t) => {
  const f = await floor(t);
  const T = 'DG-T1';
  await f.ran('el-beni-1',   'npm test',        'ok');
  f.send('el-beni-1',   { taskId:T, phase:'BUILD',    verdict:'PASS', evidence:[{type:'test-result',     source:'npm test'}] });
  await f.ran('margarito-1', 'npm test',        'ok');
  f.send('margarito-1', { taskId:T, phase:'TEST',     verdict:'PASS', evidence:[{type:'test-result',     source:'npm test'}] });
  await f.ran('jose-juan-1', 'git diff',        'diff');
  f.send('jose-juan-1', { taskId:T, phase:'AUDIT',    verdict:'PASS', evidence:[{type:'diff',            source:'git diff'}] });
  await f.ran('el-tutu-1',   'git log -1',      'abc');
  f.send('el-tutu-1',   { taskId:T, phase:'LEARN',    verdict:'PASS', evidence:[{type:'execution-trace', source:'git log -1'}] });
  await f.ran('god',         'git diff --stat', ' 1 file changed');
  f.send('god',         { taskId:T, phase:'DECISION', verdict:'PASS', evidence:[{type:'diff',            source:'git diff --stat'}] }, 'human');
  const v = f.lapitaya.completionGate(T);
  assert.equal(v.governed, true);
  assert.equal(v.allowed,  true, v.reason);
});

test('[DG-02] no DECISION -> task completion BLOCKED', async (t) => {
  const f = await floor(t);
  const T = 'DG-T2';
  await f.ran('el-beni-1', 'npm test', 'ok');
  f.send('el-beni-1', { taskId:T, phase:'BUILD', verdict:'PASS', evidence:[{type:'test-result', source:'npm test'}] });
  const v = f.lapitaya.completionGate(T);
  assert.equal(v.allowed, false);
  assert.match(v.reason, /DECISION_GATE/);
});

test('[DG-03] DECISION FAIL -> task completion BLOCKED', async (t) => {
  const f = await floor(t);
  const T = 'DG-T3';
  await f.ran('el-beni-1',   'npm test', 'ok');
  f.send('el-beni-1',   { taskId:T, phase:'BUILD', verdict:'PASS', evidence:[{type:'test-result', source:'npm test'}] });
  await f.ran('margarito-1', 'npm test', 'ok');
  f.send('margarito-1', { taskId:T, phase:'TEST',  verdict:'PASS', evidence:[{type:'test-result', source:'npm test'}] });
  await f.ran('jose-juan-1', 'git diff', 'diff');
  f.send('jose-juan-1', { taskId:T, phase:'AUDIT', verdict:'PASS', evidence:[{type:'diff',        source:'git diff'}] });
  await f.ran('god', 'git log -1', 'abc');
  f.send('god', { taskId:T, phase:'DECISION', verdict:'FAIL', evidence:[{type:'execution-trace', source:'git log -1'}] }, 'human');
  const v = f.lapitaya.completionGate(T);
  assert.equal(v.allowed, false);
  assert.match(v.reason, /DECISION_GATE.*FAIL/);
});

test('[DG-04] DECISION BLOCKED (wrong sender) -> task completion BLOCKED', async (t) => {
  const f = await floor(t);
  const T = 'DG-T4';
  await f.ran('valentin-1', 'git log -1', 'abc');
  const rec = f.send('valentin-1', { taskId:T, phase:'DECISION', verdict:'PASS',
    evidence:[{type:'execution-trace', source:'git log -1'}] });
  assert.ok(rec.violations.includes('DECISION_AUTHORITY'));
  assert.equal(f.lapitaya.completionGate(T).allowed, false);
});

test('[DG-05] ungoverned task (no CIMA history) is not gated', async (t) => {
  const f = await floor(t);
  const v = f.lapitaya.completionGate('PLAIN-TASK');
  assert.equal(v.governed, false);
  assert.equal(v.allowed,  true);
});

test('[DG-06] Write to tasks.json marking CIMA task done without DECISION -> denied at PreToolUse', async (t) => {
  const f = await floor(t);
  const T = 'DG-T6';
  const tasksPath = path.join(f.hive.root(), 'tasks.json');
  fs.writeFileSync(tasksPath, JSON.stringify({ tasks:[{ id:T, title:'x', status:'doing', assignee:'el-beni-1' }] }));
  await f.ran('el-beni-1', 'npm test', 'ok');
  f.send('el-beni-1', { taskId:T, phase:'BUILD', verdict:'PASS', evidence:[{type:'test-result', source:'npm test'}] });
  const afterContent = JSON.stringify({ tasks:[{ id:T, title:'x', status:'done', assignee:'el-beni-1' }] });
  const r = await f.pre('el-beni-1', 'Write', { file_path: tasksPath, content: afterContent });
  assert.equal(f.denied(r), true, 'marking done without DECISION must be blocked');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /DECISION_GATE/);
  assert.equal(f.lapitaya.completionGate(T).allowed, false);
});

test('[DG-07] rebuilding after DECISION invalidates completion gate', async (t) => {
  const f = await floor(t);
  const T = 'DG-T7';
  const chain = async () => {
    await f.ran('el-beni-1',   'npm test',        'ok');
    f.send('el-beni-1',   { taskId:T, phase:'BUILD',    verdict:'PASS', evidence:[{type:'test-result', source:'npm test'}] });
    await f.ran('margarito-1', 'npm test',        'ok');
    f.send('margarito-1', { taskId:T, phase:'TEST',     verdict:'PASS', evidence:[{type:'test-result', source:'npm test'}] });
    await f.ran('jose-juan-1', 'git diff',        'diff');
    f.send('jose-juan-1', { taskId:T, phase:'AUDIT',    verdict:'PASS', evidence:[{type:'diff',        source:'git diff'}] });
    await f.ran('el-tutu-1',   'git log -1',      'abc');
    f.send('el-tutu-1',   { taskId:T, phase:'LEARN',    verdict:'PASS', evidence:[{type:'execution-trace', source:'git log -1'}] });
    await f.ran('god',         'git diff --stat', 'ok');
    f.send('god',         { taskId:T, phase:'DECISION', verdict:'PASS', evidence:[{type:'diff',        source:'git diff --stat'}] }, 'human');
  };
  await chain();
  assert.equal(f.lapitaya.completionGate(T).allowed, true);
  await f.ran('el-beni-1', 'npm test', 'ok again');
  f.send('el-beni-1', { taskId:T, phase:'BUILD', verdict:'PASS', evidence:[{type:'test-result', source:'npm test'}] });
  const v = f.lapitaya.completionGate(T);
  assert.equal(v.allowed, false);
  assert.match(v.reason, /rebuilt after/);
});

// ─── SECTION 3: PROVIDER INDEPENDENCE ───────────────────────────────────────

test('[PI-01] governanceEnforcement classifies providers', () => {
  assert.equal(governanceEnforcement('claude'),  'blocking');
  assert.equal(governanceEnforcement('codex'),   'blocking');
  assert.equal(governanceEnforcement('agy'),     'blocking');
  assert.equal(governanceEnforcement('gemini'),  'blocking');
  assert.equal(governanceEnforcement('grok'),    'blocking');
  assert.notEqual(governanceEnforcement('kimi'), 'blocking');
});

test('[PI-02] blocking providers are allowed to spawn', () => {
  for (const p of ['claude', 'codex', 'agy', 'gemini', 'grok']) {
    assert.equal(spawnGovernanceDecision(p).allowed, true, p);
  }
});

test('[PI-03] non-blocking provider rejected by default (fail closed)', () => {
  const d = spawnGovernanceDecision('kimi');
  assert.equal(d.allowed, false);
  assert.match(d.reason, /LAPITAYA_GOVERNANCE_UNENFORCEABLE/);
});

test('[PI-04] human override lets non-blocking through, logged', () => {
  const d = spawnGovernanceDecision('kimi', { allowUngoverned:true });
  assert.equal(d.allowed, true);
  assert.equal(d.overridden, true);
  assert.match(d.reason, /human override/);
});

test('[PI-05] DeterministicTestProvider: MEDIUM -> SUPERVISED, HIGH -> REQUIRE_HUMAN_APPROVAL', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v03-mock-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id:'god', name:'El Inge', provider:'claude', cwd:home, isGod:true });
  await hive.ensureAgent({ id:'mock-agent', name:'Mock', provider:'codex', cwd:home });
  const events = [];
  let clock = 2_000_000_000_000;

  // MEDIUM classifier mock
  const lapitayaMed = new CimaRuntimeService({
    hiveRoot: () => hive.root(), godId: () => 'god',
    onEvent: (e) => events.push(e), now: () => (clock += 500),
    classify: () => ({ category:'code-change', risk:'MEDIUM', summary:'mock-medium', rule:'mock' }),
  });
  hive.setCimaHandler((from, cima, id, to) => recordBanner(lapitayaMed.handle(from, to, cima, id)));
  const serverMed = new HookServer(hive, () => null, () => ({autoMode:true, notifications:false}),
    undefined, undefined, undefined, undefined, lapitayaMed);
  const r1 = serverMed.handle({ agent_id:'mock-agent', session_id:'s1', hook_event_name:'PreToolUse', tool_name:'Read', tool_input:{file_path:'x'} });
  assert.ok(!r1 || !r1.hookSpecificOutput || r1.hookSpecificOutput.permissionDecision !== 'deny', 'MEDIUM must not deny');
  assert.ok(events.some(e => e.type === 'supervised'));

  // HIGH classifier mock
  const lapitayaHigh = new CimaRuntimeService({
    hiveRoot: () => hive.root(), godId: () => 'god',
    onEvent: (e) => events.push(e), now: () => (clock += 500),
    classify: () => ({ category:'destructive-migration', risk:'HIGH', summary:'mock-high', rule:'mock' }),
  });
  const serverHigh = new HookServer(hive, () => null, () => ({autoMode:true, notifications:false}),
    undefined, undefined, undefined, undefined, lapitayaHigh);
  const r2 = serverHigh.handle({ agent_id:'mock-agent', session_id:'s2', hook_event_name:'PreToolUse', tool_name:'Bash', tool_input:{command:'anything'} });
  assert.equal(r2 && r2.hookSpecificOutput && r2.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r2.hookSpecificOutput.permissionDecisionReason, /HUMAN_APPROVAL_REQUIRED/);
  assert.ok(events.some(e => e.type === 'approval-request'));
});

test('[PI-06] evidence and CIMA evaluation are provider-agnostic', () => {
  const traces = [
    { id:'t1', ts:100, agentId:'mock-agent', kind:'command', tool:'Bash', subject:'npm test', ok:true }
  ];
  const rec1 = evaluateSubmission({ records:[], traces, godId:'god' },
    { taskId:'P1', phase:'BUILD', verdict:'PASS', evidence:[{type:'test-result', source:'npm test'}] },
    'mock-agent', 200);
  assert.equal(rec1.verdict, 'PASS', rec1.reasons.join(' '));
  const rec2 = evaluateSubmission({ records:[], traces, godId:'god' },
    { taskId:'P2', phase:'BUILD', verdict:'PASS', evidence:[{type:'test-result', source:'npm run build'}] },
    'mock-agent', 200);
  assert.equal(rec2.verdict, 'BLOCKED');
  assert.ok(rec2.violations.includes('EVIDENCE_FIRST'));
});

// ─── SECTION 4: REGRESSION ───────────────────────────────────────────────────

test('[RG-01] BUILDER != AUDITOR still blocked after v0.3 hardening', async (t) => {
  const f = await floor(t);
  await f.ran('el-beni-1', 'npm test', 'ok');
  f.send('el-beni-1', { taskId:'RG1', phase:'BUILD', verdict:'PASS', evidence:[{type:'test-result', source:'npm test'}] });
  await f.ran('margarito-1', 'npm test', 'ok');
  f.send('margarito-1', { taskId:'RG1', phase:'TEST', verdict:'PASS', evidence:[{type:'test-result', source:'npm test'}] });
  await f.ran('el-beni-1', 'git diff', 'diff');
  const rec = f.send('el-beni-1', { taskId:'RG1', phase:'AUDIT', verdict:'PASS', evidence:[{type:'diff', source:'git diff'}] });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('BUILDER_NOT_AUDITOR'));
});

test('[RG-02] EVIDENCE FIRST still blocks PASS with no real trace', async (t) => {
  const f = await floor(t);
  const rec = f.send('el-beni-1', { taskId:'RG2', phase:'BUILD', verdict:'PASS',
    evidence:[{type:'test-result', source:'npm test', result:'all green, trust me'}] });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('EVIDENCE_FIRST'));
});

test('[RG-03] AUTONOMY POLICY: LOW->ALLOW, MEDIUM->SUPERVISED, HIGH->DENY', async (t) => {
  const f = await floor(t);
  const low = await f.pre('valentin-1', 'Read', { file_path:'src/a.ts' });
  assert.equal(f.denied(low), false);
  assert.equal(f.server.lastPreDecision, 'ALLOW');
  const med = await f.pre('el-beni-1', 'Edit', { file_path:'src/b.ts', old_string:'a', new_string:'b' });
  assert.equal(f.denied(med), false);
  assert.equal(f.server.lastPreDecision, 'SUPERVISED');
  const high = await f.pre('el-beni-1', 'Bash', { command:'rm -rf /' });
  assert.equal(f.denied(high), true);
});

test('[RG-04] DECISION_AUTHORITY: only El Inge or human may accept work', async (t) => {
  const f = await floor(t);
  await f.ran('el-tutu-1', 'git log -1', 'abc');
  const rec = f.send('el-tutu-1', { taskId:'RG4', phase:'DECISION', verdict:'PASS',
    evidence:[{type:'execution-trace', source:'git log -1'}] });
  assert.ok(rec.violations.includes('DECISION_AUTHORITY'));
});

test('[RG-05] HIGH approval regression: deny->approve->one execution->deny again', async (t) => {
  const f = await floor(t);
  const call = { command:'node scripts/migrate.cjs --drop-all-tables' };
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', call)), true);
  const [pending] = f.lapitaya.listApprovals();
  f.lapitaya.decide(pending.id, true);
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', call)), false);
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', call)), true);
});

test('[RG-06] TRANSITION: TEST PASS requires BUILD PASS', async (t) => {
  const f = await floor(t);
  await f.ran('margarito-1', 'npm test', 'ok');
  const rec = f.send('margarito-1', { taskId:'RG6', phase:'TEST', verdict:'PASS',
    evidence:[{type:'test-result', source:'npm test'}] });
  assert.ok(rec.violations.includes('TRANSITION'));
});

test('[RG-07] assignment without verdict is not a claim', async (t) => {
  const f = await floor(t);
  const out = path.join(f.hive.root(), 'agents', 'god', 'outbox');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'assign.json'), JSON.stringify({
    to:'el-beni-1', act:'request', subject:'BUILD please', body:'go',
    cima:{ taskId:'RG7', phase:'BUILD' }
  }));
  f.hive.routeOnce();
  const last = f.lapitaya.ledger().pop();
  assert.equal(last.kind, 'cima-assignment');
  assert.equal(f.lapitaya.cimaRecords('RG7').length, 0);
});

test('[RG-08] full CIMA cycle records PASS at every phase and opens completion gate', async (t) => {
  const f = await floor(t);
  const T = 'FULL-CYCLE-V03';
  const step = async (agent, phase, command, to) => {
    to = to || 'god';
    await f.ran(agent, command, 'ok');
    return f.send(agent, { taskId:T, phase, verdict:'PASS',
      evidence:[{type:'execution-trace', source:command}] }, to);
  };
  const ctx  = await step('god',         'CONTEXT',   'git status --short', 'valentin-1');
  const arch = await step('valentin-1',  'ARCHITECT', 'git ls-files src');
  await f.wrote('el-beni-1', 'src/greet.cjs');
  const build = await step('el-beni-1',  'BUILD',     'git diff --stat');
  const tst   = await step('margarito-1','TEST',      'node --test test/greet.test.cjs');
  const aud   = await step('jose-juan-1','AUDIT',     'git diff');
  const learn = await step('el-tutu-1',  'LEARN',     'git log --oneline -3');
  const dec   = await step('god',        'DECISION',  'git status', 'human');
  const it    = await step('god',        'ITERATE',   'git log -1',  'human');
  for (const r of [ctx, arch, build, tst, aud, learn, dec, it]) {
    assert.equal(r.verdict, 'PASS', r.phase + ': ' + r.reasons.join(' '));
  }
  const v = f.lapitaya.completionGate(T);
  assert.equal(v.governed, true);
  assert.equal(v.allowed,  true, v.reason);
});