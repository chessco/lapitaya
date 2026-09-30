'use strict';
/**
 * La Pitaya Alicia v0.4.2 — REQUEST execution gate.
 *
 *   REQUEST → runtime proposal (PROPOSED) → NO EXECUTION on the floor
 *   REQUEST → HUMAN confirmation → CIMA → risk → autonomy → authorization → PreToolUse → execution
 *
 * Everything runs against the REAL HiveManager + HookServer + CimaRuntimeService
 * + IntentBoundary + companion (test/fixtures/lapitaya-floor.cjs). "Execution
 * attempts" are real PreToolUse hook calls — the same boundary a CLI hits.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { floor, loadTs } = require('./fixtures/lapitaya-floor.cjs');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { classifyWritePath } = loadTs('src/shared/lapitaya/toolRisk.ts');
const I = loadTs('src/shared/lapitaya/intent.ts');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

const TEST_CALL = { tool: 'Bash', input: { command: 'npm test' } };                    // LOW  (run-tests)
const HIGH_CALL = { tool: 'Bash', input: { command: 'rm -rf /srv/data' } };            // HIGH (data-deletion)
const editCall = (f) => ({ tool: 'Edit', input: { file_path: path.join(f.home, 'src', 'app.ts'), old_string: 'a', new_string: 'b' } }); // MEDIUM

/** Submit a REQUEST through Alicia, exactly like the app; returns the proposal. */
function request(f, message = 'Quiero que revisemos este proyecto.', opts = {}) {
  const r = f.companion.submit(message, opts);
  assert.equal(r.outcome.type, 'REQUEST', message);
  assert.ok(r.outcome.proposalId, 'the runtime opened a proposal');
  return f.lapitaya.listRequests().find((p) => p.id === r.outcome.proposalId);
}
/** The human confirms (the IPC handler's exact call). */
const confirm = (f, p, token = p.token) => f.lapitaya.confirmRequest(p.id, { by: 'human', token });
async function attempt(f, agentId, call) {
  const r = await f.pre(agentId, call.tool, call.input);
  return {
    denied: r?.hookSpecificOutput?.permissionDecision === 'deny',
    reason: r?.hookSpecificOutput?.permissionDecisionReason ?? '',
    decision: f.server.lastPreDecision
  };
}
const governanceRecords = (f) => f.ledger().filter((e) => e.kind === 'governance');
const requestTransitions = (f, id) => f.ledger().filter((e) => e.kind === 'request' && e.proposalId === id).map((e) => e.transition);

// ─── REQ-01..15 ────────────────────────────────────────────────────────────

test('[REQ-01] REQUEST + LOW + no confirmation → El Inge attempts execution → BLOCKED', async (t) => {
  const f = await floor(t);
  const p = request(f);
  assert.equal(p.status, 'PROPOSED');
  const a = await attempt(f, 'god', TEST_CALL);
  assert.equal(a.denied, true);
  assert.match(a.reason, /^REQUEST_CONFIRMATION_REQUIRED/);
  assert.equal(f.traces().length, 0);
  // Planning stays possible: reading, analysis and replying through the hive.
  assert.equal((await attempt(f, 'god', { tool: 'Read', input: { file_path: path.join(f.home, 'README.md') } })).denied, false);
  assert.equal((await attempt(f, 'god', { tool: 'Bash', input: { command: 'git status' } })).denied, false);
  const outbox = path.join(f.hive.root(), 'agents', 'god', 'outbox', 'proposal.json');
  assert.equal((await attempt(f, 'god', { tool: 'Write', input: { file_path: outbox, content: '{}' } })).denied, false);
  // The denial is evidence, linked to the proposal.
  assert.ok(governanceRecords(f).some((e) => e.agentId === 'god' && e.rule === 'REQUEST_CONFIRMATION_REQUIRED' && e.proposalId === p.id && e.category === 'run-tests' && e.risk === 'LOW'));
});

test('[REQ-02] REQUEST + MEDIUM + no confirmation → BLOCKED', async (t) => {
  const f = await floor(t);
  request(f);
  const a = await attempt(f, 'god', editCall(f));
  assert.equal(a.denied, true);
  assert.match(a.reason, /^REQUEST_CONFIRMATION_REQUIRED/);
});

test('[REQ-03] REQUEST + HIGH + no confirmation → BLOCKED, and no approval is even raised', async (t) => {
  const f = await floor(t);
  request(f);
  const a = await attempt(f, 'god', HIGH_CALL);
  assert.equal(a.denied, true);
  assert.match(a.reason, /^REQUEST_CONFIRMATION_REQUIRED/);
  assert.equal(f.lapitaya.listApprovals().length, 0, 'the gate runs before approvals');
});

test('[REQ-04] REQUEST + valid human confirmation → CIMA → LOW → AUTO → execution allowed', async (t) => {
  const f = await floor(t);
  const p = request(f);
  const c = confirm(f, p);
  assert.equal(c.ok, true);
  assert.equal(c.proposal.status, 'CONFIRMED');
  assert.equal(c.proposal.token, null, 'the token is consumed');
  const a = await attempt(f, 'god', TEST_CALL);
  assert.deepEqual([a.denied, a.decision], [false, 'ALLOW']);
  await f.ran('god', 'npm test', 'pass 12 fail 0');
  assert.deepEqual(f.traces().map((x) => x.agentId), ['god']);
  assert.ok(governanceRecords(f).some((e) => e.decision === 'ALLOW' && e.proposalId === p.id), 'REQUEST_EXECUTION_AUTHORIZED evidence');
  assert.deepEqual(requestTransitions(f, p.id), ['PROPOSED', 'REVALIDATED', 'CONFIRMED']);
});

test('[REQ-05] REQUEST (change scope) + confirmation → CIMA → MEDIUM → SUPERVISED', async (t) => {
  const f = await floor(t);
  const p = request(f, 'Quiero que El Beni implemente la validación del formulario.');
  assert.equal(p.scope, 'MEDIUM');
  assert.equal(confirm(f, p).ok, true);
  const a = await attempt(f, 'god', editCall(f));
  assert.deepEqual([a.denied, a.decision], [false, 'SUPERVISED'], 'the autonomy policy still applies');
});

test('[REQ-06] REQUEST + confirmation + HIGH → existing HUMAN_APPROVAL flow; confirmation ≠ approval', async (t) => {
  const f = await floor(t);
  const p = request(f, 'Quiero que El Beni implemente la limpieza de datos.');
  confirm(f, p);
  let a = await attempt(f, 'god', HIGH_CALL);
  assert.deepEqual([a.denied, a.decision], [true, 'HUMAN_APPROVAL_REQUIRED'], 'no automatic execution');
  const [approval] = f.lapitaya.listApprovals();
  assert.equal(approval.agentId, 'god');
  f.lapitaya.decide(approval.id, true, 'human');
  a = await attempt(f, 'god', HIGH_CALL);
  assert.deepEqual([a.denied, a.decision], [false, 'APPROVED'], 'runs once with the separate HIGH approval');
  a = await attempt(f, 'god', HIGH_CALL);
  assert.equal(a.denied, true, 'one-shot, as in v0.3');
});

test('[REQ-07] confirmation replay: one confirmation → one transition; it can never unlock another proposal', async (t) => {
  const f = await floor(t);
  const p1 = request(f);
  const token1 = p1.token;
  assert.equal(confirm(f, p1, token1).ok, true);
  const again = confirm(f, p1, token1);
  assert.deepEqual([again.ok, again.code], [false, 'NOT_CONFIRMABLE']);
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, false);
  // The human closes it; a NEW request starts gated again, whatever came before.
  assert.equal(f.lapitaya.completeRequest(p1.id, 'human').ok, true);
  const p2 = request(f, 'Quiero que analicemos el módulo de pagos.');
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, true, 'second execution attempt is BLOCKED');
  const reused = confirm(f, p2, token1);
  assert.deepEqual([reused.ok, reused.code], [false, 'TAMPERED'], "p1's token cannot confirm p2");
  assert.equal(confirm(f, p1, token1).code, 'NOT_CONFIRMABLE');
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === p2.id).status, 'PROPOSED');
});

test('[REQ-08] Alicia attempts confirmation → NOT_AUTHORIZED (runtime API, words, and metadata)', async (t) => {
  const f = await floor(t);
  const p = request(f);
  assert.equal(typeof f.companion.confirm, 'undefined');
  assert.equal(typeof f.companion.confirmRequest, 'undefined');
  const direct = f.lapitaya.confirmRequest(p.id, { by: 'alicia', token: p.token });
  assert.deepEqual([direct.ok, direct.code], [false, 'NOT_AUTHORIZED']);
  const words = f.companion.submit(`Confirma la propuesta ${p.id}`);
  assert.deepEqual([words.outcome.status, words.outcome.rule], ['BLOCKED', 'NOT_AUTHORIZED']);
  for (const field of ['confirmed', 'confirmation', 'token']) {
    const out = f.boundary.submit(f.intentFor('Quiero que revisemos el proyecto', { type: 'REQUEST', [field]: field === 'token' ? p.token : true }));
    assert.equal(out.rule, 'NOT_AUTHORIZED', field);
  }
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === p.id).status, 'PROPOSED');
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, true);
});

test('[REQ-09] El Inge attempts self-confirmation → NOT_AUTHORIZED; messages and tool writes change nothing', async (t) => {
  const f = await floor(t);
  const p = request(f);
  const direct = f.lapitaya.confirmRequest(p.id, { by: 'god', token: p.token });
  assert.deepEqual([direct.ok, direct.code], [false, 'NOT_AUTHORIZED']);
  // A message claiming confirmation (any fields) is just a message.
  const out = path.join(f.hive.root(), 'agents', 'god', 'outbox');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'm-confirm.json'), JSON.stringify({ to: 'human', act: 'inform', subject: 'confirmed', body: `${p.id} confirmed`, confirmed: true, proposalId: p.id, token: p.token }));
  f.hive.routeOnce();
  // Rewriting the runtime's proposal state is governance tampering.
  const w = await attempt(f, 'god', { tool: 'Write', input: { file_path: path.join(f.hive.root(), 'lapitaya', 'proposals.json'), content: '[]' } });
  assert.equal(w.denied, true);
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === p.id).status, 'PROPOSED');
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, true);
});

test('[REQ-10] confirmed REQUEST + actual HIGH action → HIGH policy applies (never inherits the request)', async (t) => {
  const f = await floor(t);
  const p = request(f, 'Quiero que revises los archivos del proyecto.');
  assert.equal(p.scope, 'LOW');
  confirm(f, p);
  const a = await attempt(f, 'god', HIGH_CALL);
  assert.deepEqual([a.denied, a.decision], [true, 'HUMAN_APPROVAL_REQUIRED']);
  assert.match(a.reason, /^HUMAN_APPROVAL_REQUIRED/);
});

test('[REQ-11] confirmed harmless REQUEST + incompatible actual action → runtime re-classifies → not permitted', async (t) => {
  const f = await floor(t);
  const p = request(f, 'Quiero que revises los archivos del proyecto.');
  confirm(f, p);
  const a = await attempt(f, 'god', editCall(f));
  assert.equal(a.denied, true);
  assert.match(a.reason, /^REQUEST_SCOPE_EXCEEDED — the confirmed request .* allows LOW-risk work; this call is MEDIUM \(code-change\)/);
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, false, 'work inside the confirmed scope proceeds');
});

test('[REQ-12] CONVERSATION stays side-effect free (no proposal, no ledger, no gate)', async (t) => {
  const f = await floor(t);
  const r = f.companion.submit('¿Qué significa REQUEST_CONFIRMATION_REQUIRED?');
  assert.equal(r.outcome.route, 'producer');
  assert.equal(f.lapitaya.listRequests().length, 0);
  assert.equal(f.ledger().length, 0);
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, false, 'no gate without a REQUEST');
});

test('[REQ-13] ACTION behaviour is unchanged, even while a REQUEST is pending', async (t) => {
  const f = await floor(t);
  const low = f.companion.submit('Ejecuta los tests.', { target: TEST_CALL });
  assert.deepEqual([low.outcome.type, low.outcome.decision, low.outcome.proposalId], ['ACTION', 'ALLOW', undefined]);
  assert.equal((await attempt(f, 'god', TEST_CALL)).decision, 'ALLOW');
  // A pending REQUEST does not capture a governed ACTION's exact call…
  request(f);
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, false);
  // …but anything else is still gated.
  assert.equal((await attempt(f, 'god', { tool: 'Bash', input: { command: 'npm run lint' } })).denied, true);
  const high = f.companion.submit('Elimina los datos', { target: HIGH_CALL });
  assert.equal(high.outcome.decision, 'HUMAN_APPROVAL_REQUIRED', 'ACTION HIGH unchanged');
});

test('[REQ-14] completionGate still blocks unauthorized completion', async (t) => {
  const f = await floor(t);
  await f.chain('T-14');
  request(f, 'Quiero que revisemos la tarea T-14', { taskId: 'T-14' });
  const r = f.companion.submit('Marca la tarea T-14 como terminada', { taskId: 'T-14' });
  assert.deepEqual([r.outcome.status, r.outcome.rule], ['BLOCKED', 'DECISION_GATE']);
  assert.equal(f.hive.updateTaskStatus('T-14', 'done').ok, false);
  assert.equal(f.hive.tasks().tasks.find((x) => x.id === 'T-14').status, 'doing');
});

test('[REQ-15] direct tool bypass without confirmation stays blocked — any agent, any provider', async (t) => {
  const f = await floor(t);
  await f.hive.ensureAgent({ id: 'codex-1', name: 'Codex Worker', provider: 'codex', cwd: f.home });
  request(f);
  for (const agent of ['god', 'el-beni-1', 'margarito-1', 'codex-1', 'alicia']) {
    const a = await attempt(f, agent, TEST_CALL);
    assert.equal(a.denied, true, `${agent} is gated (delegation cannot launder the request)`);
  }
});

// ─── Negative: confirmation authority & malformed confirmations ────────────

test('[REQ-NEG] only the human confirms; metadata never authorizes; malformed confirmations deny safely', async (t) => {
  const f = await floor(t);
  await f.hive.ensureAgent({ id: 'codex-1', name: 'Codex Worker', provider: 'codex', cwd: f.home });
  const p = request(f, 'Quiero que revisemos el proyecto', { suggestedRisk: 'LOW' });
  const deny = (ctx, id = p.id) => { const r = f.lapitaya.confirmRequest(id, ctx); assert.equal(r.ok, false); return r.code; };
  // Authority
  for (const by of ['alicia', 'god', 'el-inge', 'el-beni-1', 'margarito-1', 'jose-juan-1', 'el-tutu-1', 'codex-1', 'codex', 'Human', undefined]) {
    assert.equal(deny({ by, token: p.token }), 'NOT_AUTHORIZED', String(by));
  }
  // Malformed / tampered / wrong context
  assert.equal(deny({ by: 'human', token: p.token }, ''), 'INVALID_CONFIRMATION', 'missing proposalId');
  assert.equal(f.lapitaya.confirmRequest(null, { by: 'human', token: p.token }).code, 'INVALID_CONFIRMATION', 'null proposalId');
  assert.equal(deny({ by: 'human', token: p.token }, 'req-does-not-exist'), 'UNKNOWN_PROPOSAL');
  assert.equal(deny({ by: 'human', token: p.token, intentId: 'int-someone-else' }), 'WRONG_CONTEXT');
  assert.equal(deny({ by: 'human' }), 'INVALID_CONFIRMATION', 'missing token');
  assert.equal(deny({ by: 'human', token: 'f'.repeat(32) }), 'TAMPERED');
  // Risk / type metadata cannot authorize: the REQUEST (LOW suggested) still executes nothing.
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, true, 'REQUEST alone cannot execute');
  // Cancelled and superseded proposals are not confirmable.
  const c = request(f, 'Quiero que analicemos el login', { taskId: 'T-X' });
  assert.equal(f.lapitaya.cancelRequest(c.id, 'human').ok, true);
  assert.equal(deny({ by: 'human', token: c.token }, c.id), 'NOT_CONFIRMABLE', 'cancelled');
  const s1 = request(f, 'Quiero que analicemos el checkout', { taskId: 'T-Y' });
  request(f, 'Quiero que analicemos el checkout otra vez', { taskId: 'T-Y' });
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === s1.id).status, 'SUPERSEDED');
  assert.equal(deny({ by: 'human', token: s1.token }, s1.id), 'NOT_CONFIRMABLE', 'superseded');
  // Only a human cancels or completes.
  assert.equal(f.lapitaya.cancelRequest(p.id, 'god').code, 'NOT_AUTHORIZED');
  assert.equal(f.lapitaya.completeRequest(p.id, 'alicia').code, 'NOT_AUTHORIZED');
  // Every denied attempt that names this proposal is on its record: 11 authority
  // attempts + wrong context + missing token + tampered token.
  assert.equal(requestTransitions(f, p.id).filter((x) => x === 'CONFIRMATION_DENIED').length, 14);
});

test('[REQ-NEG-TAMPER] a proposal edited on disk is refused; re-validation blocks a stale proposal', async (t) => {
  const f = await floor(t);
  const p = request(f);
  const file = path.join(f.hive.root(), 'lapitaya', 'proposals.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  list.find((x) => x.id === p.id).scope = 'MEDIUM';             // widen the scope behind the runtime's back
  fs.writeFileSync(file, JSON.stringify(list));
  const fresh = new CimaRuntimeService({ hiveRoot: () => f.hive.root(), godId: () => 'god' });
  const r = fresh.confirmRequest(p.id, { by: 'human', token: p.token });
  assert.deepEqual([r.ok, r.code], [false, 'TAMPERED']);
  // Re-validation: a proposal whose (untampered) words no longer read as a
  // REQUEST under today's rules is refused and closed, not confirmed. Opened
  // directly on the runtime to stand in for "the rules changed since".
  const s = fresh.openRequest({ intentId: 'int-stale', executor: 'god', requestedBy: 'human', source: 'alicia',
    message: 'borra la base de datos', taskId: null, target: null, signals: [] });
  assert.equal(I.classifyIntentMessage(s.message).type, 'ACTION');
  const st = fresh.confirmRequest(s.id, { by: 'human', token: s.token });
  assert.deepEqual([st.ok, st.code], [false, 'STALE_PROPOSAL']);
  assert.equal(fresh.listRequests().find((x) => x.id === s.id).status, 'BLOCKED');
});

// ─── Structural ────────────────────────────────────────────────────────────

test('[REQ-ARCH] structural: gate in authorize before approvals; human-only confirmation call sites; no bypass', () => {
  const runtime = read('src/main/cimaRuntime.ts');
  const authorizeBody = runtime.slice(runtime.indexOf('authorize(agentId: string, tool: string, input: unknown): Authorization {'), runtime.indexOf('private requestApproval('));
  // 2 + 6. The gate is inside authorize(), before approval consumption/creation.
  assert.ok(authorizeBody.includes('requestGate(this.proposals, auth, this.actionFingerprints)'));
  assert.ok(authorizeBody.indexOf('requestGate(') < authorizeBody.indexOf("auth.decision === 'APPROVED'"));
  assert.ok(authorizeBody.indexOf('requestGate(') < authorizeBody.indexOf('this.requestApproval('));
  // 5. PreToolUse still goes through authorize() and denies anything non-executable.
  const hooks = read('src/main/hooks.ts');
  assert.match(hooks, /event === 'PreToolUse' && this\.governance[\s\S]{0,600}this\.governance\.authorize\(agentId, p\.tool_name, p\.tool_input\)/);
  assert.match(hooks, /if \(!auth \|\| !isExecutable\(auth\.decision\)\)/);
  // 3 + 4. Confirmation authority: the ONLY caller is the human IPC handler, with by: 'human'.
  const callers = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /\.(confirmRequest|cancelRequest|completeRequest)\(/.test(code(fs.readFileSync(p, 'utf8')))) callers.push(path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  };
  walk(path.join(ROOT, 'src'));
  assert.deepEqual(callers, ['src/main/index.ts']);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('lapitaya:confirmRequest'[\s\S]{0,120}lapitaya\.confirmRequest\(id, \{ by: 'human', token \}\)/);
  // withdraw/open are the boundary's only (a lock can be lifted by nothing else).
  for (const fn of ['withdrawRequest(', 'openRequest(']) {
    const users = ['src/main/index.ts', 'src/main/hooks.ts', 'src/main/hive.ts', 'src/preload/index.ts']
      .filter((f) => code(read(f)).includes(`.${fn}`));
    assert.deepEqual(users, [], fn);
  }
  // 1. Alicia has no hive / confirmation path.
  const alicia = fs.readdirSync(path.join(ROOT, 'src/shared/lapitaya/alicia'))
    .map((n) => code(read(`src/shared/lapitaya/alicia/${n}`))).join('\n');
  assert.doesNotMatch(alicia, /confirmRequest|cancelRequest|completeRequest|openRequest|withdrawRequest|\.send\(|lapitaya:confirm/);
  // 7. completionGate still guards every HiveManager status path.
  const hive = read('src/main/hive.ts');
  const statusPath = hive.slice(hive.indexOf('updateTaskStatus(id: string'), hive.indexOf('writeTasks(tasks: HiveTask[]'));
  assert.match(statusPath, /this\.completionGateHandler\(id\)/);
  // 8. No provider-specific branch in the gate.
  const gate = code(read('src/shared/lapitaya/intent.ts'));
  assert.doesNotMatch(gate, /claude|codex|gemini|openai|grok|agy|provider/i);
  // 9. governance-tamper protection covers the gate's code and state.
  for (const p of ['src/shared/lapitaya/intent.ts', 'src/main/intentBoundary.ts', 'src/main/cimaRuntime.ts']) {
    assert.equal(classifyWritePath(p).category, 'governance-tamper', p);
  }
  assert.equal(classifyWritePath('/h/hive/lapitaya/proposals.json', { hiveRoot: '/h/hive' }).category, 'governance-tamper');
});

test('[REQ-EVENTS] proposal transitions ride the EXISTING runtime stream; Alicia shows them, humanOnly', async (t) => {
  const f = await floor(t);
  const p = request(f);
  confirm(f, p);
  f.lapitaya.completeRequest(p.id, 'human');
  const types = f.runtimeEvents.filter((e) => e.type === 'request').map((e) => e.data.transition);
  assert.deepEqual(types, ['PROPOSED', 'REVALIDATED', 'CONFIRMED', 'COMPLETED']);
  const n = f.companion.snapshot({ locales: { notificationLocale: 'es-MX' } }).notifications;
  const proposed = n.find((x) => x.eventType === 'request.proposed');
  assert.equal(proposed.type, 'APPROVAL_REQUIRED');
  assert.deepEqual(proposed.action, { kind: 'open-requests', ref: p.id, humanOnly: true });
  assert.match(proposed.message, /Nada se ejecuta hasta que confirmes la propuesta/);
  assert.ok(n.some((x) => x.eventType === 'request.confirmed'));
  assert.ok(n.some((x) => x.eventType === 'request.closed'));
});
