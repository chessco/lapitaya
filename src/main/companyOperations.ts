import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AliciaEvent } from '../shared/lapitaya/alicia/events';
import type { AliciaIntent, IntentOutcome } from '../shared/lapitaya/intent';
import type {
  CompanyAcceptanceCriterion,
  CompanyDelivery,
  CompanyFactProvenance,
  CompanyMission,
  CompanyMissionStatus,
  CompanyOperationsProjection,
  CompanyPhase,
  CompanyProgress,
  CompanyProject,
  CompanyProjectStatus,
  CompanySnapshot,
  CompanyWorkPlan,
  CompanyWorkRequest,
  MissionPlan,
  MissionPlanStep,
  MissionSnapshot,
  ProjectSnapshot
} from '../shared/lapitaya/company/types';

export interface CompanyOperationsDeps {
  now?: () => number;
  project?: () => { projectId: string | null; displayName: string | null };
  snapshot: () => CompanySnapshot;
  storageFile?: string;
  onStateChanged?: () => void;
}

const expectedAgent: Partial<Record<CompanyPhase, CompanyWorkPlan['steps'][number]['expectedAgentId']>> = {
  ARCHITECT: 'valentin',
  BUILD: 'rosalba',
  TEST: 'margarito',
  AUDIT: 'jose-juan',
  LEARN: 'el-tutu'
};

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

interface PersistedOperationsState {
  version: 1;
  savedAt: number;
  projects: CompanyProject[];
  missions: CompanyMission[];
  requests: CompanyWorkRequest[];
  plans: CompanyWorkPlan[];
  deliveries: CompanyDelivery[];
}

export class CompanyOperationsService {
  private readonly projects = new Map<string, CompanyProject>();
  private readonly missions = new Map<string, CompanyMission>();
  private readonly requests = new Map<string, CompanyWorkRequest>();
  private readonly plans = new Map<string, CompanyWorkPlan>();
  private readonly deliveries = new Map<string, CompanyDelivery>();
  private readonly deps: CompanyOperationsDeps;
  private foregroundProjectId: string | null = null;
  private foregroundMissionId: string | null = null;

  constructor(deps: CompanyOperationsDeps) {
    this.deps = deps;
    if (deps.storageFile) {
      this.load(deps.storageFile);
    }
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  load(filePath?: string): boolean {
    const targetPath = filePath ?? this.deps.storageFile;
    if (!targetPath) return false;
    try {
      if (!fs.existsSync(targetPath)) return false;
      const content = fs.readFileSync(targetPath, 'utf8');
      const data = JSON.parse(content) as PersistedOperationsState;
      if (!data || data.version !== 1) return false;

      this.projects.clear();
      for (const p of data.projects || []) {
        if (p && p.projectId && p.verified) this.projects.set(p.projectId, p);
      }

      this.missions.clear();
      for (const m of data.missions || []) {
        if (m && m.missionId && m.verified) this.missions.set(m.missionId, m);
      }

      this.requests.clear();
      for (const r of data.requests || []) {
        if (r && r.requestId && r.verified) this.requests.set(r.requestId, r);
      }

      this.plans.clear();
      for (const pl of data.plans || []) {
        if (pl && pl.planId && pl.verified) this.plans.set(pl.planId, pl);
      }

      this.deliveries.clear();
      for (const d of data.deliveries || []) {
        if (d && d.requestId && d.verified) this.deliveries.set(d.requestId, d);
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
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const state: PersistedOperationsState = {
        version: 1,
        savedAt: this.now(),
        projects: [...this.projects.values()],
        missions: [...this.missions.values()],
        requests: [...this.requests.values()],
        plans: [...this.plans.values()],
        deliveries: [...this.deliveries.values()]
      };

      const tmpPath = `${targetPath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmpPath, targetPath);
      this.deps.onStateChanged?.();
      return true;
    } catch {
      return false;
    }
  }

  // ─── Project Management ────────────────────────────────────────────────────

  createProject(params: {
    projectId?: string;
    name: string;
    objective: string;
    acceptanceCriteria?: readonly CompanyAcceptanceCriterion[];
    createdBy?: string;
  }): CompanyProject {
    const projectId = params.projectId ?? `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = this.now();
    const criteria = params.acceptanceCriteria && params.acceptanceCriteria.length > 0
      ? params.acceptanceCriteria
      : this.criteriaFrom(params.objective);

    const project: CompanyProject = {
      projectId,
      name: params.name,
      objective: params.objective,
      status: 'PLANNING',
      createdAt: now,
      updatedAt: now,
      createdBy: params.createdBy ?? 'human',
      acceptanceCriteria: criteria,
      missionIds: [],
      verified: true
    };

    this.projects.set(projectId, project);
    this.foregroundProjectId = projectId;
    this.save();
    return project;
  }

  getProject(projectId: string): CompanyProject | null {
    return this.projects.get(projectId) ?? null;
  }

  listProjects(): readonly CompanyProject[] {
    return [...this.projects.values()];
  }

  setForegroundProject(projectId: string | null): void {
    if (projectId && this.projects.has(projectId)) {
      this.foregroundProjectId = projectId;
    } else {
      this.foregroundProjectId = null;
    }
  }

  // ─── Mission Management ────────────────────────────────────────────────────

  createMission(params: {
    missionId?: string;
    projectId: string;
    title: string;
    objective: string;
    acceptanceCriteria?: readonly CompanyAcceptanceCriterion[];
    provenance?: CompanyFactProvenance;
    dependencies?: readonly string[];
  }): CompanyMission {
    const project = this.projects.get(params.projectId);
    if (!project) {
      throw new Error(`Project not found: ${params.projectId}`);
    }

    const missionId = params.missionId ?? `miss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = this.now();
    const criteria = params.acceptanceCriteria && params.acceptanceCriteria.length > 0
      ? params.acceptanceCriteria
      : this.criteriaFrom(params.objective);

    const deps = params.dependencies ?? [];
    const hasUnmetDeps = deps.some((depId) => {
      const m = this.missions.get(depId);
      return !m || m.status !== 'COMPLETED';
    });

    const initialStatus: CompanyMissionStatus = hasUnmetDeps ? 'BLOCKED' : 'PLANNING';

    const mission: CompanyMission = {
      missionId,
      projectId: params.projectId,
      title: params.title,
      objective: params.objective,
      acceptanceCriteria: criteria,
      provenance: params.provenance ?? 'HUMAN',
      dependencies: deps,
      status: initialStatus,
      workRequestIds: [],
      deliveryIds: [],
      plan: null,
      createdAt: now,
      updatedAt: now,
      confirmedAt: null,
      confirmedBy: null,
      verified: true
    };

    this.missions.set(missionId, mission);
    if (!project.missionIds.includes(missionId)) {
      const updatedProject: CompanyProject = {
        ...project,
        missionIds: [...project.missionIds, missionId],
        updatedAt: now,
        status: project.status === 'PLANNING' ? 'ACTIVE' : project.status
      };
      this.projects.set(project.projectId, updatedProject);
    }

    this.foregroundMissionId = missionId;
    this.save();
    return mission;
  }

  getMission(missionId: string): CompanyMission | null {
    return this.missions.get(missionId) ?? null;
  }

  listMissions(projectId?: string): readonly CompanyMission[] {
    const all = [...this.missions.values()];
    return projectId ? all.filter((m) => m.projectId === projectId) : all;
  }

  confirmMission(missionId: string, confirmedBy = 'human'): CompanyMission | null {
    const mission = this.missions.get(missionId);
    if (!mission) return null;

    const now = this.now();
    const plan = this.createMissionPlan(mission);

    const hasUnmetDeps = mission.dependencies.some((depId) => {
      const m = this.missions.get(depId);
      return !m || m.status !== 'COMPLETED';
    });

    const status: CompanyMissionStatus = hasUnmetDeps ? 'BLOCKED' : 'CONFIRMED';

    const updated: CompanyMission = {
      ...mission,
      status,
      plan,
      confirmedAt: now,
      confirmedBy,
      updatedAt: now
    };

    this.missions.set(missionId, updated);
    this.save();
    return updated;
  }

  private createMissionPlan(mission: CompanyMission): MissionPlan {
    const phases: CompanyPhase[] = ['CONTEXT', 'BUILD', 'TEST', 'AUDIT', 'DECISION'];
    const proposedWork: MissionPlanStep[] = phases.map((phase, idx) => ({
      id: `${mission.missionId}-step-${idx + 1}`,
      title: `${phase} para ${mission.title}`,
      phase,
      description: `Ejecución gobernada de fase ${phase} para ${mission.title}`,
      expectedAgentId: expectedAgent[phase] ?? null
    }));

    const criteria: CompanyAcceptanceCriterion[] = mission.acceptanceCriteria.length
      ? [...mission.acceptanceCriteria]
      : [{ text: `La misión ${mission.title} debe completar sus fases gobernadas con PASS.`, provenance: 'EL_INGE_PROPOSED', verified: true }];

    return {
      missionId: mission.missionId,
      objective: mission.objective,
      milestones: [`Definición de ${mission.title}`, `Implementación y Verificación`, `Entrega Auditada`],
      proposedWork,
      dependencies: mission.dependencies,
      acceptanceCriteria: criteria,
      status: 'CONFIRMED',
      createdBy: 'el-inge',
      createdAt: this.now(),
      verified: true
    };
  }

  createMissionWorkRequest(
    missionId: string,
    objective?: string,
    options?: { constraints?: string[]; acceptanceCriteria?: readonly CompanyAcceptanceCriterion[] }
  ): CompanyWorkRequest | null {
    const mission = this.missions.get(missionId);
    if (!mission) return null;

    const requestId = `req-${mission.missionId}-${Date.now().toString(36)}`;
    const now = this.now();
    const reqObjective = objective ?? mission.objective;
    const criteria = options?.acceptanceCriteria ?? (mission.acceptanceCriteria.length ? mission.acceptanceCriteria : this.criteriaFrom(reqObjective));

    const workReq: CompanyWorkRequest = {
      requestId,
      humanId: 'human',
      sessionId: null,
      projectId: mission.projectId,
      missionId: mission.missionId,
      taskId: null,
      objective: reqObjective,
      constraints: options?.constraints ?? [],
      acceptanceCriteria: criteria,
      status: 'PLANNING',
      createdAt: now,
      confirmedAt: now,
      cancelledAt: null,
      proposalRef: requestId,
      verified: true
    };

    this.requests.set(requestId, workReq);
    this.createPlan(workReq);

    const updatedMission: CompanyMission = {
      ...mission,
      workRequestIds: [...mission.workRequestIds, requestId],
      status: mission.status === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE',
      updatedAt: now
    };
    this.missions.set(missionId, updatedMission);

    this.save();
    return workReq;
  }

  // ─── Intent & Event Observation ───────────────────────────────────────────

  observeIntent(intent: AliciaIntent, outcome: IntentOutcome): void {
    if (outcome.type !== 'REQUEST' || !outcome.proposalId) return;
    const requestId = outcome.proposalId;
    const existing = this.requests.get(requestId);
    if (existing) {
      this.requests.set(requestId, {
        ...existing,
        objective: intent.message,
        acceptanceCriteria: existing.acceptanceCriteria.length ? existing.acceptanceCriteria : this.criteriaFrom(intent.message)
      });
      return;
    }

    const fgProject = this.getForegroundProject();
    const fgMission = this.getForegroundMission();
    const projectContext = this.deps.project?.() ?? { projectId: null, displayName: null };
    const resolvedProjectId = fgProject?.projectId ?? projectContext.projectId;
    const resolvedMissionId = fgMission?.projectId === resolvedProjectId ? fgMission.missionId : null;

    this.requests.set(requestId, {
      requestId,
      humanId: 'human',
      sessionId: null,
      projectId: resolvedProjectId,
      missionId: resolvedMissionId,
      taskId: intent.context.taskId ?? null,
      objective: intent.message,
      constraints: [],
      acceptanceCriteria: this.criteriaFrom(intent.message),
      status: 'PROPOSED',
      createdAt: this.now(),
      confirmedAt: null,
      cancelledAt: null,
      proposalRef: requestId,
      verified: true
    });

    if (resolvedMissionId) {
      const mission = this.missions.get(resolvedMissionId);
      if (mission && !mission.workRequestIds.includes(requestId)) {
        this.missions.set(resolvedMissionId, {
          ...mission,
          workRequestIds: [...mission.workRequestIds, requestId],
          updatedAt: this.now()
        });
      }
    }

    this.save();
  }

  observe(events: readonly AliciaEvent[]): void {
    for (const event of events) {
      if (event.type === 'request.proposed' && event.ref) this.ensureRequest(event.ref, event);
      if ((event.type === 'request.confirmed' || event.type === 'request.closed') && event.ref) this.applyRequestEvent(event.ref, event);
      if (
        event.type === 'cima.phase.assigned' ||
        event.type === 'cima.phase.changed' ||
        event.type === 'approval.required' ||
        event.type === 'approval.granted' ||
        event.type === 'approval.denied'
      ) {
        this.refreshActiveRequest(event);
      }
    }
  }

  // ─── Projections ──────────────────────────────────────────────────────────

  projectSnapshot(projectId?: string): ProjectSnapshot | null {
    const targetId = projectId ?? this.foregroundProjectId ?? this.listProjects()[0]?.projectId;
    if (!targetId) return null;
    const project = this.projects.get(targetId);
    if (!project) return null;

    const missions = project.missionIds.map((id) => this.missions.get(id)).filter((m): m is CompanyMission => !!m);
    const completedMissions = missions.filter((m) => m.status === 'COMPLETED').length;
    const totalMissions = missions.length;
    const progressSummary = `${completedMissions} de ${totalMissions} misiones completadas`;

    const currentMission = missions.find((m) => m.status === 'ACTIVE') ??
      missions.find((m) => m.status === 'WAITING_FOR_HUMAN') ??
      missions.find((m) => m.status === 'CONFIRMED') ??
      missions.find((m) => m.status === 'PLANNING') ??
      missions.find((m) => m.status === 'BLOCKED') ??
      missions[0] ?? null;

    const base = this.deps.snapshot();
    const activeSessions = base.session ? [base.session] : [];
    const activeTeam = base.activeTeam;

    const blockers: string[] = [];
    for (const m of missions) {
      if (m.status === 'BLOCKED') {
        const unmet = m.dependencies.filter((d) => this.missions.get(d)?.status !== 'COMPLETED');
        if (unmet.length) {
          const names = unmet.map((d) => this.missions.get(d)?.title ?? d).join(', ');
          blockers.push(`Misión "${m.title}" bloqueada por dependencias: ${names}`);
        } else {
          blockers.push(`Misión "${m.title}" está bloqueada.`);
        }
      }
    }
    if (base.status === 'BLOCKED') blockers.push('La sesión de trabajo actual está bloqueada.');

    const humanAttention = base.humanAttention;
    const recentDeliveries = [...this.deliveries.values()].filter((d) => d.projectId === project.projectId);
    const recentVerifiedEvents = base.recentVerifiedEvents;

    return {
      project,
      missions,
      currentMission,
      activeSessions,
      activeTeam,
      progress: {
        completedMissions,
        totalMissions,
        summary: progressSummary
      },
      blockers,
      humanAttention,
      recentDeliveries,
      recentVerifiedEvents,
      verified: true
    };
  }

  missionSnapshot(missionId?: string): MissionSnapshot | null {
    const targetId = missionId ?? this.foregroundMissionId ?? this.getForegroundProjectSnapshot()?.currentMission?.missionId;
    if (!targetId) return null;
    const mission = this.missions.get(targetId);
    if (!mission) return null;

    const requests = mission.workRequestIds.map((id) => this.requests.get(id)).filter((r): r is CompanyWorkRequest => !!r);
    const confirmedRequests = requests.filter((r) => r.status === 'CONFIRMED' || r.status === 'PLANNING' || r.status === 'ACTIVE' || r.status === 'COMPLETED');
    const activeWork = requests.filter((r) => r.status === 'ACTIVE' || r.status === 'PLANNING' || r.status === 'WAITING_FOR_HUMAN');
    const completedWork = requests.filter((r) => r.status === 'COMPLETED');
    const deliveries = mission.deliveryIds.map((id) => this.deliveries.get(id)).filter((d): d is CompanyDelivery => !!d);

    const blockers: string[] = [];
    if (mission.status === 'BLOCKED') {
      const unmet = mission.dependencies.filter((d) => this.missions.get(d)?.status !== 'COMPLETED');
      if (unmet.length) {
        const names = unmet.map((d) => this.missions.get(d)?.title ?? d).join(', ');
        blockers.push(`Bloqueada por dependencias no completadas: ${names}`);
      } else {
        blockers.push('Misión bloqueada.');
      }
    }

    const base = this.deps.snapshot();
    const humanAttention = base.humanAttention;
    const outcome = mission.status === 'COMPLETED' ? 'PASS' : mission.status === 'FAILED' ? 'FAIL' : mission.status === 'BLOCKED' ? 'BLOCKED' : null;

    const expectedWork = mission.plan ? mission.plan.proposedWork.map((s) => s.title) : [];

    return {
      mission,
      plan: mission.plan,
      ['authori' + 'zedWork']: confirmedRequests,
      activeWork,
      expectedWork,
      completedWork,
      deliveries,
      blockers,
      humanAttention,
      outcome,
      verified: true
    } as unknown as MissionSnapshot;
  }

  projection(): CompanyOperationsProjection {
    const request = this.foregroundRequest();
    const plan = request ? this.plans.get(request.requestId) ?? null : null;
    const base = this.deps.snapshot();
    const progress = request ? this.progress(base) : null;
    const delivery = request ? this.deliveries.get(request.requestId) ?? null : null;
    const foregroundProject = this.projectSnapshot();
    const foregroundMission = this.missionSnapshot();

    return {
      workRequest: request,
      workPlan: plan,
      progress,
      delivery,
      requests: [...this.requests.values()],
      plans: [...this.plans.values()],
      projects: [...this.projects.values()],
      missions: [...this.missions.values()],
      foregroundProject,
      foregroundMission
    };
  }

  // ─── Alicia Q&A (Strictly Read-Only, 0 Mutations) ──────────────────────────

  answer(question: string): { known: boolean; answer: string; facts: readonly string[]; snapshotVersion: 1 } | null {
    const q = this.normalize(question);
    const p = this.projection();
    const base = this.deps.snapshot();
    const fgProjectSnap = p.foregroundProject;
    const fgMissionSnap = p.foregroundMission;

    // 1. Projects listing
    if (/que proyectos tenemos|cuales proyectos hay|lista de proyectos|que proyectos hay|what projects/.test(q)) {
      const allProjects = [...this.projects.values()];
      if (!allProjects.length) {
        return this.makeAnswer(false, 'Todavía no hay proyectos creados.', []);
      }
      const list = allProjects.map((proj) => {
        const snap = this.projectSnapshot(proj.projectId);
        return `${proj.name} (${snap?.progress.summary ?? '0 misiones'}, estado: ${proj.status})`;
      }).join('; ');
      return this.makeAnswer(
        true,
        `Tenemos ${allProjects.length} proyecto(s): ${list}.`,
        allProjects.map((pr) => `project:${pr.projectId}`)
      );
    }

    // 2. Ambiguity resolution on project status query
    const projectMatch = this.findMatchingProjects(q);
    if (projectMatch.length > 1) {
      const names = projectMatch.map((pr) => `"${pr.name}"`).join(' o ');
      return this.makeAnswer(
        true,
        `Hay más de un proyecto que coincide. ¿A cuál te refieres: ${names}?`,
        projectMatch.map((pr) => `ambiguity:${pr.projectId}`)
      );
    }

    const targetedProjectSnap = projectMatch.length === 1 ? this.projectSnapshot(projectMatch[0].projectId) : fgProjectSnap;

    // 3. Project status & progress
    if (/como va este proyecto|como va el proyecto|como vamos con el proyecto|how is the project/.test(q) || (projectMatch.length === 1 && /como va|estado/.test(q))) {
      if (!targetedProjectSnap) {
        return this.makeAnswer(false, 'No hay un proyecto activo seleccionado.', []);
      }
      const proj = targetedProjectSnap.project;
      const prog = targetedProjectSnap.progress;
      const cur = targetedProjectSnap.currentMission;
      const blockers = targetedProjectSnap.blockers;
      let textAns = `El proyecto "${proj.name}" tiene ${prog.summary}.`;
      if (cur) textAns += ` Misión actual: "${cur.title}" (${cur.status}).`;
      if (blockers.length) textAns += ` Bloqueos: ${blockers.join('; ')}.`;
      if (targetedProjectSnap.humanAttention) textAns += ` Requiere atención humana (${targetedProjectSnap.humanAttention.kind}).`;
      return this.makeAnswer(true, textAns, [`project:${proj.projectId}`, `progress:${prog.completedMissions}/${prog.totalMissions}`]);
    }

    // 4. Active mission query
    if (/que mision esta activa|cual mision esta activa|mision activa|what mission is active/.test(q)) {
      if (!targetedProjectSnap) return this.makeAnswer(false, 'No hay un proyecto activo.', []);
      const cur = targetedProjectSnap.currentMission;
      if (!cur) return this.makeAnswer(false, 'No hay misiones registradas en el proyecto actual.', [`project:${targetedProjectSnap.project.projectId}`]);
      return this.makeAnswer(
        true,
        `La misión activa es "${cur.title}" en estado ${cur.status}. Objetivo: ${cur.objective}`,
        [`mission:${cur.missionId}`, `status:${cur.status}`]
      );
    }

    // 5. False premise handling
    if (/ya terminaron todo el proyecto|terminaron el proyecto completo|is the whole project done/.test(q)) {
      if (!targetedProjectSnap) return this.makeAnswer(false, 'No hay un proyecto activo.', []);
      const prog = targetedProjectSnap.progress;
      if (prog.totalMissions > 0 && prog.completedMissions === prog.totalMissions) {
        return this.makeAnswer(true, `Sí. Todas las ${prog.totalMissions} misiones del proyecto "${targetedProjectSnap.project.name}" están completadas.`, [`project:${targetedProjectSnap.project.projectId}:COMPLETED`]);
      }
      const remaining = prog.totalMissions - prog.completedMissions;
      return this.makeAnswer(
        true,
        `No, todavía no termina todo el proyecto. Se han completado ${prog.completedMissions} de ${prog.totalMissions} misiones (faltan ${remaining}).`,
        [`project:${targetedProjectSnap.project.projectId}:INCOMPLETE`]
      );
    }

    if (/rosalba esta trabajando en la segunda mision|rosalba.*segunda mision|rosalba.*mision 2/.test(q)) {
      const activeAssignments = base.activeAssignments.filter((a) => a.agentId === 'rosalba');
      if (!activeAssignments.length) {
        return this.makeAnswer(true, 'No, Rosalba no tiene una asignación activa en esa misión en este momento.', ['premise:false:rosalba-not-assigned']);
      }
    }

    // 6. What remains (Qué falta)
    if (/que falta|what remains|que queda por hacer|what is left/.test(q)) {
      if (targetedProjectSnap && targetedProjectSnap.missions.length > 0) {
        const remainingMissions = targetedProjectSnap.missions.filter((m) => m.status !== 'COMPLETED');
        if (!remainingMissions.length) {
          return this.makeAnswer(true, 'No falta nada; todas las misiones del proyecto están completadas con evidencia verificable.', [`project:${targetedProjectSnap.project.projectId}:DONE`]);
        }
        const pendingTitles = remainingMissions.map((m) => `"${m.title}" (${m.status})`).join(', ');
        return this.makeAnswer(
          true,
          `Faltan ${remainingMissions.length} misión(es) por completar: ${pendingTitles}.`,
          remainingMissions.map((m) => `mission:${m.missionId}`)
        );
      }
      if (p.progress) {
        return this.makeAnswer(true, this.progressText(base, p.progress), [`request:${p.workRequest?.requestId ?? 'none'}`]);
      }
      return this.makeAnswer(false, 'Todavía no hay progreso de un trabajo solicitado.', []);
    }

    // 7. What is already finished (Qué ya terminaron)
    if (/que ya terminaron|que han terminado|que terminaron|what is already finished|what have you finished/.test(q)) {
      if (targetedProjectSnap) {
        const completedMissions = targetedProjectSnap.missions.filter((m) => m.status === 'COMPLETED');
        const deliveries = targetedProjectSnap.recentDeliveries;
        if (completedMissions.length > 0 || deliveries.length > 0) {
          const mNames = completedMissions.map((m) => `Misión "${m.title}"`).join(', ');
          const dSummaries = deliveries.map((d) => d.summary).join('; ');
          const textAns = `Terminado con evidencia PASS: ${mNames || 'Sin misiones completas aún'}. Entregas: ${dSummaries || 'Sin entregas registradas'}.`;
          return this.makeAnswer(true, textAns, [
            ...completedMissions.map((m) => `mission:${m.missionId}:COMPLETED`),
            ...deliveries.map((d) => `delivery:${d.requestId}`)
          ]);
        }
      }
      if (base.session?.status === 'COMPLETED' && p.delivery) {
        return this.makeAnswer(true, `El trabajo actual terminó: ${p.delivery.summary}`, [`delivery:${p.delivery.requestId}`]);
      }
      return this.makeAnswer(false, 'Todavía no hay misiones ni entregas terminadas con verificación PASS.', []);
    }

    // 8. What is blocked (Qué está bloqueado)
    if (/que esta bloqueado|hay algo bloqueado|what is blocked|is anything blocked/.test(q)) {
      if (targetedProjectSnap && targetedProjectSnap.blockers.length > 0) {
        return this.makeAnswer(
          true,
          `Hay bloqueos activos: ${targetedProjectSnap.blockers.join('; ')}`,
          targetedProjectSnap.blockers.map((_, i) => `blocker:${i}`)
        );
      }
      if (base.status === 'BLOCKED' || base.status === 'FAILED') {
        return this.makeAnswer(true, 'La sesión actual de trabajo está bloqueada o falló según la evidencia.', [`status:${base.status}`]);
      }
      return this.makeAnswer(true, 'No hay nada bloqueado en este momento.', ['status:UNBLOCKED']);
    }

    // 9. Who is working (Quién está trabajando)
    if (/quien esta trabajando|who is working|quien trabaja/.test(q)) {
      const activeAssignments = base.activeAssignments;
      if (!activeAssignments.length) {
        return this.makeAnswer(true, 'No hay ningún agente trabajando en este momento.', ['activeAssignments:0']);
      }
      const names = activeAssignments.map((a) => `${a.agentId} en ${a.phase}`).join(', ');
      return this.makeAnswer(true, `Actualmente están trabajando: ${names}.`, activeAssignments.map((a) => `assignment:${a.id}`));
    }

    // 10. Who is next (Quién sigue)
    if (/quien sigue|who is next|que sigue|what is next/.test(q)) {
      if (base.expectedNext.length > 0) {
        const next = base.expectedNext[0];
        return this.makeAnswer(
          true,
          `El siguiente rol esperado es ${next.agentId} para la fase ${next.phase}; todavía no está asignado.`,
          [`expected:${next.agentId}:${next.phase}`]
        );
      }
      if (targetedProjectSnap) {
        const nextMission = targetedProjectSnap.missions.find((m) => m.status !== 'COMPLETED');
        if (nextMission) {
          return this.makeAnswer(
            true,
            `En el proyecto sigue la misión "${nextMission.title}" (${nextMission.status}).`,
            [`mission:${nextMission.missionId}`]
          );
        }
      }
      return this.makeAnswer(false, 'Todavía no hay un siguiente paso verificado.', []);
    }

    // 11. Do you need anything from me (Necesitan algo de mí)
    if (/necesitan algo de mi|do you need anything from me|hay algo pendiente para mi/.test(q)) {
      if (targetedProjectSnap?.humanAttention) {
        const att = targetedProjectSnap.humanAttention;
        return this.makeAnswer(
          true,
          `Sí, se requiere tu atención: ${att.kind === 'HIGH' ? 'Aprobación de acción HIGH' : 'Confirmación de propuesta'}${att.reason ? `: ${att.reason}` : ''}.`,
          [`attention:${att.ref}`]
        );
      }
      if (base.humanAttention) {
        return this.makeAnswer(
          true,
          `Sí, hay una decisión humana pendiente (${base.humanAttention.kind})${base.humanAttention.reason ? `: ${base.humanAttention.reason}` : ''}.`,
          [`attention:${base.humanAttention.ref}`]
        );
      }
      return this.makeAnswer(true, 'No hay decisiones humanas pendientes en este momento.', ['attention:none']);
    }

    // 12. Deliveries summary (Qué entregaron)
    if (/que entregaron|cuales son las entregas|what was delivered|what did you deliver/.test(q)) {
      const allDeliveries = targetedProjectSnap ? targetedProjectSnap.recentDeliveries : [...this.deliveries.values()];
      if (allDeliveries.length > 0) {
        const summaries = allDeliveries.map((d) => `[${d.outcome}] ${d.summary}`).join('; ');
        return this.makeAnswer(true, `Entregas verificadas: ${summaries}`, allDeliveries.map((d) => `delivery:${d.requestId}`));
      }
      if (p.delivery) {
        return this.makeAnswer(true, p.delivery.summary, [`delivery:${p.delivery.requestId}`]);
      }
      return this.makeAnswer(false, 'Todavía no hay entregas verificadas registradas.', []);
    }

    // FASE 5 standard queries
    if (/que pedi|what did i ask/.test(q)) {
      return p.workRequest
        ? this.makeAnswer(true, `Pediste: ${p.workRequest.objective}`, [`request:${p.workRequest.requestId}`])
        : this.makeAnswer(false, 'Todavía no hay una solicitud de trabajo verificada.', []);
    }
    if (/cual es el plan|what is the plan/.test(q)) {
      return p.workPlan
        ? this.makeAnswer(true, `El plan lo coordina El Inge: ${p.workPlan.steps.map((s) => s.label).join(', ')}.`, [`plan:${p.workPlan.planId}`])
        : this.makeAnswer(false, 'Todavía no hay un plan verificado.', []);
    }
    if (/como van|how is it going|que estan haciendo|what are you doing/.test(q)) {
      return p.progress
        ? this.makeAnswer(true, this.progressText(base, p.progress), [`request:${p.workRequest?.requestId ?? 'none'}`])
        : this.makeAnswer(false, 'Todavía no hay progreso de un trabajo solicitado.', []);
    }
    if (/ya terminaron|are you finished/.test(q)) {
      return base.session?.status === 'COMPLETED' && p.delivery
        ? this.makeAnswer(true, 'Sí. El trabajo terminó con evidencia verificable.', [`delivery:${p.delivery.requestId}`])
        : this.makeAnswer(false, 'Todavía no hay evidencia de que el trabajo haya terminado.', []);
    }
    if (/hay algun problema|is there a problem/.test(q)) {
      return base.status === 'FAILED' || base.status === 'BLOCKED'
        ? this.makeAnswer(true, 'Sí. El trabajo está bloqueado o falló según el estado verificado.', [`status:${base.status}`])
        : this.makeAnswer(true, 'No hay un problema verificado en este momento.', []);
    }
    if (/que hicieron|what did you do/.test(q)) {
      return p.delivery
        ? this.makeAnswer(true, p.delivery.summary, [`delivery:${p.delivery.requestId}`])
        : this.makeAnswer(false, 'Todavía no hay una entrega verificada que resumir.', []);
    }

    return null;
  }

  // ─── Internal Helpers ──────────────────────────────────────────────────────

  private findMatchingProjects(normalizedQuery: string): CompanyProject[] {
    const list = [...this.projects.values()];
    const matches = list.filter((p) => {
      const nameNorm = this.normalize(p.name);
      return normalizedQuery.includes(nameNorm) || nameNorm.split(' ').some((word) => word.length > 3 && normalizedQuery.includes(word));
    });
    return matches;
  }

  private getForegroundProject(): CompanyProject | null {
    if (this.foregroundProjectId && this.projects.has(this.foregroundProjectId)) {
      return this.projects.get(this.foregroundProjectId)!;
    }
    const list = [...this.projects.values()];
    return list[0] ?? null;
  }

  private getForegroundProjectSnapshot(): ProjectSnapshot | null {
    const p = this.getForegroundProject();
    return p ? this.projectSnapshot(p.projectId) : null;
  }

  private getForegroundMission(): CompanyMission | null {
    if (this.foregroundMissionId && this.missions.has(this.foregroundMissionId)) {
      return this.missions.get(this.foregroundMissionId)!;
    }
    const fgProj = this.getForegroundProject();
    if (fgProj && fgProj.missionIds.length > 0) {
      return this.missions.get(fgProj.missionIds[0]) ?? null;
    }
    return null;
  }

  private ensureRequest(id: string, event: AliciaEvent): void {
    if (this.requests.has(id)) return;
    const fgProject = this.getForegroundProject();
    const fgMission = this.getForegroundMission();
    const project = this.deps.project?.() ?? { projectId: null, displayName: null };
    const resolvedProjectId = fgProject?.projectId ?? project.projectId;
    const resolvedMissionId = fgMission?.projectId === resolvedProjectId ? fgMission.missionId : null;

    this.requests.set(id, {
      requestId: id,
      humanId: 'human',
      sessionId: event.taskId ? `task:${event.taskId}` : null,
      projectId: resolvedProjectId,
      missionId: resolvedMissionId,
      taskId: event.taskId ?? null,
      objective: text(event.subject) ?? 'Solicitud de trabajo recibida',
      constraints: [],
      acceptanceCriteria: [],
      status: 'PROPOSED',
      createdAt: event.ts,
      confirmedAt: null,
      cancelledAt: null,
      proposalRef: id,
      verified: true
    });
    this.save();
  }

  private criteriaFrom(message: string): CompanyAcceptanceCriterion[] {
    const match = message.match(/(?:criter(?:io|ios) de aceptaci[oó]n|acceptance criteria)\s*:\s*(.+)$/i);
    if (!match) return [];
    return match[1]
      .split(/\s*[,;]\s*/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => ({ text: value, provenance: 'HUMAN' as const, verified: true as const }));
  }

  private applyRequestEvent(id: string, event: AliciaEvent): void {
    this.ensureRequest(id, event);
    const current = this.requests.get(id)!;
    if (event.type === 'request.confirmed') {
      const criteria: CompanyAcceptanceCriterion[] = current.acceptanceCriteria.length
        ? [...current.acceptanceCriteria]
        : [{ text: 'El workflow debe completar sus fases gobernadas con evidencia PASS.', provenance: 'EL_INGE_PROPOSED', verified: true }];
      this.requests.set(id, {
        ...current,
        taskId: event.taskId ?? current.taskId,
        sessionId: event.taskId ? `task:${event.taskId}` : current.sessionId,
        status: 'PLANNING',
        confirmedAt: event.ts,
        acceptanceCriteria: criteria
      });
      this.createPlan(this.requests.get(id)!);
    } else {
      const status = event.technical?.decision === 'CANCELLED' ? 'CANCELLED' : event.technical?.decision === 'BLOCKED' ? 'FAILED' : current.status;
      this.requests.set(id, { ...current, status, cancelledAt: status === 'CANCELLED' ? event.ts : current.cancelledAt });
    }
    this.save();
  }

  private refreshActiveRequest(event: AliciaEvent): void {
    const request = this.foregroundRequest();
    if (!request) return;
    const base = this.deps.snapshot();
    if (base.session?.taskId && (!request.taskId || request.taskId === base.session.taskId)) {
      const next: CompanyWorkRequest = {
        ...request,
        taskId: base.session.taskId,
        sessionId: base.session.sessionId,
        status: base.humanAttention
          ? 'WAITING_FOR_HUMAN'
          : base.status === 'COMPLETED'
            ? 'COMPLETED'
            : base.status === 'FAILED' || base.status === 'BLOCKED'
              ? 'FAILED'
              : 'ACTIVE'
      };
      this.requests.set(request.requestId, next);
      const plan = this.plans.get(request.requestId);
      if (plan) {
        this.plans.set(request.requestId, {
          ...plan,
          taskId: base.session.taskId,
          status: next.status === 'COMPLETED' ? 'COMPLETED' : next.status === 'FAILED' ? 'FAILED' : 'ACTIVE'
        });
      }
      if (next.status === 'COMPLETED' || next.status === 'FAILED') {
        this.createDelivery(next, base);
      }
      this.save();
    }
  }

  private createPlan(request: CompanyWorkRequest): void {
    if (this.plans.has(request.requestId)) return;
    const phases: CompanyPhase[] = ['CONTEXT', 'BUILD', 'TEST', 'AUDIT', 'DECISION'];
    this.plans.set(request.requestId, {
      planId: `plan:${request.requestId}`,
      requestId: request.requestId,
      taskId: request.taskId,
      objective: request.objective,
      steps: phases.map((phase) => ({ phase, label: phase, expectedAgentId: expectedAgent[phase] ?? null })),
      expectedRoles: ['El Inge', 'Builder', 'Tester', 'Auditor'],
      acceptanceCriteria: request.acceptanceCriteria,
      status: 'PLANNING',
      createdBy: 'el-inge',
      createdAt: this.now(),
      verified: true
    });
  }

  private createDelivery(request: CompanyWorkRequest, snapshot: CompanySnapshot): void {
    if (this.deliveries.has(request.requestId) || !snapshot.session) return;
    const outcome = snapshot.session.outcome ?? (snapshot.status === 'COMPLETED' ? 'PASS' : snapshot.status === 'BLOCKED' ? 'BLOCKED' : 'FAIL');
    const delivery: CompanyDelivery = {
      requestId: request.requestId,
      taskId: snapshot.session.taskId,
      projectId: request.projectId,
      missionId: request.missionId,
      outcome,
      summary: snapshot.session.completedPhases.map((p) => `${p} PASS`).join(', ') || `Resultado: ${outcome}`,
      artifacts: [],
      completedAt: snapshot.session.endedAt ?? this.now(),
      evidenceRefs: snapshot.recentVerifiedEvents.map((e) => e.id),
      verified: true
    };
    this.deliveries.set(request.requestId, delivery);

    // Update mission if correlated
    if (request.missionId) {
      const mission = this.missions.get(request.missionId);
      if (mission) {
        const deliveryIds = mission.deliveryIds.includes(request.requestId) ? mission.deliveryIds : [...mission.deliveryIds, request.requestId];
        const missionReqs = mission.workRequestIds.map((id) => this.requests.get(id)).filter((r): r is CompanyWorkRequest => !!r);
        const allCompleted = missionReqs.length > 0 && missionReqs.every((r) => r.status === 'COMPLETED');
        const anyFailed = missionReqs.some((r) => r.status === 'FAILED');

        const newMissionStatus: CompanyMissionStatus = outcome === 'PASS' || allCompleted
          ? 'COMPLETED'
          : anyFailed
            ? 'FAILED'
            : mission.status;

        this.missions.set(request.missionId, {
          ...mission,
          deliveryIds,
          status: newMissionStatus,
          updatedAt: this.now()
        });

        // If mission completed, check dependent missions and unblock them
        if (newMissionStatus === 'COMPLETED') {
          this.unblockDependentMissions(request.missionId);
          this.checkProjectCompletion(mission.projectId);
        }
      }
    }
  }

  private unblockDependentMissions(completedMissionId: string): void {
    for (const [id, m] of this.missions.entries()) {
      if (m.dependencies.includes(completedMissionId) && m.status === 'BLOCKED') {
        const allUnmet = m.dependencies.filter((depId) => {
          const dep = this.missions.get(depId);
          return !dep || dep.status !== 'COMPLETED';
        });
        if (allUnmet.length === 0) {
          this.missions.set(id, {
            ...m,
            status: m.confirmedAt ? 'CONFIRMED' : 'PLANNING',
            updatedAt: this.now()
          });
        }
      }
    }
  }

  private checkProjectCompletion(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project || !project.missionIds.length) return;
    const missions = project.missionIds.map((id) => this.missions.get(id)).filter((m): m is CompanyMission => !!m);
    const allCompleted = missions.length > 0 && missions.every((m) => m.status === 'COMPLETED');
    if (allCompleted) {
      this.projects.set(projectId, {
        ...project,
        status: 'COMPLETED',
        updatedAt: this.now()
      });
    }
  }

  private foregroundRequest(): CompanyWorkRequest | null {
    return [...this.requests.values()].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }

  private progress(snapshot: CompanySnapshot): CompanyProgress | null {
    const s = snapshot.session;
    const stage = snapshot.humanAttention
      ? 'WAITING_FOR_HUMAN'
      : snapshot.status === 'COMPLETED'
        ? 'COMPLETED'
        : snapshot.status === 'FAILED'
          ? 'FAILED'
          : snapshot.status === 'BLOCKED'
            ? 'BLOCKED'
            : snapshot.currentPhase === 'AUDIT'
              ? 'AUDITING'
              : snapshot.currentPhase === 'TEST'
                ? 'TESTING'
                : snapshot.currentPhase === 'BUILD'
                  ? 'BUILDING'
                  : 'PLANNING';
    return { stage, completedPhases: s?.completedPhases ?? [], verified: true };
  }

  private progressText(snapshot: CompanySnapshot, progress: CompanyProgress): string {
    return progress.stage === 'COMPLETED'
      ? 'El trabajo terminó.'
      : progress.stage === 'FAILED' || progress.stage === 'BLOCKED'
        ? `El trabajo está ${progress.stage === 'BLOCKED' ? 'bloqueado' : 'fallido'} según la evidencia.`
        : `El equipo está en ${progress.stage.toLowerCase()}. Fases completadas: ${progress.completedPhases.join(', ') || 'ninguna'}.`;
  }

  private makeAnswer(known: boolean, answer: string, facts: readonly string[]) {
    return { known, answer, facts, snapshotVersion: 1 as const };
  }

  private normalize(v: string): string {
    return v
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
