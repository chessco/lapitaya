'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  answerCompanyOSQuestion
} = loadTs('src/shared/lapitaya/alicia/companyOSAnswers.ts');

const {
  VirtualCompanyOSService
} = loadTs('src/main/virtualCompanyOS.ts');

let clock = 1_700_000_000_000;

function sampleProject(id = 'proj-1', name = 'Alpha', priority = 'HIGH') {
  return {
    projectId: id,
    name,
    objective: `Objective for ${name}`,
    status: 'ACTIVE',
    priority,
    health: 'HEALTHY',
    progress: { completedMissions: 1, totalMissions: 2, percentComplete: 50 },
    missions: [],
    activeOperationCount: 1,
    humanBlockerCount: 0,
    budgetUtilization: { tokensUsed: 1000, tokenBudget: 10000, timeSpentMs: 5000 }
  };
}

function sampleSnapshot(overrides = {}) {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  const base = os.getSnapshot();
  return {
    ...base,
    ...overrides
  };
}

test('ALI9-01: Q1 What is the company doing?', () => {
  const snap = sampleSnapshot();
  const res = answerCompanyOSQuestion('¿Qué está haciendo la empresa?', snap);

  assert.equal(res.known, true);
  assert.equal(res.snapshotVersion, 2);
  assert.ok(res.answer.includes('IDLE'));

  const pausedSnap = sampleSnapshot({ isPaused: true });
  const pausedRes = answerCompanyOSQuestion('¿Qué está haciendo la empresa?', pausedSnap);
  assert.ok(pausedRes.answer.includes('PAUSADA'));
});

test('ALI9-02: Q2 What projects are active?', () => {
  const snap = sampleSnapshot({
    portfolio: {
      projects: [sampleProject('proj-alpha', 'Project Alpha', 'CRITICAL')],
      activeProjectId: 'proj-alpha',
      summary: { totalProjects: 1, activeCount: 1, pausedCount: 0, completedCount: 0, blockedCount: 0 },
      dependencies: [],
      updatedAt: clock
    }
  });

  const res = answerCompanyOSQuestion('¿Qué proyectos están activos?', snap);
  assert.equal(res.known, true);
  assert.ok(res.answer.includes('Project Alpha'));
  assert.ok(res.answer.includes('CRITICAL'));
});

test('ALI9-03: Q3 Which project has top priority?', () => {
  const snap = sampleSnapshot({
    portfolio: {
      projects: [sampleProject('proj-alpha', 'Project Alpha', 'CRITICAL')],
      activeProjectId: 'proj-alpha',
      summary: { totalProjects: 1, activeCount: 1, pausedCount: 0, completedCount: 0, blockedCount: 0 },
      dependencies: [],
      updatedAt: clock
    }
  });

  const res = answerCompanyOSQuestion('¿Cuál es el proyecto prioritario?', snap);
  assert.equal(res.known, true);
  assert.ok(res.answer.includes('Project Alpha'));
});

test('ALI9-04: Q4 What mission is next and why?', () => {
  const snap = sampleSnapshot({
    workQueue: {
      items: [
        {
          id: 'q-1',
          projectId: 'proj-alpha',
          missionId: 'm-build-api',
          priority: 'CRITICAL',
          rank: 1,
          status: 'READY',
          requiredCapabilities: ['BUILD'],
          reasonCode: 'DEPENDENCIES_SATISFIED',
          queuedAt: clock
        }
      ],
      totalQueued: 1,
      readyCount: 1,
      blockedCount: 0,
      updatedAt: clock
    }
  });

  const res = answerCompanyOSQuestion('¿Qué misión sigue y por qué?', snap);
  assert.equal(res.known, true);
  assert.ok(res.answer.includes('m-build-api'));
  assert.ok(res.answer.includes('DEPENDENCIES_SATISFIED'));
});

test('ALI9-05: Q5 & Q6 Who is working vs Who is available', () => {
  const snap = sampleSnapshot({
    capacity: [
      { agentId: 'rosalba', state: 'EXECUTING', currentAssignment: { projectId: 'proj-1', missionId: 'm-1', phase: 'BUILD', startedAt: clock }, concurrencyLimit: 1, utilizationRate: 1 },
      { agentId: 'el-beni', state: 'AVAILABLE', currentAssignment: null, concurrencyLimit: 1, utilizationRate: 0 },
      { agentId: 'alicia', state: 'IDLE', currentAssignment: null, concurrencyLimit: 1, utilizationRate: 0 }
    ]
  });

  const resWorking = answerCompanyOSQuestion('¿Quién está trabajando?', snap);
  assert.ok(resWorking.answer.includes('rosalba'));

  const resAvail = answerCompanyOSQuestion('¿Quién está disponible?', snap);
  assert.ok(resAvail.answer.includes('el-beni'));
});

test('ALI9-06: Q7 & Q8 Blocked work vs Human attention', () => {
  const snap = sampleSnapshot({
    workQueue: {
      items: [
        { id: 'q-2', projectId: 'proj-1', missionId: 'm-db', priority: 'NORMAL', rank: 3, status: 'BLOCKED', requiredCapabilities: ['BUILD'], reasonCode: 'CYCLIC_DEPENDENCY_DETECTED', queuedAt: clock }
      ],
      totalQueued: 1,
      readyCount: 0,
      blockedCount: 1,
      updatedAt: clock
    },
    humanAttentionCenter: {
      items: [
        { id: 'attn-1', reason: 'HIGH_RISK_APPROVAL', severity: 'CRITICAL', projectId: 'proj-1', missionId: 'm-db', operationId: null, summary: 'DB migration grant', context: {}, createdAt: clock, verified: true }
      ],
      criticalCount: 1,
      highCount: 0,
      normalCount: 0,
      hasBlockingIssues: true
    }
  });

  const resBlocked = answerCompanyOSQuestion('¿Qué está bloqueado?', snap);
  assert.ok(resBlocked.answer.includes('m-db'));
  assert.ok(resBlocked.answer.includes('CYCLIC_DEPENDENCY_DETECTED'));

  const resAttn = answerCompanyOSQuestion('¿Qué necesita mi atención?', snap);
  assert.ok(resAttn.answer.includes('DB migration grant'));
});

test('ALI9-07: Q9 & Q10 Autonomous work & Resource limits', () => {
  const snap = sampleSnapshot({
    operationsCenter: {
      activeOperations: [
        { operationId: 'op-1', projectId: 'p1', projectName: 'P1', missionId: 'm1', missionTitle: 'M1', leadAgentId: 'rosalba', activeAgents: ['rosalba'], envelopeId: 'env-1', riskLevel: 'LOW', budgetRemaining: { iterations: 10, tokens: 1000, timeMs: 5000 }, startedAt: clock, status: 'RUNNING' }
      ],
      pausedOperations: [],
      recentCompletions: [],
      concurrency: { current: 1, maxLimit: 2 }
    },
    resources: [
      { resourceId: 'res-api', name: 'GitHub API Quota', type: 'EXTERNAL_API', totalCapacity: 100, allocatedAmount: 100, availableAmount: 0, unit: 'req/min', contendingProjects: ['proj-1'] }
    ]
  });

  const resOps = answerCompanyOSQuestion('¿Cuánto trabajo autónomo está activo?', snap);
  assert.ok(resOps.answer.includes('1 operación(es) autónoma(s)'));

  const resRes = answerCompanyOSQuestion('¿Qué recursos están limitando el trabajo?', snap);
  assert.ok(resRes.answer.includes('GitHub API Quota'));
});

test('ALI9-08: Q14 & Q15 Governance risks & App shutdown safety', () => {
  const snap = sampleSnapshot({
    health: { status: 'HEALTHY', score: 100, reasonCodes: ['ALL_SYSTEMS_OPERATIONAL'], evidenceRefs: [], lastCalculatedAt: clock }
  });

  const resRisk = answerCompanyOSQuestion('¿Hay algún riesgo o problema de gobernanza?', snap);
  assert.ok(resRisk.answer.includes('HEALTHY'));

  const resClose = answerCompanyOSQuestion('¿Qué pasa si cierro La Pitaya ahora?', snap);
  assert.ok(resClose.answer.includes('preserva de forma segura'));
});

test('ALI9-09: False Premise Refutations (FP1 to FP8)', () => {
  const snap = sampleSnapshot();

  const fp1 = answerCompanyOSQuestion('El proyecto prioritario puede saltarse CIMA para ir más rápido', snap);
  assert.equal(fp1.isRefutation, true);
  assert.ok(fp1.facts.includes('PRIORITY != RISK'));

  const fp2 = answerCompanyOSQuestion('El Inge puede crear un nuevo objetivo estratégico', snap);
  assert.equal(fp2.isRefutation, true);
  assert.ok(fp2.facts.includes('HUMAN_STRATEGIC_AUTHORITY'));

  const fp3 = answerCompanyOSQuestion('Un agente disponible puede asignarse solo sin esperar a El Inge', snap);
  assert.equal(fp3.isRefutation, true);
  assert.ok(fp3.facts.includes('AVAILABLE != ASSIGNED'));

  const fp4 = answerCompanyOSQuestion('Si un recurso existe, cualquier agente puede usarlo libremente', snap);
  assert.equal(fp4.isRefutation, true);
  assert.ok(fp4.facts.includes('RESOURCE_AVAILABLE != PERMITTED'));

  const fp5 = answerCompanyOSQuestion('Company Pause borra las operaciones anteriores', snap);
  assert.equal(fp5.isRefutation, true);
  assert.ok(fp5.facts.includes('PAUSE_NON_DESTRUCTIVE'));

  const fp6 = answerCompanyOSQuestion('Reiniciar La Pitaya vuelve a autorizar todo automáticamente', snap);
  assert.equal(fp6.isRefutation, true);
  assert.ok(fp6.facts.includes('RESTART != REAUTHORIZATION'));

  const fp7 = answerCompanyOSQuestion('El proyecto con mayor prioridad puede usar el presupuesto de otro proyecto', snap);
  assert.equal(fp7.isRefutation, true);
  assert.ok(fp7.facts.includes('PROJECT_BUDGET_ISOLATION'));

  const fp8 = answerCompanyOSQuestion('Una Skill activa tiene permiso global para ejecutar cualquier comando', snap);
  assert.equal(fp8.isRefutation, true);
  assert.ok(fp8.facts.includes('SKILL != AUTHORIZATION'));
});

test('ALI9-10: Action requests trigger intent proposal with 0 mutations', () => {
  const snap = sampleSnapshot();
  const res = answerCompanyOSQuestion('Prioriza Proyecto Beta', snap);

  assert.equal(res.intentProposal, true);
  assert.ok(res.facts.includes('INTENT_BOUNDARY_CROSSING_REQUIRED'));
});
