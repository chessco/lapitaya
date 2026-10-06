import type {
  CompanyProject,
  CompanyMission,
  CompanyDelivery
} from '../shared/lapitaya/company/types';
import type {
  PriorityLevel,
  PriorityDefinition,
  HealthStatus,
  CrossProjectDependency,
  MissionPortfolioView,
  ProjectPortfolioView,
  CompanyPortfolio,
  QueueItem,
  QueueItemStatus,
  CompanyWorkQueue,
  OperationDetail,
  HumanAttentionItem
} from '../shared/lapitaya/company/osTypes';

export function priorityRank(level: PriorityLevel): number {
  switch (level) {
    case 'CRITICAL':
      return 1;
    case 'HIGH':
      return 2;
    case 'NORMAL':
      return 3;
    case 'LOW':
      return 4;
    default:
      return 3;
  }
}

export class PriorityManager {
  private readonly projectPriorities = new Map<string, PriorityDefinition>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  public setProjectPriority(
    projectId: string,
    level: PriorityLevel,
    reason = 'Human priority assignment',
    updatedBy = 'human',
    provenance: 'HUMAN' | 'EL_INGE_PROPOSED' | 'RUNTIME_DERIVED' = 'HUMAN'
  ): PriorityDefinition {
    const def: PriorityDefinition = {
      level,
      rank: priorityRank(level),
      provenance,
      reason,
      updatedAt: this.now(),
      updatedBy
    };
    this.projectPriorities.set(projectId, def);
    return def;
  }

  public getProjectPriority(projectId: string): PriorityLevel {
    return this.projectPriorities.get(projectId)?.level ?? 'NORMAL';
  }

  public getPriorityDefinition(projectId: string): PriorityDefinition {
    const existing = this.projectPriorities.get(projectId);
    if (existing) return existing;
    return {
      level: 'NORMAL',
      rank: 3,
      provenance: 'RUNTIME_DERIVED',
      reason: 'Default project priority',
      updatedAt: this.now(),
      updatedBy: 'system'
    };
  }

  public getPriority(projectId: string): PriorityDefinition {
    return this.getPriorityDefinition(projectId);
  }

  public getAllPriorities(): ReadonlyMap<string, PriorityDefinition> {
    return this.projectPriorities;
  }

  public listPriorities(): readonly (PriorityDefinition & { projectId: string })[] {
    return Array.from(this.projectPriorities.entries()).map(([projectId, def]) => ({
      projectId,
      ...def
    }));
  }

  public setPriority(def: PriorityDefinition & { projectId: string }): void {
    const { projectId, ...rest } = def;
    this.projectPriorities.set(projectId, rest);
  }

  public clear(): void {
    this.projectPriorities.clear();
  }
}

export class DependencyEngine {
  private readonly dependencies = new Map<string, CrossProjectDependency>();

  public addDependency(
    dependentProjectIdOrDep: string | CrossProjectDependency,
    prerequisiteProjectId?: string,
    reason?: string
  ): CrossProjectDependency {
    if (typeof dependentProjectIdOrDep === 'object') {
      const dep = dependentProjectIdOrDep;
      this.dependencies.set(dep.id, { ...dep });
      return dep;
    }
    const depId = `dep-${dependentProjectIdOrDep}-${prerequisiteProjectId}`;
    const dep: CrossProjectDependency = {
      id: depId,
      dependentProjectId: dependentProjectIdOrDep,
      prerequisiteProjectId: prerequisiteProjectId ?? '',
      reason: reason ?? '',
      satisfied: false
    };
    this.dependencies.set(depId, dep);
    return dep;
  }

  public removeDependency(id: string): boolean {
    return this.dependencies.delete(id);
  }

  public getDependencies(): readonly CrossProjectDependency[] {
    return Array.from(this.dependencies.values());
  }

  public listDependencies(): readonly CrossProjectDependency[] {
    return Array.from(this.dependencies.values());
  }

  public hasPrerequisite(dependentProjectId: string, prerequisiteProjectId: string): boolean {
    for (const dep of this.dependencies.values()) {
      if (dep.dependentProjectId === dependentProjectId && dep.prerequisiteProjectId === prerequisiteProjectId) {
        return true;
      }
    }
    return false;
  }

  public clear(): void {
    this.dependencies.clear();
  }

  public detectCycles(): readonly string[] {
    const adj = new Map<string, string[]>();
    for (const dep of this.dependencies.values()) {
      const list = adj.get(dep.dependentProjectId) ?? [];
      list.push(dep.prerequisiteProjectId);
      adj.set(dep.dependentProjectId, list);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycleNodes = new Set<string>();

    const dfs = (node: string): boolean => {
      visited.add(node);
      recStack.add(node);

      const neighbors = adj.get(node) ?? [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) {
            cycleNodes.add(node);
            return true;
          }
        } else if (recStack.has(neighbor)) {
          cycleNodes.add(node);
          cycleNodes.add(neighbor);
          return true;
        }
      }

      recStack.delete(node);
      return false;
    };

    for (const node of adj.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return Array.from(cycleNodes);
  }

  public areProjectPrerequisitesSatisfied(
    projectId: string,
    completedProjectIds: ReadonlySet<string>
  ): boolean {
    for (const dep of this.dependencies.values()) {
      if (dep.dependentProjectId === projectId) {
        if (!completedProjectIds.has(dep.prerequisiteProjectId)) {
          return false;
        }
      }
    }
    return true;
  }
}

export interface PortfolioAggregationInput {
  projects: readonly CompanyProject[];
  missions: readonly CompanyMission[];
  deliveries: readonly CompanyDelivery[];
  activeOperations?: readonly OperationDetail[];
  humanAttentionItems?: readonly HumanAttentionItem[];
  activeProjectId?: string | null;
  priorityManager: PriorityManager;
  dependencyEngine: DependencyEngine;
  now?: () => number;
}

export function aggregatePortfolio(input: PortfolioAggregationInput): CompanyPortfolio {
  const now = input.now ?? (() => Date.now());
  const completedProjects = new Set<string>();

  // Determine completed projects
  for (const project of input.projects) {
    const projectMissions = input.missions.filter((m) => m.projectId === project.projectId);
    const completedMissions = projectMissions.filter(
      (m) => m.status === 'COMPLETED' || input.deliveries.some((d) => d.missionId === m.missionId && d.outcome === 'PASS')
    );
    if (projectMissions.length > 0 && completedMissions.length === projectMissions.length) {
      completedProjects.add(project.projectId);
    }
  }

  const projectViews: ProjectPortfolioView[] = input.projects.map((project) => {
    const projectMissions = input.missions.filter((m) => m.projectId === project.projectId);
    const completedMissions = projectMissions.filter(
      (m) => m.status === 'COMPLETED' || input.deliveries.some((d) => d.missionId === m.missionId && d.outcome === 'PASS')
    );
    const priority = input.priorityManager.getProjectPriority(project.projectId);
    const activeOps = (input.activeOperations ?? []).filter((op) => op.projectId === project.projectId);
    const humanBlockers = (input.humanAttentionItems ?? []).filter(
      (item) => item.projectId === project.projectId && item.severity === 'CRITICAL'
    );

    let health: HealthStatus = 'HEALTHY';
    if (humanBlockers.length > 0) {
      health = 'BLOCKED';
    } else if (project.status === 'BLOCKED') {
      health = 'BLOCKED';
    } else if (activeOps.some((op) => op.status === 'FAILED')) {
      health = 'DEGRADED';
    }

    const missionViews: MissionPortfolioView[] = projectMissions.map((m) => ({
      missionId: m.missionId,
      projectId: m.projectId,
      title: m.title,
      status: m.status,
      priority,
      leadAgentId: m.plan?.proposedWork?.[0]?.expectedAgentId ?? null,
      hasActiveEnvelope: false,
      isBlocked: m.status === 'BLOCKED' || (m.dependencies?.length ?? 0) > 0
    }));

    return {
      projectId: project.projectId,
      name: project.name,
      objective: project.objective,
      status: project.status,
      priority,
      health,
      progress: {
        completedMissions: completedMissions.length,
        totalMissions: projectMissions.length,
        percentComplete:
          projectMissions.length > 0 ? Math.round((completedMissions.length / projectMissions.length) * 100) : 0
      },
      missions: missionViews,
      activeOperationCount: activeOps.length,
      humanBlockerCount: humanBlockers.length,
      budgetUtilization: {
        tokensUsed: 0,
        tokenBudget: null,
        timeSpentMs: 0
      }
    };
  });

  const total = projectViews.length;
  const activeCount = projectViews.filter((p) => p.status === 'ACTIVE').length;
  const pausedCount = projectViews.filter((p) => p.status === 'PLANNING' || p.status === 'WAITING_FOR_HUMAN').length;
  const completedCount = projectViews.filter((p) => p.status === 'COMPLETED').length;
  const blockedCount = projectViews.filter((p) => p.status === 'BLOCKED' || p.health === 'BLOCKED').length;

  return {
    projects: projectViews,
    activeProjectId: input.activeProjectId ?? (projectViews[0]?.projectId ?? null),
    summary: {
      totalProjects: total,
      activeCount,
      pausedCount,
      completedCount,
      blockedCount
    },
    dependencies: input.dependencyEngine.getDependencies(),
    updatedAt: now()
  };
}

export interface WorkQueueBuildInput {
  projects: readonly CompanyProject[];
  missions: readonly CompanyMission[];
  deliveries: readonly CompanyDelivery[];
  activeOperations?: readonly OperationDetail[];
  priorityManager: PriorityManager;
  dependencyEngine: DependencyEngine;
  isCompanyPaused?: boolean;
  now?: () => number;
}

export function buildWorkQueue(input: WorkQueueBuildInput): CompanyWorkQueue {
  const now = input.now ?? (() => Date.now());
  const completedMissionIds = new Set<string>();
  const completedProjectIds = new Set<string>();

  for (const del of input.deliveries) {
    if (del.missionId && del.outcome === 'PASS') {
      completedMissionIds.add(del.missionId);
    }
  }

  for (const m of input.missions) {
    if (m.status === 'COMPLETED') {
      completedMissionIds.add(m.missionId);
    }
  }

  for (const p of input.projects) {
    const pMissions = input.missions.filter((m) => m.projectId === p.projectId);
    if (pMissions.length > 0 && pMissions.every((m) => completedMissionIds.has(m.missionId))) {
      completedProjectIds.add(p.projectId);
    }
  }

  const cycleProjects = new Set(input.dependencyEngine.detectCycles());
  const items: QueueItem[] = [];

  for (const mission of input.missions) {
    const project = input.projects.find((p) => p.projectId === mission.projectId);
    const priority = input.priorityManager.getProjectPriority(mission.projectId);
    const rank = priorityRank(priority);

    let status: QueueItemStatus = 'QUEUED';
    let reasonCode = 'READY_FOR_SCHEDULING';

    if (mission.status === 'COMPLETED' || completedMissionIds.has(mission.missionId)) {
      status = 'COMPLETED';
      reasonCode = 'MISSION_DELIVERY_VERIFIED';
    } else if (mission.status === 'CANCELLED') {
      status = 'CANCELLED';
      reasonCode = 'MISSION_CANCELLED';
    } else if (input.isCompanyPaused) {
      status = 'BLOCKED';
      reasonCode = 'COMPANY_PAUSED';
    } else if (cycleProjects.has(mission.projectId)) {
      status = 'BLOCKED';
      reasonCode = 'CYCLIC_DEPENDENCY_DETECTED';
    } else if (!input.dependencyEngine.areProjectPrerequisitesSatisfied(mission.projectId, completedProjectIds)) {
      status = 'WAITING_DEPENDENCY';
      reasonCode = 'CROSS_PROJECT_PREREQUISITE_PENDING';
    } else if (mission.dependencies && mission.dependencies.length > 0) {
      const unsatisfied = mission.dependencies.filter((depId) => !completedMissionIds.has(depId));
      if (unsatisfied.length > 0) {
        status = 'WAITING_DEPENDENCY';
        reasonCode = `MISSION_PREREQUISITE_PENDING:${unsatisfied.join(',')}`;
      } else {
        status = 'READY';
        reasonCode = 'DEPENDENCIES_SATISFIED';
      }
    } else if (mission.status === 'WAITING_FOR_HUMAN') {
      status = 'WAITING_HUMAN';
      reasonCode = 'HUMAN_CONFIRMATION_REQUIRED';
    } else if (mission.status === 'BLOCKED') {
      status = 'BLOCKED';
      reasonCode = 'MISSION_EXPLICITLY_BLOCKED';
    } else {
      status = 'READY';
      reasonCode = 'ELIGIBLE_FOR_DISPATCH';
    }

    items.push({
      id: `queue-${mission.missionId}`,
      projectId: mission.projectId,
      missionId: mission.missionId,
      priority,
      rank,
      status,
      requiredCapabilities: mission.plan?.proposedWork?.map((w) => w.phase) ?? ['BUILD'],
      reasonCode,
      queuedAt: mission.createdAt
    });
  }

  // Sort queue items: Priority Rank ASC (1=CRITICAL, 4=LOW), then readiness status, then queuedAt ASC
  const statusWeight: Record<QueueItemStatus, number> = {
    READY: 1,
    QUEUED: 2,
    WAITING_DEPENDENCY: 3,
    WAITING_HUMAN: 4,
    BLOCKED: 5,
    DISPATCHED: 6,
    COMPLETED: 7,
    CANCELLED: 8
  };

  items.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const swA = statusWeight[a.status] ?? 99;
    const swB = statusWeight[b.status] ?? 99;
    if (swA !== swB) return swA - swB;
    return a.queuedAt - b.queuedAt;
  });

  const readyCount = items.filter((i) => i.status === 'READY').length;
  const blockedCount = items.filter(
    (i) => i.status === 'BLOCKED' || i.status === 'WAITING_DEPENDENCY' || i.status === 'WAITING_HUMAN'
  ).length;

  return {
    items,
    totalQueued: items.length,
    readyCount,
    blockedCount,
    updatedAt: now()
  };
}
