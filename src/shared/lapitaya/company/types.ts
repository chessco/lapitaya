import type { CimaPhase } from '../cima';
import type { LaPitayaAgentId } from '../agents';

export const COMPANY_PHASES = ['CONTEXT', 'ARCHITECT', 'BUILD', 'TEST', 'AUDIT', 'LEARN', 'DECISION', 'ITERATE'] as const;
export type CompanyPhase = (typeof COMPANY_PHASES)[number];
export type CompanyStatus = 'IDLE' | 'WORKING' | 'WAITING_FOR_HUMAN' | 'BLOCKED' | 'COMPLETED' | 'FAILED';
export type CompanyAgentState = 'AVAILABLE' | 'EXPECTED_NEXT' | 'ASSIGNED' | 'WORKING' | 'WAITING' | 'ATTENTION' | 'COMPLETED' | 'BLOCKED';
export type CompanyAssignmentStatus = 'ASSIGNED' | 'WORKING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
export type CompanySessionStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
export type CompanyWorkRequestStatus = 'DRAFT' | 'PROPOSED' | 'CONFIRMED' | 'PLANNING' | 'ACTIVE' | 'WAITING_FOR_HUMAN' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type CompanyWorkPlanStatus = 'PLANNING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';
export type CompanyFactProvenance = 'HUMAN' | 'EL_INGE_PROPOSED' | 'RUNTIME_DERIVED';

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

export interface CompanyWorkRequest {
  requestId: string;
  humanId: string;
  sessionId: string | null;
  projectId: string | null;
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
  outcome: 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED';
  summary: string;
  artifacts: readonly string[];
  completedAt: number;
  evidenceRefs: readonly string[];
  verified: true;
}

export interface CompanyOperationsProjection {
  workRequest: CompanyWorkRequest | null;
  workPlan: CompanyWorkPlan | null;
  progress: CompanyProgress | null;
  delivery: CompanyDelivery | null;
  requests: readonly CompanyWorkRequest[];
  plans: readonly CompanyWorkPlan[];
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
  activeTeam: readonly LaPitayaAgentId[];
  agents: readonly CompanyAgentProjection[];
  currentPhase: CompanyPhase | null;
  activeAssignments: readonly CompanyAssignment[];
  expectedNext: readonly { agentId: LaPitayaAgentId; phase: CompanyPhase }[];
  humanAttention: CompanyHumanAttention | null;
  recentVerifiedEvents: readonly CompanyTimelineEntry[];
  executionAwake: boolean;
  operations?: CompanyOperationsProjection;
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
