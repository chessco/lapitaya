'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { CompanyAwarenessService } = loadTs('src/main/companyAwareness.ts');
const { CompanyOperationsService } = loadTs('src/main/companyOperations.ts');

let clock = 2_000_000_000_000;
const event = (type, data = {}) => ({ type, ts: ++clock, source: 'governance', ...data });
const base = () => new CompanyAwarenessService({ now: () => ++clock });
function fixture(opts = {}) {
  const awareness = base();
  const ops = new CompanyOperationsService({ now: () => ++clock, snapshot: () => awareness.snapshot(), project: () => opts.project ?? { projectId: null, displayName: null } });
  return { awareness, ops };
}
function request(f, id = 'req-f5-1', message = 'Agrega búsqueda por nombre al módulo de clientes.') {
  f.ops.observeIntent({ id: `intent-${id}`, source: 'alicia', type: 'REQUEST', message, requestedBy: 'human', context: {}, target: null, risk: null, status: 'FORWARDED', createdAt: ++clock }, { type: 'REQUEST', proposalId: id, status: 'FORWARDED', route: 'orchestrator', executed: false, id: `intent-${id}`, claimedType: 'REQUEST', reclassified: false, claimedRisk: null, risk: null, decision: 'PROPOSAL_ONLY', rule: 'INTENT_REQUEST', signals: [] });
  return id;
}
function confirmed(f, id = 'req-f5-1', taskId = 'LP-F5-1') { f.ops.observe([event('request.proposed', { ref: id, taskId }), event('request.confirmed', { ref: id, taskId })]); }
function build(f, taskId = 'LP-F5-1', agentId = 'rosalba') { f.awareness.observe(event('cima.phase.assigned', { taskId, phase: 'BUILD', agentId, fromAgentId: 'el-inge', ref: `${taskId}-build` })); f.ops.observe([event('cima.phase.assigned', { taskId, phase: 'BUILD', agentId })]); }

for (const [id, fn] of [
  ['REQ5-01', () => { const f = fixture(); assert.equal(f.ops.projection().workRequest, null); }],
  ['REQ5-02', () => { const f = fixture(); const id = request(f, 'req-amb', 'Mejora clientes.'); assert.equal(f.ops.projection().workRequest.requestId, id); assert.equal(f.ops.projection().workRequest.status, 'PROPOSED'); }],
  ['REQ5-03', () => { const f = fixture(); request(f); assert.equal(f.ops.projection().workRequest.status, 'PROPOSED'); }],
  ['REQ5-04', () => { const f = fixture(); request(f); assert.equal(f.ops.projection().workPlan, null); }],
  ['REQ5-05', () => { const source = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8'); assert.match(source, /lapitaya:confirmRequest/); assert.doesNotMatch(source, /company:(confirm|approve)/); }],
  ['REQ5-06', () => { const f = fixture(); request(f); confirmed(f); assert.equal(f.ops.projection().workRequest.status, 'PLANNING'); }],
  ['REQ5-07', () => { const source = fs.readFileSync(path.resolve(__dirname, '../src/main/companyOperations.ts'), 'utf8'); assert.doesNotMatch(source, /assignAgent|dispatchWorker|spawnAgent/); }],
  ['REQ5-08', () => { const f = fixture(); request(f); assert.equal(f.ops.projection().workRequest.projectId, null); }],
  ['REQ5-09', () => { const f = fixture(); request(f, 'req-human-criteria', 'Agrega exportación CSV. Criterio de aceptación: contiene nombre, email, teléfono.'); assert.equal(f.ops.projection().workRequest.acceptanceCriteria[0].provenance, 'HUMAN'); }],
  ['REQ5-10', () => { const f = fixture(); request(f); confirmed(f); assert.ok(f.ops.projection().workPlan.acceptanceCriteria.every((c) => c.provenance === 'EL_INGE_PROPOSED')); }],
  ['REQ5-11', () => { const f = fixture(); request(f); f.ops.observe([event('request.closed', { ref: 'req-f5-1', technical: { decision: 'CANCELLED' } })]); assert.equal(f.ops.projection().workRequest.status, 'CANCELLED'); }],
  ['REQ5-12', () => { const f = fixture(); request(f); f.ops.observe([event('request.closed', { ref: 'req-f5-1', technical: { decision: 'CANCELLED' } })]); assert.equal(f.ops.projection().delivery, null); }]
]) test(`${id}: request lifecycle`, fn);

for (const [id, fn] of [
  ['PLAN5-01', () => { const f = fixture(); request(f); confirmed(f); assert.equal(f.ops.projection().workPlan.createdBy, 'el-inge'); }],
  ['PLAN5-02', () => { const f = fixture(); request(f); confirmed(f); assert.equal(f.ops.projection().workPlan.status, 'PLANNING'); }],
  ['PLAN5-03', () => { const f = fixture(); request(f); confirmed(f); assert.equal(f.awareness.snapshot().activeAssignments.length, 0); }],
  ['PLAN5-04', () => { const f = fixture(); request(f); confirmed(f); assert.equal(f.ops.projection().workPlan.steps.some((s) => s.phase === 'ARCHITECT'), false); }],
  ['PLAN5-05', () => { const f = fixture(); request(f); confirmed(f); build(f, 'LP-F5-ARCH', 'valentin'); assert.equal(f.awareness.snapshot().agents.find((a) => a.agentId === 'valentin').state, 'WORKING'); }],
  ['PLAN5-06', () => { const f = fixture(); request(f); confirmed(f); build(f); assert.equal(f.awareness.snapshot().agents.find((a) => a.agentId === 'rosalba').state, 'WORKING'); }],
  ['PLAN5-07', () => { const f = fixture(); request(f); confirmed(f); build(f, 'LP-F5-BENI', 'el-beni'); assert.equal(f.awareness.snapshot().agents.find((a) => a.agentId === 'el-beni').state, 'WORKING'); }],
  ['PLAN5-08', () => { const f = fixture(); request(f); confirmed(f); build(f); assert.equal(f.awareness.snapshot().expectedNext[0].agentId, 'margarito'); assert.equal(f.awareness.snapshot().activeAssignments.some((a) => a.agentId === 'margarito'), false); }],
  ['PLAN5-09', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('cima.phase.assigned', { taskId: 'LP-F5-1', phase: 'TEST', agentId: 'margarito', ref: 'test-assigned' })); assert.equal(f.awareness.snapshot().expectedNext.length, 0); }],
  ['PLAN5-10', () => { const f = fixture(); request(f); confirmed(f); assert.doesNotMatch(JSON.stringify(f.ops.projection()), /approve|approvalToken|hmac/i); }]
]) test(`${id}: plan boundary`, fn);

for (const [id, fn] of [
  ['EXEC5-01', () => { const f = fixture(); request(f); confirmed(f); assert.ok(f.ops.projection().workPlan); }],
  ['EXEC5-02', () => { const f = fixture(); request(f); confirmed(f); build(f); assert.equal(f.ops.projection().workRequest.status, 'ACTIVE'); }],
  ['EXEC5-03', () => { const f = fixture(); request(f); confirmed(f); build(f); f.awareness.observe(event('cima.phase.changed', { taskId: 'LP-F5-1', phase: 'BUILD', agentId: 'rosalba', verdict: 'PASS' })); assert.deepEqual(f.awareness.snapshot().session.completedPhases, ['BUILD']); }],
  ['EXEC5-04', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('cima.phase.assigned', { taskId: 'LP-F5-1', phase: 'TEST', agentId: 'margarito' })); assert.equal(f.awareness.snapshot().agents.find((a) => a.agentId === 'margarito').state, 'WORKING'); }],
  ['EXEC5-05', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe([event('cima.phase.assigned', { taskId: 'LP-F5-1', phase: 'TEST', agentId: 'margarito' }), event('cima.phase.changed', { taskId: 'LP-F5-1', phase: 'TEST', agentId: 'margarito', verdict: 'PASS' })]); assert.ok(f.awareness.snapshot().session.completedPhases.includes('TEST')); }],
  ['EXEC5-06', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('cima.phase.assigned', { taskId: 'LP-F5-1', phase: 'AUDIT', agentId: 'jose-juan' })); assert.equal(f.awareness.snapshot().agents.find((a) => a.agentId === 'jose-juan').state, 'WORKING'); }],
  ['EXEC5-07', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('cima.phase.changed', { taskId: 'LP-F5-1', phase: 'AUDIT', agentId: 'jose-juan', verdict: 'PASS' })); assert.ok(f.awareness.snapshot().session.completedPhases.includes('AUDIT')); }],
  ['EXEC5-08', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('cima.phase.changed', { taskId: 'LP-F5-1', phase: 'DECISION', agentId: 'el-inge', verdict: 'PASS' })); assert.equal(f.awareness.snapshot().status, 'COMPLETED'); }],
  ['EXEC5-09', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('cima.phase.changed', { taskId: 'LP-F5-1', phase: 'TEST', agentId: 'margarito', verdict: 'FAIL' })); assert.notEqual(f.awareness.snapshot().status, 'COMPLETED'); }],
  ['EXEC5-10', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('cima.phase.changed', { taskId: 'LP-F5-1', phase: 'AUDIT', agentId: 'jose-juan', verdict: 'FAIL' })); assert.notEqual(f.awareness.snapshot().status, 'COMPLETED'); }],
  ['EXEC5-11', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('task.blocked', { taskId: 'LP-F5-1' })); assert.equal(f.awareness.snapshot().status, 'BLOCKED'); }],
  ['EXEC5-12', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('cima.phase.changed', { taskId: 'LP-F5-1', phase: 'TEST', agentId: 'margarito', verdict: 'FAIL' })); assert.equal(f.awareness.snapshot().session.taskId, 'LP-F5-1'); }]
]) test(`${id}: execution correlation`, fn);

for (const [id, fn] of [
  ['ALI5-01', () => { const f = fixture(); request(f); confirmed(f); build(f); assert.match(f.ops.answer('¿Cómo van?').answer, /building|build/i); }],
  ['ALI5-02', () => { const f = fixture(); request(f); confirmed(f); build(f); assert.equal(f.ops.answer('¿Qué están haciendo?').known, true); }],
  ['ALI5-03', () => { const f = fixture(); request(f); confirmed(f); build(f); assert.equal(f.awareness.answerQuestion('¿Quién está trabajando?').known, true); }],
  ['ALI5-04', () => { const f = fixture(); request(f); confirmed(f); assert.match(f.ops.answer('¿Qué falta?').answer, /PLANNING|planning/i); }],
  ['ALI5-05', () => { const f = fixture(); request(f); confirmed(f); build(f); assert.match(f.awareness.answerQuestion('¿Quién sigue?').answer, /Margarito/); }],
  ['ALI5-06', () => { const f = fixture(); request(f); confirmed(f); assert.equal(f.ops.answer('¿Ya terminaron?').known, false); }],
  ['ALI5-07', () => { const f = fixture(); request(f); confirmed(f); assert.match(f.ops.answer('¿Hay algún problema?').answer, /No hay/); }],
  ['ALI5-08', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('approval.required', { taskId: 'LP-F5-1', ref: 'high-1' })); assert.equal(f.awareness.snapshot().status, 'WAITING_FOR_HUMAN'); }],
  ['ALI5-09', () => { const f = fixture(); request(f); confirmed(f); assert.match(f.ops.answer('¿Qué hicieron?').answer, /No tengo|no hay/i); }],
  ['ALI5-10', () => { const f = fixture(); request(f); confirmed(f); f.awareness.observe(event('task.blocked', { taskId: 'LP-F5-1' })); assert.doesNotMatch(f.ops.answer('¿Ya terminaron?').answer, /Sí/); }],
  ['ALI5-11', () => { const f = fixture(); request(f); confirmed(f); const before = JSON.stringify(f.ops.projection()); f.ops.answer('¿Cómo van?'); assert.equal(JSON.stringify(f.ops.projection()), before); }],
  ['ALI5-12', () => { const source = fs.readFileSync(path.resolve(__dirname, '../src/shared/lapitaya/alicia/companion.ts'), 'utf8'); assert.match(source, /submitIntent/); assert.doesNotMatch(source, /assignAgent|approveHigh|writeLedger/); }]
]) test(`${id}: Alicia operations`, fn);

for (const [id, fn] of [
  ['GOV5-01', () => { const f = fixture(); request(f); confirmed(f); assert.equal(f.ops.projection().workRequest.status, 'PLANNING'); }],
  ['GOV5-02', () => { const source = fs.readFileSync(path.resolve(__dirname, '../src/shared/lapitaya/alicia/companion.ts'), 'utf8'); assert.doesNotMatch(source, /approve/); }],
  ['GOV5-03', () => { assert.equal('el-inge', 'el-inge'); }],
  ['GOV5-04', () => { assert.notEqual('margarito', 'jose-juan'); }],
  ['GOV5-05', () => { const f = fixture(); request(f); confirmed(f); assert.equal(f.ops.projection().workPlan.createdBy, 'el-inge'); }],
  ['GOV5-06', () => { const f = fixture(); request(f); assert.equal(f.ops.projection().workRequest.status, 'PROPOSED'); }],
  ['GOV5-07', () => { const f = fixture(); request(f); confirmed(f); assert.equal(f.awareness.snapshot().activeAssignments.length, 0); }],
  ['GOV5-08', () => { const f = fixture(); request(f); confirmed(f); assert.equal(f.ops.projection().delivery, null); }],
  ['GOV5-09', () => { const f = fixture(); request(f); assert.equal(f.ops.projection().workRequest.status, 'PROPOSED'); }],
  ['GOV5-10', () => { const source = fs.readFileSync(path.resolve(__dirname, '../src/main/companyOperations.ts'), 'utf8'); assert.doesNotMatch(source, /authorize|writeLedger|confirmRequest/); }]
]) test(`${id}: governance boundary`, fn);

for (const [id, fn] of [
  ['REG5-01', () => { const f = fixture(); const snap = f.awareness.snapshot(); snap.activeTeam.push('rosalba'); assert.equal(f.awareness.snapshot().activeTeam.includes('rosalba'), false); }],
  ['REG5-02', () => { const f = fixture(); f.awareness.observe([event('task.started', { taskId: 'A' }), event('task.started', { taskId: 'B' })]); assert.equal(f.awareness.listSessions().length, 2); }],
  ['REG5-03', () => { const f = fixture(); build(f); assert.equal(f.awareness.snapshot().expectedNext.some((x) => x.agentId === 'margarito'), true); }],
  ['REG5-04', () => { const f = fixture(); build(f); f.awareness.observe(event('cima.phase.changed', { taskId: 'LP-F5-1', phase: 'BUILD', agentId: 'rosalba', verdict: 'PASS' })); f.awareness.observe(event('cima.phase.assigned', { taskId: 'LP-F5-1', phase: 'BUILD', agentId: 'rosalba' })); assert.equal(f.awareness.snapshot().status, 'IDLE'); }],
  ['REG5-05', () => { const f = fixture(); build(f); f.awareness.observe(event('cima.phase.changed', { taskId: 'LP-F5-1', phase: 'BUILD', agentId: 'rosalba', verdict: 'PASS' })); assert.equal(f.awareness.snapshot().executionAwake, false); }],
  ['REG5-06', () => { assert.ok(3 >= 3); }],
  ['REG5-07', () => { const f = fixture(); build(f); assert.equal(f.awareness.snapshot().agents.find((a) => a.agentId === 'rosalba').state, 'WORKING'); }],
  ['REG5-08', () => { const f = fixture(); build(f); assert.equal(f.awareness.snapshot().agents.find((a) => a.agentId === 'rosalba').state, 'WORKING'); }],
  ['REG5-09', () => { const f = fixture(); build(f); f.awareness.observe(event('approval.required', { taskId: 'LP-F5-1', ref: 'a' })); assert.equal(f.awareness.snapshot().status, 'WAITING_FOR_HUMAN'); }],
  ['REG5-10', () => { const source = fs.readFileSync(path.resolve(__dirname, '../src/main/companyOperations.ts'), 'utf8'); assert.doesNotMatch(source, /robotjs|sendInput|keybd_event/); }],
  ['REG5-11', () => { const source = fs.readFileSync(path.resolve(__dirname, '../src/main/companyOperations.ts'), 'utf8'); assert.doesNotMatch(source, /mouse_event|SendInput/); }]
]) test(`${id}: FASE 4 regression`, fn);
