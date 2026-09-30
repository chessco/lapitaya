'use strict';
// Reproducible evidence for Alicia v0.4.2 (REQUEST execution gate), from the REAL
// runtime via the same fixture the tests use:  node <this file>  (from the repo root)
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.resolve(__dirname, '..', '..');
process.chdir(REPO);
const { floor } = require(path.join(REPO, 'test/fixtures/lapitaya-floor.cjs'));
const OUT = path.join(REPO, 'evidence/lapitaya-alicia-v0.4.2');
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
async function attempt(f, agent, call, label) {
  const r = await f.pre(agent, call.tool, call.input);
  return {
    step: label, agent, call: `${call.tool} ${JSON.stringify(call.input).replace(f.home, '<home>')}`,
    result: r?.hookSpecificOutput?.permissionDecision === 'deny' ? 'DENIED' : 'ALLOWED',
    decision: f.server.lastPreDecision,
    reason: (r?.hookSpecificOutput?.permissionDecisionReason ?? '').slice(0, 160)
  };
}
const req = (f, msg, opts) => {
  const r = f.companion.submit(msg, opts);
  return f.lapitaya.listRequests().find((p) => p.id === r.outcome.proposalId);
};

(async () => {
  // ─── gate: unconfirmed → confirmed LOW scope ───
  const f = await floor(t);
  const steps = [];
  const p = req(f, 'Quiero que revises los archivos del proyecto.');
  steps.push({ step: 'REQUEST submitted through Alicia', proposal: { id: p.id, status: p.status, scope: p.scope, executor: p.executor } });
  steps.push(await attempt(f, 'god', TEST, 'REQ-01 LOW, unconfirmed'));
  steps.push(await attempt(f, 'god', edit(f), 'REQ-02 MEDIUM, unconfirmed'));
  steps.push(await attempt(f, 'god', HIGH, 'REQ-03 HIGH, unconfirmed'));
  steps.push({ step: 'approvals raised while unconfirmed', count: f.lapitaya.listApprovals().length });
  steps.push(await attempt(f, 'el-beni-1', TEST, 'REQ-15 delegation to El Beni, unconfirmed'));
  steps.push(await attempt(f, 'god', { tool: 'Read', input: { file_path: path.join(f.home, 'README.md') } }, 'planning: Read, unconfirmed'));
  steps.push({ step: 'REQ-08 Alicia confirms (runtime API)', result: f.lapitaya.confirmRequest(p.id, { by: 'alicia', token: p.token }) });
  steps.push({ step: 'REQ-08 Alicia confirms (words)', result: (({ status, rule }) => ({ status, rule }))(f.companion.submit(`Confirma la propuesta ${p.id}`).outcome) });
  steps.push({ step: 'REQ-09 El Inge confirms', result: f.lapitaya.confirmRequest(p.id, { by: 'god', token: p.token }) });
  steps.push({ step: 'tampered token', result: f.lapitaya.confirmRequest(p.id, { by: 'human', token: 'f'.repeat(32) }) });
  const c = f.lapitaya.confirmRequest(p.id, { by: 'human', token: p.token });
  steps.push({ step: 'HUMAN confirms', result: { ok: c.ok, status: c.proposal.status, token: c.proposal.token, confirmedBy: c.proposal.confirmedBy } });
  steps.push({ step: 'REQ-07 replay the same confirmation', result: f.lapitaya.confirmRequest(p.id, { by: 'human', token: p.token }) });
  steps.push(await attempt(f, 'god', TEST, 'REQ-04 LOW, confirmed'));
  steps.push(await attempt(f, 'god', edit(f), 'REQ-11 MEDIUM beyond the confirmed LOW scope'));
  steps.push(await attempt(f, 'god', HIGH, 'REQ-10 HIGH after confirmation'));
  steps.push({ step: 'approvals after the HIGH attempt', approvals: f.lapitaya.listApprovals().map((a) => ({ id: a.id, agentId: a.agentId, status: a.status })) });
  w('gate/request-flow.json', steps);
  w('gate/ledger.jsonl', f.ledger().filter((e) => e.kind === 'request' || (e.kind === 'governance' && (e.proposalId || /^REQUEST_/.test(e.rule))))
    .map((e) => JSON.stringify(e)).join('\n') + '\n');

  // ─── MEDIUM scope + HIGH approval after confirmation ───
  const g = await floor(t);
  const m = req(g, 'Quiero que El Beni implemente la validación del formulario.');
  g.lapitaya.confirmRequest(m.id, { by: 'human', token: m.token });
  const medium = [{ step: 'REQUEST (change scope) confirmed', proposal: { id: m.id, scope: m.scope } }];
  medium.push(await attempt(g, 'god', edit(g), 'REQ-05 MEDIUM, confirmed'));
  medium.push(await attempt(g, 'god', HIGH, 'REQ-06 HIGH, confirmed (no approval yet)'));
  const [apr] = g.lapitaya.listApprovals();
  g.lapitaya.decide(apr.id, true, 'human');
  medium.push({ step: 'human approves the HIGH call separately', approvalId: apr.id });
  medium.push(await attempt(g, 'god', HIGH, 'REQ-06 HIGH after its own approval'));
  medium.push(await attempt(g, 'god', HIGH, 'REQ-06 HIGH retry'));
  w('gate/confirmed-medium-and-high.json', medium);

  // ─── replay across proposals ───
  const h = await floor(t);
  const p1 = req(h, 'Quiero que revisemos el proyecto.');
  const tok1 = p1.token;
  h.lapitaya.confirmRequest(p1.id, { by: 'human', token: tok1 });
  h.lapitaya.completeRequest(p1.id, 'human');
  const p2 = req(h, 'Quiero que analicemos el módulo de pagos.');
  w('replay/replay.json', [
    { step: 'p1 confirmed with its token, then completed by the human', p1: p1.id },
    { step: 'new REQUEST p2', p2: p2.id, status: 'PROPOSED' },
    await attempt(h, 'god', TEST, 'execution after p1, while p2 is unconfirmed'),
    { step: "confirm p2 with p1's token", result: h.lapitaya.confirmRequest(p2.id, { by: 'human', token: tok1 }) },
    { step: 'confirm p1 again', result: h.lapitaya.confirmRequest(p1.id, { by: 'human', token: tok1 }) }
  ]);

  // ─── ACTION & CONVERSATION unchanged ───
  const k = await floor(t);
  const conv = k.companion.submit('Hola Alicia');
  const act = k.companion.submit('Ejecuta los tests.', { target: TEST });
  w('unchanged/action-and-conversation.json', {
    conversation: { route: conv.outcome.route, proposals: k.lapitaya.listRequests().length, ledgerLines: 0 },
    action: { type: act.outcome.type, decision: act.outcome.decision, proposalId: act.outcome.proposalId ?? null },
    actionExecution: await attempt(k, 'god', TEST, 'ACTION exact call'),
    withPendingRequest: await (async () => { req(k, 'Quiero que revisemos el proyecto.'); return [await attempt(k, 'god', TEST, 'ACTION exact call while a REQUEST is pending'), await attempt(k, 'god', { tool: 'Bash', input: { command: 'npm run lint' } }, 'other call while a REQUEST is pending')]; })()
  });

  for (const c2 of cleanups) c2();
  console.log('evidence written');
})().catch((e) => { console.error(e); process.exit(1); });
