'use strict';
/**
 * La Pitaya Alicia v0.6 — Governance Observability & Explanation.
 *
 *   RUNTIME → ledger / traces / approval & proposal state → projectObservability() → Alicia → HUMAN
 *
 * Every fact here comes from the REAL runtime (test/fixtures/lapitaya-floor.cjs:
 * HiveManager + HookServer + CimaRuntimeService + IntentBoundary + companion):
 * tool calls are real PreToolUse / PostToolUse hook calls. The projection is fed
 * exactly what the `lapitaya:observability` IPC handler feeds it (checked in
 * OBS-19), and the view is rendered with react-dom/server and the shipped
 * es-MX / en-US catalogs. No evidence → no claim.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const i18next = require('i18next');
const { floor, loadTs } = require('./fixtures/lapitaya-floor.cjs');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const O = loadTs('src/shared/lapitaya/alicia/observability.ts');
const M = loadTs('src/shared/lapitaya/alicia/messages.ts');
const A = loadTs('src/shared/lapitaya/alicia/index.ts');
const C = loadTs('src/renderer/src/components/alicia/confirmationController.ts');
const V = loadTs('src/renderer/src/components/alicia/AliciaPanelView.tsx');
const G = loadTs('src/renderer/src/components/alicia/GovernanceExplanationView.tsx');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

const TEST_CALL = { tool: 'Bash', input: { command: 'npm test' } };          // LOW
const HIGH_CALL = { tool: 'Bash', input: { command: 'rm -rf /srv/data' } };  // HIGH
const editCall = (f) => ({ tool: 'Edit', input: { file_path: path.join(f.home, 'src', 'app.ts'), old_string: 'a', new_string: 'b' } }); // MEDIUM

// ─── helpers ───────────────────────────────────────────────────────────────

/** Exactly what the `lapitaya:observability` handler projects (see OBS-19). */
const project = (runtime, opts) => O.projectObservability({
  ledger: runtime.ledger(3000), traces: runtime.recentTraces(1000),
  approvals: runtime.listApprovals(), requests: runtime.listRequests()
}, opts);
function request(f, message = 'Quiero que revisemos este proyecto.', opts = {}) {
  const r = f.companion.submit(message, opts);
  assert.equal(r.outcome.type, 'REQUEST', message);
  return f.lapitaya.listRequests().find((p) => p.id === r.outcome.proposalId);
}
const confirm = (f, p) => f.lapitaya.confirmRequest(p.id, { by: 'human', token: p.token });
async function attempt(f, agentId, call) {
  const r = await f.pre(agentId, call.tool, call.input);
  return { denied: r?.hookSpecificOutput?.permissionDecision === 'deny', decision: f.server.lastPreDecision };
}
const ledgerLines = (f) => fs.readFileSync(path.join(f.hive.root(), 'lapitaya', 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean);
/** The ledger line an evidence ref points to (EVT-<fnv1a of the exact line>). */
const lineFor = (f, ref) => ledgerLines(f).find((l) => O.evidenceRef(JSON.parse(l)) === ref.replace(/\.\d+$/, ''));
const latestOf = (v, category) => v.recent.find((o) => o.category === category);

const LOCALES = {
  'es-MX': JSON.parse(read('src/renderer/src/i18n/locales/lapitaya/es-MX.json')),
  'en-US': JSON.parse(read('src/renderer/src/i18n/locales/lapitaya/en-US.json'))
};
function strictT(lng) {
  const missing = [];
  const inst = i18next.createInstance();
  inst.init({
    lng, fallbackLng: false, initAsync: false, ns: ['lapitaya'], defaultNS: 'lapitaya',
    resources: { [lng]: { lapitaya: LOCALES[lng] } }, interpolation: { escapeValue: false },
    saveMissing: true, missingKeyHandler: (_l, _n, key) => missing.push(key)
  });
  return { t: (k, o) => inst.t(k, o), missing };
}
function renderPanel(snapshot, observability, lng = 'es-MX', acknowledged = []) {
  const { t, missing } = strictT(lng);
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(V.AliciaPanelView, {
    t, snapshot, presence: null, acknowledged: new Set(acknowledged), lines: [], draft: '', sending: false,
    onAcknowledge: noop, onConfirm: noop, onCancel: noop, onGoToProposal: noop, onDraft: noop, onSend: noop, observability
  }));
  return { html, missing };
}
async function uiSnapshot(f) {
  const ui = C.createConfirmationController({
    requests: async () => f.lapitaya.listRequests(), approvals: async () => f.lapitaya.listApprovals(),
    confirm: async (id, token) => f.lapitaya.confirmRequest(id, { by: 'human', token }),
    cancel: async (id) => f.lapitaya.cancelRequest(id, 'human')
  });
  await ui.refresh();
  return ui;
}
const OBS_FILES = [
  'src/shared/lapitaya/alicia/observability.ts',
  'src/renderer/src/components/alicia/GovernanceExplanationView.tsx',
  'src/renderer/src/components/alicia/useGovernanceObservability.ts'
];

// ─── OBS-01..07: each runtime fact → its explanation ───────────────────────

test('[OBS-01] REQUEST_PROPOSED → correct, evidence-backed explanation', async (t) => {
  const f = await floor(t);
  const p = request(f);
  const v = project(f.lapitaya);
  const o = v.byProposal[p.id].latest;
  assert.equal(o.category, 'REQUEST_PROPOSED');
  assert.deepEqual([o.proposalId, o.intentId, o.scope, o.risk, o.rule, o.intentType],
    [p.id, p.intentId, p.scope, null, null, 'REQUEST'], 'scope from the runtime; no risk or rule invented');
  assert.deepEqual([o.requiredHumanAction, o.nextState], ['CONFIRM_REQUEST', 'WAITING_HUMAN_CONFIRMATION']);
  assert.equal(o.keys.why, 'alicia.observe.why.REQUEST_PROPOSED');
  const line = JSON.parse(lineFor(f, o.evidence.ref));
  assert.deepEqual([line.kind, line.transition, line.proposalId], ['request', 'PROPOSED', p.id], 'the evidence ref resolves to the real ledger line');
  const es = O.explainObservation(o, 'es-MX');
  assert.equal(es.what, `Tu solicitud quedó como REQUEST: una propuesta (${p.id}).`);
  assert.match(es.why, /el runtime no deja ejecutar nada en el piso hasta que lo confirmes/);
  assert.equal(es.next, 'Nada se ejecuta hasta que confirmes o canceles la propuesta.');
  assert.equal(es.humanAction, 'Confirmar o cancelar la propuesta.');
});

test('[OBS-02] REQUEST_CONFIRMATION_REQUIRED → blocked, rule, runtime risk, "no se ejecutó"', async (t) => {
  const f = await floor(t);
  const p = request(f);
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, true);
  let o = latestOf(project(f.lapitaya), 'REQUEST_CONFIRMATION_REQUIRED');
  assert.deepEqual([o.decision, o.rule, o.risk, o.autonomy, o.proposalId, o.agent, o.operation],
    ['DENY', 'REQUEST_CONFIRMATION_REQUIRED', 'LOW', 'AUTO', p.id, 'god', 'Bash · run-tests']);
  assert.deepEqual([o.nextState, o.requiredHumanAction], ['WAITING_HUMAN_CONFIRMATION', 'CONFIRM_REQUEST']);
  assert.equal(o.keys.why, 'alicia.explain.REQUEST_CONFIRMATION_REQUIRED', 'the existing deterministic rule → key mapping');
  const es = O.explainObservation(o, 'es-MX');
  assert.equal(es.what, 'La acción fue bloqueada: god intentó Bash · run-tests.');
  assert.equal(es.rule, 'REQUEST_CONFIRMATION_REQUIRED');
  const line = JSON.parse(lineFor(f, o.evidence.ref));
  assert.deepEqual([line.kind, line.decision, line.rule], ['governance', 'DENY', 'REQUEST_CONFIRMATION_REQUIRED']);
  // Once the human cancels, the same fact explains what it was: nothing executed.
  f.lapitaya.cancelRequest(p.id, 'human');
  o = latestOf(project(f.lapitaya), 'REQUEST_CONFIRMATION_REQUIRED');
  assert.deepEqual([o.nextState, o.requiredHumanAction], ['NOT_EXECUTED', 'NONE']);
  assert.equal(O.explainObservation(o, 'es-MX').next, 'No se ejecutó ninguna herramienta.');
});

test('[OBS-03] REQUEST_SCOPE_EXCEEDED → correct explanation (MEDIUM stays MEDIUM)', async (t) => {
  const f = await floor(t);
  const p = request(f);
  confirm(f, p);
  assert.equal((await attempt(f, 'god', editCall(f))).denied, true);
  const o = latestOf(project(f.lapitaya), 'REQUEST_SCOPE_EXCEEDED');
  assert.deepEqual([o.decision, o.rule, o.risk, o.autonomy, o.nextState], ['DENY', 'REQUEST_SCOPE_EXCEEDED', 'MEDIUM', 'SUPERVISED', 'NOT_EXECUTED']);
  assert.equal(o.keys.why, 'alicia.explain.REQUEST_SCOPE_EXCEEDED');
  assert.equal(O.explainObservation(o, 'en-US').why, 'The action goes beyond what you confirmed in the proposal, so it did not run.');
});

test('[OBS-04] STALE_PROPOSAL → correct explanation', async (t) => {
  const f = await floor(t);
  const s = f.lapitaya.openRequest({ intentId: 'int-stale', executor: 'god', requestedBy: 'human', source: 'alicia',
    message: 'borra la base de datos', taskId: null, target: null, signals: [] });
  assert.equal(f.lapitaya.confirmRequest(s.id, { by: 'human', token: s.token }).code, 'STALE_PROPOSAL');
  const o = project(f.lapitaya).byProposal[s.id].latest;
  assert.deepEqual([o.category, o.rule, o.runtimeStatus, o.nextState], ['REQUEST_BLOCKED', 'STALE_PROPOSAL', 'BLOCKED', 'CLOSED']);
  assert.equal(O.explainObservation(o, 'es-MX').why, 'La propuesta ya no es válida; hay que volver a pedirla.');
});

test('[OBS-05] TAMPERED → correct explanation', async (t) => {
  const f = await floor(t);
  const p = request(f);
  assert.equal(f.lapitaya.confirmRequest(p.id, { by: 'human', token: 'f'.repeat(32) }).code, 'TAMPERED');
  const o = latestOf(project(f.lapitaya), 'REQUEST_CONFIRMATION_DENIED');
  assert.deepEqual([o.rule, o.agent, o.proposalId, o.nextState], ['TAMPERED', 'human', p.id, 'NOT_EXECUTED']);
  assert.equal(O.explainObservation(o, 'es-MX').why, 'La confirmación no coincide con la propuesta, así que se rechazó.');
});

test('[OBS-06] NOT_AUTHORIZED → correct explanation', async (t) => {
  const f = await floor(t);
  const p = request(f);
  assert.equal(f.lapitaya.confirmRequest(p.id, { by: 'alicia', token: p.token }).code, 'NOT_AUTHORIZED');
  const o = latestOf(project(f.lapitaya), 'REQUEST_CONFIRMATION_DENIED');
  assert.deepEqual([o.rule, o.agent], ['NOT_AUTHORIZED', 'alicia']);
  assert.equal(O.explainObservation(o, 'en-US').why, 'Alicia has no authority to approve or to issue a DECISION; that belongs to you and El Inge.');
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === p.id).status, 'PROPOSED');
});

test('[OBS-07] HUMAN_APPROVAL_REQUIRED → "not an approval", then approval → execution, all linked', async (t) => {
  const f = await floor(t);
  const p = request(f, 'Quiero que El Beni implemente la validación del formulario.');
  confirm(f, p);
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED');
  let v = project(f.lapitaya);
  let o = v.byProposal[p.id].latest;
  assert.equal(o.category, 'HUMAN_APPROVAL_REQUIRED');
  assert.deepEqual([o.risk, o.autonomy, o.decision, o.requiredHumanAction, o.nextState], ['HIGH', 'HUMAN_APPROVAL', 'HUMAN_APPROVAL_REQUIRED', 'DECIDE_APPROVAL', 'WAITING_HUMAN_APPROVAL']);
  const [apr] = f.lapitaya.listApprovals();
  assert.equal(o.approvalId, apr.id);
  // Later routine work under the same proposal never hides the pending HIGH decision.
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, false);
  await f.ran('god', 'npm test', 'pass');
  const still = project(f.lapitaya).byProposal[p.id];
  assert.equal(still.timeline[still.timeline.length - 1].category, 'EXECUTION_COMPLETED');
  assert.equal(still.latest.category, 'HUMAN_APPROVAL_REQUIRED', 'the card leads with what still needs the human');
  const es = O.explainObservation(o, 'es-MX');
  assert.equal(es.why, 'Esta acción requiere tu aprobación porque está clasificada como riesgo alto.');
  assert.match(es.next, /Confirmar el REQUEST no aprobó esta acción HIGH\./);
  assert.doesNotMatch(JSON.stringify(es), /[Aa]probad[ao]\b|approved/);
  // The human approves separately; the agent retries; the harness records the run.
  f.lapitaya.decide(apr.id, true, 'human');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'APPROVED');
  await f.post('god', HIGH_CALL.tool, HIGH_CALL.input, { stdout: '', stderr: '', interrupted: false });
  v = project(f.lapitaya);
  const cats = v.byProposal[p.id].timeline.map((x) => x.category);
  for (const c of ['HUMAN_APPROVAL_REQUIRED', 'APPROVAL_GRANTED', 'ACTION_AUTHORIZED', 'EXECUTION_COMPLETED']) assert.ok(cats.includes(c), c);
  const tl = v.byProposal[p.id].timeline;
  const approvedRun = tl.findIndex((x) => x.category === 'EXECUTION_COMPLETED' && x.approvalId === apr.id);
  assert.ok(approvedRun > cats.indexOf('APPROVAL_GRANTED'), 'the approved call runs after the approval');
  o = v.byProposal[p.id].timeline.find((x) => x.category === 'HUMAN_APPROVAL_REQUIRED');
  assert.deepEqual([o.requiredHumanAction, o.nextState], ['NONE', 'SEE_LATER_EVENTS'], 'no longer asks for a decision already made');
  const run = tl[approvedRun];
  const trace = f.lapitaya.recentTraces().find((x) => x.id === run.evidence.ref);
  assert.ok(trace && trace.ok, 'linked to the real PostToolUse trace');
  assert.deepEqual([run.approvalId, run.proposalId, run.risk], [apr.id, p.id, 'HIGH']);
});

// ─── OBS-08..12: read only, no invention ───────────────────────────────────

test('[OBS-08][OBS-09][OBS-10] Alicia cannot modify the event, the risk or the decision', async (t) => {
  const f = await floor(t);
  const p = request(f);
  await attempt(f, 'god', TEST_CALL);
  const ledgerBefore = fs.readFileSync(path.join(f.hive.root(), 'lapitaya', 'cima-ledger.jsonl'), 'utf8');
  const sources = { ledger: f.lapitaya.ledger(), traces: f.lapitaya.recentTraces(), approvals: f.lapitaya.listApprovals(), requests: f.lapitaya.listRequests() };
  const copy = JSON.parse(JSON.stringify(sources));
  const v = O.projectObservability(sources);
  assert.deepEqual(sources, copy, 'the projection never mutates its inputs');
  const o = latestOf(v, 'REQUEST_CONFIRMATION_REQUIRED');
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.recent) && Object.isFrozen(o) && Object.isFrozen(o.keys) && Object.isFrozen(o.evidence));
  assert.throws(() => { 'use strict'; o.risk = 'LOW'; }, TypeError);
  assert.throws(() => { 'use strict'; o.decision = 'ALLOW'; }, TypeError);
  assert.throws(() => { 'use strict'; o.rule = 'X'; }, TypeError);
  assert.throws(() => { 'use strict'; v.recent.push(o); }, TypeError);
  assert.equal(fs.readFileSync(path.join(f.hive.root(), 'lapitaya', 'cima-ledger.jsonl'), 'utf8'), ledgerBefore, 'no write');
  // Risk and decision are the runtime's: a claimed risk does not change them.
  const r = f.companion.submit('Borra la base de datos de producción.', { suggestedRisk: 'LOW' });
  const g = project(f.lapitaya).recent.find((x) => x.intentId === r.outcome.id && x.category === 'INTENT_GOVERNED');
  assert.ok(g, 'a HIGH ACTION CIMA stopped is shown to the human');
  assert.deepEqual([g.risk, g.decision], [r.outcome.risk, 'HUMAN_APPROVAL_REQUIRED'], 'the runtime risk and decision, not the claimed ones');
  // No approval exists until El Inge attempts the exact call: nothing to decide yet, and it says so.
  assert.equal(f.lapitaya.listApprovals().length, 0);
  assert.deepEqual([g.requiredHumanAction, g.nextState], ['NONE', 'APPROVAL_ON_ATTEMPT']);
  assert.equal(g.risk, 'HIGH');
  // Values outside the runtime vocabulary are never coerced into it.
  const [odd] = O.observeLedgerRecord({ kind: 'governance', ts: 1, agentId: 'god', tool: 'Bash', category: 'x', risk: 'low-ish', mode: 'MANUAL', decision: 'MAYBE', rule: 'r' });
  assert.deepEqual([odd.category, odd.risk, odd.autonomy, odd.decision, odd.keys.why], ['UNKNOWN_EVENT', null, null, 'MAYBE', 'alicia.observe.unavailable']);
  // The Alicia layer exposes no write path for any of it.
  const src = code(read('src/shared/lapitaya/alicia/observability.ts'));
  assert.doesNotMatch(src, /\bfs\b|writeFile|appendFile|\.append\(|confirmRequest|cancelRequest|decide\(|authorize|onEvent/);
  assert.equal(p.status, 'PROPOSED');
});

test('[OBS-11] no second ledger: Alicia persists nothing; the projection reads the runtime files only', async (t) => {
  const f = await floor(t);
  const p = request(f);
  await attempt(f, 'god', TEST_CALL);
  confirm(f, p);
  await attempt(f, 'god', TEST_CALL);
  await f.ran('god', 'npm test', 'ok');
  for (let i = 0; i < 3; i++) project(f.lapitaya);
  const files = fs.readdirSync(path.join(f.hive.root(), 'lapitaya')).sort();
  assert.deepEqual(files.filter((x) => !['approvals.json', 'cima-ledger.jsonl', 'proposals.json', 'traces.jsonl'].includes(x)), [], `unexpected files: ${files}`);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]));
  assert.equal(walk(f.hive.root()).filter((n) => /alicia|observ/i.test(n)).length, 0);
  const handler = code(read('src/main/index.ts'));
  const h = handler.slice(handler.indexOf("ipcMain.handle('lapitaya:observability'"), handler.indexOf("ipcMain.handle('lapitaya:ledger'"));
  assert.match(h, /projectObservability\(\{\s*ledger: lapitaya\.ledger\(3000\),\s*traces: lapitaya\.recentTraces\(1000\),\s*approvals: lapitaya\.listApprovals\(\),\s*requests: lapitaya\.listRequests\(\)\s*\}/);
  assert.doesNotMatch(h, /append|write|confirmRequest|cancelRequest|decide|authorize/);
});

test('[OBS-12] no explanation without evidence: unlinked traces claim nothing; every fact carries its source', async (t) => {
  const f = await floor(t);
  const p = request(f);
  confirm(f, p);
  // A PostToolUse with no matching governance decision (no PreToolUse) is not an execution claim.
  await f.ran('god', 'npm run lint', 'ok');
  // A trace from another agent for a call god was authorized for does not link either.
  await attempt(f, 'god', TEST_CALL);
  await f.ran('el-beni-1', 'npm test', 'ok');
  const v = project(f.lapitaya);
  assert.equal(v.byProposal[p.id].timeline.filter((o) => o.category.startsWith('EXECUTION_')).length, 0);
  for (const o of [...v.recent, ...v.byProposal[p.id].timeline]) {
    assert.ok(o.evidence && /^(EVT-[0-9a-f]{8}(\.\d+)?|trc-[a-z0-9-]+)$/.test(o.evidence.ref), o.category);
    if (o.evidence.source === 'cima-ledger.jsonl') assert.ok(lineFor(f, o.evidence.ref), `${o.evidence.ref} resolves`);
  }
  // A synthetic trace carrying a fingerprint no decision has → nothing.
  const none = O.projectObservability({ ledger: f.lapitaya.ledger(), traces: [{ id: 'trc-x-1', ts: 9e15, agentId: 'god', tool: 'Bash', ok: true, fingerprint: 'deadbeef' }] });
  assert.equal(none.recent.filter((o) => o.evidence.ref === 'trc-x-1').length, 0);
  // With no evidence at all the UI says so instead of claiming anything.
  const { t: tt } = strictT('es-MX');
  const html = renderToStaticMarkup(React.createElement(G.ObservationExplanation, { t: tt, obs: { ...v.recent[0], evidence: null } }));
  assert.match(html, /Sin evidencia registrada; no se afirma nada\./);
});

// ─── OBS-13..15: timeline and sensitive data ───────────────────────────────

test('[OBS-13][OBS-14] the timeline is exactly the real facts, in order, and read only', async (t) => {
  const f = await floor(t);
  const p = request(f);
  await attempt(f, 'god', TEST_CALL);
  await attempt(f, 'god', TEST_CALL);
  confirm(f, p);
  await attempt(f, 'god', TEST_CALL);
  await f.ran('god', 'npm test', 'pass');
  await attempt(f, 'god', editCall(f));
  const { timeline, latest } = project(f.lapitaya).byProposal[p.id];
  const steps = timeline.map((o) => `${o.category}${o.count > 1 ? `x${o.count}` : ''}`);
  const expected = ['INTENT_RECEIVED', 'REQUEST_PROPOSED', 'INTENT_CLASSIFIED', 'INTENT_FORWARDED', 'REQUEST_CONFIRMATION_REQUIREDx2',
    'REQUEST_REVALIDATED', 'REQUEST_CONFIRMED', 'ACTION_AUTHORIZED', 'EXECUTION_COMPLETED', 'REQUEST_SCOPE_EXCEEDED'];
  // Intent trail steps share the boundary's clock with the proposal; compare as a multiset + the governed order.
  assert.deepEqual([...steps].sort(), [...expected].sort());
  const governed = steps.filter((s) => !s.startsWith('INTENT_'));
  assert.deepEqual(governed, ['REQUEST_PROPOSED', 'REQUEST_CONFIRMATION_REQUIREDx2', 'REQUEST_REVALIDATED', 'REQUEST_CONFIRMED', 'ACTION_AUTHORIZED', 'EXECUTION_COMPLETED', 'REQUEST_SCOPE_EXCEEDED']);
  assert.equal(latest.category, 'REQUEST_SCOPE_EXCEEDED');
  // Each entry maps to a real record.
  const transitions = f.ledger().filter((e) => e.kind === 'request' && e.proposalId === p.id).map((e) => e.transition);
  assert.deepEqual(transitions, ['PROPOSED', 'REVALIDATED', 'CONFIRMED']);
  // Read only: frozen, and rendered as a list with no controls.
  assert.ok(Object.isFrozen(timeline) && timeline.every((o) => Object.isFrozen(o)));
  const ui = await uiSnapshot(f);
  const { html, missing } = renderPanel(ui.getSnapshot(), project(f.lapitaya));
  assert.deepEqual(missing, []);
  const tl = html.slice(html.indexOf('<details data-field="timeline"'), html.indexOf('</details>') + 10);
  assert.match(tl, /^<details data-field="timeline"[^>]*><summary>Ver línea de tiempo \(10 eventos\)<\/summary><ol id="alicia-timeline-/);
  assert.match(tl, /aria-label="Línea de tiempo del REQUEST req-[^"]+ \(solo lectura\)"/);
  assert.doesNotMatch(tl, /<button|<input|<select|<textarea|contenteditable|onclick|data-action/i);
  assert.equal((tl.match(/<li /g) ?? []).length, 10);
});

test('[OBS-15] no tokens, secrets, commands, paths or outputs in the projection or the UI', async (t) => {
  const f = await floor(t);
  const p = request(f);
  const token = p.token;
  await attempt(f, 'god', { tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer sk-live-SECRET123" https://x' } });
  confirm(f, p);
  await attempt(f, 'god', TEST_CALL);
  await f.ran('god', 'npm test', 'OUTPUT-SECRET-42');
  await attempt(f, 'god', editCall(f));
  const v = project(f.lapitaya);
  const ui = await uiSnapshot(f);
  const json = JSON.stringify(v);
  const html = renderPanel(ui.getSnapshot(), v).html + renderPanel(ui.getSnapshot(), v, 'en-US').html;
  const fingerprints = f.ledger().filter((e) => e.fingerprint).map((e) => e.fingerprint);
  assert.ok(fingerprints.length > 0);
  for (const bad of [token, 'sk-live', 'SECRET', 'Bearer', 'curl', 'npm test', 'OUTPUT-', f.home, f.hive.root(), 'app.ts', 'outputHead', 'subject', ...fingerprints]) {
    assert.ok(!json.includes(bad), `projection leaks ${bad}`);
    assert.ok(!html.includes(bad), `UI leaks ${bad}`);
  }
  // Identifiers that look like secrets are dropped, not shown.
  const [o] = O.observeLedgerRecord({ kind: 'governance', ts: 1, agentId: 'sk-proj-abcdef', tool: 'Bash', category: 'run-tests', risk: 'LOW', mode: 'AUTO', decision: 'ALLOW', rule: 'a'.repeat(30) + 'deadbeefdeadbeefdeadbeef' });
  assert.deepEqual([o.agent, o.rule], [null, null]);
  // The new runtime signals carry no command, path or fingerprint either.
  for (const e of f.runtimeEvents.filter((x) => x.type === 'governance' || x.type === 'trace')) {
    assert.doesNotMatch(JSON.stringify(e.data), /action|fingerprint|subject|outputHead|npm test|curl/);
  }
});

// ─── OBS-16..18: i18n, no model ────────────────────────────────────────────

test('[OBS-16][OBS-17] es-MX and en-US: identical trees, every key the projection can emit exists, no fallback', async (t) => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const es = keys(LOCALES['es-MX'].alicia.observe).sort();
  const en = keys(LOCALES['en-US'].alicia.observe).sort();
  assert.deepEqual(es, en);
  const emit = new Set([
    ...O.OBSERVATION_CATEGORIES.map((c) => `what.${c}`), ...[...O.CATEGORY_WHY].map((c) => `why.${c}`),
    ...O.NEXT_STATES.map((n) => `next.${n}`), 'autonomy.AUTO', 'autonomy.SUPERVISED', 'autonomy.HUMAN_APPROVAL',
    'action.CONFIRM_REQUEST', 'action.DECIDE_APPROVAL', 'unavailable'
  ]);
  for (const k of emit) assert.ok(es.includes(k), `observe.${k}`);
  // "why" keys borrowed from the existing mapping exist too (every explanationKey outcome).
  for (const lng of ['es-MX', 'en-US']) for (const k of Object.keys(LOCALES['en-US'].alicia.explain)) assert.ok(LOCALES[lng].alicia.explain[k], `${lng} explain.${k}`);
  // Render every category, both locales, strict i18next: nothing missing, no raw keys.
  const f = await floor(t);
  const p = request(f);
  await attempt(f, 'god', TEST_CALL);
  confirm(f, p);
  await attempt(f, 'god', HIGH_CALL);
  const real = project(f.lapitaya);
  const synthetic = O.OBSERVATION_CATEGORIES.map((c, i) => ({ ...real.recent[0], eventId: `EVT-0000000${i}`, category: c,
    keys: { ...real.recent[0].keys, what: `alicia.observe.what.${c}` } }));
  for (const lng of ['es-MX', 'en-US']) {
    const { t: tt, missing } = strictT(lng);
    const html = renderToStaticMarkup(React.createElement(G.GovernanceActivity, { t: tt, view: { recent: [...real.recent, ...synthetic], byProposal: {} } }))
      + renderPanel((await uiSnapshot(f)).getSnapshot(), real, lng).html;
    assert.deepEqual(missing, [], lng);
    assert.doesNotMatch(html, /alicia\.observe\.|lapitaya:/, `${lng}: unresolved key`);
    for (const tech of ['HUMAN_APPROVAL_REQUIRED', 'REQUEST_CONFIRMATION_REQUIRED', 'HIGH', 'LOW', 'HUMAN_APPROVAL']) assert.ok(html.includes(tech), `${lng} keeps ${tech}`);
  }
  // No visible literals in the new view.
  const view = code(read('src/renderer/src/components/alicia/GovernanceExplanationView.tsx'));
  const literals = [...view.matchAll(/>([^<>{}=;]*[A-Za-zÁ-ú]{2,}[^<>{}=;]*)</g)].map((m) => m[1].trim()).filter(Boolean);
  assert.deepEqual(literals, []);
});

test('[OBS-18] governance explanation has no LLM / provider / network dependency', () => {
  for (const file of OBS_FILES) {
    const src = code(read(file));
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const imp of imports) {
      assert.match(imp, /^(\.\/messages|\.\/confirmationController|\.\/GovernanceExplanationView|@shared\/lapitaya\/alicia(\/observability)?|react)$/, `${file} imports ${imp}`);
    }
    assert.doesNotMatch(src, /provider|openai|anthropic|fetch\(|XMLHttpRequest|WebSocket|complete\(|generate\(|model/i, file);
  }
});

// ─── OBS-19..23: nothing about governance changed ─────────────────────────

test('[OBS-19] the governance event stream still works; the new signals raise no notifications', async (t) => {
  const f = await floor(t);
  const p = request(f);
  const before = f.companion.snapshot().notifications.length;
  for (let i = 0; i < 5; i++) await attempt(f, 'god', TEST_CALL);
  const types = f.runtimeEvents.map((e) => e.type);
  assert.ok(types.includes('request') && types.includes('intent') && types.includes('governance'));
  assert.equal(f.companion.snapshot().notifications.length, before, 'per-call denials are observability, not notification spam');
  assert.deepEqual(A.fromRuntimeEvent({ type: 'governance', data: {} }, 1), []);
  assert.deepEqual(A.fromRuntimeEvent({ type: 'trace', data: {} }, 1), []);
  confirm(f, p);
  await attempt(f, 'god', HIGH_CALL);
  const notif = f.companion.snapshot().notifications.map((n) => n.eventType);
  assert.ok(notif.includes('request.proposed') && notif.includes('request.confirmed') && notif.includes('approval.required'));
  assert.equal(notif.filter((x) => x === 'approval.required').length, 1);
  await attempt(f, 'god', HIGH_CALL);
  assert.equal(f.companion.snapshot().notifications.filter((n) => n.eventType === 'approval.required').length, 1, 'a retried HIGH call does not notify twice');
  // The renderer subscribes to the SAME stream; the preload exposes one read-only call more.
  const preload = code(read('src/preload/index.ts'));
  assert.match(preload, /lapitayaObservability: \(opts\?: \{ recentLimit\?: number \}\): Promise<ObservabilityView> =>\s*ipcRenderer\.invoke\('lapitaya:observability', opts \?\? \{\}\)/);
  const hook = code(read('src/renderer/src/components/alicia/useGovernanceObservability.ts'));
  assert.deepEqual([...new Set([...hook.matchAll(/window\.cth\.(\w+)/g)].map((m) => m[1]))].sort(), ['lapitayaObservability', 'onLapitayaGovernance']);
});

test('[OBS-20][OBS-21] REQUEST confirmation and HIGH approval behave exactly as in v0.5', async (t) => {
  const f = await floor(t);
  const p = request(f, 'Quiero que El Beni implemente la validación del formulario.');
  const ui = await uiSnapshot(f);
  const withObs = renderPanel(ui.getSnapshot(), project(f.lapitaya)).html;
  const card = withObs.slice(withObs.indexOf(`data-proposal-id="${p.id}"`), withObs.indexOf('</section>', withObs.indexOf(`data-proposal-id="${p.id}"`)));
  assert.deepEqual([...card.matchAll(/data-action="(\w[\w-]*)"/g)].map((m) => m[1]), ['acknowledge', 'cancel', 'confirm']);
  assert.match(card, /<button[^>]*data-action="confirm"[^>]*disabled=""/);
  const without = renderPanel(ui.getSnapshot(), undefined).html;
  assert.doesNotMatch(without, /data-field="governance|data-observation/, 'no projection → the v0.5 panel, unchanged');
  await ui.confirm(p.id);
  assert.deepEqual(f.ledger().filter((e) => e.kind === 'request' && e.proposalId === p.id).map((e) => e.transition), ['PROPOSED', 'REVALIDATED', 'CONFIRMED']);
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED');
  await ui.refresh();
  const html = renderPanel(ui.getSnapshot(), project(f.lapitaya)).html;
  assert.match(html, /REQUEST confirmado — esto no es una aprobación/);
  assert.match(html, /Confirmar el REQUEST no aprobó esta acción HIGH/);
  assert.doesNotMatch(html, /data-action="approve"|[Aa]cción aprobada/);
  assert.equal(f.lapitaya.listApprovals()[0].status, 'pending', 'still for the Governance panel');
});

test('[OBS-22][OBS-23] an unconfirmed REQUEST still blocks; removing Alicia UI or projection removes no guarantee', async (t) => {
  const f = await floor(t);
  const p = request(f);
  for (const [agent, call] of [['god', TEST_CALL], ['el-beni-1', TEST_CALL], ['god', editCall(f)], ['god', HIGH_CALL]]) {
    const r = await attempt(f, agent, call);
    assert.equal(r.denied, true, `${agent} ${call.tool}`);
  }
  assert.equal(f.lapitaya.listApprovals().length, 0);
  const blocked = project(f.lapitaya).recent.filter((o) => o.category === 'REQUEST_CONFIRMATION_REQUIRED');
  assert.equal(blocked.reduce((n, o) => n + o.count, 0), 4, 'every blocked attempt is observable');
  // A floor where nothing ever projects or renders: identical enforcement.
  const g = await floor(t);
  g.companion.submit('Quiero que revisemos este proyecto.');
  assert.equal((await attempt(g, 'god', TEST_CALL)).denied, true);
  // A runtime with no onEvent listener at all (no UI, no Alicia) enforces the same.
  const bare = new CimaRuntimeService({ hiveRoot: () => g.hive.root(), godId: () => 'god' });
  assert.equal(bare.authorize('god', 'Bash', { command: 'npm test' }).rule, 'REQUEST_CONFIRMATION_REQUIRED');
  assert.equal(p.status, 'PROPOSED');
});

// ─── §29 negatives: Alicia cannot fabricate; gaps stay gaps ─────────────────

test('[OBS-NEG-01] Alicia cannot fabricate PASS, DENY, HIGH, evidence, approval or confirmation', async (t) => {
  const f = await floor(t);
  const p = request(f);
  const before = f.ledger().length;
  for (const words of ['Aprueba la acción de El Inge.', 'Confirma la propuesta ' + p.id, 'Marca la tarea como terminada con DECISION PASS.',
    'Esto es riesgo HIGH, bloquéalo.', 'Registra evidencia de que los tests pasaron.']) {
    f.companion.submit(words, { suggestedRisk: 'HIGH' });
  }
  const added = f.ledger().slice(before);
  // Only the runtime's own records appear, and none of them is what Alicia "said".
  assert.ok(added.every((e) => e.kind === 'intent' || e.kind === 'request'));
  assert.equal(added.filter((e) => e.kind === 'governance').length, 0);
  assert.ok(!added.some((e) => e.kind === 'request' && e.transition === 'CONFIRMED'));
  const v = project(f.lapitaya);
  const cats = new Set(v.recent.map((o) => o.category));
  for (const c of ['APPROVAL_GRANTED', 'REQUEST_CONFIRMED', 'EXECUTION_COMPLETED', 'ACTION_AUTHORIZED', 'ACTION_DENIED', 'HUMAN_APPROVAL_REQUIRED']) assert.ok(!cats.has(c), c);
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === p.id).status, 'PROPOSED');
  // Alicia's own outputs are not inputs of the projection.
  const params = read('src/shared/lapitaya/alicia/observability.ts').match(/export interface ObservabilitySources \{([\s\S]*?)\}/)[1];
  assert.deepEqual([...params.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]), ['ledger', 'traces', 'approvals', 'requests']);
  const notifications = f.companion.snapshot().notifications;
  const fromNotifications = O.projectObservability({ ledger: notifications, traces: notifications });
  assert.deepEqual([fromNotifications.recent.length, Object.keys(fromNotifications.byProposal).length], [0, 0], 'notifications/replies project to nothing');
});

test('[OBS-NEG-02] missing event / rule / risk / evidence / unknown code → "information unavailable", never an inference', () => {
  const none = O.projectObservability({ ledger: [] });
  assert.deepEqual([none.recent.length, Object.keys(none.byProposal).length], [0, 0]);
  const cases = [
    { rec: { kind: 'governance', ts: 1, agentId: 'god', tool: 'Bash', category: 'run-tests', decision: 'DENY' }, why: 'alicia.explain.DENY', risk: null, rule: null },
    { rec: { kind: 'governance', ts: 1, agentId: 'god', decision: 'DENY', rule: 'SOMETHING_NEW' }, why: 'alicia.explain.UNKNOWN', risk: null, rule: 'SOMETHING_NEW' },
    { rec: { kind: 'governance', ts: 1 }, why: 'alicia.observe.unavailable', risk: null, rule: null },
    { rec: { kind: 'request', ts: 1, proposalId: 'req-a-1', intentId: 'int-a-1', transition: 'CONFIRMATION_DENIED', status: 'PROPOSED', by: 'human', scope: 'LOW', code: 'BRAND_NEW_CODE' }, why: 'alicia.explain.UNKNOWN', risk: null, rule: 'BRAND_NEW_CODE' },
    { rec: { kind: 'request', ts: 1, proposalId: 'req-a-1', transition: 'BLOCKED', status: 'BLOCKED', by: 'runtime', scope: 'LOW' }, why: 'alicia.observe.unavailable', risk: null, rule: null },
    { rec: { kind: 'request', ts: 1, proposalId: 'req-a-1', transition: 'TELEPORTED' }, why: 'alicia.observe.unavailable', risk: null, rule: null }
  ];
  for (const c of cases) {
    const [o] = O.observeLedgerRecord(c.rec);
    assert.deepEqual([o.keys.why, o.risk, o.rule], [c.why, c.risk, c.rule], JSON.stringify(c.rec));
    const es = O.explainObservation(o, 'es-MX');
    assert.doesNotMatch(es.why, /peligros|dangerous|archivo|file/i, 'no invented reason');
  }
  assert.equal(O.explainObservation(O.observeLedgerRecord({ kind: 'governance', ts: 1 })[0], 'es-MX').why, 'No se puede confirmar el motivo con la evidencia disponible.');
  assert.equal(O.explainObservation(O.observeLedgerRecord({ kind: 'request', ts: 1, transition: 'TELEPORTED' })[0], 'en-US').next, 'There is not enough information to say what comes next.');
  assert.deepEqual(O.observeLedgerRecord({ kind: 'alicia-said', text: 'ACTION APPROVED' }), [], 'not a runtime record → no fact');
  assert.deepEqual(O.observeLedgerRecord(null), []);
});
