import type { CimaPhase } from '../cima';
import type { LaPitayaAgentId } from '../agents';
import type { LearningSnapshot, AdoptedSkill } from '../learning/types';
import type { AutonomySnapshot } from '../autonomy/types';

export const COMPANY_PHASES = ['CONTEXT', 'ARCHITECT', 'BUILD', 'TEST', 'AUDIT', 'LEARN', 'DECISION', 'ITERATE'] as const;
export type CompanyPhase = (typeof COMPANY_PHASES)[number];
export type CompanyStatus = 'IDLE' | 'WORKING' | 'WAITING_FOR_HUMAN' | 'BLOCKED' | 'COMPLETED' | 'FAILED';
export type CompanyAgentState = 'AVAILABLE' | 'EXPECTED_NEXT' | 'ASSIGNED' | 'WORKING' | 'WAITING' | 'ATTENTION' | 'COMPLETED' | 'BLOCKED';
export type CompanyAssignmentStatus = 'ASSIGNED' | 'WORKING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
export type CompanySessionStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
export type CompanyWorkRequestStatus = 'DRAFT' | 'PROPOSED' | 'CONFIRMED' | 'PLANNING' | 'ACTIVE' | 'WAITING_FOR_HUMAN' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type CompanyWorkPlanStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
export type CompanyFactProvenance = 'HUMAN' | 'EL_INGE_PROPOSED' | 'RUNTIME_DERIVED';

export type CompanyProjectStatus = 'PLANNING' | 'ACTIVE' | 'WAITING_FOR_HUMAN' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';
export type CompanyMissionStatus = 'PLANNING' | 'WAITING_FOR_HUMAN' | 'CONFIRMED' | 'ACTIVE' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface CompanyProjectContext {
  projectId: string | null;
  displayName: string | null;
  workspace: string | null;
  repository: string | null;
  branch: string | null;
}

export interface CompanyHumanAttention {
  kind: 'REQUEST' | 'HIGH';
  ref: string;
  taskId: string | null;
  agentId: LaPitayaAgentId | null;
  reason: string | null;
  verified: true;
}

export interface CompanyAssignment {
  id: string;
  taskId: string;
  phase: CompanyPhase;
  agentId: LaPitayaAgentId;
  fromAgentId: LaPitayaAgentId | null;
  status: CompanyAssignmentStatus;
  assignedAt: number;
  endedAt: number | null;
  ref: string | null;
  verified: true;
}

export interface CompanyTimelineEntry {
  id: string;
  ts: number;
  type: string;
  summary: string;
  taskId: string | null;
  phase: CompanyPhase | null;
  agentId: LaPitayaAgentId | null;
  verified: true;
  lifecycleNoise?: boolean;
}

export interface CompanySession {
  sessionId: string;
  taskId: string;
  project: CompanyProjectContext;
  startedAt: number;
  endedAt: number | null;
  status: CompanySessionStatus;
  participants: readonly LaPitayaAgentId[];
  currentPhase: CompanyPhase | null;
  assignments: readonly CompanyAssignment[];
  humanAttention: CompanyHumanAttention | null;
  outcome: 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED' | null;
  completedPhases: readonly CompanyPhase[];
  timeline: readonly CompanyTimelineEntry[];
}

export interface CompanyAcceptanceCriterion {
  text: string;
  provenance: CompanyFactProvenance;
  verified: true;
}

export interface MissionPlanStep {
  id: string;
  title: string;
  phase: CompanyPhase;
  description: string;
  expectedAgentId: LaPitayaAgentId | null;
}

export interface MissionPlan {
  missionId: string;
  objective: string;
  milestones: readonly string[];
  proposedWork: readonly MissionPlanStep[];
  dependencies: readonly string[];
  acceptanceCriteria: readonly CompanyAcceptanceCriterion[];
  status: 'PROPOSED' | 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  createdBy: 'el-inge';
  createdAt: number;
  verified: true;
}

export interface CompanyMission {
  missionId: string;
  projectId: string;
  title: string;
  objective: string;
  acceptanceCriteria: readonly CompanyAcceptanceCriterion[];
  provenance: CompanyFactProvenance;
  dependencies: readonly string[];
  status: CompanyMissionStatus;
  workRequestIds: readonly string[];
  deliveryIds: readonly string[];
  plan: MissionPlan | null;
  createdAt: number;
  updatedAt: number;
  confirmedAt: number | null;
  confirmedBy: string | null;
  verified: true;
}

export interface CompanyProject {
  projectId: string;
  name: string;
  objective: string;
  status: CompanyProjectStatus;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  acceptanceCriteria: readonly CompanyAcceptanceCriterion[];
  missionIds: readonly string[];
  verified: true;
}

export interface CompanyWorkRequest {
  requestId: string;
  humanId: string;
  sessionId: string | null;
  projectId: string | null;
  missionId?: string | null;
  taskId: string | null;
  objective: string;
  constraints: readonly string[];
  acceptanceCriteria: readonly CompanyAcceptanceCriterion[];
  status: CompanyWorkRequestStatus;
  createdAt: number;
  confirmedAt: number | null;
  cancelledAt: number | null;
  proposalRef: string | null;
  verified: true;
}

export interface CompanyWorkPlan {
  planId: string;
  requestId: string;
  taskId: string | null;
  objective: string;
  steps: readonly { phase: CompanyPhase; label: string; expectedAgentId: LaPitayaAgentId | null }[];
  expectedRoles: readonly string[];
  acceptanceCriteria: readonly CompanyAcceptanceCriterion[];
  status: CompanyWorkPlanStatus;
  createdBy: 'el-inge';
  createdAt: number;
  verified: true;
}

export interface CompanyProgress {
  stage: 'PLANNING' | 'BUILDING' | 'TESTING' | 'AUDITING' | 'WAITING_FOR_HUMAN' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
  completedPhases: readonly CompanyPhase[];
  verified: true;
}

export interface CompanyDelivery {
  requestId: string;
  taskId: string | null;
  projectId?: string | null;
  missionId?: string | null;
  outcome: 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED';
  summary: string;
  artifacts: readonly string[];
  completedAt: number;
  evidenceRefs: readonly string[];
  verified: true;
}

export interface ProjectSnapshot {
  project: CompanyProject;
  missions: readonly CompanyMission[];
  currentMission: CompanyMission | null;
  activeSessions: readonly CompanySession[];
  activeTeam: readonly LaPitayaAgentId[];
  progress: { completedMissions: number; totalMissions: number; summary: string };
  blockers: readonly string[];
  humanAttention: CompanyHumanAttention | null;
  recentDeliveries: readonly CompanyDelivery[];
  recentVerifiedEvents: readonly CompanyTimelineEntry[];
  verified: true;
}

export interface MissionSnapshot {
  mission: CompanyMission;
  plan: MissionPlan | null;
  authorizedWork: readonly CompanyWorkRequest[];
  activeWork: readonly CompanyWorkRequest[];
  expectedWork: readonly string[];
  completedWork: readonly CompanyWorkRequest[];
  deliveries: readonly CompanyDelivery[];
  blockers: readonly string[];
  humanAttention: CompanyHumanAttention | null;
  outcome: 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED' | null;
  verified: true;
}

export interface CompanyOperationsProjection {
  workRequest: CompanyWorkRequest | null;
  workPlan: CompanyWorkPlan | null;
  progress: CompanyProgress | null;
  delivery: CompanyDelivery | null;
  requests: readonly CompanyWorkRequest[];
  plans: readonly CompanyWorkPlan[];
  projects?: readonly CompanyProject[];
  missions?: readonly CompanyMission[];
  foregroundProject?: ProjectSnapshot | null;
  foregroundMission?: MissionSnapshot | null;
  learning?: LearningSnapshot | null;
  skills?: readonly AdoptedSkill[];
  autonomy?: AutonomySnapshot | null;
}

export interface CompanyAgentProjection {
  agentId: LaPitayaAgentId;
  state: CompanyAgentState;
  assignment: CompanyAssignment | null;
  expectedPhase: CompanyPhase | null;
  verified: true;
}

export interface CompanySnapshot {
  version: 1;
  company: { id: 'lapitaya'; name: 'La Pitaya'; };
  status: CompanyStatus;
  session: CompanySession | null;
  project: CompanyProjectContext;
  projects?: readonly CompanyProject[];
  foregroundProject?: ProjectSnapshot | null;
  foregroundMission?: MissionSnapshot | null;
  activeTeam: readonly LaPitayaAgentId[];
  agents: readonly CompanyAgentProjection[];
  currentPhase: CompanyPhase | null;
  activeAssignments: readonly CompanyAssignment[];
  expectedNext: readonly { agentId: LaPitayaAgentId; phase: CompanyPhase }[];
  humanAttention: CompanyHumanAttention | null;
  recentVerifiedEvents: readonly CompanyTimelineEntry[];
  executionAwake: boolean;
  operations?: CompanyOperationsProjection;
  learning?: LearningSnapshot | null;
  autonomy?: AutonomySnapshot | null;
}

export interface CompanyAnswer {
  known: boolean;
  answer: string;
  facts: readonly string[];
  snapshotVersion: 1;
}

export function asCompanyPhase(v: unknown): CompanyPhase | null {
  return typeof v === 'string' && (COMPANY_PHASES as readonly string[]).includes(v) ? v as CompanyPhase : null;
}

export function cloneCompanySnapshot(snapshot: CompanySnapshot): CompanySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as CompanySnapshot;
}

export * from './osTypes';

