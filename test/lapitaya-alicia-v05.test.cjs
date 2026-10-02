'use strict';
/**
 * La Pitaya Alicia v0.5 — Human Confirmation UI.
 *
 *   REQUEST → PROPOSED → ALICIA UI → HUMAN ─┬─ CANCEL  → CANCELLED
 *                                           └─ CONFIRM → runtime → revalidate → CIMA → authorize → PreToolUse
 *
 * Two layers are exercised:
 *   - the UI's state (confirmationController.ts) driving the REAL runtime
 *     (test/fixtures/lapitaya-floor.cjs) through a port that makes exactly the
 *     calls the human-channel IPC handlers in src/main/index.ts make;
 *   - the renderer view (AliciaPanelView.tsx) rendered with react-dom/server
 *     and the real es-MX / en-US resources.
 * The UI is never the enforcement: the E2E tests show the runtime refusing
 * with or without it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { TRUSTED_HUMAN: HUMAN } = require('./fixtures/human.cjs');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const i18next = require('i18next');
const { floor, loadTs } = require('./fixtures/lapitaya-floor.cjs');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const C = loadTs('src/renderer/src/components/alicia/confirmationController.ts');
const V = loadTs('src/renderer/src/components/alicia/AliciaPanelView.tsx');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const UI_DIR = 'src/renderer/src/components/alicia';
const UI_FILES = ['confirmationController.ts', 'AliciaPanelView.tsx', 'AliciaPanel.tsx'].map((f) => `${UI_DIR}/${f}`);

const TEST_CALL = { tool: 'Bash', input: { command: 'npm test' } };          // LOW
const HIGH_CALL = { tool: 'Bash', input: { command: 'rm -rf /srv/data' } };  // HIGH
const editCall = (f) => ({ tool: 'Edit', input: { file_path: path.join(f.home, 'src', 'app.ts'), old_string: 'a', new_string: 'b' } }); // MEDIUM

// ─── helpers ───────────────────────────────────────────────────────────────

/** The port the renderer gets: each method is the exact call its IPC handler
 *  makes in src/main/index.ts (verified structurally in UI-04). `calls` spies. */
function ipcPort(runtime) {
  const calls = [];
  const port = {
    requests: async () => { calls.push(['requests']); return runtime.listRequests(); },
    approvals: async () => { calls.push(['approvals']); return runtime.listApprovals(); },
    confirm: async (id, token) => { calls.push(['confirm', id, token]); return runtime.confirmRequest(id, { by: 'human', token, human: HUMAN }); },
    cancel: async (id) => { calls.push(['cancel', id]); return runtime.cancelRequest(id, 'human', HUMAN); }
  };
  return { port, calls, decisions: () => calls.filter(([k]) => k === 'confirm' || k === 'cancel') };
}

/** The human types to Alicia (alicia:submit → companion.submit), and the UI loads. */
async function requestThroughUi(f, message = 'Quiero que revisemos este proyecto.', opts = {}) {
  const r = f.companion.submit(message, opts);
  assert.equal(r.outcome.type, 'REQUEST');
  const spy = ipcPort(f.lapitaya);
  const ui = C.createConfirmationController(spy.port);
  await ui.refresh();
  const view = ui.getSnapshot().views.find((v) => v.id === r.outcome.proposalId);
  assert.ok(view, 'the pending proposal is in the UI');
  return { ui, spy, view, id: r.outcome.proposalId, submit: r };
}

async function attempt(f, agentId, call) {
  const r = await f.pre(agentId, call.tool, call.input);
  return {
    denied: r?.hookSpecificOutput?.permissionDecision === 'deny',
    reason: r?.hookSpecificOutput?.permissionDecisionReason ?? '',
    decision: f.server.lastPreDecision
  };
}
const transitions = (f, id) => f.ledger().filter((e) => e.kind === 'request' && e.proposalId === id).map((e) => e.transition);

const LOCALES = {
  'es-MX': JSON.parse(read('src/renderer/src/i18n/locales/lapitaya/es-MX.json')),
  'en-US': JSON.parse(read('src/renderer/src/i18n/locales/lapitaya/en-US.json'))
};

/** A strict i18next `t` over the real resources: no fallback language, and
 *  every missing key is recorded (a fallback would hide a missing key). */
function strictT(lng) {
  const missing = [];
  const inst = i18next.createInstance();
  inst.init({
    lng, fallbackLng: false, initAsync: false, ns: ['lapitaya'], defaultNS: 'lapitaya',
    resources: { [lng]: { lapitaya: LOCALES[lng] } },
    interpolation: { escapeValue: false },
    saveMissing: true,
    missingKeyHandler: (_l, _ns, key) => missing.push(key)
  });
  const t = (key, opts) => inst.t(key, opts);
  return { t, missing };
}

function render(snapshot, { lng = 'es-MX', acknowledged = [], lines = [], presence = 'WAITING_APPROVAL' } = {}) {
  const { t, missing } = strictT(lng);
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(V.AliciaPanelView, {
    t, snapshot, presence, acknowledged: new Set(acknowledged), lines, draft: '', sending: false,
    onAcknowledge: noop, onConfirm: noop, onCancel: noop, onGoToProposal: noop, onDraft: noop, onSend: noop
  }));
  return { html, missing };
}
const card = (html, id) => {
  const start = html.indexOf(`data-proposal-id="${id}"`);
  assert.ok(start >= 0, `card ${id} rendered`);
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
};
const button = (html, action) => (html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`)) ?? [null])[0];

// ─── UI-01..18 ─────────────────────────────────────────────────────────────

test('[UI-01] a pending REQUEST appears visually', async (t) => {
  const f = await floor(t);
  const { ui, id } = await requestThroughUi(f);
  const snap = ui.getSnapshot();
  assert.equal(snap.pendingCount, 1);
  const { html, missing } = render(snap);
  assert.deepEqual(missing, []);
  assert.match(html, /data-field="pending-banner"/);
  assert.match(html, /data-action="go-to-proposal"/);
  const c = card(html, id);
  assert.match(c, /data-ui-state="PENDING"/);
  assert.match(c, /data-proposal-status="PROPOSED"/);
  assert.match(c, /Propuesta pendiente de tu confirmación/);
  // The runtime's notification points at the same proposal (the UI's "go to").
  const n = f.companion.snapshot().notifications.find((x) => x.action?.kind === 'open-requests');
  assert.equal(n?.action.ref, id);
});

test('[UI-02] the proposal shows the data the runtime returned — no second source of truth', async (t) => {
  const f = await floor(t);
  f.hive.addTask({ id: 't-ui', title: 'x', status: 'doing', assignee: 'el-beni-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });
  const { view, id } = await requestThroughUi(f, 'Quiero que El Beni implemente la validación del formulario.', { taskId: 't-ui' });
  const p = f.lapitaya.listRequests().find((x) => x.id === id);
  for (const k of ['id', 'intentId', 'message', 'scope', 'status', 'createdAt', 'taskId', 'executor']) {
    assert.deepEqual(view[k], p[k], k);
  }
  assert.deepEqual(view.target, p.target);
  const c = card(render({ loaded: true, loadError: false, busy: false, pendingCount: 1, views: [view] }).html, id);
  assert.match(c, new RegExp(`data-field="proposalId"[^>]*><code[^>]*>${id}<`));
  assert.ok(c.includes('Quiero que El Beni implemente la validación del formulario.'), 'the human words, verbatim');
  assert.match(c, /data-field="task"[^>]*><code[^>]*>t-ui</);
  assert.match(c, /data-field="executor"[^>]*><code[^>]*>god</);
  // The controller has no local state to edit: only confirm, cancel, refresh, read.
  assert.deepEqual(Object.keys(C.createConfirmationController(ipcPort(f.lapitaya).port)).sort(),
    ['cancel', 'confirm', 'getSnapshot', 'refresh', 'subscribe']);
});

test('[UI-03] the risk shown is the runtime scope; the UI never computes it', async (t) => {
  const f = await floor(t);
  const low = await requestThroughUi(f, 'Quiero que revisemos este proyecto.');
  const med = await requestThroughUi(f, 'Quiero que El Beni implemente el login.');
  const rt = (id) => f.lapitaya.listRequests().find((p) => p.id === id).scope;
  assert.equal(low.view.scope, rt(low.id));
  assert.equal(med.view.scope, rt(med.id));
  assert.deepEqual([rt(low.id), rt(med.id)], ['LOW', 'MEDIUM']);
  const { html } = render(med.ui.getSnapshot());
  assert.match(card(html, low.id), /data-scope="LOW"[\s\S]*<b>LOW<\/b> · Riesgo bajo/);
  assert.match(card(html, med.id), /data-scope="MEDIUM"[\s\S]*<b>MEDIUM<\/b> · Riesgo medio/);
  // The runtime always wins: whatever scope the runtime reports is what is shown.
  const doctored = { ...f.lapitaya.listRequests().find((p) => p.id === low.id), scope: 'MEDIUM' };
  const ui = C.createConfirmationController({ requests: async () => [doctored], approvals: async () => [], confirm: async () => null, cancel: async () => null });
  await ui.refresh();
  assert.equal(ui.getSnapshot().views[0].scope, 'MEDIUM', 'the UI mirrors, never re-derives');
  // No classifier in the UI.
  for (const file of UI_FILES) {
    assert.doesNotMatch(code(read(file)), /requestScope|classifyIntentMessage|toolRisk|classifyTool|RISK_ORDER|ACTION_RISK/, file);
  }
});

test('[UI-04] Confirm calls only the authorized IPC: preload → lapitaya:confirmRequest → runtime (by human)', async (t) => {
  const f = await floor(t);
  const { ui, spy, id } = await requestThroughUi(f);
  const token = f.lapitaya.listRequests().find((p) => p.id === id).token;
  const before = spy.calls.length;
  await ui.confirm(id);
  const made = spy.calls.slice(before);
  assert.deepEqual(made.filter(([k]) => k !== 'requests' && k !== 'approvals'), [['confirm', id, token]]);
  // The real wiring the port stands for.
  const panel = code(read(`${UI_DIR}/AliciaPanel.tsx`));
  assert.match(panel, /confirm: \(id, token\) => window\.cth\.lapitayaConfirmRequest\(id, token\)/);
  assert.match(panel, /cancel: \(id\) => window\.cth\.lapitayaCancelRequest\(id\)/);
  const preload = code(read('src/preload/index.ts'));
  assert.match(preload, /lapitayaConfirmRequest: \(id: string, token: string\)[^=]*=>\s*ipcRenderer\.invoke\('lapitaya:confirmRequest', id, token\)/);
  assert.match(preload, /lapitayaCancelRequest: \(id: string\)[^=]*=> ipcRenderer\.invoke\('lapitaya:cancelRequest', id\)/);
  const main = code(read('src/main/index.ts'));
  // v0.8: the handlers delegate to the human governance module, which resolves WHO from the trusted sender.
  assert.match(main, /ipcMain\.handle\('lapitaya:confirmRequest', \(evt, id: unknown, token: unknown\) => humanGov\.confirmRequest\(evt, id, token\)\)/);
  assert.match(main, /ipcMain\.handle\('lapitaya:cancelRequest', \(evt, id: unknown\) => humanGov\.cancelRequest\(evt, id\)\)/);
  const gov = code(read('src/main/humanGovernanceIpc.ts'));
  assert.match(gov, /runtime\.confirmRequest\(id, ctx \? \{ by: 'human', token, human: ctx \} : \{ by: 'untrusted-sender', token \}\)/);
  assert.match(gov, /ctx \? runtime\.cancelRequest\(id, 'human', ctx\) : UNTRUSTED/);
  // No other confirmation path was added (v0.4.2's single handler still stands).
  assert.equal((main.match(/confirmRequest\(/g) ?? []).length, 1);
});

test('[UI-05] a successful confirmation updates the state from the runtime', async (t) => {
  const f = await floor(t);
  const { ui, id } = await requestThroughUi(f);
  const res = await ui.confirm(id);
  assert.equal(res.ok, true);
  const v = ui.getSnapshot().views.find((x) => x.id === id);
  assert.deepEqual([v.status, v.uiState, v.canConfirm, v.canCancel], ['CONFIRMED', 'CONFIRMED', false, true]);
  assert.equal(f.lapitaya.listRequests().find((p) => p.id === id).status, 'CONFIRMED');
  assert.equal(ui.getSnapshot().pendingCount, 0);
  assert.equal(C.aliciaLineKey(v), 'confirmed');
  const { html, missing } = render(ui.getSnapshot());
  assert.deepEqual(missing, []);
  const c = card(html, id);
  assert.match(c, /REQUEST confirmado — continúa por la gobernanza de CIMA/);
  assert.equal(button(c, 'confirm'), null, 'nothing left to confirm');
  assert.doesNotMatch(html, /data-field="pending-banner"/);
  assert.deepEqual(transitions(f, id), ['PROPOSED', 'REVALIDATED', 'CONFIRMED']);
});

test('[UI-06] a successful cancellation updates the state; the runtime processes it', async (t) => {
  const f = await floor(t);
  const { ui, id } = await requestThroughUi(f);
  const res = await ui.cancel(id);
  assert.equal(res.ok, true);
  const v = ui.getSnapshot().views.find((x) => x.id === id);
  assert.deepEqual([v.status, v.uiState, v.canConfirm, v.canCancel], ['CANCELLED', 'CANCELLED', false, false]);
  const p = f.lapitaya.listRequests().find((x) => x.id === id);
  assert.deepEqual([p.status, p.closedBy, p.token], ['CANCELLED', 'human', null]);
  assert.equal(C.aliciaLineKey(v), 'cancelled');
  assert.deepEqual(transitions(f, id), ['PROPOSED', 'CANCELLED']);
  const c = card(render(ui.getSnapshot()).html, id);
  assert.match(c, /REQUEST cancelado/);
  assert.equal(button(c, 'confirm'), null);
  assert.equal(button(c, 'cancel'), null);
  // A cancelled proposal cannot be confirmed afterwards, by the UI or the runtime.
  assert.equal(await ui.confirm(id), null);
  assert.equal(f.lapitaya.confirmRequest(id, { by: 'human', token: 'x', human: HUMAN }).code, 'NOT_CONFIRMABLE');
});

test('[UI-07] double-click / double-submit sends ONE confirmation; buttons disabled while in flight', async (t) => {
  const f = await floor(t);
  const { spy, id } = await requestThroughUi(f);
  // A port that holds the answer so the in-flight state can be observed.
  let release;
  const gate = new Promise((r) => { release = r; });
  const port = { ...spy.port, confirm: async (...a) => { await gate; return spy.port.confirm(...a); } };
  const ui = C.createConfirmationController(port);
  await ui.refresh();
  const first = ui.confirm(id);
  const second = ui.confirm(id);
  const third = ui.cancel(id);
  const inFlight = ui.getSnapshot().views.find((v) => v.id === id);
  assert.deepEqual([inFlight.uiState, inFlight.canConfirm, inFlight.canCancel, inFlight.busy], ['CONFIRMING', false, false, true]);
  const c = card(render(ui.getSnapshot(), { acknowledged: [id] }).html, id);
  assert.match(button(c, 'confirm'), /disabled=""/);
  assert.match(button(c, 'cancel'), /disabled=""/);
  assert.match(button(c, 'confirm'), /aria-busy="true"/);
  release();
  const [a, b, d] = await Promise.all([first, second, third]);
  assert.equal(a.ok, true);
  assert.deepEqual([b, d], [null, null], 'the duplicates never left the UI');
  assert.equal(spy.decisions().length, 1);
  assert.deepEqual(transitions(f, id), ['PROPOSED', 'REVALIDATED', 'CONFIRMED'], 'one confirmation, no denied replays');
  // And a click after it landed is not sent either (not PROPOSED any more).
  assert.equal(await ui.confirm(id), null);
  assert.equal(spy.decisions().length, 1);
});

test('[UI-08] stale / changed-elsewhere / replaced proposals show the runtime state; nothing is retried', async (t) => {
  const f = await floor(t);
  // Stale: the words no longer read as a REQUEST at confirmation time.
  const s = f.lapitaya.openRequest({ intentId: 'int-stale', executor: 'god', requestedBy: 'human', source: 'alicia',
    message: 'borra la base de datos', taskId: null, target: null, signals: [] });
  const spy = ipcPort(f.lapitaya);
  const ui = C.createConfirmationController(spy.port);
  await ui.refresh();
  const res = await ui.confirm(s.id);
  assert.deepEqual([res.ok, res.code], [false, 'STALE_PROPOSAL']);
  let v = ui.getSnapshot().views.find((x) => x.id === s.id);
  assert.deepEqual([v.status, v.uiState, v.canConfirm], ['BLOCKED', 'STALE', false]);
  assert.equal(C.aliciaLineKey(v), 'stale');
  assert.equal(spy.decisions().length, 1, 'not retried');
  const c = card(render(ui.getSnapshot()).html, s.id);
  assert.match(c, /La propuesta ya no es válida \(stale\)/);
  assert.match(c, /role="alert"[^>]*>[\s\S]*STALE_PROPOSAL/);
  // Confirmed elsewhere while this UI still showed it pending.
  const other = f.companion.submit('Quiero que revisemos el módulo de pagos.').outcome.proposalId;
  const stale = C.createConfirmationController(spy.port);
  await stale.refresh();
  f.lapitaya.confirmRequest(other, { by: 'human', token: f.lapitaya.listRequests().find((p) => p.id === other).token, human: HUMAN });
  const r2 = await stale.confirm(other);
  assert.deepEqual([r2.ok, r2.code], [false, 'NOT_CONFIRMABLE']);
  v = stale.getSnapshot().views.find((x) => x.id === other);
  assert.deepEqual([v.status, v.uiState], ['CONFIRMED', 'CONFIRMED'], 'the runtime state wins');
  assert.equal(C.aliciaLineKey(v), 'changedElsewhere');
  // Cancelled elsewhere: the UI shows CANCELLED on its next refresh.
  const third = f.companion.submit('Quiero que analicemos el reporte.').outcome.proposalId;
  await stale.refresh();
  f.lapitaya.cancelRequest(third, 'human', HUMAN);
  await stale.refresh();
  assert.equal(stale.getSnapshot().views.find((x) => x.id === third).uiState, 'CANCELLED');
  // Replaced: a newer REQUEST for the same task supersedes the older one.
  f.hive.addTask({ id: 't-rep', title: 'x', status: 'doing', assignee: 'god', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });
  const old = f.companion.submit('Quiero que revisemos la tarea.', { taskId: 't-rep' }).outcome.proposalId;
  const newer = f.companion.submit('Quiero que revisemos la tarea otra vez.', { taskId: 't-rep' }).outcome.proposalId;
  await stale.refresh();
  const vo = stale.getSnapshot().views.find((x) => x.id === old);
  assert.deepEqual([vo.status, vo.uiState, vo.canConfirm], ['SUPERSEDED', 'SUPERSEDED', false]);
  assert.equal(stale.getSnapshot().views.find((x) => x.id === newer).uiState, 'PENDING');
});

test('[UI-09] a tampered proposal / forged token is refused by the runtime and shown as an error', async (t) => {
  const f = await floor(t);
  const { id } = await requestThroughUi(f);
  // (a) the proposal was edited on disk behind the runtime's back.
  const file = path.join(f.hive.root(), 'lapitaya', 'proposals.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  list.find((x) => x.id === id).scope = 'MEDIUM';
  fs.writeFileSync(file, JSON.stringify(list));
  const fresh = new CimaRuntimeService({ hiveRoot: () => f.hive.root(), godId: () => 'god' });
  const spy = ipcPort(fresh);
  const ui = C.createConfirmationController(spy.port);
  await ui.refresh();
  const r = await ui.confirm(id);
  assert.deepEqual([r.ok, r.code], [false, 'TAMPERED']);
  const v = ui.getSnapshot().views.find((x) => x.id === id);
  assert.deepEqual([v.status, v.uiState, v.outcome.code], ['PROPOSED', 'ERROR', 'TAMPERED']);
  assert.equal(C.aliciaLineKey(v), 'refused');
  const { html, missing } = render(ui.getSnapshot());
  assert.deepEqual(missing, []);
  const c = card(html, id);
  assert.match(c, /El runtime rechazó la confirmación/);
  assert.match(c, /role="alert"[^>]*>[\s\S]*La confirmación no coincide con la propuesta[\s\S]*TAMPERED[\s\S]*No se reintenta nada automáticamente/);
  assert.equal(spy.decisions().length, 1, 'not retried');
  // (b) a renderer that forges the token gets the same refusal.
  const g = await floor(t);
  const q = await requestThroughUi(g);
  const forged = C.createConfirmationController({
    ...ipcPort(g.lapitaya).port,
    requests: async () => g.lapitaya.listRequests().map((p) => ({ ...p, token: 'f'.repeat(32) }))
  });
  await forged.refresh();
  assert.equal((await forged.confirm(q.id)).code, 'TAMPERED');
  assert.equal(g.lapitaya.listRequests().find((p) => p.id === q.id).status, 'PROPOSED');
  // (c) the IPC itself failing is an error, not a silent success.
  const broken = C.createConfirmationController({ ...ipcPort(g.lapitaya).port, confirm: async () => { throw new Error('ipc down'); } });
  await broken.refresh();
  const b = await broken.confirm(q.id);
  assert.deepEqual([b.ok, b.code], [false, 'IPC_ERROR']);
  assert.equal(broken.getSnapshot().views.find((x) => x.id === q.id).uiState, 'ERROR');
  assert.match(card(render(broken.getSnapshot(), { lng: 'en-US' }).html, q.id), /The runtime did not answer, so nothing changed\./);
});

test('[UI-10] HIGH: confirming the REQUEST is not an approval — CIMA still requires HUMAN_APPROVAL', async (t) => {
  const f = await floor(t);
  const { ui, id } = await requestThroughUi(f, 'Quiero que El Beni implemente la validación del formulario.');
  // Before: the card says it plainly.
  let c = card(render(ui.getSnapshot()).html, id);
  assert.match(c, /data-field="high-note"[^>]*>Confirmar el REQUEST no equivale a aprobar una acción de alto riesgo/);
  await ui.confirm(id);
  const high = await attempt(f, 'god', HIGH_CALL);
  assert.equal(high.denied, true);
  assert.equal(high.decision, 'HUMAN_APPROVAL_REQUIRED');
  assert.match(high.reason, /^HUMAN_APPROVAL_REQUIRED/);
  await ui.refresh();
  const v = ui.getSnapshot().views.find((x) => x.id === id);
  assert.equal(v.pendingHighApprovals, 1);
  const { html, missing } = render(ui.getSnapshot());
  assert.deepEqual(missing, []);
  c = card(html, id);
  assert.match(c, /REQUEST confirmado — esto no es una aprobación/);
  assert.match(c, /role="alert" data-field="high-approval"[^>]*>CIMA requiere tu aprobación para acciones HIGH \(HUMAN_APPROVAL_REQUIRED\): 1 pendientes/);
  assert.doesNotMatch(html, /[Aa]cción aprobada|[Aa]ction approved|data-action="approve"/);
  // The UI touched no approval: it is still pending, for the Governance panel.
  const [apr] = f.lapitaya.listApprovals();
  assert.equal(apr.status, 'pending');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).denied, true, 'still blocked until its own approval');
  const en = card(render(ui.getSnapshot(), { lng: 'en-US' }).html, id);
  assert.match(en, /REQUEST confirmed — this is not an approval/);
});

test('[UI-11] Alicia (and her UI) get no execution API', async (t) => {
  const f = await floor(t);
  // The UI's whole reach: four human-channel reads/decisions.
  assert.deepEqual(Object.keys(ipcPort(f.lapitaya).port).sort(), ['approvals', 'cancel', 'confirm', 'requests']);
  const iface = read(`${UI_DIR}/confirmationController.ts`);
  const portDecl = iface.slice(iface.indexOf('export interface ConfirmationPort'), iface.indexOf('}', iface.indexOf('export interface ConfirmationPort')));
  assert.deepEqual([...portDecl.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]).sort(), ['approvals', 'cancel', 'confirm', 'requests']);
  // Alicia's companion still has no execution/decision capability.
  const keys = Object.keys(f.companion);
  for (const k of ['execute', 'run', 'decide', 'approve', 'confirmRequest', 'authorize', 'send']) assert.ok(!keys.includes(k), k);
  for (const file of UI_FILES) {
    assert.doesNotMatch(code(read(file)), /executeTool|runAgent|authorize\(|confirmApproval|lapitayaDecide|ptyWrite|ptySpawn|spawnAgent|evaluateProposedCall|recordDecision/, file);
  }
});

test('[UI-12] the renderer has no direct access to the runtime, filesystem, ledger or providers', () => {
  for (const file of UI_FILES) {
    const src = code(read(file));
    const imports = [...src.matchAll(/^import\s+(type\s+)?[^'"]*from\s+'([^']+)'/gm)].map((m) => ({ type: !!m[1], from: m[2] }));
    for (const imp of imports) {
      assert.doesNotMatch(imp.from, /(^|\/)main\/|^node:|^fs$|^path$|^child_process$|^electron$|cimaRuntime|hive|providerGovernance/, `${file} imports ${imp.from}`);
      if (imp.from.startsWith('@shared/')) assert.ok(imp.type, `${file}: @shared import is type-only (${imp.from})`);
    }
    assert.doesNotMatch(src, /ipcRenderer|require\(|process\.|lapitayaLedger|cima-ledger/, file);
  }
  // The preload only exposes invoke wrappers; the runtime is a type import there.
  const preload = code(read('src/preload/index.ts'));
  assert.match(preload, /import type \{ LedgerEntry, RequestConfirmation \} from '\.\.\/main\/cimaRuntime'/);
  assert.doesNotMatch(preload, /import \{[^}]*CimaRuntimeService/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*lapitaya\b/);
});

test('[UI-13] no UI → El Inge / hive path; UI-14: no UI → tool path', () => {
  const ALLOWED = new Set([
    'lapitayaRequests', 'lapitayaApprovals', 'lapitayaConfirmRequest', 'lapitayaCancelRequest',
    'onLapitayaGovernance', 'aliciaSnapshot', 'aliciaMarkRead', 'aliciaSubmit'
  ]);
  const used = new Set();
  for (const file of UI_FILES) {
    const src = code(read(file));
    for (const m of src.matchAll(/window\.cth\.(\w+)/g)) used.add(m[1]);
    assert.doesNotMatch(src, /hive:send|hiveSend|hive[A-Z]\w*\(|sendToAgent|godId|'god'|dispatch\w*\(/, file);
  }
  for (const u of used) assert.ok(ALLOWED.has(u), `window.cth.${u} is not a human-channel/Alicia call`);
  // aliciaSubmit is the v0.4.1 governed path (intent boundary), not the hive.
  const main = code(read('src/main/index.ts'));
  const submit = main.slice(main.indexOf("ipcMain.handle('alicia:submit'"), main.indexOf("ipcMain.handle('lapitaya:ledger'"));
  assert.match(submit, /aliciaCompanion\.submit\(/);
  assert.doesNotMatch(submit, /hive\.send|lapitaya\.decide|confirmRequest/);
  // The Command Center mounts the panel; nothing else of Alicia's is wired there.
  const cc = read('src/renderer/src/components/CommandCenterPanel.tsx');
  assert.match(cc, /\{tab === 'human' && <><AliciaPanel \/><GovernancePanel \/><AskMeTab \/><\/>\}/);
});

test('[UI-15][UI-16] i18n: es-MX and en-US are complete, identical key trees, no fallback, no hardcoded text', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const es = keys(LOCALES['es-MX'].alicia.confirmation).sort();
  const en = keys(LOCALES['en-US'].alicia.confirmation).sort();
  assert.deepEqual(es, en);
  for (const s of C.CONFIRMATION_UI_STATES) assert.ok(es.includes(`state.${s}`), s);
  // Every key the view renders, in every state, resolves in both locales with no fallback.
  const P = (id, status, extra = {}) => ({
    id, intentId: 'int-1', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'Quiero que revisemos esto.',
    taskId: 't-1', target: null, signals: [], scope: 'LOW', status, createdAt: 1_800_000_000_000, fingerprint: 'x', token: status === 'PROPOSED' ? 'tok' : null, ...extra
  });
  const outcomes = { 'req-2': { op: 'confirm', ok: false, code: 'TAMPERED', reason: '' }, 'req-7': { op: 'confirm', ok: false, code: 'LEDGER_UNAVAILABLE', reason: '' } };
  const views = [
    P('req-1', 'PROPOSED'), P('req-2', 'PROPOSED'), P('req-3', 'CONFIRMED', { scope: 'MEDIUM' }), P('req-4', 'CANCELLED'),
    P('req-5', 'COMPLETED'), P('req-6', 'SUPERSEDED'), P('req-7', 'PROPOSED', { scope: 'MEDIUM' }), P('req-8', 'BLOCKED')
  ].map((p) => ({
    ...p, uiState: C.deriveUiState(p, undefined, outcomes[p.id] ?? null), canConfirm: p.status === 'PROPOSED', canCancel: true,
    busy: false, outcome: outcomes[p.id] ?? null, pendingHighApprovals: p.status === 'CONFIRMED' ? 2 : 0
  }));
  const snapshot = { loaded: true, loadError: true, busy: false, pendingCount: 3, views };
  for (const lng of ['es-MX', 'en-US']) {
    const { html, missing } = render(snapshot, { lng, lines: [{ from: 'human', text: 'hola' }, { from: 'alicia', text: 'hola' }] });
    assert.deepEqual(missing, [], `${lng}: missing keys`);
    assert.doesNotMatch(html, /lapitaya:|alicia\.confirmation\./, `${lng}: unresolved key`);
    const { t } = strictT(lng);
    for (const k of es) {
      const v = t(`lapitaya:alicia.confirmation.${k}`, { count: 1, code: 'X', id: 'req-1', risk: 'LOW', decision: 'ALLOW', rule: 'R' });
      assert.ok(v && v !== `alicia.confirmation.${k}` && !v.includes('{{'), `${lng}: ${k}`);
    }
  }
  const esHtml = render(snapshot, { lng: 'es-MX' }).html;
  const enHtml = render(snapshot, { lng: 'en-US' }).html;
  assert.match(esHtml, /Confirmar REQUEST/);
  assert.match(enHtml, /Confirm REQUEST/);
  // Technical identifiers are not translated.
  for (const html of [esHtml, enHtml]) {
    assert.match(html, /<dt>proposalId<\/dt>/);
    assert.match(html, /<b>LOW<\/b>/);
    assert.match(html, /HUMAN_APPROVAL_REQUIRED/);
    assert.match(html, /TAMPERED/);
  }
  // No visible text literal in the view outside t(): only the technical id "proposalId".
  const view = code(read(`${UI_DIR}/AliciaPanelView.tsx`));
  const literals = [...view.matchAll(/>([^<>{}]*[A-Za-zÁ-ú]{2,}[^<>{}]*)</g)].map((m) => m[1].trim()).filter(Boolean);
  assert.deepEqual(literals, ['proposalId']);
  const panel = code(read(`${UI_DIR}/AliciaPanel.tsx`));
  assert.deepEqual([...panel.matchAll(/>([^<>{}=]*[A-Za-z]{2,}[^<>{}=]*)</g)].map((m) => m[1].trim()).filter(Boolean), []);
});

test('[UI-17] keyboard: native controls only; Confirm needs a deliberate acknowledgement; no key shortcut confirms', async (t) => {
  const f = await floor(t);
  const { ui, id } = await requestThroughUi(f);
  const without = card(render(ui.getSnapshot()).html, id);
  const withAck = card(render(ui.getSnapshot(), { acknowledged: [id] }).html, id);
  assert.match(button(without, 'confirm'), /disabled=""/, 'Enter/Space on Confirm does nothing until acknowledged');
  assert.doesNotMatch(button(withAck, 'confirm'), /disabled=""/);
  assert.doesNotMatch(button(withAck, 'cancel'), /disabled=""/);
  assert.match(withAck, /<input type="checkbox" data-action="acknowledge"/);
  // Tab order: acknowledgement, Cancel, then Confirm (never first, never autofocused).
  const order = [...withAck.matchAll(/data-action="(\w[\w-]*)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['acknowledge', 'cancel', 'confirm']);
  for (const file of UI_FILES) {
    const src = code(read(file));
    assert.doesNotMatch(src, /onKeyDown|onKeyUp|onKeyPress|autoFocus|accessKey/, file);
    assert.doesNotMatch(src, /<div[^>]*onClick/, `${file}: clickable non-button`);
  }
  // Buttons are type="button": Enter in the Alicia message box cannot submit a decision.
  assert.match(button(withAck, 'confirm'), /type="button"/);
  assert.match(button(withAck, 'cancel'), /type="button"/);
  const full = render(ui.getSnapshot(), { acknowledged: [id] }).html;
  const form = full.slice(full.indexOf('<form'), full.indexOf('</form>'));
  assert.doesNotMatch(form, /data-action="(confirm|cancel)"/);
  assert.equal([...full.matchAll(/tabindex="-1"/g)].length, ui.getSnapshot().views.length, 'only the card headings (focus targets) are programmatic');
});

test('[UI-18] accessible names, descriptions, live regions and visible focus', async (t) => {
  const f = await floor(t);
  const { ui, id } = await requestThroughUi(f);
  const { html } = render(ui.getSnapshot(), { acknowledged: [id] });
  assert.match(html, /<div data-alicia-panel="true" role="region" aria-labelledby="alicia-panel-title"/);
  assert.match(html, /id="alicia-panel-title"/);
  const c = card(html, id);
  assert.match(html, new RegExp(`<section id="alicia-proposal-${id}" aria-labelledby="alicia-proposal-${id}-h"`));
  const described = button(c, 'confirm').match(/aria-describedby="([^"]+)"/)[1].split(' ');
  for (const ref of described) assert.match(html, new RegExp(`id="${ref}"`), `describedby → ${ref}`);
  assert.match(c, /role="group" aria-label="Decisión sobre la propuesta"/);
  assert.match(c, /<label[^>]*><input type="checkbox"[^>]*\/><span>Leí la propuesta/);
  assert.match(c, /role="status" aria-live="polite" data-field="outcome"/);
  assert.match(html, /<label for="alicia-draft"/);
  assert.match(html, /id="alicia-draft"/);
  assert.match(html, /:focus-visible\{outline:2px solid/);
  assert.match(button(c, 'confirm'), />Confirmar REQUEST$|aria-busy="false"/);
  // Refusals are announced assertively.
  await ui.refresh();
  const s = f.lapitaya.openRequest({ intentId: 'int-s', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'borra la base de datos', taskId: null, target: null, signals: [] });
  await ui.refresh();
  await ui.confirm(s.id);
  assert.match(card(render(ui.getSnapshot()).html, s.id), /role="alert" aria-live="assertive" data-field="outcome"/);
});

// ─── End to end: the UI is not the enforcement ─────────────────────────────

test('[UI-E2E] USER → ALICIA UI → REQUEST → PROPOSED → Confirm → runtime → CIMA → authorize → PreToolUse → execution', async (t) => {
  const f = await floor(t);
  const { ui, id } = await requestThroughUi(f, 'Quiero que revisemos este proyecto.');
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, true, 'blocked while PROPOSED');
  await ui.confirm(id);
  const ok = await attempt(f, 'god', TEST_CALL);
  assert.equal(ok.denied, false, ok.reason);
  assert.equal(ok.decision, 'ALLOW');
  const gov = f.ledger().filter((e) => e.kind === 'governance' && e.proposalId === id);
  assert.ok(gov.some((e) => e.decision === 'ALLOW' && e.risk === 'LOW'), 'authorized by CIMA under the confirmed proposal');
  // Still bounded by CIMA after confirmation: MEDIUM exceeds the LOW scope.
  const med = await attempt(f, 'god', editCall(f));
  assert.equal(med.denied, true);
  assert.match(med.reason, /^REQUEST_SCOPE_EXCEEDED/);
  assert.deepEqual(transitions(f, id), ['PROPOSED', 'REVALIDATED', 'CONFIRMED']);
});

test('[UI-E2E-NEG] REQUEST → PROPOSED → NO confirm → agent attempts a tool → BLOCKED, with or without the UI', async (t) => {
  const f = await floor(t);
  const { ui, id } = await requestThroughUi(f, 'Quiero que revisemos este proyecto.');
  assert.equal(ui.getSnapshot().views.find((v) => v.id === id).uiState, 'PENDING');
  for (const [agent, call] of [['god', TEST_CALL], ['el-beni-1', TEST_CALL], ['god', editCall(f)], ['god', HIGH_CALL]]) {
    const r = await attempt(f, agent, call);
    assert.equal(r.denied, true, `${agent} ${call.tool}`);
    assert.match(r.reason, /^REQUEST_CONFIRMATION_REQUIRED/);
  }
  assert.equal(f.lapitaya.listApprovals().length, 0, 'no HIGH approval raised while unconfirmed');
  // No UI at all — a floor where the panel was never mounted — enforces the same.
  const g = await floor(t);
  g.companion.submit('Quiero que revisemos este proyecto.');
  const r = await attempt(g, 'god', TEST_CALL);
  assert.equal(r.denied, true);
  assert.match(r.reason, /^REQUEST_CONFIRMATION_REQUIRED/);
  // A UI that tried to confirm with a non-human identity cannot: the port has no `by`,
  // and the runtime refuses anyone but the human.
  const p = f.lapitaya.listRequests().find((x) => x.id === id);
  assert.equal(f.lapitaya.confirmRequest(id, { by: 'alicia', token: p.token }).code, 'NOT_AUTHORIZED');
  assert.equal((await attempt(f, 'god', TEST_CALL)).denied, true);
});
