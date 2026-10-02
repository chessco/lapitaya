'use strict';
// Reproducible evidence for Alicia v0.7 (Human Governance & Decision Center),
// from the REAL runtime (test/fixtures/lapitaya-floor.cjs: HookServer PreToolUse /
// PostToolUse, CimaRuntimeService, IntentBoundary, companion), the v0.6
// projection and the REAL renderer view, wired exactly as the IPC handlers are.
//   node evidence/lapitaya-alicia-v0.7/reproduce.cjs      (from the repo root)
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.resolve(__dirname, '..', '..');
process.chdir(REPO);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const i18next = require('i18next');
const { floor, loadTs } = require(path.join(REPO, 'test/fixtures/lapitaya-floor.cjs'));
const O = loadTs('src/shared/lapitaya/alicia/observability.ts');
const C = loadTs('src/renderer/src/components/alicia/confirmationController.ts');
const D = loadTs('src/renderer/src/components/alicia/decisionCenter.ts');
const V = loadTs('src/renderer/src/components/alicia/AliciaPanelView.tsx');

const OUT = __dirname;
const cleanups = [];
const t = { after: (fn) => cleanups.push(fn) };
const w = (rel, data) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
};
const HIGH = { tool: 'Bash', input: { command: 'rm -rf /srv/data' } };
const TEST = { tool: 'Bash', input: { command: 'npm test' } };
const project = (rt) => O.projectObservability({ ledger: rt.ledger(3000), traces: rt.recentTraces(1000), approvals: rt.listApprovals(), requests: rt.listRequests() });
/** lapitaya:decide exactly as main answers it (outcome only). */
const decideIpc = (rt) => (id, approve) => { const a = rt.decide(id, approve, 'human'); return a ? { id: a.id, status: a.status, decidedAt: a.decidedAt ?? null, decidedBy: a.decidedBy ?? null } : null; };
async function center(f) {
  const calls = [];
  const requests = C.createConfirmationController({
    requests: async () => f.lapitaya.listRequests(),
    approvals: async () => (project(f.lapitaya).pendingApprovals ?? []).map((o) => ({ id: o.approvalId, status: 'pending', risk: o.risk, createdAt: o.timestamp })),
    confirm: async (id, token) => { calls.push(`lapitaya:confirmRequest ${id}`); return f.lapitaya.confirmRequest(id, { by: 'human', token }); },
    cancel: async (id) => { calls.push(`lapitaya:cancelRequest ${id}`); return f.lapitaya.cancelRequest(id, 'human'); }
  });
  const approvals = D.createApprovalController({ decide: async (id, approve) => { calls.push(`lapitaya:decide ${id} ${approve}`); return decideIpc(f.lapitaya)(id, approve); } });
  await requests.refresh();
  return { calls, requests, approvals, model: () => D.buildDecisionCenter(requests.getSnapshot(), project(f.lapitaya), approvals.getSnapshot()) };
}
async function pre(f, agent, call) {
  const r = await f.pre(agent, call.tool, call.input);
  return { result: r?.hookSpecificOutput?.permissionDecision === 'deny' ? 'DENIED' : 'ALLOWED', decision: f.server.lastPreDecision };
}
const req = (f, msg) => { const r = f.companion.submit(msg); return f.lapitaya.listRequests().find((p) => p.id === r.outcome.proposalId); };
const trs = (f, id) => f.ledger().filter((e) => e.kind === 'request' && e.proposalId === id).map((e) => `${e.transition}(${e.by})`);
const card = (d) => d && { approvalId: d.approvalId, uiState: d.uiState, pending: d.pending, resolution: d.resolution, risk: d.fact.risk, operation: d.fact.operation, rule: d.fact.rule, evidence: d.fact.evidence, timeline: d.timeline.map((o) => o.category) };
const LOCALES = Object.fromEntries(['es-MX', 'en-US'].map((l) => [l, JSON.parse(fs.readFileSync(path.join(REPO, `src/renderer/src/i18n/locales/lapitaya/${l}.json`), 'utf8'))]));
function render(dc, f, lng) {
  const missing = [];
  const inst = i18next.createInstance();
  inst.init({ lng, fallbackLng: false, initAsync: false, ns: ['lapitaya'], defaultNS: 'lapitaya', resources: { [lng]: { lapitaya: LOCALES[lng] } },
    interpolation: { escapeValue: false }, saveMissing: true, missingKeyHandler: (_l, _n, k) => missing.push(k) });
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(V.AliciaPanelView, {
    t: (k, o) => inst.t(k, o), snapshot: dc.requests.getSnapshot(), presence: null, acknowledged: new Set(), lines: [], draft: '', sending: false,
    onAcknowledge: noop, onConfirm: noop, onCancel: noop, onGoToProposal: noop, onDraft: noop, onSend: noop,
    observability: project(f.lapitaya), decisions: dc.model(), highAcknowledged: new Set(), onAcknowledgeHigh: noop, onApproveHigh: noop, onRejectHigh: noop
  }));
  return { html: html.split(f.home).join('<home>'), missing };
}
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>\n<!-- Static render of the v0.7 Decision Center (evidence only). -->\n${body}\n`;

(async () => {
  // ─── 1. REQUEST decisions ───
  const f = await floor(t);
  const p = req(f, 'Quiero que El Beni implemente la validación del formulario.');
  const q = req(f, 'Quiero que revisemos el módulo de pagos.');
  const s = f.lapitaya.openRequest({ intentId: 'int-stale', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'borra la base de datos', taskId: null, target: null, signals: [] });
  const dc = await center(f);
  const before = dc.model();
  const tok = p.token;
  const forged = f.lapitaya.confirmRequest(p.id, { by: 'human', token: 'f'.repeat(32) });
  const [c1, c2] = await Promise.all([dc.requests.confirm(p.id), dc.requests.confirm(p.id)]);
  const replay = f.lapitaya.confirmRequest(p.id, { by: 'human', token: tok });
  const cancel = await dc.requests.cancel(q.id);
  const stale = await dc.requests.confirm(s.id);
  w('request-decisions.json', {
    pendingCounts: before.counts,
    scopes: before.requests.filter((v) => v.status === 'PROPOSED').map((v) => ({ id: v.id, scope: v.scope })),
    tamperedToken: forged.code, doubleConfirm: { first: c1.ok, second: c2 === null ? 'dropped by the UI' : c2 }, replayedToken: replay.code,
    cancel: cancel.ok, staleConfirm: stale.code,
    transitions: { [p.id]: trs(f, p.id), [q.id]: trs(f, q.id), [s.id]: trs(f, s.id) },
    ipcCalls: dc.calls
  });

  // ─── 2. HIGH decisions ───
  const g = await floor(t);
  const r = req(g, 'Quiero que El Beni implemente la validación del formulario.');
  g.lapitaya.confirmRequest(r.id, { by: 'human', token: r.token });
  const steps = [{ step: 'REQUEST confirmed by the human', proposalId: r.id }];
  steps.push({ step: 'agent attempts HIGH after the confirmation', ...(await pre(g, 'god', HIGH)) });
  const gdc = await center(g);
  const [apr] = g.lapitaya.listApprovals();
  steps.push({ step: 'Decision Center shows the pending HIGH', card: card(gdc.model().high[0]), counts: gdc.model().counts });
  const pendingEs = render(gdc, g, 'es-MX');
  const pendingEn = render(gdc, g, 'en-US');
  w('html/decision-center-high-pending.es-MX.html', page('Decisiones humanas — HIGH pendiente', pendingEs.html));
  w('html/decision-center-high-pending.en-US.html', page('Human decisions — HIGH pending', pendingEn.html));
  const [a1, a2] = await Promise.all([gdc.approvals.approve(apr.id, true), gdc.approvals.approve(apr.id, true)]);
  steps.push({ step: 'human double-clicks Approve', first: a1, second: a2 === undefined ? 'dropped by the UI' : a2 });
  steps.push({ step: 'replay the approval via IPC', result: decideIpc(g.lapitaya)(apr.id, true) });
  steps.push({ step: 'agent retries the exact call', ...(await pre(g, 'god', HIGH)) });
  await g.post('god', HIGH.tool, HIGH.input, { stdout: '', stderr: '', interrupted: false });
  steps.push({ step: 'agent tries again (one-shot)', ...(await pre(g, 'god', HIGH)) });
  steps.push({ step: 'approved card after execution', card: card(gdc.model().high.find((d) => d.approvalId === apr.id)) });
  const [apr2] = g.lapitaya.listApprovals().filter((x) => x.status === 'pending');
  await gdc.approvals.reject(apr2.id, true);
  steps.push({ step: 'human rejects the next one', card: card(gdc.model().high.find((d) => d.approvalId === apr2.id)) });
  steps.push({ step: 'agent retries the rejected call', ...(await pre(g, 'god', HIGH)) });
  const [apr3] = g.lapitaya.listApprovals().filter((x) => x.status === 'pending');
  const [u1, u2] = [await center(g), await center(g)];
  const [y1, y2] = await Promise.all([u1.approvals.approve(apr3.id, true), u2.approvals.reject(apr3.id, true)]);
  const loser = y1 === null ? u1 : u2;
  steps.push({ step: 'two renderers race approve vs reject on stale views', results: [y1, y2], loserCard: card(loser.model().high.find((d) => d.approvalId === apr3.id)),
    ledgerDecisionsForIt: g.ledger().filter((e) => e.approvalId === apr3.id && /^HUMAN_(APPROVED|REJECTED)$/.test(e.decision)).length });
  steps.push({ step: 'REQUEST status throughout (approval never confirms/changes it)', status: g.lapitaya.listRequests().find((x) => x.id === r.id).status });
  w('high-decisions.json', steps);
  const es = render(gdc, g, 'es-MX');
  const en = render(gdc, g, 'en-US');
  w('html/decision-center.es-MX.html', page('Decisiones humanas', es.html));
  w('html/decision-center.en-US.html', page('Human decisions', en.html));

  // ─── 3. negatives ───
  const h = await floor(t);
  const hr = req(h, 'Quiero que El Beni implemente la validación del formulario.');
  h.lapitaya.confirmRequest(hr.id, { by: 'human', token: hr.token });
  await pre(h, 'god', HIGH);
  const [ha] = h.lapitaya.listApprovals();
  const hq = req(h, 'Quiero que revisemos el README.');
  const neg = {};
  neg.aliciaApprovesHigh = h.companion.submit(`Aprueba la acción ${ha.id}.`).outcome.decision;
  neg.aliciaConfirmsRequest = h.companion.submit(`Confirma la propuesta ${hq.id}.`).outcome.decision;
  neg.wrongIdentities = Object.fromEntries(['alicia', 'god', 'el-beni-1'].map((by) => [by, h.lapitaya.confirmRequest(hq.id, { by, token: hq.token }).code]));
  neg.wrongProposalToken = h.lapitaya.confirmRequest(hq.id, { by: 'human', token: hr.token ?? 'used' }).code;
  neg.fabricatedApprovalId = decideIpc(h.lapitaya)('apr-fabricated-1', true);
  neg.companionPorts = ['decide', 'approve', 'confirmRequest', 'cancelRequest'].filter((k) => k in h.companion);
  neg.afterAll = { approval: h.lapitaya.listApprovals().find((x) => x.id === ha.id).status, request: h.lapitaya.listRequests().find((x) => x.id === hq.id).status };
  neg.highStillBlocked = await pre(h, 'god', HIGH);
  w('negatives.json', neg);

  // ─── 4. security boundary + evidence resolution + i18n/a11y ───
  const html = es.html + en.html + pendingEs.html + pendingEn.html;
  const lines = fs.readFileSync(path.join(g.hive.root(), 'lapitaya', 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const refs = [...new Set(html.replace(/<[^>]+>/g, ' ').match(/EVT-[0-9a-f]{8}(\.\d+)?|\btrc-[a-z0-9]+-[a-z0-9]+\b|\bapr-[a-z0-9]+-[a-z0-9]+\b/g) ?? [])];
  const resolved = refs.filter((x) => (x.startsWith('EVT-') ? lines.some((l) => O.evidenceRef(l) === x.replace(/\.\d+$/, ''))
    : x.startsWith('trc-') ? g.lapitaya.recentTraces().some((tr) => tr.id === x) : g.lapitaya.listApprovals().some((a) => a.id === x)));
  const needles = ['rm -rf', '/srv/data', 'npm test', ...g.lapitaya.listApprovals().map((a) => a.summary), ...g.lapitaya.listApprovals().map((a) => a.fingerprint),
    ...g.lapitaya.listRequests().map((x) => x.token).filter(Boolean), ...lines.map((l) => l.fingerprint).filter(Boolean), g.hive.root()];
  w('security-boundary.json', {
    decideIpcAnswerKeys: Object.keys(decideIpc(g.lapitaya)('apr-none', true) ?? { id: 0, status: 0, decidedAt: 0, decidedBy: 0 }).sort(),
    domLeaks: [...new Set(needles.filter((n) => n && html.includes(n)))].length,
    evidenceRefs: refs.length, evidenceRefsResolved: resolved.length
  });
  const keys = (o, p2 = '') => Object.entries(o).flatMap(([kk, v]) => (v && typeof v === 'object' ? keys(v, `${p2}${kk}.`) : [`${p2}${kk}`]));
  const kes = keys(LOCALES['es-MX'].alicia.decisions).sort();
  const ken = keys(LOCALES['en-US'].alicia.decisions).sort();
  const highCard = pendingEs.html.slice(pendingEs.html.lastIndexOf('<section', pendingEs.html.indexOf('data-decision-type="HIGH_APPROVAL"')));
  w('i18n-and-a11y.json', {
    i18n: { decisionKeys: kes.length, identicalKeyTrees: JSON.stringify(kes) === JSON.stringify(ken),
      missingWhenRendered: { 'es-MX': [...es.missing, ...pendingEs.missing], 'en-US': [...en.missing, ...pendingEn.missing] } },
    a11y: {
      decisionCenterLabelledSection: /<section data-decision-center="true" aria-labelledby="alicia-decision-center"/.test(es.html),
      countsLiveStatus: /<p role="status" data-field="decision-counts"/.test(es.html),
      highGroupLabelled: /role="group" aria-label="Decisión sobre la acción HIGH"/.test(highCard),
      approveNeedsAcknowledgement: /data-action="approve-high"[^>]*disabled=""/.test(highCard),
      controlOrder: [...highCard.slice(0, highCard.indexOf('</section>')).matchAll(/data-action="([\w-]+)"/g)].map((x) => x[1])
    }
  });
  for (const c of cleanups) c();
  console.log('evidence written to', path.relative(REPO, OUT));
})().catch((e) => { console.error(e); process.exit(1); });
