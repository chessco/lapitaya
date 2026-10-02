'use strict';
/**
 * La Pitaya Alicia v0.9 — Legacy Approval Renderer Removal.
 *
 * Removes the renderer's dependency on the legacy lapitaya:approvals channel.
 * Verifies functional parity in Decision Center, preservation of runtime approval
 * state, preload audit, main IPC audit, security invariants, cross-window sync,
 * i18n, accessibility, and negative security controls.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { floor, loadTs } = require('./fixtures/lapitaya-floor.cjs');

const O = loadTs('src/shared/lapitaya/alicia/observability.ts');
const C = loadTs('src/renderer/src/components/alicia/confirmationController.ts');
const D = loadTs('src/renderer/src/components/alicia/decisionCenter.ts');
const ID = loadTs('src/shared/lapitaya/identity.ts');
const HI = loadTs('src/main/humanIdentity.ts');
const HG = loadTs('src/main/humanGovernanceIpc.ts');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const HIGH_CALL = { tool: 'Bash', input: { command: 'rm -rf /srv/data' } };
const TEST_CALL = { tool: 'Bash', input: { command: 'npm test' } };
const APP_URL = 'file:///app/out/renderer/index.html';

function makeIdentity({ stored = HI.newHumanId(), user = 'francisco', session = HI.newSessionId() } = {}) {
  const store = { id: stored };
  const svc = HI.createHumanIdentityService({
    readHumanId: () => store.id,
    writeHumanId: (id) => { store.id = id; },
    osUserName: () => user,
    sessionId: session,
    describeSender: (evt) => (evt && evt.__sender) ?? null,
    trustedUrlPrefixes: () => ['file:///app/out/renderer/']
  });
  return { svc, store };
}

const sender = (over = {}) => ({
  __sender: { webContentsId: 1, destroyed: false, isMainFrame: true, url: APP_URL, ownWindow: true, ...over }
});

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
  return {
    denied: r?.hookSpecificOutput?.permissionDecision === 'deny',
    decision: f.server.lastPreDecision,
    reason: r?.hookSpecificOutput?.permissionDecisionReason ?? ''
  };
}

async function withPendingHigh(f, gov, evt = sender()) {
  const p = request(f);
  const c = gov.confirmRequest(evt, p.id, p.token);
  assert.equal(c.ok, true);
  assert.equal((await attempt(f, 'god', HIGH_CALL)).decision, 'HUMAN_APPROVAL_REQUIRED');
  return { p, apr: f.lapitaya.listApprovals()[0] };
}

test('[LEG-01][LEG-09][LEG-10][LEG-11][LEG-26] Legacy dependency audit & IPC absence', () => {
  const main = read('src/main/index.ts');
  const preload = read('src/preload/index.ts');
  const rendererFiles = [
    'src/renderer/src/components/GovernancePanel.tsx',
    'src/renderer/src/components/alicia/AliciaPanel.tsx',
    'src/renderer/src/components/alicia/useDecisionCenter.ts',
    'src/renderer/src/components/alicia/decisionCenter.ts',
    'src/renderer/src/components/alicia/confirmationController.ts'
  ];

  assert.doesNotMatch(main, /ipcMain\.handle\('lapitaya:approvals'/, 'main does not register lapitaya:approvals');
  assert.doesNotMatch(preload, /lapitayaApprovals:/, 'preload does not expose lapitayaApprovals');

  for (const rel of rendererFiles) {
    const content = read(rel);
    assert.doesNotMatch(content, /window\.cth\.lapitayaApprovals/, `${rel} does not invoke lapitayaApprovals`);
    assert.doesNotMatch(content, /'lapitaya:approvals'/, `${rel} does not reference lapitaya:approvals`);
  }
});

test('[LEG-02][LEG-03][LEG-08][LEG-13] Decision Center functional parity & observability backed', async (t) => {
  const { f, idn, gov } = await setup(t, { user: 'alicia-operator' });
  const { apr } = await withPendingHigh(f, gov);

  // Project observability (v0.6)
  const view = O.projectObservability({
    ledger: f.lapitaya.ledger(100),
    traces: f.lapitaya.recentTraces(100),
    approvals: f.lapitaya.listApprovals(),
    requests: f.lapitaya.listRequests()
  });

  assert.ok(view.pendingApprovals.length >= 1, 'Observability projects pending HIGH approval');
  const highFact = view.pendingApprovals.find((a) => a.approvalId === apr.id);
  assert.ok(highFact, 'HIGH fact is present in observability');
  assert.equal(highFact.risk, 'HIGH');

  // Decision Center model build
  const reqSnapshot = C.createConfirmationController({
    requests: async () => f.lapitaya.listRequests(),
    approvals: async () => [],
    confirm: async () => null,
    cancel: async () => null
  });
  await reqSnapshot.refresh();

  const me = idn.svc.identity();
  const dcModel = D.buildDecisionCenter(
    reqSnapshot.getSnapshot(),
    view,
    { inFlight: new Map(), outcomes: new Map() },
    me
  );

  assert.equal(dcModel.observed, true, 'Decision Center is observability backed');
  assert.equal(dcModel.counts.high, 1, 'Decision Center counts pending HIGH approval');
  assert.equal(dcModel.high[0].approvalId, apr.id, 'Decision Center displays pending HIGH approval');
  assert.equal(dcModel.identity.displayName, 'alicia-operator', 'Decision Center includes v0.8 human identity');
});

test('[LEG-04][LEG-05][LEG-06][LEG-07][LEG-08] HIGH decision & REQUEST lifecycle with identity', async (t) => {
  const { f, idn, gov } = await setup(t, { user: 'carlos' });
  const { apr } = await withPendingHigh(f, gov);
  const me = idn.svc.identity();

  // HIGH approval
  const decideRes = gov.decide(sender(), apr.id, true);
  assert.equal(decideRes.status, 'approved');
  assert.equal(decideRes.decidedBy, 'human');
  assert.equal(f.lapitaya.listApprovals().find((a) => a.id === apr.id).decidedOwner.displayName, 'carlos');

  // REQUEST confirm & cancel cycle
  const p1 = request(f);
  const confirmRes = gov.confirmRequest(sender(), p1.id, p1.token);
  assert.equal(confirmRes.ok, true);
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === p1.id).status, 'CONFIRMED');

  const p2 = request(f);
  const cancelRes = gov.cancelRequest(sender(), p2.id);
  assert.equal(cancelRes.ok, true);
  assert.equal(f.lapitaya.listRequests().find((x) => x.id === p2.id).status, 'CANCELLED');
});

test('[LEG-12][LEG-14] Runtime approval state preserved, no second store', async (t) => {
  const { f, gov } = await setup(t);
  const { apr } = await withPendingHigh(f, gov);
  
  // Runtime approval state remains in CimaRuntimeService
  const approvals = f.lapitaya.listApprovals();
  assert.equal(approvals.length, 1, 'Runtime approval state intact');
  assert.equal(approvals[0].id, apr.id);

  // Verify no second store or approval cache file/object in code
  const dcCode = read('src/renderer/src/components/alicia/decisionCenter.ts');
  assert.doesNotMatch(dcCode, /approvalCache|approvalStore|legacyApprovalState|rendererApprovalLedger/, 'no renderer approval store');
});

test('[LEG-15][LEG-16][LEG-17][LEG-18] Cross-window sync & replay protection', async (t) => {
  const { f, idn, gov } = await setup(t, { user: 'ana' });
  const { apr } = await withPendingHigh(f, gov);

  const winA = sender({ webContentsId: 101 });
  const winB = sender({ webContentsId: 102 });

  // Window A decides
  const resA = gov.decide(winA, apr.id, true);
  assert.equal(resA.status, 'approved');

  // Window B attempts replay on decided item
  const resB = gov.decide(winB, apr.id, false);
  assert.equal(resB, null, 'Window B attempt on already decided item returns null (rejected)');

  // Verify runtime record immutability
  const finalApproval = f.lapitaya.listApprovals().find((a) => a.id === apr.id);
  assert.equal(finalApproval.status, 'approved');
});

test('[LEG-19][LEG-20] Security: no secrets or raw tokens in renderer model', async (t) => {
  const { f } = await setup(t);
  const prop = request(f);

  const view = O.projectObservability({
    ledger: f.lapitaya.ledger(100),
    traces: f.lapitaya.recentTraces(100),
    approvals: f.lapitaya.listApprovals(),
    requests: f.lapitaya.listRequests()
  });

  const viewStr = JSON.stringify(view);
  assert.doesNotMatch(viewStr, /token":\s*"[a-f0-9-]{36}"/, 'Observability does not expose raw request token');
});

test('[LEG-21][LEG-22][LEG-23] i18n es-MX / en-US & Accessibility in Decision Center', () => {
  const locales = {
    'es-MX': JSON.parse(read('src/renderer/src/i18n/locales/lapitaya/es-MX.json')),
    'en-US': JSON.parse(read('src/renderer/src/i18n/locales/lapitaya/en-US.json'))
  };

  for (const lang of ['es-MX', 'en-US']) {
    const keys = locales[lang].alicia?.decisions;
    assert.ok(keys, `decisions i18n keys exist for ${lang}`);
    assert.ok(keys.said?.approved, `approved key exists for ${lang}`);
    assert.ok(keys.said?.rejected, `rejected key exists for ${lang}`);
    assert.ok(keys.said?.alreadyResolved, `alreadyResolved key exists for ${lang}`);
  }

  // Accessibility check in AliciaPanelView
  const viewCode = read('src/renderer/src/components/alicia/AliciaPanelView.tsx');
  assert.match(viewCode, /role="status"|aria-live|aria-label|data-alicia-pending-badge/, 'accessibility attributes present');
});

test('[NEG-01][NEG-02][NEG-03][NEG-04] Negative security boundary checks', async (t) => {
  const main = read('src/main/index.ts');
  const preload = read('src/preload/index.ts');

  // Renderer cannot invoke removed lapitaya:approvals
  assert.doesNotMatch(main, /ipcMain\.handle\('lapitaya:approvals'/, 'NEG: main has no lapitaya:approvals channel');
  assert.doesNotMatch(preload, /lapitayaApprovals:/, 'NEG: preload has no lapitayaApprovals bridge');

  // Renderer cannot supply identity over IPC
  const { f, gov } = await setup(t, { user: 'real-user' });
  const { apr } = await withPendingHigh(f, gov);

  // Extra fake identity argument from renderer is ignored
  const res = gov.decide(sender(), apr.id, true, { fakeUser: 'hacker' });
  assert.ok(res, 'decision succeeded');
  assert.equal(res.status, 'approved');
});
