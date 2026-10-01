'use strict';
/**
 * La Pitaya CIMA Runtime v0.2 — governance and CIMA rules ENFORCED at runtime.
 *
 * These drive the REAL HookServer (the PreToolUse/PostToolUse boundary every
 * agent tool call crosses) and the REAL HiveManager router (where `cima` claims
 * are evaluated), wired to the real CimaRuntimeService — the same objects
 * src/main/index.ts builds. Only electron's Notification is stubbed.
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

const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { recordBanner, evaluateSubmission } = loadTs('src/shared/lapitaya/cimaRuntime.ts');
const { classifyToolCall } = loadTs('src/shared/lapitaya/toolRisk.ts');
const { authorizeToolCall } = loadTs('src/shared/lapitaya/governance.ts');
const { phaseForAgent } = loadTs('src/shared/lapitaya/agents.ts');

// ─── fixture: a hive with El Inge + the five CIMA agents ────────────────────

async function floor(t, config = { autoMode: true, notifications: false }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lapitaya-cima-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  for (const [id, name] of [['valentin-1', 'Valentín'], ['el-beni-1', 'El Beni'], ['margarito-1', 'Margarito'],
    ['jose-juan-1', 'José Juan'], ['el-tutu-1', 'El Tutú']]) {
    await hive.ensureAgent({ id, name, provider: 'claude', cwd: home });
  }
  const events = [];
  let clock = 1_800_000_000_000;
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hive.root(),
    godId: () => 'god',
    phaseOf: (agentId) => phaseForAgent(hive.registry(), agentId),
    onEvent: (e) => events.push(e),
    now: () => (clock += 1000)
  });
  hive.setCimaHandler((from, cima, id, to) => recordBanner(lapitaya.handle(from, to, cima, id)));
  const server = new HookServer(hive, () => null, () => config, undefined, undefined, undefined, undefined, lapitaya);
  const hook = (agentId, payload) => server.handle({ agent_id: agentId, agent_token: hive.registerAgentToken(agentId), session_id: `s-${agentId}`, ...payload });
  const pre = (agentId, tool, input) => hook(agentId, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
  const ran = (agentId, command, stdout, failed = false) => hook(agentId, failed
    ? { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command }, error: stdout }
    : { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout, stderr: '', interrupted: false } });
  const read = (agentId, file) => hook(agentId, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: file }, tool_response: 'contents' });
  const wrote = (agentId, file) => hook(agentId, { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'b' }, tool_response: {} });
  /** Drop a message with a `cima` field into an agent's outbox and route it. */
  const send = (from, cima, to = 'god') => {
    const out = path.join(hive.root(), 'agents', from, 'outbox');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `m-${Date.now()}-${Math.random().toString(36).slice(2)}.json`),
      JSON.stringify({ to, act: 'inform', subject: `${cima.phase} result`, body: 'agent prose', cima }));
    hive.routeOnce();
    const recs = lapitaya.cimaRecords();
    return recs[recs.length - 1];
  };
  const denied = (r) => r?.hookSpecificOutput?.permissionDecision === 'deny';
  return { home, hive, lapitaya, server, events, pre, ran, read, wrote, send, denied, hook };
}

// ─── risk classification ────────────────────────────────────────────────────

test('tool calls classify into LOW / MEDIUM / HIGH', () => {
  const cases = [
    ['Read', { file_path: 'src/main/hive.ts' }, 'LOW'],
    ['Grep', { pattern: 'x' }, 'LOW'],
    ['Bash', { command: 'npm run test:focused' }, 'LOW'],
    ['Bash', { command: 'cd /repo && git diff --stat && node --test test/a.test.cjs' }, 'LOW'],
    ['Write', { file_path: 'docs/ARCH.md' }, 'LOW'],
    ['Edit', { file_path: 'src/shared/foo.ts' }, 'MEDIUM'],
    ['Write', { file_path: 'test/foo.test.cjs' }, 'MEDIUM'],
    ['Edit', { file_path: 'tsconfig.json' }, 'MEDIUM'],
    ['Bash', { command: 'mkdir build && node scripts/gen.cjs' }, 'MEDIUM'],
    ['Bash', { command: 'node scripts/migrate.cjs --drop-all-tables' }, 'HIGH'],
    ['Bash', { command: 'npx prisma migrate reset --force' }, 'HIGH'],
    ['Bash', { command: 'rm -rf dist' }, 'HIGH'],
    ['Bash', { command: 'git push origin main' }, 'HIGH'],
    ['Bash', { command: 'terraform apply -auto-approve' }, 'HIGH'],
    ['Bash', { command: 'cat .env' }, 'HIGH'],
    ['Read', { file_path: 'C:/app/.env' }, 'HIGH'],
    ['Edit', { file_path: 'src/auth/session.ts' }, 'HIGH'],
    ['Write', { file_path: '.github/workflows/release.yml' }, 'HIGH'],
    ['Edit', { file_path: 'src/shared/lapitaya/governance.ts' }, 'HIGH'],
    ['SomeNewTool', {}, 'HIGH']
  ];
  for (const [tool, input, risk] of cases) {
    assert.equal(classifyToolCall(tool, input).risk, risk, `${tool} ${JSON.stringify(input)}`);
  }
});

test('inside the hive: coordination is LOW, the governance files are HIGH', () => {
  const ctx = { hiveRoot: 'C:/h/hive' };
  assert.equal(classifyToolCall('Write', { file_path: 'C:/h/hive/agents/el-beni-1/outbox/x.json' }, ctx).risk, 'LOW');
  assert.equal(classifyToolCall('Edit', { file_path: 'C:\\h\\hive\\tasks.json' }, ctx).risk, 'LOW');
  assert.equal(classifyToolCall('Write', { file_path: 'C:/h/hive/agents/el-beni-1/settings.json' }, ctx).category, 'governance-tamper');
  assert.equal(classifyToolCall('Write', { file_path: 'C:/h/hive/lapitaya/approvals.json' }, ctx).category, 'governance-tamper');
  assert.equal(classifyToolCall('Edit', { file_path: 'C:/h/hive/bin/cth-hook.cjs' }, ctx).category, 'governance-tamper');
});

// ─── LOW → AUTO, MEDIUM → SUPERVISED, HIGH → HUMAN_APPROVAL at the hook ─────

test('LOW runs automatically and is logged ALLOW', async (t) => {
  const f = await floor(t);
  const r = await f.pre('valentin-1', 'Read', { file_path: 'src/main/hive.ts' });
  assert.equal(f.denied(r), false);
  const g = f.lapitaya.ledger().filter((e) => e.kind === 'governance').pop();
  assert.equal(g.decision, 'ALLOW');
  assert.equal(g.risk, 'LOW');
  assert.equal(g.phase, 'ARCHITECT', 'the ledger knows Valentín works in ARCHITECT');
});

test('MEDIUM runs under supervision: not denied, logged SUPERVISED, surfaced live', async (t) => {
  const f = await floor(t);
  const r = await f.pre('el-beni-1', 'Edit', { file_path: 'src/shared/foo.ts', old_string: 'a', new_string: 'b' });
  assert.equal(f.denied(r), false);
  const g = f.lapitaya.ledger().filter((e) => e.kind === 'governance').pop();
  assert.equal(g.decision, 'SUPERVISED');
  assert.ok(f.events.some((e) => e.type === 'supervised' && e.data.agentId === 'el-beni-1'));
});

test('HIGH is denied with HUMAN_APPROVAL_REQUIRED and NOT executed — even in autoMode', async (t) => {
  const f = await floor(t, { autoMode: true, notifications: false });
  const call = { command: 'node scripts/migrate.cjs --drop-all-tables' };
  const r = await f.pre('el-beni-1', 'Bash', call);
  assert.equal(f.denied(r), true);
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /^HUMAN_APPROVAL_REQUIRED/);
  const pending = f.lapitaya.listApprovals().filter((a) => a.status === 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].category, 'destructive-migration');
  // A retry loop must not spam the human, and must stay denied.
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', call)), true);
  assert.equal(f.lapitaya.listApprovals().filter((a) => a.status === 'pending').length, 1);
});

test('explicit approval lets the IDENTICAL call run exactly once', async (t) => {
  const f = await floor(t);
  const call = { command: 'node scripts/migrate.cjs --drop-all-tables' };
  await f.pre('el-beni-1', 'Bash', call);
  const [pending] = f.lapitaya.listApprovals();
  // A different command is not covered by the approval.
  f.lapitaya.decide(pending.id, true);
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', { command: 'node scripts/migrate.cjs --drop-all-tables --yes' })), true);
  // The approved call runs once …
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', call)), false);
  // … and the approval is consumed.
  assert.equal(f.lapitaya.listApprovals().find((a) => a.id === pending.id).status, 'consumed');
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', call)), true);
  const decisions = f.lapitaya.ledger().filter((e) => e.kind === 'governance').map((e) => e.decision);
  assert.ok(decisions.includes('HUMAN_APPROVED'));
  assert.ok(decisions.includes('APPROVED'));
});

test('another agent cannot use someone else\'s approval; rejection keeps it blocked', async (t) => {
  const f = await floor(t);
  const call = { command: 'git push origin lapitaya/x' };
  await f.pre('el-beni-1', 'Bash', call);
  const [a] = f.lapitaya.listApprovals();
  f.lapitaya.decide(a.id, false);
  assert.equal(f.denied(await f.pre('el-beni-1', 'Bash', call)), true);
  assert.equal(f.denied(await f.pre('margarito-1', 'Bash', call)), true);
  assert.equal(f.lapitaya.decide(a.id, true), null, 'a decided request cannot be re-decided');
});

test('an agent cannot switch its own guard off (governance-tamper is HIGH)', async (t) => {
  const f = await floor(t);
  const settings = path.join(f.hive.root(), 'agents', 'el-beni-1', 'settings.json');
  assert.equal(f.denied(await f.pre('el-beni-1', 'Write', { file_path: settings, content: '{}' })), true);
  assert.equal(f.denied(await f.pre('god', 'Edit', { file_path: 'src/main/hooks.ts' })), true, 'El Inge is not omnipotent either');
});

test('if governance itself fails, the tool call is denied (fail closed)', async (t) => {
  const f = await floor(t);
  f.lapitaya.authorize = () => { throw new Error('boom'); };
  const r = await f.pre('valentin-1', 'Read', { file_path: 'src/a.ts' });
  assert.equal(f.denied(r), true);
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /^GOVERNANCE_ERROR/);
});

test('HUMAN_CONTROLLED stage puts MEDIUM behind approval too', () => {
  const a = authorizeToolCall({ agentId: 'x', tool: 'Edit', input: { file_path: 'src/a.ts' }, stage: 'HUMAN_CONTROLLED' });
  assert.equal(a.decision, 'HUMAN_APPROVAL_REQUIRED');
});

// ─── CIMA via the router ────────────────────────────────────────────────────

test('EVIDENCE FIRST: a PASS citing nothing the harness observed is BLOCKED', async (t) => {
  const f = await f_(t);
  const rec = f.send('el-beni-1', { taskId: 'T1', phase: 'BUILD', verdict: 'PASS',
    evidence: [{ type: 'test-result', source: 'npm test', result: 'all green, trust me' }] });
  assert.equal(rec.claimed, 'PASS');
  assert.equal(rec.verdict, 'BLOCKED');
  assert.deepEqual(rec.violations, ['EVIDENCE_FIRST']);
  // A PASS with no evidence at all is BLOCKED as well.
  assert.equal(f.send('el-beni-1', { taskId: 'T1b', phase: 'BUILD', verdict: 'PASS' }).verdict, 'BLOCKED');
});

async function f_(t) { return floor(t); }

test('EVIDENCE FIRST: a PASS citing a command the agent really ran is PASS', async (t) => {
  const f = await floor(t);
  await f.ran('el-beni-1', 'cd /sandbox && node --test test/greet.test.cjs', 'ℹ pass 3\nℹ fail 0');
  const rec = f.send('el-beni-1', { taskId: 'T2', phase: 'BUILD', verdict: 'PASS',
    evidence: [{ type: 'test-result', source: 'node --test test/greet.test.cjs', result: 'ℹ pass 3' }] });
  assert.equal(rec.verdict, 'PASS');
  assert.equal(rec.evidence[0].verified, true);
});

test('EVIDENCE FIRST: evidence another agent produced does not count for this one', async (t) => {
  const f = await floor(t);
  await f.ran('margarito-1', 'npm test', 'ok');
  const rec = f.send('el-beni-1', { taskId: 'T3', phase: 'BUILD', verdict: 'PASS',
    evidence: [{ type: 'test-result', source: 'npm test' }] });
  assert.equal(rec.verdict, 'BLOCKED');
});

test('the delivered message carries the runtime verdict, not just the sender\'s claim', async (t) => {
  const f = await floor(t);
  f.send('el-beni-1', { taskId: 'T4', phase: 'BUILD', verdict: 'PASS', evidence: [] });
  const inbox = path.join(f.hive.root(), 'agents', 'god', 'inbox');
  const msg = JSON.parse(fs.readFileSync(path.join(inbox, fs.readdirSync(inbox).find((x) => x.endsWith('.json'))), 'utf8'));
  assert.match(msg.body, /^\[CIMA runtime\] task T4 · BUILD · claimed PASS → recorded BLOCKED/);
  assert.match(msg.body, /agent prose/);
});

test('BUILDER != AUDITOR: El Beni cannot PASS the audit of his own build (negative test)', async (t) => {
  const f = await floor(t);
  await f.wrote('el-beni-1', 'src/greet.cjs');
  await f.ran('el-beni-1', 'node --test test/greet.test.cjs', 'ℹ pass 3');
  assert.equal(f.send('el-beni-1', { taskId: 'T5', phase: 'BUILD', verdict: 'PASS',
    evidence: [{ type: 'test-result', source: 'node --test test/greet.test.cjs' }] }).verdict, 'PASS');
  await f.ran('margarito-1', 'node --test test/greet.test.cjs', 'ℹ pass 3');
  assert.equal(f.send('margarito-1', { taskId: 'T5', phase: 'TEST', verdict: 'PASS',
    evidence: [{ type: 'test-result', source: 'node --test test/greet.test.cjs' }] }).verdict, 'PASS');
  // El Beni now tries to audit his own work, with perfectly real evidence.
  await f.ran('el-beni-1', 'git diff --stat', ' src/greet.cjs | 2 +-');
  const self = f.send('el-beni-1', { taskId: 'T5', phase: 'AUDIT', verdict: 'PASS',
    evidence: [{ type: 'diff', source: 'git diff --stat' }] });
  assert.equal(self.verdict, 'BLOCKED');
  assert.ok(self.violations.includes('BUILDER_NOT_AUDITOR'));
  // … and cannot pass his own TEST either.
  const selfTest = f.send('el-beni-1', { taskId: 'T5', phase: 'TEST', verdict: 'PASS',
    evidence: [{ type: 'test-result', source: 'node --test test/greet.test.cjs' }] });
  assert.ok(selfTest.violations.includes('BUILDER_NOT_AUDITOR'));
  // An independent auditor with real evidence passes.
  await f.ran('jose-juan-1', 'git diff', 'diff --git a/src/greet.cjs');
  assert.equal(f.send('jose-juan-1', { taskId: 'T5', phase: 'AUDIT', verdict: 'PASS',
    evidence: [{ type: 'diff', source: 'git diff' }] }).verdict, 'PASS');
});

test('an auditor who edits code after the build cannot PASS the audit', async (t) => {
  const f = await floor(t);
  await f.ran('el-beni-1', 'npm test', 'ok');
  f.send('el-beni-1', { taskId: 'T6', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'test-result', source: 'npm test' }] });
  await f.ran('margarito-1', 'npm test', 'ok');
  f.send('margarito-1', { taskId: 'T6', phase: 'TEST', verdict: 'PASS', evidence: [{ type: 'test-result', source: 'npm test' }] });
  await f.wrote('jose-juan-1', 'src/greet.cjs');
  await f.ran('jose-juan-1', 'git diff', 'diff');
  const rec = f.send('jose-juan-1', { taskId: 'T6', phase: 'AUDIT', verdict: 'PASS', evidence: [{ type: 'diff', source: 'git diff' }] });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('AUDITOR_MODIFIED_CODE'));
});

test('TRANSITIONS: BUILD → accepted (DECISION PASS) without TEST/AUDIT is BLOCKED', async (t) => {
  const f = await floor(t);
  await f.ran('el-beni-1', 'npm test', 'ok');
  f.send('el-beni-1', { taskId: 'T7', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'test-result', source: 'npm test' }] });
  await f.ran('god', 'git log -1', 'abc');
  const rec = f.send('god', { taskId: 'T7', phase: 'DECISION', verdict: 'PASS', evidence: [{ type: 'execution-trace', source: 'git log -1' }] }, 'human');
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('TRANSITION'));
  assert.deepEqual(rec.transition, { from: 'BUILD', to: 'DECISION' });
  // AUDIT PASS without TEST PASS is BLOCKED too.
  await f.ran('jose-juan-1', 'git diff', 'd');
  assert.ok(f.send('jose-juan-1', { taskId: 'T7', phase: 'AUDIT', verdict: 'PASS', evidence: [{ type: 'diff', source: 'git diff' }] }).violations.includes('TRANSITION'));
});

test('only El Inge (or the human) can accept work', async (t) => {
  const f = await floor(t);
  await f.ran('el-tutu-1', 'cat hive/lapitaya/cima-ledger.jsonl', '{}');
  const rec = f.send('el-tutu-1', { taskId: 'T8', phase: 'DECISION', verdict: 'PASS',
    evidence: [{ type: 'execution-trace', source: 'cat hive/lapitaya/cima-ledger.jsonl' }] });
  assert.ok(rec.violations.includes('DECISION_AUTHORITY'));
});

test('FAIL backed by a real failing run is recorded FAIL; BLOCKED stays BLOCKED (never FAIL)', async (t) => {
  const f = await floor(t);
  await f.ran('margarito-1', 'node --test test/greet.test.cjs', 'Error: Exit code 1\nℹ fail 1', true);
  const fail = f.send('margarito-1', { taskId: 'T9', phase: 'TEST', verdict: 'FAIL',
    evidence: [{ type: 'test-result', source: 'node --test test/greet.test.cjs' }] });
  assert.equal(fail.verdict, 'FAIL');
  const blocked = f.send('margarito-1', { taskId: 'T9', phase: 'TEST', verdict: 'BLOCKED', summary: 'sandbox missing' });
  assert.equal(blocked.verdict, 'BLOCKED');
  assert.equal(f.lapitaya.ledger().filter((e) => e.kind === 'cima').pop().verdict, 'BLOCKED');
});

test('a malformed claim is BLOCKED, not silently dropped', async (t) => {
  const f = await floor(t);
  const rec = f.send('el-beni-1', { taskId: 'T10', phase: 'SHIP_IT', verdict: 'PASS' });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.deepEqual(rec.violations, ['MALFORMED']);
});

test('the full CIMA cycle, one agent per role, records PASS at every phase', async (t) => {
  const f = await floor(t);
  const T = 'CYCLE-1';
  const step = async (agent, phase, command, to = 'god') => {
    await f.ran(agent, command, 'ok');
    return f.send(agent, { taskId: T, phase, verdict: 'PASS', evidence: [{ type: 'execution-trace', source: command }] }, to);
  };
  await f.read('god', 'C:/h/hive/tasks.json');
  const ctx = await step('god', 'CONTEXT', 'git status --short', 'valentin-1');
  const arch = await step('valentin-1', 'ARCHITECT', 'git ls-files src');
  await f.wrote('el-beni-1', 'src/greet.cjs');
  const build = await step('el-beni-1', 'BUILD', 'git diff --stat');
  const tst = await step('margarito-1', 'TEST', 'node --test test/greet.test.cjs');
  const aud = await step('jose-juan-1', 'AUDIT', 'git diff');
  const learn = await step('el-tutu-1', 'LEARN', 'git log --oneline -3');
  const dec = await step('god', 'DECISION', 'git status', 'human');
  const it = await step('god', 'ITERATE', 'git log -1', 'human');
  for (const r of [ctx, arch, build, tst, aud, learn, dec, it]) assert.equal(r.verdict, 'PASS', `${r.phase}: ${r.reasons.join(' ')}`);
  assert.deepEqual([ctx, arch, build, tst, aud, learn, dec, it].map((r) => r.transition.to),
    ['CONTEXT', 'ARCHITECT', 'BUILD', 'TEST', 'AUDIT', 'LEARN', 'DECISION', 'ITERATE']);
  assert.equal(dec.transition.from, 'LEARN');
});

test('the ledger persists across a restart of the service', async (t) => {
  const f = await floor(t);
  await f.ran('el-beni-1', 'npm test', 'ok');
  f.send('el-beni-1', { taskId: 'T11', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'test-result', source: 'npm test' }] });
  const again = new CimaRuntimeService({ hiveRoot: () => f.hive.root(), godId: () => 'god' });
  assert.equal(again.cimaRecords('T11').length, 1);
  // Builder memory survives too: El Beni still cannot audit T11.
  const rec = evaluateSubmission({ records: again.cimaRecords(), traces: [], godId: 'god' },
    { taskId: 'T11', phase: 'AUDIT', verdict: 'PASS', evidence: [] }, 'el-beni-1', Date.now());
  assert.ok(rec.violations.includes('BUILDER_NOT_AUDITOR'));
});

test('agent settings register PostToolUseFailure so failing runs become evidence', async (t) => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/hive.ts'), 'utf8');
  assert.match(src, /PostToolUseFailure: \[entry\('\*'\)\]/);
});

test('a `cima` tag without a verdict is a phase ASSIGNMENT, not a malformed claim (seen live in v0.2)', async (t) => {
  const f = await floor(t);
  const out = path.join(f.hive.root(), 'agents', 'god', 'outbox');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'delegate.json'), JSON.stringify({
    to: 'valentin-1', act: 'request', subject: 'ARCHITECT please', body: 'propose', cima: { taskId: 'LP-1', phase: 'ARCHITECT' }
  }));
  f.hive.routeOnce();
  const last = f.lapitaya.ledger().pop();
  assert.equal(last.kind, 'cima-assignment');
  assert.deepEqual([last.taskId, last.phase, last.from, last.to], ['LP-1', 'ARCHITECT', 'god', 'valentin-1']);
  assert.equal(f.lapitaya.cimaRecords('LP-1').length, 0, 'an assignment is not a verdict');
  const inbox = path.join(f.hive.root(), 'agents', 'valentin-1', 'inbox');
  const msg = JSON.parse(fs.readFileSync(path.join(inbox, fs.readdirSync(inbox).find((x) => x.endsWith('.json'))), 'utf8'));
  assert.match(msg.body, /^\[CIMA runtime\] task LP-1 · ARCHITECT assigned by god to valentin-1/);
});

// Regression: the exact `source` strings the v0.2 live run rejected although the
// agent HAD run/read them (annotations broke a literal match), next to the ones
// that were rightly rejected. The fix removes decoration, never the requirement.
test('evidence matching ignores annotations but still needs a real trace (live v0.2 fixtures)', () => {
  const { verifyEvidence } = loadTs('src/shared/lapitaya/cimaRuntime.ts');
  const tr = (kind, subject) => ({ id: subject, ts: 1, agentId: 'a', kind, tool: kind === 'command' ? 'Bash' : 'Read', subject, ok: true });
  // String.raw keeps the Windows backslashes exactly as the live traces had them.
  const traces = [
    tr('command', String.raw`cd "C:\PitayaCode\LaPitaya-cima-sandbox" && node --test test/lapitaya-foundation.test.cjs 2>&1 | tail -30`),
    tr('command', String.raw`cd "C:\PitayaCode\LaPitaya-cima-sandbox" && git diff HEAD -- test/lapitaya-foundation.test.cjs`),
    tr('read', String.raw`C:\PitayaCode\LaPitaya-cima-sandbox\src\shared\lapitaya\agents.ts`),
    tr('read', String.raw`C:\Users\chess\HarnessAgents\hive\log.jsonl`)
  ];
  const ok = (type, source) => verifyEvidence({ type, source }, traces).verified;
  // were false positives — now verified
  assert.equal(ok('test-result', String.raw`node --test test/lapitaya-foundation.test.cjs (cwd C:\PitayaCode\LaPitaya-cima-sandbox)`), true);
  assert.equal(ok('diff', String.raw`git diff HEAD -- test/lapitaya-foundation.test.cjs (cwd C:\PitayaCode\LaPitaya-cima-sandbox)`), true);
  assert.equal(ok('file-inspection', String.raw`Read file_path="C:\PitayaCode\LaPitaya-cima-sandbox\src\shared\lapitaya\agents.ts"`), true);
  assert.equal(ok('file-inspection', 'Read src/shared/lapitaya/agents.ts lineas 170-205'), true);
  assert.equal(ok('file-inspection', String.raw`C:\Users\chess\HarnessAgents\hive\log.jsonl (grep LP-CIMA-001)`), true);
  // were rightly rejected — still rejected
  assert.equal(ok('command-output', "script temporal en scratchpad (no commiteado): agents.agentByHiveId('VALENTIN-MUNH7SDC')"), false);
  assert.equal(ok('file-inspection', String.raw`C:\Users\chess\HarnessAgents\hive\cost-ledger.jsonl (tail, agent_id valentin)`), false);
  assert.equal(ok('test-result', 'npm run test:everything (all green)'), false);
  assert.equal(ok('test-result', 'all tests pass'), false);
});
