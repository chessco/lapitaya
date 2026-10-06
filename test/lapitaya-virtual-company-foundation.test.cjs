'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  VirtualCompanyOSService,
  CANONICAL_COMPANY_TEAMS,
  CANONICAL_AGENT_PROFILES,
  createDefaultVirtualCompany,
  createDefaultAgentCapacities,
  createInitialCompanyMetrics,
  createInitialCompanyHealth
} = loadTs('src/main/virtualCompanyOS.ts');

const { LA_PITAYA_AGENT_IDS } = loadTs('src/shared/lapitaya/agents.ts');

let clock = 1_700_000_000_000;
const fixture = (opts = {}) => new VirtualCompanyOSService({ now: () => ++clock, ...opts });

test('COMPANY9-01: canonical company identity', () => {
  const company = createDefaultVirtualCompany();
  assert.equal(company.companyId, 'lapitaya');
  assert.equal(company.name, 'La Pitaya');
  assert.equal(company.organizationIdentity.brand, 'PitayaCode');
  assert.equal(company.organizationIdentity.origin, 'Sonora, Mexico');
  assert.equal(company.organizationIdentity.schemaVersion, 1);
});

test('COMPANY9-02: operating mode defaults and transitions', () => {
  const os = fixture();
  assert.equal(os.getOperatingMode(), 'AUTONOMOUS_WITHIN_ENVELOPES');
  os.setOperatingMode('SUPERVISED');
  assert.equal(os.getOperatingMode(), 'SUPERVISED');
  os.setOperatingMode('MANUAL');
  assert.equal(os.getOperatingMode(), 'MANUAL');
});

test('COMPANY9-03: canonical teams definition', () => {
  assert.equal(CANONICAL_COMPANY_TEAMS.length, 4);
  const teamIds = CANONICAL_COMPANY_TEAMS.map((t) => t.teamId);
  assert.deepEqual(teamIds, ['team-delivery', 'team-quality', 'team-architecture', 'team-learning']);
  
  const delivery = CANONICAL_COMPANY_TEAMS.find((t) => t.teamId === 'team-delivery');
  assert.equal(delivery.leadAgentId, 'el-inge');
  assert.deepEqual(delivery.members, ['el-inge', 'rosalba', 'el-beni']);

  const quality = CANONICAL_COMPANY_TEAMS.find((t) => t.teamId === 'team-quality');
  assert.equal(quality.leadAgentId, 'margarito');
  assert.deepEqual(quality.members, ['margarito', 'jose-juan']);
});

test('COMPANY9-04: all 8 canonical agents have profiles', () => {
  assert.equal(CANONICAL_AGENT_PROFILES.length, 8);
  const profileAgentIds = CANONICAL_AGENT_PROFILES.map((p) => p.agentId);
  assert.deepEqual(profileAgentIds.sort(), [...LA_PITAYA_AGENT_IDS].sort());

  const inge = CANONICAL_AGENT_PROFILES.find((p) => p.agentId === 'el-inge');
  assert.equal(inge.cimaRole, 'Builder');
  assert.equal(inge.organizationalRole, 'Tech Lead & Operations Coordinator');

  const auditor = CANONICAL_AGENT_PROFILES.find((p) => p.agentId === 'jose-juan');
  assert.equal(auditor.cimaRole, 'Auditor');

  const companion = CANONICAL_AGENT_PROFILES.find((p) => p.agentId === 'alicia');
  assert.equal(companion.cimaRole, 'Companion');
});

test('COMPANY9-05: agent capacities initialize accurately', () => {
  const capacities = createDefaultAgentCapacities();
  assert.equal(capacities.length, 8);
  for (const cap of capacities) {
    if (cap.agentId === 'alicia') {
      assert.equal(cap.state, 'IDLE');
    } else {
      assert.equal(cap.state, 'AVAILABLE');
    }
    assert.equal(cap.currentAssignment, null);
    assert.equal(cap.concurrencyLimit, 1);
  }
});

test('COMPANY9-06: pause and resume functionality', () => {
  const os = fixture();
  assert.equal(os.isPaused(), false);
  os.pauseCompany('Testing pause');
  assert.equal(os.isPaused(), true);
  os.resumeCompany();
  assert.equal(os.isPaused(), false);
});

test('COMPANY9-07: snapshot evolution schemaVersion 2', () => {
  const os = fixture();
  const snapshot = os.getSnapshot();
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.company.id, 'lapitaya');
  assert.ok(Array.isArray(snapshot.teams));
  assert.ok(Array.isArray(snapshot.capacity));
  assert.equal(snapshot.capacity.length, 8);
  assert.ok(snapshot.health);
  assert.equal(snapshot.health.status, 'HEALTHY');
  assert.ok(snapshot.metrics);
  assert.ok(snapshot.humanAttentionCenter);
  assert.ok(snapshot.operationsCenter);
  assert.equal(snapshot.isPaused, false);
});

test('COMPANY9-08: initial metrics and health are evidence-backed', () => {
  const metrics = createInitialCompanyMetrics();
  assert.equal(metrics.activeProjects, 0);
  assert.equal(metrics.overallPassRate, 1.0);
  assert.equal(metrics.completedDeliveries, 0);

  const health = createInitialCompanyHealth();
  assert.equal(health.status, 'HEALTHY');
  assert.equal(health.score, 100);
});

test('COMPANY9-09: capacity updates', () => {
  const os = fixture();
  assert.equal(os.getAgentCapacity('rosalba').state, 'AVAILABLE');
  os.updateAgentCapacity('rosalba', {
    state: 'EXECUTING',
    currentAssignment: {
      projectId: 'proj-1',
      missionId: 'mission-1',
      phase: 'BUILD',
      startedAt: clock
    }
  });
  const updated = os.getAgentCapacity('rosalba');
  assert.equal(updated.state, 'EXECUTING');
  assert.equal(updated.currentAssignment.projectId, 'proj-1');
});

test('COMPANY9-10: no governance bypass or arbitrary authority mutation', () => {
  const os = fixture();
  const company = os.getCompany();
  assert.equal(company.governanceState.cimaVersion, '0.16.0');
  assert.ok(company.governanceState.activePolicies.includes('POLICY-31'));
});
