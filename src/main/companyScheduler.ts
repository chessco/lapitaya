import type { LaPitayaAgentId } from '../shared/lapitaya/agents';
import type { CompanyPhase } from '../shared/lapitaya/company/types';
import type {
  CompanyResource,
  ResourceType,
  CompanyPortfolio,
  CompanyWorkQueue,
  AgentCapacity,
  OperationDetail,
  PriorityLevel
} from '../shared/lapitaya/company/osTypes';

export interface ResourceReservationRequest {
  resourceId: string;
  projectId: string;
  amount: number;
}

export class ResourceManager {
  private readonly resources = new Map<string, CompanyResource>();

  public registerResource(resource: CompanyResource): void {
    this.resources.set(resource.resourceId, {
      ...resource,
      allocatedAmount: resource.allocatedAmount ?? 0,
      availableAmount: resource.totalCapacity - (resource.allocatedAmount ?? 0),
      contendingProjects: resource.contendingProjects ?? []
    });
  }

  public getResource(resourceId: string): CompanyResource | undefined {
    const res = this.resources.get(resourceId);
    return res ? { ...res } : undefined;
  }

  public getAllResources(): readonly CompanyResource[] {
    return Array.from(this.resources.values()).map((r) => ({ ...r }));
  }

  public listResources(): readonly CompanyResource[] {
    return this.getAllResources();
  }

  public clear(): void {
    this.resources.clear();
  }

  public reserveResource(
    resourceId: string,
    projectId: string,
    amount: number
  ): { ok: true } | { ok: false; code: string; reason: string } {
    const res = this.resources.get(resourceId);
    if (!res) {
      return { ok: false, code: 'RESOURCE_NOT_FOUND', reason: `Resource ${resourceId} does not exist` };
    }

    if (res.availableAmount < amount) {
      // Add project to contendingProjects if not already present
      if (!res.contendingProjects.includes(projectId)) {
        res.contendingProjects = [...res.contendingProjects, projectId];
      }
      return {
        ok: false,
        code: 'RESOURCE_CAPACITY_EXCEEDED',
        reason: `Resource ${resourceId} capacity exceeded: available ${res.availableAmount} < requested ${amount}`
      };
    }

    res.allocatedAmount += amount;
    res.availableAmount = res.totalCapacity - res.allocatedAmount;
    return { ok: true };
  }

  public releaseResource(resourceId: string, projectId: string, amount: number): void {
    const res = this.resources.get(resourceId);
    if (!res) return;
    res.allocatedAmount = Math.max(0, res.allocatedAmount - amount);
    res.availableAmount = res.totalCapacity - res.allocatedAmount;
    res.contendingProjects = res.contendingProjects.filter((p) => p !== projectId);
  }
}

export interface SchedulingEvaluationParams {
  portfolio: CompanyPortfolio;
  workQueue: CompanyWorkQueue;
  capacities: readonly AgentCapacity[];
  resources?: readonly CompanyResource[];
  activeOperations?: readonly OperationDetail[];
  maxConcurrentOperations?: number;
  isCompanyPaused?: boolean;
}

export type SchedulingDecisionStatus =
  | 'DISPATCH_READY'
  | 'NO_WORK_AVAILABLE'
  | 'CONCURRENCY_LIMIT_REACHED'
  | 'COMPANY_PAUSED'
  | 'RESOURCE_UNAVAILABLE'
  | 'CAPACITY_UNAVAILABLE';

export interface DispatchCandidate {
  projectId: string;
  missionId: string;
  priority: PriorityLevel;
  rank: number;
  expectedLeadAgentId: LaPitayaAgentId;
  eligibleAgents: readonly LaPitayaAgentId[];
  reasonCode: string;
}

export interface SchedulingDecisionCandidate {
  status: SchedulingDecisionStatus;
  selectedCandidate: DispatchCandidate | null;
  explanation: string;
  evaluatedAt: number;
}

export class OrganizationalScheduler {
  constructor(private readonly now: () => number = () => Date.now()) {}

  public evaluateNextDispatch(params: SchedulingEvaluationParams): SchedulingDecisionCandidate {
    const evaluatedAt = this.now();

    // 1. Check Company Pause
    if (params.isCompanyPaused) {
      return {
        status: 'COMPANY_PAUSED',
        selectedCandidate: null,
        explanation: 'Company execution is paused by operator. No work will be scheduled.',
        evaluatedAt
      };
    }

    // 2. Check Global Concurrency Limit
    const maxOps = params.maxConcurrentOperations ?? 2;
    const runningOps = (params.activeOperations ?? []).filter((op) => op.status === 'RUNNING').length;
    if (runningOps >= maxOps) {
      return {
        status: 'CONCURRENCY_LIMIT_REACHED',
        selectedCandidate: null,
        explanation: `Company concurrency limit reached (${runningOps}/${maxOps} operations running).`,
        evaluatedAt
      };
    }

    // 3. Find READY queue items
    const readyItems = params.workQueue.items.filter((item) => item.status === 'READY');
    if (readyItems.length === 0) {
      return {
        status: 'NO_WORK_AVAILABLE',
        selectedCandidate: null,
        explanation: 'No work queue items are currently in READY state.',
        evaluatedAt
      };
    }

    // 4. Evaluate items in priority order
    for (const item of readyItems) {
      // Check if project is already running an operation
      const projectRunning = (params.activeOperations ?? []).some(
        (op) => op.projectId === item.projectId && op.status === 'RUNNING'
      );
      if (projectRunning) {
        continue;
      }

      // Check agent capacity: El Inge (orchestrator) and at least one Builder (Rosalba or El Beni) must be available
      const ingeCap = params.capacities.find((c) => c.agentId === 'el-inge');
      const rosalbaCap = params.capacities.find((c) => c.agentId === 'rosalba');
      const beniCap = params.capacities.find((c) => c.agentId === 'el-beni');

      if (!ingeCap || (ingeCap.state !== 'AVAILABLE' && ingeCap.state !== 'IDLE')) {
        continue;
      }

      const availableBuilders: LaPitayaAgentId[] = [];
      if (rosalbaCap && (rosalbaCap.state === 'AVAILABLE' || rosalbaCap.state === 'IDLE')) {
        availableBuilders.push('rosalba');
      }
      if (beniCap && (beniCap.state === 'AVAILABLE' || beniCap.state === 'IDLE')) {
        availableBuilders.push('el-beni');
      }

      if (availableBuilders.length === 0) {
        continue;
      }

      // Check resource availability if any resource constraints exist
      let resourcesSufficient = true;
      let resourceBottleneck: string | null = null;
      if (params.resources && params.resources.length > 0) {
        for (const res of params.resources) {
          if (res.availableAmount <= 0) {
            resourcesSufficient = false;
            resourceBottleneck = res.name;
            break;
          }
        }
      }

      if (!resourcesSufficient) {
        return {
          status: 'RESOURCE_UNAVAILABLE',
          selectedCandidate: null,
          explanation: `Resource constraint: ${resourceBottleneck} is exhausted.`,
          evaluatedAt
        };
      }

      // Candidate selected!
      const leadBuilder = availableBuilders[0];
      return {
        status: 'DISPATCH_READY',
        selectedCandidate: {
          projectId: item.projectId,
          missionId: item.missionId,
          priority: item.priority,
          rank: item.rank,
          expectedLeadAgentId: leadBuilder,
          eligibleAgents: ['el-inge', leadBuilder, 'margarito', 'jose-juan'],
          reasonCode: `SCHEDULED_PRIORITY_${item.priority}`
        },
        explanation: `Mission ${item.missionId} on project ${item.projectId} selected based on priority ${item.priority} and capacity availability.`,
        evaluatedAt
      };
    }

    return {
      status: 'CAPACITY_UNAVAILABLE',
      selectedCandidate: null,
      explanation: 'Eligible work is ready, but required agent capacity is currently busy on other operations.',
      evaluatedAt
    };
  }
}
