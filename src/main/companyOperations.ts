import type { AliciaEvent } from '../shared/lapitaya/alicia/events';
import type { AliciaIntent, IntentOutcome } from '../shared/lapitaya/intent';
import type { CompanyAcceptanceCriterion, CompanyDelivery, CompanyOperationsProjection, CompanyPhase, CompanyProgress, CompanySnapshot, CompanyWorkPlan, CompanyWorkRequest } from '../shared/lapitaya/company/types';

export interface CompanyOperationsDeps {
  now?: () => number;
  project?: () => { projectId: string | null; displayName: string | null };
  snapshot: () => CompanySnapshot;
}

const expectedAgent: Partial<Record<CompanyPhase, CompanyWorkPlan['steps'][number]['expectedAgentId']>> = {
  ARCHITECT: 'valentin', BUILD: 'rosalba', TEST: 'margarito', AUDIT: 'jose-juan', LEARN: 'el-tutu'
};

const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;

export class CompanyOperationsService {
  private readonly requests = new Map<string, CompanyWorkRequest>();
  private readonly plans = new Map<string, CompanyWorkPlan>();
  private readonly deliveries = new Map<string, CompanyDelivery>();
  private readonly deps: CompanyOperationsDeps;

  constructor(deps: CompanyOperationsDeps) { this.deps = deps; }

  observeIntent(intent: AliciaIntent, outcome: IntentOutcome): void {
    if (outcome.type !== 'REQUEST' || !outcome.proposalId) return;
    const requestId = outcome.proposalId;
    const existing = this.requests.get(requestId);
    if (existing) {
      this.requests.set(requestId, { ...existing, objective: intent.message, acceptanceCriteria: existing.acceptanceCriteria.length ? existing.acceptanceCriteria : this.criteriaFrom(intent.message) });
      return;
    }
    const project = this.deps.project?.() ?? { projectId: null, displayName: null };
    this.requests.set(requestId, {
      requestId, humanId: 'human', sessionId: null, projectId: project.projectId,
      taskId: intent.context.taskId ?? null, objective: intent.message,
      constraints: [], acceptanceCriteria: this.criteriaFrom(intent.message), status: 'PROPOSED', createdAt: this.now(),
      confirmedAt: null, cancelledAt: null, proposalRef: requestId, verified: true
    });
  }

  observe(events: readonly AliciaEvent[]): void {
    for (const event of events) {
      if (event.type === 'request.proposed' && event.ref) this.ensureRequest(event.ref, event);
      if ((event.type === 'request.confirmed' || event.type === 'request.closed') && event.ref) this.applyRequestEvent(event.ref, event);
      if (event.type === 'cima.phase.assigned' || event.type === 'cima.phase.changed' || event.type === 'approval.required' || event.type === 'approval.granted' || event.type === 'approval.denied') this.refreshActiveRequest(event);
    }
  }

  projection(): CompanyOperationsProjection {
    const request = this.foregroundRequest();
    const plan = request ? this.plans.get(request.requestId) ?? null : null;
    const base = this.deps.snapshot();
    const session = base.session;
    const progress = request ? this.progress(base) : null;
    const delivery = request ? this.deliveries.get(request.requestId) ?? null : null;
    return { workRequest: request, workPlan: plan, progress, delivery, requests: [...this.requests.values()], plans: [...this.plans.values()] };
  }

  answer(question: string): { known: boolean; answer: string; facts: readonly string[]; snapshotVersion: 1 } | null {
    const q = this.normalize(question);
    const p = this.projection();
    const base = this.deps.snapshot();
    if (/que pedi|what did i ask/.test(q)) return p.workRequest ? this.makeAnswer(true, `Pediste: ${p.workRequest.objective}`, [`request:${p.workRequest.requestId}`]) : this.makeAnswer(false, 'Todavía no hay una solicitud de trabajo verificada.', []);
    if (/cual es el plan|what is the plan/.test(q)) return p.workPlan ? this.makeAnswer(true, `El plan lo coordina El Inge: ${p.workPlan.steps.map((s) => s.label).join(', ')}.`, [`plan:${p.workPlan.planId}`]) : this.makeAnswer(false, 'Todavía no hay un plan verificado.', []);
    if (/como van|how is it going|que falta|what remains|que estan haciendo|what are you doing/.test(q)) return p.progress ? this.makeAnswer(true, this.progressText(base, p.progress), [`request:${p.workRequest?.requestId ?? 'none'}`]) : this.makeAnswer(false, 'Todavía no hay progreso de un trabajo solicitado.', []);
    if (/ya terminaron|are you finished/.test(q)) return base.session?.status === 'COMPLETED' && p.delivery ? this.makeAnswer(true, 'Sí. El trabajo terminó con evidencia verificable.', [`delivery:${p.delivery.requestId}`]) : this.makeAnswer(false, 'Todavía no hay evidencia de que el trabajo haya terminado.', []);
    if (/hay algun problema|is there a problem/.test(q)) return base.status === 'FAILED' || base.status === 'BLOCKED' ? this.makeAnswer(true, 'Sí. El trabajo está bloqueado o falló según el estado verificado.', [`status:${base.status}`]) : this.makeAnswer(true, 'No hay un problema verificado en este momento.', []);
    if (/que hicieron|what did you do/.test(q)) return p.delivery ? this.makeAnswer(true, p.delivery.summary, [`delivery:${p.delivery.requestId}`]) : this.makeAnswer(false, 'Todavía no hay una entrega verificada que resumir.', []);
    return null;
  }

  private ensureRequest(id: string, event: AliciaEvent): void {
    if (this.requests.has(id)) return;
    const project = this.deps.project?.() ?? { projectId: null, displayName: null };
    this.requests.set(id, { requestId: id, humanId: 'human', sessionId: event.taskId ? `task:${event.taskId}` : null, projectId: project.projectId, taskId: event.taskId ?? null, objective: text(event.subject) ?? 'Solicitud de trabajo recibida', constraints: [], acceptanceCriteria: [], status: 'PROPOSED', createdAt: event.ts, confirmedAt: null, cancelledAt: null, proposalRef: id, verified: true });
  }

  private criteriaFrom(message: string): CompanyAcceptanceCriterion[] {
    const match = message.match(/(?:criter(?:io|ios) de aceptaci[oó]n|acceptance criteria)\s*:\s*(.+)$/i);
    if (!match) return [];
    return match[1].split(/\s*[,;]\s*/).map((value) => value.trim()).filter(Boolean).map((value) => ({ text: value, provenance: 'HUMAN' as const, verified: true as const }));
  }

  private applyRequestEvent(id: string, event: AliciaEvent): void {
    this.ensureRequest(id, event);
    const current = this.requests.get(id)!;
    if (event.type === 'request.confirmed') {
      const criteria: CompanyAcceptanceCriterion[] = current.acceptanceCriteria.length ? [...current.acceptanceCriteria] : [{ text: 'El workflow debe completar sus fases gobernadas con evidencia PASS.', provenance: 'EL_INGE_PROPOSED', verified: true }];
      this.requests.set(id, { ...current, taskId: event.taskId ?? current.taskId, sessionId: event.taskId ? `task:${event.taskId}` : current.sessionId, status: 'PLANNING', confirmedAt: event.ts, acceptanceCriteria: criteria });
      this.createPlan(this.requests.get(id)!);
    } else {
      const status = event.technical?.decision === 'CANCELLED' ? 'CANCELLED' : event.technical?.decision === 'BLOCKED' ? 'FAILED' : current.status;
      this.requests.set(id, { ...current, status, cancelledAt: status === 'CANCELLED' ? event.ts : current.cancelledAt });
    }
  }

  private refreshActiveRequest(event: AliciaEvent): void {
    const request = this.foregroundRequest();
    if (!request) return;
    const base = this.deps.snapshot();
    if (base.session?.taskId && (!request.taskId || request.taskId === base.session.taskId)) {
      const next: CompanyWorkRequest = { ...request, taskId: base.session.taskId, sessionId: base.session.sessionId, status: base.humanAttention ? 'WAITING_FOR_HUMAN' : base.status === 'COMPLETED' ? 'COMPLETED' : base.status === 'FAILED' || base.status === 'BLOCKED' ? 'FAILED' : 'ACTIVE' };
      this.requests.set(request.requestId, next);
      const plan = this.plans.get(request.requestId);
      if (plan) this.plans.set(request.requestId, { ...plan, taskId: base.session.taskId, status: next.status === 'COMPLETED' ? 'COMPLETED' : next.status === 'FAILED' ? 'FAILED' : 'ACTIVE' });
      if (next.status === 'COMPLETED' || next.status === 'FAILED') this.createDelivery(next, base);
    }
  }

  private createPlan(request: CompanyWorkRequest): void {
    if (this.plans.has(request.requestId)) return;
    const phases: CompanyPhase[] = ['CONTEXT', 'BUILD', 'TEST', 'AUDIT', 'DECISION'];
    this.plans.set(request.requestId, { planId: `plan:${request.requestId}`, requestId: request.requestId, taskId: request.taskId, objective: request.objective, steps: phases.map((phase) => ({ phase, label: phase, expectedAgentId: expectedAgent[phase] ?? null })), expectedRoles: ['El Inge', 'Builder', 'Tester', 'Auditor'], acceptanceCriteria: request.acceptanceCriteria, status: 'PLANNING', createdBy: 'el-inge', createdAt: this.now(), verified: true });
  }

  private createDelivery(request: CompanyWorkRequest, snapshot: CompanySnapshot): void {
    if (this.deliveries.has(request.requestId) || !snapshot.session) return;
    const outcome = snapshot.session.outcome ?? (snapshot.status === 'COMPLETED' ? 'PASS' : snapshot.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL');
    this.deliveries.set(request.requestId, { requestId: request.requestId, taskId: snapshot.session.taskId, outcome, summary: snapshot.session.completedPhases.map((p) => `${p} PASS`).join(', ') || `Resultado: ${outcome}`, artifacts: [], completedAt: snapshot.session.endedAt ?? this.now(), evidenceRefs: snapshot.recentVerifiedEvents.map((e) => e.id), verified: true });
  }

  private foregroundRequest(): CompanyWorkRequest | null { return [...this.requests.values()].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null; }
  private progress(snapshot: CompanySnapshot): CompanyProgress | null { const s = snapshot.session; const stage = snapshot.humanAttention ? 'WAITING_FOR_HUMAN' : snapshot.status === 'COMPLETED' ? 'COMPLETED' : snapshot.status === 'FAILED' ? 'FAILED' : snapshot.status === 'BLOCKED' ? 'BLOCKED' : snapshot.currentPhase === 'AUDIT' ? 'AUDITING' : snapshot.currentPhase === 'TEST' ? 'TESTING' : snapshot.currentPhase === 'BUILD' ? 'BUILDING' : 'PLANNING'; return { stage, completedPhases: s?.completedPhases ?? [], verified: true }; }
  private progressText(snapshot: CompanySnapshot, progress: CompanyProgress): string { return progress.stage === 'COMPLETED' ? 'El trabajo terminó.' : progress.stage === 'FAILED' || progress.stage === 'BLOCKED' ? `El trabajo está ${progress.stage === 'BLOCKED' ? 'bloqueado' : 'fallido'} según la evidencia.` : `El equipo está en ${progress.stage.toLowerCase()}. Fases completadas: ${progress.completedPhases.join(', ') || 'ninguna'}.`; }
  private makeAnswer(known: boolean, answer: string, facts: readonly string[]) { return { known, answer, facts, snapshotVersion: 1 as const }; }
  private normalize(v: string): string { return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  private now(): number { return this.deps.now?.() ?? Date.now(); }
}
