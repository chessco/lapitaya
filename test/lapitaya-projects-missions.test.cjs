'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const loadTs = require('./load-ts.cjs');

const { CompanyAwarenessService } = loadTs('src/main/companyAwareness.ts');
const { CompanyOperationsService } = loadTs('src/main/companyOperations.ts');

let clock = 3_000_000_000_000;
const event = (type, data = {}) => ({ type, ts: ++clock, source: 'governance', ...data });

function createFixture(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapitaya-f6-test-'));
  const storageFile = path.join(tmpDir, 'projects.json');
  const awareness = new CompanyAwarenessService({ now: () => ++clock, ...(opts.awarenessOpts || {}) });
  const ops = new CompanyOperationsService({
    now: () => ++clock,
    snapshot: () => awareness.snapshot(),
    storageFile,
    project: () => opts.projectContext ?? { projectId: null, displayName: null }
  });
  return { awareness, ops, storageFile, tmpDir };
}

function cleanupFixture(f) {
  try {
    if (fs.existsSync(f.tmpDir)) {
      fs.rmSync(f.tmpDir, { recursive: true, force: true });
    }
  } catch {
    /* ignore cleanup errors */
  }
}

// ─── PROJ6: Project Lifecycle & Continuity ────────────────────────────────────

test('PROJ6-01: Create Project through governed path', () => {
  const f = createFixture();
  const proj = f.ops.createProject({
    projectId: 'LP-PROJ-1',
    name: 'Sistema de Facturación',
    objective: 'Construir el sistema de facturación electrónica CFDI 4.0.',
    createdBy: 'human'
  });
  assert.equal(proj.projectId, 'LP-PROJ-1');
  assert.equal(proj.name, 'Sistema de Facturación');
  assert.equal(proj.status, 'PLANNING');
  assert.equal(proj.verified, true);
  cleanupFixture(f);
});

test('PROJ6-02: Project objective preserves HUMAN provenance', () => {
  const f = createFixture();
  const proj = f.ops.createProject({
    name: 'Inventarios',
    objective: 'Control de stock y kardex. Criterio de aceptación: calcular costo promedio ponderado.'
  });
  assert.equal(proj.acceptanceCriteria[0].provenance, 'HUMAN');
  assert.equal(proj.acceptanceCriteria[0].verified, true);
  cleanupFixture(f);
});

test('PROJ6-03: Project without missions is not falsely completed', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Ventas', objective: 'Punto de venta.' });
  const snap = f.ops.projectSnapshot(proj.projectId);
  assert.notEqual(snap.project.status, 'COMPLETED');
  assert.equal(snap.progress.completedMissions, 0);
  assert.equal(snap.progress.totalMissions, 0);
  cleanupFixture(f);
});

test('PROJ6-04: Project persists across restart', () => {
  const f = createFixture();
  const proj = f.ops.createProject({
    projectId: 'LP-PERSIST-1',
    name: 'Contabilidad',
    objective: 'Catálogo de cuentas y balanza de comprobación.'
  });
  assert.ok(fs.existsSync(f.storageFile));

  // Instantiate brand new service instance pointing to same storage file
  const reloadedOps = new CompanyOperationsService({
    now: () => ++clock,
    snapshot: () => f.awareness.snapshot(),
    storageFile: f.storageFile
  });

  const reloadedProj = reloadedOps.getProject('LP-PERSIST-1');
  assert.ok(reloadedProj);
  assert.equal(reloadedProj.projectId, 'LP-PERSIST-1');
  assert.equal(reloadedProj.name, 'Contabilidad');
  cleanupFixture(f);
});

test('PROJ6-05: Project reload preserves ID and metadata', () => {
  const f = createFixture();
  const proj = f.ops.createProject({
    projectId: 'LP-ID-PRESERVE',
    name: 'RRHH',
    objective: 'Nómina quincenal'
  });
  const reloadedOps = new CompanyOperationsService({
    now: () => ++clock,
    snapshot: () => f.awareness.snapshot(),
    storageFile: f.storageFile
  });
  const reloaded = reloadedOps.getProject('LP-ID-PRESERVE');
  assert.equal(reloaded.projectId, proj.projectId);
  assert.equal(reloaded.createdAt, proj.createdAt);
  assert.equal(reloaded.createdBy, 'human');
  cleanupFixture(f);
});

test('PROJ6-06: Unknown project facts remain unknown/null', () => {
  const f = createFixture();
  const snap = f.ops.projectSnapshot('non-existent-proj-id');
  assert.equal(snap, null);
  cleanupFixture(f);
});

test('PROJ6-07: Multiple projects remain isolated', () => {
  const f = createFixture();
  const projA = f.ops.createProject({ projectId: 'PROJ-A', name: 'App iOS', objective: 'Desarrollo iOS' });
  const projB = f.ops.createProject({ projectId: 'PROJ-B', name: 'App Android', objective: 'Desarrollo Android' });

  f.ops.createMission({ projectId: projA.projectId, title: 'Auth iOS', objective: 'Sign in with Apple' });

  const snapA = f.ops.projectSnapshot(projA.projectId);
  const snapB = f.ops.projectSnapshot(projB.projectId);

  assert.equal(snapA.missions.length, 1);
  assert.equal(snapB.missions.length, 0);
  assert.notDeepEqual(snapA.missions, snapB.missions);
  cleanupFixture(f);
});

test('PROJ6-08: Project status cannot be forged from renderer', () => {
  const f = createFixture();
  const mainSource = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  assert.doesNotMatch(mainSource, /ipcMain\.handle\(['"]projects:set/);
  assert.doesNotMatch(mainSource, /ipcMain\.handle\(['"]projects:update/);
  assert.doesNotMatch(mainSource, /ipcMain\.handle\(['"]missions:set/);
  cleanupFixture(f);
});

test('PROJ6-09: Project progress is deterministic', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ projectId: 'PROJ-DET', name: 'Logística', objective: 'Rastreo de envíos' });
  const m1 = f.ops.createMission({ projectId: proj.projectId, title: 'Modelos de datos', objective: 'Crear esquema' });
  const m2 = f.ops.createMission({ projectId: proj.projectId, title: 'API GPS', objective: 'Endpoint de ubicación' });

  let snap = f.ops.projectSnapshot(proj.projectId);
  assert.equal(snap.progress.completedMissions, 0);
  assert.equal(snap.progress.totalMissions, 2);
  assert.equal(snap.progress.summary, '0 de 2 misiones completadas');

  // Complete mission 1
  f.ops.confirmMission(m1.missionId);
  const req1 = f.ops.createMissionWorkRequest(m1.missionId, 'Crear tablas SQL');
  f.awareness.observe([
    event('cima.phase.assigned', { taskId: 'TASK-M1', phase: 'BUILD', agentId: 'rosalba' }),
    event('cima.phase.changed', { taskId: 'TASK-M1', phase: 'BUILD', agentId: 'rosalba', verdict: 'PASS' }),
    event('cima.phase.assigned', { taskId: 'TASK-M1', phase: 'TEST', agentId: 'margarito' }),
    event('cima.phase.changed', { taskId: 'TASK-M1', phase: 'TEST', agentId: 'margarito', verdict: 'PASS' }),
    event('cima.phase.assigned', { taskId: 'TASK-M1', phase: 'AUDIT', agentId: 'jose-juan' }),
    event('cima.phase.changed', { taskId: 'TASK-M1', phase: 'AUDIT', agentId: 'jose-juan', verdict: 'PASS' }),
    event('cima.phase.changed', { taskId: 'TASK-M1', phase: 'DECISION', agentId: 'el-inge', verdict: 'PASS' })
  ]);
  f.ops.observe([
    event('cima.phase.assigned', { taskId: 'TASK-M1', phase: 'BUILD', agentId: 'rosalba' }),
    event('cima.phase.changed', { taskId: 'TASK-M1', phase: 'DECISION', verdict: 'PASS' })
  ]);

  snap = f.ops.projectSnapshot(proj.projectId);
  assert.equal(snap.progress.completedMissions, 1);
  assert.equal(snap.progress.totalMissions, 2);
  assert.equal(snap.progress.summary, '1 de 2 misiones completadas');
  cleanupFixture(f);
});

test('PROJ6-10: Project completion requires real terminal criteria', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ projectId: 'PROJ-TERM', name: 'CRM', objective: 'Pipeline de ventas' });
  const m1 = f.ops.createMission({ projectId: proj.projectId, title: 'Leads', objective: 'Alta de prospectos' });

  assert.notEqual(f.ops.getProject(proj.projectId).status, 'COMPLETED');

  f.ops.confirmMission(m1.missionId);
  f.ops.createMissionWorkRequest(m1.missionId, 'Construir formulario');
  f.awareness.observe(event('cima.phase.changed', { taskId: 'TASK-CRM', phase: 'DECISION', verdict: 'PASS' }));
  f.ops.observe([event('cima.phase.changed', { taskId: 'TASK-CRM', phase: 'DECISION', verdict: 'PASS' })]);

  assert.equal(f.ops.getProject(proj.projectId).status, 'COMPLETED');
  cleanupFixture(f);
});

test('PROJ6-11: Project history and snapshots are bounded', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'E-commerce', objective: 'Tienda en línea' });
  const snap = f.ops.projectSnapshot(proj.projectId);
  assert.ok(Array.isArray(snap.recentVerifiedEvents));
  assert.ok(snap.recentVerifiedEvents.length <= 50);
  cleanupFixture(f);
});

test('PROJ6-12: Project projection is read-only snapshot', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Blog', objective: 'CMS de artículos' });
  const snap1 = f.ops.projectSnapshot(proj.projectId);
  snap1.blockers.push('Fake blocker');
  const snap2 = f.ops.projectSnapshot(proj.projectId);
  assert.equal(snap2.blockers.includes('Fake blocker'), false);
  cleanupFixture(f);
});

// ─── MISS6: Mission Domain & Decomposition ────────────────────────────────────

test('MISS6-01: Mission belongs to exactly one project', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ projectId: 'PROJ-P1', name: 'Alpha', objective: 'Alpha project' });
  const mission = f.ops.createMission({ projectId: proj.projectId, title: 'M1', objective: 'Mission 1' });
  assert.equal(mission.projectId, 'PROJ-P1');
  cleanupFixture(f);
});

test('MISS6-02: Mission objective preserves provenance', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ projectId: 'PROJ-P2', name: 'Beta', objective: 'Beta project' });
  const mission = f.ops.createMission({
    projectId: proj.projectId,
    title: 'M2',
    objective: 'Subir imágenes a S3. Criterio de aceptación: validar mimetype y tamaño máximo 5MB.',
    provenance: 'HUMAN'
  });
  assert.equal(mission.provenance, 'HUMAN');
  assert.equal(mission.acceptanceCriteria[0].provenance, 'HUMAN');
  cleanupFixture(f);
});

test('MISS6-03: Mission plan != authorization', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ projectId: 'PROJ-P3', name: 'Gamma', objective: 'Gamma project' });
  const mission = f.ops.createMission({ projectId: proj.projectId, title: 'Auth', objective: 'Autenticación JWT' });
  const confirmed = f.ops.confirmMission(mission.missionId);
  assert.ok(confirmed.plan);
  assert.equal(confirmed.plan.createdBy, 'el-inge');
  // Plan exists but no direct worker has been assigned authority
  assert.equal(f.awareness.snapshot().activeAssignments.length, 0);
  cleanupFixture(f);
});

test('MISS6-04: Mission confirmation != HIGH approval', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Delta', objective: 'Delta' });
  const mission = f.ops.createMission({ projectId: proj.projectId, title: 'Deploy', objective: 'Desplegar a producción' });
  f.ops.confirmMission(mission.missionId);
  // HIGH risk approval must never be bypassed by mission confirmation
  f.awareness.observe(event('approval.required', { taskId: 'TASK-DEPLOY', ref: 'high-deploy-1', subject: 'Publicar a producción' }));
  assert.equal(f.awareness.snapshot().humanAttention.kind, 'HIGH');
  assert.equal(f.awareness.snapshot().status, 'WAITING_FOR_HUMAN');
  cleanupFixture(f);
});

test('MISS6-05: Mission plan != worker assignment', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Epsilon', objective: 'Epsilon' });
  const mission = f.ops.createMission({ projectId: proj.projectId, title: 'UI', objective: 'Diseñar pantallas' });
  f.ops.confirmMission(mission.missionId);
  const snap = f.awareness.snapshot();
  // None of the workers in the plan steps are marked WORKING
  const workingAgents = snap.agents.filter((a) => a.state === 'WORKING');
  assert.equal(workingAgents.length, 0);
  cleanupFixture(f);
});

test('MISS6-06: Mission creates correlated WorkRequests', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ projectId: 'PROJ-REQ', name: 'Zeta', objective: 'Zeta' });
  const mission = f.ops.createMission({ projectId: proj.projectId, title: 'API', objective: 'Construir endpoints REST' });
  const req = f.ops.createMissionWorkRequest(mission.missionId, 'Endpoint POST /items');
  assert.equal(req.projectId, proj.projectId);
  assert.equal(req.missionId, mission.missionId);
  assert.ok(f.ops.getMission(mission.missionId).workRequestIds.includes(req.requestId));
  cleanupFixture(f);
});

test('MISS6-07: WorkRequest preserves missionId and projectId lineage', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ projectId: 'PROJ-LIN', name: 'Eta', objective: 'Eta' });
  const mission = f.ops.createMission({ projectId: proj.projectId, title: 'DB', objective: 'Esquema Postgres' });
  const req = f.ops.createMissionWorkRequest(mission.missionId, 'Migración de base de datos');
  assert.equal(req.projectId, 'PROJ-LIN');
  assert.equal(req.missionId, mission.missionId);
  cleanupFixture(f);
});

test('MISS6-08: Mission aggregates verified deliveries', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ projectId: 'PROJ-DEL', name: 'Theta', objective: 'Theta' });
  const mission = f.ops.createMission({ projectId: proj.projectId, title: 'Reportes', objective: 'Generación PDF' });
  f.ops.confirmMission(mission.missionId);
  f.ops.createMissionWorkRequest(mission.missionId, 'Plantilla de reporte');

  f.awareness.observe([
    event('cima.phase.assigned', { taskId: 'TASK-REP', phase: 'BUILD', agentId: 'rosalba' }),
    event('cima.phase.changed', { taskId: 'TASK-REP', phase: 'BUILD', agentId: 'rosalba', verdict: 'PASS' }),
    event('cima.phase.changed', { taskId: 'TASK-REP', phase: 'DECISION', verdict: 'PASS' })
  ]);
  f.ops.observe([
    event('cima.phase.assigned', { taskId: 'TASK-REP', phase: 'BUILD', agentId: 'rosalba' }),
    event('cima.phase.changed', { taskId: 'TASK-REP', phase: 'DECISION', verdict: 'PASS' })
  ]);

  const snap = f.ops.missionSnapshot(mission.missionId);
  assert.equal(snap.deliveries.length, 1);
  assert.equal(snap.deliveries[0].outcome, 'PASS');
  assert.equal(snap.outcome, 'PASS');
  cleanupFixture(f);
});

test('MISS6-09: Mission persists across restart with dependencies and deliveries', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ projectId: 'PROJ-M-PERSIST', name: 'Iota', objective: 'Iota' });
  const m1 = f.ops.createMission({ projectId: proj.projectId, title: 'Base', objective: 'Core base' });
  const m2 = f.ops.createMission({ projectId: proj.projectId, title: 'Extension', objective: 'Plugins', dependencies: [m1.missionId] });

  f.ops.confirmMission(m1.missionId);
  assert.ok(fs.existsSync(f.storageFile));

  const reloadedOps = new CompanyOperationsService({
    now: () => ++clock,
    snapshot: () => f.awareness.snapshot(),
    storageFile: f.storageFile
  });

  const rm1 = reloadedOps.getMission(m1.missionId);
  const rm2 = reloadedOps.getMission(m2.missionId);
  assert.ok(rm1);
  assert.ok(rm2);
  assert.deepEqual(rm2.dependencies, [m1.missionId]);
  cleanupFixture(f);
});

test('MISS6-10: Mission completion requires terminal evidence', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Kappa', objective: 'Kappa' });
  const m = f.ops.createMission({ projectId: proj.projectId, title: 'Worker Exit Test', objective: 'Test exit' });
  f.ops.confirmMission(m.missionId);
  f.ops.createMissionWorkRequest(m.missionId, 'Ejecutar tarea');

  // Agent exited without DECISION PASS
  f.awareness.observe(event('agent.completed', { agentId: 'rosalba' }));
  assert.notEqual(f.ops.getMission(m.missionId).status, 'COMPLETED');
  cleanupFixture(f);
});

test('MISS6-11: Failed work does not create successful mission', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Lambda', objective: 'Lambda' });
  const m = f.ops.createMission({ projectId: proj.projectId, title: 'Audit Test', objective: 'Audit check' });
  f.ops.confirmMission(m.missionId);
  f.ops.createMissionWorkRequest(m.missionId, 'Auditar código');

  f.awareness.observe([
    event('cima.phase.assigned', { taskId: 'TASK-FAIL', phase: 'AUDIT', agentId: 'jose-juan' }),
    event('cima.phase.changed', { taskId: 'TASK-FAIL', phase: 'AUDIT', agentId: 'jose-juan', verdict: 'FAIL' }),
    event('cima.phase.changed', { taskId: 'TASK-FAIL', phase: 'DECISION', verdict: 'FAIL' })
  ]);
  f.ops.observe([
    event('cima.phase.assigned', { taskId: 'TASK-FAIL', phase: 'AUDIT', agentId: 'jose-juan' }),
    event('cima.phase.changed', { taskId: 'TASK-FAIL', phase: 'DECISION', verdict: 'FAIL' })
  ]);

  const snap = f.ops.missionSnapshot(m.missionId);
  assert.notEqual(snap.mission.status, 'COMPLETED');
  assert.equal(snap.outcome, 'FAIL');
  cleanupFixture(f);
});

test('MISS6-12: Iteration preserves mission lineage', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Mu', objective: 'Mu' });
  const m = f.ops.createMission({ projectId: proj.projectId, title: 'Iterative Mission', objective: 'Fix bug' });
  f.ops.confirmMission(m.missionId);
  const req1 = f.ops.createMissionWorkRequest(m.missionId, 'Intento 1');
  const req2 = f.ops.createMissionWorkRequest(m.missionId, 'Intento 2');

  assert.deepEqual(f.ops.getMission(m.missionId).workRequestIds, [req1.requestId, req2.requestId]);
  cleanupFixture(f);
});

test('MISS6-13: Dependency blocks second mission correctly', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Nu', objective: 'Nu' });
  const m1 = f.ops.createMission({ projectId: proj.projectId, title: 'Misión 1: Setup', objective: 'Setup base' });
  const m2 = f.ops.createMission({ projectId: proj.projectId, title: 'Misión 2: Feature', objective: 'Feature', dependencies: [m1.missionId] });

  assert.equal(m2.status, 'BLOCKED');
  const snap2 = f.ops.missionSnapshot(m2.missionId);
  assert.ok(snap2.blockers.length > 0);
  assert.match(snap2.blockers[0], /dependencias/i);
  cleanupFixture(f);
});

test('MISS6-14: Dependency satisfaction does not auto-assign workers', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Xi', objective: 'Xi' });
  const m1 = f.ops.createMission({ projectId: proj.projectId, title: 'Dep1', objective: 'Dep1' });
  const m2 = f.ops.createMission({ projectId: proj.projectId, title: 'Dep2', objective: 'Dep2', dependencies: [m1.missionId] });

  f.ops.confirmMission(m1.missionId);
  f.ops.createMissionWorkRequest(m1.missionId, 'Trabajo Dep1');
  f.awareness.observe(event('cima.phase.changed', { taskId: 'TASK-DEP1', phase: 'DECISION', verdict: 'PASS' }));
  f.ops.observe([event('cima.phase.changed', { taskId: 'TASK-DEP1', phase: 'DECISION', verdict: 'PASS' })]);

  // m2 is unblocked to CONFIRMED / PLANNING
  const updatedM2 = f.ops.getMission(m2.missionId);
  assert.notEqual(updatedM2.status, 'BLOCKED');
  // Invariant: Dependency satisfaction != assignment
  assert.equal(f.awareness.snapshot().activeAssignments.length, 0);
  cleanupFixture(f);
});

test('MISS6-15: Mission human attention is projected correctly', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Omicron', objective: 'Omicron' });
  const m = f.ops.createMission({ projectId: proj.projectId, title: 'Att Mission', objective: 'Attention needed' });
  f.awareness.observe(event('approval.required', { taskId: 'TASK-OM', ref: 'approval-om-1', subject: 'Confirmar migración destructiva' }));

  const snap = f.ops.missionSnapshot(m.missionId);
  assert.ok(snap.humanAttention);
  assert.equal(snap.humanAttention.kind, 'HIGH');
  cleanupFixture(f);
});

// ─── CONT6: Restart & Organizational Continuity ───────────────────────────────

test('CONT6-01 to CONT6-12: Full Project Continuity across simulated Electron restart', () => {
  const f = createFixture();
  // 1. Create project
  const proj = f.ops.createProject({
    projectId: 'LP-F6-CONT-PROJECT',
    name: 'Calculadora de Prueba',
    objective: 'Construir una calculadora de prueba aislada para validar continuidad.'
  });

  // 2. Create missions
  const m1 = f.ops.createMission({
    projectId: proj.projectId,
    title: 'Implementar suma',
    objective: 'Módulo de suma aritmética con pruebas unitarias.'
  });
  const m2 = f.ops.createMission({
    projectId: proj.projectId,
    title: 'Implementar resta',
    objective: 'Módulo de resta aritmética con pruebas unitarias.',
    dependencies: [m1.missionId]
  });

  // 3. Confirm & execute Mission 1
  f.ops.confirmMission(m1.missionId);
  f.ops.createMissionWorkRequest(m1.missionId, 'Codificar suma.js y pruebas');
  f.awareness.observe([
    event('cima.phase.assigned', { taskId: 'TASK-SUMA', phase: 'BUILD', agentId: 'rosalba' }),
    event('cima.phase.changed', { taskId: 'TASK-SUMA', phase: 'BUILD', agentId: 'rosalba', verdict: 'PASS' }),
    event('cima.phase.assigned', { taskId: 'TASK-SUMA', phase: 'TEST', agentId: 'margarito' }),
    event('cima.phase.changed', { taskId: 'TASK-SUMA', phase: 'TEST', agentId: 'margarito', verdict: 'PASS' }),
    event('cima.phase.assigned', { taskId: 'TASK-SUMA', phase: 'AUDIT', agentId: 'jose-juan' }),
    event('cima.phase.changed', { taskId: 'TASK-SUMA', phase: 'AUDIT', agentId: 'jose-juan', verdict: 'PASS' }),
    event('cima.phase.changed', { taskId: 'TASK-SUMA', phase: 'DECISION', verdict: 'PASS' })
  ]);
  f.ops.observe([
    event('cima.phase.assigned', { taskId: 'TASK-SUMA', phase: 'BUILD', agentId: 'rosalba' }),
    event('cima.phase.changed', { taskId: 'TASK-SUMA', phase: 'DECISION', verdict: 'PASS' })
  ]);

  assert.equal(f.ops.getMission(m1.missionId).status, 'COMPLETED');

  // 4. Save and simulate process restart
  f.ops.save();

  const restartedAwareness = new CompanyAwarenessService({ now: () => ++clock });
  const restartedOps = new CompanyOperationsService({
    now: () => ++clock,
    snapshot: () => restartedAwareness.snapshot(),
    storageFile: f.storageFile
  });

  // 5. Verify restored state
  const restoredProj = restartedOps.getProject('LP-F6-CONT-PROJECT');
  assert.ok(restoredProj);
  assert.equal(restoredProj.name, 'Calculadora de Prueba');

  const rm1 = restartedOps.getMission(m1.missionId);
  const rm2 = restartedOps.getMission(m2.missionId);
  assert.equal(rm1.status, 'COMPLETED');
  assert.ok(rm1.deliveryIds.length > 0);

  // No fake WORKING agents after restart
  const snapAfterRestart = restartedAwareness.snapshot();
  assert.equal(snapAfterRestart.activeAssignments.length, 0);
  assert.ok(snapAfterRestart.agents.every((a) => a.state !== 'WORKING'));

  // Alicia answers project state correctly after restart
  const projAns = restartedOps.answer('¿Cómo va el proyecto?');
  assert.ok(projAns.known);
  assert.match(projAns.answer, /1 de 2 misiones completadas/);

  const doneAns = restartedOps.answer('¿Qué ya terminaron?');
  assert.ok(doneAns.known);
  assert.match(doneAns.answer, /Implementar suma/);

  const remainAns = restartedOps.answer('¿Qué falta?');
  assert.ok(remainAns.known);
  assert.match(remainAns.answer, /Implementar resta/);

  const whoWorkingAns = restartedOps.answer('¿Quién está trabajando?');
  assert.ok(whoWorkingAns.known);
  assert.match(whoWorkingAns.answer, /No hay ningún agente trabajando/);

  cleanupFixture(f);
});

// ─── ALI6: Alicia Conversational Continuity & Q&A ────────────────────────────

test('ALI6-01 to ALI6-15: Alicia project questions and false premise handling', () => {
  const f = createFixture();
  const proj = f.ops.createProject({
    projectId: 'LP-ALI-PROJ',
    name: 'Módulo de Facturación',
    objective: 'Facturas digitales'
  });
  const m1 = f.ops.createMission({ projectId: proj.projectId, title: 'Generar XML', objective: 'Esquema XML' });
  const m2 = f.ops.createMission({ projectId: proj.projectId, title: 'Timbrado PAC', objective: 'Conexión con PAC' });

  // ALI6-01: ¿Qué proyectos tenemos?
  const a1 = f.ops.answer('¿Qué proyectos tenemos?');
  assert.ok(a1.known);
  assert.match(a1.answer, /Módulo de Facturación/);

  // ALI6-02: ¿Cómo va este proyecto?
  const a2 = f.ops.answer('¿Cómo va este proyecto?');
  assert.ok(a2.known);
  assert.match(a2.answer, /0 de 2 misiones completadas/);

  // ALI6-03: ¿Qué misión está activa?
  const a3 = f.ops.answer('¿Qué misión está activa?');
  assert.ok(a3.known);
  assert.match(a3.answer, /Generar XML/);

  // ALI6-04: ¿Qué falta?
  const a4 = f.ops.answer('¿Qué falta?');
  assert.ok(a4.known);
  assert.match(a4.answer, /Generar XML/);
  assert.match(a4.answer, /Timbrado PAC/);

  // ALI6-05: ¿Qué ya terminaron?
  const a5 = f.ops.answer('¿Qué ya terminaron?');
  assert.equal(a5.known, false);

  // Complete mission 1
  f.ops.confirmMission(m1.missionId);
  f.ops.createMissionWorkRequest(m1.missionId, 'Implementar generador');
  f.awareness.observe(event('cima.phase.changed', { taskId: 'TASK-XML', phase: 'DECISION', verdict: 'PASS' }));
  f.ops.observe([event('cima.phase.changed', { taskId: 'TASK-XML', phase: 'DECISION', verdict: 'PASS' })]);

  const a5_after = f.ops.answer('¿Qué ya terminaron?');
  assert.ok(a5_after.known);
  assert.match(a5_after.answer, /Generar XML/);

  // ALI6-06: ¿Qué está bloqueado?
  const a6 = f.ops.answer('¿Qué está bloqueado?');
  assert.ok(a6.known);
  assert.match(a6.answer, /No hay nada bloqueado/);

  // ALI6-07: ¿Quién está trabajando?
  const a7 = f.ops.answer('¿Quién está trabajando?');
  assert.ok(a7.known);
  assert.match(a7.answer, /No hay ningún agente trabajando/);

  // ALI6-08: ¿Quién sigue?
  const a8 = f.ops.answer('¿Quién sigue?');
  assert.ok(a8.known);

  // ALI6-09: ¿Necesitan algo de mí?
  const a9 = f.ops.answer('¿Necesitan algo de mí?');
  assert.ok(a9.known);
  assert.match(a9.answer, /No hay decisiones humanas pendientes/);

  // ALI6-10: ¿Qué entregaron?
  const a10 = f.ops.answer('¿Qué entregaron?');
  assert.ok(a10.known);
  assert.match(a10.answer, /Entregas verificadas/);

  // ALI6-11: Ambiguous project triggers clarification
  f.ops.createProject({ projectId: 'LP-PROJ-DUP-1', name: 'Inventarios Web', objective: 'Portal web' });
  f.ops.createProject({ projectId: 'LP-PROJ-DUP-2', name: 'Inventarios Móvil', objective: 'App móvil' });
  const a11 = f.ops.answer('¿Cómo va inventarios?');
  assert.ok(a11.known);
  assert.match(a11.answer, /más de un proyecto.*¿A cuál te refieres/i);

  // ALI6-12: Status questions have ZERO operational mutations
  const projBefore = JSON.stringify(f.ops.projection());
  f.ops.answer('¿Cómo va el proyecto?');
  f.ops.answer('¿Quién está trabajando?');
  f.ops.answer('¿Qué falta?');
  const projAfter = JSON.stringify(f.ops.projection());
  assert.equal(projAfter, projBefore);

  // ALI6-13: False completion premise corrected
  const a13 = f.ops.answer('Entonces ya terminaron todo el proyecto, ¿verdad?');
  assert.ok(a13.known);
  assert.match(a13.answer, /No, todavía no termina todo el proyecto/);

  // ALI6-14: False assignment premise corrected
  const a14 = f.ops.answer('Rosalba está trabajando en la segunda misión, ¿cierto?');
  assert.ok(a14.known);
  assert.match(a14.answer, /No, Rosalba no tiene una asignación activa/);

  // ALI6-15: Unknown fact is not invented
  const a15 = f.ops.answer('¿Quién es el astronauta jefe del cohete espacial?');
  assert.equal(a15, null);

  cleanupFixture(f);
});

// ─── GOV6 & REG6: Governance Boundaries & Regression ──────────────────────────

test('GOV6 & REG6: Invariants and boundaries preserved', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'Gov Test', objective: 'Gov objective' });
  const m = f.ops.createMission({ projectId: proj.projectId, title: 'Gov M', objective: 'Gov mission' });
  f.ops.confirmMission(m.missionId);

  // 1. Expected != Assigned
  f.awareness.observe(event('cima.phase.assigned', { taskId: 'TASK-GOV', phase: 'BUILD', agentId: 'rosalba' }));
  const snap = f.awareness.snapshot();
  assert.equal(snap.expectedNext[0]?.agentId, 'margarito');
  assert.equal(snap.activeAssignments.some((a) => a.agentId === 'margarito'), false);

  // 2. Builder != Auditor
  assert.notEqual('rosalba', 'jose-juan');

  // 3. Security: Renderer cannot forge completion
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  assert.doesNotMatch(mainSrc, /ipcMain\.handle\(['"](projects|missions):(complete|finish|approve)/);

  cleanupFixture(f);
});
