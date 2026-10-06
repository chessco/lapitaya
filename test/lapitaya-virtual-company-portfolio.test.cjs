'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  VirtualCompanyOSService
} = loadTs('src/main/virtualCompanyOS.ts');

const {
  PriorityManager,
  DependencyEngine,
  priorityRank,
  aggregatePortfolio,
  buildWorkQueue
} = loadTs('src/main/companyPortfolio.ts');

let clock = 1_700_000_000_000;

function sampleProject(id, name = `Project ${id}`, status = 'ACTIVE') {
  return {
    projectId: id,
    name,
    objective: `Objective for ${name}`,
    status,
    createdAt: clock++,
    updatedAt: clock++,
    createdBy: 'human',
    acceptanceCriteria: [{ text: 'Works', provenance: 'HUMAN', verified: true }],
    missionIds: [],
    verified: true
  };
}

function sampleMission(projectId, id, title = `Mission ${id}`, status = 'CONFIRMED', dependencies = []) {
  return {
    missionId: id,
    projectId,
    title,
    objective: `Objective for ${title}`,
    acceptanceCriteria: [{ text: 'Done', provenance: 'HUMAN', verified: true }],
    provenance: 'HUMAN',
    dependencies,
    status,
    workRequestIds: [],
    deliveryIds: [],
    plan: {
      missionId: id,
      objective: `Objective for ${title}`,
      milestones: [],
      proposedWork: [{ id: `${id}-step-1`, title: 'Build', phase: 'BUILD', description: 'Code', expectedAgentId: 'rosalba' }],
      dependencies,
      acceptanceCriteria: [{ text: 'Done', provenance: 'HUMAN', verified: true }],
      status: 'CONFIRMED',
      createdBy: 'el-inge',
      createdAt: clock++,
      verified: true
    },
    createdAt: clock++,
    updatedAt: clock++,
    confirmedAt: clock++,
    confirmedBy: 'human',
    verified: true
  };
}

function sampleDelivery(missionId, outcome = 'PASS') {
  return {
    requestId: `req-${missionId}`,
    taskId: `task-${missionId}`,
    missionId,
    outcome,
    summary: `Delivery for ${missionId}`,
    artifacts: ['artifact.js'],
    completedAt: clock++,
    evidenceRefs: ['ev-1'],
    verified: true
  };
}

test('PORT9-01: multi-project portfolio aggregation', () => {
  const p1 = sampleProject('proj-1', 'Alpha', 'ACTIVE');
  const p2 = sampleProject('proj-2', 'Beta', 'COMPLETED');
  const m1 = sampleMission('proj-1', 'm-1');
  const m2 = sampleMission('proj-2', 'm-2', 'Beta Mission', 'COMPLETED');
  const d2 = sampleDelivery('m-2', 'PASS');

  const pm = new PriorityManager(() => clock);
  const de = new DependencyEngine();

  const portfolio = aggregatePortfolio({
    projects: [p1, p2],
    missions: [m1, m2],
    deliveries: [d2],
    priorityManager: pm,
    dependencyEngine: de,
    now: () => clock
  });

  assert.equal(portfolio.summary.totalProjects, 2);
  assert.equal(portfolio.summary.activeCount, 1);
  assert.equal(portfolio.summary.completedCount, 1);
  assert.equal(portfolio.projects[0].projectId, 'proj-1');
  assert.equal(portfolio.projects[1].progress.percentComplete, 100);
});

test('PORT9-02: project health calculation from blockers', () => {
  const p1 = sampleProject('proj-1', 'Alpha', 'ACTIVE');
  const m1 = sampleMission('proj-1', 'm-1');
  const pm = new PriorityManager(() => clock);
  const de = new DependencyEngine();

  const portfolioWithBlocker = aggregatePortfolio({
    projects: [p1],
    missions: [m1],
    deliveries: [],
    humanAttentionItems: [
      {
        id: 'attn-1',
        reason: 'HIGH_RISK_APPROVAL',
        severity: 'CRITICAL',
        projectId: 'proj-1',
        missionId: 'm-1',
        operationId: null,
        summary: 'Requires DB write permission',
        context: {},
        createdAt: clock,
        verified: true
      }
    ],
    priorityManager: pm,
    dependencyEngine: de,
    now: () => clock
  });

  assert.equal(portfolioWithBlocker.projects[0].health, 'BLOCKED');
  assert.equal(portfolioWithBlocker.projects[0].humanBlockerCount, 1);
});

test('PORT9-03: priority management and ranks', () => {
  const pm = new PriorityManager(() => clock);
  assert.equal(priorityRank('CRITICAL'), 1);
  assert.equal(priorityRank('HIGH'), 2);
  assert.equal(priorityRank('NORMAL'), 3);
  assert.equal(priorityRank('LOW'), 4);

  const def = pm.setProjectPriority('proj-alpha', 'CRITICAL', 'Executive urgent requirement', 'human', 'HUMAN');
  assert.equal(def.level, 'CRITICAL');
  assert.equal(def.rank, 1);
  assert.equal(def.provenance, 'HUMAN');
  assert.equal(pm.getProjectPriority('proj-alpha'), 'CRITICAL');
});

test('PORT9-04: work queue sorts by priority rank ASC', () => {
  const pAlpha = sampleProject('proj-alpha', 'Alpha');
  const pBeta = sampleProject('proj-beta', 'Beta');
  const mAlpha = sampleMission('proj-alpha', 'm-alpha');
  const mBeta = sampleMission('proj-beta', 'm-beta');

  const pm = new PriorityManager(() => clock);
  pm.setProjectPriority('proj-alpha', 'NORMAL');
  pm.setProjectPriority('proj-beta', 'CRITICAL');
  const de = new DependencyEngine();

  const queue = buildWorkQueue({
    projects: [pAlpha, pBeta],
    missions: [mAlpha, mBeta],
    deliveries: [],
    priorityManager: pm,
    dependencyEngine: de,
    now: () => clock
  });

  assert.equal(queue.items.length, 2);
  assert.equal(queue.items[0].missionId, 'm-beta');
  assert.equal(queue.items[0].priority, 'CRITICAL');
  assert.equal(queue.items[1].missionId, 'm-alpha');
  assert.equal(queue.items[1].priority, 'NORMAL');
});

test('PORT9-05: mission prerequisites block downstream queue items', () => {
  const p = sampleProject('proj-1');
  const m1 = sampleMission('proj-1', 'm-1');
  const m2 = sampleMission('proj-1', 'm-2', 'Mission 2', 'CONFIRMED', ['m-1']);

  const pm = new PriorityManager(() => clock);
  const de = new DependencyEngine();

  const queueBefore = buildWorkQueue({
    projects: [p],
    missions: [m1, m2],
    deliveries: [],
    priorityManager: pm,
    dependencyEngine: de,
    now: () => clock
  });

  const itemM2 = queueBefore.items.find((i) => i.missionId === 'm-2');
  assert.equal(itemM2.status, 'WAITING_DEPENDENCY');
  assert.ok(itemM2.reasonCode.includes('MISSION_PREREQUISITE_PENDING'));

  const d1 = sampleDelivery('m-1', 'PASS');
  const queueAfter = buildWorkQueue({
    projects: [p],
    missions: [m1, m2],
    deliveries: [d1],
    priorityManager: pm,
    dependencyEngine: de,
    now: () => clock
  });

  const itemM2After = queueAfter.items.find((i) => i.missionId === 'm-2');
  assert.equal(itemM2After.status, 'READY');
});

test('PORT9-06: cross-project dependencies block dependent projects', () => {
  const pA = sampleProject('proj-a', 'Project A');
  const pB = sampleProject('proj-b', 'Project B');
  const mA = sampleMission('proj-a', 'm-a');
  const mB = sampleMission('proj-b', 'm-b');

  const pm = new PriorityManager(() => clock);
  const de = new DependencyEngine();
  de.addDependency('proj-b', 'proj-a', 'Project B requires API from Project A');

  const queue = buildWorkQueue({
    projects: [pA, pB],
    missions: [mA, mB],
    deliveries: [],
    priorityManager: pm,
    dependencyEngine: de,
    now: () => clock
  });

  const itemB = queue.items.find((i) => i.projectId === 'proj-b');
  assert.equal(itemB.status, 'WAITING_DEPENDENCY');
  assert.equal(itemB.reasonCode, 'CROSS_PROJECT_PREREQUISITE_PENDING');
});

test('PORT9-07: cycle detection marks cyclic projects as BLOCKED', () => {
  const pA = sampleProject('proj-a');
  const pB = sampleProject('proj-b');
  const mA = sampleMission('proj-a', 'm-a');
  const mB = sampleMission('proj-b', 'm-b');

  const pm = new PriorityManager(() => clock);
  const de = new DependencyEngine();
  de.addDependency('proj-a', 'proj-b', 'A needs B');
  de.addDependency('proj-b', 'proj-a', 'B needs A');

  const cycles = de.detectCycles();
  assert.ok(cycles.includes('proj-a') || cycles.includes('proj-b'));

  const queue = buildWorkQueue({
    projects: [pA, pB],
    missions: [mA, mB],
    deliveries: [],
    priorityManager: pm,
    dependencyEngine: de,
    now: () => clock
  });

  for (const item of queue.items) {
    assert.equal(item.status, 'BLOCKED');
    assert.equal(item.reasonCode, 'CYCLIC_DEPENDENCY_DETECTED');
  }
});

test('PORT9-08: company pause blocks work queue', () => {
  const p = sampleProject('proj-1');
  const m = sampleMission('proj-1', 'm-1');
  const pm = new PriorityManager(() => clock);
  const de = new DependencyEngine();

  const queue = buildWorkQueue({
    projects: [p],
    missions: [m],
    deliveries: [],
    priorityManager: pm,
    dependencyEngine: de,
    isCompanyPaused: true,
    now: () => clock
  });

  assert.equal(queue.readyCount, 0);
  assert.equal(queue.items[0].status, 'BLOCKED');
  assert.equal(queue.items[0].reasonCode, 'COMPANY_PAUSED');
});

test('PORT9-09: queue invariant QUEUED != AUTHORIZED & READY != AUTHORIZED', () => {
  const p = sampleProject('proj-1');
  const m = sampleMission('proj-1', 'm-1');
  const pm = new PriorityManager(() => clock);
  const de = new DependencyEngine();

  const queue = buildWorkQueue({
    projects: [p],
    missions: [m],
    deliveries: [],
    priorityManager: pm,
    dependencyEngine: de,
    now: () => clock
  });

  const readyItem = queue.items[0];
  assert.equal(readyItem.status, 'READY');
  // Invariant check: queue item possesses no CIMA token or execution authorization
  assert.equal(readyItem.hasOwnProperty('cimaDecision'), false);
  assert.equal(readyItem.hasOwnProperty('authSignature'), false);
});

test('PORT9-10: VirtualCompanyOSService syncPortfolioAndQueue updates state', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  const p1 = sampleProject('proj-1', 'Alpha');
  const m1 = sampleMission('proj-1', 'm-1');
  os.setProjectPriority('proj-1', 'HIGH', 'Sprint focus');

  const { portfolio, workQueue } = os.syncPortfolioAndQueue({
    projects: [p1],
    missions: [m1],
    deliveries: []
  });

  assert.equal(portfolio.summary.totalProjects, 1);
  assert.equal(portfolio.projects[0].priority, 'HIGH');
  assert.equal(workQueue.items.length, 1);
  assert.equal(workQueue.items[0].priority, 'HIGH');
  assert.equal(workQueue.items[0].rank, 2);
  assert.equal(os.getSnapshot().portfolio.summary.totalProjects, 1);
});
