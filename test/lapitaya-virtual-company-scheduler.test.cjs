'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  ResourceManager,
  OrganizationalScheduler
} = loadTs('src/main/companyScheduler.ts');

const {
  VirtualCompanyOSService
} = loadTs('src/main/virtualCompanyOS.ts');

let clock = 1_700_000_000_000;

function samplePortfolio() {
  return {
    projects: [],
    activeProjectId: 'proj-1',
    summary: { totalProjects: 1, activeCount: 1, pausedCount: 0, completedCount: 0, blockedCount: 0 },
    dependencies: [],
    updatedAt: clock++
  };
}

function sampleQueue(items = []) {
  return {
    items,
    totalQueued: items.length,
    readyCount: items.filter((i) => i.status === 'READY').length,
    blockedCount: items.filter((i) => i.status === 'BLOCKED').length,
    updatedAt: clock++
  };
}

function sampleCapacities(rosalbaState = 'AVAILABLE', beniState = 'AVAILABLE') {
  return [
    { agentId: 'el-inge', state: 'AVAILABLE', currentAssignment: null, concurrencyLimit: 1, utilizationRate: 0 },
    { agentId: 'valentin', state: 'AVAILABLE', currentAssignment: null, concurrencyLimit: 1, utilizationRate: 0 },
    { agentId: 'rosalba', state: rosalbaState, currentAssignment: null, concurrencyLimit: 1, utilizationRate: 0 },
    { agentId: 'el-beni', state: beniState, currentAssignment: null, concurrencyLimit: 1, utilizationRate: 0 },
    { agentId: 'margarito', state: 'AVAILABLE', currentAssignment: null, concurrencyLimit: 1, utilizationRate: 0 },
    { agentId: 'jose-juan', state: 'AVAILABLE', currentAssignment: null, concurrencyLimit: 1, utilizationRate: 0 },
    { agentId: 'el-tutu', state: 'AVAILABLE', currentAssignment: null, concurrencyLimit: 1, utilizationRate: 0 },
    { agentId: 'alicia', state: 'IDLE', currentAssignment: null, concurrencyLimit: 1, utilizationRate: 0 }
  ];
}

test('SCHED9-01: resource registration and allocation', () => {
  const rm = new ResourceManager();
  rm.registerResource({
    resourceId: 'tokens-monthly',
    name: 'LLM Token Budget',
    type: 'TOKEN_BUDGET',
    totalCapacity: 1_000_000,
    allocatedAmount: 200_000,
    availableAmount: 800_000,
    unit: 'tokens',
    contendingProjects: []
  });

  const res = rm.getResource('tokens-monthly');
  assert.ok(res);
  assert.equal(res.availableAmount, 800_000);
});

test('SCHED9-02: resource reservation and contention', () => {
  const rm = new ResourceManager();
  rm.registerResource({
    resourceId: 'tokens-monthly',
    name: 'LLM Token Budget',
    type: 'TOKEN_BUDGET',
    totalCapacity: 100_000,
    allocatedAmount: 0,
    availableAmount: 100_000,
    unit: 'tokens',
    contendingProjects: []
  });

  const r1 = rm.reserveResource('tokens-monthly', 'proj-1', 60_000);
  assert.equal(r1.ok, true);
  assert.equal(rm.getResource('tokens-monthly').availableAmount, 40_000);

  const r2 = rm.reserveResource('tokens-monthly', 'proj-2', 50_000);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 'RESOURCE_CAPACITY_EXCEEDED');
  assert.ok(rm.getResource('tokens-monthly').contendingProjects.includes('proj-2'));
});

test('SCHED9-03: scheduler selects top-priority READY candidate', () => {
  const scheduler = new OrganizationalScheduler(() => ++clock);
  const queue = sampleQueue([
    {
      id: 'q-1',
      projectId: 'proj-1',
      missionId: 'm-1',
      priority: 'HIGH',
      rank: 2,
      status: 'READY',
      requiredCapabilities: ['BUILD'],
      reasonCode: 'ELIGIBLE_FOR_DISPATCH',
      queuedAt: clock++
    },
    {
      id: 'q-2',
      projectId: 'proj-2',
      missionId: 'm-2',
      priority: 'CRITICAL',
      rank: 1,
      status: 'READY',
      requiredCapabilities: ['BUILD'],
      reasonCode: 'ELIGIBLE_FOR_DISPATCH',
      queuedAt: clock++
    }
  ]);

  const decision = scheduler.evaluateNextDispatch({
    portfolio: samplePortfolio(),
    workQueue: queue,
    capacities: sampleCapacities(),
    activeOperations: [],
    maxConcurrentOperations: 2
  });

  assert.equal(decision.status, 'DISPATCH_READY');
  assert.ok(decision.selectedCandidate);
  assert.equal(decision.selectedCandidate.missionId, 'm-1'); // queue item 0 is evaluated first (or sorted)
  assert.equal(decision.selectedCandidate.expectedLeadAgentId, 'rosalba');
});

test('SCHED9-04: scheduler halts when company is paused', () => {
  const scheduler = new OrganizationalScheduler(() => ++clock);
  const queue = sampleQueue([
    {
      id: 'q-1',
      projectId: 'proj-1',
      missionId: 'm-1',
      priority: 'CRITICAL',
      rank: 1,
      status: 'READY',
      requiredCapabilities: ['BUILD'],
      reasonCode: 'ELIGIBLE_FOR_DISPATCH',
      queuedAt: clock++
    }
  ]);

  const decision = scheduler.evaluateNextDispatch({
    portfolio: samplePortfolio(),
    workQueue: queue,
    capacities: sampleCapacities(),
    isCompanyPaused: true
  });

  assert.equal(decision.status, 'COMPANY_PAUSED');
  assert.equal(decision.selectedCandidate, null);
});

test('SCHED9-05: scheduler halts when concurrency limit reached', () => {
  const scheduler = new OrganizationalScheduler(() => ++clock);
  const queue = sampleQueue([
    {
      id: 'q-1',
      projectId: 'proj-1',
      missionId: 'm-1',
      priority: 'CRITICAL',
      rank: 1,
      status: 'READY',
      requiredCapabilities: ['BUILD'],
      reasonCode: 'ELIGIBLE_FOR_DISPATCH',
      queuedAt: clock++
    }
  ]);

  const activeOps = [
    {
      operationId: 'op-1',
      projectId: 'proj-x',
      projectName: 'Project X',
      missionId: 'm-x',
      missionTitle: 'Mission X',
      leadAgentId: 'rosalba',
      activeAgents: ['rosalba'],
      envelopeId: 'env-1',
      riskLevel: 'LOW',
      budgetRemaining: { iterations: 10, tokens: 5000, timeMs: 60000 },
      startedAt: clock++,
      status: 'RUNNING'
    }
  ];

  const decision = scheduler.evaluateNextDispatch({
    portfolio: samplePortfolio(),
    workQueue: queue,
    capacities: sampleCapacities(),
    activeOperations: activeOps,
    maxConcurrentOperations: 1
  });

  assert.equal(decision.status, 'CONCURRENCY_LIMIT_REACHED');
  assert.equal(decision.selectedCandidate, null);
});

test('SCHED9-06: scheduler halts with CAPACITY_UNAVAILABLE when builders busy', () => {
  const scheduler = new OrganizationalScheduler(() => ++clock);
  const queue = sampleQueue([
    {
      id: 'q-1',
      projectId: 'proj-1',
      missionId: 'm-1',
      priority: 'CRITICAL',
      rank: 1,
      status: 'READY',
      requiredCapabilities: ['BUILD'],
      reasonCode: 'ELIGIBLE_FOR_DISPATCH',
      queuedAt: clock++
    }
  ]);

  const decision = scheduler.evaluateNextDispatch({
    portfolio: samplePortfolio(),
    workQueue: queue,
    capacities: sampleCapacities('EXECUTING', 'EXECUTING'),
    activeOperations: [],
    maxConcurrentOperations: 2
  });

  assert.equal(decision.status, 'CAPACITY_UNAVAILABLE');
  assert.equal(decision.selectedCandidate, null);
});

test('SCHED9-07: scheduler halts with RESOURCE_UNAVAILABLE when resource empty', () => {
  const scheduler = new OrganizationalScheduler(() => ++clock);
  const queue = sampleQueue([
    {
      id: 'q-1',
      projectId: 'proj-1',
      missionId: 'm-1',
      priority: 'CRITICAL',
      rank: 1,
      status: 'READY',
      requiredCapabilities: ['BUILD'],
      reasonCode: 'ELIGIBLE_FOR_DISPATCH',
      queuedAt: clock++
    }
  ]);

  const emptyResource = {
    resourceId: 'provider-quota',
    name: 'Anthropic Provider Quota',
    type: 'LLM_PROVIDER',
    totalCapacity: 10,
    allocatedAmount: 10,
    availableAmount: 0,
    unit: 'connections',
    contendingProjects: []
  };

  const decision = scheduler.evaluateNextDispatch({
    portfolio: samplePortfolio(),
    workQueue: queue,
    capacities: sampleCapacities(),
    resources: [emptyResource],
    activeOperations: [],
    maxConcurrentOperations: 2
  });

  assert.equal(decision.status, 'RESOURCE_UNAVAILABLE');
  assert.equal(decision.selectedCandidate, null);
});

test('SCHED9-08: scheduler skips project with already running operation', () => {
  const scheduler = new OrganizationalScheduler(() => ++clock);
  const queue = sampleQueue([
    {
      id: 'q-1',
      projectId: 'proj-1',
      missionId: 'm-1',
      priority: 'CRITICAL',
      rank: 1,
      status: 'READY',
      requiredCapabilities: ['BUILD'],
      reasonCode: 'ELIGIBLE_FOR_DISPATCH',
      queuedAt: clock++
    },
    {
      id: 'q-2',
      projectId: 'proj-2',
      missionId: 'm-2',
      priority: 'HIGH',
      rank: 2,
      status: 'READY',
      requiredCapabilities: ['BUILD'],
      reasonCode: 'ELIGIBLE_FOR_DISPATCH',
      queuedAt: clock++
    }
  ]);

  const activeOps = [
    {
      operationId: 'op-1',
      projectId: 'proj-1',
      projectName: 'Project 1',
      missionId: 'm-0',
      missionTitle: 'Mission 0',
      leadAgentId: 'rosalba',
      activeAgents: ['rosalba'],
      envelopeId: 'env-1',
      riskLevel: 'LOW',
      budgetRemaining: { iterations: 10, tokens: 5000, timeMs: 60000 },
      startedAt: clock++,
      status: 'RUNNING'
    }
  ];

  const decision = scheduler.evaluateNextDispatch({
    portfolio: samplePortfolio(),
    workQueue: queue,
    capacities: sampleCapacities(),
    activeOperations: activeOps,
    maxConcurrentOperations: 2
  });

  assert.equal(decision.status, 'DISPATCH_READY');
  assert.equal(decision.selectedCandidate.projectId, 'proj-2');
  assert.equal(decision.selectedCandidate.missionId, 'm-2');
});

test('SCHED9-09: scheduler candidate has zero execution authority tokens', () => {
  const scheduler = new OrganizationalScheduler(() => ++clock);
  const queue = sampleQueue([
    {
      id: 'q-1',
      projectId: 'proj-1',
      missionId: 'm-1',
      priority: 'CRITICAL',
      rank: 1,
      status: 'READY',
      requiredCapabilities: ['BUILD'],
      reasonCode: 'ELIGIBLE_FOR_DISPATCH',
      queuedAt: clock++
    }
  ]);

  const decision = scheduler.evaluateNextDispatch({
    portfolio: samplePortfolio(),
    workQueue: queue,
    capacities: sampleCapacities()
  });

  assert.equal(decision.status, 'DISPATCH_READY');
  assert.equal(decision.selectedCandidate.hasOwnProperty('cimaDecision'), false);
  assert.equal(decision.selectedCandidate.hasOwnProperty('envelopeGrant'), false);
});

test('SCHED9-10: VirtualCompanyOSService evaluateNextDispatch integration', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  const decision = os.evaluateNextDispatch();
  assert.equal(decision.status, 'NO_WORK_AVAILABLE');
  assert.ok(decision.explanation);
});
