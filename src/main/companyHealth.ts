import type { LaPitayaAgentId } from '../shared/lapitaya/agents';
import { LA_PITAYA_AGENT_IDS } from '../shared/lapitaya/agents';
import type {
  CompanyProject,
  CompanyMission,
  CompanyDelivery
} from '../shared/lapitaya/company/types';
import type {
  CompanyMetrics,
  CompanyHealth,
  HealthStatus,
  HumanAttentionItem,
  OperationDetail,
  AgentCapacity
} from '../shared/lapitaya/company/osTypes';

export interface MetricsCalculationInput {
  projects: readonly CompanyProject[];
  missions: readonly CompanyMission[];
  deliveries: readonly CompanyDelivery[];
  activeOperations?: readonly OperationDetail[];
  capacities?: readonly AgentCapacity[];
  adoptedSkillsCount?: number;
}

export interface HealthCalculationInput {
  metrics: CompanyMetrics;
  humanAttentionItems: readonly HumanAttentionItem[];
  activeOperations?: readonly OperationDetail[];
  isCompanyPaused?: boolean;
}

export function calculateCompanyMetrics(input: MetricsCalculationInput): CompanyMetrics {
  const activeProjects = input.projects.filter((p) => p.status === 'ACTIVE').length;
  const activeMissions = input.missions.filter((m) => m.status === 'ACTIVE' || m.status === 'CONFIRMED').length;
  const runningOperations = (input.activeOperations ?? []).filter((op) => op.status === 'RUNNING').length;
  const completedDeliveries = input.deliveries.length;

  // Pass rate
  const passDeliveries = input.deliveries.filter((d) => d.outcome === 'PASS').length;
  const overallPassRate = completedDeliveries > 0 ? passDeliveries / completedDeliveries : 1.0;

  // Audit failure rate
  const failedDeliveries = input.deliveries.filter((d) => d.outcome === 'FAIL').length;
  const auditFailureRate = completedDeliveries > 0 ? failedDeliveries / completedDeliveries : 0.0;

  // Calculate average cycle time
  let totalCycleTimeMs = 0;
  let cycleCount = 0;
  for (const del of input.deliveries) {
    if (del.missionId) {
      const mission = input.missions.find((m) => m.missionId === del.missionId);
      if (mission && del.completedAt > mission.createdAt) {
        totalCycleTimeMs += (del.completedAt - mission.createdAt);
        cycleCount++;
      }
    }
  }
  const averageCycleTimeMs = cycleCount > 0 ? Math.round(totalCycleTimeMs / cycleCount) : 0;

  // Agent utilization
  const agentUtil: Record<LaPitayaAgentId, number> = {} as Record<LaPitayaAgentId, number>;
  for (const agentId of LA_PITAYA_AGENT_IDS) {
    const cap = (input.capacities ?? []).find((c) => c.agentId === agentId);
    agentUtil[agentId] = cap?.utilizationRate ?? (cap?.state === 'EXECUTING' ? 1.0 : 0.0);
  }

  return {
    activeProjects,
    activeMissions,
    runningOperations,
    completedDeliveries,
    overallPassRate: Math.round(overallPassRate * 100) / 100,
    auditFailureRate: Math.round(auditFailureRate * 100) / 100,
    retryRate: 0.0,
    humanInterventionRate: 0.0,
    autonomyUtilization: runningOperations > 0 ? 1.0 : 0.0,
    averageCycleTimeMs,
    adoptedSkillsInUse: input.adoptedSkillsCount ?? 0,
    agentUtilization: agentUtil
  };
}

export function calculateCompanyHealth(
  input: HealthCalculationInput,
  now: () => number = () => Date.now()
): CompanyHealth {
  const reasonCodes: string[] = [];
  const evidenceRefs: string[] = [];
  let score = 100;

  const criticalAttention = input.humanAttentionItems.filter((i) => i.severity === 'CRITICAL');
  const highAttention = input.humanAttentionItems.filter((i) => i.severity === 'HIGH');
  const normalAttention = input.humanAttentionItems.filter((i) => i.severity === 'NORMAL');

  // Check for governance violations
  const governanceViolations = criticalAttention.filter((i) => i.reason === 'GOVERNANCE_VIOLATION');
  if (governanceViolations.length > 0) {
    score = Math.min(score, 20);
    reasonCodes.push('GOVERNANCE_VIOLATION_DETECTED');
    evidenceRefs.push(...governanceViolations.map((g) => g.id));
  }

  // Check for budget exhaustion
  const budgetExhaustions = criticalAttention.filter((i) => i.reason === 'BUDGET_EXHAUSTED');
  if (budgetExhaustions.length > 0) {
    score = Math.min(score, 30);
    reasonCodes.push('BUDGET_EXHAUSTION_BLOCKED');
    evidenceRefs.push(...budgetExhaustions.map((b) => b.id));
  }

  // Check for blocked missions or high-risk approvals
  if (highAttention.length > 0) {
    score = Math.min(score, 45);
    reasonCodes.push(`HUMAN_ATTENTION_PENDING:${highAttention.length}`);
    evidenceRefs.push(...highAttention.map((h) => h.id));
  }

  // Check if company is paused
  if (input.isCompanyPaused) {
    score = Math.min(score, 60);
    reasonCodes.push('COMPANY_PAUSED_BY_HUMAN');
  }

  // Check pass rate and audit failure rate
  if (input.metrics.auditFailureRate > 0.2) {
    score = Math.min(score, 50);
    reasonCodes.push(`HIGH_AUDIT_FAILURE_RATE:${input.metrics.auditFailureRate}`);
  } else if (input.metrics.auditFailureRate > 0) {
    score = Math.min(score, 75);
    reasonCodes.push(`AUDIT_FAILURES_OBSERVED:${input.metrics.auditFailureRate}`);
  }

  if (normalAttention.length > 0 && score === 100) {
    score = 85;
    reasonCodes.push(`INFORMATIONAL_ITEMS_PENDING:${normalAttention.length}`);
  }

  if (reasonCodes.length === 0) {
    reasonCodes.push('ALL_SYSTEMS_OPERATIONAL');
  }

  let status: HealthStatus = 'HEALTHY';
  if (score >= 90) {
    status = 'HEALTHY';
  } else if (score >= 70) {
    status = 'ATTENTION';
  } else if (score >= 50) {
    status = 'DEGRADED';
  } else if (score >= 30) {
    status = 'BLOCKED';
  } else {
    status = 'CRITICAL';
  }

  return {
    status,
    score,
    reasonCodes,
    evidenceRefs,
    lastCalculatedAt: now()
  };
}
