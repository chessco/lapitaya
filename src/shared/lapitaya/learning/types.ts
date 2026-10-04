import type { CompanyPhase, CompanyFactProvenance, CompanyHumanAttention } from '../company/types';
import type { LaPitayaAgentId } from '../agents';
import type { RiskLevel } from '../autonomy';

export type ExperienceSourceType =
  | 'CIMA_EVENT'
  | 'DELIVERY'
  | 'MISSION_OUTCOME'
  | 'PROJECT_OUTCOME'
  | 'TEST_RESULT'
  | 'AUDIT_RESULT'
  | 'DECISION_OUTCOME'
  | 'ITERATION'
  | 'FAILURE'
  | 'HUMAN_DECISION';

export type ExperienceOutcome = 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED' | 'APPROVED' | 'DENIED' | 'OBSERVED';

export interface VerifiedExperience {
  experienceId: string;
  sourceType: ExperienceSourceType;
  projectId?: string | null;
  missionId?: string | null;
  requestId?: string | null;
  taskId?: string | null;
  sessionId?: string | null;
  phase?: CompanyPhase | null;
  agentId?: LaPitayaAgentId | null;
  outcome: ExperienceOutcome;
  summary: string;
  evidenceRefs: readonly string[];
  occurredAt: number;
  verified: true;
}

export type LearningConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type LearningScope = 'WORK_REQUEST' | 'MISSION' | 'PROJECT' | 'ORGANIZATION';
export type LearningStatus = 'OBSERVED' | 'CANDIDATE' | 'VALIDATED' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

export interface LearningCandidate {
  candidateId: string;
  observation: string;
  rationale?: string;
  evidenceRefs: readonly string[];
  confidence: LearningConfidence;
  scope: LearningScope;
  projectId?: string | null;
  missionId?: string | null;
  proposedBy: 'el-tutu' | 'el-inge' | 'human' | 'runtime';
  createdAt: number;
  status: LearningStatus;
  fingerprint: string;
  verified: true;
}

export type SkillRiskClass = 'LOW' | 'MEDIUM' | 'HIGH';
export type SkillProposalStatus = 'PROPOSED' | 'VALIDATED' | 'AUDITED' | 'ADOPTED' | 'REJECTED' | 'SUPERSEDED';
export type AdoptedSkillStatus = 'ACTIVE' | 'SUPERSEDED' | 'DISABLED' | 'REVOKED';

export interface SkillProcedureStep {
  stepIndex: number;
  title: string;
  description: string;
  expectedRole?: string;
}

export interface SkillProposal {
  proposalId: string;
  candidateId?: string | null;
  name: string;
  description: string;
  version: string;
  scope: LearningScope;
  procedure: readonly string[];
  inputs: readonly string[];
  outputs: readonly string[];
  constraints: readonly string[];
  requiredCapabilities: readonly string[];
  riskClass: SkillRiskClass;
  rationale: string;
  evidenceRefs: readonly string[];
  validationRefs: readonly string[];
  validationStatus: 'PENDING' | 'VALIDATED' | 'FAILED';
  validatedBy: string | null;
  auditStatus: 'PENDING' | 'AUDITED' | 'REJECTED';
  auditedBy: string | null;
  status: SkillProposalStatus;
  proposedBy: 'el-tutu' | 'el-inge' | 'human';
  createdAt: number;
  updatedAt: number;
  rejectionReason?: string | null;
  verified: true;
}

export interface AdoptedSkill {
  skillId: string;
  proposalId: string;
  name: string;
  description: string;
  version: string;
  scope: LearningScope;
  procedure: readonly string[];
  inputs: readonly string[];
  outputs: readonly string[];
  constraints: readonly string[];
  requiredCapabilities: readonly string[];
  riskClass: SkillRiskClass;
  evidenceRefs: readonly string[];
  validationRefs: readonly string[];
  status: AdoptedSkillStatus;
  approvedBy: string;
  adoptedAt: number;
  updatedAt: number;
  verified: true;
}

export interface OrganizationalKnowledge {
  learnings: readonly LearningCandidate[];
  skillProposals: readonly SkillProposal[];
  adoptedSkills: readonly AdoptedSkill[];
  rejectedProposals: readonly SkillProposal[];
  evidenceRefs: readonly string[];
  verified: true;
}

export interface LearningSnapshot {
  recentExperiences: readonly VerifiedExperience[];
  candidates: readonly LearningCandidate[];
  proposals: readonly SkillProposal[];
  adoptedSkills: readonly AdoptedSkill[];
  rejectedProposals: readonly SkillProposal[];
  pendingValidation: readonly SkillProposal[];
  pendingAudit: readonly SkillProposal[];
  humanAttention: CompanyHumanAttention | null;
  lastAnalysisAt: number | null;
  verified: true;
}

export interface SkillExecutionTrace {
  traceId: string;
  skillId: string;
  version: string;
  agentId: LaPitayaAgentId;
  requestId: string;
  taskId: string | null;
  sessionId: string | null;
  outcome: 'PASS' | 'FAIL' | 'BLOCKED';
  evidenceRefs: readonly string[];
  executedAt: number;
  verified: true;
}
