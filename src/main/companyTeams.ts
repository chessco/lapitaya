import type { LaPitayaAgentId } from '../shared/lapitaya/agents';
import { LA_PITAYA_AGENT_IDS } from '../shared/lapitaya/agents';
import type { CompanyPhase } from '../shared/lapitaya/company/types';
import type {
  CapacityState,
  AgentCapacity,
  AgentAssignmentRef,
  CompanyTeam,
  AgentOrganizationalProfile
} from '../shared/lapitaya/company/osTypes';
import {
  CANONICAL_COMPANY_TEAMS,
  CANONICAL_AGENT_PROFILES
} from './virtualCompanyOS';

export interface AssignAgentParams {
  agentId: LaPitayaAgentId;
  projectId: string;
  missionId: string;
  phase: CompanyPhase;
}

export interface AssignmentValidationResult {
  allowed: boolean;
  code?: string;
  reason?: string;
}

export class TeamsAndCapacityManager {
  private readonly teams: Map<string, CompanyTeam> = new Map();
  private readonly profiles: Map<LaPitayaAgentId, AgentOrganizationalProfile> = new Map();
  private readonly capacities: Map<LaPitayaAgentId, AgentCapacity> = new Map();
  private readonly assignmentHistory: Array<{
    agentId: LaPitayaAgentId;
    projectId: string;
    missionId: string;
    phase: CompanyPhase;
    startedAt: number;
    endedAt: number | null;
  }> = [];

  constructor(private readonly now: () => number = () => Date.now()) {
    for (const team of CANONICAL_COMPANY_TEAMS) {
      this.teams.set(team.teamId, { ...team });
    }
    for (const profile of CANONICAL_AGENT_PROFILES) {
      this.profiles.set(profile.agentId, { ...profile });
    }
    for (const agentId of LA_PITAYA_AGENT_IDS) {
      this.capacities.set(agentId, {
        agentId,
        state: agentId === 'alicia' ? 'IDLE' : 'AVAILABLE',
        currentAssignment: null,
        concurrencyLimit: 1,
        utilizationRate: 0.0
      });
    }
  }

  public getTeams(): readonly CompanyTeam[] {
    return Array.from(this.teams.values());
  }

  public getTeam(teamId: string): CompanyTeam | undefined {
    return this.teams.get(teamId);
  }

  public getAgentProfile(agentId: LaPitayaAgentId): AgentOrganizationalProfile | undefined {
    return this.profiles.get(agentId);
  }

  public getAgentCapacity(agentId: LaPitayaAgentId): AgentCapacity {
    const cap = this.capacities.get(agentId);
    if (!cap) {
      return {
        agentId,
        state: 'OFFLINE',
        currentAssignment: null,
        concurrencyLimit: 1,
        utilizationRate: 0.0
      };
    }
    return { ...cap };
  }

  public getAllCapacities(): readonly AgentCapacity[] {
    return Array.from(this.capacities.values());
  }

  public updateAgentCapacity(
    agentId: LaPitayaAgentId,
    update: Partial<Omit<AgentCapacity, 'agentId'>>
  ): void {
    const current = this.capacities.get(agentId);
    if (!current) return;
    this.capacities.set(agentId, {
      ...current,
      ...update
    });
  }

  public validateAssignment(params: AssignAgentParams): AssignmentValidationResult {
    const { agentId, phase } = params;

    // 1. Check Alicia boundary: Alicia is companion, not an execution worker
    if (agentId === 'alicia') {
      return {
        allowed: false,
        code: 'ALICIA_EXECUTION_PROHIBITED',
        reason: 'Alicia is the human-facing AI companion and cannot be assigned to CIMA execution phases'
      };
    }

    const profile = this.profiles.get(agentId);
    if (!profile) {
      return {
        allowed: false,
        code: 'UNKNOWN_AGENT',
        reason: `Agent ${agentId} is not a canonical registered agent`
      };
    }

    // 2. Role-Phase compatibility
    if (phase === 'AUDIT' && profile.cimaRole !== 'Auditor') {
      return {
        allowed: false,
        code: 'AUDITOR_ROLE_REQUIRED',
        reason: `Phase AUDIT requires an Auditor role (Builder != Auditor rule). Agent ${agentId} is ${profile.cimaRole}`
      };
    }

    if (profile.cimaRole === 'Auditor' && phase !== 'AUDIT') {
      return {
        allowed: false,
        code: 'AUDITOR_CANNOT_BUILD',
        reason: `Auditor agent ${agentId} cannot be assigned to phase ${phase} (Builder != Auditor rule)`
      };
    }

    // 3. Capacity & concurrency limit check
    const capacity = this.capacities.get(agentId);
    if (!capacity) {
      return {
        allowed: false,
        code: 'CAPACITY_NOT_FOUND',
        reason: `Capacity state for agent ${agentId} not found`
      };
    }

    if (capacity.state === 'EXECUTING' || capacity.state === 'ASSIGNED') {
      return {
        allowed: false,
        code: 'CONCURRENCY_LIMIT_EXCEEDED',
        reason: `Agent ${agentId} is currently ${capacity.state} on ${capacity.currentAssignment?.projectId}/${capacity.currentAssignment?.missionId}`
      };
    }

    if (capacity.state === 'OFFLINE' || capacity.state === 'BLOCKED') {
      return {
        allowed: false,
        code: 'AGENT_UNAVAILABLE',
        reason: `Agent ${agentId} is in ${capacity.state} state`
      };
    }

    return { allowed: true };
  }

  public assignAgent(params: AssignAgentParams): { ok: true; capacity: AgentCapacity } | { ok: false; code: string; reason: string } {
    const validation = this.validateAssignment(params);
    if (!validation.allowed) {
      return {
        ok: false,
        code: validation.code ?? 'ASSIGNMENT_DENIED',
        reason: validation.reason ?? 'Assignment validation failed'
      };
    }

    const assignment: AgentAssignmentRef = {
      projectId: params.projectId,
      missionId: params.missionId,
      phase: params.phase,
      startedAt: this.now()
    };

    const current = this.capacities.get(params.agentId)!;
    const updated: AgentCapacity = {
      ...current,
      state: 'ASSIGNED',
      currentAssignment: assignment
    };
    this.capacities.set(params.agentId, updated);

    this.assignmentHistory.push({
      agentId: params.agentId,
      projectId: params.projectId,
      missionId: params.missionId,
      phase: params.phase,
      startedAt: assignment.startedAt,
      endedAt: null
    });

    return { ok: true, capacity: updated };
  }

  public setAgentExecuting(agentId: LaPitayaAgentId): boolean {
    const current = this.capacities.get(agentId);
    if (!current || !current.currentAssignment) return false;
    this.capacities.set(agentId, {
      ...current,
      state: 'EXECUTING'
    });
    return true;
  }

  public releaseAgent(agentId: LaPitayaAgentId): AgentCapacity {
    const current = this.capacities.get(agentId);
    if (!current) {
      return {
        agentId,
        state: 'AVAILABLE',
        currentAssignment: null,
        concurrencyLimit: 1,
        utilizationRate: 0.0
      };
    }

    // Close in assignment history
    for (let i = this.assignmentHistory.length - 1; i >= 0; i--) {
      const h = this.assignmentHistory[i];
      if (h.agentId === agentId && h.endedAt === null) {
        h.endedAt = this.now();
        break;
      }
    }

    const updated: AgentCapacity = {
      ...current,
      state: agentId === 'alicia' ? 'IDLE' : 'AVAILABLE',
      currentAssignment: null
    };
    this.capacities.set(agentId, updated);
    return updated;
  }

  public releaseMissionAssignments(missionId: string): readonly LaPitayaAgentId[] {
    const released: LaPitayaAgentId[] = [];
    for (const [agentId, cap] of this.capacities.entries()) {
      if (cap.currentAssignment?.missionId === missionId) {
        this.releaseAgent(agentId);
        released.push(agentId);
      }
    }
    return released;
  }

  public getActiveTeamForProject(projectId: string): readonly LaPitayaAgentId[] {
    const activeAgents = new Set<LaPitayaAgentId>();
    for (const cap of this.capacities.values()) {
      if (cap.currentAssignment?.projectId === projectId && (cap.state === 'ASSIGNED' || cap.state === 'EXECUTING')) {
        activeAgents.add(cap.agentId);
      }
    }
    return Array.from(activeAgents);
  }

  public calculateUtilizationRates(windowMs = 3600000): Record<LaPitayaAgentId, number> {
    const now = this.now();
    const windowStart = now - windowMs;
    const rates: Partial<Record<LaPitayaAgentId, number>> = {};

    for (const agentId of LA_PITAYA_AGENT_IDS) {
      if (agentId === 'alicia') {
        rates[agentId] = 0.0;
        continue;
      }

      let busyMs = 0;
      for (const h of this.assignmentHistory) {
        if (h.agentId === agentId) {
          const start = Math.max(h.startedAt, windowStart);
          const end = h.endedAt ? Math.min(h.endedAt, now) : now;
          if (end > start) {
            busyMs += (end - start);
          }
        }
      }

      const rate = Math.min(1.0, Math.round((busyMs / windowMs) * 100) / 100);
      rates[agentId] = rate;

      const current = this.capacities.get(agentId);
      if (current) {
        this.capacities.set(agentId, {
          ...current,
          utilizationRate: rate
        });
      }
    }

    return rates as Record<LaPitayaAgentId, number>;
  }
}
