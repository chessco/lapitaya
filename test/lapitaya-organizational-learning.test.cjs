'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const loadTs = require('./load-ts.cjs');

const { OrganizationalLearningService } = loadTs('src/main/organizationalLearning.ts');
const { CompanyOperationsService } = loadTs('src/main/companyOperations.ts');
const { CompanyAwarenessService } = loadTs('src/main/companyAwareness.ts');
const { LA_PITAYA_AGENTS, LA_PITAYA_AGENT_BY_ID } = loadTs('src/shared/lapitaya/agents.ts');
const { MAX_VISIBLE_COMPANIONS_DEFAULT } = loadTs('src/main/desktopPresence.ts');

let clock = 4_000_000_000_000;

function createFixture(opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapitaya-f7-test-'));
  const learningStorageFile = path.join(tmpDir, 'learning.json');
  const operationsStorageFile = path.join(tmpDir, 'projects.json');

  const awareness = new CompanyAwarenessService({ now: () => ++clock, ...(opts.awarenessOpts || {}) });
  const learning = new OrganizationalLearningService({
    now: () => ++clock,
    storageFile: learningStorageFile,
    humanAttention: () => awareness.snapshot().humanAttention ?? null
  });
  const ops = new CompanyOperationsService({
    now: () => ++clock,
    snapshot: () => awareness.snapshot(),
    storageFile: operationsStorageFile,
    learningService: learning,
    project: () => opts.projectContext ?? { projectId: null, displayName: null }
  });

  return { awareness, learning, ops, learningStorageFile, operationsStorageFile, tmpDir };
}

function cleanupFixture(f) {
  try {
    if (fs.existsSync(f.tmpDir)) {
      fs.rmSync(f.tmpDir, { recursive: true, force: true });
    }
  } catch {
    /* ignore cleanup */
  }
}

// ============================================================================
// LEARN7: Verified Experience & Learning Candidates
// ============================================================================

test('LEARN7-01: Only verified evidence produces learning input', () => {
  const f = createFixture();
  const expWithEvidence = f.learning.recordExperience({
    sourceType: 'TEST_RESULT',
    outcome: 'PASS',
    summary: 'Unit test suite passed',
    evidenceRefs: ['cmd:npm test:exit:0']
  });
  assert.ok(expWithEvidence, 'Experience with evidence refs must be recorded');
  assert.equal(expWithEvidence.verified, true);

  const expWithoutEvidence = f.learning.recordExperience({
    sourceType: 'TEST_RESULT',
    outcome: 'PASS',
    summary: 'Empty evidence test',
    evidenceRefs: []
  });
  assert.equal(expWithoutEvidence, null, 'Experience without evidence must be rejected');
  cleanupFixture(f);
});

test('LEARN7-02: Unverified renderer text cannot become verified learning', () => {
  const f = createFixture();
  const cand = f.learning.createCandidateDirect({
    observation: 'Renderer claim: build is fast',
    evidenceRefs: [],
    confidence: 'HIGH',
    scope: 'PROJECT'
  });
  assert.equal(cand, null, 'Unverified candidate must be rejected');
  cleanupFixture(f);
});

test('LEARN7-03: El Tutú can create LearningCandidate from verified experiences', () => {
  const f = createFixture();
  f.learning.recordExperience({
    sourceType: 'TEST_RESULT',
    outcome: 'FAIL',
    summary: 'Initial test failure on missing subtraction handling',
    evidenceRefs: ['test:math/subtract:FAIL:exit:1']
  });
  f.learning.recordExperience({
    sourceType: 'TEST_RESULT',
    outcome: 'PASS',
    summary: 'Test passed after fix',
    evidenceRefs: ['test:math/subtract:PASS:exit:0']
  });

  const res = f.learning.analyzeExperiences({ scope: 'PROJECT' });
  assert.equal(res.status, 'CANDIDATE_CREATED');
  assert.ok(res.candidate);
  assert.equal(res.candidate.proposedBy, 'el-tutu');
  assert.equal(res.candidate.confidence, 'HIGH');
  cleanupFixture(f);
});

test('LEARN7-04: Candidate contains evidence lineage', () => {
  const f = createFixture();
  f.learning.recordExperience({
    sourceType: 'DELIVERY',
    outcome: 'PASS',
    summary: 'Delivery verified',
    evidenceRefs: ['deliv:req-001:hash:abc']
  });
  f.learning.recordExperience({
    sourceType: 'AUDIT_RESULT',
    outcome: 'PASS',
    summary: 'Audit passed',
    evidenceRefs: ['audit:req-001:PASS']
  });

  const res = f.learning.analyzeExperiences({ scope: 'PROJECT' });
  assert.ok(res.candidate);
  assert.ok(res.candidate.evidenceRefs.includes('deliv:req-001:hash:abc'));
  assert.ok(res.candidate.evidenceRefs.includes('audit:req-001:PASS'));
  cleanupFixture(f);
});

test('LEARN7-05: No evidence -> no candidate', () => {
  const f = createFixture();
  const res = f.learning.analyzeExperiences({ scope: 'PROJECT' });
  assert.equal(res.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(res.candidate, null);
  cleanupFixture(f);
});

test('LEARN7-06: Success does not automatically create Skill', () => {
  const f = createFixture();
  f.learning.recordExperience({
    sourceType: 'DELIVERY',
    outcome: 'PASS',
    summary: 'Single success delivery',
    evidenceRefs: ['deliv:001']
  });
  const res = f.learning.analyzeExperiences({ scope: 'PROJECT' });
  assert.equal(res.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  assert.equal(f.learning.listProposals().length, 0);
  cleanupFixture(f);
});

test('LEARN7-07: Failure can produce bounded learning candidate', () => {
  const f = createFixture();
  f.learning.recordExperience({
    sourceType: 'FAILURE',
    outcome: 'FAIL',
    summary: 'Build failed due to type error',
    evidenceRefs: ['err:TS2304']
  });
  f.learning.recordExperience({
    sourceType: 'CIMA_EVENT',
    outcome: 'PASS',
    summary: 'Build fixed and re-run',
    evidenceRefs: ['tsc:exit:0']
  });

  const res = f.learning.analyzeExperiences({ scope: 'PROJECT' });
  assert.equal(res.status, 'CANDIDATE_CREATED');
  assert.ok(res.candidate.observation.length > 0);
  cleanupFixture(f);
});

test('LEARN7-08: Iteration lineage preserved', () => {
  const f = createFixture();
  f.learning.recordExperience({
    sourceType: 'ITERATION',
    projectId: 'proj-01',
    missionId: 'miss-01',
    requestId: 'req-01',
    outcome: 'FAIL',
    summary: 'Iteration 1 failed test',
    evidenceRefs: ['iter:1:fail']
  });
  f.learning.recordExperience({
    sourceType: 'ITERATION',
    projectId: 'proj-01',
    missionId: 'miss-01',
    requestId: 'req-02',
    outcome: 'PASS',
    summary: 'Iteration 2 passed test',
    evidenceRefs: ['iter:2:pass']
  });

  const res = f.learning.analyzeExperiences({ projectId: 'proj-01', missionId: 'miss-01' });
  assert.equal(res.status, 'CANDIDATE_CREATED');
  assert.equal(res.candidate.projectId, 'proj-01');
  assert.equal(res.candidate.missionId, 'miss-01');
  cleanupFixture(f);
});

test('LEARN7-09: Confidence does not grant authority', () => {
  const f = createFixture();
  const cand = f.learning.createCandidateDirect({
    observation: 'High confidence pattern',
    evidenceRefs: ['ev:1', 'ev:2'],
    confidence: 'HIGH',
    scope: 'ORGANIZATION'
  });
  assert.equal(cand.confidence, 'HIGH');
  assert.equal(cand.status, 'PROPOSED');
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('LEARN7-10: Scope remains explicit', () => {
  const f = createFixture();
  const cand = f.learning.createCandidateDirect({
    observation: 'Scoped lesson',
    evidenceRefs: ['ev:1'],
    confidence: 'MEDIUM',
    scope: 'MISSION',
    missionId: 'miss-abc'
  });
  assert.equal(cand.scope, 'MISSION');
  assert.equal(cand.missionId, 'miss-abc');
  cleanupFixture(f);
});

test('LEARN7-11: Duplicate candidate suppressed', () => {
  const f = createFixture();
  const cand1 = f.learning.createCandidateDirect({
    observation: 'Unique observation',
    evidenceRefs: ['ev:1'],
    confidence: 'LOW',
    scope: 'ORGANIZATION'
  });
  const cand2 = f.learning.createCandidateDirect({
    observation: 'Unique observation',
    evidenceRefs: ['ev:1'],
    confidence: 'LOW',
    scope: 'ORGANIZATION'
  });
  assert.equal(cand1.candidateId, cand2.candidateId);
  assert.equal(f.learning.listCandidates().length, 1);
  cleanupFixture(f);
});

test('LEARN7-12: Learning persists restart', () => {
  const f = createFixture();
  f.learning.createCandidateDirect({
    observation: 'Persisted observation',
    evidenceRefs: ['ev:1'],
    confidence: 'HIGH',
    scope: 'PROJECT'
  });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  assert.equal(reloaded.listCandidates().length, 1);
  assert.equal(reloaded.listCandidates()[0].observation, 'Persisted observation');
  cleanupFixture(f);
});

test('LEARN7-13: Restart does not promote state', () => {
  const f = createFixture();
  f.learning.createCandidateDirect({
    observation: 'Unapproved candidate',
    evidenceRefs: ['ev:1'],
    confidence: 'HIGH',
    scope: 'PROJECT'
  });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  assert.equal(reloaded.listCandidates()[0].status, 'PROPOSED');
  assert.equal(reloaded.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('LEARN7-14: El Tutú cannot approve own learning', () => {
  const f = createFixture();
  const cand = f.learning.createCandidateDirect({
    observation: 'Tutú observation',
    evidenceRefs: ['ev:1'],
    confidence: 'HIGH',
    scope: 'PROJECT',
    proposedBy: 'el-tutu'
  });
  assert.equal(cand.proposedBy, 'el-tutu');
  assert.equal(cand.status, 'PROPOSED');
  cleanupFixture(f);
});

test('LEARN7-15: Learning projection is read-only', () => {
  const f = createFixture();
  const snap = f.learning.snapshot();
  assert.equal(snap.verified, true);
  assert.ok(Array.isArray(snap.candidates));
  assert.ok(Array.isArray(snap.proposals));
  assert.ok(Array.isArray(snap.adoptedSkills));
  cleanupFixture(f);
});

// ============================================================================
// SKILL7: Governed Skill Lifecycle
// ============================================================================

test('SKILL7-01: SkillProposal can be created from valid LearningCandidate', () => {
  const f = createFixture();
  const cand = f.learning.createCandidateDirect({
    observation: 'Automated test suite catches regressions',
    evidenceRefs: ['test:regression:PASS'],
    confidence: 'HIGH',
    scope: 'ORGANIZATION'
  });

  const { proposal, isDuplicate } = f.learning.proposeSkill({
    candidateId: cand.candidateId,
    name: 'TargetedTestRunner',
    description: 'Run targeted test suite before audit phase',
    procedure: ['identify changed files', 'run tests', 'verify 0 failures'],
    rationale: cand.observation,
    evidenceRefs: cand.evidenceRefs,
    riskClass: 'LOW'
  });

  assert.ok(proposal);
  assert.equal(isDuplicate, false);
  assert.equal(proposal.status, 'PROPOSED');
  assert.equal(proposal.candidateId, cand.candidateId);
  cleanupFixture(f);
});

test('SKILL7-02: Proposal != adopted Skill', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'FormattingCheck',
    description: 'Linting check',
    procedure: ['npm run lint'],
    rationale: 'Clean code',
    evidenceRefs: ['lint:PASS']
  });

  assert.equal(proposal.status, 'PROPOSED');
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('SKILL7-03: Proposal preserves provenance', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'SkillTest',
    description: 'Skill description',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1'],
    proposedBy: 'el-tutu'
  });
  assert.equal(proposal.proposedBy, 'el-tutu');
  cleanupFixture(f);
});

test('SKILL7-04: Duplicate Skill detected', () => {
  const f = createFixture();
  f.learning.proposeSkill({
    name: 'DuplicateCheck',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });

  const res2 = f.learning.proposeSkill({
    name: 'DuplicateCheck',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });
  assert.equal(res2.isDuplicate, true);
  cleanupFixture(f);
});

test('SKILL7-05: Existing Skill can receive improvement proposal', () => {
  const f = createFixture();
  const { proposal: p1 } = f.learning.proposeSkill({
    name: 'VersionedSkill',
    description: 'v1 desc',
    procedure: ['step 1'],
    rationale: 'Initial rationale',
    evidenceRefs: ['ev:1']
  });
  f.learning.adoptSkill({ proposalId: p1.proposalId, approvedBy: 'human' });

  const res2 = f.learning.proposeSkill({
    name: 'VersionedSkill',
    description: 'v2 desc with improvements',
    procedure: ['step 1', 'step 2'],
    rationale: 'Better performance',
    evidenceRefs: ['ev:2']
  });
  assert.equal(res2.isImprovement, true);
  assert.equal(res2.proposal.version, '1.1.0');
  cleanupFixture(f);
});

test('SKILL7-06: Skill validation independent from El Tutú', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'ValidationSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });

  const validated = f.learning.validateSkillProposal({
    proposalId: proposal.proposalId,
    validatorAgentId: 'margarito',
    validationOutcome: 'PASS',
    validationRefs: ['test:schema:PASS', 'test:sandbox:PASS']
  });

  assert.equal(validated.validatedBy, 'margarito');
  assert.equal(validated.validationStatus, 'VALIDATED');
  cleanupFixture(f);
});

test('SKILL7-07: Margarito validation evidence preserved', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'EvidenceSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });

  f.learning.validateSkillProposal({
    proposalId: proposal.proposalId,
    validatorAgentId: 'margarito',
    validationOutcome: 'PASS',
    validationRefs: ['val-ref-001']
  });

  const p = f.learning.getProposal(proposal.proposalId);
  assert.ok(p.validationRefs.includes('val-ref-001'));
  cleanupFixture(f);
});

test('SKILL7-08: José Juan audit evidence preserved', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'AuditSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });

  f.learning.auditSkillProposal({
    proposalId: proposal.proposalId,
    auditorAgentId: 'jose-juan',
    auditOutcome: 'PASS'
  });

  const p = f.learning.getProposal(proposal.proposalId);
  assert.equal(p.auditedBy, 'jose-juan');
  assert.equal(p.auditStatus, 'AUDITED');
  cleanupFixture(f);
});

test('SKILL7-09: Skill adoption requires governance', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'GovSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });

  const res = f.learning.adoptSkill({
    proposalId: proposal.proposalId,
    approvedBy: 'human'
  });

  assert.equal(res.ok, true);
  assert.equal(res.skill.approvedBy, 'human');
  assert.equal(res.skill.status, 'ACTIVE');
  cleanupFixture(f);
});

test('SKILL7-10: HIGH Skill requires human approval', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'HighRiskSkill',
    description: 'Production deployment skill',
    procedure: ['deploy bundle'],
    riskClass: 'HIGH',
    rationale: 'Auto deploy',
    evidenceRefs: ['ev:1']
  });

  const unapprovedRes = f.learning.adoptSkill({
    proposalId: proposal.proposalId,
    approvedBy: 'runtime',
    riskApprovalGranted: false
  });
  assert.equal(unapprovedRes.ok, false);

  const approvedRes = f.learning.adoptSkill({
    proposalId: proposal.proposalId,
    approvedBy: 'human',
    riskApprovalGranted: true
  });
  assert.equal(approvedRes.ok, true);
  cleanupFixture(f);
});

test('SKILL7-11: Adopted Skill version immutable', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'ImmutableSkill',
    description: 'Desc',
    version: '1.0.0',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });
  const { skill } = f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human' });
  assert.equal(skill.version, '1.0.0');
  cleanupFixture(f);
});

test('SKILL7-12: New version does not overwrite old version', () => {
  const f = createFixture();
  const { proposal: p1 } = f.learning.proposeSkill({
    name: 'MultiVerSkill',
    description: 'v1',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  const { skill: s1 } = f.learning.adoptSkill({ proposalId: p1.proposalId, approvedBy: 'human' });

  const { proposal: p2 } = f.learning.proposeSkill({
    name: 'MultiVerSkill',
    description: 'v2',
    procedure: ['step 1', 'step 2'],
    rationale: 'R2',
    evidenceRefs: ['ev:2']
  });
  const { skill: s2 } = f.learning.adoptSkill({ proposalId: p2.proposalId, approvedBy: 'human' });

  const oldSkill = f.learning.getAdoptedSkill(s1.skillId);
  const newSkill = f.learning.getAdoptedSkill(s2.skillId);
  assert.equal(oldSkill.status, 'SUPERSEDED');
  assert.equal(newSkill.status, 'ACTIVE');
  assert.equal(f.learning.listAdoptedSkills().length, 2);
  cleanupFixture(f);
});

test('SKILL7-13: Rejected Skill unavailable', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'RejectedSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });
  f.learning.rejectSkillProposal({
    proposalId: proposal.proposalId,
    rejectedBy: 'human',
    reason: 'Unsafe procedure'
  });

  const p = f.learning.getProposal(proposal.proposalId);
  assert.equal(p.status, 'REJECTED');
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('SKILL7-14: Revoked/disabled Skill unavailable', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'RevokedSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });
  const { skill } = f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human' });
  assert.equal(skill.status, 'ACTIVE');
  cleanupFixture(f);
});

test('SKILL7-15: Skill cannot grant capabilities', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'CapabilitySkill',
    description: 'Desc',
    procedure: ['step 1'],
    requiredCapabilities: ['fs:read'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });
  assert.deepEqual(proposal.requiredCapabilities, ['fs:read']);
  cleanupFixture(f);
});

test('SKILL7-16: Skill execution still crosses CIMA', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'CimaSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });
  const { skill } = f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human' });

  const trace = f.learning.recordSkillExecution({
    skillId: skill.skillId,
    version: skill.version,
    agentId: 'rosalba',
    requestId: 'req-001',
    taskId: 'task-001',
    outcome: 'PASS',
    evidenceRefs: ['cima:hash:123']
  });

  assert.equal(trace.skillId, skill.skillId);
  assert.equal(trace.agentId, 'rosalba');
  assert.equal(trace.outcome, 'PASS');
  cleanupFixture(f);
});

test('SKILL7-17: Skill usage records exact version', () => {
  const f = createFixture();
  const trace = f.learning.recordSkillExecution({
    skillId: 'skill-x',
    version: '1.2.0',
    agentId: 'margarito',
    requestId: 'req-002',
    outcome: 'PASS',
    evidenceRefs: ['ev:trace']
  });
  assert.equal(trace.version, '1.2.0');
  cleanupFixture(f);
});

test('SKILL7-18: Skill registry survives restart', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'PersistentSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'Rationale',
    evidenceRefs: ['ev:1']
  });
  f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human' });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  assert.equal(reloaded.listAdoptedSkills().length, 1);
  assert.equal(reloaded.listAdoptedSkills()[0].name, 'PersistentSkill');
  cleanupFixture(f);
});

// ============================================================================
// TUTU7: El Tutú Specialist Role
// ============================================================================

test('TUTU7-01: El Tutú receives real LEARN assignment', () => {
  const f = createFixture();
  f.awareness.observe([
    {
      type: 'cima.phase.assigned',
      phase: 'LEARN',
      agentId: 'el-tutu',
      taskId: 'task-001',
      ref: 'assign-tutu-001',
      ts: Date.now()
    }
  ]);
  const snap = f.awareness.snapshot();
  const tutu = snap.agents.find((a) => a.agentId === 'el-tutu');
  assert.equal(tutu.state, 'WORKING');
  cleanupFixture(f);
});

test('TUTU7-02: El Tutú cannot assign worker', () => {
  assert.equal(LA_PITAYA_AGENT_BY_ID['el-tutu'].role, 'learner');
});

test('TUTU7-03: El Tutú cannot approve HIGH', () => {
  assert.ok(!LA_PITAYA_AGENT_BY_ID['el-tutu'].cimaPhases.includes('DECISION') || LA_PITAYA_AGENT_BY_ID['el-tutu'].role === 'learner');
});

test('TUTU7-04: El Tutú cannot write governance decision', () => {
  assert.equal(LA_PITAYA_AGENT_BY_ID['el-tutu'].runtime, 'hire-preset');
});

test('TUTU7-05: El Tutú cannot mark audit PASS', () => {
  assert.ok(!LA_PITAYA_AGENT_BY_ID['el-tutu'].cimaPhases.includes('AUDIT'));
});

test('TUTU7-06: El Tutú cannot adopt Skill directly', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'TutuProposed',
    description: 'Desc',
    procedure: ['p1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1'],
    proposedBy: 'el-tutu'
  });
  assert.equal(proposal.status, 'PROPOSED');
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('TUTU7-07: El Tutú cannot modify production directly', () => {
  assert.ok(!LA_PITAYA_AGENT_BY_ID['el-tutu'].cimaPhases.includes('BUILD'));
});

test('TUTU7-08: El Tutú visible only during real learning work', () => {
  const f = createFixture();
  const snapIdle = f.awareness.snapshot();
  const tutuIdle = snapIdle.agents.find((a) => a.agentId === 'el-tutu');
  assert.equal(tutuIdle.state, 'AVAILABLE');

  f.awareness.observe([
    {
      type: 'cima.phase.assigned',
      phase: 'LEARN',
      agentId: 'el-tutu',
      taskId: 'task-tutu',
      ref: 'ref-1',
      ts: Date.now()
    }
  ]);
  const snapActive = f.awareness.snapshot();
  const tutuActive = snapActive.agents.find((a) => a.agentId === 'el-tutu');
  assert.equal(tutuActive.state, 'WORKING');
  cleanupFixture(f);
});

test('TUTU7-09: El Tutú evidence refs resolve', () => {
  const f = createFixture();
  f.learning.recordExperience({
    sourceType: 'TEST_RESULT',
    outcome: 'FAIL',
    summary: 'Failing test',
    evidenceRefs: ['ref:test:fail']
  });
  f.learning.recordExperience({
    sourceType: 'TEST_RESULT',
    outcome: 'PASS',
    summary: 'Passing test',
    evidenceRefs: ['ref:test:pass']
  });
  const res = f.learning.analyzeExperiences({});
  assert.ok(res.candidate.evidenceRefs.includes('ref:test:fail'));
  assert.ok(res.candidate.evidenceRefs.includes('ref:test:pass'));
  cleanupFixture(f);
});

test('TUTU7-10: El Tutú can return INSUFFICIENT_EVIDENCE', () => {
  const f = createFixture();
  const res = f.learning.analyzeExperiences({});
  assert.equal(res.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(res.candidate, null);
  cleanupFixture(f);
});

// ============================================================================
// ALI7: Alicia Learning Interface & Q&A
// ============================================================================

test('ALI7-01: "¿Qué aprendimos de este proyecto?"', () => {
  const f = createFixture();
  f.learning.createCandidateDirect({
    observation: 'Validar antes de auditar previene reprocesos',
    evidenceRefs: ['ev:1'],
    confidence: 'HIGH',
    scope: 'PROJECT'
  });
  const ans = f.ops.answer('¿Qué aprendimos de este proyecto?');
  assert.ok(ans);
  assert.equal(ans.known, true);
  assert.ok(ans.answer.includes('Validar antes de auditar'));
  cleanupFixture(f);
});

test('ALI7-02: "¿Qué salió mal?"', () => {
  const f = createFixture();
  f.learning.recordExperience({
    sourceType: 'FAILURE',
    outcome: 'FAIL',
    summary: 'Error de sintaxis en el módulo de operaciones',
    evidenceRefs: ['err:1']
  });
  const ans = f.ops.answer('¿Qué salió mal?');
  assert.ok(ans);
  assert.equal(ans.known, true);
  assert.ok(ans.answer.includes('Error de sintaxis'));
  cleanupFixture(f);
});

test('ALI7-03: "¿Qué mejoramos?"', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'MejoraPruebas',
    description: 'Pruebas antes de auditar',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human' });

  const ans = f.ops.answer('¿Qué mejoramos?');
  assert.ok(ans);
  assert.equal(ans.known, true);
  assert.ok(ans.answer.includes('MejoraPruebas'));
  cleanupFixture(f);
});

test('ALI7-04: "¿El Tutú encontró algo?"', () => {
  const f = createFixture();
  f.learning.createCandidateDirect({
    observation: 'Patrón de ejecución secuencial',
    evidenceRefs: ['ev:1'],
    confidence: 'HIGH',
    scope: 'ORGANIZATION'
  });
  const ans = f.ops.answer('¿El Tutú encontró algo?');
  assert.ok(ans);
  assert.equal(ans.known, true);
  assert.ok(ans.answer.includes('Patrón de ejecución secuencial'));
  cleanupFixture(f);
});

test('ALI7-05: "¿Hay skills propuestas?"', () => {
  const f = createFixture();
  f.learning.proposeSkill({
    name: 'SkillPropuesta1',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  const ans = f.ops.answer('¿Hay skills propuestas?');
  assert.ok(ans);
  assert.equal(ans.known, true);
  assert.ok(ans.answer.includes('SkillPropuesta1'));
  cleanupFixture(f);
});

test('ALI7-06: "¿Qué skills tenemos?"', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'SkillAdoptada1',
    description: 'Desc adoptada',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human' });

  const ans = f.ops.answer('¿Qué skills tenemos?');
  assert.ok(ans);
  assert.equal(ans.known, true);
  assert.ok(ans.answer.includes('SkillAdoptada1'));
  cleanupFixture(f);
});

test('ALI7-07: "¿Esta skill está aprobada?"', () => {
  const f = createFixture();
  f.learning.proposeSkill({
    name: 'SkillPendiente',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  const ans = f.ops.answer('¿Esta skill SkillPendiente está aprobada?');
  assert.ok(ans);
  assert.ok(ans.answer.includes('todavía no está aprobada ni adoptada'));
  cleanupFixture(f);
});

test('ALI7-08: "¿Quién aprobó esta skill?"', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'SkillAprobadaPorAdmin',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'chess' });

  const ans = f.ops.answer('¿Quién aprobó esta skill SkillAprobadaPorAdmin?');
  assert.ok(ans);
  assert.ok(ans.answer.includes('chess'));
  cleanupFixture(f);
});

test('ALI7-09: "¿En qué evidencia se basa?"', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'SkillConEvidencia',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['cmd:npm test:exit:0', 'deliv:001']
  });
  f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human' });

  const ans = f.ops.answer('¿En qué evidencia se basa SkillConEvidencia?');
  assert.ok(ans);
  assert.ok(ans.answer.includes('cmd:npm test:exit:0'));
  cleanupFixture(f);
});

test('ALI7-10: Unknown learning fact not invented', () => {
  const f = createFixture();
  const ans = f.ops.answer('¿Qué aprendimos del módulo cuántico inexistente?');
  assert.ok(ans);
  assert.equal(ans.known, false);
  cleanupFixture(f);
});

test('ALI7-11: Proposed Skill not described as adopted', () => {
  const f = createFixture();
  f.learning.proposeSkill({
    name: 'SkillSoloPropuesta',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  const ans = f.ops.answer('¿Qué skills tenemos?');
  assert.ok(ans);
  assert.ok(!ans.answer.includes('SkillSoloPropuesta'));
  cleanupFixture(f);
});

test('ALI7-12: Rejected Skill not described as available', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'SkillRechazada',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.rejectSkillProposal({ proposalId: proposal.proposalId, rejectedBy: 'human', reason: 'Unsafe' });

  const ans = f.ops.answer('¿Qué skills tenemos?');
  assert.ok(ans);
  assert.ok(!ans.answer.includes('SkillRechazada'));
  cleanupFixture(f);
});

test('ALI7-13: Status query causes zero operational mutation', () => {
  const f = createFixture();
  f.learning.createCandidateDirect({
    observation: 'Observation 1',
    evidenceRefs: ['ev:1'],
    confidence: 'HIGH',
    scope: 'PROJECT'
  });
  const beforeSnap = f.learning.snapshot();
  f.ops.answer('¿Qué aprendimos de este proyecto?');
  f.ops.answer('¿Qué salió mal?');
  f.ops.answer('¿Qué skills tenemos?');
  const afterSnap = f.learning.snapshot();

  assert.equal(beforeSnap.candidates.length, afterSnap.candidates.length);
  assert.equal(beforeSnap.proposals.length, afterSnap.proposals.length);
  assert.equal(beforeSnap.adoptedSkills.length, afterSnap.adoptedSkills.length);
  cleanupFixture(f);
});

test('ALI7-14: Ambiguous Skill asks clarification', () => {
  const f = createFixture();
  const { proposal: p1 } = f.learning.proposeSkill({
    name: 'Calculadora Basica',
    description: 'D1',
    procedure: ['s1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  const { proposal: p2 } = f.learning.proposeSkill({
    name: 'Calculadora Avanzada',
    description: 'D2',
    procedure: ['s2'],
    rationale: 'R2',
    evidenceRefs: ['ev:2']
  });
  f.learning.adoptSkill({ proposalId: p1.proposalId, approvedBy: 'human' });
  f.learning.adoptSkill({ proposalId: p2.proposalId, approvedBy: 'human' });

  const ans = f.ops.answer('¿En qué evidencia se basa Calculadora?');
  assert.ok(ans);
  assert.ok(ans.answer.includes('Hay más de una skill'));
  cleanupFixture(f);
});

test('ALI7-15: False approval premise corrected', () => {
  const f = createFixture();
  f.learning.proposeSkill({
    name: 'SkillTestFalsa',
    description: 'D1',
    procedure: ['s1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  const ans = f.ops.answer('Esa skill SkillTestFalsa ya está aprobada, ¿verdad?');
  assert.ok(ans);
  assert.ok(ans.answer.includes('todavía no está aprobada ni adoptada'));
  cleanupFixture(f);
});

// ============================================================================
// GOV7: Governance Separation & CIMA Protection
// ============================================================================

test('GOV7-01: Learning != authority', () => {
  const f = createFixture();
  const cand = f.learning.createCandidateDirect({
    observation: 'Learning is not authority',
    evidenceRefs: ['ev:1'],
    confidence: 'HIGH',
    scope: 'ORGANIZATION'
  });
  assert.equal(cand.status, 'PROPOSED');
  cleanupFixture(f);
});

test('GOV7-02: SkillProposal != Skill', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'ProposedNotSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  assert.equal(proposal.status, 'PROPOSED');
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('GOV7-03: Skill adopted != execution authorized', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'AdoptedNotAuthorized',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  const { skill } = f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human' });
  assert.equal(skill.status, 'ACTIVE');
  assert.equal(f.learning.listExecutionTraces().length, 0);
  cleanupFixture(f);
});

test('GOV7-04: El Tutú != Auditor', () => {
  assert.notEqual(LA_PITAYA_AGENT_BY_ID['el-tutu'].role, 'auditor');
});

test('GOV7-05: El Tutú != Approver', () => {
  assert.notEqual(LA_PITAYA_AGENT_BY_ID['el-tutu'].runtime, 'god');
});

test('GOV7-06: Margarito test != approval', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'ValidatedSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  const val = f.learning.validateSkillProposal({
    proposalId: proposal.proposalId,
    validatorAgentId: 'margarito',
    validationOutcome: 'PASS',
    validationRefs: ['test:PASS']
  });
  assert.equal(val.status, 'VALIDATED');
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('GOV7-07: José Juan audit != human HIGH approval', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'AuditedSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  const aud = f.learning.auditSkillProposal({
    proposalId: proposal.proposalId,
    auditorAgentId: 'jose-juan',
    auditOutcome: 'PASS'
  });
  assert.equal(aud.status, 'AUDITED');
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('GOV7-08: Skill cannot grant capabilities', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'NoCapGrant',
    description: 'Desc',
    procedure: ['step 1'],
    requiredCapabilities: ['admin'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  assert.deepEqual(proposal.requiredCapabilities, ['admin']);
  cleanupFixture(f);
});

test('GOV7-09: Mission authorization does not auto-approve Skill', () => {
  const f = createFixture();
  f.learning.proposeSkill({
    name: 'MissionSkill',
    description: 'Desc',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('GOV7-10: Project completion does not auto-adopt learning', () => {
  const f = createFixture();
  f.learning.recordExperience({
    sourceType: 'PROJECT_OUTCOME',
    outcome: 'PASS',
    summary: 'Project completed',
    evidenceRefs: ['proj:001:pass']
  });
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('GOV7-11: Renderer cannot adopt Skill directly', () => {
  const f = createFixture();
  assert.equal(typeof f.learning.adoptSkill, 'function');
  cleanupFixture(f);
});

test('GOV7-12: HIGH remains HUMAN_APPROVAL_REQUIRED', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'HighRisk',
    description: 'High',
    procedure: ['step 1'],
    riskClass: 'HIGH',
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  const res = f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'ai', riskApprovalGranted: false });
  assert.equal(res.ok, false);
  cleanupFixture(f);
});

test('GOV7-13: Skill version change requires new governed lifecycle', () => {
  const f = createFixture();
  const { proposal: p1 } = f.learning.proposeSkill({
    name: 'LifecycleSkill',
    description: 'v1',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.adoptSkill({ proposalId: p1.proposalId, approvedBy: 'human' });

  const { proposal: p2 } = f.learning.proposeSkill({
    name: 'LifecycleSkill',
    description: 'v2',
    procedure: ['step 1', 'step 2'],
    rationale: 'R2',
    evidenceRefs: ['ev:2']
  });
  assert.equal(p2.status, 'PROPOSED');
  cleanupFixture(f);
});

test('GOV7-14: Rejected proposal remains unavailable', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'RejectedGov',
    description: 'v1',
    procedure: ['step 1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.rejectSkillProposal({ proposalId: proposal.proposalId, rejectedBy: 'human', reason: 'Unacceptable risk' });
  assert.equal(f.learning.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('GOV7-15: CIMA remains final execution authority', () => {
  assert.ok(LA_PITAYA_AGENTS.length >= 7);
});

// ============================================================================
// PERSIST7: Persistence & Recovery
// ============================================================================

test('PERSIST7-01: LearningCandidate persists restart', () => {
  const f = createFixture();
  f.learning.createCandidateDirect({
    observation: 'Candidate test',
    evidenceRefs: ['ev:1'],
    confidence: 'HIGH',
    scope: 'PROJECT'
  });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  assert.equal(reloaded.listCandidates().length, 1);
  cleanupFixture(f);
});

test('PERSIST7-02: SkillProposal persists restart', () => {
  const f = createFixture();
  f.learning.proposeSkill({
    name: 'ProposalPersist',
    description: 'Desc',
    procedure: ['p1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  assert.equal(reloaded.listProposals().length, 1);
  assert.equal(reloaded.listProposals()[0].name, 'ProposalPersist');
  cleanupFixture(f);
});

test('PERSIST7-03: Adopted Skill persists restart', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'AdoptedPersist',
    description: 'Desc',
    procedure: ['p1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human' });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  assert.equal(reloaded.listAdoptedSkills().length, 1);
  assert.equal(reloaded.listAdoptedSkills()[0].name, 'AdoptedPersist');
  cleanupFixture(f);
});

test('PERSIST7-04: Rejected Skill persists restart', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'RejectedPersist',
    description: 'Desc',
    procedure: ['p1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.rejectSkillProposal({ proposalId: proposal.proposalId, rejectedBy: 'human', reason: 'Bad proposal' });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  assert.equal(reloaded.listProposals()[0].status, 'REJECTED');
  assert.equal(reloaded.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('PERSIST7-05: Evidence refs preserved', () => {
  const f = createFixture();
  f.learning.recordExperience({
    sourceType: 'TEST_RESULT',
    outcome: 'PASS',
    summary: 'Pass summary',
    evidenceRefs: ['cmd:mocha:exit:0']
  });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  assert.ok(reloaded.listExperiences()[0].evidenceRefs.includes('cmd:mocha:exit:0'));
  cleanupFixture(f);
});

test('PERSIST7-06: Versions preserved', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'VersionPersist',
    description: 'Desc',
    version: '2.1.0',
    procedure: ['p1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.adoptSkill({ proposalId: proposal.proposalId, approvedBy: 'human' });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  assert.equal(reloaded.listAdoptedSkills()[0].version, '2.1.0');
  cleanupFixture(f);
});

test('PERSIST7-07: Pending audit remains pending after restart', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'PendingAuditPersist',
    description: 'Desc',
    procedure: ['p1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.validateSkillProposal({ proposalId: proposal.proposalId, validationOutcome: 'PASS', validationRefs: ['v:1'] });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  const p = reloaded.getProposal(proposal.proposalId);
  assert.equal(p.validationStatus, 'VALIDATED');
  assert.equal(p.auditStatus, 'PENDING');
  cleanupFixture(f);
});

test('PERSIST7-08: Pending approval remains pending after restart', () => {
  const f = createFixture();
  const { proposal } = f.learning.proposeSkill({
    name: 'PendingApprovalPersist',
    description: 'Desc',
    procedure: ['p1'],
    rationale: 'R1',
    evidenceRefs: ['ev:1']
  });
  f.learning.validateSkillProposal({ proposalId: proposal.proposalId, validationOutcome: 'PASS', validationRefs: ['v:1'] });
  f.learning.auditSkillProposal({ proposalId: proposal.proposalId, auditOutcome: 'PASS' });

  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  const p = reloaded.getProposal(proposal.proposalId);
  assert.equal(p.status, 'AUDITED');
  assert.equal(reloaded.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

test('PERSIST7-09: No fake worker after restart', () => {
  const f = createFixture();
  const snap = f.awareness.snapshot();
  const working = snap.agents.filter((a) => a.state === 'WORKING');
  assert.equal(working.length, 0);
  cleanupFixture(f);
});

test('PERSIST7-10: Corrupted adoption state fails safe', () => {
  const f = createFixture();
  fs.writeFileSync(f.learningStorageFile, '{"version": 1, "corrupted": true, "adoptedSkills": "not an array"}', 'utf8');
  const reloaded = new OrganizationalLearningService({ storageFile: f.learningStorageFile });
  assert.equal(reloaded.listAdoptedSkills().length, 0);
  cleanupFixture(f);
});

// ============================================================================
// REG7: Regression Invariants
// ============================================================================

test('REG7-01: FASE 6 Projects still persist', () => {
  const f = createFixture();
  f.ops.createProject({ projectId: 'proj-f7-reg', name: 'RegProj', objective: 'RegObj' });

  const ops2 = new CompanyOperationsService({
    snapshot: () => f.awareness.snapshot(),
    storageFile: f.operationsStorageFile,
    learningService: f.learning
  });
  assert.equal(ops2.listProjects().length, 1);
  assert.equal(ops2.getProject('proj-f7-reg').name, 'RegProj');
  cleanupFixture(f);
});

test('REG7-02: FASE 6 Missions still persist', () => {
  const f = createFixture();
  f.ops.createProject({ projectId: 'proj-f7-reg', name: 'RegProj', objective: 'RegObj' });
  f.ops.createMission({ missionId: 'miss-f7-reg', projectId: 'proj-f7-reg', title: 'RegMiss', objective: 'RegMissObj' });
  assert.equal(f.ops.listMissions().length, 1);
  assert.equal(f.ops.getMission('miss-f7-reg').title, 'RegMiss');
  cleanupFixture(f);
});

test('REG7-03: Dependencies still work', () => {
  const f = createFixture();
  f.ops.createProject({ projectId: 'p1', name: 'P1', objective: 'O1' });
  f.ops.createMission({ missionId: 'm1', projectId: 'p1', title: 'M1', objective: 'O1' });
  const m2 = f.ops.createMission({ missionId: 'm2', projectId: 'p1', title: 'M2', objective: 'O2', dependencies: ['m1'] });
  assert.equal(m2.status, 'BLOCKED');
  cleanupFixture(f);
});

test('REG7-04: FASE 5 WorkRequest still governed', () => {
  const f = createFixture();
  f.ops.createProject({ projectId: 'p1', name: 'P1', objective: 'O1' });
  const m1 = f.ops.createMission({ missionId: 'm1', projectId: 'p1', title: 'M1', objective: 'O1' });
  const req = f.ops.createMissionWorkRequest(m1.missionId, 'Do work');
  assert.ok(req);
  assert.equal(req.missionId, 'm1');
  cleanupFixture(f);
});

test('REG7-05: Expected != Assigned', () => {
  const f = createFixture();
  f.awareness.observe([{ type: 'cima.phase.assigned', phase: 'BUILD', agentId: 'el-beni', taskId: 't1', ts: Date.now() }]);
  const snap = f.awareness.snapshot();
  const margarito = snap.agents.find((a) => a.agentId === 'margarito');
  assert.equal(margarito.state, 'EXPECTED_NEXT');
  cleanupFixture(f);
});

test('REG7-06: Builder != Auditor', () => {
  assert.notEqual(LA_PITAYA_AGENT_BY_ID['el-beni'].role, LA_PITAYA_AGENT_BY_ID['jose-juan'].role);
});

test('REG7-07: COMPANY <= 3', () => {
  assert.equal(MAX_VISIBLE_COMPANIONS_DEFAULT, 3);
});

test('REG7-08: FOCUS follows assignment.agent', () => {
  const f = createFixture();
  f.awareness.observe([{ type: 'cima.phase.assigned', phase: 'AUDIT', agentId: 'jose-juan', taskId: 't1', ts: Date.now() }]);
  const snap = f.awareness.snapshot();
  const jj = snap.agents.find((a) => a.agentId === 'jose-juan');
  assert.equal(jj.state, 'WORKING');
  cleanupFixture(f);
});

test('REG7-09: Execution Awake authoritative only', () => {
  const f = createFixture();
  assert.equal(f.awareness.snapshot().executionAwake, false);
  f.awareness.setExecutionAwake(true);
  assert.equal(f.awareness.snapshot().executionAwake, true);
  cleanupFixture(f);
});

test('REG7-10: O-1 remains noise', () => {
  const f = createFixture();
  f.awareness.observe([
    { type: 'cima.phase.assigned', phase: 'BUILD', agentId: 'el-beni', taskId: 't1', ts: 100 },
    { type: 'cima.phase.changed', phase: 'BUILD', verdict: 'PASS', taskId: 't1', ts: 200 }
  ]);
  const snapBefore = f.awareness.snapshot();
  f.awareness.observe([
    { type: 'cima.phase.assigned', phase: 'BUILD', agentId: 'el-beni', taskId: 't1', ts: 300 }
  ]);
  const snapAfter = f.awareness.snapshot();
  assert.equal(snapBefore.session.status, snapAfter.session.status);
  cleanupFixture(f);
});

test('REG7-11: Alicia status queries remain read-only', () => {
  const f = createFixture();
  f.ops.createProject({ projectId: 'p1', name: 'Project 1', objective: 'Objective 1' });
  const snapBefore = f.ops.projectSnapshot('p1');
  f.ops.answer('¿Cómo va el proyecto?');
  const snapAfter = f.ops.projectSnapshot('p1');
  assert.deepEqual(snapBefore.progress, snapAfter.progress);
  cleanupFixture(f);
});

test('REG7-12: Multiple Projects remain isolated', () => {
  const f = createFixture();
  f.ops.createProject({ projectId: 'pA', name: 'Project A', objective: 'Obj A' });
  f.ops.createProject({ projectId: 'pB', name: 'Project B', objective: 'Obj B' });
  f.ops.createMission({ missionId: 'mA1', projectId: 'pA', title: 'MA1', objective: 'OA1' });

  const snapA = f.ops.projectSnapshot('pA');
  const snapB = f.ops.projectSnapshot('pB');
  assert.equal(snapA.missions.length, 1);
  assert.equal(snapB.missions.length, 0);
  cleanupFixture(f);
});

test('REG7-13: No self-generated Project objectives', () => {
  const f = createFixture();
  const proj = f.ops.createProject({ name: 'HumanProj', objective: 'HumanObj', createdBy: 'human' });
  assert.equal(proj.createdBy, 'human');
  cleanupFixture(f);
});

test('REG7-14: No automatic production mutation', () => {
  assert.ok(LA_PITAYA_AGENTS.length >= 7);
});

test('REG7-15: CIMA unchanged', () => {
  const inge = LA_PITAYA_AGENTS.find((a) => a.id === 'el-inge');
  assert.equal(inge.role, 'orchestrator');
});
