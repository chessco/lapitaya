import type { LaPitayaAgentId } from '../shared/lapitaya/agents';
import { LA_PITAYA_AGENT_IDS } from '../shared/lapitaya/agents';
import type {
  VirtualCompany,
  VirtualCompanyConfig,
  CompanyOperatingMode,
  PriorityLevel,
  PriorityDefinition,
  CrossProjectDependency,
  OperationDetail,
  HumanAttentionItem,
  HumanAttentionReason,
  AgentCapacity,
  CompanyTeam,
  AgentOrganizationalProfile,
  CompanyResource,
  HumanAttentionCenterState,
  CompanyHealth,
  CompanyMetrics,
  CompanyPortfolio,
  CompanyWorkQueue,
  CompanyOperationsCenterState,
  CompanyOSSnapshot
} from '../shared/lapitaya/company/osTypes';
import type { CompanySnapshot } from '../shared/lapitaya/company/types';

export const CANONICAL_COMPANY_TEAMS: readonly CompanyTeam[] = [
  {
    teamId: 'team-delivery',
    name: 'Software Delivery Team',
    description: 'Core implementation, coding, bug fixes, and feature construction.',
    leadAgentId: 'el-inge',
    members: ['el-inge', 'rosalba', 'el-beni'],
    capabilities: ['architecture-planning', 'code-implementation', 'refactoring', 'scripting']
  },
  {
    teamId: 'team-quality',
    name: 'Quality & Audit Team',
    description: 'Independent test verification, regression validation, and governance audits.',
    leadAgentId: 'margarito',
    members: ['margarito', 'jose-juan'],
    capabilities: ['testing', 'qa', 'audit', 'compliance', 'verification']
  },
  {
    teamId: 'team-architecture',
    name: 'Architecture Team',
    description: 'System-wide design, cross-project consistency, and technical debt reviews.',
    leadAgentId: 'valentin',
    members: ['valentin', 'el-inge'],
    capabilities: ['system-design', 'cross-project-architecture', 'tech-reviews']
  },
  {
    teamId: 'team-learning',
    name: 'Organizational Learning Team',
    description: 'Lesson extraction, skill proposal synthesis, and experience aggregation.',
    leadAgentId: 'el-tutu',
    members: ['el-tutu'],
    capabilities: ['lesson-extraction', 'skill-proposals', 'experience-analysis']
  }
];

export const CANONICAL_AGENT_PROFILES: readonly AgentOrganizationalProfile[] = [
  {
    agentId: 'el-inge',
    name: 'El Inge',
    organizationalRole: 'Tech Lead & Operations Coordinator',
    cimaRole: 'Builder',
    capabilities: ['mission-planning', 'orchestration', 'task-decomposition', 'sequencing'],
    teamId: 'team-delivery'
  },
  {
    agentId: 'valentin',
    name: 'Valentín',
    organizationalRole: 'Principal Architect',
    cimaRole: 'Builder',
    capabilities: ['system-design', 'cross-project-architecture', 'spec-review'],
    teamId: 'team-architecture'
  },
  {
    agentId: 'rosalba',
    name: 'Rosalba',
    organizationalRole: 'Senior Software Developer',
    cimaRole: 'Builder',
    capabilities: ['code-implementation', 'refactoring', 'systems-programming'],
    teamId: 'team-delivery'
  },
  {
    agentId: 'el-beni',
    name: 'El Beni',
    organizationalRole: 'Software Developer',
    cimaRole: 'Builder',
    capabilities: ['feature-delivery', 'unit-testing', 'script-automation'],
    teamId: 'team-delivery'
  },
  {
    agentId: 'margarito',
    name: 'Margarito',
    organizationalRole: 'QA & Test Engineer',
    cimaRole: 'Builder',
    capabilities: ['test-execution', 'regression-testing', 'edge-case-verification'],
    teamId: 'team-quality'
  },
  {
    agentId: 'jose-juan',
    name: 'José Juan',
    organizationalRole: 'Independent Auditor',
    cimaRole: 'Auditor',
    capabilities: ['compliance-audit', 'security-verification', 'cima-inspection'],
    teamId: 'team-quality'
  },
  {
    agentId: 'el-tutu',
    name: 'El Tutú',
    organizationalRole: 'Organizational Learner',
    cimaRole: 'Learner',
    capabilities: ['lesson-extraction', 'skill-synthesis', 'learning-analytics'],
    teamId: 'team-learning'
  },
  {
    agentId: 'alicia',
    name: 'Alicia',
    organizationalRole: 'Human AI Companion',
    cimaRole: 'Companion',
    capabilities: ['human-communication', 'status-explanation', 'attention-presentation'],
    teamId: 'team-delivery'
  }
];

export function createDefaultAgentCapacities(): readonly AgentCapacity[] {
  return LA_PITAYA_AGENT_IDS.map((agentId) => ({
    agentId,
    state: agentId === 'alicia' ? 'IDLE' : 'AVAILABLE',
    currentAssignment: null,
    concurrencyLimit: 1,
    utilizationRate: 0.0
  }));
}

export function createInitialCompanyMetrics(): CompanyMetrics {
  const initialAgentUtil: Record<LaPitayaAgentId, number> = {} as Record<LaPitayaAgentId, number>;
  for (const agentId of LA_PITAYA_AGENT_IDS) {
    initialAgentUtil[agentId] = 0.0;
  }
  return {
    activeProjects: 0,
    activeMissions: 0,
    runningOperations: 0,
    completedDeliveries: 0,
    overallPassRate: 1.0,
    auditFailureRate: 0.0,
    retryRate: 0.0,
    humanInterventionRate: 0.0,
    autonomyUtilization: 0.0,
    averageCycleTimeMs: 0,
    adoptedSkillsInUse: 0,
    agentUtilization: initialAgentUtil
  };
}

export function createInitialCompanyHealth(): CompanyHealth {
  return {
    status: 'HEALTHY',
    score: 100,
    reasonCodes: ['INITIAL_STATE_HEALTHY'],
    evidenceRefs: [],
    lastCalculatedAt: Date.now()
  };
}

export function createInitialHumanAttentionCenter(): HumanAttentionCenterState {
  return {
    items: [],
    criticalCount: 0,
    highCount: 0,
    normalCount: 0,
    hasBlockingIssues: false
  };
}

export function createInitialWorkQueue(): CompanyWorkQueue {
  return {
    items: [],
    totalQueued: 0,
    readyCount: 0,
    blockedCount: 0,
    updatedAt: Date.now()
  };
}

export function createInitialPortfolio(): CompanyPortfolio {
  return {
    projects: [],
    activeProjectId: null,
    summary: {
      totalProjects: 0,
      activeCount: 0,
      pausedCount: 0,
      completedCount: 0,
      blockedCount: 0
    },
    dependencies: [],
    updatedAt: Date.now()
  };
}

export function createInitialOperationsCenter(): CompanyOperationsCenterState {
  return {
    activeOperations: [],
    pausedOperations: [],
    recentCompletions: [],
    concurrency: {
      current: 0,
      maxLimit: 2
    }
  };
}

export function createDefaultVirtualCompany(config?: Partial<VirtualCompanyConfig>): VirtualCompany {
  const now = Date.now();
  return {
    companyId: 'lapitaya',
    name: config?.name ?? 'La Pitaya',
    organizationIdentity: {
      brand: 'PitayaCode',
      origin: 'Sonora, Mexico',
      schemaVersion: 1
    },
    humanOwner: config?.humanOwner ?? {
      id: 'human-owner',
      displayName: 'Human Operator'
    },
    operatingMode: config?.operatingMode ?? 'AUTONOMOUS_WITHIN_ENVELOPES',
    isPaused: config?.isPaused ?? false,
    governanceState: {
      cimaVersion: '0.16.0',
      activePolicies: ['POLICY-01', 'POLICY-02', 'POLICY-03', 'POLICY-13', 'POLICY-31'],
      riskCeiling: 'HIGH'
    },
    portfolio: createInitialPortfolio(),
    workQueue: createInitialWorkQueue(),
    teams: CANONICAL_COMPANY_TEAMS,
    resources: [],
    health: createInitialCompanyHealth(),
    humanAttention: createInitialHumanAttentionCenter(),
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1
  };
}

import {
  PriorityManager,
  DependencyEngine,
  aggregatePortfolio,
  buildWorkQueue
} from './companyPortfolio';
import {
  TeamsAndCapacityManager,
  AssignAgentParams
} from './companyTeams';
import {
  ResourceManager,
  OrganizationalScheduler,
  SchedulingDecisionCandidate
} from './companyScheduler';
import {
  HumanAttentionManager,
  CreateAttentionItemParams
} from './humanAttentionCenter';
import {
  calculateCompanyMetrics,
  calculateCompanyHealth
} from './companyHealth';
import {
  saveCompanyStateSync,
  loadCompanyStateSync,
  serializeCompanyState,
  deserializeCompanyState,
  rehydrateCompanyState,
  PersistedCompanyState
} from './companyPersistence';
import type { CompanyProject, CompanyMission, CompanyDelivery } from '../shared/lapitaya/company/types';

export interface VirtualCompanyOSOptions {
  now?: () => number;
  initialConfig?: Partial<VirtualCompanyConfig>;
  getLegacySnapshot?: () => CompanySnapshot;
  storagePath?: string;
}

export class VirtualCompanyOSService {
  private readonly now: () => number;
  private readonly getLegacySnapshot: () => CompanySnapshot;
  private state: VirtualCompany;
  private operationsCenter: CompanyOperationsCenterState;
  private metrics: CompanyMetrics;
  private storagePath: string | null;
  private readonly priorityManager: PriorityManager;
  private readonly dependencyEngine: DependencyEngine;
  private readonly teamsAndCapacity: TeamsAndCapacityManager;
  private readonly resourceManager: ResourceManager;
  private readonly scheduler: OrganizationalScheduler;
  private readonly humanAttention: HumanAttentionManager;

  constructor(options: VirtualCompanyOSOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.storagePath = options.storagePath ?? null;
    this.priorityManager = new PriorityManager(this.now);
    this.dependencyEngine = new DependencyEngine();
    this.teamsAndCapacity = new TeamsAndCapacityManager(this.now);
    this.resourceManager = new ResourceManager();
    this.scheduler = new OrganizationalScheduler(this.now);
    this.humanAttention = new HumanAttentionManager(this.now);
    this.getLegacySnapshot = options.getLegacySnapshot ?? (() => ({
      version: 1,
      company: { id: 'lapitaya', name: 'La Pitaya' },
      status: 'IDLE',
      session: null,
      project: { projectId: null, displayName: null, workspace: null, repository: null, branch: null },
      activeTeam: [],
      agents: [],
      currentPhase: null,
      activeAssignments: [],
      expectedNext: [],
      humanAttention: null,
      recentVerifiedEvents: [],
      executionAwake: false
    }));
    this.state = createDefaultVirtualCompany(options.initialConfig);
    this.operationsCenter = createInitialOperationsCenter();
    this.metrics = createInitialCompanyMetrics();
    if (this.storagePath) {
      this.load(this.storagePath);
    }
  }

  public getHumanAttentionManager(): HumanAttentionManager {
    return this.humanAttention;
  }

  public addHumanAttentionItem(params: CreateAttentionItemParams): HumanAttentionItem {
    const item = this.humanAttention.addItem(params);
    this.state = {
      ...this.state,
      humanAttention: this.humanAttention.getState(),
      updatedAt: this.now()
    };
    return item;
  }

  public removeHumanAttentionItem(itemId: string): boolean {
    const removed = this.humanAttention.removeItem(itemId);
    if (removed) {
      this.state = {
        ...this.state,
        humanAttention: this.humanAttention.getState(),
        updatedAt: this.now()
      };
    }
    return removed;
  }

  public resolveHumanAttentionForMission(missionId: string, reason?: HumanAttentionReason): void {
    this.humanAttention.resolveItemsForMission(missionId, reason);
    this.state = {
      ...this.state,
      humanAttention: this.humanAttention.getState(),
      updatedAt: this.now()
    };
  }

  public resolveHumanAttentionForProject(projectId: string, reason?: HumanAttentionReason): void {
    this.humanAttention.resolveItemsForProject(projectId, reason);
    this.state = {
      ...this.state,
      humanAttention: this.humanAttention.getState(),
      updatedAt: this.now()
    };
  }

  public getResourceManager(): ResourceManager {
    return this.resourceManager;
  }

  public getScheduler(): OrganizationalScheduler {
    return this.scheduler;
  }

  public registerResource(resource: CompanyResource): void {
    this.resourceManager.registerResource(resource);
    this.state = {
      ...this.state,
      resources: this.resourceManager.getAllResources(),
      updatedAt: this.now()
    };
  }

  public evaluateNextDispatch(): SchedulingDecisionCandidate {
    return this.scheduler.evaluateNextDispatch({
      portfolio: this.state.portfolio,
      workQueue: this.state.workQueue,
      capacities: this.teamsAndCapacity.getAllCapacities(),
      resources: this.resourceManager.getAllResources(),
      activeOperations: this.operationsCenter.activeOperations,
      maxConcurrentOperations: this.operationsCenter.concurrency.maxLimit,
      isCompanyPaused: this.state.isPaused
    });
  }

  public getTeamsAndCapacityManager(): TeamsAndCapacityManager {
    return this.teamsAndCapacity;
  }

  public getPriorityManager(): PriorityManager {
    return this.priorityManager;
  }

  public getDependencyEngine(): DependencyEngine {
    return this.dependencyEngine;
  }

  public setProjectPriority(
    projectId: string,
    level: PriorityLevel,
    reason = 'Human priority assignment',
    updatedBy = 'human',
    provenance: 'HUMAN' | 'EL_INGE_PROPOSED' | 'RUNTIME_DERIVED' = 'HUMAN'
  ): PriorityDefinition {
    const def = this.priorityManager.setProjectPriority(projectId, level, reason, updatedBy, provenance);
    this.state = {
      ...this.state,
      updatedAt: this.now()
    };
    return def;
  }

  public addProjectDependency(
    dependentProjectId: string,
    prerequisiteProjectId: string,
    reason: string
  ): CrossProjectDependency {
    const dep = this.dependencyEngine.addDependency(dependentProjectId, prerequisiteProjectId, reason);
    this.state = {
      ...this.state,
      updatedAt: this.now()
    };
    return dep;
  }

  public syncPortfolioAndQueue(params: {
    projects: readonly CompanyProject[];
    missions: readonly CompanyMission[];
    deliveries: readonly CompanyDelivery[];
    activeOperations?: readonly OperationDetail[];
    humanAttentionItems?: readonly HumanAttentionItem[];
    activeProjectId?: string | null;
  }): { portfolio: CompanyPortfolio; workQueue: CompanyWorkQueue } {
    const portfolio = aggregatePortfolio({
      projects: params.projects,
      missions: params.missions,
      deliveries: params.deliveries,
      activeOperations: params.activeOperations ?? this.operationsCenter.activeOperations,
      humanAttentionItems: params.humanAttentionItems ?? this.state.humanAttention.items,
      activeProjectId: params.activeProjectId ?? this.state.portfolio.activeProjectId,
      priorityManager: this.priorityManager,
      dependencyEngine: this.dependencyEngine,
      now: this.now
    });

    const workQueue = buildWorkQueue({
      projects: params.projects,
      missions: params.missions,
      deliveries: params.deliveries,
      activeOperations: params.activeOperations ?? this.operationsCenter.activeOperations,
      priorityManager: this.priorityManager,
      dependencyEngine: this.dependencyEngine,
      isCompanyPaused: this.state.isPaused,
      now: this.now
    });

    const metrics = calculateCompanyMetrics({
      projects: params.projects,
      missions: params.missions,
      deliveries: params.deliveries,
      activeOperations: params.activeOperations ?? this.operationsCenter.activeOperations,
      capacities: this.teamsAndCapacity.getAllCapacities()
    });

    const health = calculateCompanyHealth(
      {
        metrics,
        humanAttentionItems: this.humanAttention.getItems(),
        activeOperations: params.activeOperations ?? this.operationsCenter.activeOperations,
        isCompanyPaused: this.state.isPaused
      },
      this.now
    );

    this.metrics = metrics;

    this.state = {
      ...this.state,
      portfolio,
      workQueue,
      health,
      updatedAt: this.now()
    };

    return { portfolio, workQueue };
  }

  public getPortfolio(): Readonly<CompanyPortfolio> {
    return this.state.portfolio;
  }

  public getWorkQueue(): Readonly<CompanyWorkQueue> {
    return this.state.workQueue;
  }

  public getCompany(): Readonly<VirtualCompany> {
    return this.state;
  }

  public getOperatingMode(): CompanyOperatingMode {
    return this.state.operatingMode;
  }

  public setOperatingMode(mode: CompanyOperatingMode, updatedBy = 'human'): void {
    this.state = {
      ...this.state,
      operatingMode: mode,
      updatedAt: this.now()
    };
  }

  public isPaused(): boolean {
    return this.state.isPaused;
  }

  public pauseCompany(reason = 'Human operator pause'): void {
    const pausedOps: OperationDetail[] = [...this.operationsCenter.pausedOperations];
    const activeOps: OperationDetail[] = [];
    for (const op of this.operationsCenter.activeOperations) {
      if (op.status === 'RUNNING') {
        pausedOps.push({ ...op, status: 'PAUSED' });
      } else {
        activeOps.push(op);
      }
    }
    this.operationsCenter = {
      ...this.operationsCenter,
      activeOperations: activeOps,
      pausedOperations: pausedOps,
      concurrency: {
        ...this.operationsCenter.concurrency,
        current: activeOps.length
      }
    };
    this.state = {
      ...this.state,
      isPaused: true,
      updatedAt: this.now()
    };
  }

  public resumeCompany(): void {
    this.state = {
      ...this.state,
      isPaused: false,
      updatedAt: this.now()
    };
  }

  public setStoragePath(filePath: string): void {
    this.storagePath = filePath;
  }

  public getStoragePath(): string | null {
    return this.storagePath;
  }

  public save(filePath?: string): { ok: boolean; path: string; error?: string } {
    const target = filePath ?? this.storagePath;
    if (!target) {
      return { ok: false, path: '', error: 'NO_STORAGE_PATH' };
    }
    return saveCompanyStateSync(this, target);
  }

  public load(filePath?: string): { ok: boolean; warnings?: string[]; error?: string } {
    const target = filePath ?? this.storagePath;
    if (!target) {
      return { ok: false, error: 'NO_STORAGE_PATH' };
    }
    return loadCompanyStateSync(this, target);
  }

  public setOperationsCenter(ops: CompanyOperationsCenterState): void {
    this.operationsCenter = ops;
  }

  public restoreCompanyState(company: VirtualCompany): void {
    this.state = {
      ...this.state,
      ...company,
      updatedAt: this.now()
    };
  }

  public getAgentCapacity(agentId: LaPitayaAgentId): AgentCapacity {
    return this.teamsAndCapacity.getAgentCapacity(agentId);
  }

  public getAllCapacities(): readonly AgentCapacity[] {
    return this.teamsAndCapacity.getAllCapacities();
  }

  public updateAgentCapacity(
    agentId: LaPitayaAgentId,
    update: Partial<Omit<AgentCapacity, 'agentId'>>
  ): void {
    this.teamsAndCapacity.updateAgentCapacity(agentId, update);
  }

  public assignAgent(params: AssignAgentParams): { ok: true; capacity: AgentCapacity } | { ok: false; code: string; reason: string } {
    return this.teamsAndCapacity.assignAgent(params);
  }

  public releaseAgent(agentId: LaPitayaAgentId): AgentCapacity {
    return this.teamsAndCapacity.releaseAgent(agentId);
  }

  public releaseMissionAssignments(missionId: string): readonly LaPitayaAgentId[] {
    return this.teamsAndCapacity.releaseMissionAssignments(missionId);
  }

  public getActiveTeamForProject(projectId: string): readonly LaPitayaAgentId[] {
    return this.teamsAndCapacity.getActiveTeamForProject(projectId);
  }

  public getTeams(): readonly CompanyTeam[] {
    return this.state.teams;
  }

  public getHealth(): Readonly<CompanyHealth> {
    return this.state.health;
  }

  public getMetrics(): Readonly<CompanyMetrics> {
    return this.metrics;
  }

  public getHumanAttention(): Readonly<HumanAttentionCenterState> {
    return this.state.humanAttention;
  }

  public getOperationsCenter(): Readonly<CompanyOperationsCenterState> {
    return this.operationsCenter;
  }

  public getSnapshot(): CompanyOSSnapshot {
    const legacy = this.getLegacySnapshot();
    return {
      ...legacy,
      schemaVersion: 2,
      operatingMode: this.state.operatingMode,
      portfolio: this.state.portfolio,
      workQueue: this.state.workQueue,
      teams: this.state.teams,
      capacity: this.getAllCapacities(),
      resources: this.state.resources,
      metrics: this.metrics,
      health: this.state.health,
      humanAttentionCenter: this.state.humanAttention,
      operationsCenter: this.operationsCenter,
      isPaused: this.state.isPaused
    };
  }
}
