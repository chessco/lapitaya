'use strict';
/**
 * La Pitaya Alicia v0.4 — companion architecture tests.
 *
 * ALICIA-01..10 prove the boundary with the REAL runtime (HiveManager +
 * HookServer + CimaRuntimeService + v0.4.1 IntentBoundary), wired exactly like
 * src/main/index.ts wires the companion. NEG-01..04 prove Alicia stays subordinate to governance.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { TRUSTED_HUMAN: HUMAN } = require('./fixtures/human.cjs');
const fs = require('node:fs');
const path = require('node:path');
// v0.4.1: the floor (real runtime + intent boundary + companion) is shared with the v0.4.1 suite.
const { floor, loadTs, A, agents } = require('./fixtures/lapitaya-floor.cjs');
const { CIMA_WORKFLOW }      = loadTs('src/shared/lapitaya/cima.ts');
const lapitayaBarrel         = loadTs('src/shared/lapitaya/index.ts');

const ROOT = path.resolve(__dirname, '..');

const godInbox = (f) => f.hive.inbox('god');

// ─── ALICIA-01..10 ─────────────────────────────────────────────────────────

test('[ALICIA-01] Alicia can read CIMA status (derived from the runtime, not stored)', async (t) => {
  const f = await floor(t);
  await f.chain('T-01');
  const s = f.companion.snapshot({ focusTaskId: 'T-01' });
  const wf = s.context.currentWorkflow;
  assert.ok(wf, 'currentWorkflow present');
  assert.equal(wf.governed, true);
  assert.deepEqual(wf.pipeline.map((p) => `${p.phase}:${p.verdict}`), ['BUILD:PASS', 'TEST:PASS', 'AUDIT:PASS']);
  assert.equal(wf.phase, 'AUDIT');
  assert.equal(wf.status, 'PASS');
  assert.equal(wf.agent, 'jose-juan-1');
  assert.equal(wf.decision, null, 'no DECISION yet');
  assert.equal(wf.blocked, false);
  assert.equal(wf.completion.allowed, false, 'completionGate verdict is passed through verbatim');
  assert.match(wf.completion.reason, /^DECISION_GATE: task T-01 has no DECISION/);
  assert.equal(s.context.currentCimaPhase, 'AUDIT');
  assert.equal(s.context.provenance.currentWorkflow, 'cima-runtime');
  // Same answer as asking the runtime directly: Alicia has no state of her own here.
  assert.deepEqual(wf.completion, f.lapitaya.completionGate('T-01'));
});

test('[ALICIA-02] Alicia presents existing evidence verbatim and never fabricates any', async (t) => {
  const f = await floor(t);
  await f.chain('T-02');
  const build = f.lapitaya.cimaRecords('T-02').find((r) => r.phase === 'BUILD');
  const p = A.presentEvidence(build, 'es-MX', (id) => f.hive.registry().agents[id]?.name);
  assert.equal(p.total, 2);
  assert.equal(p.verified, 2);
  assert.deepEqual(p.items.map((i) => [i.type, i.source, i.result, i.verified, i.traceId]),
    build.evidence.map((e) => [e.type, e.source, e.result, e.verified, e.traceId]));
  assert.deepEqual(p.lines, ['✓ El Beni completó BUILD', '✓ 2/2 evidencias verificadas por el harness']);

  // A record without evidence is presented as such — nothing is filled in.
  const empty = { ...build, evidence: [], verdict: 'BLOCKED' };
  const q = A.presentEvidence(empty, 'en-US');
  assert.equal(q.total, 0);
  assert.equal(q.items.length, 0);
  assert.match(q.lines[1], /No evidence recorded/);

  // Notifications carry the runtime's evidence unchanged.
  const n = f.companion.snapshot({ locales: { notificationLocale: 'es-MX' } }).notifications
    .find((x) => x.eventType === 'cima.phase.changed' && x.context.phase === 'BUILD');
  assert.deepEqual(n.evidence.map((e) => e.source), ['npm run build', 'git diff --stat']);
  assert.equal(n.message, 'El Beni terminó BUILD: PASS.');
});

test('[ALICIA-03] Alicia receives governance events from the existing runtime event stream', async (t) => {
  const f = await floor(t);
  const r = await f.pre('el-beni-1', 'Bash', { command: 'git push --force origin main' });
  assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
  let s = f.companion.snapshot({ locales: { notificationLocale: 'en-US' } });
  const req = s.notifications.find((n) => n.eventType === 'approval.required');
  assert.ok(req, 'approval.required reached Alicia');
  assert.equal(req.type, 'APPROVAL_REQUIRED');
  assert.equal(req.technical.risk, 'HIGH');
  assert.equal(req.technical.decision, 'HUMAN_APPROVAL_REQUIRED');
  const approvalId = f.lapitaya.listApprovals()[0].id;
  assert.equal(req.technical.approvalId, approvalId);
  assert.deepEqual(req.action, { kind: 'open-approvals', ref: approvalId, humanOnly: true });
  assert.equal(s.presence, 'WAITING_APPROVAL');
  assert.equal(s.context.currentRisk, 'HIGH');

  f.lapitaya.decide(approvalId, false, 'human', HUMAN);
  s = f.companion.snapshot();
  assert.ok(s.notifications.some((n) => n.eventType === 'approval.denied' && n.technical.decision === 'HUMAN_REJECTED'));

  // completion-blocked → governance.blocked, reason verbatim.
  await f.chain('T-03');
  const res = f.hive.updateTaskStatus('T-03', 'done');
  assert.equal(res.ok, false);
  const blocked = f.companion.snapshot({ locales: { notificationLocale: 'es-MX' } }).notifications
    .find((n) => n.eventType === 'governance.blocked' && n.context.taskId === 'T-03');
  assert.equal(blocked.type, 'BLOCKED');
  assert.equal(blocked.technical.rule, 'DECISION_GATE');
  assert.equal(blocked.technical.reason, res.error, 'the real reason is never hidden or rewritten');
  assert.match(blocked.message, /La acción fue bloqueada por CIMA \(DECISION_GATE\)\./);
});

test('[ALICIA-04] Alicia produces a localized explanation and keeps the technical detail intact', () => {
  const technical = { decision: 'HUMAN_APPROVAL_REQUIRED', risk: 'HIGH', rule: 'AUTONOMY_POLICY', tool: 'Bash' };
  const es = A.explainGovernance(technical, 'es-MX');
  const en = A.explainGovernance(technical, 'en-US');
  assert.equal(es.text, 'Esta acción requiere tu aprobación porque está clasificada como riesgo alto.');
  assert.equal(en.text, 'This action needs your approval because it is classified as high risk.');
  for (const x of [es, en]) assert.deepEqual({ ...x.technical }, technical, 'risk/rule/decision/tool untouched');
  // The rule wins over the generic decision, and unknown rules are named, not hidden.
  assert.match(A.explainGovernance({ decision: 'DENY', rule: 'DECISION_GATE' }, 'es-MX').text, /DECISION PASS/);
  assert.match(A.explainGovernance({ decision: 'DENY', rule: 'SOMETHING_NEW' }, 'en-US').text, /SOMETHING_NEW/);
  // Unknown locales fall back to en-US.
  assert.equal(A.explainGovernance(technical, 'ja-JP').text, en.text);
});

test('[ALICIA-05] Alicia cannot directly execute a HIGH-risk action', async (t) => {
  const f = await floor(t);
  // (a) She is handed no execution, authorization or approval capability.
  const surface = Object.keys(f.companion).sort();
  assert.deepEqual(surface, ['enabled', 'explain', 'id', 'markRead', 'notify', 'setPreferences', 'snapshot', 'submit']);
  // (b) Asking for a HIGH action (v0.4.1): the runtime boundary governs it — HUMAN_APPROVAL_REQUIRED,
  // an approval bound to the EXECUTOR (El Inge), never to Alicia — and nothing runs.
  const tracesBefore = fs.existsSync(path.join(f.hive.root(), 'lapitaya', 'traces.jsonl'));
  const r = f.companion.submit('drop the prod database', { target: { tool: 'Bash', input: { command: 'rm -rf /srv/data' } } });
  assert.equal(r.executed, false);
  assert.equal(r.outcome.executed, false);
  assert.equal(r.outcome.decision, 'HUMAN_APPROVAL_REQUIRED');
  assert.equal(r.outcome.risk, 'HIGH');
  assert.deepEqual(f.lapitaya.listApprovals().map((a) => [a.agentId, a.status]), [['god', 'pending']], 'approval is for the executor, not Alicia');
  assert.equal(fs.existsSync(path.join(f.hive.root(), 'lapitaya', 'traces.jsonl')), tracesBefore, 'nothing ran');
  // (c) If Alicia's id ever reached the tool boundary, she gets exactly what any agent gets.
  const asAlicia = f.lapitaya.authorize('alicia', 'Bash', { command: 'rm -rf /srv/data' });
  const asBeni = f.lapitaya.authorize('el-beni-1', 'Bash', { command: 'rm -rf /srv/data' });
  assert.equal(asAlicia.decision, 'HUMAN_APPROVAL_REQUIRED');
  assert.equal(asAlicia.decision, asBeni.decision);
  assert.equal(asAlicia.risk, asBeni.risk);
  assert.equal(asAlicia.rule, asBeni.rule);
});

test('[ALICIA-06] Alicia cannot become DECISION authority', async (t) => {
  const f = await floor(t);
  await f.chain('T-06');
  // Even with a real trace behind her evidence, a DECISION PASS from Alicia is not accepted.
  await f.ran('alicia', 'git diff --stat', ' 2 files changed');
  const rec = f.lapitaya.submit('alicia', { taskId: 'T-06', phase: 'DECISION', verdict: 'PASS',
    evidence: [{ type: 'diff', source: 'git diff --stat' }] });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('DECISION_AUTHORITY'));
  assert.equal(f.lapitaya.completionGate('T-06').allowed, false);
  // No part of governance or CIMA special-cases her id.
  for (const file of ['governance.ts', 'autonomy.ts', 'toolRisk.ts', 'cimaRuntime.ts', 'providerGovernance.ts']) {
    const src = fs.readFileSync(path.join(ROOT, 'src/shared/lapitaya', file), 'utf8');
    assert.doesNotMatch(src, /alicia/i, `${file} must not mention Alicia`);
  }
  for (const file of ['src/main/cimaRuntime.ts', 'src/main/hooks.ts']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /alicia/i, `${file} must not mention Alicia`);
  }
  // No trusted/admin/bypass variant of Alicia exists anywhere in her layer.
  const layer = fs.readdirSync(path.join(ROOT, 'src/shared/lapitaya/alicia'))
    .map((n) => fs.readFileSync(path.join(ROOT, 'src/shared/lapitaya/alicia', n), 'utf8')).join('\n');
  assert.doesNotMatch(layer, /Alicia(Admin|Bypass|Trusted)/);
});

test('[ALICIA-07] Alicia does not appear as a CIMA worker', async (t) => {
  const f = await floor(t);
  const a = agents.LA_PITAYA_AGENT_BY_ID.alicia;
  assert.equal(a.runtime, 'capability');
  assert.deepEqual([...a.cimaPhases], []);
  assert.ok(!agents.LA_PITAYA_HIRE_PRESETS.some((p) => p.id === 'alicia'));
  for (const phase of CIMA_WORKFLOW) {
    const owners = agents.LA_PITAYA_AGENTS.filter((x) => x.cimaPhases.includes(phase)).map((x) => x.id);
    assert.ok(!owners.includes('alicia'), `${phase} is not Alicia's`);
  }
  assert.equal(agents.phaseForAgent({ godId: 'god', agents: { alicia: { name: 'Alicia' } } }, 'alicia'), null);
  // Handing the runtime a request does not enroll her in the hive.
  f.companion.submit('Please review the status of the project');
  assert.equal(f.hive.registry().agents.alicia, undefined);
  assert.equal(A.ALICIA_IDENTITY.role, 'AI Companion');
  assert.equal(A.ALICIA_IDENTITY.organization, 'PitayaCode');
  assert.equal(A.ALICIA_IDENTITY.origin, 'Sonora, Mexico');
});

test('[ALICIA-08] Alicia respects uiLocale (and notificationLocale) without translating identifiers', async (t) => {
  const f = await floor(t, { locales: { uiLocale: 'en-US', notificationLocale: 'es-MX' } });
  await f.chain('T-08');
  const en = f.companion.snapshot({ focusTaskId: 'T-08' });
  assert.equal(en.context.uiLocale, 'en-US');
  assert.equal(en.context.currentAgent.name, 'Jose Juan', 'en-US spelling in the UI');
  assert.equal(f.companion.explain({ decision: 'HUMAN_APPROVAL_REQUIRED', risk: 'HIGH' }).text,
    'This action needs your approval because it is classified as high risk.');
  const audit = en.notifications.find((n) => n.eventType === 'audit.completed');
  assert.equal(audit.message, 'José Juan terminó la auditoría: PASS.', 'notifications follow notificationLocale');

  const es = f.companion.snapshot({ focusTaskId: 'T-08', locales: { uiLocale: 'es-MX', notificationLocale: 'en-US' } });
  assert.equal(es.context.currentAgent.name, 'José Juan');
  assert.equal(es.notifications.find((n) => n.eventType === 'audit.completed').message, 'Jose Juan finished the audit: PASS.');
  // An omitted/undefined locale keeps the preference (the IPC handler passes undefined for missing ones).
  const partial = f.companion.snapshot({ locales: { uiLocale: undefined, notificationLocale: 'en-US' } });
  assert.equal(partial.context.uiLocale, 'en-US', 'preference kept, not reset to the es-MX default');
  for (const s of [en, es]) {
    assert.equal(s.context.currentCimaPhase, 'AUDIT');
    assert.deepEqual(s.context.currentWorkflow.pipeline.map((p) => p.verdict), ['PASS', 'PASS', 'PASS']);
  }
});

test('[ALICIA-09] Alicia cannot modify CIMA state directly', async (t) => {
  const f = await floor(t);
  await f.chain('T-09');
  const before = JSON.stringify(f.lapitaya.cimaRecords('T-09'));
  const s = f.companion.snapshot({ focusTaskId: 'T-09' });
  assert.throws(() => { s.context.currentWorkflow.pipeline[0].verdict = 'FAIL'; }, TypeError);
  assert.throws(() => { s.context.currentWorkflow.decision = 'PASS'; }, TypeError);
  assert.throws(() => { s.context.currentWorkflow.completion.allowed = true; }, TypeError);
  assert.throws(() => { s.notifications[0].technical.rule = 'NONE'; }, TypeError);
  assert.equal(JSON.stringify(f.lapitaya.cimaRecords('T-09')), before, 'the ledger is untouched');
  assert.equal(f.lapitaya.completionGate('T-09').allowed, false);
});

test('[ALICIA-10] Alicia produces an intent that El Inge receives as a request', async (t) => {
  const f = await floor(t);
  f.hive.addTask({ id: 'T-10', title: 'x', status: 'doing', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });
  const r = f.companion.submit('Please audit T-10 and propose next steps', { taskId: 'T-10' });
  assert.deepEqual({ route: r.outcome.route, type: r.outcome.type, executed: r.executed }, { route: 'orchestrator', type: 'REQUEST', executed: false });
  const msg = godInbox(f).find((m) => m.from === 'alicia');
  assert.ok(msg, 'El Inge has the request');
  assert.equal(msg.act, 'request');
  assert.ok(msg.body.startsWith(lapitayaBarrel.INTENT_BANNER_PREFIX), 'stamped by the runtime boundary, not by Alicia');
  assert.match(msg.body, /PROPOSAL ONLY/);
  assert.match(msg.body, /> Please audit T-10 and propose next steps/);
  assert.match(msg.body, /Task: T-10/);
  // Conversation stays with Alicia.
  const e = f.companion.submit('what is CIMA?');
  assert.equal(e.outcome.route, 'producer');
  assert.ok(e.reply && e.reply.text.length > 0);
  assert.equal(godInbox(f).filter((m) => m.from === 'alicia').length, 1);
  // Untrusted input is validated by the runtime.
  assert.equal(f.boundary.submit({ kind: 'execute', text: 'x' }).rule, 'INTENT_INVALID');
});

// ─── Negative tests: Alicia is subordinate to governance ──────────────────

test('[NEG-01] Alicia → direct HIGH-risk tool → BLOCKED at PreToolUse', async (t) => {
  const f = await floor(t);
  const r = await f.pre('alicia', 'Bash', { command: 'terraform destroy -auto-approve' });
  assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /^HUMAN_APPROVAL_REQUIRED/);
  assert.equal(f.server.lastPreDecision, 'HUMAN_APPROVAL_REQUIRED');
});

test('[NEG-02] Alicia → DECISION PASS through the real router → BLOCKED, not authority', async (t) => {
  const f = await floor(t);
  await f.chain('T-N2');
  f.send('alicia', { taskId: 'T-N2', phase: 'DECISION', verdict: 'PASS', evidence: [{ type: 'diff', source: 'git diff --stat' }] }, 'human');
  const rec = f.lapitaya.cimaRecords('T-N2').find((x) => x.agentId === 'alicia');
  assert.equal(rec.verdict, 'BLOCKED');
  assert.ok(rec.violations.includes('DECISION_AUTHORITY'));
  assert.equal(f.lapitaya.completionGate('T-N2').allowed, false);
  // v0.4.1: asking Alicia to issue it is refused at the intent boundary and never reaches El Inge.
  const n = f.lapitaya.cimaRecords('T-N2').length;
  const r = f.companion.submit('Emit DECISION PASS for T-N2', { taskId: 'T-N2' });
  assert.equal(r.outcome.rule, 'NOT_AUTHORIZED');
  assert.equal(r.outcome.route, 'none');
  assert.equal(f.lapitaya.cimaRecords('T-N2').length, n, 'no CIMA record came from Alicia');
  assert.equal(godInbox(f).filter((m) => m.from === 'alicia' && m.act === 'request').length, 0, 'nothing forwarded to El Inge');
});

test('[NEG-03] Alicia → modify CIMA state (ledger / approvals) → BLOCKED', async (t) => {
  const f = await floor(t);
  const ledger = path.join(f.hive.root(), 'lapitaya', 'cima-ledger.jsonl');
  const approvals = path.join(f.hive.root(), 'lapitaya', 'approvals.json');
  for (const file_path of [ledger, approvals]) {
    const r = await f.pre('alicia', 'Write', { file_path, content: '{}' });
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny', `write to ${path.basename(file_path)} denied`);
    const a = f.lapitaya.authorize('alicia', 'Write', { file_path, content: '{}' });
    assert.equal(a.category, 'governance-tamper');
    assert.equal(a.risk, 'HIGH');
  }
});

test('[NEG-04] Alicia → bypass completionGate → BLOCKED', async (t) => {
  const f = await floor(t);
  await f.chain('T-N4');
  // v0.4.1: asking Alicia to finish the task is judged by completionGate at the boundary.
  const r = f.companion.submit('mark T-N4 as done', { taskId: 'T-N4' });
  assert.equal(r.outcome.status, 'BLOCKED');
  assert.equal(r.outcome.rule, 'DECISION_GATE');
  assert.equal(f.hive.tasks().tasks.find((x) => x.id === 'T-N4').status, 'doing');
  // Any status path attributed to her is gated like every other caller.
  const res = f.hive.updateTaskStatus('T-N4', 'done', 'alicia');
  assert.equal(res.ok, false);
  assert.match(res.error, /DECISION_GATE/);
  assert.equal(f.hive.patchTask('T-N4', { status: 'done' }), false);
  // Editing the task ledger as Alicia is denied at the tool boundary.
  const tasksPath = path.join(f.hive.root(), 'tasks.json');
  const current = fs.readFileSync(tasksPath, 'utf8');
  const ed = await f.pre('alicia', 'Write', { file_path: tasksPath, content: current.replace('"doing"', '"done"') });
  assert.equal(ed.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(ed.hookSpecificOutput.permissionDecisionReason, /DECISION_GATE/);
  assert.equal(f.hive.tasks().tasks.find((x) => x.id === 'T-N4').status, 'doing');
});

// ─── Model units ───────────────────────────────────────────────────────────

test('event adapters: hooks and task ledger map to Alicia events; noise and junk are dropped', () => {
  assert.deepEqual(A.fromHookEvent({ agentId: 'x', event: 'SessionStart' }, 5).map((e) => e.type), ['agent.started']);
  assert.deepEqual(A.fromHookEvent({ agentId: 'x', event: 'PreToolUse', tool: 'Read' }, 5), []);
  assert.deepEqual(A.fromRuntimeEvent({ type: 'bogus', data: {} }, 1), []);
  assert.deepEqual(A.fromRuntimeEvent({ type: 'cima-record', data: { kind: 'cima' } }, 1), []);
  const before = { tasks: [{ id: 'a', status: 'todo' }] };
  const after = { tasks: [{ id: 'a', status: 'doing', assignee: 'el-beni-1' }, { id: 'b', status: 'todo', title: 'B' }] };
  assert.deepEqual(A.taskEvents(before, after, 1).map((e) => `${e.type}:${e.taskId}`), ['task.started:a', 'task.created:b']);
});

test('presence is derived by priority: approval > blocked > warning > celebrating > notifying > idle', () => {
  const n = (type, eventType = 'task.created') => ({ type, eventType });
  assert.equal(A.derivePresence([]), 'IDLE');
  assert.equal(A.derivePresence([], true), 'THINKING');
  assert.equal(A.derivePresence([n('INFO')]), 'NOTIFYING');
  assert.equal(A.derivePresence([n('SUCCESS', 'workflow.completed'), n('INFO')]), 'CELEBRATING');
  assert.equal(A.derivePresence([n('WARNING'), n('SUCCESS', 'workflow.completed')]), 'WARNING');
  assert.equal(A.derivePresence([n('BLOCKED'), n('ERROR')]), 'BLOCKED');
  assert.equal(A.derivePresence([n('BLOCKED'), n('APPROVAL_REQUIRED')]), 'WAITING_APPROVAL');
});

test('context is minimal and bounded; read state is the only thing the human changes', async (t) => {
  const f = await floor(t, { maxEvents: 30 });
  for (let i = 0; i < 40; i++) f.companion.notify({ type: 'task.created', ts: i, source: 'task-ledger', taskId: `k-${i}` });
  const s = f.companion.snapshot();
  assert.equal(s.notifications.length, 30, 'event ring is bounded');
  assert.equal(s.context.recentEvents.length, A.MAX_RECENT_EVENTS);
  assert.equal(s.context.notifications.latest.length, A.MAX_CONTEXT_NOTIFICATIONS);
  assert.equal(s.context.currentTask.id, 'k-39');
  assert.equal(s.context.provenance.currentTask, 'events');
  assert.equal(f.companion.markRead(s.notifications[0].id), true);
  assert.equal(f.companion.markRead('nope'), false);
  assert.equal(f.companion.snapshot().context.notifications.unread, 29);
});

test('conversation citations must point at runtime-recorded refs', async (t) => {
  const f = await floor(t);
  await f.chain('T-C');
  const ctx = f.companion.snapshot({ focusTaskId: 'T-C' }).context;
  const refs = A.knownRefs(ctx);
  const trace = f.lapitaya.cimaRecords('T-C')[0].evidence[0].traceId;
  const { grounded, rejected } = A.groundedCitations([
    { kind: 'evidence', ref: trace }, { kind: 'evidence', ref: 'trc-invented' }
  ], refs);
  assert.deepEqual(grounded.map((c) => c.ref), [trace]);
  assert.deepEqual(rejected.map((c) => c.ref), ['trc-invented']);
});

test('the lapitaya barrel exposes the Alicia layer; alicia i18n keys match across es-MX and en-US', () => {
  assert.equal(typeof lapitayaBarrel.createAliciaCompanion, 'function');
  assert.equal(typeof lapitayaBarrel.alicia, 'function');
  const dir = path.join(ROOT, 'src/renderer/src/i18n/locales/lapitaya');
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const es = JSON.parse(fs.readFileSync(path.join(dir, 'es-MX.json'), 'utf8')).alicia;
  const en = JSON.parse(fs.readFileSync(path.join(dir, 'en-US.json'), 'utf8')).alicia;
  assert.deepEqual(keys(es).sort(), keys(en).sort());
  for (const type of A.ALICIA_EVENT_TYPES) {
    assert.ok(en.notifications[type.replace(/\./g, '_')], `notification text for ${type}`);
  }
  assert.doesNotMatch(JSON.stringify(en), /[À-ÿ]/, 'en-US Alicia strings have no accents');
});
