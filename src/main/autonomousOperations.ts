import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LaPitayaAgentId } from '../shared/lapitaya/agents';
import type { RiskLevel } from '../shared/lapitaya/autonomy';
import type {
  AutonomyAnswer,
  AutonomyBudget,
  AutonomyBudgetConsumption,
  AutonomyEnvelope,
  AutonomyEnvelopeStatus,
  AutonomousOperation,
  AutonomousOperationStatus,
  AutonomySnapshot,
  ContinuationDecision,
  ContinuationDecisionType,
  ContinuationReasonCode,
  EnvelopeProvenance,
  ScopeExpansionRequest
} from '../shared/lapitaya/autonomy/types';
import type { CompanyHumanAttention, CompanyPhase } from '../shared/lapitaya/company/types';
import type { OrganizationalLearningService } from './organizationalLearning';

export interface AutonomousOperationsDeps {
  now?: () => number;
  storageFile?: string;
  onStateChanged?: () => void;
  humanAttention?: () => CompanyHumanAttention | null;
  learningService?: OrganizationalLearningService | null;
}

interface PersistedAutonomyState {
  version: 1;
  savedAt: number;
  envelopes: AutonomyEnvelope[];
  operations: AutonomousOperation[];
  scopeExpansions: ScopeExpansionRequest[];
}

export function computeEnvelopeHash(envelope: Omit<AutonomyEnvelope, 'integrityHash' | 'verified'>): string {
  const payload = JSON.stringify({
    envelopeId: envelope.envelopeId,
    projectId: envelope.projectId,
    missionId: envelope.missionId,
    objective: envelope.objective,
    allowedActions: [...envelope.allowedActions].sort(),
    allowedCapabilities: [...envelope.allowedCapabilities].sort(),
    allowedSkills: [...envelope.allowedSkills].sort(),
    allowedResources: [...envelope.allowedResources].sort(),
    allowedPaths: [...envelope.allowedPaths].sort(),
    allowedProviders: [...envelope.allowedProviders].sort(),
    riskCeiling: envelope.riskCeiling,
    budget: envelope.budget,
    stopConditions: [...envelope.stopConditions].sort(),
    escalationConditions: [...envelope.escalationConditions].sort(),
    createdBy: envelope.createdBy,
    authorizedBy: envelope.authorizedBy,
    createdAt: envelope.createdAt,
    authorizedAt: envelope.authorizedAt,
    expiresAt: envelope.expiresAt
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export class AutonomousOperationsService {
  private readonly envelopes = new Map<string, AutonomyEnvelope>();
  private readonly operations = new Map<string, AutonomousOperation>();
  private readonly scopeExpansions = new Map<string, ScopeExpansionRequest>();
  private readonly deps: AutonomousOperationsDeps;
  private learningService: OrganizationalLearningService | null = null;
  private awake = false;

  constructor(deps: AutonomousOperationsDeps = {}) {
    this.deps = deps;
    this.learningService = deps.learningService ?? null;
    if (deps.storageFile) {
      this.load(deps.storageFile);
    }
  }

  setLearningService(service: OrganizationalLearningService | null): void {
    this.learningService = service;
  }

  setExecutionAwake(active: boolean): void {
    this.awake = active === true;
  }

  // ─── Persistence & Restart Recovery ────────────────────────────────────────

  load(filePath?: string): boolean {
    const targetPath = filePath ?? this.deps.storageFile;
    if (!targetPath) return false;
    try {
      if (!fs.existsSync(targetPath)) return false;
      const content = fs.readFileSync(targetPath, 'utf8');
      const data = JSON.parse(content) as PersistedAutonomyState;
      if (!data || data.version !== 1) return false;

      this.envelopes.clear();
      for (const env of data.envelopes || []) {
        if (env && env.envelopeId && env.verified) {
          // Verify envelope integrity hash - fail closed if tampered
          const calculated = computeEnvelopeHash(env);
          if (calculated === env.integrityHash) {
            const isExpired = env.expiresAt && env.expiresAt <= this.now();
            const status = isExpired ? 'EXPIRED' : env.status;
            this.envelopes.set(env.envelopeId, {
              ...env,
              status
            });
          }
        }
      }

      this.operations.clear();
      for (const op of data.operations || []) {
        if (op && op.operationId && op.verified) {
          this.operations.set(op.operationId, op);
        }
      }

      this.scopeExpansions.clear();
      for (const exp of data.scopeExpansions || []) {
        if (exp && exp.requestId && exp.verified) {
          this.scopeExpansions.set(exp.requestId, exp);
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  save(filePath?: string): boolean {
    const targetPath = filePath ?? this.deps.storageFile;
    if (!targetPath) return false;
    try {
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: PersistedAutonomyState = {
        version: 1,
        savedAt: this.now(),
        envelopes: [...this.envelopes.values()],
        operations: [...this.operations.values()],
        scopeExpansions: [...this.scopeExpansions.values()]
      };
      const tmpPath = `${targetPath}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, targetPath);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Autonomy Envelope Management ─────────────────────────────────────────

  createEnvelope(params: {
    envelopeId?: string;
    projectId: string;
    missionId: string;
    objective: string;
    allowedActions?: readonly string[];
    allowedCapabilities?: readonly string[];
    allowedSkills?: readonly string[];
    allowedResources?: readonly string[];
    allowedPaths?: readonly string[];
    allowedProviders?: readonly string[];
    riskCeiling?: RiskLevel;
    budget: AutonomyBudget;
    stopConditions?: readonly string[];
    escalationConditions?: readonly string[];
    createdBy?: EnvelopeProvenance;
    provenance?: EnvelopeProvenance;
    authorizedBy?: string | null;
    expiresAt?: number | null;
    evidenceRefs?: readonly string[];
  }): AutonomyEnvelope | null {
    const createdBy = params.createdBy ?? params.provenance ?? 'HUMAN';
    // Envelope must originate from legitimate authority
    if (createdBy !== 'HUMAN' && createdBy !== 'CIMA_POLICY_DERIVED' && createdBy !== 'RUNTIME_DERIVED_FROM_HUMAN_SCOPE') {
      return null;
    }

    const envelopeId = params.envelopeId ?? `env-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = this.now();
    const isAuthorized = createdBy === 'HUMAN' || Boolean(params.authorizedBy);

    const skillsConstrained = params.allowedSkills !== undefined;
    const baseData = {
      envelopeId,
      projectId: params.projectId,
      missionId: params.missionId,
      objective: params.objective,
      allowedActions: params.allowedActions ?? ['read-code', 'analysis', 'run-tests', 'lint', 'documentation'],
      allowedCapabilities: params.allowedCapabilities ?? ['read', 'test', 'lint'],
      allowedSkills: params.allowedSkills ?? [],
      allowedResources: params.allowedResources ?? [],
      allowedPaths: params.allowedPaths ?? [],
      allowedProviders: params.allowedProviders ?? [],
      riskCeiling: params.riskCeiling ?? 'LOW',
      budget: {
        maxIterations: Math.max(1, params.budget.maxIterations ?? 5),
        maxRetries: Math.max(0, params.budget.maxRetries ?? 2),
        maxDurationMs: params.budget.maxDurationMs ?? null,
        maxTokens: params.budget.maxTokens ?? null,
        maxCostUsd: params.budget.maxCostUsd ?? null
      },
      stopConditions: params.stopConditions ?? ['mission-completed', 'budget-exhausted', 'high-risk-encountered'],
      escalationConditions: params.escalationConditions ?? ['scope-expansion', 'high-risk-action', 'audit-failure'],
      createdBy,
      authorizedBy: params.authorizedBy ?? (createdBy === 'HUMAN' ? 'human' : null),
      createdAt: now,
      authorizedAt: isAuthorized ? now : null,
      expiresAt: params.expiresAt ?? null,
      status: (isAuthorized ? 'ACTIVE' : 'PENDING_AUTHORIZATION') as AutonomyEnvelopeStatus,
      skillsConstrained,
      evidenceRefs: params.evidenceRefs ?? []
    };

    const integrityHash = computeEnvelopeHash(baseData);
    const envelope: AutonomyEnvelope = {
      ...baseData,
      integrityHash,
      verified: true
    };

    this.envelopes.set(envelopeId, envelope);
    this.save();
    this.deps.onStateChanged?.();
    return envelope;
  }

  getEnvelope(envelopeId: string): AutonomyEnvelope | null {
    return this.envelopes.get(envelopeId) ?? null;
  }

  listEnvelopes(projectId?: string): readonly AutonomyEnvelope[] {
    const list = [...this.envelopes.values()];
    return projectId ? list.filter((e) => e.projectId === projectId) : list;
  }

  authorizeEnvelope(envelopeId: string, authorizedBy: string): AutonomyEnvelope | null {
    const env = this.envelopes.get(envelopeId);
    if (!env) return null;
    if (env.status !== 'PENDING_AUTHORIZATION' && env.status !== 'DRAFT') return env;

    const now = this.now();
    const updatedBase = {
      ...env,
      authorizedBy,
      authorizedAt: now,
      status: 'ACTIVE' as AutonomyEnvelopeStatus
    };
    const integrityHash = computeEnvelopeHash(updatedBase);
    const updated: AutonomyEnvelope = {
      ...updatedBase,
      integrityHash,
      verified: true
    };

    this.envelopes.set(envelopeId, updated);
    this.save();
    this.deps.onStateChanged?.();
    return updated;
  }

  narrowEnvelope(envelopeId: string, narrowing: {
    removeCapabilities?: readonly string[];
    removeSkills?: readonly string[];
    removePaths?: readonly string[];
    allowedCapabilities?: readonly string[];
    allowedSkills?: readonly string[];
    allowedPaths?: readonly string[];
    riskCeiling?: RiskLevel;
    maxIterations?: number;
    maxRetries?: number;
    reduceIterations?: number;
    reduceRetries?: number;
  }): AutonomyEnvelope | null {
    const env = this.envelopes.get(envelopeId);
    if (!env || env.status !== 'ACTIVE') return null;

    let allowedCapabilities = [...env.allowedCapabilities];
    if (narrowing.allowedCapabilities !== undefined) {
      allowedCapabilities = allowedCapabilities.filter((c) => narrowing.allowedCapabilities!.includes(c));
    }
    if (narrowing.removeCapabilities) {
      allowedCapabilities = allowedCapabilities.filter((c) => !narrowing.removeCapabilities!.includes(c));
    }

    let allowedSkills = [...env.allowedSkills];
    if (narrowing.allowedSkills !== undefined) {
      allowedSkills = allowedSkills.filter((s) => narrowing.allowedSkills!.includes(s));
    }
    if (narrowing.removeSkills) {
      allowedSkills = allowedSkills.filter((s) => !narrowing.removeSkills!.includes(s));
    }

    let allowedPaths = [...env.allowedPaths];
    if (narrowing.allowedPaths !== undefined) {
      allowedPaths = allowedPaths.filter((p) => narrowing.allowedPaths!.includes(p));
    }
    if (narrowing.removePaths) {
      allowedPaths = allowedPaths.filter((p) => !narrowing.removePaths!.includes(p));
    }

    let maxIterations = env.budget.maxIterations;
    const targetIterations = narrowing.maxIterations ?? narrowing.reduceIterations;
    if (targetIterations !== undefined && targetIterations < maxIterations) {
      maxIterations = Math.max(1, targetIterations);
    }

    let maxRetries = env.budget.maxRetries;
    const targetRetries = narrowing.maxRetries ?? narrowing.reduceRetries;
    if (targetRetries !== undefined && targetRetries < maxRetries) {
      maxRetries = Math.max(0, targetRetries);
    }

    let riskCeiling = env.riskCeiling;
    if (narrowing.riskCeiling === 'LOW' && (env.riskCeiling === 'MEDIUM' || env.riskCeiling === 'HIGH')) {
      riskCeiling = 'LOW';
    } else if (narrowing.riskCeiling === 'MEDIUM' && env.riskCeiling === 'HIGH') {
      riskCeiling = 'MEDIUM';
    }

    const skillsConstrained = env.skillsConstrained || narrowing.allowedSkills !== undefined || narrowing.removeSkills !== undefined;

    const updatedBase = {
      ...env,
      allowedCapabilities,
      allowedSkills,
      allowedPaths,
      riskCeiling,
      skillsConstrained,
      budget: {
        ...env.budget,
        maxIterations,
        maxRetries
      }
    };

    const integrityHash = computeEnvelopeHash(updatedBase);
    const updated: AutonomyEnvelope = {
      ...updatedBase,
      integrityHash,
      verified: true
    };

    this.envelopes.set(envelopeId, updated);
    this.save();
    this.deps.onStateChanged?.();
    return updated;
  }

  // ─── Autonomous Operation Management ──────────────────────────────────────

  startOperation(params: {
    operationId?: string;
    envelopeId: string;
    projectId: string;
    missionId: string;
    pinnedSkills?: Record<string, string>;
  }): AutonomousOperation | null {
    const env = this.envelopes.get(params.envelopeId);
    if (!env) return null;

    // Verify envelope validity & integrity
    if (env.status !== 'ACTIVE') return null;
    if (env.expiresAt && env.expiresAt <= this.now()) {
      env.status = 'EXPIRED';
      this.save();
      return null;
    }
    if (computeEnvelopeHash(env) !== env.integrityHash) {
      env.status = 'FAILED';
      this.save();
      return null;
    }

    const operationId = params.operationId ?? `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = this.now();

    // Verify pinned skills are ACTIVE and allowed by envelope
    const pinnedSkills: Record<string, string> = {};
    if (params.pinnedSkills) {
      for (const [skillId, version] of Object.entries(params.pinnedSkills)) {
        if (env.allowedSkills.length > 0 && !env.allowedSkills.includes(skillId)) {
          return null; // Skill not allowed by envelope
        }
        if (this.learningService) {
          const skill = this.learningService.getAdoptedSkill(skillId);
          if (!skill || skill.status !== 'ACTIVE' || skill.version !== version) {
            return null; // Must be active exact version
          }
        }
        pinnedSkills[skillId] = version;
      }
    }

    const operation: AutonomousOperation = {
      operationId,
      envelopeId: params.envelopeId,
      projectId: params.projectId,
      missionId: params.missionId,
      currentIteration: 1,
      currentStep: 0,
      status: 'ACTIVE',
      startedAt: now,
      lastProgressAt: now,
      consumption: {
        iterationsUsed: 1,
        retriesUsed: 0,
        elapsedMs: 0,
        tokensUsed: 0,
        costUsd: 0
      },
      pinnedSkills,
      activeWorkRequestId: null,
      activeTaskId: null,
      activeAssignmentAgentId: null,
      pendingDecision: null,
      humanAttention: null,
      lastContinuationDecision: null,
      stopReason: null,
      evidenceRefs: [...env.evidenceRefs],
      history: [],
      verified: true
    };

    this.operations.set(operationId, operation);
    this.save();
    this.deps.onStateChanged?.();
    return operation;
  }

  getOperation(operationId: string): AutonomousOperation | null {
    return this.operations.get(operationId) ?? null;
  }

  listOperations(projectId?: string): readonly AutonomousOperation[] {
    const list = [...this.operations.values()];
    return projectId ? list.filter((o) => o.projectId === projectId) : list;
  }

  consumeIteration(operationId: string): boolean {
    const op = this.operations.get(operationId);
    if (!op) return false;
    const env = this.envelopes.get(op.envelopeId);
    if (!env) return false;
    if (op.consumption.iterationsUsed >= env.budget.maxIterations) return false;
    op.consumption.iterationsUsed += 1;
    op.currentIteration += 1;
    op.lastProgressAt = this.now();
    this.save();
    this.deps.onStateChanged?.();
    return true;
  }

  consumeRetry(operationId: string): boolean {
    const op = this.operations.get(operationId);
    if (!op) return false;
    const env = this.envelopes.get(op.envelopeId);
    if (!env) return false;
    if (op.consumption.retriesUsed >= env.budget.maxRetries) return false;
    op.consumption.retriesUsed += 1;
    op.lastProgressAt = this.now();
    this.save();
    this.deps.onStateChanged?.();
    return true;
  }

  recordWorkRequest(operationId: string, workRequestId: string, taskId: string, agentId: LaPitayaAgentId): void {
    const op = this.operations.get(operationId);
    if (!op) return;
    op.activeWorkRequestId = workRequestId;
    op.activeTaskId = taskId;
    op.activeAssignmentAgentId = agentId;
    op.lastProgressAt = this.now();
    this.save();
    this.deps.onStateChanged?.();
  }

  checkWatchdog(operationId?: string): AutonomousOperation[] {
    const now = this.now();
    const ops = operationId ? [this.operations.get(operationId)].filter(Boolean) as AutonomousOperation[] : [...this.operations.values()];
    const stalled: AutonomousOperation[] = [];
    for (const op of ops) {
      if (op.status === 'ACTIVE' && now - op.lastProgressAt > 300_000) {
        op.status = 'PAUSED';
        op.stopReason = 'Watchdog: Sin progreso verificado en el periodo permitido.';
        stalled.push(op);
      }
    }
    if (stalled.length > 0) {
      this.save();
      this.deps.onStateChanged?.();
    }
    return stalled;
  }

  getOperationHistory(operationId: string): readonly ContinuationDecision[] {
    const op = this.operations.get(operationId);
    return op ? op.history : [];
  }

  recordDecision(op: AutonomousOperation, decision: ContinuationDecision): void {
    op.lastContinuationDecision = decision;
    const history = [...op.history, decision];
    if (history.length > 50) history.shift();
    (op as { history: readonly ContinuationDecision[] }).history = history;
    this.save();
    this.deps.onStateChanged?.();
  }

  // ─── Continuation Decision Engine ──────────────────────────────────────────

  evaluateContinuation(operationId: string, context: {
    lastOutcome?: 'PASS' | 'FAIL' | 'BLOCKED' | 'CANCELLED';
    phase?: CompanyPhase;
    risk?: RiskLevel;
    requiredCapabilities?: readonly string[];
    requiredSkillId?: string;
    requiredSkillVersion?: string;
    requiredPaths?: readonly string[];
    cimaAuthorized?: boolean;
    isMissionComplete?: boolean;
    evidenceRef?: string;
    progressObserved?: boolean;
  }): ContinuationDecision {
    const now = this.now();
    const op = this.operations.get(operationId);
    if (!op) {
      return {
        decision: 'STOP_FAILURE',
        reasonCode: 'GOVERNANCE_UNCERTAIN',
        explanation: 'Operación autónoma no encontrada en registro de operaciones.',
        evidenceRefs: [],
        timestamp: now,
        verified: true
      };
    }

    const env = this.envelopes.get(op.envelopeId);
    if (!env) {
      op.status = 'FAILED';
      op.stopReason = 'Envelope no encontrado.';
      this.save();
      return {
        decision: 'STOP_FAILURE',
        reasonCode: 'GOVERNANCE_UNCERTAIN',
        explanation: 'AutonomyEnvelope no encontrado para esta operación.',
        evidenceRefs: [],
        timestamp: now,
        verified: true
      };
    }

    // 1. Check Envelope Integrity
    if (computeEnvelopeHash(env) !== env.integrityHash) {
      env.status = 'FAILED';
      op.status = 'FAILED';
      op.stopReason = 'Envelope tampered or corrupted.';
      this.save();
      return {
        decision: 'STOP_FAILURE',
        reasonCode: 'GOVERNANCE_UNCERTAIN',
        explanation: 'Fallo de integridad criptográfica en AutonomyEnvelope.',
        evidenceRefs: [],
        timestamp: now,
        verified: true
      };
    }

    // 2. Check Expiration
    if (env.expiresAt && env.expiresAt <= now) {
      env.status = 'EXPIRED';
      op.status = 'EXHAUSTED';
      op.stopReason = 'Envelope expirado.';
      this.save();
      return {
        decision: 'STOP_FAILURE',
        reasonCode: 'ENVELOPE_EXPIRED',
        explanation: 'El AutonomyEnvelope ha expirado según su límite temporal.',
        evidenceRefs: [],
        timestamp: now,
        verified: true
      };
    }

    // 3. Check Envelope Status
    if (env.status === 'CANCELLED' || op.status === 'CANCELLED') {
      op.status = 'CANCELLED';
      op.stopReason = 'Operación o envelope cancelado por el operador.';
      this.save();
      return {
        decision: 'STOP_FAILURE',
        reasonCode: 'ENVELOPE_CANCELLED',
        explanation: 'La operación autónoma fue cancelada explícitamente.',
        evidenceRefs: [],
        timestamp: now,
        verified: true
      };
    }

    if (env.status === 'PAUSED' || op.status === 'PAUSED') {
      return {
        decision: 'PAUSE',
        reasonCode: 'ENVELOPE_PAUSED',
        explanation: 'La operación autónoma se encuentra en estado de pausa gobernada.',
        evidenceRefs: [],
        timestamp: now,
        verified: true
      };
    }

    // 3.5 Check Budget Exhaustion
    if (op.status === 'EXHAUSTED' || op.consumption.iterationsUsed >= env.budget.maxIterations) {
      op.status = 'EXHAUSTED';
      op.stopReason = `Presupuesto de iteraciones agotado (${op.consumption.iterationsUsed}/${env.budget.maxIterations}).`;
      this.save();
      return {
        decision: 'STOP_FAILURE',
        reasonCode: 'ITERATION_EXHAUSTED',
        explanation: `Presupuesto de iteraciones agotado (${op.consumption.iterationsUsed}/${env.budget.maxIterations}). No se autoriza nueva ejecución sin decisión humana.`,
        evidenceRefs: [],
        timestamp: now,
        verified: true
      };
    }

    // 4. Check Mission Completion
    if (context.isMissionComplete === true || context.lastOutcome === 'PASS' && context.phase === 'AUDIT') {
      op.status = 'COMPLETED';
      op.stopReason = 'Misión completada con éxito y auditoría PASS.';
      this.save();
      const decision: ContinuationDecision = {
        decision: 'STOP_SUCCESS',
        reasonCode: 'MISSION_COMPLETE',
        explanation: 'Misión y criterios de aceptación completados con éxito verificado.',
        evidenceRefs: context.evidenceRef ? [context.evidenceRef] : [],
        timestamp: now,
        verified: true
      };
      this.recordDecision(op, decision);
      return decision;
    }

    // 5. Check Human Attention Pending
    if (op.humanAttention || op.pendingDecision) {
      op.status = 'WAITING_HUMAN';
      const decision: ContinuationDecision = {
        decision: 'PAUSE',
        reasonCode: 'HUMAN_REQUIRED',
        explanation: 'Se requiere una decisión o atención humana pendiente antes de continuar.',
        evidenceRefs: [],
        timestamp: now,
        verified: true
      };
      this.recordDecision(op, decision);
      return decision;
    }

    // 6. Check CIMA Denial
    if (context.cimaAuthorized === false) {
      op.status = 'PAUSED';
      op.stopReason = 'CIMA denegó la autorización de ejecución.';
      const decision: ContinuationDecision = {
        decision: 'PAUSE',
        reasonCode: 'CIMA_DENIED',
        explanation: 'La compuerta de gobernanza CIMA denegó la siguiente unidad de trabajo.',
        evidenceRefs: context.evidenceRef ? [context.evidenceRef] : [],
        timestamp: now,
        verified: true
      };
      this.recordDecision(op, decision);
      return decision;
    }

    // 7. Check High Risk Escalation
    if (context.risk === 'HIGH' || env.riskCeiling === 'LOW' && context.risk === 'MEDIUM') {
      op.status = 'WAITING_HUMAN';
      op.humanAttention = {
        kind: 'HIGH',
        ref: `high-risk-${now}`,
        taskId: op.activeTaskId,
        agentId: op.activeAssignmentAgentId,
        reason: `Acción con nivel de riesgo ${context.risk} excede el techo permitido (${env.riskCeiling}).`,
        verified: true
      };
      this.save();
      const decision: ContinuationDecision = {
        decision: 'ESCALATE',
        reasonCode: 'RISK_EXCEEDED',
        explanation: `El nivel de riesgo ${context.risk} supera el techo autorizado (${env.riskCeiling}). Requiere aprobación humana.`,
        evidenceRefs: context.evidenceRef ? [context.evidenceRef] : [],
        timestamp: now,
        verified: true
      };
      this.recordDecision(op, decision);
      return decision;
    }

    // 8. Check Required Capabilities & Paths
    if (context.requiredCapabilities && context.requiredCapabilities.length > 0) {
      const forbidden = context.requiredCapabilities.filter((c) => !env.allowedCapabilities.includes(c));
      if (forbidden.length > 0) {
        return this.triggerScopeExpansion(op, env, `Capacidades requeridas no autorizadas: ${forbidden.join(', ')}`);
      }
    }

    if (context.requiredPaths && context.requiredPaths.length > 0) {
      const forbiddenPaths = context.requiredPaths.filter((p) => env.allowedPaths.length > 0 && !env.allowedPaths.some((ap) => p.startsWith(ap)));
      if (forbiddenPaths.length > 0) {
        return this.triggerScopeExpansion(op, env, `Rutas de archivo fuera del scope autorizado: ${forbiddenPaths.join(', ')}`);
      }
    }

    // 9. Check Skill Permission & Version Pinning
    if (context.requiredSkillId) {
      if ((env.skillsConstrained || env.allowedSkills.length > 0) && !env.allowedSkills.includes(context.requiredSkillId)) {
        return this.triggerScopeExpansion(op, env, `Skill requerida no permitida por envelope: ${context.requiredSkillId}`);
      }
      const pinned = op.pinnedSkills[context.requiredSkillId];
      if (pinned && context.requiredSkillVersion && pinned !== context.requiredSkillVersion) {
        op.status = 'PAUSED';
        const decision: ContinuationDecision = {
          decision: 'PAUSE',
          reasonCode: 'GOVERNANCE_UNCERTAIN',
          explanation: `La versión de Skill requerida (${context.requiredSkillVersion}) no coincide con la versión fijada (${pinned}).`,
          evidenceRefs: [],
          timestamp: now,
          verified: true
        };
        this.recordDecision(op, decision);
        return decision;
      }
    }

    // 10. Check Outcome: Failure Handling (TEST vs AUDIT vs Other)
    if (context.lastOutcome === 'FAIL') {
      if ((context as any).isRetryable === false || (context as any).duplicateSideEffectRisk === true) {
        op.status = 'PAUSED';
        op.stopReason = 'Fallo no reintentable o riesgo de efectos secundarios duplicados.';
        const decision: ContinuationDecision = {
          decision: 'PAUSE',
          reasonCode: 'NON_RETRYABLE_FAILURE',
          explanation: 'El fallo no es reintentable de forma segura o presenta riesgo de efectos secundarios duplicados.',
          evidenceRefs: context.evidenceRef ? [context.evidenceRef] : [],
          timestamp: now,
          verified: true
        };
        this.recordDecision(op, decision);
        return decision;
      }

      if (context.phase === 'AUDIT') {
        // Invariant: AUDIT failure cannot be retried until PASS without remediation
        op.status = 'PAUSED';
        op.stopReason = 'Auditoría fallida. Se requiere remediación gobernada, no reintentos ciegos.';
        const decision: ContinuationDecision = {
          decision: 'PAUSE',
          reasonCode: 'NON_RETRYABLE_FAILURE',
          explanation: 'Auditoría fallida. No se permite reintentar la auditoría sin una iteración de remediación gobernada.',
          evidenceRefs: context.evidenceRef ? [context.evidenceRef] : [],
          timestamp: now,
          verified: true
        };
        this.recordDecision(op, decision);
        return decision;
      }

      if (context.phase === 'TEST') {
        // Remediation iteration allowed if iteration budget remains
        if (op.consumption.iterationsUsed < env.budget.maxIterations) {
          op.consumption.iterationsUsed += 1;
          op.currentIteration += 1;
          op.lastProgressAt = now;
          this.save();
          const decision: ContinuationDecision = {
            decision: 'CONTINUE',
            reasonCode: 'RETRYABLE_FAILURE',
            explanation: `Pruebas fallidas. Iniciando iteración de remediación ${op.currentIteration}/${env.budget.maxIterations}.`,
            nextPhase: 'BUILD',
            suggestedWorkObjective: 'Corregir fallos de prueba detectados en la iteración previa.',
            evidenceRefs: context.evidenceRef ? [context.evidenceRef] : [],
            timestamp: now,
            verified: true
          };
          this.recordDecision(op, decision);
          return decision;
        } else {
          op.status = 'EXHAUSTED';
          op.stopReason = `Presupuesto de iteraciones agotado (${op.consumption.iterationsUsed}/${env.budget.maxIterations}).`;
          this.save();
          const decision: ContinuationDecision = {
            decision: 'STOP_FAILURE',
            reasonCode: 'ITERATION_EXHAUSTED',
            explanation: `Presupuesto de iteraciones agotado tras fallo en pruebas (${op.consumption.iterationsUsed}/${env.budget.maxIterations}).`,
            evidenceRefs: context.evidenceRef ? [context.evidenceRef] : [],
            timestamp: now,
            verified: true
          };
          this.recordDecision(op, decision);
          return decision;
        }
      }

      // General retryable failure
      if (op.consumption.retriesUsed < env.budget.maxRetries) {
        op.consumption.retriesUsed += 1;
        op.lastProgressAt = now;
        this.save();
        const decision: ContinuationDecision = {
          decision: 'RETRY',
          reasonCode: 'RETRYABLE_FAILURE',
          explanation: `Reintento ${op.consumption.retriesUsed}/${env.budget.maxRetries} autorizado dentro del presupuesto.`,
          evidenceRefs: context.evidenceRef ? [context.evidenceRef] : [],
          timestamp: now,
          verified: true
        };
        this.recordDecision(op, decision);
        return decision;
      } else {
        op.status = 'EXHAUSTED';
        op.stopReason = `Presupuesto de reintentos agotado (${op.consumption.retriesUsed}/${env.budget.maxRetries}).`;
        this.save();
        const decision: ContinuationDecision = {
          decision: 'STOP_FAILURE',
          reasonCode: 'RETRY_EXHAUSTED',
          explanation: `Presupuesto de reintentos agotado (${op.consumption.retriesUsed}/${env.budget.maxRetries}).`,
          evidenceRefs: context.evidenceRef ? [context.evidenceRef] : [],
          timestamp: now,
          verified: true
        };
        this.recordDecision(op, decision);
        return decision;
      }
    }

    // 11. Normal Step Continuation
    op.currentStep += 1;
    if (context.progressObserved !== false) {
      op.lastProgressAt = now;
    }
    this.save();

    let nextPhase: CompanyPhase = 'BUILD';
    if (context.phase === 'BUILD' && context.lastOutcome === 'PASS') nextPhase = 'TEST';
    else if (context.phase === 'TEST' && context.lastOutcome === 'PASS') nextPhase = 'AUDIT';

    const decision: ContinuationDecision = {
      decision: 'CONTINUE',
      reasonCode: 'WITHIN_SCOPE',
      explanation: `Continuación gobernada autorizada para fase ${nextPhase} dentro del envelope.`,
      nextPhase,
      evidenceRefs: context.evidenceRef ? [context.evidenceRef] : [],
      timestamp: now,
      verified: true
    };
    this.recordDecision(op, decision);
    return decision;
  }

  private triggerScopeExpansion(op: AutonomousOperation, env: AutonomyEnvelope, reason: string): ContinuationDecision {
    const now = this.now();
    const requestId = `exp-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const expansionReq: ScopeExpansionRequest = {
      requestId,
      envelopeId: env.envelopeId,
      operationId: op.operationId,
      requestedBy: 'el-inge',
      reason,
      status: 'PENDING',
      createdAt: now,
      evidenceRefs: [],
      verified: true
    };

    this.scopeExpansions.set(requestId, expansionReq);
    op.status = 'WAITING_HUMAN';
    op.pendingDecision = expansionReq;
    op.humanAttention = {
      kind: 'REQUEST',
      ref: requestId,
      taskId: op.activeTaskId,
      agentId: 'el-inge',
      reason: `Ampliación de scope requerida: ${reason}`,
      verified: true
    };
    this.save();

    const decision: ContinuationDecision = {
      decision: 'PAUSE',
      reasonCode: 'SCOPE_EXPANSION_REQUIRED',
      explanation: `Se detectó la necesidad de ampliar el scope: ${reason}. Operación pausada en espera de autorización humana.`,
      evidenceRefs: [],
      timestamp: now,
      verified: true
    };
    this.recordDecision(op, decision);
    return decision;
  }

  // ─── Governance & Human Control ───────────────────────────────────────────

  pauseOperation(operationId: string, reason = 'Pausa solicitada por el operador.'): boolean {
    const op = this.operations.get(operationId);
    if (!op) return false;
    if (op.status === 'COMPLETED' || op.status === 'CANCELLED') return false;

    op.status = 'PAUSED';
    op.stopReason = reason;
    this.save();
    this.deps.onStateChanged?.();
    return true;
  }

  resumeOperation(operationId: string): boolean {
    const op = this.operations.get(operationId);
    if (!op) return false;
    if (op.status !== 'PAUSED' && op.status !== 'WAITING_HUMAN') return false;

    const env = this.envelopes.get(op.envelopeId);
    if (!env || env.status !== 'ACTIVE') return false;
    if (env.expiresAt && env.expiresAt <= this.now()) return false;
    if (computeEnvelopeHash(env) !== env.integrityHash) return false;

    // Clear pending human attention if resumed explicitly
    op.status = 'ACTIVE';
    op.stopReason = null;
    op.humanAttention = null;
    op.pendingDecision = null;
    this.save();
    this.deps.onStateChanged?.();
    return true;
  }

  cancelOperation(operationId: string, reason = 'Cancelado por el operador.'): boolean {
    const op = this.operations.get(operationId);
    if (!op) return false;

    op.status = 'CANCELLED';
    op.stopReason = reason;
    op.humanAttention = null;
    op.pendingDecision = null;
    this.save();
    this.deps.onStateChanged?.();
    return true;
  }

  // ─── Projections & Alicia Awareness ───────────────────────────────────────

  snapshot(): AutonomySnapshot {
    const operations = [...this.operations.values()];
    const activeOperations = operations.filter((o) => o.status === 'ACTIVE');
    const activeOp = operations.find((o) => o.status === 'ACTIVE' || o.status === 'WAITING_HUMAN' || o.status === 'PAUSED') ?? null;
    const activeEnv = activeOp ? this.envelopes.get(activeOp.envelopeId) ?? null : null;
    const pendingExp = [...this.scopeExpansions.values()].filter((e) => e.status === 'PENDING');

    return {
      envelopes: [...this.envelopes.values()],
      operations,
      activeOperations,
      activeOperationsCount: activeOperations.length,
      activeOperation: activeOp,
      activeEnvelope: activeEnv,
      pendingScopeExpansions: pendingExp,
      humanAttention: activeOp?.humanAttention ?? null,
      executionAwake: this.awake,
      verified: true
    };
  }

  askAlicia(query: string): AutonomyAnswer {
    const q = this.normalize(query);
    const snap = this.snapshot();
    const op = snap.activeOperation;
    const env = snap.activeEnvelope;

    // False Premise Refutations
    if (/puede hacer lo que (quiera|necesite)|unlimited autonomy|modo autonomo sin limites/.test(q)) {
      return this.answer(
        true,
        'Premisa falsa refutada: La autonomía de La Pitaya está estrictamente acotada (AUTONOMÍA ACOTADA) por un AutonomyEnvelope y la gobernanza CIMA. No tiene autoridad ilimitada ni puede auto-aprobarse permisos.',
        ['invariant:AUTONOMY_IS_BOUNDED']
      );
    }

    if (/si no respondo.*contin[uú]e|timeout.*aprobacion|no response.*approval/.test(q)) {
      return this.answer(
        true,
        'Premisa falsa refutada: NO_RESPONSE != APPROVAL. La ausencia de respuesta o el tiempo de espera nunca se interpreta como aprobación. Si se requiere decisión humana, el trabajo se pausa.',
        ['invariant:NO_HUMAN_RESPONSE_IS_NOT_APPROVAL']
      );
    }

    if (/el inge puede aumentar su propio l[ií]mite|self expand envelope/.test(q)) {
      return this.answer(
        true,
        'Premisa falsa refutada: Ningún agente puede ampliar su propio límite ni su presupuesto. Toda ampliación de scope requiere autorización humana o de gobernanza.',
        ['invariant:ENVELOPE_IMMUTABLE_FOR_AGENTS']
      );
    }

    if (/como la skill est[aá] aprobada puede usarla donde quiera|skill anywhere/.test(q)) {
      return this.answer(
        true,
        'Premisa falsa refutada: Una Skill aprobada solo puede usarse si está explícitamente permitida y acotada en el AutonomyEnvelope y autorizada por CIMA para esa tarea específica.',
        ['invariant:SKILL_ALLOWED_BY_ENVELOPE_ONLY']
      );
    }

    if (/si reinicio.*reinician los intentos|restart resets budget/.test(q)) {
      return this.answer(
        true,
        'Premisa falsa refutada: Reiniciar la aplicación no reinicia los intentos ni el presupuesto consumido; el estado de la operación es persistente.',
        ['invariant:RESTART_PRESERVES_BUDGETS']
      );
    }

    // Operational Questions
    if (/que (esta|est[aá]) haciendo la empresa|what is the company doing/.test(q)) {
      if (!op) return this.answer(true, 'No hay ninguna operación autónoma activa en este momento.', []);
      return this.answer(
        true,
        `La empresa está ejecutando la misión ${op.missionId} en modo autónomo acotado (iteración ${op.currentIteration}, estado: ${op.status}).`,
        [`operation:${op.operationId}`, `status:${op.status}`]
      );
    }

    if (/que (esta|est[aá]) haciendo el inge|what is el inge doing/.test(q)) {
      if (!op) return this.answer(true, 'El Inge no tiene una operación autónoma activa que coordinar.', []);
      const phase = op.lastContinuationDecision?.nextPhase ?? 'planificación';
      return this.answer(
        true,
        `El Inge está coordinando la operación autónoma para la fase ${phase} dentro del envelope ${op.envelopeId}.`,
        [`agent:el-inge`, `envelope:${op.envelopeId}`]
      );
    }

    if (/en que iteracion van|what iteration/.test(q)) {
      if (!op || !env) return this.answer(true, 'No hay una operación con iteraciones en curso.', []);
      return this.answer(
        true,
        `Vamos en la iteración ${op.currentIteration} de un máximo de ${env.budget.maxIterations} autorizadas.`,
        [`iteration:${op.currentIteration}/${env.budget.maxIterations}`]
      );
    }

    if (/cuantos intentos quedan|how many retries/.test(q)) {
      if (!op || !env) return this.answer(true, 'No hay intentos activos registrados.', []);
      const remainingRetries = Math.max(0, env.budget.maxRetries - op.consumption.retriesUsed);
      const remainingIterations = Math.max(0, env.budget.maxIterations - op.consumption.iterationsUsed);
      return this.answer(
        true,
        `Quedan reintentos restantes: ${remainingRetries} y ${remainingIterations} iteraciones disponibles.`,
        [`retries:${remainingRetries}`, `iterations:${remainingIterations}`]
      );
    }

    if (/por que se detuvieron|why did they stop/.test(q)) {
      if (!op) return this.answer(true, 'No hay ninguna operación detenida.', []);
      const reason = op.stopReason ?? op.lastContinuationDecision?.explanation ?? 'Operación en espera de siguiente paso.';
      return this.answer(
        true,
        `Se detuvieron por: ${reason}`,
        [`reason:${op.lastContinuationDecision?.reasonCode ?? 'UNKNOWN'}`]
      );
    }

    if (/que necesitan de mi|necesitan algo de mi|what do you need from me/.test(q)) {
      if (snap.humanAttention) {
        return this.answer(
          true,
          `Sí, hay una atención humana requerida: ${snap.humanAttention.reason ?? 'Decisión de gobernanza pendiente.'}`,
          [`attention:${snap.humanAttention.ref}`]
        );
      }
      return this.answer(true, 'No hay ninguna decisión humana pendiente en este momento.', []);
    }

    if (/que pueden hacer sin preguntarme|what can they do without asking/.test(q)) {
      if (!env) return this.answer(true, 'Sin un AutonomyEnvelope activo, no pueden ejecutar acciones sin supervisión.', []);
      const allAllowed = [...env.allowedActions, ...env.allowedCapabilities].filter(Boolean);
      const items = allAllowed.join(', ');
      return this.answer(
        true,
        `Dentro del envelope pueden ejecutar acciones LOW (${items}) hasta ${env.budget.maxIterations} iteraciones con techo de riesgo ${env.riskCeiling}.`,
        [`riskCeiling:${env.riskCeiling}`, ...allAllowed.map((a) => `allowed:${a}`)]
      );
    }

    if (/que no pueden hacer|what can they not do/.test(q)) {
      return this.answer(
        true,
        'No pueden ejecutar acciones HIGH sin aprobación humana, no pueden auto-otorgarse permisos, no pueden modificar producción fuera del scope, no pueden aumentar sus presupuestos ni saltarse la gobernanza CIMA.',
        ['invariant:BOUNDED_AUTONOMY_LIMITS']
      );
    }

    if (/que skill estan usando|what skill are they using/.test(q)) {
      if (!op || Object.keys(op.pinnedSkills).length === 0) {
        return this.answer(true, 'No hay ninguna Skill fijada para la operación actual.', []);
      }
      const skills = Object.entries(op.pinnedSkills).map(([id, ver]) => `${id} (v${ver})`).join(', ');
      return this.answer(true, `Están utilizando las Skills fijadas: ${skills}.`, Object.keys(op.pinnedSkills).map((s) => `skill:${s}`));
    }

    if (/cuanto falta|how much left|eta/.test(q)) {
      if (!op || !env) return this.answer(true, 'No se inventan estimaciones de tiempo porque no hay una operación activa.', []);
      const remainingIter = Math.max(0, env.budget.maxIterations - op.consumption.iterationsUsed);
      return this.answer(
        true,
        `No se inventan estimaciones de tiempo arbitrarias. Quedan ${remainingIter} iteraciones presupuestadas y ${op.currentStep} pasos ejecutados hasta ahora.`,
        [`remainingIterations:${remainingIter}`]
      );
    }

    return this.answer(false, 'No tengo ese dato de autonomía verificado todavía.', []);
  }

  private answer(known: boolean, answer: string, facts: string[]): AutonomyAnswer {
    return { known, answer, facts, snapshotVersion: 1 };
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
