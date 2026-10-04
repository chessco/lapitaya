'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { AutonomousOperationsService, computeEnvelopeAuthorizationBinding } = loadTs('src/main/autonomousOperations.ts');
const { createHumanGovernanceHandlers } = loadTs('src/main/humanGovernanceIpc.ts');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapitaya-f81-auth-'));
  const service = new AutonomousOperationsService({ storageFile: path.join(dir, 'autonomy.json') });
  const identity = {
    resolve: (evt) => evt === 'trusted' ? { human: { id: 'hum-real', displayName: 'Real Human' }, session: 'ses-1', window: 1 } : null,
    identity: () => ({ id: 'hum-real', displayName: 'Real Human' })
  };
  const runtime = { decide: () => null, confirmRequest: () => null, cancelRequest: () => null, completeRequest: () => null, attributeRequest: () => false };
  const handlers = createHumanGovernanceHandlers({ runtime, autonomy: service, identity });
  return { dir, service, handlers };
}

function proposal(service) {
  return service.proposeEnvelope({
    projectId: 'LP-F8-ACC-PROJECT', missionId: 'LP-F8-ACC-M1', objective: 'bounded acceptance work',
    riskCeiling: 'LOW', budget: { maxIterations: 3, maxRetries: 1 },
    allowedCapabilities: ['read', 'test'], allowedSkills: ['TargetedTestRunner'], allowedPaths: ['acceptance/'],
    stopConditions: ['budget-exhausted'], escalationConditions: ['scope-expansion']
  });
}

test('AUTH8-01/02: missing provenance cannot create a human-active envelope', () => {
  const f = fixture();
  try {
    const env = f.service.createEnvelope({ projectId: 'p', missionId: 'm', objective: 'x', budget: { maxIterations: 1, maxRetries: 0 } });
    assert.equal(env, null);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('AUTH8-03/04: renderer identity and authorizedBy payload are ignored by trusted boundary', () => {
  const f = fixture();
  try {
    const env = proposal(f.service);
    assert.equal(f.handlers.decide('untrusted', env.envelopeId, true), null);
    assert.equal(f.service.getEnvelope(env.envelopeId).status, 'PENDING_AUTHORIZATION');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('AUTH8-05..08: no agent role can approve an envelope through the human handler', () => {
  const f = fixture();
  try {
    const env = proposal(f.service);
    assert.equal(f.handlers.decide({ from: 'el-inge', authorizedBy: 'human' }, env.envelopeId, true), null);
    assert.equal(f.service.getEnvelope(env.envelopeId).status, 'PENDING_AUTHORIZATION');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('AUTH8-09/11/12/13: trusted human approval is attributable and bound to exact scope', () => {
  const f = fixture();
  try {
    const env = proposal(f.service);
    const result = f.handlers.decide('trusted', env.envelopeId, true);
    const active = f.service.getEnvelope(env.envelopeId);
    assert.equal(result.status, 'ACTIVE');
    assert.equal(active.authorizedBy, 'hum-real');
    assert.equal(active.authorizedHumanDisplayName, 'Real Human');
    assert.ok(active.authorizedAt);
    assert.ok(active.decisionId);
    assert.equal(active.authorizationBinding, computeEnvelopeAuthorizationBinding(env));
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('AUTH8-10: trusted human rejection is terminal and not executable', () => {
  const f = fixture();
  try {
    const env = proposal(f.service);
    const result = f.handlers.decide('trusted', env.envelopeId, false);
    assert.equal(result.status, 'REJECTED');
    assert.equal(f.service.getEnvelope(env.envelopeId).status, 'REJECTED');
    assert.equal(f.service.startOperation({ envelopeId: env.envelopeId, projectId: env.projectId, missionId: env.missionId }), null);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('AUTH8-14/15: approved envelope binds exact scope and does not grant HIGH blanket authority', () => {
  const f = fixture();
  try {
    const env = proposal(f.service);
    f.handlers.decide('trusted', env.envelopeId, true);
    const active = f.service.getEnvelope(env.envelopeId);
    active.objective = 'tampered';
    assert.notEqual(computeEnvelopeAuthorizationBinding(active), active.authorizationBinding);
    const op = f.service.startOperation({ envelopeId: env.envelopeId, projectId: env.projectId, missionId: env.missionId });
    assert.equal(op, null);
    assert.equal(f.service.getEnvelope(env.envelopeId).status, 'FAILED');
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test('UIAUTH8-01..10: UI presents bounded proposal and reuses existing human decision channel', () => {
  const preload = fs.readFileSync('src/preload/index.ts', 'utf8');
  const panel = fs.readFileSync('src/renderer/src/components/alicia/AliciaPanelView.tsx', 'utf8');
  assert.match(panel, /PENDING_AUTHORIZATION/);
  assert.match(panel, /AUTHORIZE/);
  assert.match(panel, /REJECT/);
  assert.match(panel, /maxIterations|Iterations/);
  assert.match(panel, /allowedCapabilities|Capabilities/);
  assert.match(panel, /allowedSkills|Skills/);
  assert.match(panel, /allowedPaths|Scope/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\(['"]autonomy:/);
  assert.match(preload, /lapitaya:decide/);
});
