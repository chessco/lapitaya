'use strict';
// Reproducible evidence for Alicia v0.6 (governance observability & explanation),
// generated from the REAL runtime (test/fixtures/lapitaya-floor.cjs: real
// HookServer PreToolUse / PostToolUse, CimaRuntimeService, IntentBoundary,
// companion) and projected exactly as the `lapitaya:observability` IPC does.
//   node evidence/lapitaya-alicia-v0.6/reproduce.cjs      (from the repo root)
// Electron screenshots and the live ledger in ./electron are complementary.
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

/** Exactly what the `lapitaya:observability` handler projects. */
const project = (rt) => O.projectObservability({ ledger: rt.ledger(3000), traces: rt.recentTraces(1000), approvals: rt.listApprovals(), requests: rt.listRequests() });
/** One observation, with its es-MX and en-US explanation and its resolved evidence. */
function explained(f, o) {
  let resolved = null;
  if (o.evidence?.source === 'cima-ledger.jsonl') {
    const lines = fs.readFileSync(path.join(f.hive.root(), 'lapitaya', 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean);
    const line = lines.find((l) => O.evidenceRef(JSON.parse(l)) === o.evidence.ref.replace(/\.\d+$/, ''));
    if (line) { const r = JSON.parse(line); resolved = { kind: r.kind, transition: r.transition, decision: r.decision, rule: r.rule ?? r.code, risk: r.risk, status: r.status }; }
  } else if (o.evidence?.source === 'traces.jsonl') {
    const tr = f.lapitaya.recentTraces().find((x) => x.id === o.evidence.ref);
    if (tr) resolved = { trace: tr.id, ok: tr.ok, tool: tr.tool };
  }
  const { keys, ...fact } = o;
  return { fact, keys, 'es-MX': O.explainObservation(o, 'es-MX'), 'en-US': O.explainObservation(o, 'en-US'), evidenceResolvesTo: resolved };
}
async function pre(f, agent, call) {
  const r = await f.pre(agent, call.tool, call.input);
  return r?.hookSpecificOutput?.permissionDecision === 'deny' ? 'DENIED' : 'ALLOWED';
}
const LOCALES = Object.fromEntries(['es-MX', 'en-US'].map((l) => [l, JSON.parse(fs.readFileSync(path.join(REPO, `src/renderer/src/i18n/locales/lapitaya/${l}.json`), 'utf8'))]));
function render(snapshot, observability, lng) {
  const missing = [];
  const inst = i18next.createInstance();
  inst.init({ lng, fallbackLng: false, initAsync: false, ns: ['lapitaya'], defaultNS: 'lapitaya',
    resources: { [lng]: { lapitaya: LOCALES[lng] } }, interpolation: { escapeValue: false },
    saveMissing: true, missingKeyHandler: (_l, _n, k) => missing.push(k) });
  const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(V.AliciaPanelView, {
    t: (k, o) => inst.t(k, o), snapshot, presence: null, acknowledged: new Set(), lines: [], draft: '', sending: false,
    onAcknowledge: noop, onConfirm: noop, onCancel: noop, onGoToProposal: noop, onDraft: noop, onSend: noop, observability
  }));
  return { html, missing };
}
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>\n<!-- Static render of AliciaPanelView with the v0.6 projection (evidence only). -->\n${body}\n`;
const sanitize = (s, f) => s.split(f.home).join('<home>').split(JSON.stringify(f.home).slice(1, -1)).join('<home>');

(async () => {
  // ─── 1. every explanation the runtime can give, one real fact each ───
  const f = await floor(t);
  const explanations = {};
  const p = f.companion.submit('Quiero que revisemos este proyecto.');
  const pid = p.outcome.proposalId;
  explanations.REQUEST_PROPOSED = explained(f, project(f.lapitaya).byProposal[pid].latest);
  await pre(f, 'god', TEST);
  explanations.REQUEST_CONFIRMATION_REQUIRED = explained(f, project(f.lapitaya).recent.find((o) => o.category === 'REQUEST_CONFIRMATION_REQUIRED'));
  const tok = f.lapitaya.listRequests().find((x) => x.id === pid).token;
  f.lapitaya.confirmRequest(pid, { by: 'human', token: 'f'.repeat(32) });
  explanations.TAMPERED = explained(f, project(f.lapitaya).recent.find((o) => o.rule === 'TAMPERED'));
  f.lapitaya.confirmRequest(pid, { by: 'alicia', token: tok });
  explanations.NOT_AUTHORIZED = explained(f, project(f.lapitaya).recent.find((o) => o.rule === 'NOT_AUTHORIZED'));
  f.lapitaya.confirmRequest(pid, { by: 'human', token: tok });
  explanations.REQUEST_CONFIRMED = explained(f, project(f.lapitaya).recent.find((o) => o.category === 'REQUEST_CONFIRMED'));
  await pre(f, 'god', edit(f));
  explanations.REQUEST_SCOPE_EXCEEDED = explained(f, project(f.lapitaya).recent.find((o) => o.category === 'REQUEST_SCOPE_EXCEEDED'));
  await pre(f, 'god', HIGH);
  explanations.HUMAN_APPROVAL_REQUIRED = explained(f, project(f.lapitaya).byProposal[pid].latest);
  const s = f.lapitaya.openRequest({ intentId: 'int-stale', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'borra la base de datos', taskId: null, target: null, signals: [] });
  f.lapitaya.confirmRequest(s.id, { by: 'human', token: s.token });
  explanations.STALE_PROPOSAL = explained(f, project(f.lapitaya).byProposal[s.id].latest);
  const unknown = O.observeLedgerRecord({ kind: 'governance', ts: 1, agentId: 'god', decision: 'SOMETHING_NEW' })[0];
  explanations.UNKNOWN_DECISION_synthetic = { fact: unknown, 'es-MX': O.explainObservation(unknown, 'es-MX'), note: 'synthetic record: an unknown decision is shown verbatim, never interpreted' };
  const missing = O.observeLedgerRecord({ kind: 'governance', ts: 1 })[0];
  explanations.MISSING_FIELDS_synthetic = { fact: missing, 'es-MX': O.explainObservation(missing, 'es-MX'), note: 'synthetic record with no rule/decision/risk: "information unavailable"' };
  w('governance-explanations.json', JSON.parse(sanitize(JSON.stringify(explanations), f)));

  // ─── 2. timeline of one REQUEST, end to end (with a real execution) ───
  const g = await floor(t);
  const r = g.companion.submit('Quiero que El Beni implemente la validación del formulario.');
  const rid = r.outcome.proposalId;
  const steps = [];
  steps.push({ step: 'agent tries while PROPOSED', result: await pre(g, 'god', TEST) });
  steps.push({ step: 'agent tries again', result: await pre(g, 'god', TEST) });
  const rp = g.lapitaya.listRequests().find((x) => x.id === rid);
  steps.push({ step: 'human confirms', result: g.lapitaya.confirmRequest(rid, { by: 'human', token: rp.token }).ok });
  steps.push({ step: 'agent runs npm test (PreToolUse)', result: await pre(g, 'god', TEST) });
  await g.ran('god', 'npm test', 'pass 3');
  steps.push({ step: 'harness records the run (PostToolUse)' });
  steps.push({ step: 'agent tries HIGH', result: await pre(g, 'god', HIGH) });
  const [apr] = g.lapitaya.listApprovals();
  g.lapitaya.decide(apr.id, true, 'human');
  steps.push({ step: 'human approves the HIGH call separately', approvalId: apr.id });
  steps.push({ step: 'agent retries the HIGH call', result: await pre(g, 'god', HIGH) });
  await g.post('god', HIGH.tool, HIGH.input, { stdout: '', stderr: '', interrupted: false });
  const tl = project(g.lapitaya).byProposal[rid];
  w('timeline.json', {
    proposalId: rid, steps,
    timeline: tl.timeline.map((o) => ({ time: o.timestamp, category: o.category, count: o.count, risk: o.risk, autonomy: o.autonomy, rule: o.rule,
      next: o.nextState, evidence: o.evidence, 'es-MX': O.explainObservation(o, 'es-MX').what })),
    latest: tl.latest.category, readOnly: { frozen: Object.isFrozen(tl.timeline) && tl.timeline.every(Object.isFrozen) }
  });

  // ─── 3. blocked: every non-planning call while PROPOSED ───
  const h = await floor(t);
  h.companion.submit('Quiero que revisemos este proyecto.');
  const attempts = [];
  for (const [agent, call] of [['god', TEST], ['el-beni-1', TEST], ['god', edit(h)], ['god', HIGH]]) attempts.push({ agent, tool: call.tool, result: await pre(h, agent, call) });
  const bv = project(h.lapitaya);
  w('blocked.json', JSON.parse(sanitize(JSON.stringify({
    attempts, approvalsRaised: h.lapitaya.listApprovals().length,
    observed: bv.recent.filter((o) => o.category === 'REQUEST_CONFIRMATION_REQUIRED').map((o) => ({ agent: o.agent, operation: o.operation, risk: o.risk, rule: o.rule, count: o.count, next: o.nextState, humanAction: o.requiredHumanAction, evidence: o.evidence.ref })),
    notificationsRaisedByTheBlocks: h.companion.snapshot().notifications.filter((n) => n.eventType === 'governance.blocked').length
  }), h)));

  // ─── 4. HIGH approval: confirmation ≠ approval ───
  const k = await floor(t);
  const q = k.companion.submit('Quiero que El Beni implemente la validación del formulario.').outcome.proposalId;
  k.lapitaya.confirmRequest(q, { by: 'human', token: k.lapitaya.listRequests().find((x) => x.id === q).token });
  await pre(k, 'god', HIGH);
  await pre(k, 'god', TEST); await k.ran('god', 'npm test', 'ok');
  const kv = project(k.lapitaya);
  const ui = C.createConfirmationController({ requests: async () => k.lapitaya.listRequests(), approvals: async () => k.lapitaya.listApprovals(), confirm: async () => null, cancel: async () => null });
  await ui.refresh();
  const es = render(ui.getSnapshot(), kv, 'es-MX');
  const en = render(ui.getSnapshot(), kv, 'en-US');
  w('high-approval.json', {
    cardLatest: explained(k, kv.byProposal[q].latest),
    laterRoutineWorkDoesNotHideIt: kv.byProposal[q].timeline.at(-1).category,
    approvalStatus: k.lapitaya.listApprovals().map((a) => ({ id: a.id, risk: a.risk, status: a.status })),
    uiSaysNotAnApproval: /Confirmar el REQUEST no aprobó esta acción HIGH/.test(es.html),
    uiHasApproveControl: /data-action="approve"/.test(es.html + en.html)
  });
  w('html/panel-high-pending.es-MX.html', page('Alicia v0.6 — HIGH pending', sanitize(es.html, k)));
  w('html/panel-high-pending.en-US.html', page('Alicia v0.6 — HIGH pending', sanitize(en.html, k)));

  // ─── 5. i18n + a11y facts ───
  const keys = (o, p2 = '') => Object.entries(o).flatMap(([kk, v]) => (v && typeof v === 'object' ? keys(v, `${p2}${kk}.`) : [`${p2}${kk}`]));
  const kes = keys(LOCALES['es-MX'].alicia.observe).sort();
  const ken = keys(LOCALES['en-US'].alicia.observe).sort();
  w('i18n-and-a11y.json', {
    i18n: { observeKeys: kes.length, identicalKeyTrees: JSON.stringify(kes) === JSON.stringify(ken), missingWhenRendered: { 'es-MX': es.missing, 'en-US': en.missing } },
    a11y: {
      timelineIsNativeDetails: /<details data-field="timeline"[^>]*><summary>/.test(es.html),
      timelineListLabelled: /<ol id="alicia-timeline-[^"]+" aria-label="/.test(es.html),
      controlsInsideTimeline: (es.html.match(/<details data-field="timeline"[\s\S]*?<\/details>/g) ?? []).join('').match(/<button|<input|<select|<textarea/g)?.length ?? 0,
      activityIsLabelledSection: /<section data-field="governance-activity" aria-labelledby="alicia-governance-activity"/.test(es.html),
      activityLiveRegion: /<ul aria-live="polite"/.test(es.html),
      semanticArticles: (es.html.match(/<article /g) ?? []).length
    }
  });
  for (const c of cleanups) c();
  console.log('evidence written to', path.relative(REPO, OUT));
})().catch((e) => { console.error(e); process.exit(1); });
