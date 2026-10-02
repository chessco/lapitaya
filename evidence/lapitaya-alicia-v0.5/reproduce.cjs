'use strict';
// Reproducible evidence for Alicia v0.5 (Human Confirmation UI), from the REAL
// runtime (test/fixtures/lapitaya-floor.cjs), the REAL UI state
// (confirmationController.ts) and the REAL renderer view (AliciaPanelView.tsx,
// rendered with react-dom/server and the shipped es-MX / en-US resources).
//   node evidence/lapitaya-alicia-v0.5/reproduce.cjs      (from the repo root)
// Electron screenshots and the live-app ledger in ./electron are complementary;
// the primary evidence is what this script (and the v0.5 suite) regenerates.
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.resolve(__dirname, '..', '..');
process.chdir(REPO);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const i18next = require('i18next');
const { floor, loadTs } = require(path.join(REPO, 'test/fixtures/lapitaya-floor.cjs'));
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const C = loadTs('src/renderer/src/components/alicia/confirmationController.ts');
const V = loadTs('src/renderer/src/components/alicia/AliciaPanelView.tsx');

const OUT = __dirname;
const cleanups = [];
const t = { after: (fn) => cleanups.push(fn) };
const w = (rel, data) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
};
const TEST = { tool: 'Bash', input: { command: 'npm test' } };
const HIGH = { tool: 'Bash', input: { command: 'rm -rf /srv/data' } };
const edit = (f) => ({ tool: 'Edit', input: { file_path: path.join(f.home, 'src', 'app.ts'), old_string: 'a', new_string: 'b' } });

/** The renderer's port: each method is exactly what its IPC handler in src/main/index.ts calls. */
function ipcPort(runtime, log) {
  return {
    requests: async () => runtime.listRequests(),
    approvals: async () => runtime.listApprovals(),
    confirm: async (id, token) => { log.push({ ipc: 'lapitaya:confirmRequest', id }); return runtime.confirmRequest(id, { by: 'human', token }); },
    cancel: async (id) => { log.push({ ipc: 'lapitaya:cancelRequest', id }); return runtime.cancelRequest(id, 'human'); }
  };
}
async function attempt(f, agent, call, label) {
  const r = await f.pre(agent, call.tool, call.input);
  return {
    step: label, agent, call: `${call.tool} ${JSON.stringify(call.input).split(JSON.stringify(f.home).slice(1, -1)).join('<home>')}`,
    result: r?.hookSpecificOutput?.permissionDecision === 'deny' ? 'DENIED' : 'ALLOWED',
    decision: f.server.lastPreDecision,
    reason: (r?.hookSpecificOutput?.permissionDecisionReason ?? '').slice(0, 140)
  };
}
const view = (ui, id) => {
  const v = ui.getSnapshot().views.find((x) => x.id === id);
  return v && { id: v.id, status: v.status, uiState: v.uiState, scope: v.scope, canConfirm: v.canConfirm, canCancel: v.canCancel,
    outcome: v.outcome, pendingHighApprovals: v.pendingHighApprovals, aliciaSays: C.aliciaLineKey(v) };
};
const LOCALES = Object.fromEntries(['es-MX', 'en-US'].map((l) => [l, JSON.parse(fs.readFileSync(path.join(REPO, `src/renderer/src/i18n/locales/lapitaya/${l}.json`), 'utf8'))]));
function render(snapshot, lng, acknowledged = []) {
  const missing = [];
  const inst = i18next.createInstance();
  inst.init({ lng, fallbackLng: false, initAsync: false, ns: ['lapitaya'], defaultNS: 'lapitaya',
    resources: { [lng]: { lapitaya: LOCALES[lng] } }, interpolation: { escapeValue: false },
    saveMissing: true, missingKeyHandler: (_l, _n, k) => missing.push(k) });
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(V.AliciaPanelView, {
    t: (k, o) => inst.t(k, o), snapshot, presence: 'WAITING_APPROVAL', acknowledged: new Set(acknowledged), lines: [],
    draft: '', sending: false, onAcknowledge: noop, onConfirm: noop, onCancel: noop, onGoToProposal: noop, onDraft: noop, onSend: noop
  }));
  return { html, missing };
}
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>\n<!-- Static render of AliciaPanelView (evidence only; styles use the app's CSS variables). -->\n${body}\n`;

(async () => {
  // ─── 1. pending → visible, data from the runtime, confirm, E2E ───
  const f = await floor(t);
  const ipc = [];
  const sub = f.companion.submit('Quiero que revisemos los archivos del proyecto.');
  const id = sub.outcome.proposalId;
  const ui = C.createConfirmationController(ipcPort(f.lapitaya, ipc));
  await ui.refresh();
  const runtimeProposal = f.lapitaya.listRequests().find((p) => p.id === id);
  const pending = render(ui.getSnapshot(), 'es-MX');
  w('ui/html/01-pending.es-MX.html', page('Alicia — pending', pending.html));
  const flow = [
    { step: 'USER → Alicia UI (alicia:submit) → runtime', outcome: { type: sub.outcome.type, route: sub.outcome.route, decision: sub.outcome.decision, proposalId: id } },
    { step: 'UI-01/02 runtime proposal vs UI view',
      runtime: (({ id, intentId, message, scope, status, executor, taskId, createdAt }) => ({ id, intentId, message, scope, status, executor, taskId, createdAt }))(runtimeProposal),
      ui: view(ui, id), missingI18nKeys: pending.missing },
    await attempt(f, 'god', TEST, 'NO confirm yet: El Inge LOW'),
    await attempt(f, 'el-beni-1', TEST, 'NO confirm yet: delegated El Beni LOW'),
    await attempt(f, 'god', edit(f), 'NO confirm yet: MEDIUM'),
    await attempt(f, 'god', HIGH, 'NO confirm yet: HIGH'),
    { step: 'approvals raised while unconfirmed', count: f.lapitaya.listApprovals().length }
  ];
  // UI-07: a double-click
  const [a, b] = await Promise.all([ui.confirm(id), ui.confirm(id)]);
  flow.push({ step: 'UI-07 Confirm clicked twice', first: a.ok, second: b === null ? 'dropped by the UI (not sent)' : b, ipcCalls: ipc.filter((x) => x.id === id) });
  flow.push({ step: 'UI-05 after confirmation', ui: view(ui, id) });
  flow.push(await attempt(f, 'god', TEST, 'confirmed LOW scope: LOW call'));
  flow.push(await attempt(f, 'god', edit(f), 'confirmed LOW scope: MEDIUM call'));
  flow.push(await attempt(f, 'god', HIGH, 'UI-10 confirmed: HIGH call'));
  await ui.refresh();
  flow.push({ step: 'UI-10 the card after the HIGH attempt', ui: view(ui, id), approvals: f.lapitaya.listApprovals().map((x) => ({ id: x.id, risk: x.risk, status: x.status })) });
  flow.push({ step: 'request transitions (ledger)', transitions: f.ledger().filter((e) => e.kind === 'request' && e.proposalId === id).map((e) => `${e.transition}(${e.by})`) });
  w('ui/confirm-flow.json', flow);
  const confirmed = render(ui.getSnapshot(), 'es-MX');
  w('ui/html/02-confirmed-high-pending.es-MX.html', page('Alicia — confirmed, HIGH pending', confirmed.html));
  w('ui/html/02-confirmed-high-pending.en-US.html', page('Alicia — confirmed, HIGH pending', render(ui.getSnapshot(), 'en-US').html));

  // ─── 2. cancel ───
  const g = await floor(t);
  const cid = g.companion.submit('Quiero que El Beni implemente la validación del formulario.').outcome.proposalId;
  const ui2 = C.createConfirmationController(ipcPort(g.lapitaya, []));
  await ui2.refresh();
  const before = view(ui2, cid);
  await ui2.cancel(cid);
  w('ui/cancel.json', {
    before, after: view(ui2, cid),
    runtime: (({ status, closedBy, token }) => ({ status, closedBy, token }))(g.lapitaya.listRequests().find((p) => p.id === cid)),
    confirmAfterCancel: { ui: await ui2.confirm(cid), runtime: g.lapitaya.confirmRequest(cid, { by: 'human', token: 'x' }) },
    executionAfterCancel: await attempt(g, 'god', edit(g), 'MEDIUM after the REQUEST was cancelled (no active scope)')
  });

  // ─── 3. stale / changed elsewhere / superseded / tampered / forged ───
  const h = await floor(t);
  const s = h.lapitaya.openRequest({ intentId: 'int-stale', executor: 'god', requestedBy: 'human', source: 'alicia',
    message: 'borra la base de datos', taskId: null, target: null, signals: [] });
  const ui3 = C.createConfirmationController(ipcPort(h.lapitaya, []));
  await ui3.refresh();
  const staleRes = await ui3.confirm(s.id);
  const elsewhere = h.companion.submit('Quiero que revisemos el módulo de pagos.').outcome.proposalId;
  await ui3.refresh();
  h.lapitaya.confirmRequest(elsewhere, { by: 'human', token: h.lapitaya.listRequests().find((p) => p.id === elsewhere).token });
  const elsewhereRes = await ui3.confirm(elsewhere);
  h.hive.addTask({ id: 't-rep', title: 'x', status: 'doing', assignee: 'god', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });
  const old = h.companion.submit('Quiero que revisemos la tarea.', { taskId: 't-rep' }).outcome.proposalId;
  h.companion.submit('Quiero que revisemos la tarea otra vez.', { taskId: 't-rep' });
  await ui3.refresh();
  const racing = {
    stale: { runtime: staleRes, ui: view(ui3, s.id) },
    confirmedElsewhere: { runtime: elsewhereRes, ui: view(ui3, elsewhere) },
    superseded: { ui: view(ui3, old) }
  };
  const k = await floor(t);
  const tid = k.companion.submit('Quiero que revisemos este proyecto.').outcome.proposalId;
  const file = path.join(k.hive.root(), 'lapitaya', 'proposals.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  list.find((x) => x.id === tid).scope = 'MEDIUM';
  fs.writeFileSync(file, JSON.stringify(list));
  const fresh = new CimaRuntimeService({ hiveRoot: () => k.hive.root(), godId: () => 'god' });
  const ui4 = C.createConfirmationController(ipcPort(fresh, []));
  await ui4.refresh();
  racing.tamperedOnDisk = { runtime: await ui4.confirm(tid), ui: view(ui4, tid) };
  const m = await floor(t);
  const fid = m.companion.submit('Quiero que revisemos este proyecto.').outcome.proposalId;
  racing.forgedToken = m.lapitaya.confirmRequest(fid, { by: 'human', token: 'f'.repeat(32) });
  racing.nonHuman = m.lapitaya.confirmRequest(fid, { by: 'alicia', token: m.lapitaya.listRequests().find((p) => p.id === fid).token });
  racing.statusAfterRefusals = m.lapitaya.listRequests().find((p) => p.id === fid).status;
  w('ui/stale-and-tamper.json', racing);
  w('ui/html/03-stale-and-tampered.es-MX.html', page('Alicia — stale / tampered',
    render(ui3.getSnapshot(), 'es-MX').html + '\n' + render(ui4.getSnapshot(), 'es-MX').html));

  // ─── 4. i18n + accessibility facts ───
  const keys = (o, p = '') => Object.entries(o).flatMap(([kk, v]) => (v && typeof v === 'object' ? keys(v, `${p}${kk}.`) : [`${p}${kk}`]));
  const es = keys(LOCALES['es-MX'].alicia.confirmation).sort();
  const en = keys(LOCALES['en-US'].alicia.confirmation).sort();
  const a11y = render(ui.getSnapshot(), 'es-MX', []).html;
  w('ui/i18n-and-a11y.json', {
    i18n: { keys: es.length, identicalKeyTrees: JSON.stringify(es) === JSON.stringify(en),
      missingWhenRendered: { 'es-MX': pending.missing, 'en-US': render(ui.getSnapshot(), 'en-US').missing } },
    a11y: {
      region: /role="region" aria-labelledby="alicia-panel-title"/.test(a11y),
      decisionGroupLabelled: /role="group" aria-label="/.test(a11y),
      liveRegions: (a11y.match(/aria-live="/g) ?? []).length,
      focusVisibleCss: /:focus-visible\{outline:2px solid/.test(a11y),
      nativeControlsOnly: !/onKeyDown|autoFocus/.test(fs.readFileSync(path.join(REPO, 'src/renderer/src/components/alicia/AliciaPanelView.tsx'), 'utf8'))
    }
  });
  for (const c of cleanups) c();
  console.log('evidence written to', path.relative(REPO, OUT));
})().catch((e) => { console.error(e); process.exit(1); });
