'use strict';
/**
 * La Pitaya Alicia v0.7 — Human Governance & Decision Center.
 *
 *   RUNTIME → FACT (v0.6 projection) → EXPLANATION → DECISION CENTER → HUMAN → EXISTING RUNTIME AUTHORITY
 *
 * Two distinct runtime mechanisms, one surface:
 *   REQUEST confirmation → lapitaya:confirmRequest / lapitaya:cancelRequest (v0.5 controller)
 *   HIGH approval        → lapitaya:decide (the existing CIMA human approval)
 *
 * Everything runs against the REAL runtime (test/fixtures/lapitaya-floor.cjs,
 * real PreToolUse / PostToolUse through the HookServer). The ports below make
 * exactly the calls the IPC handlers in src/main/index.ts make (checked
 * structurally in DC-04 / DC-08). The view is rendered with react-dom/server
 * and the shipped catalogs. DC-29 / DC-30 are the real-Electron flows
 * (evidence/lapitaya-alicia-v0.7/electron).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const i18next = require('i18next');
const { floor, loadTs } = require('./fixtures/lapitaya-floor.cjs');
const O = loadTs('src/shared/lapitaya/alicia/observability.ts');
const C = loadTs('src/renderer/src/components/alicia/confirmationController.ts');
const D = loadTs('src/renderer/src/components/alicia/decisionCenter.ts');
const V = loadTs('src/renderer/src/components/alicia/AliciaPanelView.tsx');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

const TEST_CALL = { tool: 'Bash', input: { command: 'npm test' } };
const HIGH_CALL = { tool: 'Bash', input: { command: 'rm -rf /srv/data' } };
const DC_FILES = [
  'src/renderer/src/components/alicia/decisionCenter.ts',
  'src/renderer/src/components/alicia/DecisionCenterView.tsx',
  'src/renderer/src/components/alicia/useDecisionCenter.ts',
  'src/renderer/src/components/alicia/decisionCenterPresence.ts'
];

// ─── the IPC, exactly as main wires it ─────────────────────────────────────

/** lapitaya:decide — `decide(id, approve, 'human')`, answering only the outcome (see DC-08). */
const decideIpc = (rt) => (id, approve) => {
  if (typeof id !== 'string' || typeof approve !== 'boolean') return null;
  const a = rt.decide(id, approve, 'human');
  return a ? { id: a.id, status: a.status, decidedAt: a.decidedAt ?? null, decidedBy: a.decidedBy ?? null } : null;
};
const project = (rt) => O.projectObservability({ ledger: rt.ledger(3000), traces: rt.recentTraces(1000), approvals: rt.listApprovals(), requests: rt.listRequests() });
function spyPorts(rt) {
  const calls = [];
  const requestPort = {
    requests: async () => rt.listRequests(),
    approvals: async () => (project(rt).pendingApprovals ?? []).map((o) => ({ id: o.approvalId, status: 'pending', risk: o.risk, createdAt: o.timestamp })),
    confirm: async (id, token) => { calls.push(['confirmRequest', id]); return rt.confirmRequest(id, { by: 'human', token }); },
    cancel: async (id) => { calls.push(['cancelRequest', id]); return rt.cancelRequest(id, 'human'); }
  };
  const approvalPort = { decide: async (id, approve) => { calls.push(['decide', id, approve]); return decideIpc(rt)(id, approve); } };
  return { calls, requestPort, approvalPort };
}
/** A Decision Center the way AliciaPanel builds it: v0.5 REQUEST controller + v0.7 approval controller + v0.6 projection. */
async function center(f) {
  const ports = spyPorts(f.lapitaya);
  const requests = C.createConfirmationController(ports.requestPort);
  const approvals = D.createApprovalController(ports.approvalPort);
  await requests.refresh();
  const model = () => D.buildDecisionCenter(requests.getSnapshot(), project(f.lapitaya), approvals.getSnapshot());
  const approve = (id) => approvals.approve(id, !!model().high.find((d) => d.approvalId === id && d.pending));
  const reject = (id) => approvals.reject(id, !!model().high.find((d) => d.approvalId === id && d.pending));
  return { ports, requests, approvals, model, approve, reject };
}
function request(f, message = 'Quiero que El Beni implemente la validación del formulario.') {
  const r = f.companion.submit(message);
  assert.equal(r.outcome.type, 'REQUEST');
  return f.lapitaya.listRequests().find((p) => p.id === r.outcome.proposalId);
}
async function attempt(f, agent, call) {
  const r = await f.pre(agent, call.tool, call.input);
  return { denied: r?.hookSpecificOutput?.permissionDecision === 'deny', decision: f.server.lastPreDecision, reason: r?.hookSpecificOutput?.permissionDecisionReason ?? '' };
}
/** A confirmed REQUEST with one pending HIGH approval raised under it. */
async function withPendingHigh(f) {
  const p = request(f);
  f.lapitaya.confirmRequest(p.id, { by: 'human', token: p.token });
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED');
  const [apr] = f.lapitaya.listApprovals();
  return { p, apr };
}
const LOCALES = {
  'es-MX': JSON.parse(read('src/renderer/src/i18n/locales/lapitaya/es-MX.json')),
  'en-US': JSON.parse(read('src/renderer/src/i18n/locales/lapitaya/en-US.json'))
};
function strictT(lng) {
  const missing = [];
  const inst = i18next.createInstance();
  inst.init({ lng, fallbackLng: false, initAsync: false, ns: ['lapitaya'], defaultNS: 'lapitaya',
    resources: { [lng]: { lapitaya: LOCALES[lng] } }, interpolation: { escapeValue: false },
    saveMissing: true, missingKeyHandler: (_l, _n, k) => missing.push(k) });
  return { t: (k, o) => inst.t(k, o), missing };
}
function render(dc, f, { lng = 'es-MX', ack = [], highAck = [] } = {}) {
  const { t, missing } = strictT(lng);
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(V.AliciaPanelView, {
    t, snapshot: dc.requests.getSnapshot(), presence: null, acknowledged: new Set(ack), lines: [], draft: '', sending: false,
    onAcknowledge: noop, onConfirm: noop, onCancel: noop, onGoToProposal: noop, onDraft: noop, onSend: noop,
    observability: project(f.lapitaya), decisions: dc.model(), highAcknowledged: new Set(highAck),
    onAcknowledgeHigh: noop, onApproveHigh: noop, onRejectHigh: noop
  }));
  return { html, missing };
}
const section = (html, attr) => {
  const i = html.indexOf(attr);
  assert.ok(i >= 0, `${attr} rendered`);
  const start = html.lastIndexOf('<section', i);
  return html.slice(start, html.indexOf('</section>', html.indexOf('</details>', i)) + 10);
};
const button = (html, action) => (html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`)) ?? [null])[0];
const ledgerLines = (f) => fs.readFileSync(path.join(f.hive.root(), 'lapitaya', 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean);

// ─── REQUEST decisions ─────────────────────────────────────────────────────

test('[DC-01][DC-02][DC-03] a pending REQUEST appears, with runtime scope and resolvable evidence', async (t) => {
  const f = await floor(t);
  const p = request(f);
  const dc = await center(f);
  const m = dc.model();
  assert.deepEqual(m.counts, { total: 1, requests: 1, high: 0 });
  const { html, missing } = render(dc, f);
  assert.deepEqual(missing, []);
  assert.match(html, /<section data-decision-center="true" aria-labelledby="alicia-decision-center"/);
  assert.match(html, /DECISIONES HUMANAS/);
  assert.match(html, /Decisiones pendientes: 1 · REQUEST por confirmar: 1 · acciones HIGH por aprobar: 0/);
  const card = section(html, `data-proposal-id="${p.id}"`);
  assert.match(card, /data-decision-type="REQUEST_CONFIRMATION"/);
  assert.match(card, />CONFIRMACIÓN DE REQUEST</);
  assert.match(card, /No es una aprobación HIGH\./);
  assert.match(card, new RegExp(`data-scope="${p.scope}"`));
  assert.equal(p.scope, 'MEDIUM', 'the runtime scope (change work)');
  const refs = [...card.matchAll(/EVT-[0-9a-f]{8}/g)].map((x) => x[0]);
  assert.ok(refs.length > 0);
  for (const r of refs) assert.ok(ledgerLines(f).some((l) => O.evidenceRef(JSON.parse(l)) === r), `${r} resolves`);
});

test('[DC-04][DC-05] confirm and cancel go through lapitaya:confirmRequest / lapitaya:cancelRequest only', async (t) => {
  const f = await floor(t);
  const p = request(f);
  const q = request(f, 'Quiero que revisemos el módulo de pagos.');
  const dc = await center(f);
  assert.equal((await dc.requests.confirm(p.id)).ok, true);
  assert.equal((await dc.requests.cancel(q.id)).ok, true);
  assert.deepEqual(dc.ports.calls, [['confirmRequest', p.id], ['cancelRequest', q.id]]);
  const tr = (id) => f.ledger().filter((e) => e.kind === 'request' && e.proposalId === id).map((e) => `${e.transition}(${e.by})`);
  assert.deepEqual(tr(p.id), ['PROPOSED(alicia)', 'REVALIDATED(runtime)', 'CONFIRMED(human)']);
  assert.deepEqual(tr(q.id), ['PROPOSED(alicia)', 'CANCELLED(human)']);
  assert.ok(dc.model().history.some((o) => o.category === 'REQUEST_CONFIRMED' && o.proposalId === p.id));
  assert.ok(dc.model().history.some((o) => o.category === 'REQUEST_CANCELLED' && o.proposalId === q.id));
  // The real wiring is still v0.5's.
  const panel = code(read('src/renderer/src/components/alicia/AliciaPanel.tsx'));
  assert.match(panel, /confirm: \(id, token\) => window\.cth\.lapitayaConfirmRequest\(id, token\)/);
  assert.match(panel, /cancel: \(id\) => window\.cth\.lapitayaCancelRequest\(id\)/);
});

// ─── HIGH decisions ────────────────────────────────────────────────────────

test('[DC-06][DC-07] a pending HIGH approval appears with the actual runtime risk, operation and explanation', async (t) => {
  const f = await floor(t);
  const { p, apr } = await withPendingHigh(f);
  const dc = await center(f);
  const m = dc.model();
  assert.deepEqual(m.counts, { total: 1, requests: 0, high: 1 });
  const [d] = m.high;
  assert.deepEqual([d.approvalId, d.uiState, d.pending, d.fact.risk, d.fact.operation, d.fact.proposalId, d.fact.agent],
    [apr.id, 'HUMAN_APPROVAL_REQUIRED', true, apr.risk, 'Bash · data-deletion', p.id, 'god']);
  assert.equal(apr.risk, 'HIGH');
  const { html, missing } = render(dc, f);
  assert.deepEqual(missing, []);
  const card = section(html, `data-approval-id="${apr.id}"`);
  assert.match(card, /data-decision-type="HIGH_APPROVAL"/);
  assert.match(card, /data-risk="HIGH"/);
  assert.match(card, />APROBACIÓN HUMANA DE ALTO RIESGO \(HIGH\)</);
  assert.match(card, /Esperando tu aprobación HIGH/);
  assert.match(card, /<b>HIGH<\/b> · Riesgo alto/);
  assert.match(card, /shell:recursive-delete/);
  assert.match(card, /Esta acción requiere tu aprobación porque está clasificada como riesgo alto\./);
  assert.match(card, new RegExp(`Surgió bajo el REQUEST ${p.id}\\. Confirmar ese REQUEST no aprobó esta acción\\.`));
  assert.match(card, /<details data-field="timeline"/);
});

test('[DC-08][DC-09] approve / reject use the existing human approval (lapitaya:decide → decide(id, approve, "human"))', async (t) => {
  const f = await floor(t);
  const { apr } = await withPendingHigh(f);
  const dc = await center(f);
  await dc.approve(apr.id);
  assert.deepEqual(dc.ports.calls.filter(([k]) => k === 'decide'), [['decide', apr.id, true]]);
  const a = f.lapitaya.listApprovals().find((x) => x.id === apr.id);
  assert.deepEqual([a.status, a.decidedBy], ['approved', 'human']);
  assert.ok(f.ledger().some((e) => e.kind === 'governance' && e.approvalId === apr.id && e.decision === 'HUMAN_APPROVED' && e.rule === 'human'));
  // Approving executes nothing: the agent must retry through PreToolUse, once.
  assert.equal(f.lapitaya.recentTraces().length, 0);
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'APPROVED');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED', 'one-shot');
  let d = D.buildDecisionCenter(dc.requests.getSnapshot(), project(f.lapitaya), dc.approvals.getSnapshot()).high.find((x) => x.approvalId === apr.id);
  assert.deepEqual([d.uiState, d.resolution, d.pending], ['APPROVED', 'APPROVAL_GRANTED', false]);
  // Reject: a second, new HIGH approval.
  const second = f.lapitaya.listApprovals().find((x) => x.status === 'pending');
  await dc.reject(second.id);
  assert.equal(f.lapitaya.listApprovals().find((x) => x.id === second.id).status, 'rejected');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).denied, true, 'a rejected call does not run');
  d = dc.model().high.find((x) => x.approvalId === second.id);
  assert.deepEqual([d.uiState, d.resolution], ['REJECTED', 'APPROVAL_REJECTED']);
  // The real wiring: renderer → preload → main handler, answering only the outcome.
  const hook = code(read('src/renderer/src/components/alicia/useDecisionCenter.ts'));
  assert.match(hook, /decide: \(id, approve\) => window\.cth\.lapitayaDecide\(id, approve\)/);
  const preload = code(read('src/preload/index.ts'));
  assert.match(preload, /lapitayaDecide: \(id: string, approve: boolean\)[^=]*=>\s*ipcRenderer\.invoke\('lapitaya:decide', id, approve\)/);
  const main = code(read('src/main/index.ts'));
  const h = main.slice(main.indexOf("ipcMain.handle('lapitaya:decide'"), main.indexOf("ipcMain.handle('lapitaya:requests'"));
  assert.match(h, /const a = lapitaya\.decide\(id, approve, 'human'\);/);
  assert.match(h, /return a \? \{ id: a\.id, status: a\.status, decidedAt: a\.decidedAt \?\? null, decidedBy: a\.decidedBy \?\? null \} : null;/);
  assert.equal((main.match(/lapitaya\.decide\(/g) ?? []).length, 1, 'one call site, by human');
});

test('[DC-10][DC-11] REQUEST confirmation ≠ HIGH approval, in both directions', async (t) => {
  const f = await floor(t);
  const { p, apr } = await withPendingHigh(f);
  // DC-10: the confirmed REQUEST did not approve the HIGH call.
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === p.id).status, 'CONFIRMED');
  assert.equal(f.lapitaya.listApprovals().find((x) => x.id === apr.id).status, 'pending');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED');
  // DC-11: approving the HIGH call does not confirm an unrelated pending REQUEST.
  f.hive.addTask({ id: 't-other', title: 'x', status: 'doing', assignee: 'god', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });
  const other = f.companion.submit('Quiero que revisemos el módulo de pagos.', { taskId: 't-other' }).outcome.proposalId;
  const tokenBefore = f.lapitaya.listRequests().find((x) => x.id === other).token;
  const dc = await center(f);
  await dc.approve(apr.id);
  const o = f.lapitaya.listRequests().find((x) => x.id === other);
  assert.deepEqual([o.status, o.token], ['PROPOSED', tokenBefore]);
  // …and the approved HIGH call still cannot run while that REQUEST is unconfirmed (the gate comes first).
  const r = await attempt(f, 'god', HIGH_CALL);
  assert.equal(r.denied, true);
  assert.match(r.reason, /^REQUEST_CONFIRMATION_REQUIRED/);
  assert.equal(f.lapitaya.listApprovals().find((x) => x.id === apr.id).status, 'approved', 'not consumed by a denied call');
  const { html } = render(dc, f);
  assert.match(html, /Confirmar un REQUEST y aprobar una acción HIGH son decisiones distintas/);
});

// ─── stale, replay, tamper, races ──────────────────────────────────────────

test('[DC-12][DC-13][DC-14] stale cannot be confirmed; consumed tokens/approvals cannot be replayed; tampered cannot execute', async (t) => {
  const f = await floor(t);
  const s = f.lapitaya.openRequest({ intentId: 'int-stale', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'borra la base de datos', taskId: null, target: null, signals: [] });
  const dc = await center(f);
  const st = await dc.requests.confirm(s.id);
  assert.equal(st.code, 'STALE_PROPOSAL');
  const staleCard = section(render(dc, f).html, `data-proposal-id="${s.id}"`);
  assert.match(staleCard, /data-ui-state="STALE"/);
  assert.equal(button(staleCard, 'confirm'), null);
  // Replay: a used REQUEST token.
  const p = request(f);
  const token = p.token;
  assert.equal(f.lapitaya.confirmRequest(p.id, { by: 'human', token }).ok, true);
  assert.equal(f.lapitaya.confirmRequest(p.id, { by: 'human', token }).code, 'NOT_CONFIRMABLE');
  // Replay: a decided approval, and a consumed one.
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED');
  const [apr] = f.lapitaya.listApprovals();
  assert.equal(decideIpc(f.lapitaya)(apr.id, true).status, 'approved');
  assert.equal(decideIpc(f.lapitaya)(apr.id, true), null, 'already decided');
  assert.equal(decideIpc(f.lapitaya)(apr.id, false), null, 'cannot flip it either');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'APPROVED');
  assert.equal(f.lapitaya.listApprovals().find((x) => x.id === apr.id).status, 'consumed');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED', 'a consumed approval never runs twice');
  // Tamper: a forged REQUEST token, a wrong proposal's token, a made-up approval id.
  const q = request(f, 'Quiero que revisemos el README.');
  const q2 = request(f, 'Quiero que analicemos los logs.');
  assert.equal(f.lapitaya.confirmRequest(q.id, { by: 'human', token: 'f'.repeat(32) }).code, 'TAMPERED');
  assert.equal(f.lapitaya.confirmRequest(q.id, { by: 'human', token: q2.token }).code, 'TAMPERED', "another proposal's token");
  assert.equal(decideIpc(f.lapitaya)('apr-forged-1', true), null);
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, true, 'nothing executes');
});

test('[DC-15][DC-16] double confirm / double approve / confirm+cancel and approve+reject races are one-shot', async (t) => {
  // Double confirm in one renderer: the second click never leaves the UI; the runtime records one confirmation.
  const f = await floor(t);
  const p = request(f);
  const dc = await center(f);
  const [a, b] = await Promise.all([dc.requests.confirm(p.id), dc.requests.confirm(p.id)]);
  assert.deepEqual([a.ok, b], [true, null]);
  assert.equal(f.ledger().filter((e) => e.kind === 'request' && e.proposalId === p.id && e.transition === 'CONFIRMED').length, 1);
  assert.equal(f.ledger().filter((e) => e.kind === 'request' && e.transition === 'CONFIRMATION_DENIED').length, 0);
  // Confirm vs cancel from two renderers: the runtime serializes; the end state is a valid one of its own.
  const g = await floor(t);
  const q = request(g, 'Quiero que revisemos el README.');
  const [r1, r2] = [await center(g), await center(g)];
  const [c1, c2] = await Promise.all([r1.requests.confirm(q.id), r2.requests.cancel(q.id)]);
  const final = g.lapitaya.listRequests().find((x) => x.id === q.id).status;
  const trs = g.ledger().filter((e) => e.kind === 'request' && e.proposalId === q.id).map((e) => e.transition);
  assert.ok((final === 'CANCELLED' && trs.at(-1) === 'CANCELLED') || (final === 'CONFIRMED' && c2.ok === false), `${final} ${trs}`);
  assert.equal(trs.filter((x) => x === 'CONFIRMED').length <= 1, true);
  assert.ok(c1 && c2, 'both renderers got a runtime answer');
  await r1.requests.refresh(); await r2.requests.refresh();
  for (const r of [r1, r2]) assert.equal(r.requests.getSnapshot().views.find((v) => v.id === q.id).status, final, 'both UIs converge on the runtime state');
  // Double approve in one renderer.
  const h = await floor(t);
  const { apr } = await withPendingHigh(h);
  const one = await center(h);
  // Both clicks land while the UI's (cached) state still says "pending".
  const [x1, x2] = await Promise.all([one.approvals.approve(apr.id, true), one.approvals.approve(apr.id, true)]);
  assert.equal(x1.status, 'approved');
  assert.equal(x2, undefined, 'the second click never left the UI');
  assert.equal(h.ledger().filter((e) => e.approvalId === apr.id && e.decision === 'HUMAN_APPROVED').length, 1);
  // Approve vs reject from two renderers on a fresh approval: exactly one applies.
  await attempt(h, 'god', { tool: 'Bash', input: { command: 'rm -rf /srv/other' } });
  const [apr2] = h.lapitaya.listApprovals().filter((x) => x.status === 'pending');
  const [u1, u2] = [await center(h), await center(h)];
  // Both UIs still show it pending (stale reads) and both humans click at once.
  const [y1, y2] = await Promise.all([u1.approvals.approve(apr2.id, true), u2.approvals.reject(apr2.id, true)]);
  assert.equal([y1, y2].filter((y) => y && (y.status === 'approved' || y.status === 'rejected')).length, 1, 'exactly one decision applied');
  assert.ok([y1, y2].includes(null), 'the other got "not pending" from the runtime');
  assert.equal(h.ledger().filter((e) => e.approvalId === apr2.id && (e.decision === 'HUMAN_APPROVED' || e.decision === 'HUMAN_REJECTED')).length, 1);
  const loser = y1 === null ? u1 : u2;
  const d = loser.model().high.find((x) => x.approvalId === apr2.id);
  assert.deepEqual([d.uiState, d.pending, d.canDecide], ['ALREADY_RESOLVED', false, false]);
});

test('[DC-25] runtime state overrides a stale UI', async (t) => {
  const f = await floor(t);
  const { apr } = await withPendingHigh(f);
  const dc = await center(f);
  const stale = project(f.lapitaya); // what the UI last read: pending
  f.lapitaya.decide(apr.id, false, 'human'); // decided elsewhere
  // The UI still believes it is pending and lets the human click…
  const res = await dc.approvals.approve(apr.id, true);
  assert.equal(res, null, 'the runtime refuses');
  let d = D.buildDecisionCenter(dc.requests.getSnapshot(), stale, dc.approvals.getSnapshot()).high.find((h) => h.approvalId === apr.id);
  assert.equal(d.uiState, 'ALREADY_RESOLVED', 'even on the stale read, the runtime answer wins');
  // …and after re-reading the runtime, the card shows the real outcome, with no controls.
  d = dc.model().high.find((h) => h.approvalId === apr.id);
  assert.deepEqual([d.uiState, d.resolution, d.pending, d.canDecide], ['ALREADY_RESOLVED', 'APPROVAL_REJECTED', false, false]);
  const card = section(render(dc, f).html, `data-approval-id="${apr.id}"`);
  assert.equal(button(card, 'approve-high'), null);
  assert.match(card, /Ya estaba resuelta; se muestra el estado del runtime/);
  assert.match(card, /El runtime ya no tenía esta aprobación pendiente/);
  assert.equal(f.lapitaya.listApprovals().find((x) => x.id === apr.id).status, 'rejected');
});

// ─── boundaries ────────────────────────────────────────────────────────────

test('[DC-17][DC-18][DC-19][DC-20] the Decision Center cannot alter risk/autonomy, execute, or write the ledger', async (t) => {
  const f = await floor(t);
  const { apr } = await withPendingHigh(f);
  const dc = await center(f);
  // A renderer that doctors the facts it shows changes nothing in the runtime.
  const view = project(f.lapitaya);
  const doctored = JSON.parse(JSON.stringify(view));
  doctored.pendingApprovals[0].risk = 'LOW';
  doctored.pendingApprovals[0].autonomy = 'AUTO';
  doctored.pendingApprovals.push({ ...doctored.pendingApprovals[0], approvalId: 'apr-fake-1', eventId: 'apr-fake-1' });
  const m = D.buildDecisionCenter(dc.requests.getSnapshot(), doctored, dc.approvals.getSnapshot());
  assert.equal(m.high.length, 2);
  assert.equal(await dc.approvals.approve('apr-fake-1', true), null, 'a fabricated approval does not exist in the runtime');
  const real = f.lapitaya.listApprovals().find((x) => x.id === apr.id);
  assert.deepEqual([real.risk, real.status], ['HIGH', 'pending'], 'risk and state are the runtime\'s');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED', 'autonomy still HUMAN_APPROVAL');
  // The only ledger line a decision adds is the runtime's own record of the human decision.
  const before = ledgerLines(f).length;
  await dc.approvals.approve(apr.id, true);
  const added = ledgerLines(f).slice(before).map((l) => JSON.parse(l));
  assert.deepEqual(added.map((e) => [e.kind, e.decision, e.rule, e.approvalId]), [['governance', 'HUMAN_APPROVED', 'human', apr.id]]);
  // Structurally: no classifier, no executor, no writer, and a minimal IPC surface.
  const used = new Set();
  for (const file of DC_FILES) {
    const src = code(read(file));
    assert.doesNotMatch(src, /classifyTool|toolRisk|RISK_ORDER|ACTION_RISK|requestScope|authorize|executeTool|ptyWrite|ptySpawn|hive[A-Z]\w*\(|dispatch\w*\(|appendFile|writeFile|\bfs\b|lapitayaLedger|cima-ledger|lapitayaApprovals|confirmRequest\(/, file);
    for (const x of src.matchAll(/window\.cth\.(\w+)/g)) used.add(x[1]);
    for (const imp of [...src.matchAll(/from\s+'([^']+)'/g)].map((x) => x[1])) {
      assert.match(imp, /^(react|\.\/[\w]+|@shared\/lapitaya\/alicia\/observability|@shared\/lapitaya\/governance)$/, `${file} imports ${imp}`);
    }
  }
  assert.deepEqual([...used].sort(), ['lapitayaDecide', 'lapitayaObservability', 'lapitayaRequests']);
  assert.deepEqual(Object.keys(D.createApprovalController({ decide: async () => null })).sort(), ['approve', 'getSnapshot', 'reject', 'subscribe']);
  const gov = read('src/shared/lapitaya/governance.ts');
  assert.match(code(read('src/renderer/src/components/alicia/useDecisionCenter.ts')), /import type \{ Approval \} from '@shared\/lapitaya\/governance'/, 'type only');
  assert.ok(gov.length > 0);
});

test('[DC-21][DC-22][DC-23][DC-24] no secrets, commands, paths or tokens in the DOM; evidence resolves; timelines are read only', async (t) => {
  const f = await floor(t);
  const p = request(f);
  await attempt(f, 'god', { tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer sk-live-SECRET123" https://x' } });
  const pending = request(f, 'Quiero que revisemos el README.');
  f.lapitaya.confirmRequest(p.id, { by: 'human', token: p.token });
  f.lapitaya.confirmRequest(pending.id, { by: 'human', token: pending.token });
  await attempt(f, 'god', HIGH_CALL);
  const third = request(f, 'Quiero que analicemos los logs.');
  const dc = await center(f);
  const { html } = render(dc, f, { ack: [third.id] });
  const fingerprints = f.ledger().filter((e) => e.fingerprint).map((e) => e.fingerprint);
  const tokens = f.lapitaya.listRequests().map((x) => x.token).filter(Boolean);
  assert.ok(tokens.length > 0 && fingerprints.length > 0);
  const summaries = f.lapitaya.listApprovals().map((x) => x.summary);
  assert.ok(summaries.length > 0);
  for (const bad of ['rm -rf', '/srv/data', 'curl', 'sk-live', 'SECRET', 'Bearer', f.home, f.hive.root(), 'fingerprint', ...summaries, ...tokens, ...fingerprints]) {
    assert.ok(!html.includes(bad), `DOM leaks ${bad}`);
  }
  // The decide IPC answers only the outcome — never the call's summary or fingerprint.
  const [apr] = f.lapitaya.listApprovals().filter((x) => x.status === 'pending');
  const out = decideIpc(f.lapitaya)(apr.id, false);
  assert.deepEqual(Object.keys(out).sort(), ['decidedAt', 'decidedBy', 'id', 'status']);
  // The Alicia UI no longer asks for the approvals' summaries at all.
  for (const file of ['src/renderer/src/components/alicia/AliciaPanel.tsx', ...DC_FILES]) assert.doesNotMatch(code(read(file)), /lapitayaApprovals/, file);
  // Evidence: every reference in the Decision Center resolves to a real record.
  // Evidence refs as rendered in evidence fields and timelines (whole ids, not DOM ids that embed them).
  const refs = [...new Set(html.match(/EVT-[0-9a-f]{8}(\.\d+)?|\btrc-[a-z0-9]+-[a-z0-9]+\b(?!-)|(?<=· |>)apr-[a-z0-9]+-[a-z0-9]+(?=<| )/g) ?? [])];
  assert.ok(refs.length > 0);
  const lines = ledgerLines(f).map((l) => JSON.parse(l));
  const approvals = f.lapitaya.listApprovals().map((x) => x.id);
  for (const r of refs) {
    const ok = r.startsWith('EVT-') ? lines.some((l) => O.evidenceRef(l) === r.replace(/\.\d+$/, ''))
      : r.startsWith('trc-') ? f.lapitaya.recentTraces().some((x) => x.id === r) : approvals.includes(r);
    assert.ok(ok, `${r} resolves`);
  }
  // DC-24: every timeline (REQUEST and HIGH) is a native <details> list with no controls, from frozen data.
  const timelines = html.match(/<details data-field="timeline"[\s\S]*?<\/details>/g) ?? [];
  assert.ok(timelines.length >= 2);
  for (const tl of timelines) assert.doesNotMatch(tl, /<button|<input|<select|<textarea|contenteditable|data-action/i);
  const m = dc.model();
  assert.ok(m.high.every((d) => Object.isFrozen(d.timeline) && d.timeline.every(Object.isFrozen)));
  assert.ok(Object.isFrozen(m.history));
});

// ─── i18n and accessibility ────────────────────────────────────────────────

test('[DC-26][DC-27] es-MX and en-US: identical decisions trees, every state rendered, no fallback, ASCII agent names', async (t) => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const es = keys(LOCALES['es-MX'].alicia.decisions).sort();
  const en = keys(LOCALES['en-US'].alicia.decisions).sort();
  assert.deepEqual(es, en);
  for (const s of D.HIGH_UI_STATES) assert.ok(es.includes(`highState.${s}`), s);
  for (const k of ['errors.ALREADY_RESOLVED', 'errors.IPC_ERROR', 'said.approved', 'said.rejected', 'said.alreadyResolved', 'said.failed']) assert.ok(es.includes(k), k);
  assert.doesNotMatch(JSON.stringify(LOCALES['en-US']), /[À-ÿ]/, 'en-US stays ASCII (El Inge, Jose Juan, El Tutu…)');
  const f = await floor(t);
  const { apr } = await withPendingHigh(f);
  request(f, 'Quiero que revisemos el README.');
  const dc = await center(f);
  const base = dc.model();
  for (const lng of ['es-MX', 'en-US']) {
    const { t: tt, missing } = strictT(lng);
    let html = render(dc, f, { lng }).html;
    for (const state of D.HIGH_UI_STATES) {
      const d = { ...base.high[0], uiState: state, pending: state === 'HUMAN_APPROVAL_REQUIRED', outcome: state === 'ERROR' ? { op: 'approve', ok: false, code: 'IPC_ERROR' } : state === 'ALREADY_RESOLVED' ? { op: 'approve', ok: false, code: 'ALREADY_RESOLVED' } : null };
      html += renderToStaticMarkup(React.createElement(loadTs('src/renderer/src/components/alicia/DecisionCenterView.tsx').HighApprovalCard, {
        t: tt, d, acknowledged: false, onAcknowledge: () => {}, onApprove: () => {}, onReject: () => {} }));
    }
    assert.deepEqual(missing, [], lng);
    assert.doesNotMatch(html, /alicia\.decisions\.|lapitaya:/, `${lng}: unresolved key`);
    for (const tech of ['REQUEST', 'HIGH', 'HUMAN_APPROVAL_REQUIRED', apr.id]) assert.ok(html.includes(tech), `${lng} keeps ${tech}`);
  }
  const view = code(read('src/renderer/src/components/alicia/DecisionCenterView.tsx'));
  const literals = [...view.matchAll(/>([^<>{}=;]*[A-Za-zÁ-ú]{2,}[^<>{}=;]*)</g)].map((x) => x[1].trim()).filter(Boolean);
  assert.deepEqual(literals, ['approvalId'], 'only the technical id is literal');
});

test('[DC-28] accessibility: named sections, labelled groups, deliberate Approve, no shortcuts, keyboard order', async (t) => {
  const f = await floor(t);
  const { apr } = await withPendingHigh(f);
  const dc = await center(f);
  const without = section(render(dc, f).html, `data-approval-id="${apr.id}"`);
  const withAck = section(render(dc, f, { highAck: [apr.id] }).html, `data-approval-id="${apr.id}"`);
  assert.match(button(without, 'approve-high'), /disabled=""/, 'Approve needs the acknowledgement');
  assert.doesNotMatch(button(without, 'reject-high'), /disabled=""/, 'Reject is always available while pending');
  assert.doesNotMatch(button(withAck, 'approve-high'), /disabled=""/);
  assert.deepEqual([...withAck.matchAll(/data-action="([\w-]+)"/g)].map((x) => x[1]), ['acknowledge-high', 'reject-high', 'approve-high']);
  assert.match(withAck, new RegExp(`<section id="alicia-high-${apr.id}" aria-labelledby="alicia-high-${apr.id}-h"`));
  assert.match(withAck, /role="group" aria-label="Decisión sobre la acción HIGH"/);
  for (const b of ['approve-high', 'reject-high']) {
    assert.match(button(withAck, b), /type="button"/);
    const ref = button(withAck, b).match(/aria-describedby="([^"]+)"/)[1];
    assert.match(withAck, new RegExp(`id="${ref}"`));
  }
  assert.match(withAck, /<label[^>]*><input type="checkbox" data-action="acknowledge-high"[^>]*\/><span>Revisé la operación/);
  assert.match(withAck, /role="status" aria-live="polite" data-field="outcome"/);
  const { html } = render(dc, f);
  assert.match(html, /<section data-decision-center="true" aria-labelledby="alicia-decision-center"[^>]*><h2 id="alicia-decision-center"/);
  assert.match(html, /<p role="status" data-field="decision-counts"/);
  assert.match(html, /:focus-visible\{outline:2px solid/);
  for (const file of DC_FILES) assert.doesNotMatch(code(read(file)), /onKeyDown|onKeyUp|onKeyPress|autoFocus|accessKey|<div[^>]*onClick/, file);
});

// ─── §26 negatives ─────────────────────────────────────────────────────────

test('[DC-NEG] Alicia cannot approve or confirm; renderer cannot fabricate; identity, replay, tamper and staleness are refused', async (t) => {
  const f = await floor(t);
  const { p, apr } = await withPendingHigh(f);
  const q = request(f, 'Quiero que revisemos el README.');
  // Alicia approves HIGH / confirms REQUEST through her only channel (words → intent boundary).
  for (const words of [`Aprueba la acción ${apr.id}.`, `Confirma la propuesta ${q.id}.`, 'Aprueba todo lo pendiente.']) {
    const r = f.companion.submit(words);
    assert.notEqual(r.outcome.decision, 'HUMAN_APPROVED');
  }
  assert.equal(f.lapitaya.listApprovals().find((x) => x.id === apr.id).status, 'pending');
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === q.id).status, 'PROPOSED');
  // Alicia/runtime-side identities cannot confirm.
  for (const by of ['alicia', 'god', 'el-beni-1', '']) assert.equal(f.lapitaya.confirmRequest(q.id, { by, token: q.token }).code, 'NOT_AUTHORIZED', by || '(empty)');
  // The companion has no decide/confirm port at all.
  for (const k of ['decide', 'approve', 'confirmRequest', 'cancelRequest']) assert.ok(!(k in f.companion), k);
  // Renderer fabricates approval / risk / proposal state: the runtime is untouched.
  const dc = await center(f);
  const fake = JSON.parse(JSON.stringify(project(f.lapitaya)));
  fake.history.unshift({ ...fake.pendingApprovals[0], category: 'APPROVAL_GRANTED', eventId: 'EVT-00000000' });
  D.buildDecisionCenter(dc.requests.getSnapshot(), fake, dc.approvals.getSnapshot());
  assert.equal(f.lapitaya.listApprovals().find((x) => x.id === apr.id).status, 'pending');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).denied, true, 'a fabricated approval executes nothing');
  // No API to change a proposal, call a tool, write the ledger or reach authorize()/PreToolUse.
  assert.deepEqual(Object.keys(dc.requests).sort(), ['cancel', 'confirm', 'getSnapshot', 'refresh', 'subscribe']);
  // Wrong proposal token, replayed token, already-resolved decision, stale proposal.
  assert.equal(f.lapitaya.confirmRequest(q.id, { by: 'human', token: 'deadbeef'.repeat(4) }).code, 'TAMPERED');
  assert.equal(f.lapitaya.confirmRequest(p.id, { by: 'human', token: p.token }).code, 'NOT_CONFIRMABLE', 'replayed');
  decideIpc(f.lapitaya)(apr.id, false);
  assert.equal(decideIpc(f.lapitaya)(apr.id, true), null, 'already resolved');
  const s = f.lapitaya.openRequest({ intentId: 'int-s', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'borra la base de datos', taskId: null, target: null, signals: [] });
  assert.equal(f.lapitaya.confirmRequest(s.id, { by: 'human', token: s.token }).code, 'STALE_PROPOSAL');
});

test('[DC-INV] invariants: classic Governance panel stands down (no duplicate controls); removing the UI removes no guarantee', async (t) => {
  const gp = code(read('src/renderer/src/components/GovernancePanel.tsx'));
  assert.match(gp, /const decisionCenter = useDecisionCenterPresent\(\);\s*if \(decisionCenter\) return null;/);
  assert.match(gp, /if \(!isDecisionCenterPresent\(\)\) refresh\(\);/);
  const pres = loadTs('src/renderer/src/components/alicia/decisionCenterPresence.ts');
  assert.equal(pres.isDecisionCenterPresent(), false);
  const off = pres.markDecisionCenterMounted();
  assert.equal(pres.isDecisionCenterPresent(), true);
  off();
  assert.equal(pres.isDecisionCenterPresent(), false);
  // No UI at all: the runtime alone still requires confirmation and HIGH approval.
  const f = await floor(t);
  f.companion.submit('Quiero que revisemos este proyecto.');
  const r = await attempt(f, 'god', TEST_CALL);
  assert.equal(r.denied, true);
  assert.match(r.reason, /^REQUEST_CONFIRMATION_REQUIRED/);
  // The mount the v0.5 contract pins is unchanged.
  assert.match(read('src/renderer/src/components/CommandCenterPanel.tsx'), /\{tab === 'human' && <><AliciaPanel \/><GovernancePanel \/><AskMeTab \/><\/>\}/);
});

// ─── code-review follow-ups ────────────────────────────────────────────────

test('[DC-REV] after an accepted decision the stale card offers no second decision; the classic panel is the fallback without a projection', async (t) => {
  const f = await floor(t);
  const { apr } = await withPendingHigh(f);
  const dc = await center(f);
  const stale = project(f.lapitaya); // still lists the approval as pending
  await dc.approve(apr.id);
  const d = D.buildDecisionCenter(dc.requests.getSnapshot(), stale, dc.approvals.getSnapshot()).high.find((h) => h.approvalId === apr.id);
  assert.equal(d.uiState, 'APPROVING', 'in progress until the projection confirms');
  assert.equal(d.canDecide, false, 'no live Reject on a decision the runtime already applied');
  assert.equal(dc.model().high.find((h) => h.approvalId === apr.id).uiState, 'APPROVED');
  // No projection → the Decision Center must not claim to own HIGH approvals.
  const hook = code(read('src/renderer/src/components/alicia/useDecisionCenter.ts'));
  assert.match(hook, /const observed = !!view;/);
  assert.match(hook, /observed \? markDecisionCenterMounted\(\) : undefined/);
  assert.match(hook, /lapitayaObservability\(\)\.catch\(\(\) => null\)/);
});
