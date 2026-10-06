'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const loadTs = require('./load-ts.cjs');

const { VirtualCompanyOSService } = loadTs('src/main/virtualCompanyOS.ts');
const { getCompanyOSAnswer } = loadTs('src/shared/lapitaya/alicia/companyOSAnswers.ts');

function createTempFilePath(prefix = 'lapitaya-integration-') {
  const tmpDir = os.tmpdir();
  const filename = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  return path.join(tmpDir, filename);
}

test('INT9-01: multi-project initialization with priorities and dependencies', () => {
  const service = new VirtualCompanyOSService();

  const projects = [
    {
      projectId: 'proj-alpha',
      name: 'Project Alpha',
      objective: 'Critical kernel modernization',
      status: 'PLANNING',
      createdAt: 1000,
      updatedAt: 1000,
      createdBy: 'human',
      acceptanceCriteria: [{ text: 'Pass all tests', provenance: 'HUMAN', verified: true }],
      missionIds: ['miss-alpha-1'],
      verified: true
    },
    {
      projectId: 'proj-beta',
      name: 'Project Beta',
      objective: 'Feature add-ons',
      status: 'PLANNING',
      createdAt: 1000,
      updatedAt: 1000,
      createdBy: 'human',
      acceptanceCriteria: [{ text: 'Feature tests pass', provenance: 'HUMAN', verified: true }],
      missionIds: ['miss-beta-1'],
      verified: true
    }
  ];

  const missions = [
    {
      missionId: 'miss-alpha-1',
      projectId: 'proj-alpha',
      title: 'Alpha Core Mission',
      objective: 'Modernize core pipeline',
      acceptanceCriteria: [{ text: 'Core verified', provenance: 'HUMAN', verified: true }],
      provenance: 'HUMAN',
      dependencies: [],
      status: 'PLANNING',
      workRequestIds: [],
      deliveryIds: [],
      plan: null,
      createdAt: 1000,
      updatedAt: 1000,
      confirmedAt: null,
      confirmedBy: null,
      verified: true
    },
    {
      missionId: 'miss-beta-1',
      projectId: 'proj-beta',
      title: 'Beta Integration Mission',
      objective: 'Build extension features',
      acceptanceCriteria: [{ text: 'Extensions verified', provenance: 'HUMAN', verified: true }],
      provenance: 'HUMAN',
      dependencies: [],
      status: 'PLANNING',
      workRequestIds: [],
      deliveryIds: [],
      plan: null,
      createdAt: 1000,
      updatedAt: 1000,
      confirmedAt: null,
      confirmedBy: null,
      verified: true
    }
  ];

  service.setProjectPriority('proj-alpha', 'CRITICAL', 'Strategic imperative');
  service.setProjectPriority('proj-beta', 'NORMAL', 'Standard roadmap');
  service.addProjectDependency('proj-beta', 'proj-alpha', 'Beta requires Alpha core modernization');

  const { portfolio, workQueue } = service.syncPortfolioAndQueue({
    projects,
    missions,
    deliveries: []
  });

  assert.equal(portfolio.projects.length, 2);
  assert.equal(portfolio.projects[0].projectId, 'proj-alpha'); // Highest priority first
  assert.equal(workQueue.items.length, 2);

  // Alpha item is READY, Beta item is WAITING_DEPENDENCY
  const alphaItem = workQueue.items.find((i) => i.projectId === 'proj-alpha');
  const betaItem = workQueue.items.find((i) => i.projectId === 'proj-beta');

  assert.equal(alphaItem.status, 'READY');
  assert.equal(betaItem.status, 'WAITING_DEPENDENCY');
});

test('INT9-02: scheduler selects top-priority READY candidate and obeys Builder != Auditor invariant', () => {
  const service = new VirtualCompanyOSService();
  const projects = [
    {
      projectId: 'proj-alpha',
      name: 'Project Alpha',
      objective: 'Core modernization',
      status: 'PLANNING',
      createdAt: 1000,
      updatedAt: 1000,
      createdBy: 'human',
      acceptanceCriteria: [{ text: 'Core verified', provenance: 'HUMAN', verified: true }],
      missionIds: ['miss-alpha-1'],
      verified: true
    }
  ];
  const missions = [
    {
      missionId: 'miss-alpha-1',
      projectId: 'proj-alpha',
      title: 'Alpha Core Mission',
      objective: 'Modernize core pipeline',
      acceptanceCriteria: [{ text: 'Core verified', provenance: 'HUMAN', verified: true }],
      provenance: 'HUMAN',
      dependencies: [],
      status: 'PLANNING',
      workRequestIds: [],
      deliveryIds: [],
      plan: null,
      createdAt: 1000,
      updatedAt: 1000,
      confirmedAt: null,
      confirmedBy: null,
      verified: true
    }
  ];

  service.setProjectPriority('proj-alpha', 'CRITICAL', 'Strategic imperative');
  service.syncPortfolioAndQueue({ projects, missions, deliveries: [] });

  const candidate = service.evaluateNextDispatch();
  assert.equal(candidate.selectedCandidate !== null, true);
  assert.equal(candidate.selectedCandidate?.projectId, 'proj-alpha');
  assert.equal(candidate.selectedCandidate?.eligibleAgents.includes('rosalba'), true);
  assert.equal(candidate.status, 'DISPATCH_READY');

  // Builder != Auditor test
  const rosalbaAssign = service.assignAgent({
    agentId: 'rosalba',
    projectId: 'proj-alpha',
    missionId: 'miss-alpha-1',
    role: 'Builder',
    phase: 'BUILD'
  });
  assert.equal(rosalbaAssign.ok, true);

  // José Juan cannot be assigned as Builder
  const joseJuanBuilder = service.assignAgent({
    agentId: 'jose-juan',
    projectId: 'proj-alpha',
    missionId: 'miss-alpha-1',
    role: 'Builder',
    phase: 'BUILD'
  });
  assert.equal(joseJuanBuilder.ok, false);
  assert.equal(joseJuanBuilder.code, 'AUDITOR_CANNOT_BUILD');
});

test('INT9-03: resource contention and human attention halts dispatch until resolved', () => {
  const service = new VirtualCompanyOSService();
  service.registerResource({
    resourceId: 'res-repo-lock',
    type: 'REPO_LOCK',
    name: 'Git Repo Lock',
    totalCapacity: 1,
    allocatedAmount: 0,
    availableAmount: 1,
    unit: 'LOCK',
    contendingProjects: []
  });

  // Reserve resource for Alpha
  const res = service.getResourceManager().reserveResource('res-repo-lock', 'proj-alpha', 1);
  assert.equal(res.ok, true);

  // Attempting another reservation fails
  const res2 = service.getResourceManager().reserveResource('res-repo-lock', 'proj-beta', 1);
  assert.equal(res2.ok, false);
  assert.equal(res2.code, 'RESOURCE_CAPACITY_EXCEEDED');

  // Human attention item halts candidate
  service.addHumanAttentionItem({
    reason: 'BUDGET_EXHAUSTED',
    severity: 'HIGH',
    projectId: 'proj-alpha',
    missionId: 'miss-alpha-1',
    summary: 'Token threshold reached for Alpha'
  });

  const snap = service.getSnapshot();
  assert.equal(snap.humanAttentionCenter.hasBlockingIssues, true);
  assert.equal(snap.humanAttentionCenter.highCount, 1);

  // Resolve human attention
  service.resolveHumanAttentionForProject('proj-alpha');
  const snapAfter = service.getSnapshot();
  assert.equal(snapAfter.humanAttentionCenter.hasBlockingIssues, false);
});

test('INT9-04: mission completion unblocks downstream dependent project', () => {
  const service = new VirtualCompanyOSService();

  const projects = [
    {
      projectId: 'proj-alpha',
      name: 'Project Alpha',
      objective: 'Core',
      status: 'COMPLETED',
      createdAt: 1000,
      updatedAt: 2000,
      createdBy: 'human',
      acceptanceCriteria: [{ text: 'Core verified', provenance: 'HUMAN', verified: true }],
      missionIds: ['miss-alpha-1'],
      verified: true
    },
    {
      projectId: 'proj-beta',
      name: 'Project Beta',
      objective: 'Features',
      status: 'PLANNING',
      createdAt: 1000,
      updatedAt: 2000,
      createdBy: 'human',
      acceptanceCriteria: [{ text: 'Features verified', provenance: 'HUMAN', verified: true }],
      missionIds: ['miss-beta-1'],
      verified: true
    }
  ];

  const missions = [
    {
      missionId: 'miss-alpha-1',
      projectId: 'proj-alpha',
      title: 'Alpha Mission',
      objective: 'Core',
      acceptanceCriteria: [{ text: 'Done', provenance: 'HUMAN', verified: true }],
      provenance: 'HUMAN',
      dependencies: [],
      status: 'COMPLETED',
      workRequestIds: [],
      deliveryIds: ['del-alpha-1'],
      plan: null,
      createdAt: 1000,
      updatedAt: 2000,
      confirmedAt: null,
      confirmedBy: null,
      verified: true
    },
    {
      missionId: 'miss-beta-1',
      projectId: 'proj-beta',
      title: 'Beta Mission',
      objective: 'Features',
      acceptanceCriteria: [{ text: 'Ready', provenance: 'HUMAN', verified: true }],
      provenance: 'HUMAN',
      dependencies: [],
      status: 'PLANNING',
      workRequestIds: [],
      deliveryIds: [],
      plan: null,
      createdAt: 1000,
      updatedAt: 2000,
      confirmedAt: null,
      confirmedBy: null,
      verified: true
    }
  ];

  const deliveries = [
    {
      requestId: 'req-alpha-1',
      taskId: 'task-alpha-1',
      projectId: 'proj-alpha',
      missionId: 'miss-alpha-1',
      outcome: 'PASS',
      summary: 'Alpha delivered successfully',
      artifacts: ['kernel.ts'],
      completedAt: 2000,
      evidenceRefs: ['evidence-1'],
      verified: true
    }
  ];

  service.setProjectPriority('proj-alpha', 'CRITICAL', 'Strategic');
  service.setProjectPriority('proj-beta', 'NORMAL', 'Standard');
  service.addProjectDependency('proj-beta', 'proj-alpha', 'Requires Alpha');

  const { workQueue } = service.syncPortfolioAndQueue({
    projects,
    missions,
    deliveries
  });

  // Beta item is now READY because Alpha is COMPLETED with PASS delivery
  const betaItem = workQueue.items.find((i) => i.projectId === 'proj-beta');
  assert.equal(betaItem.status, 'READY');
});

test('INT9-05: full roundtrip pause, persist, restart, and Alicia query verification', () => {
  const tempPath = createTempFilePath('int9-05-');
  const service = new VirtualCompanyOSService();
  const projects = [
    {
      projectId: 'proj-alpha',
      name: 'Project Alpha',
      objective: 'Modernize kernel',
      status: 'ACTIVE',
      createdAt: 1000,
      updatedAt: 1000,
      createdBy: 'human',
      acceptanceCriteria: [{ text: 'Verified', provenance: 'HUMAN', verified: true }],
      missionIds: ['miss-1'],
      verified: true
    }
  ];
  const missions = [
    {
      missionId: 'miss-1',
      projectId: 'proj-alpha',
      title: 'Mission 1',
      objective: 'Modernize kernel',
      acceptanceCriteria: [{ text: 'Verified', provenance: 'HUMAN', verified: true }],
      provenance: 'HUMAN',
      dependencies: [],
      status: 'ACTIVE',
      workRequestIds: [],
      deliveryIds: [],
      plan: null,
      createdAt: 1000,
      updatedAt: 1000,
      confirmedAt: 1000,
      confirmedBy: 'human',
      verified: true
    }
  ];

  service.setProjectPriority('proj-alpha', 'CRITICAL', 'Strategic');
  service.setOperatingMode('AUTONOMOUS_WITHIN_ENVELOPES');
  service.syncPortfolioAndQueue({ projects, missions, deliveries: [] });
  service.save(tempPath);

  // Rehydrate in fresh service
  const freshService = new VirtualCompanyOSService();
  const loadRes = freshService.load(tempPath);
  assert.equal(loadRes.ok, true);

  const snapshot = freshService.getSnapshot();
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.operatingMode, 'AUTONOMOUS_WITHIN_ENVELOPES');

  // Verify Alicia answers against fresh rehydrated state
  const answer = getCompanyOSAnswer(snapshot, '¿Cuál proyecto tiene mayor prioridad?');
  assert.equal(answer.known, true);
  assert.match(answer.answer, /proj-alpha|CRITICAL/);

  // Clean up
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
});
