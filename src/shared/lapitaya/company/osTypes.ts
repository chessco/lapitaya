import type { LaPitayaAgentId } from '../agents';
import type { CompanyPhase, CompanyProjectStatus, CompanyMissionStatus, CompanySnapshot } from './types';

export const COMPANY_OPERATING_MODES = [
  'MANUAL',
  'ASSISTED',
  'SUPERVISED',
  'AUTONOMOUS_WITHIN_ENVELOPES'
] as const;
export type CompanyOperatingMode = (typeof COMPANY_OPERATING_MODES)[number];

export const PRIORITY_LEVELS = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export interface PriorityDefinition {
  level: PriorityLevel;
  rank: number; // 1 (CRITICAL) to 4 (LOW)
  provenance: 'HUMAN' | 'EL_INGE_PROPOSED' | 'RUNTIME_DERIVED';
  reason: string;
  updatedAt: number;
  updatedBy: string;
}

export const CAPACITY_STATES = [
  'IDLE',
  'AVAILABLE',
  'ASSIGNED',
  'EXECUTING',
  'WAITING_FOR_DEPENDENCY',
  'WAITING_FOR_HUMAN',
  'BLOCKED',
  'OFFLINE'
] as const;
export type CapacityState = (typeof CAPACITY_STATES)[number];

export interface AgentAssignmentRef {
  projectId: string;
  missionId: string;
  phase: CompanyPhase;
  startedAt: number;
}

export interface AgentCapacity {
  agentId: LaPitayaAgentId;
  state: CapacityState;
  currentAssignment: AgentAssignmentRef | null;
  concurrencyLimit: number;
  utilizationRate: number; // 0.0 to 1.0
}

export interface CompanyTeam {
  teamId: string;
  name: string;
  description: string;
  leadAgentId: LaPitayaAgentId;
  members: readonly LaPitayaAgentId[];
  capabilities: readonly string[];
}

export interface AgentOrganizationalProfile {
  agentId: LaPitayaAgentId;
  name: string;
  organizationalRole: string;
  cimaRole: 'Admin' | 'Builder' | 'Auditor' | 'Learner' | 'Companion';
  capabilities: readonly string[];
  teamId: string;
}

export const RESOURCE_TYPES = [
  'LLM_PROVIDER',
  'TOKEN_BUDGET',
  'TIME_BUDGET',
  'WORKSPACE',
  'EXTERNAL_API'
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface CompanyResource {
  resourceId: string;
  name: string;
  type: ResourceType;
  totalCapacity: number;
  allocatedAmount: number;
  availableAmount: number;
  unit: string;
  contendingProjects: readonly string[];
}

export const HUMAN_ATTENTION_REASONS = [
  'REQUEST_CONFIRMATION',
  'HIGH_RISK_APPROVAL',
  'ENVELOPE_PROPOSAL',
  'SCOPE_EXPANSION',
  'BLOCKED_MISSION',
  'AUDIT_FAILURE',
  'BUDGET_EXHAUSTED',
  'GOVERNANCE_VIOLATION',
  'RESOURCE_CONTENTION'
] as const;
export type HumanAttentionReason = (typeof HUMAN_ATTENTION_REASONS)[number];

export interface HumanAttentionItem {
  id: string;
  reason: HumanAttentionReason;
  severity: 'CRITICAL' | 'HIGH' | 'NORMAL';
  projectId: string | null;
  missionId: string | null;
  operationId: string | null;
  summary: string;
  context: Record<string, unknown>;
  createdAt: number;
  verified: true;
}

export interface HumanAttentionCenterState {
  items: readonly HumanAttentionItem[];
  criticalCount: number;
  highCount: number;
  normalCount: number;
  hasBlockingIssues: boolean;
}

export const HEALTH_STATUSES = ['HEALTHY', 'ATTENTION', 'DEGRADED', 'BLOCKED', 'CRITICAL'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface CompanyHealth {
  status: HealthStatus;
  score: number; // 0 to 100
  reasonCodes: readonly string[];
  evidenceRefs: readonly string[];
  lastCalculatedAt: number;
}

export interface CompanyMetrics {
  activeProjects: number;
  activeMissions: number;
  runningOperations: number;
  completedDeliveries: number;
  overallPassRate: number;
  auditFailureRate: number;
  retryRate: number;
  humanInterventionRate: number;
  autonomyUtilization: number;
  averageCycleTimeMs: number;
  adoptedSkillsInUse: number;
  agentUtilization: Record<LaPitayaAgentId, number>;
}

export interface CrossProjectDependency {
  id: string;
  dependentProjectId: string;
  prerequisiteProjectId: string;
  reason: string;
  satisfied: boolean;
}

export interface MissionPortfolioView {
  missionId: string;
  projectId: string;
  title: string;
  status: CompanyMissionStatus;
  priority: PriorityLevel;
  leadAgentId: LaPitayaAgentId | null;
  hasActiveEnvelope: boolean;
  isBlocked: boolean;
}

export interface ProjectPortfolioView {
  projectId: string;
  name: string;
  objective: string;
  status: CompanyProjectStatus;
  priority: PriorityLevel;
  health: HealthStatus;
  progress: {
    completedMissions: number;
    totalMissions: number;
    percentComplete: number;
  };
  missions: readonly MissionPortfolioView[];
  activeOperationCount: number;
  humanBlockerCount: number;
  budgetUtilization: {
    tokensUsed: number;
    tokenBudget: number | null;
    timeSpentMs: number;
  };
}

export interface CompanyPortfolio {
  projects: readonly ProjectPortfolioView[];
  activeProjectId: string | null;
  summary: {
    totalProjects: number;
    activeCount: number;
    pausedCount: number;
    completedCount: number;
    blockedCount: number;
  };
  dependencies: readonly CrossProjectDependency[];
  updatedAt: number;
}

export const QUEUE_ITEM_STATUSES = [
  'QUEUED',
  'READY',
  'DISPATCHED',
  'WAITING_DEPENDENCY',
  'WAITING_HUMAN',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED'
] as const;
export type QueueItemStatus = (typeof QUEUE_ITEM_STATUSES)[number];

export interface QueueItem {
  id: string;
  projectId: string;
  missionId: string;
  priority: PriorityLevel;
  rank: number;
  status: QueueItemStatus;
  requiredCapabilities: readonly string[];
  reasonCode: string;
  queuedAt: number;
}

export interface CompanyWorkQueue {
  items: readonly QueueItem[];
  totalQueued: number;
  readyCount: number;
  blockedCount: number;
  updatedAt: number;
}

export interface OperationDetail {
  operationId: string;
  projectId: string;
  projectName: string;
  missionId: string;
  missionTitle: string;
  leadAgentId: LaPitayaAgentId;
  activeAgents: readonly LaPitayaAgentId[];
  envelopeId: string | null;
  riskLevel: string;
  budgetRemaining: {
    iterations: number;
    tokens: number;
    timeMs: number;
  };
  startedAt: number;
  status: 'RUNNING' | 'WAITING' | 'PAUSED' | 'FAILED' | 'COMPLETED';
}

export interface CompanyOperationsCenterState {
  activeOperations: readonly OperationDetail[];
  pausedOperations: readonly OperationDetail[];
  recentCompletions: readonly OperationDetail[];
  concurrency: {
    current: number;
    maxLimit: number;
  };
}

export interface VirtualCompanyConfig {
  name: string;
  brand: 'PitayaCode';
  origin: 'Sonora, Mexico';
  operatingMode: CompanyOperatingMode;
  maxConcurrentOperations: number;
  humanOwner: {
    id: string;
    displayName: string;
  };
  isPaused: boolean;
}

export interface VirtualCompany {
  companyId: 'lapitaya';
  name: string;
  organizationIdentity: {
    brand: 'PitayaCode';
    origin: 'Sonora, Mexico';
    schemaVersion: 1;
  };
  humanOwner: {
    id: string;
    displayName: string;
  };
  operatingMode: CompanyOperatingMode;
  isPaused: boolean;
  governanceState: {
    cimaVersion: string;
    activePolicies: readonly string[];
    riskCeiling: string;
  };
  portfolio: CompanyPortfolio;
  workQueue: CompanyWorkQueue;
  teams: readonly CompanyTeam[];
  resources: readonly CompanyResource[];
  health: CompanyHealth;
  humanAttention: HumanAttentionCenterState;
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
}

export interface CompanyOSSnapshot extends CompanySnapshot {
  schemaVersion: 2;
  operatingMode?: CompanyOperatingMode;
  portfolio: CompanyPortfolio;
  workQueue: CompanyWorkQueue;
  teams: readonly CompanyTeam[];
  capacity: readonly AgentCapacity[];
  resources: readonly CompanyResource[];
  metrics: CompanyMetrics;
  health: CompanyHealth;
  humanAttentionCenter: HumanAttentionCenterState;
  operationsCenter: CompanyOperationsCenterState;
  isPaused: boolean;
}

export function cloneCompanyOSSnapshot(snapshot: CompanyOSSnapshot): CompanyOSSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as CompanyOSSnapshot;
}
