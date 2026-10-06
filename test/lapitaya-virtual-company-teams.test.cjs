'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  TeamsAndCapacityManager
} = loadTs('src/main/companyTeams.ts');

const {
  VirtualCompanyOSService
} = loadTs('src/main/virtualCompanyOS.ts');

let clock = 1_700_000_000_000;
const fixture = () => new TeamsAndCapacityManager(() => ++clock);

test('TEAM9-01: canonical teams definitions', () => {
  const tm = fixture();
  const teams = tm.getTeams();
  assert.equal(teams.length, 4);

  const delivery = tm.getTeam('team-delivery');
  assert.ok(delivery);
  assert.equal(delivery.leadAgentId, 'el-inge');
  assert.deepEqual(delivery.members, ['el-inge', 'rosalba', 'el-beni']);

  const quality = tm.getTeam('team-quality');
  assert.ok(quality);
  assert.equal(quality.leadAgentId, 'margarito');
  assert.deepEqual(quality.members, ['margarito', 'jose-juan']);
});

test('TEAM9-02: agent profiles map all 8 canonical agents', () => {
  const tm = fixture();
  const inge = tm.getAgentProfile('el-inge');
  assert.equal(inge.cimaRole, 'Builder');
  assert.equal(inge.organizationalRole, 'Tech Lead & Operations Coordinator');

  const jj = tm.getAgentProfile('jose-juan');
  assert.equal(jj.cimaRole, 'Auditor');

  const tutu = tm.getAgentProfile('el-tutu');
  assert.equal(tutu.cimaRole, 'Learner');

  const alicia = tm.getAgentProfile('alicia');
  assert.equal(alicia.cimaRole, 'Companion');
});

test('TEAM9-03: initial capacity states', () => {
  const tm = fixture();
  const capacities = tm.getAllCapacities();
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

test('TEAM9-04: successful agent assignment', () => {
  const tm = fixture();
  const result = tm.assignAgent({
    agentId: 'rosalba',
    projectId: 'proj-1',
    missionId: 'm-1',
    phase: 'BUILD'
  });

  assert.equal(result.ok, true);
  assert.equal(result.capacity.state, 'ASSIGNED');
  assert.equal(result.capacity.currentAssignment.projectId, 'proj-1');
  assert.equal(result.capacity.currentAssignment.missionId, 'm-1');
  assert.equal(result.capacity.currentAssignment.phase, 'BUILD');

  const direct = tm.getAgentCapacity('rosalba');
  assert.equal(direct.state, 'ASSIGNED');
});

test('TEAM9-05: concurrency limit prevents multiple active assignments', () => {
  const tm = fixture();
  tm.assignAgent({
    agentId: 'rosalba',
    projectId: 'proj-1',
    missionId: 'm-1',
    phase: 'BUILD'
  });

  const second = tm.assignAgent({
    agentId: 'rosalba',
    projectId: 'proj-2',
    missionId: 'm-2',
    phase: 'BUILD'
  });

  assert.equal(second.ok, false);
  assert.equal(second.code, 'CONCURRENCY_LIMIT_EXCEEDED');
});

test('TEAM9-06: Builder != Auditor invariant during assignment', () => {
  const tm = fixture();

  // Rosalba (Builder) cannot do AUDIT
  const rosalbaAudit = tm.assignAgent({
    agentId: 'rosalba',
    projectId: 'proj-1',
    missionId: 'm-1',
    phase: 'AUDIT'
  });
  assert.equal(rosalbaAudit.ok, false);
  assert.equal(rosalbaAudit.code, 'AUDITOR_ROLE_REQUIRED');

  // Jose Juan (Auditor) cannot do BUILD
  const jjBuild = tm.assignAgent({
    agentId: 'jose-juan',
    projectId: 'proj-1',
    missionId: 'm-1',
    phase: 'BUILD'
  });
  assert.equal(jjBuild.ok, false);
  assert.equal(jjBuild.code, 'AUDITOR_CANNOT_BUILD');

  // Jose Juan can do AUDIT
  const jjAudit = tm.assignAgent({
    agentId: 'jose-juan',
    projectId: 'proj-1',
    missionId: 'm-1',
    phase: 'AUDIT'
  });
  assert.equal(jjAudit.ok, true);
});

test('TEAM9-07: Alicia cannot be assigned to CIMA execution phases', () => {
  const tm = fixture();
  const aliciaAssign = tm.assignAgent({
    agentId: 'alicia',
    projectId: 'proj-1',
    missionId: 'm-1',
    phase: 'BUILD'
  });

  assert.equal(aliciaAssign.ok, false);
  assert.equal(aliciaAssign.code, 'ALICIA_EXECUTION_PROHIBITED');
});

test('TEAM9-08: execution state progression and release', () => {
  const tm = fixture();
  tm.assignAgent({
    agentId: 'el-beni',
    projectId: 'proj-1',
    missionId: 'm-1',
    phase: 'BUILD'
  });

  assert.equal(tm.getAgentCapacity('el-beni').state, 'ASSIGNED');
  tm.setAgentExecuting('el-beni');
  assert.equal(tm.getAgentCapacity('el-beni').state, 'EXECUTING');

  const released = tm.releaseAgent('el-beni');
  assert.equal(released.state, 'AVAILABLE');
  assert.equal(released.currentAssignment, null);
  assert.equal(tm.getAgentCapacity('el-beni').state, 'AVAILABLE');
});

test('TEAM9-09: mission completion releases all assigned agents', () => {
  const tm = fixture();
  tm.assignAgent({ agentId: 'rosalba', projectId: 'proj-1', missionId: 'm-target', phase: 'BUILD' });
  tm.assignAgent({ agentId: 'margarito', projectId: 'proj-1', missionId: 'm-target', phase: 'TEST' });
  tm.assignAgent({ agentId: 'el-beni', projectId: 'proj-1', missionId: 'm-other', phase: 'BUILD' });

  const released = tm.releaseMissionAssignments('m-target');
  assert.deepEqual(released.sort(), ['margarito', 'rosalba']);

  assert.equal(tm.getAgentCapacity('rosalba').state, 'AVAILABLE');
  assert.equal(tm.getAgentCapacity('margarito').state, 'AVAILABLE');
  assert.equal(tm.getAgentCapacity('el-beni').state, 'ASSIGNED');
});

test('TEAM9-10: VirtualCompanyOSService team and capacity integration', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  const result = os.assignAgent({
    agentId: 'rosalba',
    projectId: 'proj-1',
    missionId: 'm-1',
    phase: 'BUILD'
  });

  assert.equal(result.ok, true);
  const snapshot = os.getSnapshot();
  const rosalbaCap = snapshot.capacity.find((c) => c.agentId === 'rosalba');
  assert.equal(rosalbaCap.state, 'ASSIGNED');
  assert.equal(rosalbaCap.currentAssignment.missionId, 'm-1');
});
