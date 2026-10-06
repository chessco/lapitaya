'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const loadTs = require('./load-ts.cjs');

const { VirtualCompanyOSService } = loadTs('src/main/virtualCompanyOS.ts');
const {
  serializeCompanyState,
  deserializeCompanyState,
  rehydrateCompanyState,
  saveCompanyStateSync,
  loadCompanyStateSync
} = loadTs('src/main/companyPersistence.ts');

function createTempFilePath(prefix = 'lapitaya-test-') {
  const tmpDir = os.tmpdir();
  const filename = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  return path.join(tmpDir, filename);
}

test('REC9-01: state serialization produces valid JSON matching schemaVersion 1', () => {
  const service = new VirtualCompanyOSService();
  service.setProjectPriority('proj-alpha', 'CRITICAL', 'Core project');
  service.addProjectDependency('proj-beta', 'proj-alpha', 'Prerequisite');
  service.registerResource({
    resourceId: 'res-repo',
    type: 'REPO_LOCK',
    name: 'Main Repository Lock',
    totalLimit: 1,
    availableUnits: 1,
    allocatedTo: [],
    reservedFor: []
  });

  const serialized = serializeCompanyState(service);
  assert.equal(serialized.schemaVersion, 1);
  assert.equal(typeof serialized.savedAt, 'number');
  assert.equal(serialized.company.companyId, 'lapitaya');
  assert.equal(serialized.priorities.length >= 1, true);
  assert.equal(serialized.dependencies.length, 1);
  assert.equal(serialized.resources.length, 1);
});

test('REC9-02: atomic file saving writes file and cleans up temp file', () => {
  const tempPath = createTempFilePath('rec9-02-');
  const service = new VirtualCompanyOSService();
  service.setStoragePath(tempPath);

  const saveRes = service.save();
  assert.equal(saveRes.ok, true);
  assert.equal(fs.existsSync(tempPath), true);

  const content = fs.readFileSync(tempPath, 'utf8');
  const parsed = JSON.parse(content);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.company.name, 'La Pitaya');

  // Clean up
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
});

test('REC9-03: deserialization detects and rejects corrupted JSON payloads (fail-closed)', () => {
  const corruptedJson = '{"schemaVersion": 1, "company": { INVALID JSON ...';
  const result = deserializeCompanyState(corruptedJson);
  assert.equal(result.ok, false);
  assert.match(result.error || '', /JSON_PARSE_ERROR/);
});

test('REC9-04: deserialization rejects unknown or future schema versions', () => {
  const futureState = JSON.stringify({
    schemaVersion: 999,
    savedAt: Date.now(),
    company: { companyId: 'lapitaya', name: 'La Pitaya' }
  });
  const result = deserializeCompanyState(futureState);
  assert.equal(result.ok, false);
  assert.match(result.error || '', /UNSUPPORTED_SCHEMA_VERSION/);
});

test('REC9-05: deserialization verifies valid company identity (lapitaya)', () => {
  const foreignState = JSON.stringify({
    schemaVersion: 1,
    savedAt: Date.now(),
    company: { companyId: 'some-other-company', name: 'Other' }
  });
  const result = deserializeCompanyState(foreignState);
  assert.equal(result.ok, false);
  assert.match(result.error || '', /INVALID_COMPANY_IDENTITY/);
});

test('REC9-06: non-destructive company pause transitions RUNNING operations to PAUSED', () => {
  const service = new VirtualCompanyOSService();
  service.setOperationsCenter({
    activeOperations: [
      {
        operationId: 'op-01',
        projectId: 'proj-1',
        projectName: 'Project 1',
        missionId: 'miss-1',
        missionTitle: 'Mission 1',
        leadAgentId: 'el-inge',
        activeAgents: ['el-inge', 'rosalba'],
        envelopeId: 'env-1',
        riskLevel: 'LOW',
        budgetRemaining: { iterations: 10, tokens: 50000, timeMs: 60000 },
        startedAt: Date.now(),
        status: 'RUNNING'
      }
    ],
    pausedOperations: [],
    recentCompletions: [],
    concurrency: { current: 1, maxLimit: 2 }
  });

  assert.equal(service.isPaused(), false);
  service.pauseCompany('Emergency operator maintenance');
  assert.equal(service.isPaused(), true);

  const opsCenter = service.getOperationsCenter();
  assert.equal(opsCenter.activeOperations.length, 0);
  assert.equal(opsCenter.pausedOperations.length, 1);
  assert.equal(opsCenter.pausedOperations[0].operationId, 'op-01');
  assert.equal(opsCenter.pausedOperations[0].status, 'PAUSED');
  assert.equal(opsCenter.concurrency.current, 0);
});

test('REC9-07: RESTART != REAUTHORIZATION axiom: rehydrating active operations freezes them as PAUSED', () => {
  const service = new VirtualCompanyOSService();
  const mockPersisted = {
    schemaVersion: 1,
    savedAt: Date.now(),
    company: {
      companyId: 'lapitaya',
      name: 'La Pitaya',
      operatingMode: 'AUTONOMOUS_WITHIN_ENVELOPES',
      isPaused: false,
      humanAttention: { items: [] }
    },
    operationsCenter: {
      activeOperations: [
        {
          operationId: 'op-running-before-crash',
          projectId: 'proj-a',
          projectName: 'Alpha',
          missionId: 'miss-a',
          missionTitle: 'Alpha Mission',
          leadAgentId: 'el-inge',
          activeAgents: ['el-inge'],
          envelopeId: 'env-a',
          riskLevel: 'LOW',
          budgetRemaining: { iterations: 5, tokens: 20000, timeMs: 30000 },
          startedAt: Date.now() - 10000,
          status: 'RUNNING'
        }
      ],
      pausedOperations: [],
      recentCompletions: [],
      concurrency: { current: 1, maxLimit: 2 }
    },
    priorities: [],
    dependencies: [],
    resources: []
  };

  const rehydration = rehydrateCompanyState(service, mockPersisted);
  assert.equal(rehydration.ok, true);
  assert.equal(rehydration.warnings.length >= 1, true);
  assert.match(rehydration.warnings[0], /RESTART_FREEZE/);

  const ops = service.getOperationsCenter();
  assert.equal(ops.activeOperations.length, 0);
  assert.equal(ops.pausedOperations.length, 1);
  assert.equal(ops.pausedOperations[0].operationId, 'op-running-before-crash');
  assert.equal(ops.pausedOperations[0].status, 'PAUSED');
  assert.equal(ops.concurrency.current, 0);
  assert.equal(service.evaluateNextDispatch().status === 'CONCURRENCY_LIMIT_REACHED', false);
});

test('REC9-08: rehydration preserves priorities, dependencies, and resources', () => {
  const service = new VirtualCompanyOSService();
  const mockPersisted = {
    schemaVersion: 1,
    savedAt: Date.now(),
    company: {
      companyId: 'lapitaya',
      name: 'La Pitaya',
      operatingMode: 'HUMAN_SUPERVISED_ONLY',
      isPaused: false,
      humanAttention: { items: [] }
    },
    operationsCenter: {
      activeOperations: [],
      pausedOperations: [],
      recentCompletions: [],
      concurrency: { current: 0, maxLimit: 2 }
    },
    priorities: [
      {
        projectId: 'proj-omega',
        level: 'CRITICAL',
        rank: 10,
        assignedBy: 'human',
        assignedAt: Date.now(),
        reason: 'Restored priority',
        provenance: 'HUMAN'
      }
    ],
    dependencies: [
      {
        dependentProjectId: 'proj-omega',
        prerequisiteProjectId: 'proj-core',
        reason: 'Core requirement',
        declaredAt: Date.now()
      }
    ],
    resources: [
      {
        resourceId: 'res-gpu',
        type: 'MODEL_QUOTA',
        name: 'GPU quota',
        totalLimit: 5,
        availableUnits: 5,
        allocatedTo: [],
        reservedFor: []
      }
    ]
  };

  const rehydration = rehydrateCompanyState(service, mockPersisted);
  assert.equal(rehydration.ok, true);
  assert.equal(service.getOperatingMode(), 'HUMAN_SUPERVISED_ONLY');
  assert.equal(service.getPriorityManager().getPriority('proj-omega')?.level, 'CRITICAL');
  assert.equal(service.getDependencyEngine().hasPrerequisite('proj-omega', 'proj-core'), true);
  assert.equal(service.getResourceManager().getResource('res-gpu')?.totalLimit, 5);
});

test('REC9-09: rehydration restores human attention items accurately', () => {
  const service = new VirtualCompanyOSService();
  const mockPersisted = {
    schemaVersion: 1,
    savedAt: Date.now(),
    company: {
      companyId: 'lapitaya',
      name: 'La Pitaya',
      operatingMode: 'AUTONOMOUS_WITHIN_ENVELOPES',
      isPaused: false,
      humanAttention: {
        items: [
          {
            id: 'attn-101',
            reason: 'GOVERNANCE_BLOCKED',
            severity: 'CRITICAL',
            projectId: 'proj-1',
            missionId: 'miss-1',
            summary: 'Action blocked by policy',
            createdAt: Date.now()
          }
        ]
      }
    },
    operationsCenter: {
      activeOperations: [],
      pausedOperations: [],
      recentCompletions: [],
      concurrency: { current: 0, maxLimit: 2 }
    },
    priorities: [],
    dependencies: [],
    resources: []
  };

  const rehydration = rehydrateCompanyState(service, mockPersisted);
  assert.equal(rehydration.ok, true);
  const items = service.getHumanAttentionManager().getItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'attn-101');
  assert.equal(items[0].severity, 'CRITICAL');
});

test('REC9-10: full round-trip save -> load preserves company state and updates cleanly', () => {
  const tempPath = createTempFilePath('rec9-10-');
  const service1 = new VirtualCompanyOSService();
  service1.setProjectPriority('proj-rt', 'HIGH', 'Roundtrip test');
  service1.addHumanAttentionItem({
    reason: 'BUDGET_EXHAUSTED',
    severity: 'HIGH',
    summary: 'Token threshold reached'
  });
  service1.save(tempPath);

  const service2 = new VirtualCompanyOSService();
  const loadRes = service2.load(tempPath);
  assert.equal(loadRes.ok, true);
  assert.equal(service2.getPriorityManager().getPriority('proj-rt')?.level, 'HIGH');
  assert.equal(service2.getHumanAttentionManager().getItems().length, 1);
  assert.equal(service2.getHumanAttentionManager().getItems()[0].reason, 'BUDGET_EXHAUSTED');

  // Clean up
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
});
