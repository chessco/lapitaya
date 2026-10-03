import type { AliciaEvent } from '../shared/lapitaya/alicia/events';
import { LA_PITAYA_AGENT_BY_ID, LA_PITAYA_AGENTS, type LaPitayaAgentId } from '../shared/lapitaya/agents';
import { cloneCompanySnapshot, asCompanyPhase, type CompanyAgentProjection, type CompanyAnswer, type CompanyAssignment, type CompanyHumanAttention, type CompanyPhase, type CompanyProjectContext, type CompanySession, type CompanySnapshot, type CompanyStatus, type CompanyTimelineEntry } from '../shared/lapitaya/company/types';

export interface CompanyAwarenessDeps {
  now?: () => number;
  resolveAgent?: (hiveAgentId: string) => LaPitayaAgentId | null;
  project?: Partial<CompanyProjectContext> | null;
  maxTimeline?: number;
  executionAwake?: () => boolean;
}

const DEFAULT_PROJECT: CompanyProjectContext = { projectId: null, displayName: null, workspace: null, repository: null, branch: null };
const EXPECTED: Partial<Record<CompanyPhase, LaPitayaAgentId>> = { ARCHITECT: 'valentin', BUILD: 'rosalba', TEST: 'margarito', AUDIT: 'jose-juan', LEARN: 'el-tutu' };
const PHASES: readonly CompanyPhase[] = ['CONTEXT', 'ARCHITECT', 'BUILD', 'TEST', 'AUDIT', 'LEARN', 'DECISION', 'ITERATE'];

const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
const phase = (v: unknown): CompanyPhase | null => asCompanyPhase(v);

export class CompanyAwarenessService {
  private readonly sessions = new Map<string, MutableSession>();
  private readonly timeline: CompanyTimelineEntry[] = [];
  private readonly passed = new Set<string>();
  private readonly seen = new Set<string>();
  private readonly deps: CompanyAwarenessDeps;
  private project: CompanyProjectContext;
  private awake = false;

  constructor(deps: CompanyAwarenessDeps = {}) {
    this.deps = deps;
    this.project = { ...DEFAULT_PROJECT, ...(deps.project ?? {}) };
  }

  setExecutionAwake(active: boolean): void { this.awake = active === true; }
  setProjectContext(project: Partial<CompanyProjectContext> | null): void { this.project = { ...DEFAULT_PROJECT, ...(project ?? {}) }; }

    observe(events: readonly AliciaEvent[] | AliciaEvent): void {
      const list = Array.isArray(events) ? events : [events];
      for (const event of list) this.observeOne(event);
  }

  observeOne(event: AliciaEvent | null | undefined): void {
    if (!event || !event.type) return;
    const key = `${event.type}|${event.ref ?? ''}|${event.taskId ?? ''}|${event.phase ?? ''}|${event.agentId ?? ''}|${event.verdict ?? ''}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value as string);

    const taskId = text(event.taskId);
    const eventPhase = phase(event.phase);
    const timestamp = Number.isFinite(event.ts) ? event.ts : this.now();
    const canonicalAgent = this.canonicalAgent(event.agentId, eventPhase);
    const fromAgent = this.canonicalAgent(event.fromAgentId, null);

    if (event.type === 'approval.required' || event.type === 'request.proposed') {
      if (!event.ref) return;
      const session = taskId ? this.ensureSession(taskId, timestamp) : this.activeMutableSession();
      const attention: CompanyHumanAttention = {
        kind: event.type === 'approval.required' ? 'HIGH' : 'REQUEST', ref: event.ref,
        taskId: taskId ?? null, agentId: canonicalAgent, reason: event.subject ?? event.technical?.reason ?? null, verified: true
      };
      if (session) session.humanAttention = attention;
      this.addTimeline(event, timestamp, canonicalAgent, `${attention.kind === 'HIGH' ? 'Se requiere aprobación humana' : 'Hay una solicitud pendiente'}${taskId ? ` para ${taskId}` : ''}`);
      return;
    }
    if (event.type === 'approval.granted' || event.type === 'approval.denied' || event.type === 'request.confirmed' || event.type === 'request.closed') {
      for (const session of this.sessions.values()) if (session.humanAttention?.ref === event.ref) session.humanAttention = null;
      this.addTimeline(event, timestamp, canonicalAgent, 'La atención humana dejó de estar pendiente');
      return;
    }
    if (!taskId && event.type !== 'agent.started' && event.type !== 'agent.completed' && event.type !== 'agent.failed') return;
    const session = taskId ? this.ensureSession(taskId, timestamp) : this.activeMutableSession();
    if (!session) return;

    if (event.type === 'cima.phase.assigned' && eventPhase && canonicalAgent) {
      if (!taskId) return;
      const noiseKey = `${taskId}:${eventPhase}:${canonicalAgent}`;
      if (this.passed.has(noiseKey)) {
        this.addTimeline(event, timestamp, canonicalAgent, `${this.name(canonicalAgent)} recibió una reasignación de liberación`, true);
        return;
      }
      session.currentPhase = eventPhase;
      if (!session.participants.includes(canonicalAgent)) session.participants.push(canonicalAgent);
      if (fromAgent && !session.participants.includes(fromAgent)) session.participants.push(fromAgent);
      if (!session.participants.includes('el-inge')) session.participants.push('el-inge');
      const existing = session.assignments.find((a) => a.phase === eventPhase && a.agentId === canonicalAgent && !a.endedAt);
      if (!existing) session.assignments.push({ id: event.ref ?? `${taskId}:${eventPhase}:${canonicalAgent}`, taskId, phase: eventPhase, agentId: canonicalAgent, fromAgentId: fromAgent, status: 'WORKING', assignedAt: timestamp, endedAt: null, ref: event.ref ?? null, verified: true });
      this.addTimeline(event, timestamp, canonicalAgent, `${this.name(canonicalAgent)} inició ${eventPhase}`);
      return;
    }
    if (event.type === 'cima.phase.changed' && eventPhase && event.verdict) {
      const target = session.assignments.filter((a) => a.phase === eventPhase && !a.endedAt && (!canonicalAgent || a.agentId === canonicalAgent));
      for (const assignment of target) {
        assignment.status = event.verdict === 'PASS' ? 'COMPLETED' : event.verdict === 'FAIL' ? 'FAILED' : 'BLOCKED';
        assignment.endedAt = timestamp;
        this.passed.add(`${taskId}:${eventPhase}:${assignment.agentId}`);
      }
      if (event.verdict === 'PASS') {
        if (!session.completedPhases.includes(eventPhase)) session.completedPhases.push(eventPhase);
        if (!this.passed.has(`${taskId}:${eventPhase}:${canonicalAgent ?? ''}`)) this.passed.add(`${taskId}:${eventPhase}:${canonicalAgent ?? ''}`);
      }
      session.currentPhase = eventPhase;
      if (eventPhase === 'DECISION') {
        session.status = event.verdict === 'PASS' ? 'COMPLETED' : event.verdict === 'BLOCKED' ? 'BLOCKED' : 'FAILED';
        session.outcome = event.verdict;
        session.endedAt = timestamp;
      } else if (event.verdict !== 'PASS') {
        session.status = event.verdict === 'BLOCKED' ? 'BLOCKED' : 'FAILED';
      }
      this.addTimeline(event, timestamp, canonicalAgent, `${eventPhase} terminó con ${event.verdict}`);
      return;
    }
    if (event.type === 'task.started' || event.type === 'agent.started') {
      if (canonicalAgent && !session.participants.includes(canonicalAgent)) session.participants.push(canonicalAgent);
      this.addTimeline(event, timestamp, canonicalAgent, canonicalAgent ? `${this.name(canonicalAgent)} inició actividad` : 'La sesión inició actividad');
    } else if (event.type === 'task.completed' || event.type === 'workflow.completed') {
      session.status = 'COMPLETED'; session.outcome = 'PASS'; session.endedAt = timestamp;
      this.addTimeline(event, timestamp, canonicalAgent, 'El workflow terminó correctamente');
    } else if (event.type === 'task.blocked' || event.type === 'agent.failed') {
      session.status = 'BLOCKED'; session.outcome = 'BLOCKED';
      this.addTimeline(event, timestamp, canonicalAgent, 'La sesión quedó bloqueada');
    }
  }

  snapshot(): CompanySnapshot {
    const session = this.activeSession();
    const assignments = session?.assignments.filter((a) => !a.endedAt) ?? [];
    const currentPhase = session?.currentPhase ?? null;
    const attention = session?.humanAttention ?? this.latestAttention();
    const expected = currentPhase && session?.status === 'ACTIVE' ? this.expectedFor(currentPhase, session) : [];
    const activeTeam = session ? [...session.participants].filter((id, i, all) => all.indexOf(id) === i) : [];
    if (session && !activeTeam.includes('alicia')) activeTeam.push('alicia');
    const agents = LA_PITAYA_AGENTS.map((agent): CompanyAgentProjection => {
      const assignment = assignments.find((a) => a.agentId === agent.id) ?? null;
      const next = expected.find((x) => x.agentId === agent.id);
      let state: CompanyAgentProjection['state'] = 'AVAILABLE';
      if (attention?.agentId === agent.id) state = 'ATTENTION';
      else if (assignment?.status === 'WORKING') state = 'WORKING';
      else if (assignment) state = 'ASSIGNED';
      else if (next) state = 'EXPECTED_NEXT';
      else if (session?.assignments.some((a) => a.agentId === agent.id && a.status === 'COMPLETED')) state = 'COMPLETED';
      return { agentId: agent.id, state, assignment, expectedPhase: next?.phase ?? null, verified: true };
    });
    const status: CompanyStatus = attention ? 'WAITING_FOR_HUMAN' : session?.status === 'COMPLETED' ? 'COMPLETED' : session?.status === 'FAILED' ? 'FAILED' : session?.status === 'BLOCKED' ? 'BLOCKED' : assignments.length ? 'WORKING' : session ? 'IDLE' : 'IDLE';
    return cloneCompanySnapshot({ version: 1, company: { id: 'lapitaya', name: 'La Pitaya' }, status, session: session ? this.exportSession(session) : null, project: session?.project ?? this.project, activeTeam, agents, currentPhase, activeAssignments: assignments, expectedNext: expected, humanAttention: attention, recentVerifiedEvents: this.timeline.slice(-20), executionAwake: this.deps.executionAwake?.() ?? this.awake });
  }

  answerQuestion(question: string): CompanyAnswer {
    const q = this.normalize(question);
    const snapshot = this.snapshot();
    const session = snapshot.session;
    const working = snapshot.agents.filter((a) => a.state === 'WORKING' || a.state === 'ASSIGNED');
    const facts: string[] = [];
    if (/en que (estan|est[aá]n) trabajando|what are you working on/.test(q)) {
      if (!session) return this.answer(false, 'Todavía no tengo un proyecto o tarea activa verificada.', []);
      const label = snapshot.project.displayName ?? session.taskId;
      return this.answer(true, `El equipo está trabajando en ${label}.`, [`task:${session.taskId}`, ...(snapshot.project.projectId ? [`project:${snapshot.project.projectId}`] : [])]);
    }
    if (/quien (esta|est[aá]) trabajando|who is working/.test(q)) {
      const names = working.map((a) => this.name(a.agentId));
      return this.answer(true, names.length ? `Ahora están trabajando: ${names.join(', ')}.` : 'No hay un agente trabajando en este momento.', names.map((n) => `agent:${n}`));
    }
    const named = [...LA_PITAYA_AGENTS].find((a) => q.includes(this.normalize(a.name)) || q.includes(a.id));
    if (named && (/que (esta|est[aá]) haciendo|what is .* doing/.test(q))) {
      const a = snapshot.agents.find((x) => x.agentId === named.id);
      if (a?.assignment) return this.answer(true, `${named.name} está trabajando en ${a.assignment.phase}.`, [`assignment:${a.assignment.id}`]);
      return this.answer(true, `${named.name} no tiene una asignación activa verificada.`, [`agent:${named.id}`]);
    }
    if (/quien sigue|who is next/.test(q)) {
      if (!snapshot.expectedNext.length) return this.answer(false, 'Todavía no hay un siguiente paso verificado.', []);
      const e = snapshot.expectedNext[0];
      return this.answer(true, `${this.name(e.agentId)} es el siguiente paso esperado para ${e.phase}; todavía no está asignado.`, [`expected:${e.agentId}:${e.phase}`]);
    }
    if (/necesitan algo de mi|do you need me/.test(q)) return snapshot.humanAttention ? this.answer(true, `Sí. Hay una decisión humana pendiente${snapshot.humanAttention.reason ? `: ${snapshot.humanAttention.reason}` : '.'}`, [`attention:${snapshot.humanAttention.ref}`]) : this.answer(true, 'No hay una decisión humana pendiente.', []);
    if (/pasaron las pruebas|did the tests pass/.test(q)) return this.phaseAnswer(snapshot, 'TEST', 'las pruebas');
    if (/paso la auditoria|did the audit pass/.test(q)) return this.phaseAnswer(snapshot, 'AUDIT', 'la auditoría');
    if (/que paso|what happened/.test(q)) return session ? this.answer(true, this.summary(session), session.completedPhases.map((p) => `phase:${p}`)) : this.answer(false, 'Todavía no hay una sesión con historial verificado.', []);
    return this.answer(false, 'No tengo ese dato verificado todavía.', []);
  }

  getSession(taskId: string): CompanySession | null { const s = this.sessions.get(taskId); return s ? this.exportSession(s) : null; }
  listSessions(): readonly CompanySession[] { return [...this.sessions.values()].map((s) => this.exportSession(s)); }

  private phaseAnswer(snapshot: CompanySnapshot, wanted: CompanyPhase, label: string): CompanyAnswer {
    const passed = snapshot.session?.completedPhases.includes(wanted) === true;
    return passed ? this.answer(true, `Sí, ${label} pasaron con evidencia PASS.`, [`phase:${wanted}:PASS`]) : this.answer(false, `Todavía no hay evidencia PASS de ${label}.`, [`phase:${wanted}:not-passed`]);
  }
  private answer(known: boolean, answer: string, facts: string[]): CompanyAnswer { return { known, answer, facts, snapshotVersion: 1 }; }
  private summary(s: Pick<CompanySession, 'status' | 'completedPhases'>): string { const done = s.completedPhases.filter((p) => p !== 'DECISION').map((p) => `${p} PASS`).join(', '); return s.status === 'COMPLETED' ? `Trabajo terminado. ${done || 'La sesión terminó.'} Resultado final: PASS.` : done ? `Hasta ahora: ${done}.` : 'La sesión está iniciando; todavía no hay un resultado final.'; }
  private expectedFor(current: CompanyPhase, s: MutableSession): { agentId: LaPitayaAgentId; phase: CompanyPhase }[] {
    // The roadmap exposes the immediate hand-off only before TEST starts; once
    // testing is assigned, the next step must wait for verified test evidence.
    if (current === 'TEST') return [];
    const index = PHASES.indexOf(current);
    const next = PHASES[index + 1];
    const agentId = next ? EXPECTED[next] : undefined;
    return next && agentId && !s.assignments.some((a) => a.phase === next && !a.endedAt) ? [{ agentId, phase: next }] : [];
  }
  private activeSession(): MutableSession | null { return [...this.sessions.values()].filter((s) => s.status === 'ACTIVE' || s.humanAttention).sort((a, b) => b.startedAt - a.startedAt)[0] ?? [...this.sessions.values()].sort((a, b) => b.startedAt - a.startedAt)[0] ?? null; }
  private activeMutableSession(): MutableSession | null { return this.activeSession(); }
  private latestAttention(): CompanyHumanAttention | null { return [...this.sessions.values()].find((s) => s.humanAttention)?.humanAttention ?? null; }
  private ensureSession(taskId: string, ts: number): MutableSession { let s = this.sessions.get(taskId); if (!s) { s = { sessionId: `task:${taskId}`, taskId, project: { ...this.project }, startedAt: ts, endedAt: null, status: 'ACTIVE', participants: [], currentPhase: null, assignments: [], humanAttention: null, outcome: null, completedPhases: [], timeline: [] }; this.sessions.set(taskId, s); } return s; }
  private exportSession(s: MutableSession): CompanySession { return JSON.parse(JSON.stringify(s)) as CompanySession; }
  private addTimeline(event: AliciaEvent, ts: number, agentId: LaPitayaAgentId | null, summary: string, lifecycleNoise = false): void { const entry: CompanyTimelineEntry = { id: `${event.ref ?? event.type}:${ts}:${this.timeline.length}`, ts, type: event.type, summary, taskId: event.taskId ?? null, phase: phase(event.phase), agentId, verified: true, ...(lifecycleNoise ? { lifecycleNoise: true } : {}) }; this.timeline.push(entry); const max = this.deps.maxTimeline ?? 100; while (this.timeline.length > max) this.timeline.shift(); const s = event.taskId ? this.sessions.get(event.taskId) : undefined; if (s) { s.timeline.push(entry); while (s.timeline.length > max) s.timeline.shift(); } }
  private canonicalAgent(raw: string | undefined, expectedPhase: CompanyPhase | null): LaPitayaAgentId | null { if (!raw) return null; if (Object.prototype.hasOwnProperty.call(LA_PITAYA_AGENT_BY_ID, raw)) return raw as LaPitayaAgentId; let id: LaPitayaAgentId | null = null; try { id = this.deps.resolveAgent?.(raw) ?? null; } catch { id = null; } if (id && (!expectedPhase || LA_PITAYA_AGENT_BY_ID[id].cimaPhases.includes(expectedPhase))) return id; return null; }
  private name(id: LaPitayaAgentId): string { return LA_PITAYA_AGENT_BY_ID[id].name; }
  private normalize(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  private now(): number { return this.deps.now?.() ?? Date.now(); }
}

interface MutableSession extends Omit<CompanySession, 'participants' | 'assignments' | 'completedPhases' | 'timeline'> {
  participants: LaPitayaAgentId[];
  assignments: CompanyAssignment[];
  completedPhases: CompanyPhase[];
  timeline: CompanyTimelineEntry[];
}
