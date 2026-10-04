import type { LaPitayaAgentId } from '../agents';
import type { CompanyFactProvenance, CompanyHumanAttention, CompanyPhase } from '../company/types';
import type { RiskLevel } from '../autonomy';

export type AutonomyEnvelopeStatus =
  | 'DRAFT'
  | 'PENDING_AUTHORIZATION'
  | 'ACTIVE'
  | 'PAUSED'
  | 'WAITING_HUMAN'
  | 'EXHAUSTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED';

export type EnvelopeProvenance = 'HUMAN' | 'CIMA_POLICY_DERIVED' | 'RUNTIME_DERIVED_FROM_HUMAN_SCOPE';

export interface AutonomyBudget {
  maxIterations: number;
  maxRetries: number;
  maxDurationMs?: number | null;
  maxTokens?: number | null;
  maxCostUsd?: number | null;
}

export interface AutonomyBudgetConsumption {
  iterationsUsed: number;
  retriesUsed: number;
  elapsedMs: number;
  tokensUsed: number;
  costUsd: number;
}

export interface AutonomyEnvelope {
  envelopeId: string;
  projectId: string;
  missionId: string;
  objective: string;
  allowedActions: readonly string[];
  allowedCapabilities: readonly string[];
  allowedSkills: readonly string[];
  allowedResources: readonly string[];
  allowedPaths: readonly string[];
  allowedProviders: readonly string[];
  riskCeiling: RiskLevel;
  budget: AutonomyBudget;
  stopConditions: readonly string[];
  escalationConditions: readonly string[];
  createdBy: EnvelopeProvenance;
  authorizedBy: string | null;
  createdAt: number;
  authorizedAt: number | null;
  expiresAt: number | null;
  status: AutonomyEnvelopeStatus;
  skillsConstrained?: boolean;
  evidenceRefs: readonly string[];
  integrityHash: string;
  verified: true;
}

export type AutonomousOperationStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'WAITING_HUMAN'
  | 'EXHAUSTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export type ContinuationDecisionType =
  | 'CONTINUE'
  | 'RETRY'
  | 'ESCALATE'
  | 'PAUSE'
  | 'STOP_SUCCESS'
  | 'STOP_FAILURE';

export type ContinuationReasonCode =
  | 'WITHIN_SCOPE'
  | 'RETRYABLE_FAILURE'
  | 'NON_RETRYABLE_FAILURE'
  | 'BUDGET_AVAILABLE'
  | 'DEPENDENCY_BLOCKED'
  | 'HUMAN_REQUIRED'
  | 'RISK_EXCEEDED'
  | 'BUDGET_EXHAUSTED'
  | 'RETRY_EXHAUSTED'
  | 'ITERATION_EXHAUSTED'
  | 'TIME_EXHAUSTED'
  | 'MISSION_COMPLETE'
  | 'STOP_CONDITION_MET'
  | 'ENVELOPE_EXPIRED'
  | 'ENVELOPE_CANCELLED'
  | 'ENVELOPE_PAUSED'
  | 'SCOPE_EXPANSION_REQUIRED'
  | 'GOVERNANCE_UNCERTAIN'
  | 'CIMA_DENIED'
  | 'NO_PROGRESS_TIMEOUT';

export interface ContinuationDecision {
  decision: ContinuationDecisionType;
  reasonCode: ContinuationReasonCode;
  explanation: string;
  nextPhase?: CompanyPhase | null;
  nextAgentId?: LaPitayaAgentId | null;
  nextSkillId?: string | null;
  nextSkillVersion?: string | null;
  suggestedWorkObjective?: string | null;
  evidenceRefs: readonly string[];
  timestamp: number;
  verified: true;
}

export interface ScopeExpansionRequest {
  requestId: string;
  envelopeId: string;
  operationId: string;
  requestedBy: 'el-inge';
  reason: string;
  requiredPaths?: readonly string[];
  requiredSkills?: readonly string[];
  requiredCapabilities?: readonly string[];
  requiredRiskCeiling?: RiskLevel;
  additionalIterations?: number;
  additionalRetries?: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: number;
  decidedAt?: number | null;
  decidedBy?: string | null;
  evidenceRefs: readonly string[];
  verified: true;
}

export interface AutonomousOperation {
  operationId: string;
  envelopeId: string;
  projectId: string;
  missionId: string;
  currentIteration: number;
  currentStep: number;
  status: AutonomousOperationStatus;
  startedAt: number;
  lastProgressAt: number;
  consumption: AutonomyBudgetConsumption;
  pinnedSkills: Readonly<Record<string, string>>; // skillId -> version
  activeWorkRequestId: string | null;
  activeTaskId: string | null;
  activeAssignmentAgentId: LaPitayaAgentId | null;
  pendingDecision: ScopeExpansionRequest | null;
  humanAttention: CompanyHumanAttention | null;
  lastContinuationDecision: ContinuationDecision | null;
  stopReason: string | null;
  evidenceRefs: readonly string[];
  history: readonly ContinuationDecision[];
  verified: true;
}

export interface AutonomySnapshot {
  envelopes: readonly AutonomyEnvelope[];
  operations: readonly AutonomousOperation[];
  activeOperations: readonly AutonomousOperation[];
  activeOperationsCount: number;
  activeOperation: AutonomousOperation | null;
  activeEnvelope: AutonomyEnvelope | null;
  pendingScopeExpansions: readonly ScopeExpansionRequest[];
  humanAttention: CompanyHumanAttention | null;
  executionAwake: boolean;
  verified: true;
}

export interface AutonomyAnswer {
  known: boolean;
  answer: string;
  facts: readonly string[];
  snapshotVersion: 1;
}
