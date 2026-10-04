'use strict';
// POLICY-31 remediation — snapshot purity proof (isolated acceptance tooling).
// Builds a temporary AutonomousOperationsService (never the user's storage),
// creates real state through the service's own API, then calls every read path
// the former `autonomy:*` handlers used, plus the canonical renderer-visible
// projection (`company:getSnapshot` / `company:getOperations` -> operations.autonomy),
// 100 times each, and compares authoritative state before/after.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const loadTs = require(path.join(ROOT, 'test', 'load-ts.cjs'));

const { AutonomousOperationsService } = loadTs('src/main/autonomousOperations.ts');
const { OrganizationalLearningService } = loadTs('src/main/organizationalLearning.ts');
const { CompanyOperationsService } = loadTs('src/main/companyOperations.ts');
const { CompanyAwarenessService } = loadTs('src/main/companyAwareness.ts');

let clock = 6_000_000_000_000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-f8-policy31-purity-'));
const files = {
  autonomy: path.join(tmp, 'autonomy.json'),
  learning: path.join(tmp, 'learning.json'),
  projects: path.join(tmp, 'projects.json')
};
let stateChanged = 0;
const awareness = new CompanyAwarenessService({ now: () => ++clock });
const learning = new OrganizationalLearningService({ now: () => ++clock, storageFile: files.learning, humanAttention: () => null });
const autonomy = new AutonomousOperationsService({
  now: () => ++clock, storageFile: files.autonomy, learningService: learning,
  humanAttention: () => null, onStateChanged: () => { stateChanged++; }
});
const ops = new CompanyOperationsService({
  now: () => ++clock, snapshot: () => awareness.snapshot(), storageFile: files.projects,
  learningService: learning, autonomyService: autonomy,
  project: () => ({ projectId: 'LP-PURITY', displayName: 'Purity fixture' })
});

// Real state via the service API: one ACTIVE envelope + operation, one PENDING envelope.
const active = autonomy.createEnvelope({
  projectId: 'LP-PURITY', missionId: 'LP-PURITY-M1', objective: 'Purity fixture objective',
  riskCeiling: 'LOW', budget: { maxIterations: 5, maxRetries: 3, maxDurationMs: 600000 },
  allowedCapabilities: ['READ_WORKSPACE', 'RUN_TEST'], allowedPaths: ['src/fixture/'],
  provenance: 'HUMAN', authorizedBy: 'human:fixture'
});
const pending = autonomy.createEnvelope({
  projectId: 'LP-PURITY', missionId: 'LP-PURITY-M2', objective: 'Pending fixture objective',
  riskCeiling: 'LOW', budget: { maxIterations: 2, maxRetries: 1, maxDurationMs: 600000 },
  allowedCapabilities: ['READ_WORKSPACE'], allowedPaths: ['src/fixture2/']
});
const op = autonomy.startOperation({ envelopeId: active.envelopeId, projectId: 'LP-PURITY', missionId: 'LP-PURITY-M1' });

const hashFile = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent');
const mtime = (f) => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : null);
function authoritative() {
  // Internal maps are read directly (not through snapshot()) so the measurement
  // does not depend on the code under test.
  const envs = [...autonomy.envelopes.values()];
  const opsList = [...autonomy.operations.values()];
  return {
    envelopes: JSON.stringify(envs),
    envelopeStatuses: envs.map((e) => `${e.envelopeId}:${e.status}`).join(','),
    operations: JSON.stringify(opsList),
    budgetsConsumption: JSON.stringify(opsList.map((o) => o.consumption)),
    iterationsSteps: JSON.stringify(opsList.map((o) => [o.currentIteration, o.currentStep])),
    pendingDecisions: JSON.stringify(opsList.map((o) => o.pendingDecision)),
    scopeExpansions: JSON.stringify([...autonomy.scopeExpansions.values()]),
    assignments: JSON.stringify(opsList.map((o) => o.activeAssignmentAgentId)),
    workRequests: JSON.stringify(opsList.map((o) => [o.activeWorkRequestId, o.activeTaskId])),
    history: JSON.stringify(opsList.map((o) => o.history.length)),
    executionAwake: autonomy.awake,
    companyRequests: JSON.stringify([...ops.requests.values()]),
    companyDeliveries: JSON.stringify([...ops.deliveries.values()]),
    autonomyFileHash: hashFile(files.autonomy),
    autonomyFileMtime: mtime(files.autonomy),
    projectsFileHash: hashFile(files.projects),
    learningFileHash: hashFile(files.learning),
    stateChangedCalls: stateChanged
  };
}

const before = authoritative();
const N = 100;
for (let i = 0; i < N; i++) {
  autonomy.snapshot();                                  // former autonomy:getSnapshot
  autonomy.listEnvelopes();                             // former autonomy:listEnvelopes
  autonomy.getEnvelope(active.envelopeId);              // former autonomy:getEnvelope
  autonomy.getEnvelope(pending.envelopeId);
  autonomy.getEnvelope('does-not-exist');
  autonomy.listOperations();                            // former autonomy:listOperations
  autonomy.getOperation(op ? op.operationId : 'none');  // former autonomy:getOperation
  autonomy.getOperation('does-not-exist');
  ops.projection();                                     // canonical renderer path: company:getSnapshot / company:getOperations
}
const after = authoritative();

const diffs = Object.keys(before).filter((k) => before[k] !== after[k]);
const proj = ops.projection();
const report = {
  iterationsPerReadPath: N,
  readPaths: ['snapshot', 'listEnvelopes', 'getEnvelope x3', 'listOperations', 'getOperation x2', 'CompanyOperations.projection (company:getSnapshot/getOperations)'],
  fixture: { activeEnvelope: active.envelopeId, activeStatus: active.status, pendingEnvelope: pending.envelopeId, pendingStatus: pending.status, operation: op ? op.operationId : null, operationStatus: op ? op.status : null },
  canonicalProjectionCarriesAutonomy: Boolean(proj && proj.autonomy && Array.isArray(proj.autonomy.envelopes) && proj.autonomy.envelopes.length === 2),
  comparedFields: Object.keys(before),
  mutatedFields: diffs,
  operationalMutations: diffs.length,
  verdict: diffs.length === 0 ? 'PASS - 0 mutations' : 'FAIL'
};
console.log(JSON.stringify({ before, after, report }, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });
process.exitCode = diffs.length === 0 && report.canonicalProjectionCarriesAutonomy ? 0 : 1;
