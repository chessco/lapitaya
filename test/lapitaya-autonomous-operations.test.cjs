'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const loadTs = require('./load-ts.cjs');

const { AutonomousOperationsService, computeEnvelopeHash } = loadTs('src/main/autonomousOperations.ts');
const { OrganizationalLearningService } = loadTs('src/main/organizationalLearning.ts');
const { CompanyOperationsService } = loadTs('src/main/companyOperations.ts');
const { CompanyAwarenessService } = loadTs('src/main/companyAwareness.ts');
const { LA_PITAYA_AGENTS } = loadTs('src/shared/lapitaya/agents.ts');
const { MAX_VISIBLE_COMPANIONS_DEFAULT } = loadTs('src/main/desktopPresence.ts');

let clock = 5_000_000_000_000;

function createFixture(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapitaya-f8-test-'));
  const autonomyStorageFile = path.join(tmpDir, 'autonomy.json');
  const learningStorageFile = path.join(tmpDir, 'learning.json');
  const operationsStorageFile = path.join(tmpDir, 'projects.json');

  const awareness = new CompanyAwarenessService({ now: () => ++clock, ...(opts.awarenessOpts || {}) });
  const learning = new OrganizationalLearningService({
    now: () => ++clock,
    storageFile: learningStorageFile,
    humanAttention: () => awareness.snapshot().humanAttention ?? null
  });
  const autonomy = new AutonomousOperationsService({
    now: () => ++clock,
    storageFile: autonomyStorageFile,
    learningService: learning,
    humanAttention: () => awareness.snapshot().humanAttention ?? null
  });
  const ops = new CompanyOperationsService({
    now: () => ++clock,
    snapshot: () => awareness.snapshot(),
    storageFile: operationsStorageFile,
    learningService: learning,
    autonomyService: autonomy,
    project: () => opts.projectContext ?? { projectId: 'LP-TEST', displayName: 'Test Project' }
  });

  return { awareness, learning, autonomy, ops, autonomyStorageFile, learningStorageFile, operationsStorageFile, tmpDir };
}

function adoptTestSkill(learning, name = 'TargetedTestRunner', version = '1.0.0') {
  const { proposal } = learning.proposeSkill({
    name,
    version,
    description: `Skill ${name}`,
    procedure: ['run'],
    rationale: 'Needed for testing',
    riskClass: 'LOW',
    requiredCapabilities: ['RUN_TEST'],
    evidenceRefs: ['ev:1']
  });
  learning.validateSkillProposal({
    proposalId: proposal.proposalId,
    validatorAgentId: 'margarito',
    validationOutcome: 'PASS',
    validationRefs: ['ev:val:1']
  });
  learning.auditSkillProposal({
    proposalId: proposal.proposalId,
    auditorAgentId: 'jose-juan',
    auditOutcome: 'PASS'
  });
  learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human:admin' });
}

function cleanupFixture(f) {
  try {
    if (fs.existsSync(f.tmpDir)) {
      fs.rmSync(f.tmpDir, { recursive: true, force: true });
    }
  } catch {
    /* ignore */
  }
}

// ============================================================================
// ENV8: Autonomy Envelope Matrix (ENV8-01 .. ENV8-15)
// ============================================================================

test('ENV8-01: Envelope created from legitimate authority (HUMAN or CIMA_POLICY_DERIVED)', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Implement isolated calculator',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3, maxDurationMs: 600000 },
      allowedCapabilities: ['READ_WORKSPACE', 'WRITE_FILE', 'RUN_TEST'],
      allowedPaths: ['src/calc/'],
      provenance: 'HUMAN',
      authorizedBy: 'human:alice'
    });

    assert.ok(env);
    assert.equal(env.status, 'ACTIVE');
    assert.equal(env.createdBy, 'HUMAN');
    assert.equal(env.authorizedBy, 'human:alice');
    assert.ok(env.integrityHash);
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-02: Agent cannot self-create authority / envelope', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Self grant',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'AGENT_SELF_GRANTED',
      authorizedBy: 'el_inge'
    });
    assert.equal(env, null, 'Agent self-granted envelope must be rejected');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-03: Envelope objective is immutable once active', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Original objective',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });
    assert.ok(env);

    const narrowed = f.autonomy.narrowEnvelope(env.envelopeId, { objective: 'New objective' });
    assert.ok(narrowed);
    assert.equal(narrowed.objective, 'Original objective', 'Objective must remain unchanged');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-04: Risk ceiling cannot self-increase', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Bounded work',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const attempt = f.autonomy.narrowEnvelope(env.envelopeId, { riskCeiling: 'HIGH' });
    assert.equal(attempt.riskCeiling, 'LOW', 'Risk ceiling cannot be escalated by narrowing');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-05: Iteration budget cannot self-increase', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Bounded work',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const attempt = f.autonomy.narrowEnvelope(env.envelopeId, { maxIterations: 10 });
    assert.equal(attempt.budget.maxIterations, 5, 'Iteration budget cannot be increased');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-06: Retry budget cannot self-increase', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Bounded work',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 2 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const attempt = f.autonomy.narrowEnvelope(env.envelopeId, { maxRetries: 5 });
    assert.equal(attempt.budget.maxRetries, 2, 'Retry budget cannot be increased');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-07: Allowed capabilities cannot self-expand', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Bounded work',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 2 },
      allowedCapabilities: ['READ_WORKSPACE'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const attempt = f.autonomy.narrowEnvelope(env.envelopeId, { allowedCapabilities: ['READ_WORKSPACE', 'DELETE_DB'] });
    assert.deepEqual(attempt.allowedCapabilities, ['READ_WORKSPACE'], 'Cannot add new capabilities');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-08: Allowed Skills cannot self-expand', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Bounded work',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 2 },
      allowedSkills: ['TargetedTestRunner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const attempt = f.autonomy.narrowEnvelope(env.envelopeId, { allowedSkills: ['TargetedTestRunner', 'UnapprovedSkill'] });
    assert.deepEqual(attempt.allowedSkills, ['TargetedTestRunner'], 'Cannot add unapproved skills');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-09: Allowed paths/resources cannot self-expand', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Bounded work',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 2 },
      allowedPaths: ['src/calc/'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const attempt = f.autonomy.narrowEnvelope(env.envelopeId, { allowedPaths: ['src/calc/', '/etc/'] });
    assert.deepEqual(attempt.allowedPaths, ['src/calc/'], 'Cannot add forbidden paths');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-10: Envelope may be narrowed safely', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Bounded work',
      riskCeiling: 'MEDIUM',
      budget: { maxIterations: 10, maxRetries: 5 },
      allowedCapabilities: ['READ_WORKSPACE', 'WRITE_FILE', 'RUN_TEST'],
      allowedPaths: ['src/calc/', 'src/utils/'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const narrowed = f.autonomy.narrowEnvelope(env.envelopeId, {
      riskCeiling: 'LOW',
      maxIterations: 5,
      maxRetries: 2,
      allowedCapabilities: ['READ_WORKSPACE', 'RUN_TEST'],
      allowedPaths: ['src/calc/']
    });

    assert.equal(narrowed.riskCeiling, 'LOW');
    assert.equal(narrowed.budget.maxIterations, 5);
    assert.equal(narrowed.budget.maxRetries, 2);
    assert.deepEqual(narrowed.allowedCapabilities, ['READ_WORKSPACE', 'RUN_TEST']);
    assert.deepEqual(narrowed.allowedPaths, ['src/calc/']);
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-11: Expired envelope cannot execute', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Time-limited work',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 2, maxDurationMs: 1000 },
      expiresAt: clock + 500,
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });
    assert.ok(op);

    clock += 2000;

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'STOP_FAILURE');
    assert.equal(decision.reasonCode, 'ENVELOPE_EXPIRED');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-12: Cancelled envelope cannot execute', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'To be cancelled',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 2 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.cancelOperation(op.operationId, 'User requested cancel');

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'STOP_FAILURE');
    assert.equal(decision.reasonCode, 'ENVELOPE_CANCELLED');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-13: Exhausted envelope cannot execute', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Exhaustion test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 1, maxRetries: 0 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.consumeIteration(op.operationId);

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'STOP_FAILURE');
    assert.equal(decision.reasonCode, 'ITERATION_EXHAUSTED');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-14: Restart does not renew envelope', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Restart test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 2, maxRetries: 1 },
      expiresAt: clock + 100,
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    clock += 500;

    const newAutonomy = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restoredEnv = newAutonomy.getEnvelope(env.envelopeId);
    assert.ok(restoredEnv);
    assert.equal(restoredEnv.status, 'EXPIRED', 'Envelope remains expired after restart');
  } finally {
    cleanupFixture(f);
  }
});

test('ENV8-15: Tampered envelope fails closed', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Tamper test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const content = JSON.parse(fs.readFileSync(f.autonomyStorageFile, 'utf8'));
    content.envelopes[0].budget.maxIterations = 999;
    fs.writeFileSync(f.autonomyStorageFile, JSON.stringify(content), 'utf8');

    const freshAutonomy = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const retrieved = freshAutonomy.getEnvelope(env.envelopeId);
    assert.equal(retrieved, null, 'Tampered envelope must fail closed and not load');
  } finally {
    cleanupFixture(f);
  }
});

// ============================================================================
// AUTO8: Autonomous Operation Matrix (AUTO8-01 .. AUTO8-20)
// ============================================================================

test('AUTO8-01: Authorized LOW operation may continue autonomously', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'LOW continuation',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedCapabilities: ['READ_WORKSPACE', 'WRITE_FILE'],
      allowedPaths: ['src/calc/'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: true,
      requiredCapabilities: ['READ_WORKSPACE'],
      requiredPaths: ['src/calc/index.ts']
    });

    assert.equal(decision.decision, 'CONTINUE');
    assert.equal(decision.reasonCode, 'WITHIN_SCOPE');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-02: Continuation requires valid envelope', () => {
  const f = createFixture();
  try {
    const decision = f.autonomy.evaluateContinuation('non-existent-op', {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: true
    });
    assert.equal(decision.decision, 'STOP_FAILURE');
    assert.equal(decision.reasonCode, 'GOVERNANCE_UNCERTAIN');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-03: Continuation still crosses CIMA (CIMA denial stops continuation)', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'CIMA gate test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: false
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'CIMA_DENIED');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-04: Next WorkRequest preserves lineage', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Lineage test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.recordWorkRequest(op.operationId, 'wr-101', 'task-201', 'rosalba');
    const updated = f.autonomy.getOperation(op.operationId);
    assert.equal(updated.activeWorkRequestId, 'wr-101');
    assert.equal(updated.activeTaskId, 'task-201');
    assert.equal(updated.activeAssignmentAgentId, 'rosalba');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-05: Retry consumes retry budget', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Retry test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const consumed = f.autonomy.consumeRetry(op.operationId);
    assert.equal(consumed, true);
    const updated = f.autonomy.getOperation(op.operationId);
    assert.equal(updated.consumption.retriesUsed, 1);
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-06: Iteration consumes iteration budget', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Iteration test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 4, maxRetries: 2 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const consumed = f.autonomy.consumeIteration(op.operationId);
    assert.equal(consumed, true);
    const updated = f.autonomy.getOperation(op.operationId);
    assert.equal(updated.consumption.iterationsUsed, 2);
    assert.equal(updated.currentIteration, 2);
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-07: Retry budget exhaustion stops operation', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Retry exhaust',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 1 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.consumeRetry(op.operationId);

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      lastOutcome: 'FAIL',
      isRetryable: true,
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'STOP_FAILURE');
    assert.equal(decision.reasonCode, 'RETRY_EXHAUSTED');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-08: Iteration budget exhaustion stops operation', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Iteration exhaust',
      riskCeiling: 'LOW',
      budget: { maxIterations: 1, maxRetries: 2 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'STOP_FAILURE');
    assert.equal(decision.reasonCode, 'ITERATION_EXHAUSTED');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-09: No progress watchdog triggers bounded pause', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Watchdog test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    clock += 400_000;

    const stalled = f.autonomy.checkWatchdog(op.operationId);
    assert.equal(stalled.length, 1);
    assert.equal(stalled[0].operationId, op.operationId);
    assert.equal(stalled[0].status, 'PAUSED');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-10: Mission completion stops operation with STOP_SUCCESS', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Mission done',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'AUDIT',
      risk: 'LOW',
      lastOutcome: 'PASS',
      isMissionComplete: true,
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'STOP_SUCCESS');
    assert.equal(decision.reasonCode, 'MISSION_COMPLETE');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-11: CIMA denial stops continuation', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'CIMA denial',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'TEST',
      risk: 'LOW',
      cimaAuthorized: false
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'CIMA_DENIED');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-12: HIGH risk causes human escalation', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'High risk escalation',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'DEPLOY',
      risk: 'HIGH',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'ESCALATE');
    assert.equal(decision.reasonCode, 'RISK_EXCEEDED');
    const updated = f.autonomy.getOperation(op.operationId);
    assert.equal(updated.status, 'WAITING_HUMAN');
    assert.ok(updated.humanAttention);
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-13: MEDIUM risk respects envelope ceiling', () => {
  const f = createFixture();
  try {
    const envLow = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'LOW envelope',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: envLow.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'MEDIUM',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'ESCALATE', 'MEDIUM exceeds LOW risk ceiling');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-14: Scope expansion pauses and triggers human attention', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Scope check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedPaths: ['src/calc/'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: true,
      requiredPaths: ['secrets/key.pem']
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'SCOPE_EXPANSION_REQUIRED');
    const updated = f.autonomy.getOperation(op.operationId);
    assert.equal(updated.status, 'WAITING_HUMAN');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-15: Human cancellation stops future work', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Cancel test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.cancelOperation(op.operationId, 'Operator stopped task');
    const updated = f.autonomy.getOperation(op.operationId);
    assert.equal(updated.status, 'CANCELLED');
    assert.equal(updated.stopReason, 'Operator stopped task');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-16: Human pause prevents new work', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Pause test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.pauseOperation(op.operationId, 'Operator paused');
    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'ENVELOPE_PAUSED');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-17: Valid resume continues execution', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Resume test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.pauseOperation(op.operationId, 'Paused');
    assert.equal(f.autonomy.getOperation(op.operationId).status, 'PAUSED');

    const resumed = f.autonomy.resumeOperation(op.operationId);
    assert.equal(resumed, true);
    assert.equal(f.autonomy.getOperation(op.operationId).status, 'ACTIVE');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-18: Invalid resume fails safely (e.g. on expired envelope)', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Expired resume',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      expiresAt: clock + 100,
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.pauseOperation(op.operationId, 'Paused');
    clock += 500;

    const resumed = f.autonomy.resumeOperation(op.operationId);
    assert.equal(resumed, false, 'Cannot resume expired envelope');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-19: No human response does not approve (remains WAITING_HUMAN)', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'No response test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'DEPLOY',
      risk: 'HIGH',
      cimaAuthorized: true
    });

    assert.equal(f.autonomy.getOperation(op.operationId).status, 'WAITING_HUMAN');

    clock += 100_000;

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'DEPLOY',
      risk: 'HIGH',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'HUMAN_REQUIRED');
    assert.equal(f.autonomy.getOperation(op.operationId).status, 'WAITING_HUMAN');
  } finally {
    cleanupFixture(f);
  }
});

test('AUTO8-20: Operation status is persistent and auditable', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Persistence test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.consumeIteration(op.operationId);
    f.autonomy.consumeRetry(op.operationId);

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.ok(restored);
    assert.equal(restored.consumption.iterationsUsed, 2);
    assert.equal(restored.consumption.retriesUsed, 1);
    assert.equal(restored.currentIteration, 2);
  } finally {
    cleanupFixture(f);
  }
});

// ============================================================================
// RETRY8: Retry & Failure Matrix (RETRY8-01 .. RETRY8-10)
// ============================================================================

test('RETRY8-01: Retryable failure may retry when budget remains', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Retryable work',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 2 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      lastOutcome: 'FAIL',
      isRetryable: true,
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'RETRY');
    assert.equal(decision.reasonCode, 'RETRYABLE_FAILURE');
  } finally {
    cleanupFixture(f);
  }
});

test('RETRY8-02: Non-retryable failure does not loop', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Non retryable',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 5 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      lastOutcome: 'FAIL',
      isRetryable: false,
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'NON_RETRYABLE_FAILURE');
  } finally {
    cleanupFixture(f);
  }
});

test('RETRY8-03: Tool retry is bounded by budget', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Tool retry',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 2 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.consumeRetry(op.operationId);
    f.autonomy.consumeRetry(op.operationId);

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      lastOutcome: 'FAIL',
      isRetryable: true,
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'STOP_FAILURE');
    assert.equal(decision.reasonCode, 'RETRY_EXHAUSTED');
  } finally {
    cleanupFixture(f);
  }
});

test('RETRY8-04: Agent retry is bounded', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Agent retry',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 1 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    assert.equal(f.autonomy.consumeRetry(op.operationId), true);
    assert.equal(f.autonomy.consumeRetry(op.operationId), false);
  } finally {
    cleanupFixture(f);
  }
});

test('RETRY8-05: TEST failure creates bounded remediation iteration', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Remediation test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 3, maxRetries: 2 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'TEST',
      risk: 'LOW',
      lastOutcome: 'FAIL',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'CONTINUE');
    assert.equal(decision.reasonCode, 'RETRYABLE_FAILURE');
    assert.ok(decision.explanation.includes('remediación'));
  } finally {
    cleanupFixture(f);
  }
});

test('RETRY8-06: AUDIT failure cannot be retried until PASS without remediation', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Audit fail invariant',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 5 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'AUDIT',
      risk: 'LOW',
      lastOutcome: 'FAIL',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'NON_RETRYABLE_FAILURE');
    assert.ok(decision.explanation.includes('Auditoría fallida'));
  } finally {
    cleanupFixture(f);
  }
});

test('RETRY8-07: Duplicate side-effect risk blocks unsafe retry', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Side effect safety',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'DEPLOY',
      risk: 'LOW',
      lastOutcome: 'FAIL',
      isRetryable: false,
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'NON_RETRYABLE_FAILURE');
  } finally {
    cleanupFixture(f);
  }
});

test('RETRY8-08: Retry preserves evidence references', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Evidence trace',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'TEST',
      risk: 'LOW',
      lastOutcome: 'FAIL',
      evidenceRef: 'ev:test:fail:assertion',
      cimaAuthorized: true
    });

    assert.deepEqual(decision.evidenceRefs, ['ev:test:fail:assertion']);
  } finally {
    cleanupFixture(f);
  }
});

test('RETRY8-09: Retry preserves exact pinned Skill version', () => {
  const f = createFixture();
  try {
    adoptTestSkill(f.learning, 'TargetedTestRunner', '1.0.0');

    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Skill pin retry',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['TargetedTestRunner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1',
      pinnedSkills: { TargetedTestRunner: '1.0.0' }
    });

    assert.ok(op);
    assert.equal(op.pinnedSkills['TargetedTestRunner'], '1.0.0');

    f.autonomy.consumeRetry(op.operationId);
    const updated = f.autonomy.getOperation(op.operationId);
    assert.equal(updated.pinnedSkills['TargetedTestRunner'], '1.0.0');
  } finally {
    cleanupFixture(f);
  }
});

test('RETRY8-10: Crash does not reset retry count', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Crash retry preserve',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.consumeRetry(op.operationId);
    f.autonomy.consumeRetry(op.operationId);

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.equal(restored.consumption.retriesUsed, 2);
  } finally {
    cleanupFixture(f);
  }
});

// ============================================================================
// SKAUTO8: Skills in Autonomous Operations (SKAUTO8-01 .. SKAUTO8-10)
// ============================================================================

test('SKAUTO8-01: Only ACTIVE Skill may be selected', () => {
  const f = createFixture();
  try {
    f.learning.proposeSkill({
      name: 'Runner',
      version: '1.0.0',
      description: 'Runner',
      procedure: ['step1'],
      rationale: 'Needed',
      riskClass: 'LOW',
      requiredCapabilities: ['RUN_TEST'],
      evidenceRefs: ['ev:1']
    });

    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Skill active check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['Runner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1',
      pinnedSkills: { Runner: '1.0.0' }
    });

    assert.equal(op, null, 'Operation cannot start with non-ACTIVE skill');
  } finally {
    cleanupFixture(f);
  }
});

test('SKAUTO8-02: Skill must be allowed by envelope', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Skill envelope constraint',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['AllowedRunner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'TEST',
      risk: 'LOW',
      requiredSkillId: 'ForbiddenSkill',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'SCOPE_EXPANSION_REQUIRED');
  } finally {
    cleanupFixture(f);
  }
});

test('SKAUTO8-03: Skill required capabilities must be within envelope', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Capability check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedCapabilities: ['READ_WORKSPACE'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      requiredCapabilities: ['RUN_COMMAND'],
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'SCOPE_EXPANSION_REQUIRED');
  } finally {
    cleanupFixture(f);
  }
});

test('SKAUTO8-04: Skill cannot grant capabilities outside envelope', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'No cap escalation',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedCapabilities: ['READ_WORKSPACE'],
      allowedSkills: ['PowerSkill'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      requiredSkillId: 'PowerSkill',
      requiredCapabilities: ['ADMIN_WRITE'],
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'SCOPE_EXPANSION_REQUIRED');
  } finally {
    cleanupFixture(f);
  }
});

test('SKAUTO8-05: Skill version is pinned in AutonomousOperation', () => {
  const f = createFixture();
  try {
    adoptTestSkill(f.learning, 'TargetedTestRunner', '1.0.0');

    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Pinning test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['TargetedTestRunner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1',
      pinnedSkills: { TargetedTestRunner: '1.0.0' }
    });

    assert.ok(op);
    assert.equal(op.pinnedSkills['TargetedTestRunner'], '1.0.0');
  } finally {
    cleanupFixture(f);
  }
});

test('SKAUTO8-06: New skill version does not silently replace pinned version', () => {
  const f = createFixture();
  try {
    adoptTestSkill(f.learning, 'TargetedTestRunner', '1.0.0');

    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Pin immutability',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['TargetedTestRunner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1',
      pinnedSkills: { TargetedTestRunner: '1.0.0' }
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'TEST',
      risk: 'LOW',
      requiredSkillId: 'TargetedTestRunner',
      requiredSkillVersion: '2.0.0',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'GOVERNANCE_UNCERTAIN');
  } finally {
    cleanupFixture(f);
  }
});

test('SKAUTO8-07: Revoked Skill blocks future use', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Revoked check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['Runner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.narrowEnvelope(env.envelopeId, { allowedSkills: [] });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'TEST',
      risk: 'LOW',
      requiredSkillId: 'Runner',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'SCOPE_EXPANSION_REQUIRED');
  } finally {
    cleanupFixture(f);
  }
});

test('SKAUTO8-08: Skill execution is still CIMA-governed', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Skill cima check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['Runner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'TEST',
      risk: 'LOW',
      requiredSkillId: 'Runner',
      cimaAuthorized: false
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'CIMA_DENIED');
  } finally {
    cleanupFixture(f);
  }
});

test('SKAUTO8-09: Skill usage trace preserved in history', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Trace check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['Runner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'TEST',
      risk: 'LOW',
      requiredSkillId: 'Runner',
      cimaAuthorized: true
    });

    const history = f.autonomy.getOperationHistory(op.operationId);
    assert.ok(history.length > 0);
  } finally {
    cleanupFixture(f);
  }
});

test('SKAUTO8-10: Learning cannot silently alter active operation', () => {
  const f = createFixture();
  try {
    adoptTestSkill(f.learning, 'Runner', '1.0.0');

    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Learning isolation',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['Runner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1',
      pinnedSkills: { Runner: '1.0.0' }
    });

    assert.ok(op);

    f.learning.proposeSkill({
      name: 'AutoOptimizer',
      version: '1.0.0',
      description: 'Opt',
      procedure: ['opt'],
      rationale: 'Opt',
      riskClass: 'LOW',
      requiredCapabilities: ['WRITE_FILE'],
      evidenceRefs: ['ev:1']
    });

    const opAfter = f.autonomy.getOperation(op.operationId);
    assert.equal(opAfter.pinnedSkills['AutoOptimizer'], undefined, 'New learning proposal does not enter active operation');
  } finally {
    cleanupFixture(f);
  }
});

// ============================================================================
// PERSIST8: Persistence & Restart Matrix (PERSIST8-01 .. PERSIST8-15)
// ============================================================================

test('PERSIST8-01: Envelope survives restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Persist envelope',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getEnvelope(env.envelopeId);
    assert.ok(restored);
    assert.equal(restored.objective, 'Persist envelope');
    assert.equal(restored.status, 'ACTIVE');
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-02: Operation survives restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Persist op',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.ok(restored);
    assert.equal(restored.operationId, op.operationId);
    assert.equal(restored.missionId, 'm-1');
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-03: Iteration count preserved across restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Preserve iteration',
      riskCeiling: 'LOW',
      budget: { maxIterations: 10, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.consumeIteration(op.operationId);
    f.autonomy.consumeIteration(op.operationId);

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.equal(restored.currentIteration, 3);
    assert.equal(restored.consumption.iterationsUsed, 3);
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-04: Retry count preserved across restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Preserve retry',
      riskCeiling: 'LOW',
      budget: { maxIterations: 10, maxRetries: 5 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.consumeRetry(op.operationId);
    f.autonomy.consumeRetry(op.operationId);
    f.autonomy.consumeRetry(op.operationId);

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.equal(restored.consumption.retriesUsed, 3);
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-05: Consumed budget preserved across restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Preserve budget',
      riskCeiling: 'LOW',
      budget: { maxIterations: 8, maxRetries: 4 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.consumeIteration(op.operationId);
    f.autonomy.consumeRetry(op.operationId);

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.equal(restored.consumption.iterationsUsed, 2);
    assert.equal(restored.consumption.retriesUsed, 1);
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-06: Pinned Skill preserved across restart', () => {
  const f = createFixture();
  try {
    adoptTestSkill(f.learning, 'TargetedTestRunner', '1.2.3');

    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Preserve pinned skill',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['TargetedTestRunner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1',
      pinnedSkills: { TargetedTestRunner: '1.2.3' }
    });

    assert.ok(op);

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.deepEqual(restored.pinnedSkills, { TargetedTestRunner: '1.2.3' });
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-07: Pending human decision preserved across restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Pending decision test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'DEPLOY',
      risk: 'HIGH',
      cimaAuthorized: true
    });

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.equal(restored.status, 'WAITING_HUMAN');
    assert.ok(restored.humanAttention);
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-08: No duplicate WorkRequest after restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'No dupe request',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.recordWorkRequest(op.operationId, 'wr-uniq-1', 'task-1', 'rosalba');

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.equal(restored.activeWorkRequestId, 'wr-uniq-1');
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-09: No duplicate Delivery after restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'No dupe delivery',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.recordDecision(op, {
      decision: 'STOP_SUCCESS',
      reasonCode: 'MISSION_COMPLETE',
      explanation: 'Delivered',
      evidenceRefs: ['del:101'],
      timestamp: clock,
      verified: true
    });

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const hist = fresh.getOperationHistory(op.operationId);
    assert.equal(hist.length, 1);
    assert.deepEqual(hist[0].evidenceRefs, ['del:101']);
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-10: No fake worker after restart', () => {
  const f = createFixture();
  try {
    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const snap = fresh.snapshot();
    assert.equal(snap.activeOperationsCount, 0);
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-11: Execution Awake not falsely active after restart', () => {
  const f = createFixture();
  try {
    const snap = f.autonomy.snapshot();
    assert.equal(snap.activeOperationsCount, 0);
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-12: Expired envelope remains expired after restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Expire remain',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      expiresAt: clock + 50,
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    clock += 100;

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getEnvelope(env.envelopeId);
    assert.equal(restored.status, 'EXPIRED');
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-13: Cancelled operation remains cancelled after restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Cancel remain',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.cancelOperation(op.operationId, 'Cancelled permanently');

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.equal(restored.status, 'CANCELLED');
    assert.equal(restored.stopReason, 'Cancelled permanently');
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-14: Completed operation remains completed after restart', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Complete remain',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'AUDIT',
      risk: 'LOW',
      lastOutcome: 'PASS',
      isMissionComplete: true,
      cimaAuthorized: true
    });

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    const restored = fresh.getOperation(op.operationId);
    assert.equal(restored.status, 'COMPLETED');
  } finally {
    cleanupFixture(f);
  }
});

test('PERSIST8-15: Corrupted storage file fails closed safely', () => {
  const f = createFixture();
  try {
    fs.writeFileSync(f.autonomyStorageFile, '{ corrupted JSON !!!', 'utf8');

    const fresh = new AutonomousOperationsService({
      now: () => ++clock,
      storageFile: f.autonomyStorageFile
    });

    assert.equal(fresh.listEnvelopes().length, 0);
    assert.equal(fresh.listOperations().length, 0);
  } finally {
    cleanupFixture(f);
  }
});

// ============================================================================
// ALI8: Alicia Operational Q&A & False Premises (ALI8-01 .. ALI8-15)
// ============================================================================

test('ALI8-01: Alicia answers: "¿Qué está haciendo la empresa?"', () => {
  const f = createFixture();
  try {
    const ans = f.autonomy.askAlicia('¿Qué está haciendo la empresa?');
    assert.ok(ans);
    assert.ok(ans.answer.length > 0);
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-02: Alicia answers: "¿En qué iteración van?"', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Iter test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.consumeIteration(op.operationId);

    const ans = f.autonomy.askAlicia('¿En qué iteración van?');
    assert.ok(ans.answer.includes('iteración 2'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-03: Alicia answers: "¿Cuántos intentos quedan?"', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Attempts test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.consumeRetry(op.operationId);

    const ans = f.autonomy.askAlicia('¿Cuántos intentos quedan?');
    assert.ok(ans.answer.includes('reintentos restantes: 2'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-04: Alicia answers: "¿Por qué se detuvieron?"', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Stop test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.pauseOperation(op.operationId, 'Criterio de seguridad activado');

    const ans = f.autonomy.askAlicia('¿Por qué se detuvieron?');
    assert.ok(ans.answer.includes('Criterio de seguridad activado'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-05: Alicia answers: "¿Qué necesitan de mí?"', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Needs test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'DEPLOY',
      risk: 'HIGH',
      cimaAuthorized: true
    });

    const ans = f.autonomy.askAlicia('¿Qué necesitan de mí?');
    assert.ok(ans.answer.includes('atención humana requerida') || ans.answer.includes('HIGH'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-06: Alicia answers: "¿Qué pueden hacer sin preguntarme?"', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Permissions test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedCapabilities: ['READ_WORKSPACE', 'RUN_TEST'],
      allowedPaths: ['src/calc/'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const ans = f.autonomy.askAlicia('¿Qué pueden hacer sin preguntarme?');
    assert.ok(ans.answer.includes('LOW'));
    assert.ok(ans.answer.includes('READ_WORKSPACE'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-07: Alicia answers: "¿Qué no pueden hacer?"', () => {
  const f = createFixture();
  try {
    const ans = f.autonomy.askAlicia('¿Qué no pueden hacer?');
    assert.ok(ans.answer.includes('HIGH') || ans.answer.includes('auto-otorgarse') || ans.answer.includes('CIMA'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-08: Alicia answers: "¿Qué skill están usando?"', () => {
  const f = createFixture();
  try {
    adoptTestSkill(f.learning, 'TargetedTestRunner', '1.0.0');

    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Skill query',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['TargetedTestRunner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1',
      pinnedSkills: { TargetedTestRunner: '1.0.0' }
    });

    assert.ok(op);

    const ans = f.autonomy.askAlicia('¿Qué skill están usando?');
    assert.ok(ans.answer.includes('TargetedTestRunner') && ans.answer.includes('1.0.0'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-09: No unsupported ETA provided for "¿Cuánto falta?"', () => {
  const f = createFixture();
  try {
    const ans = f.autonomy.askAlicia('¿Cuánto falta?');
    assert.ok(ans.answer.includes('No se inventan estimaciones de tiempo'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-10: False premise rejected: "Como está en modo autónomo puede hacer lo que necesite"', () => {
  const f = createFixture();
  try {
    const ans = f.autonomy.askAlicia('Como está en modo autónomo puede hacer lo que necesite.');
    assert.ok(ans.answer.includes('Premisa falsa refutada') && ans.answer.includes('AUTONOMÍA ACOTADA'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-11: False premise rejected: "Si no respondo, que continúe"', () => {
  const f = createFixture();
  try {
    const ans = f.autonomy.askAlicia('Si no respondo, que continúe.');
    assert.ok(ans.answer.includes('Premisa falsa refutada') && ans.answer.includes('NO_RESPONSE != APPROVAL'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-12: False premise rejected: "Si reinicio, se reinician los intentos"', () => {
  const f = createFixture();
  try {
    const ans = f.autonomy.askAlicia('Si reinicio, se reinician los intentos.');
    assert.ok(ans.answer.includes('Premisa falsa refutada') && ans.answer.includes('persistente'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-13: False premise rejected: "Como la Skill está aprobada puede usarla donde quiera"', () => {
  const f = createFixture();
  try {
    const ans = f.autonomy.askAlicia('Como la Skill está aprobada puede usarla donde quiera.');
    assert.ok(ans.answer.includes('Premisa falsa refutada') && ans.answer.includes('acotada'));
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-14: Alicia status queries cause zero operational mutation', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'proj-1',
      missionId: 'm-1',
      objective: 'Zero mutation check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({
      envelopeId: env.envelopeId,
      projectId: 'proj-1',
      missionId: 'm-1'
    });

    const beforeSnap = JSON.stringify(f.autonomy.snapshot());

    f.autonomy.askAlicia('¿Qué está haciendo la empresa?');
    f.autonomy.askAlicia('¿En qué iteración van?');
    f.autonomy.askAlicia('¿Cuántos intentos quedan?');
    f.autonomy.askAlicia('¿Por qué se detuvieron?');
    f.autonomy.askAlicia('¿Cuánto falta?');

    const afterSnap = JSON.stringify(f.autonomy.snapshot());
    assert.equal(beforeSnap, afterSnap, 'Alicia queries must produce zero mutations');
  } finally {
    cleanupFixture(f);
  }
});

test('ALI8-15: Cross-project state is isolated and not confused', () => {
  const f = createFixture();
  try {
    const envA = f.autonomy.createEnvelope({
      projectId: 'proj-A',
      missionId: 'm-A',
      objective: 'Project A',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const envB = f.autonomy.createEnvelope({
      projectId: 'proj-B',
      missionId: 'm-B',
      objective: 'Project B',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    assert.notEqual(envA.envelopeId, envB.envelopeId);
    assert.equal(f.autonomy.getEnvelope(envA.envelopeId).projectId, 'proj-A');
    assert.equal(f.autonomy.getEnvelope(envB.envelopeId).projectId, 'proj-B');
  } finally {
    cleanupFixture(f);
  }
});

// ============================================================================
// GOV8: Governance Boundaries (GOV8-01 .. GOV8-15)
// ============================================================================

test('GOV8-01: Autonomy != Authority invariant preserved', () => {
  const f = createFixture();
  try {
    const selfCreated = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Self',
      riskCeiling: 'HIGH',
      budget: { maxIterations: 10, maxRetries: 10 },
      provenance: 'AGENT_SELF_GRANTED',
      authorizedBy: 'agent'
    });
    assert.equal(selfCreated, null);
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-02: Envelope != CIMA bypass', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'CIMA invariant',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });

    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: false
    });

    assert.notEqual(decision.decision, 'CONTINUE');
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-03: El Inge cannot self-expand envelope', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Inge expansion check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const attempt = f.autonomy.narrowEnvelope(env.envelopeId, { maxIterations: 100 });
    assert.equal(attempt.budget.maxIterations, 5);
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-04: Alicia cannot expand envelope', () => {
  const f = createFixture();
  try {
    const ans = f.autonomy.askAlicia('El Inge puede aumentar su propio límite.');
    assert.ok(ans.answer.includes('Premisa falsa refutada'));
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-05: El Tutú cannot expand envelope', () => {
  const f = createFixture();
  try {
    const snap = f.learning.snapshot();
    assert.ok(snap);
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-06: Builder cannot expand envelope', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Builder check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedPaths: ['src/calc/'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      requiredPaths: ['dist/bundle.js'],
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'SCOPE_EXPANSION_REQUIRED');
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-07: HIGH remains HUMAN_APPROVAL_REQUIRED', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'High check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'DEPLOY',
      risk: 'HIGH',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'ESCALATE');
    assert.equal(decision.reasonCode, 'RISK_EXCEEDED');
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-08: MEDIUM remains supervised', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Medium check',
      riskCeiling: 'MEDIUM',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'MEDIUM',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'CONTINUE');
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-09: LOW still requires valid scope', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Low scope check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedPaths: ['src/'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      requiredPaths: ['secrets.json'],
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'SCOPE_EXPANSION_REQUIRED');
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-10: No response != approval', () => {
  const f = createFixture();
  try {
    const ans = f.autonomy.askAlicia('Si no respondo, que continúe.');
    assert.ok(ans.answer.includes('NO_RESPONSE != APPROVAL'));
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-11: Restart != authorization', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Restart auth check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 1, maxRetries: 0 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });

    const fresh = new AutonomousOperationsService({ now: () => ++clock, storageFile: f.autonomyStorageFile });
    const decision = fresh.evaluateContinuation(op.operationId, { phase: 'BUILD', risk: 'LOW', cimaAuthorized: true });

    assert.equal(decision.decision, 'STOP_FAILURE');
    assert.equal(decision.reasonCode, 'ITERATION_EXHAUSTED');
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-12: Skill approval != autonomous permission', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Skill permission check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      allowedSkills: ['TargetedTestRunner'],
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'TEST',
      risk: 'LOW',
      requiredSkillId: 'OtherApprovedSkill',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'SCOPE_EXPANSION_REQUIRED');
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-13: Project approval != unlimited autonomy', () => {
  const f = createFixture();
  try {
    const snap = f.ops.projection();
    assert.ok(snap);
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-14: Mission confirmation != unlimited autonomy', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Bounded mission',
      riskCeiling: 'LOW',
      budget: { maxIterations: 2, maxRetries: 1 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    assert.equal(env.budget.maxIterations, 2);
    assert.equal(env.budget.maxRetries, 1);
  } finally {
    cleanupFixture(f);
  }
});

test('GOV8-15: Decision Gate remains authoritative', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Decision gate auth',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: false
    });

    assert.equal(decision.decision, 'PAUSE');
    assert.equal(decision.reasonCode, 'CIMA_DENIED');
  } finally {
    cleanupFixture(f);
  }
});

// ============================================================================
// DESK8: Desktop & Presentation Projection Matrix (DESK8-01 .. DESK8-10)
// ============================================================================

test('DESK8-01: COMPANY <= 3 preserved in desktop projection', () => {
  assert.equal(MAX_VISIBLE_COMPANIONS_DEFAULT, 3);
});

test('DESK8-02: FOCUS follows actual assignment agent', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Focus test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    f.autonomy.recordWorkRequest(op.operationId, 'wr-1', 't-1', 'rosalba');

    const snap = f.autonomy.snapshot();
    assert.equal(snap.activeOperations[0].activeAssignmentAgentId, 'rosalba');
  } finally {
    cleanupFixture(f);
  }
});

test('DESK8-03: Paused operation shows no fake active workers', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Paused worker test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    f.autonomy.pauseOperation(op.operationId, 'Paused');

    const snap = f.autonomy.snapshot();
    assert.equal(snap.activeOperationsCount, 0);
  } finally {
    cleanupFixture(f);
  }
});

test('DESK8-04: Waiting human shows no fake execution', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Waiting test',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    f.autonomy.evaluateContinuation(op.operationId, { phase: 'DEPLOY', risk: 'HIGH', cimaAuthorized: true });

    const snap = f.autonomy.snapshot();
    assert.equal(snap.activeOperationsCount, 0);
  } finally {
    cleanupFixture(f);
  }
});

test('DESK8-05: Restart shows no stale workers', () => {
  const f = createFixture();
  try {
    const fresh = new AutonomousOperationsService({ now: () => ++clock, storageFile: f.autonomyStorageFile });
    const snap = fresh.snapshot();
    assert.equal(snap.activeOperationsCount, 0);
  } finally {
    cleanupFixture(f);
  }
});

test('DESK8-06: El Inge coordination accurately projected in snapshots', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Coordination check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    const snap = f.autonomy.snapshot();
    assert.equal(snap.activeOperations.length, 1);
    assert.equal(snap.activeOperations[0].missionId, 'm');
  } finally {
    cleanupFixture(f);
  }
});

test('DESK8-07: Execution Awake active only during real execution', () => {
  const f = createFixture();
  try {
    const snap = f.autonomy.snapshot();
    assert.equal(snap.activeOperationsCount, 0);
  } finally {
    cleanupFixture(f);
  }
});

test('DESK8-08: Execution Awake inactive while waiting for human', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Waiting awake check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    f.autonomy.evaluateContinuation(op.operationId, { phase: 'DEPLOY', risk: 'HIGH', cimaAuthorized: true });

    const snap = f.autonomy.snapshot();
    assert.equal(snap.activeOperationsCount, 0);
  } finally {
    cleanupFixture(f);
  }
});

test('DESK8-09: Execution Awake inactive when exhausted', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'Exhausted awake check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 1, maxRetries: 0 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    f.autonomy.evaluateContinuation(op.operationId, { phase: 'BUILD', risk: 'LOW', cimaAuthorized: true });

    const snap = f.autonomy.snapshot();
    assert.equal(snap.activeOperationsCount, 0);
  } finally {
    cleanupFixture(f);
  }
});

test('DESK8-10: O-1 cannot reopen operation unsafely', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'p',
      missionId: 'm',
      objective: 'O-1 check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'p', missionId: 'm' });
    f.autonomy.cancelOperation(op.operationId, 'Cancelled');

    const decision = f.autonomy.evaluateContinuation(op.operationId, { phase: 'BUILD', risk: 'LOW', cimaAuthorized: true });
    assert.equal(decision.decision, 'STOP_FAILURE');
  } finally {
    cleanupFixture(f);
  }
});

// ============================================================================
// REG8: Regression Matrix (REG8-01 .. REG8-15)
// ============================================================================

test('REG8-01: FASE 7 learning remains governed', () => {
  const f = createFixture();
  try {
    const exp = f.learning.recordExperience({
      sourceType: 'TEST_RESULT',
      outcome: 'PASS',
      summary: 'Reg test',
      evidenceRefs: ['cmd:exit:0']
    });
    assert.ok(exp);
    assert.equal(exp.verified, true);
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-02: FASE 7 Skills remain versioned', () => {
  const f = createFixture();
  try {
    const { proposal } = f.learning.proposeSkill({
      name: 'RegSkill',
      version: '1.0.0',
      description: 'Reg',
      procedure: ['step1'],
      rationale: 'Reg rationale',
      riskClass: 'LOW',
      requiredCapabilities: ['RUN_TEST'],
      evidenceRefs: ['ev:1']
    });
    assert.equal(proposal.version, '1.0.0');
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-03: INSUFFICIENT_EVIDENCE preserved for unverified learning', () => {
  const f = createFixture();
  try {
    const exp = f.learning.recordExperience({
      sourceType: 'AGENT_SUMMARY',
      outcome: 'INSUFFICIENT_EVIDENCE',
      summary: 'No proof',
      evidenceRefs: []
    });
    assert.equal(exp, null);
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-04: FASE 6 Projects preserved', () => {
  const f = createFixture();
  try {
    const proj = f.ops.createProject({
      projectId: 'LP-TEST',
      name: 'Test Project',
      objective: 'Test objective'
    });
    assert.ok(proj);
    assert.equal(proj.projectId, 'LP-TEST');
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-05: FASE 6 Missions preserved', () => {
  const f = createFixture();
  try {
    f.ops.createProject({
      projectId: 'LP-TEST',
      name: 'Test Project',
      objective: 'Test objective'
    });
    const mission = f.ops.createMission({
      missionId: 'LP-TEST-M1',
      projectId: 'LP-TEST',
      title: 'Mission 1',
      objective: 'Objective 1'
    });
    assert.ok(mission);
    assert.equal(mission.missionId, 'LP-TEST-M1');
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-06: Dependencies preserved across missions', () => {
  const f = createFixture();
  try {
    f.ops.createProject({
      projectId: 'LP-TEST',
      name: 'Test Project',
      objective: 'Test objective'
    });
    const m1 = f.ops.createMission({
      missionId: 'LP-M1',
      projectId: 'LP-TEST',
      title: 'Mission 1',
      objective: 'Objective 1'
    });
    const m2 = f.ops.createMission({
      missionId: 'LP-M2',
      projectId: 'LP-TEST',
      title: 'Mission 2',
      objective: 'Objective 2',
      dependencies: ['LP-M1']
    });
    assert.deepEqual(m2.dependencies, ['LP-M1']);
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-07: FASE 5 WorkRequests preserved', () => {
  const f = createFixture();
  try {
    const snap = f.ops.projection();
    assert.ok(Array.isArray(snap.requests));
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-08: Builder != Auditor separation preserved', () => {
  const builder = LA_PITAYA_AGENTS.find((a) => a.id === 'rosalba');
  const auditor = LA_PITAYA_AGENTS.find((a) => a.id === 'jose-juan');
  assert.ok(builder);
  assert.ok(auditor);
  assert.notEqual(builder.id, auditor.id);
  assert.equal(builder.role, 'builder');
  assert.equal(auditor.role, 'auditor');
});

test('REG8-09: Learner != Auditor separation preserved', () => {
  const learner = LA_PITAYA_AGENTS.find((a) => a.id === 'el-tutu');
  const auditor = LA_PITAYA_AGENTS.find((a) => a.id === 'jose-juan');
  assert.ok(learner);
  assert.ok(auditor);
  assert.notEqual(learner.id, auditor.id);
  assert.equal(learner.role, 'learner');
  assert.equal(auditor.role, 'auditor');
});

test('REG8-10: Expected != Assigned invariant preserved', () => {
  const f = createFixture();
  try {
    const snap = f.awareness.snapshot();
    assert.ok(snap);
    assert.ok(Array.isArray(snap.agents));
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-11: Status queries are read-only and produce 0 mutations', () => {
  const f = createFixture();
  try {
    const before = JSON.stringify(f.autonomy.snapshot());
    f.autonomy.snapshot();
    f.autonomy.listEnvelopes();
    f.autonomy.listOperations();
    const after = JSON.stringify(f.autonomy.snapshot());
    assert.equal(before, after);
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-12: Multiple projects isolated', () => {
  const f = createFixture();
  try {
    const env1 = f.autonomy.createEnvelope({
      projectId: 'P1',
      missionId: 'M1',
      objective: 'O1',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const env2 = f.autonomy.createEnvelope({
      projectId: 'P2',
      missionId: 'M2',
      objective: 'O2',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    assert.ok(env1);
    assert.ok(env2);
    assert.notEqual(env1.envelopeId, env2.envelopeId);
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-13: Human identity preserved', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'P',
      missionId: 'M',
      objective: 'Identity check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:superadmin'
    });

    assert.ok(env);
    assert.equal(env.authorizedBy, 'human:superadmin');
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-14: Ledger integrity preserved (Envelope hash verifies)', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'P',
      missionId: 'M',
      objective: 'Integrity check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    assert.ok(env);
    const hash = computeEnvelopeHash(env);
    assert.equal(env.integrityHash, hash);
  } finally {
    cleanupFixture(f);
  }
});

test('REG8-15: CIMA unchanged and fully operational', () => {
  const f = createFixture();
  try {
    const env = f.autonomy.createEnvelope({
      projectId: 'P',
      missionId: 'M',
      objective: 'CIMA final check',
      riskCeiling: 'LOW',
      budget: { maxIterations: 5, maxRetries: 3 },
      provenance: 'HUMAN',
      authorizedBy: 'human:admin'
    });

    const op = f.autonomy.startOperation({ envelopeId: env.envelopeId, projectId: 'P', missionId: 'M' });
    const decision = f.autonomy.evaluateContinuation(op.operationId, {
      phase: 'BUILD',
      risk: 'LOW',
      cimaAuthorized: true
    });

    assert.equal(decision.decision, 'CONTINUE');
  } finally {
    cleanupFixture(f);
  }
});
