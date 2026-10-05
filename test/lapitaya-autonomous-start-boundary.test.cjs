'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { AutonomousOperationsService, computeEnvelopeHash } = loadTs('src/main/autonomousOperations.ts');
const { CompanyOperationsService } = loadTs('src/main/companyOperations.ts');
const { CompanyAwarenessService } = loadTs('src/main/companyAwareness.ts');

let clock = 7_000_000_000_000;

function fixture({ cima = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lapitaya-start8-'));
  const awareness = new CompanyAwarenessService({ now: () => ++clock });
  const autonomy = new AutonomousOperationsService({ now: () => ++clock, storageFile: path.join(root, 'autonomy.json') });
  const ops = new CompanyOperationsService({
    now: () => ++clock,
    snapshot: () => awareness.snapshot(),
    storageFile: path.join(root, 'projects.json'),
    autonomyService: autonomy,
    cimaAutonomousStart: () => cima ? { allowed: true, reason: 'CIMA PASS' } : { allowed: false, reason: 'CIMA DENY' }
  });
  const project = ops.createProject({ projectId: 'project-a', name: 'A', objective: 'Build A' });
  const mission = ops.createMission({ missionId: 'mission-a', projectId: project.projectId, title: 'M1', objective: 'Build A' });
  ops.confirmMission(mission.missionId, 'el-inge');
  const base = {
    projectId: project.projectId, missionId: mission.missionId, objective: mission.objective,
    riskCeiling: 'LOW', budget: { maxIterations: 2, maxRetries: 1, maxDurationMs: 60_000 },
    allowedCapabilities: ['READ_WORKSPACE'], allowedSkills: ['inspect'], allowedPaths: ['src/'],
    allowedActions: ['inspect'], stopConditions: ['done'], escalationConditions: ['blocked'], expiresAt: null,
    evidenceRefs: ['start8:test'], provenance: 'HUMAN', authorizedBy: 'human:real'
  };
  const envelope = autonomy.createEnvelope(base);
  return { root, awareness, autonomy, ops, project, mission, envelope, base };
}

function close(f) { fs.rmSync(f.root, { recursive: true, force: true }); }
function start(f, extra = {}) {
  return f.ops.requestAutonomousOperationStart({
    envelopeId: f.envelope.envelopeId, projectId: f.project.projectId, missionId: f.mission.missionId,
    requestedBy: 'el-inge', requiredCapabilities: ['READ_WORKSPACE'], requestedSkills: ['inspect'], requestedPaths: ['src/'],
    idempotencyKey: 'start8-a', ...extra
  });
}

test('START8-01: El Inge starts one valid LOW operation through CIMA', () => { const f = fixture(); try { const r = start(f); assert.equal(r.ok, true); assert.equal(r.operation.status, 'ACTIVE'); } finally { close(f); } });
test('START8-02: PENDING_AUTHORIZATION envelope is rejected', () => { const f = fixture(); try { const p = f.autonomy.proposeEnvelope(f.base); assert.equal(start({ ...f, envelope: p }).ok, false); } finally { close(f); } });
test('START8-03: REJECTED envelope is rejected', () => { const f = fixture(); try { const p = f.autonomy.proposeEnvelope(f.base); f.autonomy.rejectEnvelope(p.envelopeId, 'hum-real'); assert.equal(start({ ...f, envelope: p }).ok, false); } finally { close(f); } });
test('START8-04: CANCELLED envelope is rejected', () => { const f = fixture(); try { const env = f.autonomy.getEnvelope(f.envelope.envelopeId); env.status = 'CANCELLED'; env.integrityHash = computeEnvelopeHash(env); assert.equal(start(f).ok, false); } finally { close(f); } });
test('START8-05: EXPIRED envelope is rejected', () => { const f = fixture(); try { const p = f.autonomy.createEnvelope({ ...f.base, envelopeId: undefined, expiresAt: clock - 1 }); assert.equal(start({ ...f, envelope: p }).ok, false); } finally { close(f); } });
test('START8-06: exhausted budget cannot start a second operation', () => { const f = fixture(); try { const first = start(f); assert.equal(first.ok, true); assert.equal(f.autonomy.consumeIteration(first.operation.operationId), true); assert.equal(start(f, { idempotencyKey: 'start8-b' }).ok, false); } finally { close(f); } });
test('START8-07: invalid authorization binding fails closed', () => { const f = fixture(); try { f.envelope.authorizationBinding = 'tampered'; assert.equal(start(f).ok, false); } finally { close(f); } });
test('START8-08: wrong project is rejected', () => { const f = fixture(); try { assert.equal(start(f, { projectId: 'project-b' }).ok, false); } finally { close(f); } });
test('START8-09: wrong mission is rejected', () => { const f = fixture(); try { assert.equal(start(f, { missionId: 'mission-b' }).ok, false); } finally { close(f); } });
test('START8-10: risk above LOW ceiling is rejected', () => { const f = fixture(); try { assert.equal(start(f, { requestedRisk: 'MEDIUM' }).ok, false); } finally { close(f); } });
test('START8-11: capability outside envelope is rejected', () => { const f = fixture(); try { assert.equal(start(f, { requiredCapabilities: ['WRITE_FILE'] }).ok, false); } finally { close(f); } });
test('START8-12: skill outside envelope is rejected', () => { const f = fixture(); try { assert.equal(start(f, { requestedSkills: ['deploy'] }).ok, false); } finally { close(f); } });
test('START8-13: path outside envelope is rejected', () => { const f = fixture(); try { assert.equal(start(f, { requestedPaths: ['secrets/'] }).ok, false); } finally { close(f); } });
test('START8-14: CIMA denial prevents operation creation', () => { const f = fixture({ cima: false }); try { const r = start(f); assert.equal(r.ok, false); assert.equal(f.autonomy.listOperations().length, 0); } finally { close(f); } });
test('START8-15: HIGH cannot use a LOW envelope as blanket approval', () => { const f = fixture(); try { assert.equal(start(f, { requestedRisk: 'HIGH' }).ok, false); } finally { close(f); } });
test('START8-16: same idempotency key returns one operation', () => { const f = fixture(); try { const a = start(f); const b = start(f); assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(a.operation.operationId, b.operation.operationId); assert.equal(f.autonomy.listOperations().length, 1); } finally { close(f); } });
test('START8-17: requester is El Inge, not the human authority', () => { const f = fixture(); try { const r = start(f); assert.equal(r.ok, true); assert.equal(f.envelope.authorizedBy, 'human:real'); } finally { close(f); } });
test('START8-18: Alicia/status path is not used as a mutator', () => { const f = fixture(); try { const before = f.autonomy.listOperations().length; const snapshot = f.autonomy.snapshot(); assert.equal(snapshot.operations.length, 0); assert.equal(f.autonomy.listOperations().length, before); } finally { close(f); } });
test('START8-19: ACTIVE envelope alone does not activate Awake', () => { const f = fixture(); try { assert.equal(f.autonomy.snapshot().executionAwake, false); } finally { close(f); } });
test('START8-20: renderer has no direct operation-start authority channel', () => { const source = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8'); assert.doesNotMatch(source, /ipcMain\.handle\(['"]autonomy:(start|create|activate)/); });
test('START8-21: restart with ACTIVE envelope does not auto-start', () => { const f = fixture(); try { const fresh = new AutonomousOperationsService({ storageFile: path.join(f.root, 'autonomy.json') }); assert.equal(fresh.listOperations().length, 0); } finally { close(f); } });
test('START8-22: persisted operation is not duplicated after restart', () => { const f = fixture(); try { const a = start(f); const fresh = new AutonomousOperationsService({ storageFile: path.join(f.root, 'autonomy.json') }); assert.equal(fresh.listOperations().length, 1); assert.equal(fresh.getOperation(a.operation.operationId).operationId, a.operation.operationId); } finally { close(f); } });
test('START8-23: start preserves human authorization attribution', () => { const f = fixture(); try { start(f); assert.equal(f.autonomy.getEnvelope(f.envelope.envelopeId).authorizedBy, 'human:real'); } finally { close(f); } });
test('START8-24: start does not mutate envelope scope or budget', () => { const f = fixture(); try { const before = JSON.stringify(f.autonomy.getEnvelope(f.envelope.envelopeId)); start(f); assert.equal(JSON.stringify(f.autonomy.getEnvelope(f.envelope.envelopeId)), before); } finally { close(f); } });
test('START8-25: production boundary is owned by CompanyOperations', () => { const source = fs.readFileSync(path.resolve(__dirname, '../src/main/companyOperations.ts'), 'utf8'); assert.match(source, /requestAutonomousOperationStart/); assert.match(source, /cimaAutonomousStart/); });
test('START8-26: El Inge mission confirmation is the production start caller', () => {
  const f = fixture();
  try {
    const mission = f.ops.createMission({ missionId: 'mission-confirm', projectId: f.project.projectId, title: 'M2', objective: 'Build M2' });
    f.autonomy.createEnvelope({ ...f.base, envelopeId: undefined, missionId: mission.missionId, objective: mission.objective });
    f.ops.confirmMission(mission.missionId, 'el-inge');
    assert.equal(f.autonomy.listOperations().length, 1);
    assert.equal(f.autonomy.listOperations()[0].missionId, mission.missionId);
  } finally { close(f); }
});

test('START8-27: human-confirmed REQUEST binds the active envelope and starts once', () => {
  const f = fixture();
  try {
    const objective = f.base.objective;
    const requestId = 'request-start8-bootstrap';
    f.ops.observe([
      { type: 'request.proposed', ref: requestId, subject: objective, ts: ++clock },
      { type: 'request.confirmed', ref: requestId, subject: objective, taskId: 'task-start8-bootstrap', ts: ++clock }
    ]);
    const request = f.ops.projection().requests.find((item) => item.requestId === requestId);
    assert.equal(request.projectId, f.base.projectId);
    assert.equal(request.missionId, f.base.missionId);
    assert.equal(f.ops.getMission(f.base.missionId).workRequestIds.includes(requestId), true);
    assert.equal(f.autonomy.listOperations().length, 1);
    assert.equal(f.autonomy.listOperations()[0].missionId, f.base.missionId);

    f.ops.observe([{ type: 'request.confirmed', ref: requestId, subject: objective, taskId: 'task-start8-bootstrap', ts: ++clock }]);
    assert.equal(f.autonomy.listOperations().length, 1);
  } finally { close(f); }
});

test('START8-28: natural REQUEST framing may wrap the exact authorized objective', () => {
  const f = fixture();
  try {
    const requestId = 'request-start8-natural-framing';
    const message = 'Quiero que El Inge prepare una propuesta para validar: Build A.';
    f.ops.observe([
      { type: 'request.proposed', ref: requestId, subject: message, ts: ++clock },
      { type: 'request.confirmed', ref: requestId, subject: message, taskId: 'task-start8-natural', ts: ++clock }
    ]);
    assert.equal(f.autonomy.listOperations().length, 1);
    assert.equal(f.autonomy.listOperations()[0].missionId, f.base.missionId);
  } finally { close(f); }
});
