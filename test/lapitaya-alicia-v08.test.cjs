'use strict';
/**
 * La Pitaya Alicia v0.8 — Human Identity & Decision Ownership.
 *
 * WHO decided is resolved by main from the trusted sender (humanIdentity.ts),
 * handed to the EXISTING runtime methods by the human governance handlers
 * (humanGovernanceIpc.ts), validated and recorded there, and only then shown
 * by the v0.6/v0.7 projection. These tests exercise the real runtime, the real
 * handlers and the real identity service; the sender is a plain object, since
 * `describeSender` is the one Electron-specific seam. ID-29 / ID-30 are the
 * real-Electron flows (evidence/lapitaya-alicia-v0.8/electron).
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
const ID = loadTs('src/shared/lapitaya/identity.ts');
const HI = loadTs('src/main/humanIdentity.ts');
const HG = loadTs('src/main/humanGovernanceIpc.ts');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const HIGH_CALL = { tool: 'Bash', input: { command: 'rm -rf /srv/data' } };
const TEST_CALL = { tool: 'Bash', input: { command: 'npm test' } };
const has = (src, re, msg) => assert.ok(re.test(src), msg ?? String(re));
const APP_URL = 'file:///app/out/renderer/index.html';

// ─── the identity service, with a fake Electron seam ───────────────────────

function makeIdentity({ stored = null, user = 'francisco', session = 'ses-aaaaaaaaaaaaaaaa' } = {}) {
  const store = { id: stored };
  const svc = HI.createHumanIdentityService({
    readHumanId: () => store.id, writeHumanId: (id) => { store.id = id; },
    osUserName: () => user, sessionId: session,
    describeSender: (evt) => (evt && evt.__sender) ?? null,
    trustedUrlPrefixes: () => ['file:///app/out/renderer/']
  });
  return { svc, store };
}
/** A sender as `describeSender` reports it. */
const sender = (over = {}) => ({ __sender: { webContentsId: 1, destroyed: false, isMainFrame: true, url: APP_URL, ownWindow: true, ...over } });

/** The real runtime and handlers on a real floor. */
async function setup(t, opts) {
  const f = await floor(t);
  const idn = makeIdentity(opts);
  const gov = HG.createHumanGovernanceHandlers({ runtime: f.lapitaya, identity: idn.svc });
  return { f, idn, gov };
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
async function withPendingHigh(f, gov, evt = sender()) {
  const p = request(f);
  const c = gov.confirmRequest(evt, p.id, p.token);
  assert.equal(c.ok, true);
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED');
  return { p, apr: f.lapitaya.listApprovals()[0] };
}
const ledgerOf = (f) => fs.readFileSync(path.join(f.hive.root(), 'lapitaya', 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const project = (rt) => O.projectObservability({ ledger: rt.ledger(3000), traces: rt.recentTraces(1000), approvals: rt.listApprovals(), requests: rt.listRequests() });

// ─── identity resolution ───────────────────────────────────────────────────

test('[ID-01] a trusted human identity is resolved: stable id, display name, session, window', () => {
  const a = makeIdentity();
  const ctx = a.svc.resolve(sender({ webContentsId: 7 }));
  assert.match(ctx.human.id, ID.HUMAN_ID_RE);
  assert.equal(ctx.human.displayName, 'francisco');
  assert.match(ctx.session, ID.SESSION_ID_RE);
  assert.equal(ctx.window, 7);
  assert.equal(a.store.id, ctx.human.id, 'created once and persisted');
  // Stable across launches (same profile) and across windows; the session is what changes.
  const b = makeIdentity({ stored: a.store.id, session: 'ses-bbbbbbbbbbbbbbbb' });
  const again = b.svc.resolve(sender({ webContentsId: 9 }));
  assert.equal(again.human.id, ctx.human.id);
  assert.notEqual(again.session, ctx.session);
  // A persisted id that is not a valid human id is replaced, never trusted.
  const bad = makeIdentity({ stored: 'Francisco' });
  assert.match(bad.svc.resolve(sender()).human.id, ID.HUMAN_ID_RE);
  assert.notEqual(bad.store.id, 'Francisco');
  // The display name is data: control characters and markup are stripped, and it is capped.
  const weird = makeIdentity({ user: '  <b>Fran\u0007cisco</b>' + 'x'.repeat(100) });
  assert.doesNotMatch(weird.svc.identity().displayName, /[<>\u0007]/);
  assert.ok(weird.svc.identity().displayName.length <= 64);
});

test('[ID-02][ID-15] the renderer cannot define identity; a sender that is not our window gets none', () => {
  const { svc } = makeIdentity();
  // Anything the renderer could put in the event or in extra arguments is not read.
  const forged = { ...sender(), humanId: 'hum-evil00000000', userId: 'mallory', human: { id: 'hum-evil00000000', displayName: 'Mallory' } };
  const ctx = svc.resolve(forged);
  assert.notEqual(ctx.human.id, 'hum-evil00000000');
  assert.equal(ctx.human.displayName, 'francisco');
  // Wrong context: every way a sender can fail to be one of OUR windows' main frame.
  const refused = [
    ['not one of our windows', sender({ ownWindow: false })],
    ['an iframe / child frame', sender({ isMainFrame: false })],
    ['a destroyed window', sender({ destroyed: true })],
    ['another origin', sender({ url: 'https://evil.example/index.html' })],
    ['a file outside the build dir', sender({ url: 'file:///tmp/evil/index.html' })],
    ['a prefix trick', sender({ url: 'file:///app/out/renderer-evil/index.html' })],
    ['no frame url', sender({ url: '' })],
    ['a bad window id', sender({ webContentsId: -1 })]
  ];
  for (const [why, evt] of refused) assert.equal(svc.resolve(evt), null, why);
  assert.equal(svc.resolve(null), null);
  assert.equal(svc.resolve({}), null);
  assert.equal(svc.resolve(undefined), null);
});

// ─── ownership of each decision ────────────────────────────────────────────

test('[ID-03][ID-07] REQUEST confirmation records the trusted human, in the runtime and in the ledger', async (t) => {
  const { f, idn, gov } = await setup(t);
  const p = request(f);
  assert.equal(gov.attributeSubmitted(sender({ webContentsId: 3 }), p.id), true);
  const r = gov.confirmRequest(sender({ webContentsId: 3 }), p.id, p.token);
  assert.equal(r.ok, true);
  const me = idn.svc.identity();
  const after = f.lapitaya.listRequests().find((x) => x.id === p.id);
  assert.equal(after.status, 'CONFIRMED');
  assert.deepEqual([after.requestedOwner.id, after.confirmedOwner.id, after.confirmedOwner.window], [me.id, me.id, 3]);
  assert.equal(after.confirmedBy, 'human', 'the existing actor field is unchanged');
  const rec = ledgerOf(f).find((e) => e.kind === 'request' && e.transition === 'CONFIRMED' && e.proposalId === p.id);
  assert.deepEqual([rec.by, rec.human.id, rec.human.displayName, rec.human.session, rec.human.window], ['human', me.id, 'francisco', 'ses-aaaaaaaaaaaaaaaa', 3]);
  assert.ok(typeof rec.ts === 'number', 'WHEN is the runtime\'s own timestamp');
});

test('[ID-04] REQUEST cancellation records the trusted human', async (t) => {
  const { f, idn, gov } = await setup(t);
  const p = request(f);
  const r = gov.cancelRequest(sender({ webContentsId: 2 }), p.id);
  assert.equal(r.ok, true);
  const after = f.lapitaya.listRequests().find((x) => x.id === p.id);
  assert.deepEqual([after.status, after.closedOwner.id, after.closedOwner.window], ['CANCELLED', idn.svc.identity().id, 2]);
  const rec = ledgerOf(f).find((e) => e.kind === 'request' && e.transition === 'CANCELLED' && e.proposalId === p.id);
  assert.equal(rec.human.id, idn.svc.identity().id);
});

test('[ID-05][ID-06] HIGH approval and rejection record the trusted human; the existing approval record is unchanged', async (t) => {
  const { f, idn, gov } = await setup(t);
  const { apr } = await withPendingHigh(f, gov);
  const me = idn.svc.identity();
  const res = gov.decide(sender({ webContentsId: 4 }), apr.id, true);
  assert.deepEqual([res.id, res.status, res.decidedBy], [apr.id, 'approved', 'human']);
  assert.deepEqual(Object.keys(res).sort(), ['decidedAt', 'decidedBy', 'id', 'status'], 'the renderer still gets only the outcome');
  const a = f.lapitaya.listApprovals().find((x) => x.id === apr.id);
  assert.deepEqual([a.status, a.decidedBy, a.decidedOwner.id, a.decidedOwner.window], ['approved', 'human', me.id, 4]);
  const approved = ledgerOf(f).find((e) => e.kind === 'governance' && e.approvalId === apr.id && e.decision === 'HUMAN_APPROVED');
  assert.deepEqual([approved.rule, approved.human.id], ['human', me.id]);
  // Reject a second one.
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'APPROVED');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED');
  const second = f.lapitaya.listApprovals().find((x) => x.status === 'pending');
  gov.decide(sender({ webContentsId: 4 }), second.id, false);
  const rejected = ledgerOf(f).find((e) => e.kind === 'governance' && e.approvalId === second.id && e.decision === 'HUMAN_REJECTED');
  assert.equal(rejected.human.id, me.id);
  assert.equal(f.lapitaya.listApprovals().find((x) => x.id === second.id).decidedOwner.id, me.id);
});

test('[ID-08][ID-23][ID-24][ID-25] the projection shows the owner (id + display name) and nothing internal', async (t) => {
  const { f, idn, gov } = await setup(t);
  const { p, apr } = await withPendingHigh(f, gov);
  gov.decide(sender({ webContentsId: 5 }), apr.id, true);
  const view = project(f.lapitaya);
  const me = idn.svc.identity();
  const confirmed = view.history.find((o) => o.category === 'REQUEST_CONFIRMED' && o.proposalId === p.id);
  const granted = view.history.find((o) => o.category === 'APPROVAL_GRANTED' && o.approvalId === apr.id);
  assert.deepEqual(confirmed.decisionOwner, { id: me.id, displayName: 'francisco' });
  assert.deepEqual(granted.decisionOwner, { id: me.id, displayName: 'francisco' });
  assert.deepEqual(view.byApproval[apr.id].timeline.find((o) => o.category === 'APPROVAL_GRANTED').decisionOwner, { id: me.id, displayName: 'francisco' });
  // Facts that are not human decisions carry no owner.
  assert.ok(view.recent.filter((o) => o.category === 'ACTION_AUTHORIZED').every((o) => o.decisionOwner === null));
  // Nothing internal rides along: no session, window, token, fingerprint, command or path.
  const json = JSON.stringify(view);
  for (const leak of [p.token, f.lapitaya.listApprovals()[0].fingerprint, f.lapitaya.listRequests()[0].fingerprint, 'ses-aaaaaaaaaaaaaaaa', '"window"', 'rm -rf', '/srv/', f.hive.root(), '"session"']) {
    assert.ok(!json.includes(leak), `projection must not contain ${String(leak).slice(0, 30)}`);
  }
  assert.deepEqual(Object.keys(confirmed.decisionOwner).sort(), ['displayName', 'id']);
  // lapitaya:identity answers id, display name and session only.
  assert.deepEqual(Object.keys(gov.whoAmI(sender())).sort(), ['displayName', 'id', 'session']);
  assert.equal(gov.whoAmI(sender({ ownWindow: false })), null);
});

// ─── spoofing ──────────────────────────────────────────────────────────────

test('[ID-09][ID-10][ID-11][ID-12] fake identity, confirmedBy, approvedBy, rejectedBy are ignored or refused', async (t) => {
  const { f, idn, gov } = await setup(t);
  const me = idn.svc.identity();
  const fake = { human: { id: 'hum-mallory00000', displayName: 'Mallory' }, session: 'ses-evilevilevil', window: 99 };
  const p = request(f);
  // Extra renderer arguments (userId, confirmedBy, an identity object…) are not read by the handlers.
  const r = gov.confirmRequest(sender(), p.id, p.token, fake, 'mallory', { confirmedBy: 'mallory', userId: 'mallory' });
  assert.equal(r.ok, true);
  const after = f.lapitaya.listRequests().find((x) => x.id === p.id);
  assert.equal(after.confirmedOwner.id, me.id);
  assert.notEqual(after.confirmedOwner.displayName, 'Mallory');
  assert.ok(!JSON.stringify(ledgerOf(f)).includes('mallory'), 'the fake never reaches the ledger');
  // The runtime itself refuses a malformed / forged context rather than downgrading it to "anonymous".
  const q = request(f, 'Quiero que Valentin revise los permisos.');
  for (const bad of [{ human: { id: 'Francisco', displayName: 'F' }, session: 'ses-aaaaaaaaaaaaaaaa', window: 1 }, { human: me }, 'francisco', 7, null, { ...fake, window: 'x' }]) {
    const d = f.lapitaya.confirmRequest(q.id, { by: 'human', token: q.token, human: bad });
    assert.equal(d.ok, false);
    assert.equal(d.code, 'NOT_AUTHORIZED');
  }
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === q.id).status, 'PROPOSED', 'nothing was confirmed');
  assert.equal(f.lapitaya.cancelRequest(q.id, 'human', { human: me }).ok, false, 'cancel refuses a malformed context too');
  // HIGH: a malformed context decides nothing; fake approvedBy / rejectedBy fields are not read.
  // (A fresh floor: a still-PROPOSED request on the first one would deny the call before approval.)
  const h = await setup(t);
  const { apr } = await withPendingHigh(h.f, h.gov);
  for (const bad of [{ human: me }, 'x', 5, null, { ...fake, window: -1 }]) assert.equal(h.f.lapitaya.decide(apr.id, true, 'human', bad), null);
  assert.equal(h.f.lapitaya.listApprovals().find((x) => x.id === apr.id).status, 'pending');
  assert.equal(h.gov.decide(sender(), apr.id, false, fake, { rejectedBy: 'mallory', approvedBy: 'mallory' }).status, 'rejected');
  const rej = ledgerOf(h.f).find((e) => e.approvalId === apr.id && e.decision === 'HUMAN_REJECTED');
  assert.equal(rej.human.id, h.idn.svc.identity().id);
  assert.ok(!JSON.stringify(ledgerOf(h.f)).toLowerCase().includes('mallory'));
  // Not the human: only by === 'human' decides; an agent / Alicia / a script cannot.
  const r3 = request(f, 'Quiero que El Beni agregue pruebas al módulo.');
  for (const by of ['alicia', 'god', 'runtime', 'untrusted-sender', undefined, 'HUMAN']) {
    assert.equal(f.lapitaya.confirmRequest(r3.id, { by, token: r3.token, human: idn.svc.resolve(sender()) }).ok, false, String(by));
    assert.equal(f.lapitaya.cancelRequest(r3.id, by, idn.svc.resolve(sender())).ok, false, String(by));
  }
});

test('[ID-13][ID-14][ID-17][ID-18] replay, stale and second attempts cannot change ownership; the owner is immutable', async (t) => {
  const { f, idn, gov } = await setup(t);
  const me = idn.svc.identity();
  const p = request(f);
  assert.equal(gov.attributeSubmitted(sender({ webContentsId: 1 }), p.id), true);
  assert.equal(gov.attributeSubmitted(sender({ webContentsId: 2 }), p.id), false, 'requestedOwner is write-once');
  const token = p.token;
  assert.equal(gov.confirmRequest(sender({ webContentsId: 1 }), p.id, token).ok, true);
  const owner0 = JSON.stringify(f.lapitaya.listRequests().find((x) => x.id === p.id).confirmedOwner);
  // Replay of the consumed token, from another window: refused, ownership untouched.
  const replay = gov.confirmRequest(sender({ webContentsId: 2 }), p.id, token);
  assert.deepEqual([replay.ok, replay.code], [false, 'NOT_CONFIRMABLE']);
  const mid = f.lapitaya.listRequests().find((x) => x.id === p.id);
  assert.equal(JSON.stringify(mid.confirmedOwner), owner0);
  assert.equal(mid.confirmedOwner.window, 1, 'the second window did not take the decision');
  assert.equal(mid.requestedOwner.window, 1);
  // The refused attempt is evidence of the ATTEMPT, never a CONFIRMED record.
  const confirmedRecords = ledgerOf(f).filter((e) => e.kind === 'request' && e.proposalId === p.id && e.transition === 'CONFIRMED');
  assert.equal(confirmedRecords.length, 1);
  assert.equal(confirmedRecords[0].human.window, 1);
  // Cancel once; a second cancel and a late confirm cannot move the owner.
  assert.equal(gov.cancelRequest(sender({ webContentsId: 1 }), p.id).ok, true);
  assert.equal(gov.cancelRequest(sender({ webContentsId: 2 }), p.id).ok, false);
  assert.equal(gov.confirmRequest(sender({ webContentsId: 2 }), p.id, token).ok, false);
  const fin = f.lapitaya.listRequests().find((x) => x.id === p.id);
  assert.deepEqual([fin.status, fin.closedOwner.window, JSON.stringify(fin.confirmedOwner)], ['CANCELLED', 1, owner0]);
  // A stale proposal (re-validation blocks it) is never recorded as confirmed by anyone.
  const stale = request(f, 'Quiero que El Beni revise la API.');
  const sp = f.lapitaya.listRequests().find((x) => x.id === stale.id);
  const stored = JSON.parse(JSON.stringify(sp));
  assert.equal(gov.confirmRequest(sender(), 'prop-does-not-exist', 'x').code, 'UNKNOWN_PROPOSAL');
  assert.equal(gov.confirmRequest(sender(), stored.id, 'forged').code, 'TAMPERED');
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === stale.id).confirmedOwner, undefined);
  // HIGH: the second decision (same or other window, same or opposite outcome) is refused and the owner is immutable.
  const h = await setup(t);
  const { apr } = await withPendingHigh(h.f, h.gov);
  assert.equal(h.gov.decide(sender({ webContentsId: 1 }), apr.id, true).status, 'approved');
  const snap = JSON.stringify(h.f.lapitaya.listApprovals().find((x) => x.id === apr.id).decidedOwner);
  assert.equal(h.gov.decide(sender({ webContentsId: 2 }), apr.id, false), null, 'approve then reject');
  assert.equal(h.gov.decide(sender({ webContentsId: 2 }), apr.id, true), null, 'approve twice');
  const a = h.f.lapitaya.listApprovals().find((x) => x.id === apr.id);
  assert.deepEqual([a.status, JSON.stringify(a.decidedOwner)], ['approved', snap]);
  assert.equal(ledgerOf(h.f).filter((e) => e.approvalId === apr.id && /^HUMAN_/.test(e.decision) && e.decision !== 'HUMAN_APPROVAL_REQUIRED').length, 1, 'exactly one human decision record');
  assert.equal(h.gov.decide(sender(), 'apr-nope', true), null);
  assert.equal(h.gov.decide(sender(), 5, true), null);
  assert.equal(h.gov.decide(sender(), apr.id, 'yes'), null);
  assert.ok(me.id);
});

test('[ID-16] cross-window: one decision, one owner; the other window sees it resolved and cannot redo it', async (t) => {
  const { f, idn, gov } = await setup(t);
  const A = sender({ webContentsId: 11 }); const B = sender({ webContentsId: 12 });
  const p = request(f);
  // Both windows read the same pending REQUEST (the runtime is the single source).
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === p.id).status, 'PROPOSED');
  assert.equal(gov.confirmRequest(A, p.id, p.token).ok, true);
  // Window B, still holding the (stale) token, tries to confirm and to cancel-as-if-pending.
  assert.equal(gov.confirmRequest(B, p.id, p.token).code, 'NOT_CONFIRMABLE');
  const r = f.lapitaya.listRequests().find((x) => x.id === p.id);
  assert.deepEqual([r.status, r.confirmedOwner.window], ['CONFIRMED', 11]);
  // Same human, both windows: identical identity, different context.
  assert.equal(idn.svc.resolve(A).human.id, idn.svc.resolve(B).human.id);
  assert.notEqual(idn.svc.resolve(A).window, idn.svc.resolve(B).window);
  // HIGH: A decides while B's UI still shows it pending → B gets null; the runtime keeps A's decision.
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED');
  const apr = f.lapitaya.listApprovals()[0];
  const stale = project(f.lapitaya); // what B last read
  assert.equal(stale.pendingApprovals.length, 1);
  assert.equal(gov.decide(A, apr.id, false).status, 'rejected');
  assert.equal(gov.decide(B, apr.id, true), null);
  const after = project(f.lapitaya);
  assert.equal(after.pendingApprovals.length, 0);
  const ownerFact = after.byApproval[apr.id].timeline.find((o) => o.category === 'APPROVAL_REJECTED');
  assert.equal(ownerFact.decisionOwner.id, idn.svc.identity().id);
  assert.equal(f.lapitaya.listApprovals().find((x) => x.id === apr.id).decidedOwner.window, 11);
  // B's Decision Center, rebuilt from the runtime, shows it resolved with no controls.
  const reqCtl = C.createConfirmationController({ requests: async () => f.lapitaya.listRequests(), approvals: async () => [], confirm: async () => null, cancel: async () => null });
  await reqCtl.refresh();
  const apprCtl = D.createApprovalController({ decide: async () => null });
  const m = D.buildDecisionCenter(reqCtl.getSnapshot(), after, apprCtl.getSnapshot(), { id: idn.svc.identity().id, displayName: 'francisco' });
  assert.equal(m.counts.high, 0);
  assert.equal(m.history.find((o) => o.approvalId === apr.id && o.category === 'APPROVAL_REJECTED').decisionOwner.id, idn.svc.identity().id);
  assert.equal(m.identity.displayName, 'francisco');
});

// ─── identity is not authority ─────────────────────────────────────────────

test('[ID-19][ID-20][ID-21][ID-22] identity does not alter risk or autonomy and does not bypass CIMA, authorize() or the REQUEST gate', async (t) => {
  const { f, idn, gov } = await setup(t);
  // Having an identity, even resolving it, is not a confirmation: the gate still blocks.
  idn.svc.resolve(sender());
  f.companion.submit('Quiero que revisemos este proyecto.');
  const blocked = await attempt(f, 'god', TEST_CALL);
  assert.equal(blocked.denied, true);
  assert.match(blocked.reason, /^REQUEST_CONFIRMATION_REQUIRED/);
  // A confirmed REQUEST by the trusted human still does not approve a HIGH action.
  const p = f.lapitaya.listRequests().find((x) => x.status === 'PROPOSED');
  assert.equal(gov.confirmRequest(sender(), p.id, p.token).ok, true);
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED');
  const apr = f.lapitaya.listApprovals()[0];
  assert.deepEqual([apr.risk, apr.status], ['HIGH', 'pending'], 'risk is CIMA\'s, unchanged by who looks at it');
  // Approving as the trusted human still goes through authorize(): one execution, then it asks again.
  gov.decide(sender(), apr.id, true);
  assert.equal(f.lapitaya.listApprovals().find((x) => x.id === apr.id).risk, 'HIGH', 'approval does not edit the risk');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'APPROVED');
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED', 'one-shot: authorize() decides every time');
  // An untrusted sender is never a human: its confirm is refused by the existing gate (and recorded).
  const q = request(f, 'Quiero que Valentin revise los permisos.');
  const refused = gov.confirmRequest(sender({ ownWindow: false }), q.id, q.token);
  assert.deepEqual([refused.ok, refused.code], [false, 'NOT_AUTHORIZED']);
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === q.id).status, 'PROPOSED');
  assert.equal(gov.cancelRequest(sender({ ownWindow: false }), q.id).ok, false);
  assert.equal(gov.completeRequest(sender({ ownWindow: false }), q.id).ok, false);
  assert.equal(gov.decide(sender({ ownWindow: false }), apr.id, true), null);
  assert.equal(gov.attributeSubmitted(sender({ ownWindow: false }), q.id), false);
  // Structurally: identity code cannot reach a tool, the hive, the ledger or authorize().
  for (const file of ['src/shared/lapitaya/identity.ts', 'src/main/humanIdentity.ts']) {
    assert.doesNotMatch(code(read(file)), /authorize|executeTool|appendFile|writeFile|\.append\(|cima-ledger|classifyTool|completionGate|from '\.\/(hive|hooks|cimaRuntime)'/, file);
  }
  assert.doesNotMatch(code(read('src/main/humanGovernanceIpc.ts')), /authorize|executeTool|appendFile|writeFile|cima-ledger|classifyTool|completionGate/);
});

// ─── the IPC boundary ──────────────────────────────────────────────────────

test('[ID-02][IPC] the human channel never accepts identity from the renderer; lapitaya:approvals stays intact', () => {
  const preload = code(read('src/preload/index.ts'));
  const main = code(read('src/main/index.ts'));
  // The renderer-facing signatures are exactly the pre-v0.8 ones: no identity parameter anywhere.
  has(preload, /lapitayaConfirmRequest: \(id: string, token: string\)[^=]*=>\s*ipcRenderer\.invoke\('lapitaya:confirmRequest', id, token\)/, 'confirm signature');
  has(preload, /lapitayaCancelRequest: \(id: string\)[^=]*=> ipcRenderer\.invoke\('lapitaya:cancelRequest', id\)/, 'cancel signature');
  has(preload, /lapitayaDecide: \(id: string, approve: boolean\)[^=]*=>\s*ipcRenderer\.invoke\('lapitaya:decide', id, approve\)/, 'decide signature');
  has(preload, /lapitayaIdentity: \(\): Promise<[\s\S]*?> => ipcRenderer\.invoke\('lapitaya:identity'\)/, 'lapitayaIdentity is read-only and takes no arguments');
  // Main: every human handler takes the event and delegates; none takes an identity argument.
  for (const ch of ['confirmRequest', 'cancelRequest', 'completeRequest', 'decide']) {
    has(main, new RegExp(`ipcMain\\.handle\\('lapitaya:${ch}', \\(evt[,)]`), ch);
    has(main, new RegExp(`humanGov\\.${ch}\\(evt`), ch);
  }
  has(main, /ipcMain\.handle\('lapitaya:identity', \(evt\) => humanGov\.whoAmI\(evt\)\)/, 'identity handler');
  has(main, /if \(outcome\?\.type === 'REQUEST'\) humanGov\.attributeSubmitted\(evt, outcome\.proposalId\)/, 'attribution on submit');
  // Only main constructs the context; the renderer never sees the means to.
  const renderer = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) renderer.push(code(fs.readFileSync(p, 'utf8'))); } };
  walk(path.join(ROOT, 'src/renderer/src'));
  assert.ok(!/parseHumanContext|ownerOf\(|createHumanIdentityService|createHumanGovernanceHandlers|approvedBy|rejectedBy/.test(renderer.join('\n')), 'renderer cannot build or send an identity');
  // Every renderer call to a human channel passes exactly the documented arguments (no identity slot).
  const arity = { lapitayaConfirmRequest: 2, lapitayaCancelRequest: 1, lapitayaCompleteRequest: 1, lapitayaDecide: 2, lapitayaIdentity: 0 };
  let seen = 0;
  for (const m of renderer.join('\n').matchAll(/window\.cth\.(lapitaya(?:ConfirmRequest|CancelRequest|CompleteRequest|Decide|Identity))\(([^)]*)\)/g)) {
    const n = m[2].trim() ? m[2].split(',').length : 0;
    assert.equal(n, arity[m[1]], `${m[1]}(${m[2]}) must take ${arity[m[1]]} argument(s)`);
    seen += 1;
  }
  assert.ok(seen >= 4, 'the human channel call sites were found');
  // main's identity comes from the sender (webContents) and the persisted id, not from a message.
  has(main, /describeSender: \(evt\) =>/, 'describeSender');
  has(main, /BrowserWindow\.fromWebContents\(wc\)/, 'own window check');
  has(main, /e\.senderFrame === wc\.mainFrame/, 'main frame check');
  // v0.9: lapitaya:approvals and its preload bridge have been removed.
  assert.doesNotMatch(main, /ipcMain\.handle\('lapitaya:approvals'/, '#5 handler removed');
  assert.doesNotMatch(preload, /lapitayaApprovals:/, '#5 preload removed');
  // No second store: identity lives in the app config; decisions only in the existing ledger / state files.
  for (const file of ['src/main/humanIdentity.ts', 'src/main/humanGovernanceIpc.ts', 'src/shared/lapitaya/identity.ts']) {
    assert.doesNotMatch(read(file), /human-decisions|identity-ledger|approval-history|\.jsonl/, file);
  }
});

// ─── UI: es-MX / en-US / accessibility ─────────────────────────────────────

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
async function renderDecisionCenter(f, idn, { lng, identity = true, highAck = [] }) {
  const requests = C.createConfirmationController({ requests: async () => f.lapitaya.listRequests(), approvals: async () => [], confirm: async () => null, cancel: async () => null });
  await requests.refresh();
  const approvals = D.createApprovalController({ decide: async () => null });
  const view = project(f.lapitaya);
  const model = D.buildDecisionCenter(requests.getSnapshot(), view, approvals.getSnapshot(), identity ? { id: idn.svc.identity().id, displayName: idn.svc.identity().displayName } : null);
  const { t, missing } = strictT(lng); const noop = () => {};
  const html = renderToStaticMarkup(React.createElement(V.AliciaPanelView, {
    t, snapshot: requests.getSnapshot(), presence: null, acknowledged: new Set(), lines: [], draft: '', sending: false,
    onAcknowledge: noop, onConfirm: noop, onCancel: noop, onGoToProposal: noop, onDraft: noop, onSend: noop,
    observability: view, decisions: model, highAcknowledged: new Set(highAck),
    onAcknowledgeHigh: noop, onApproveHigh: noop, onRejectHigh: noop
  }));
  return { html, missing, model };
}

test('[ID-26][ID-27][ID-28] es-MX / en-US show who decided (no missing keys), and the identity UI adds no controls', async (t) => {
  const { f, idn, gov } = await setup(t);
  const p = request(f);
  gov.attributeSubmitted(sender(), p.id);
  gov.confirmRequest(sender(), p.id, p.token);
  await attempt(f, 'god', HIGH_CALL);
  const apr = f.lapitaya.listApprovals()[0];
  gov.decide(sender(), apr.id, true);
  const q = request(f, 'Quiero que Valentin revise los permisos.');
  gov.attributeSubmitted(sender(), q.id);
  gov.cancelRequest(sender(), q.id);
  const me = idn.svc.identity();
  const out = {};
  for (const lng of ['es-MX', 'en-US']) {
    const { html, missing } = await renderDecisionCenter(f, idn, { lng });
    out[lng] = html;
    assert.deepEqual(missing, [], `${lng}: no missing keys`);
    has(html, /data-field="acting-as"/, `${lng}: acting-as`);
    assert.ok(html.includes(`(${me.id})`) && html.includes('francisco'), `${lng}: the identity is shown`);
    has(html, /data-field="decision-owner"/, `${lng}: history shows who decided`);
    has(html, /data-field="requested-by"/, 'requested-by');
    has(html, /data-field="confirmed-by"/, 'confirmed-by');
    has(html, /data-field="closed-by"/, 'closed-by');
    assert.ok(!/ses-[a-z0-9]{8,}|"window"|rm -rf|\/srv\//.test(html), `${lng}: no session / window / command in the DOM`);
    assert.ok(!html.includes(p.token) && !html.includes(f.lapitaya.listApprovals()[0].fingerprint), `${lng}: no token / fingerprint`);
    // The agent identifiers keep their names; English identifiers stay ASCII.
    if (lng === 'en-US') assert.ok(!/[^\x00-\x7f]/.test(JSON.stringify(LOCALES['en-US'].alicia.decisions.owner)), 'en-US identifiers are ASCII');
  }
  has(out['es-MX'], /Decides como francisco/, 'es-MX acting-as');
  has(out['en-US'], /You are deciding as francisco/, 'en-US acting-as');
  // Identical key sets between the catalogs.
  assert.deepEqual(Object.keys(LOCALES['es-MX'].alicia.decisions.owner).sort(), Object.keys(LOCALES['en-US'].alicia.decisions.owner).sort());
  // Unresolved identity is said plainly, in both languages.
  for (const lng of ['es-MX', 'en-US']) {
    const { html, missing } = await renderDecisionCenter(f, idn, { lng, identity: false });
    assert.deepEqual(missing, []);
    has(html, /data-field="acting-as"/, `${lng}: acting-as`);
    assert.ok(!/hum-[a-z0-9]{12}/.test(html.slice(html.indexOf('data-field="acting-as"'), html.indexOf('data-field="distinction"'))), `${lng}: no identity is claimed when none was resolved`);
  }
  // Accessibility: identity/owner lines are plain text in the existing structure — no new
  // interactive element, no shortcut, no color-only meaning (the owner is words, not a badge).
  const interactive = (h) => (h.match(/<(button|input|select|textarea|a)\b/g) ?? []).length;
  const withId = await renderDecisionCenter(f, idn, { lng: 'es-MX', identity: true });
  const withoutId = await renderDecisionCenter(f, idn, { lng: 'es-MX', identity: false });
  assert.equal(interactive(withId.html), interactive(withoutId.html), 'identity adds no controls');
  assert.ok(!/accesskey|tabindex="[1-9]/.test(withId.html), 'no shortcuts');
  has(withId.html, /<p data-field="acting-as"/, 'acting-as is plain text');
  // Confirm and Approve stay distinct, deliberate controls (v0.7 contract) while an owner is shown.
  assert.ok(!/data-action="approve-high"[^>]*autofocus/.test(withId.html), 'no destructive default focus');
});

test('[ID-18] the runtime state files are the only store: the ledger carries the owner and no second store appears', async (t) => {
  const { f, gov } = await setup(t);
  const p = request(f);
  gov.confirmRequest(sender(), p.id, p.token);
  const dir = path.join(f.hive.root(), 'lapitaya');
  const files = fs.readdirSync(dir).sort();
  assert.ok(files.includes('cima-ledger.jsonl'));
  assert.ok(!files.some((n) => /human|identity|decision-history|approval-history/i.test(n)), `unexpected store: ${files.join(',')}`);
});
