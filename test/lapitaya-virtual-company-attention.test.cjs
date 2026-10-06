'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  HumanAttentionManager
} = loadTs('src/main/humanAttentionCenter.ts');

const {
  VirtualCompanyOSService
} = loadTs('src/main/virtualCompanyOS.ts');

let clock = 1_700_000_000_000;
const fixture = () => new HumanAttentionManager(() => ++clock);

test('ATTN9-01: create attention item with reason and severity', () => {
  const am = fixture();
  const item = am.addItem({
    reason: 'HIGH_RISK_APPROVAL',
    severity: 'CRITICAL',
    projectId: 'proj-1',
    missionId: 'm-1',
    operationId: 'op-1',
    summary: 'Requires database migration execution authorization',
    context: { migrationFile: '001_init.sql' }
  });

  assert.ok(item.id.startsWith('attn-HIGH_RISK_APPROVAL-proj-1-m-1-op-1'));
  assert.equal(item.severity, 'CRITICAL');
  assert.equal(item.reason, 'HIGH_RISK_APPROVAL');
  assert.equal(item.summary, 'Requires database migration execution authorization');
  assert.equal(item.context.migrationFile, '001_init.sql');
  assert.equal(item.verified, true);
});

test('ATTN9-02: deduplication updates existing record without duplicate items', () => {
  const am = fixture();
  const item1 = am.addItem({
    reason: 'BLOCKED_MISSION',
    severity: 'HIGH',
    projectId: 'proj-1',
    missionId: 'm-1',
    operationId: null,
    summary: 'Initial blocker message'
  });

  const item2 = am.addItem({
    reason: 'BLOCKED_MISSION',
    severity: 'CRITICAL',
    projectId: 'proj-1',
    missionId: 'm-1',
    operationId: null,
    summary: 'Updated critical blocker message'
  });

  assert.equal(item1.id, item2.id);
  assert.equal(am.getItems().length, 1);
  assert.equal(am.getItems()[0].summary, 'Updated critical blocker message');
  assert.equal(am.getItems()[0].severity, 'CRITICAL');
});

test('ATTN9-03: state counts and hasBlockingIssues flag', () => {
  const am = fixture();
  assert.equal(am.getState().hasBlockingIssues, false);

  am.addItem({ reason: 'RESOURCE_CONTENTION', severity: 'NORMAL', projectId: 'p-1', missionId: null, operationId: null, summary: 'Info' });
  assert.equal(am.getState().normalCount, 1);
  assert.equal(am.getState().hasBlockingIssues, false);

  am.addItem({ reason: 'BLOCKED_MISSION', severity: 'HIGH', projectId: 'p-1', missionId: 'm-1', operationId: null, summary: 'Blocked' });
  assert.equal(am.getState().highCount, 1);
  assert.equal(am.getState().hasBlockingIssues, true);

  am.addItem({ reason: 'GOVERNANCE_VIOLATION', severity: 'CRITICAL', projectId: 'p-1', missionId: 'm-1', operationId: 'op-1', summary: 'Violation' });
  assert.equal(am.getState().criticalCount, 1);
  assert.equal(am.getState().hasBlockingIssues, true);
});

test('ATTN9-04: resolve items for specific mission', () => {
  const am = fixture();
  am.addItem({ reason: 'BLOCKED_MISSION', severity: 'HIGH', projectId: 'p-1', missionId: 'm-1', operationId: null, summary: 'M1 Block' });
  am.addItem({ reason: 'BLOCKED_MISSION', severity: 'HIGH', projectId: 'p-1', missionId: 'm-2', operationId: null, summary: 'M2 Block' });

  assert.equal(am.getItems().length, 2);
  am.resolveItemsForMission('m-1');
  assert.equal(am.getItems().length, 1);
  assert.equal(am.getItems()[0].missionId, 'm-2');
});

test('ATTN9-05: resolve items for specific project', () => {
  const am = fixture();
  am.addItem({ reason: 'BLOCKED_MISSION', severity: 'HIGH', projectId: 'p-1', missionId: 'm-1', operationId: null, summary: 'P1 M1 Block' });
  am.addItem({ reason: 'BLOCKED_MISSION', severity: 'HIGH', projectId: 'p-2', missionId: 'm-2', operationId: null, summary: 'P2 M2 Block' });

  am.resolveItemsForProject('p-1');
  assert.equal(am.getItems().length, 1);
  assert.equal(am.getItems()[0].projectId, 'p-2');
});

test('ATTN9-06: items sorted by severity CRITICAL before HIGH before NORMAL', () => {
  const am = fixture();
  am.addItem({ reason: 'RESOURCE_CONTENTION', severity: 'NORMAL', projectId: 'p-1', missionId: null, operationId: null, summary: 'Normal' });
  am.addItem({ reason: 'GOVERNANCE_VIOLATION', severity: 'CRITICAL', projectId: 'p-1', missionId: null, operationId: null, summary: 'Critical' });
  am.addItem({ reason: 'BLOCKED_MISSION', severity: 'HIGH', projectId: 'p-1', missionId: null, operationId: null, summary: 'High' });

  const items = am.getItems();
  assert.equal(items[0].severity, 'CRITICAL');
  assert.equal(items[1].severity, 'HIGH');
  assert.equal(items[2].severity, 'NORMAL');
});

test('ATTN9-07: attention item has zero execution authority tokens', () => {
  const am = fixture();
  const item = am.addItem({
    reason: 'HIGH_RISK_APPROVAL',
    severity: 'CRITICAL',
    projectId: 'p-1',
    missionId: 'm-1',
    operationId: 'op-1',
    summary: 'Needs human signoff'
  });

  assert.equal(item.hasOwnProperty('cimaDecision'), false);
  assert.equal(item.hasOwnProperty('autoApproved'), false);
});

test('ATTN9-08: VirtualCompanyOSService attention integration', () => {
  const os = new VirtualCompanyOSService({ now: () => ++clock });
  os.addHumanAttentionItem({
    reason: 'REQUEST_CONFIRMATION',
    severity: 'HIGH',
    projectId: 'proj-1',
    missionId: null,
    operationId: null,
    summary: 'New project request pending confirmation'
  });

  const state = os.getHumanAttention();
  assert.equal(state.highCount, 1);
  assert.equal(state.hasBlockingIssues, true);

  const snapshot = os.getSnapshot();
  assert.equal(snapshot.humanAttentionCenter.highCount, 1);

  os.resolveHumanAttentionForProject('proj-1');
  assert.equal(os.getHumanAttention().highCount, 0);
  assert.equal(os.getSnapshot().humanAttentionCenter.highCount, 0);
});

test('ATTN9-09: remove individual attention item by ID', () => {
  const am = fixture();
  const item = am.addItem({
    reason: 'BUDGET_EXHAUSTED',
    severity: 'CRITICAL',
    projectId: 'p-1',
    missionId: 'm-1',
    operationId: 'op-1',
    summary: 'Token budget exhausted'
  });

  assert.equal(am.getItems().length, 1);
  const removed = am.removeItem(item.id);
  assert.equal(removed, true);
  assert.equal(am.getItems().length, 0);
});

test('ATTN9-10: multi-reason filtering resolution', () => {
  const am = fixture();
  am.addItem({ reason: 'BLOCKED_MISSION', severity: 'HIGH', projectId: 'p-1', missionId: 'm-1', operationId: null, summary: 'Block' });
  am.addItem({ reason: 'HIGH_RISK_APPROVAL', severity: 'CRITICAL', projectId: 'p-1', missionId: 'm-1', operationId: 'op-1', summary: 'Approval' });

  assert.equal(am.getItems().length, 2);
  // Resolve only the BLOCKED_MISSION reason
  am.resolveItemsForMission('m-1', 'BLOCKED_MISSION');
  assert.equal(am.getItems().length, 1);
  assert.equal(am.getItems()[0].reason, 'HIGH_RISK_APPROVAL');
});
