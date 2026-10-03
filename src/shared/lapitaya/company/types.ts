import type { CimaPhase } from '../cima';
import type { LaPitayaAgentId } from '../agents';

export const COMPANY_PHASES = ['CONTEXT', 'ARCHITECT', 'BUILD', 'TEST', 'AUDIT', 'LEARN', 'DECISION', 'ITERATE'] as const;
export type CompanyPhase = (typeof COMPANY_PHASES)[number];
export type CompanyStatus = 'IDLE' | 'WORKING' | 'WAITING_FOR_HUMAN' | 'BLOCKED' | 'COMPLETED' | 'FAILED';
export type CompanyAgentState = 'AVAILABLE' | 'EXPECTED_NEXT' | 'ASSIGNED' | 'WORKING' | 'WAITING' | 'ATTENTION' | 'COMPLETED' | 'BLOCKED';
export type CompanyAssignmentStatus = 'ASSIGNED' | 'WORKING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
export type CompanySessionStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED';

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
