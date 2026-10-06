'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  calculateCompanyMetrics,
  calculateCompanyHealth
} = loadTs('src/main/companyHealth.ts');

const {
  VirtualCompanyOSService
} = loadTs('src/main/virtualCompanyOS.ts');

let clock = 1_700_000_000_000;

function sampleProject(id = 'proj-1') {
  return {
    projectId: id,
    name: 'Project 1',
    objective: 'Objective 1',
    status: 'ACTIVE',
    createdAt: clock,
    updatedAt: clock,
    createdBy: 'human',
    acceptanceCriteria: [],
    missionIds: [],
    verified: true
  };
}

function sampleMission(projectId = 'proj-1', id = 'm-1') {
  return {
    missionId: id,
    projectId,
    title: 'Mission 1',
    objective: 'Mission 1 Objective',
    acceptanceCriteria: [],
    provenance: 'HUMAN',
    dependencies: [],
    status: 'ACTIVE',
    workRequestIds: [],
    deliveryIds: [],
    plan: null,
    createdAt: clock,
    updatedAt: clock,
    confirmedAt: clock,
    confirmedBy: 'human',
    verified: true
  };
}

test('HEALTH9-01: healthy state with zero blockers and 100% pass rate', () => {
  const metrics = calculateCompanyMetrics({
    projects: [sampleProject()],
    missions: [sampleMission()],
    deliveries: [
      {
        requestId: 'req-1',
        taskId: 'task-1',
        missionId: 'm-1',
        outcome: 'PASS',
        summary: 'Success',
        artifacts: [],
        completedAt: clock + 5000,
        evidenceRefs: ['ev-1'],
        verified: true
      }
    ]
  });

  const health = calculateCompanyHealth(
    {
      metrics,
      humanAttentionItems: [],
      isCompanyPaused: false
    },
    () => clock
  );

  assert.equal(health.status, 'HEALTHY');
  assert.equal(health.score, 100);
  assert.ok(health.reasonCodes.includes('ALL_SYSTEMS_OPERATIONAL'));
});

test('HEALTH9-02: health is BLOCKED when high severity attention items exist', () => {
  const metrics = calculateCompanyMetrics({
    projects: [sampleProject()],
    missions: [sampleMission()],
    deliveries: []
  });

  const health = calculateCompanyHealth(
    {
      metrics,
      humanAttentionItems: [
        {
          id: 'attn-1',
          reason: 'BLOCKED_MISSION',
          severity: 'HIGH',
          projectId: 'proj-1',
          missionId: 'm-1',
          operationId: null,
          summary: 'Blocked on external API key',
          context: {},
          createdAt: clock,
          verified: true
        }
      ],
      isCompanyPaused: false
    },
    () => clock
  );

  assert.equal(health.status, 'BLOCKED');
  assert.equal(health.score, 45);
  assert.ok(health.reasonCodes.some((r) => r.includes('HUMAN_ATTENTION_PENDING')));
  assert.deepEqual(health.evidenceRefs, ['attn-1']);
});

test('HEALTH9-03: health is CRITICAL when governance violation exists', () => {
  const metrics = calculateCompanyMetrics({
    projects: [sampleProject()],
    missions: [sampleMission()],
    deliveries: []
  });

  const health = calculateCompanyHealth(
    {
      metrics,
      humanAttentionItems: [
        {
          id: 'attn-gov-1',
          reason: 'GOVERNANCE_VIOLATION',
          severity: 'CRITICAL',
          projectId: 'proj-1',
          missionId: 'm-1',
          operationId: 'op-1',
          summary: 'Unauthorized policy override attempt',
          context: {},
          createdAt: clock,
          verified: true
        }
      ],
      isCompanyPaused: false
    },
    () => clock
  );

  assert.equal(health.status, 'CRITICAL');
  assert.equal(health.score, 20);
  assert.ok(health.reasonCodes.includes('GOVERNANCE_VIOLATION_DETECTED'));
  assert.deepEqual(health.evidenceRefs, ['attn-gov-1']);
});

test('HEALTH9-04: pass rate and audit failure rate derivation', () => {
  const metrics = calculateCompanyMetrics({
    projects: [sampleProject()],
    missions: [sampleMission()],
    deliveries: [
      { requestId: 'r1', taskId: 't1', missionId: 'm-1', outcome: 'PASS', summary: '1', artifacts: [], completedAt: clock, evidenceRefs: [], verified: true },
      { requestId: 'r2', taskId: 't2', missionId: 'm-2', outcome: 'PASS', summary: '2', artifacts: [], completedAt: clock, evidenceRefs: [], verified: true },
      { requestId: 'r3', taskId: 't3', missionId: 'm-3', outcome: 'FAIL', summary: '3', artifacts: [], completedAt: clock, evidenceRefs: [], verified: true },
      { requestId: 'r4', taskId: 't4', missionId: 'm-4', outcome: 'PASS', summary: '4', artifacts: [], completedAt: clock, evidenceRefs: [], verified: true }
    ]
  });

  assert.equal(metrics.completedDeliveries, 4);
  assert.equal(metrics.overallPassRate, 0.75);
  assert.equal(metrics.auditFailureRate, 0.25);
});

test('HEALTH9-05: average cycle time calculation', () => {
  const m1 = sampleMission('proj-1', 'm-1');
  m1.createdAt = 1000;
  const m2 = sampleMission('proj-1', 'm-2');
  m2.createdAt = 2000;

  const deliveries = [
    { requestId: 'r1', taskId: 't1', missionId: 'm-1', outcome: 'PASS', summary: '1', artifacts: [], completedAt: 5000, evidenceRefs: [], verified: true }, // duration: 4000
    { requestId: 'r2', taskId: 't2', missionId: 'm-2', outcome: 'PASS', summary: '2', artifacts: [], completedAt: 8000, evidenceRefs: [], verified: true }  // duration: 6000
  ];

  const metrics = calculateCompanyMetrics({
    projects: [sampleProject()],
    missions: [m1, m2],
    deliveries
  });

  assert.equal(metrics.averageCycleTimeMs, 5000); // (4000 + 6000) / 2
});

test('HEALTH9-06: company pause derives DEGRADED health status', () => {
  const metrics = calculateCompanyMetrics({
    projects: [sampleProject()],
    missions: [sampleMission()],
    deliveries: []
  });

  const health = calculateCompanyHealth(
    {
      metrics,
      humanAttentionItems: [],
      isCompanyPaused: true
    },
    () => clock
  );

  assert.equal(health.status, 'DEGRADED');
  assert.equal(health.score, 60);
  assert.ok(health.reasonCodes.includes('COMPANY_PAUSED_BY_HUMAN'));
});

test('HEALTH9-07: budget exhaustion surfaces BLOCKED health state', () => {
  const metrics = calculateCompanyMetrics({
    projects: [sampleProject()],
    missions: [sampleMission()],
    deliveries: []
  });

  const health = calculateCompanyHealth(
    {
      metrics,
      humanAttentionItems: [
        {
          id: 'attn-budget-1',
          reason: 'BUDGET_EXHAUSTED',
          severity: 'CRITICAL',
          projectId: 'proj-1',
          missionId: 'm-1',
          operationId: 'op-1',
          summary: 'Token ceiling reached',
          context: {},
          createdAt: clock,
          verified: true
        }
      ],
      isCompanyPaused: false
    },
    () => clock
  );

  assert.equal(health.status, 'BLOCKED');
  assert.equal(health.score, 30);
  assert.ok(health.reasonCodes.includes('BUDGET_EXHAUSTION_BLOCKED'));
});

test('HEALTH9-08: metrics calculation is a pure evidence-derived function', () => {
  const empty = calculateCompanyMetrics({
    projects: [],
    missions: [],
    deliveries: []
  });

  assert.equal(empty.activeProjects, 0);
  assert.equal(empty.activeMissions, 0);
  assert.equal(empty.overallPassRate, 1.0);
  assert.equal(empty.auditFailureRate, 0.0);
  assert.equal(empty.averageCycleTimeMs, 0);
});

test('HEALTH9-09: VirtualCompanyOSService syncPortfolioAndQueue updates metrics & health', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  const p = sampleProject();
  const m = sampleMission();
  const d = { requestId: 'r1', taskId: 't1', missionId: 'm-1', outcome: 'PASS', summary: '1', artifacts: [], completedAt: clock + 2000, evidenceRefs: [], verified: true };

  os.syncPortfolioAndQueue({
    projects: [p],
    missions: [m],
    deliveries: [d]
  });

  const metrics = os.getMetrics();
  assert.equal(metrics.completedDeliveries, 1);
  assert.equal(metrics.overallPassRate, 1.0);

  const health = os.getHealth();
  assert.equal(health.status, 'HEALTHY');
  assert.equal(health.score, 100);

  const snapshot = os.getSnapshot();
  assert.equal(snapshot.metrics.completedDeliveries, 1);
  assert.equal(snapshot.health.status, 'HEALTHY');
});

test('HEALTH9-10: multiple warnings compound health score degradation', () => {
  const metrics = {
    activeProjects: 1,
    activeMissions: 1,
    runningOperations: 1,
    completedDeliveries: 4,
    overallPassRate: 0.75,
    auditFailureRate: 0.25,
    retryRate: 0.1,
    humanInterventionRate: 0.2,
    autonomyUtilization: 1.0,
    averageCycleTimeMs: 4000,
    adoptedSkillsInUse: 0,
    agentUtilization: { 'el-inge': 0, valentin: 0, rosalba: 0, 'el-beni': 0, margarito: 0, 'jose-juan': 0, 'el-tutu': 0, alicia: 0 }
  };

  const health = calculateCompanyHealth(
    {
      metrics,
      humanAttentionItems: [
        { id: 'attn-1', reason: 'BLOCKED_MISSION', severity: 'HIGH', projectId: 'proj-1', missionId: 'm-1', operationId: null, summary: 'Block', context: {}, createdAt: clock, verified: true }
      ],
      isCompanyPaused: false
    },
    () => clock
  );

  assert.equal(health.status, 'BLOCKED');
  assert.ok(health.score <= 45);
});
