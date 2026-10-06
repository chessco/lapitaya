'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  VirtualCompanyOSService
} = loadTs('src/main/virtualCompanyOS.ts');

const {
  cloneCompanyOSSnapshot
} = loadTs('src/shared/lapitaya/company/osTypes.ts');

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

test('SNAP9-01: snapshot building produces valid CompanyOSSnapshot with schemaVersion 2', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  const snapshot = os.getSnapshot();

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.company.id, 'lapitaya');
  assert.equal(snapshot.company.name, 'La Pitaya');
  assert.ok(snapshot.portfolio);
  assert.ok(snapshot.workQueue);
  assert.ok(snapshot.teams);
  assert.ok(snapshot.capacity);
  assert.ok(snapshot.metrics);
  assert.ok(snapshot.health);
  assert.ok(snapshot.humanAttentionCenter);
  assert.ok(snapshot.operationsCenter);
  assert.equal(snapshot.isPaused, false);
});

test('SNAP9-02: legacy backward compatibility preserves all FASE 4-8 fields', () => {
  const os = new VirtualCompanyOSService({
    now: () => ++clock,
    getLegacySnapshot: () => ({
      version: 1,
      company: { id: 'lapitaya', name: 'La Pitaya' },
      status: 'WORKING',
      session: {
        sessionId: 'sess-1',
        taskId: 'LP-1',
        project: { projectId: 'proj-1', displayName: 'Alpha', workspace: null, repository: null, branch: null },
        startedAt: clock,
        endedAt: null,
        status: 'ACTIVE',
        participants: ['el-inge', 'rosalba'],
        currentPhase: 'BUILD',
        assignments: [],
        humanAttention: null,
        outcome: null,
        completedPhases: [],
        timeline: []
      },
      project: { projectId: 'proj-1', displayName: 'Alpha', workspace: null, repository: null, branch: null },
      activeTeam: ['el-inge', 'rosalba'],
      agents: [
        { agentId: 'el-inge', state: 'WORKING', assignment: null, expectedPhase: null, verified: true },
        { agentId: 'rosalba', state: 'WORKING', assignment: null, expectedPhase: null, verified: true }
      ],
      currentPhase: 'BUILD',
      activeAssignments: [],
      expectedNext: [{ agentId: 'margarito', phase: 'TEST' }],
      humanAttention: null,
      recentVerifiedEvents: [],
      executionAwake: true
    })
  });

  const snapshot = os.getSnapshot();
  assert.equal(snapshot.status, 'WORKING');
  assert.equal(snapshot.currentPhase, 'BUILD');
  assert.deepEqual(snapshot.activeTeam, ['el-inge', 'rosalba']);
  assert.equal(snapshot.executionAwake, true);
  assert.equal(snapshot.expectedNext[0].agentId, 'margarito');
});

test('SNAP9-03: snapshot cloning is deterministic and serializable', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  const snapshot = os.getSnapshot();
  const cloned = cloneCompanyOSSnapshot(snapshot);

  assert.deepEqual(cloned, snapshot);
  assert.notEqual(cloned, snapshot); // different reference
});

test('SNAP9-04: snapshot bounded array limits', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  const snapshot = os.getSnapshot();

  assert.equal(snapshot.capacity.length, 8);
  assert.equal(snapshot.teams.length, 4);
  assert.ok(Array.isArray(snapshot.recentVerifiedEvents));
});

test('SNAP9-05: executionAwake state reflected accurately', () => {
  const os = new VirtualCompanyOSService({
    now: () => ++clock,
    getLegacySnapshot: () => ({
      version: 1,
      company: { id: 'lapitaya', name: 'La Pitaya' },
      status: 'IDLE',
      session: null,
      project: { projectId: null, displayName: null, workspace: null, repository: null, branch: null },
      activeTeam: [],
      agents: [],
      currentPhase: null,
      activeAssignments: [],
      expectedNext: [],
      humanAttention: null,
      recentVerifiedEvents: [],
      executionAwake: false
    })
  });

  assert.equal(os.getSnapshot().executionAwake, false);
});

test('SNAP9-06: snapshot has zero authority tokens or secret leaks', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  const snapshotStr = JSON.stringify(os.getSnapshot());

  assert.doesNotMatch(snapshotStr, /authToken|secretKey|privateKey|adminOverride/i);
});

test('SNAP9-07: multi-project portfolio projection matches internal state', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  const p = sampleProject('proj-alpha');
  const m = sampleMission('proj-alpha', 'm-alpha');
  os.setProjectPriority('proj-alpha', 'CRITICAL');

  os.syncPortfolioAndQueue({
    projects: [p],
    missions: [m],
    deliveries: []
  });

  const snapshot = os.getSnapshot();
  assert.equal(snapshot.portfolio.summary.totalProjects, 1);
  assert.equal(snapshot.portfolio.projects[0].priority, 'CRITICAL');
  assert.equal(snapshot.workQueue.items[0].missionId, 'm-alpha');
});

test('SNAP9-08: agent capacity projection reflects live assignments', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  os.assignAgent({
    agentId: 'rosalba',
    projectId: 'proj-1',
    missionId: 'm-1',
    phase: 'BUILD'
  });

  const snapshot = os.getSnapshot();
  const rosalbaCap = snapshot.capacity.find((c) => c.agentId === 'rosalba');
  assert.equal(rosalbaCap.state, 'ASSIGNED');
  assert.equal(rosalbaCap.currentAssignment.projectId, 'proj-1');
});

test('SNAP9-09: human attention center projection includes pending items', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  os.addHumanAttentionItem({
    reason: 'HIGH_RISK_APPROVAL',
    severity: 'CRITICAL',
    projectId: 'proj-1',
    missionId: 'm-1',
    operationId: 'op-1',
    summary: 'Needs approval'
  });

  const snapshot = os.getSnapshot();
  assert.equal(snapshot.humanAttentionCenter.criticalCount, 1);
  assert.equal(snapshot.humanAttentionCenter.hasBlockingIssues, true);
  assert.equal(snapshot.humanAttentionCenter.items[0].reason, 'HIGH_RISK_APPROVAL');
});

test('SNAP9-10: company pause is surfaced in snapshot', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  assert.equal(os.getSnapshot().isPaused, false);

  os.pauseCompany('Maintenance');
  assert.equal(os.getSnapshot().isPaused, true);

  os.resumeCompany();
  assert.equal(os.getSnapshot().isPaused, false);
});
