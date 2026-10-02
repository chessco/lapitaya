'use strict';
/**
 * La Pitaya Alicia v0.4.1 — intent & CIMA governance boundary.
 *
 *   USER → ALICIA → AliciaIntent → runtime IntentBoundary → (CONVERSATION: Alicia)
 *                                                         (REQUEST: El Inge, proposal only)
 *                                                         (ACTION: CIMA risk/autonomy/authorization → El Inge)
 *
 * Everything runs against the REAL HiveManager + HookServer + CimaRuntimeService
 * + IntentBoundary + companion (test/fixtures/lapitaya-floor.cjs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { TRUSTED_HUMAN: HUMAN } = require('./fixtures/human.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { floor, loadTs } = require('./fixtures/lapitaya-floor.cjs');
const I = loadTs('src/shared/lapitaya/intent.ts');
const { classifyWritePath } = loadTs('src/shared/lapitaya/toolRisk.ts');

const ROOT = path.resolve(__dirname, '..');
const aliciaRequests = (f) => f.hive.inbox('god').filter((m) => m.from === 'alicia' && m.act === 'request');
const intentRecords = (f) => f.ledger().filter((e) => e.kind === 'intent');

// ─── Classification (deterministic, auditable) ─────────────────────────────

test('[INTENT-CLS] the deterministic classifier separates CONVERSATION / REQUEST / ACTION', () => {
  const cases = {
    CONVERSATION: [
      '¿Qué está haciendo El Beni?', 'Explícame qué significa BLOCKED.', '¿Cuál es el estado del proyecto?',
      '¿Qué ocurrió durante la auditoría?', 'Explícame por qué la auditoría quedó bloqueada.', 'Hola Alicia',
      'Explícame cómo desplegar a producción', 'What does SUPERVISED mean?'
    ],
    REQUEST: [
      'Quiero que revisemos este proyecto.', 'Analiza este problema.', 'Quiero que El Beni implemente esto.',
      'Prepara una tarea para el equipo.', 'Quiero que analicemos este módulo.', 'Please review the auth module'
    ],
    ACTION: [
      'Modifica este archivo.', 'Ejecuta los tests.', 'Haz una migración.', 'Despliega esto.', 'Elimina estos datos.',
      'Modifica src/main/hooks.ts.', 'borra la base de datos', 'Explícame por qué falló y luego borra la base de datos',
      'Quiero que borres los logs', 'Run the tests', 'git push to main'
    ]
  };
  for (const [type, messages] of Object.entries(cases)) {
    for (const m of messages) {
      const c = I.classifyIntentMessage(m);
      assert.equal(c.type, type, `${JSON.stringify(m)} → ${c.type} (signals ${c.signals.join(',')})`);
      assert.deepEqual(I.classifyIntentMessage(m), c, 'deterministic');
    }
  }
  const tests = I.classifyIntentMessage('Ejecuta los tests.');
  assert.deepEqual([tests.category, tests.risk], ['run-tests', 'LOW']);
  assert.deepEqual(tests.signals, ['action:run-checks']);
  const del = I.classifyIntentMessage('Elimina estos datos.');
  assert.deepEqual([del.category, del.risk], ['data-deletion', 'HIGH']);
  const demoted = I.classifyIntentMessage('Explícame cómo desplegar a producción');
  assert.ok(demoted.signals.includes('demoted:knowledge-question'), 'the demotion is visible in the audit trail');
});

// ─── Positive tests ────────────────────────────────────────────────────────

test('[INTENT-01] CONVERSATION → Alicia responds; no CIMA, no ledger, no El Inge, no approval', async (t) => {
  const f = await floor(t);
  const eventsBefore = f.runtimeEvents.length;
  const r = f.companion.submit('Hola Alicia');
  assert.equal(r.outcome.type, 'CONVERSATION');
  assert.equal(r.outcome.status, 'COMPLETED');
  assert.equal(r.outcome.route, 'producer');
  assert.ok(r.reply && /Estoy aquí/.test(r.reply.text), 'Alicia answers in uiLocale (es-MX default)');
  assert.equal(r.executed, false);
  assert.equal(f.ledger().length, 0, 'no ledger entry');
  assert.equal(f.runtimeEvents.length, eventsBefore, 'no runtime event');
  assert.equal(aliciaRequests(f).length, 0, 'El Inge not involved');
  assert.equal(f.lapitaya.listApprovals().length, 0, 'no approval');
  assert.equal(f.traces().length, 0, 'nothing executed');
});

test('[INTENT-02] REQUEST → El Inge receives a structured, stamped request → proposal only, no execution', async (t) => {
  const f = await floor(t);
  const r = f.companion.submit('Quiero que revisemos este proyecto.');
  assert.deepEqual([r.outcome.type, r.outcome.status, r.outcome.route, r.outcome.decision],
    ['REQUEST', 'FORWARDED', 'orchestrator', 'PROPOSAL_ONLY']);
  const [msg] = aliciaRequests(f);
  assert.ok(msg.body.startsWith(`${I.INTENT_BANNER_PREFIX} intent ${r.intent.id} · REQUEST`));
  assert.match(msg.body, /PROPOSAL ONLY: .* WAIT for their go-ahead\. Do not execute/);
  const [rec] = intentRecords(f);
  assert.equal(rec.status, 'FORWARDED');
  assert.deepEqual(rec.trail.map((x) => x.status), ['RECEIVED', 'CLASSIFIED', 'FORWARDED']);
  assert.equal(rec.messageId, msg.id, 'the ledger links the intent to the delivered message');
  assert.equal(f.traces().length, 0);
  assert.equal(f.lapitaya.listApprovals().length, 0);
});

test('[INTENT-03] ACTION LOW → CIMA → AUTO; El Inge executes through PreToolUse (ALLOW)', async (t) => {
  const f = await floor(t);
  const call = { tool: 'Bash', input: { command: 'npm test' } };
  const r = f.companion.submit('Ejecuta los tests.', { target: call });
  assert.deepEqual([r.outcome.type, r.outcome.status, r.outcome.risk, r.outcome.decision],
    ['ACTION', 'GOVERNED', 'LOW', 'ALLOW']);
  assert.equal(f.traces().length, 0, 'the boundary itself ran nothing');
  // Execution is El Inge's own call, re-authorized at PreToolUse.
  const pre = await f.pre('god', call.tool, call.input);
  assert.notEqual(pre?.hookSpecificOutput?.permissionDecision, 'deny');
  assert.equal(f.server.lastPreDecision, 'ALLOW');
  await f.ran('god', 'npm test', 'pass 12 fail 0');
  assert.deepEqual(f.traces().map((x) => [x.agentId, x.subject]), [['god', 'npm test']], 'the executor is El Inge, never Alicia');
});

test('[INTENT-04] ACTION MEDIUM → CIMA → SUPERVISED', async (t) => {
  const f = await floor(t);
  const file = path.join(f.home, 'src', 'app.ts');
  const call = { tool: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } };
  const r = f.companion.submit('Modifica src/app.ts para renombrar la función', { target: call });
  assert.deepEqual([r.outcome.type, r.outcome.risk, r.outcome.decision], ['ACTION', 'MEDIUM', 'SUPERVISED']);
  await f.pre('god', call.tool, call.input);
  assert.equal(f.server.lastPreDecision, 'SUPERVISED', 'PreToolUse agrees');
});

test('[INTENT-05] ACTION HIGH → HUMAN_APPROVAL_REQUIRED → Alicia explains → human approves → one execution', async (t) => {
  const f = await floor(t);
  const call = { tool: 'Bash', input: { command: 'rm -rf /srv/data' } };
  const r = f.companion.submit('Elimina los datos de /srv/data', { target: call });
  assert.deepEqual([r.outcome.type, r.outcome.risk, r.outcome.decision], ['ACTION', 'HIGH', 'HUMAN_APPROVAL_REQUIRED']);
  const approvalId = r.outcome.approvalId;
  assert.ok(approvalId, 'the REAL v0.3 approval mechanism raised a request');
  const [approval] = f.lapitaya.listApprovals();
  assert.deepEqual([approval.id, approval.agentId, approval.status], [approvalId, 'god', 'pending']);
  // Alicia explains (existing event stream → her notifications).
  const n = f.companion.snapshot().notifications.find((x) => x.eventType === 'approval.required');
  assert.equal(n.type, 'APPROVAL_REQUIRED');
  assert.match(n.message, /requiere tu aprobación porque está clasificada como riesgo alto/);
  assert.deepEqual(n.action, { kind: 'open-approvals', ref: approvalId, humanOnly: true });
  // Before approval, El Inge's identical call is denied.
  let pre = await f.pre('god', call.tool, call.input);
  assert.equal(pre.hookSpecificOutput.permissionDecision, 'deny');
  // Only the human decides — through the existing decide().
  f.lapitaya.decide(approvalId, true, 'human', HUMAN);
  pre = await f.pre('god', call.tool, call.input);
  assert.equal(f.server.lastPreDecision, 'APPROVED', 'one execution');
  pre = await f.pre('god', call.tool, call.input);
  assert.equal(pre.hookSpecificOutput.permissionDecision, 'deny', 'one-shot: the retry is denied again');
  // Traceability: intent → approval → authorization, all in the ledger.
  const [rec] = intentRecords(f);
  assert.equal(rec.approvalId, approvalId);
  assert.ok(f.ledger().some((e) => e.kind === 'governance' && e.decision === 'APPROVED' && e.approvalId === approvalId && e.agentId === 'god'));
});

// ─── Negative tests ────────────────────────────────────────────────────────

test('[INTENT-NEG-01] Alicia tries to execute HIGH directly → BLOCKED', async (t) => {
  const f = await floor(t);
  // No execution surface on the companion; the only runtime entry point denies.
  assert.equal(typeof f.companion.execute, 'undefined');
  const pre = await f.pre('alicia', 'Bash', { command: 'rm -rf /srv/data' });
  assert.equal(pre.hookSpecificOutput.permissionDecision, 'deny');
  // An intent that claims it should be executed is refused at the boundary.
  const out = f.boundary.submit(f.intentFor('rm -rf /srv/data', { type: 'ACTION', execute: true }));
  assert.deepEqual([out.status, out.rule, out.executed], ['BLOCKED', 'NOT_AUTHORIZED', false]);
  assert.equal(f.traces().length, 0);
});

test('[INTENT-NEG-02] Alicia labels HIGH as LOW (and as CONVERSATION) → runtime reclassifies → HUMAN_APPROVAL_REQUIRED', async (t) => {
  const f = await floor(t);
  const out = f.boundary.submit(f.intentFor('borra la base de datos', { type: 'CONVERSATION', risk: 'LOW' }));
  assert.deepEqual([out.type, out.risk, out.decision, out.reclassified], ['ACTION', 'HIGH', 'HUMAN_APPROVAL_REQUIRED', true]);
  assert.deepEqual([out.claimedType, out.claimedRisk], ['CONVERSATION', 'LOW'], 'the claim is kept for audit');
  const call = f.boundary.submit(f.intentFor('limpia el directorio', {
    type: 'ACTION', risk: 'LOW', target: { tool: 'Bash', input: { command: 'rm -rf /srv/data' } }
  }));
  assert.deepEqual([call.risk, call.decision, call.reclassified], ['HIGH', 'HUMAN_APPROVAL_REQUIRED', true]);
  // A named file is classified by the runtime: the text reads MEDIUM ("modifica"), the path is governance code.
  const gov = f.boundary.submit(f.intentFor('Modifica src/main/hooks.ts.', { type: 'ACTION', risk: 'MEDIUM' }));
  assert.deepEqual([gov.risk, gov.decision, gov.rule, gov.reclassified], ['HIGH', 'HUMAN_APPROVAL_REQUIRED', 'governance-path', true]);
  // Words riskier than the proposed call cannot be laundered through a harmless call.
  const mismatch = f.boundary.submit(f.intentFor('borra la base de datos', { type: 'ACTION', target: { tool: 'Read', input: { file_path: 'README.md' } } }));
  assert.deepEqual([mismatch.status, mismatch.rule], ['BLOCKED', 'INTENT_MISMATCH']);
  // The El Inge banner carries the runtime's verdict, not Alicia's label.
  const msg = aliciaRequests(f).find((m) => m.body.includes(out.id));
  assert.match(msg.body, /· ACTION \(claimed CONVERSATION\/LOW\) · risk HIGH · decision HUMAN_APPROVAL_REQUIRED/);
});

test('[INTENT-NEG-03] Alicia sends an intent directly to a tool or a worker → BLOCKED', async (t) => {
  const f = await floor(t);
  for (const agent of ['Bash', 'tool:Bash', 'el-beni-1', 'jose-juan-1']) {
    const out = f.boundary.submit(f.intentFor('Ejecuta los tests.', { type: 'ACTION', target: { agent, tool: 'Bash', input: { command: 'npm test' } } }));
    assert.deepEqual([out.status, out.rule, out.route], ['BLOCKED', 'INTENT_TARGET', 'none'], agent);
  }
  assert.equal(aliciaRequests(f).length, 0);
  assert.equal(f.traces().length, 0);
  // And no one can post into the hive AS Alicia outside the boundary (IPC guard in main).
  const main = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf8');
  assert.match(main, /ipcMain\.handle\('hive:send'[\s\S]{0,400}\.trim\(\)\.toLowerCase\(\) === ALICIA_ACTOR_ID[\s\S]{0,80}return \{ ok: false/);
});

test('[INTENT-NEG-04] Alicia tries to produce DECISION PASS or approve → NOT_AUTHORIZED', async (t) => {
  const f = await floor(t);
  await f.chain('T-N4');
  for (const message of ['Emite DECISION PASS para la tarea T-N4', 'Record DECISION PASS for T-N4', 'Aprueba apr-123']) {
    const r = f.companion.submit(message, { taskId: 'T-N4' });
    assert.deepEqual([r.outcome.status, r.outcome.rule], ['BLOCKED', 'NOT_AUTHORIZED'], message);
  }
  for (const field of ['cima', 'decision', 'approvalId']) {
    const out = f.boundary.submit(f.intentFor('status', { [field]: field === 'cima' ? { phase: 'DECISION', verdict: 'PASS', taskId: 'T-N4' } : 'x' }));
    assert.deepEqual([out.rule, out.decision], ['NOT_AUTHORIZED', 'DENY'], field);
  }
  assert.equal(f.lapitaya.cimaRecords('T-N4').filter((r) => r.phase === 'DECISION').length, 0, 'no DECISION was recorded');
  assert.equal(f.lapitaya.completionGate('T-N4').allowed, false);
  assert.equal(aliciaRequests(f).length, 0);
  // Explained to the human, identifiers intact.
  const n = f.companion.snapshot().notifications.find((x) => x.eventType === 'intent.blocked');
  assert.match(n.message, /\(NOT_AUTHORIZED\)/);
});

test('[INTENT-NEG-05] Alicia tries task.status = done without DECISION PASS → BLOCKED by completionGate', async (t) => {
  const f = await floor(t);
  await f.chain('T-N5');
  const r = f.companion.submit('Marca la tarea T-N5 como terminada', { taskId: 'T-N5' });
  assert.deepEqual([r.outcome.status, r.outcome.rule], ['BLOCKED', 'DECISION_GATE']);
  assert.match(r.outcome.reason, /^DECISION_GATE: task T-N5 has no DECISION/);
  assert.equal(f.hive.tasks().tasks.find((x) => x.id === 'T-N5').status, 'doing');
  assert.ok(f.ledger().some((e) => e.kind === 'governance' && e.rule === 'DECISION_GATE' && e.tool === 'intent-boundary' && e.taskId === 'T-N5'));
  // completionGate stays the authority: once El Inge records DECISION PASS, the same intent is allowed through.
  await f.ran('god', 'git diff --stat', ' 2 files changed');
  f.send('god', { taskId: 'T-N5', phase: 'DECISION', verdict: 'PASS', evidence: [{ type: 'diff', source: 'git diff --stat' }] }, 'human');
  const ok = f.companion.submit('Marca la tarea T-N5 como terminada', { taskId: 'T-N5' });
  assert.deepEqual([ok.outcome.status, ok.outcome.decision, ok.outcome.route], ['GOVERNED', 'ALLOW', 'orchestrator']);
  assert.equal(f.hive.tasks().tasks.find((x) => x.id === 'T-N5').status, 'doing', 'the boundary never writes task state itself');
});

test('[INTENT-NEG-06] malformed intents (missing id / source / type, bad status, not an object) → DENY / INVALID', async (t) => {
  const f = await floor(t);
  const good = f.intentFor('Ejecuta los tests.', { type: 'ACTION' });
  const variants = {
    'missing id': { ...good, id: undefined },
    'missing source': { ...good, source: undefined },
    'unknown source': { ...good, source: 'claude' },
    'missing type': { ...good, type: undefined },
    'unknown type': { ...good, type: 'EXECUTE' },
    'pre-governed status': { ...good, status: 'GOVERNED' },
    'missing message': { ...good, message: '  ' },
    'not an object': 'rm -rf /'
  };
  for (const [label, raw] of Object.entries(variants)) {
    const out = f.boundary.submit(raw);
    assert.deepEqual([out.status, out.decision, out.rule, out.route, out.executed], ['BLOCKED', 'DENY', 'INTENT_INVALID', 'none', false], label);
  }
  assert.equal(aliciaRequests(f).length, 0);
  assert.equal(f.traces().length, 0);
  assert.equal(intentRecords(f).filter((r) => r.rule === 'INTENT_INVALID').length, Object.keys(variants).length, 'each is recorded');
});

// ─── Architecture (structural, not convention) ─────────────────────────────

test('[INTENT-ARCH-01] the Alicia layer has no path to a tool, the hive or governance authority', () => {
  const dir = path.join(ROOT, 'src/shared/lapitaya/alicia');
  const allowed = /^(\.\/[\w]+|\.\.\/(locales|agents|brand|cima|cimaRuntime|intent|identity)|\.\.\/\.\.\/\.\.\/renderer\/src\/i18n\/locales\/lapitaya\/(es-MX|en-US)\.json)$/;
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    // Value imports only (type-only imports carry no capability).
    for (const m of src.matchAll(/^import\s+(?!type\b)[\s\S]*?from\s+'([^']+)';/gm)) {
      assert.match(m[1], allowed, `${file} imports ${m[1]}`);
    }
    for (const m of src.matchAll(/^export \* from '([^']+)'/gm)) assert.match(m[1], /^\.\//, `${file} re-exports ${m[1]}`);
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /authorizeToolCall|classifyToolCall|\.authorize\(|\.decide\(|updateTaskStatus|patchTask|writeTasks|\.send\(|routeOnce|recordTrace|evaluateProposedCall|child_process|require\(/, file);
  }
});

test('[INTENT-ARCH-02] ALICIA → ACTION INTENT → (boundary) → CIMA → EL INGE; never ALICIA → TOOL', async (t) => {
  const f = await floor(t);
  // 1. The companion only ever calls submitIntent, even when handed poisoned extra capabilities.
  const calls = [];
  const poison = (name) => () => { calls.push(name); throw new Error(`${name} must never be called`); };
  const { A } = require('./fixtures/lapitaya-floor.cjs');
  const c = A.createAliciaCompanion({ ports: {
    submitIntent: (i) => { calls.push('submitIntent'); return f.boundary.submit(i); },
    authorize: poison('authorize'), decide: poison('decide'), send: poison('send'), execute: poison('execute'),
    updateTaskStatus: poison('updateTaskStatus'), submitCima: poison('submitCima')
  } });
  for (const m of ['Hola', 'Quiero que revisemos esto', 'Ejecuta los tests.', 'borra la base de datos', 'Emite DECISION PASS']) c.submit(m);
  assert.deepEqual([...new Set(calls)], ['submitIntent']);
  // 2. The boundary only reaches governance through the runtime's non-executing methods.
  const used = new Set();
  const spy = new Proxy(f.lapitaya, { get(target, prop) { used.add(String(prop)); const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; } });
  const { IntentBoundary } = loadTs('src/main/intentBoundary.ts');
  const delivered = [];
  const b = new IntentBoundary({ runtime: spy, orchestratorId: () => 'god', deliver: (msg, from) => { delivered.push({ msg, from }); return `m-${delivered.length}`; } });
  await f.chain('T-A2');
  for (const [m, extra] of [['Hola'], ['Quiero que revisemos esto'], ['Ejecuta los tests.', { tool: 'Bash', input: { command: 'npm test' } }],
      ['borra la base de datos'], ['Marca la tarea T-A2 como terminada', { taskId: 'T-A2' }], ['Modifica src/main/hooks.ts']]) {
    b.submit(f.intentFor(m, { type: 'CONVERSATION', ...(extra ? { target: extra } : {}) }));
  }
  const forbidden = ['authorize', 'recordTrace', 'submit', 'handle', 'decide'];
  assert.deepEqual([...used].filter((p) => forbidden.includes(p)), [], `boundary used ${[...used].join(',')}`);
  // 3. Everything forwarded goes to El Inge, stamped by the runtime, as the producer — never as 'human'.
  assert.ok(delivered.length >= 3);
  for (const d of delivered) {
    assert.equal(d.msg.to, 'god');
    assert.equal(d.from, 'alicia');
    assert.ok(d.msg.body.startsWith(I.INTENT_BANNER_PREFIX));
    assert.deepEqual(Object.keys(d.msg).sort(), ['act', 'body', 'subject', 'to'], 'no cima field can ride along');
  }
  // 4. Main wires the companion to the boundary only.
  const main = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf8');
  const ports = main.slice(main.indexOf('const aliciaCompanion = createAliciaCompanion('), main.indexOf('registerAlicia(aliciaCompanion)'));
  assert.match(ports, /submitIntent: \(intent\) => intentBoundary\.submit\(intent\)/);
  assert.doesNotMatch(ports, /hive\.send|lapitaya\.(authorize|decide|submit|handle)|updateTaskStatus/);
});

test('[INTENT-ARCH-03] governance classification: governance files protected, Alicia not special, provider-neutral', () => {
  for (const p of ['src/main/intentBoundary.ts', 'src/shared/lapitaya/intent.ts', 'C:\\repo\\src\\main\\intentBoundary.ts']) {
    assert.equal(classifyWritePath(p).category, 'governance-tamper', p);
  }
  for (const file of ['src/main/intentBoundary.ts', 'src/main/cimaRuntime.ts', 'src/shared/lapitaya/governance.ts', 'src/shared/lapitaya/toolRisk.ts', 'src/shared/lapitaya/autonomy.ts']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(src, /Alicia(Admin|Trusted|Bypass|Governor)/, file);
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /['"]alicia['"]/i, `${file} never special-cases the alicia id`);
  }
  const shared = fs.readFileSync(path.join(ROOT, 'src/shared/lapitaya/intent.ts'), 'utf8');
  assert.doesNotMatch(shared.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /claude|gemini|openai|codex|anthropic/i, 'the intent contract names no provider');
});

test('[INTENT-EVENTS] intents are observable on the EXISTING runtime event stream; conversation is silent', async (t) => {
  const f = await floor(t);
  f.companion.submit('Hola');
  f.companion.submit('Quiero que revisemos esto');
  f.companion.submit('borra la base de datos');
  const intents = f.runtimeEvents.filter((e) => e.type === 'intent');
  assert.equal(intents.length, 2, 'one runtime event per governed intent; none for conversation');
  const types = f.companion.snapshot().notifications.map((n) => n.eventType).filter((x) => x.startsWith('intent.'));
  assert.deepEqual(types, ['intent.received', 'intent.classified', 'intent.forwarded', 'intent.received', 'intent.classified', 'intent.governed']);
  const governed = f.companion.snapshot({ locales: { notificationLocale: 'en-US' } }).notifications.find((n) => n.eventType === 'intent.governed');
  assert.equal(governed.type, 'APPROVAL_REQUIRED');
  assert.match(governed.message, /risk HIGH, decision HUMAN_APPROVAL_REQUIRED/);
});
