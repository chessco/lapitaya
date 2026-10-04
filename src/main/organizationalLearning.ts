import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LaPitayaAgentId } from '../shared/lapitaya/agents';
import type { CompanyHumanAttention, CompanyPhase } from '../shared/lapitaya/company/types';
import type {
  AdoptedSkill,
  ExperienceOutcome,
  ExperienceSourceType,
  LearningCandidate,
  LearningConfidence,
  LearningScope,
  LearningSnapshot,
  LearningStatus,
  OrganizationalKnowledge,
  SkillExecutionTrace,
  SkillProposal,
  SkillProposalStatus,
  SkillRiskClass,
  VerifiedExperience
} from '../shared/lapitaya/learning/types';

export interface OrganizationalLearningDeps {
  now?: () => number;
  storageFile?: string;
  onStateChanged?: () => void;
  humanAttention?: () => CompanyHumanAttention | null;
}

interface PersistedLearningState {
  version: 1;
  savedAt: number;
  experiences: VerifiedExperience[];
  candidates: LearningCandidate[];
  proposals: SkillProposal[];
  adoptedSkills: AdoptedSkill[];
  executionTraces: SkillExecutionTrace[];
}

export class OrganizationalLearningService {
  private readonly experiences = new Map<string, VerifiedExperience>();
  private readonly candidates = new Map<string, LearningCandidate>();
  private readonly proposals = new Map<string, SkillProposal>();
  private readonly adoptedSkills = new Map<string, AdoptedSkill>();
  private readonly executionTraces: SkillExecutionTrace[] = [];
  private readonly deps: OrganizationalLearningDeps;
  private lastAnalysisAt: number | null = null;

  constructor(deps: OrganizationalLearningDeps = {}) {
    this.deps = deps;
    if (deps.storageFile) {
      this.load(deps.storageFile);
    }
  }

  // ─── Persistence & Restart Recovery ────────────────────────────────────────

  load(filePath?: string): boolean {
    const targetPath = filePath ?? this.deps.storageFile;
    if (!targetPath) return false;
    try {
      if (!fs.existsSync(targetPath)) return false;
      const content = fs.readFileSync(targetPath, 'utf8');
      const data = JSON.parse(content) as PersistedLearningState;
      if (!data || data.version !== 1) return false;

      this.experiences.clear();
      for (const e of data.experiences || []) {
        if (e && e.experienceId && e.verified) this.experiences.set(e.experienceId, e);
      }

      this.candidates.clear();
      for (const c of data.candidates || []) {
        if (c && c.candidateId && c.verified) this.candidates.set(c.candidateId, c);
      }

      this.proposals.clear();
      for (const p of data.proposals || []) {
        if (p && p.proposalId && p.verified) this.proposals.set(p.proposalId, p);
      }

      this.adoptedSkills.clear();
      for (const s of data.adoptedSkills || []) {
        if (s && s.skillId && s.verified) this.adoptedSkills.set(s.skillId, s);
      }

      this.executionTraces.length = 0;
      for (const t of data.executionTraces || []) {
        if (t && t.traceId && t.verified) this.executionTraces.push(t);
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

      const state: PersistedLearningState = {
        version: 1,
        savedAt: this.now(),
        experiences: [...this.experiences.values()],
        candidates: [...this.candidates.values()],
        proposals: [...this.proposals.values()],
        adoptedSkills: [...this.adoptedSkills.values()],
        executionTraces: [...this.executionTraces]
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

  // ─── Verified Experience ───────────────────────────────────────────────────

  recordExperience(params: {
    experienceId?: string;
    sourceType: ExperienceSourceType;
    projectId?: string | null;
    missionId?: string | null;
    requestId?: string | null;
    taskId?: string | null;
    sessionId?: string | null;
    phase?: CompanyPhase | null;
    agentId?: LaPitayaAgentId | null;
    outcome: ExperienceOutcome;
    summary: string;
    evidenceRefs: readonly string[];
  }): VerifiedExperience | null {
    if (!params.evidenceRefs || params.evidenceRefs.length === 0) {
      return null;
    }
    const experienceId = params.experienceId ?? `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const experience: VerifiedExperience = {
      experienceId,
      sourceType: params.sourceType,
      projectId: params.projectId ?? null,
      missionId: params.missionId ?? null,
      requestId: params.requestId ?? null,
      taskId: params.taskId ?? null,
      sessionId: params.sessionId ?? null,
      phase: params.phase ?? null,
      agentId: params.agentId ?? null,
      outcome: params.outcome,
      summary: params.summary,
      evidenceRefs: [...params.evidenceRefs],
      occurredAt: this.now(),
      verified: true
    };
    this.experiences.set(experienceId, experience);
    this.save();
    return experience;
  }

  listExperiences(): readonly VerifiedExperience[] {
    return [...this.experiences.values()];
  }

  // ─── Learning Candidates (El Tutú) ─────────────────────────────────────────

  analyzeExperiences(params: {
    projectId?: string | null;
    missionId?: string | null;
    scope?: LearningScope;
    agentId?: LaPitayaAgentId;
  }): {
    status: 'CANDIDATE_CREATED' | 'INSUFFICIENT_EVIDENCE' | 'DEDUPLICATED';
    candidate: LearningCandidate | null;
    message: string;
  } {
    this.lastAnalysisAt = this.now();
    const allExps = [...this.experiences.values()];
    const relevant = allExps.filter((e) => {
      if (params.projectId && e.projectId !== params.projectId) return false;
      if (params.missionId && e.missionId !== params.missionId) return false;
      return true;
    });

    if (relevant.length < 2 && !relevant.some((e) => e.outcome === 'FAIL' || e.sourceType === 'ITERATION')) {
      return {
        status: 'INSUFFICIENT_EVIDENCE',
        candidate: null,
        message: 'Evidencia insuficiente para extraer un aprendizaje organizacional sólido.'
      };
    }

    const hasFailureAndFix = relevant.some((e) => e.outcome === 'FAIL') && relevant.some((e) => e.outcome === 'PASS');
    const allPass = relevant.every((e) => e.outcome === 'PASS');

    let observation = '';
    let confidence: LearningConfidence = 'LOW';
    const evidenceRefs: string[] = relevant.flatMap((e) => e.evidenceRefs);

    if (hasFailureAndFix) {
      observation = 'Se detectó que la ejecución de pruebas automatizadas antes de la auditoría detecta defectos tempranos y asegura entregas limpias.';
      confidence = 'HIGH';
    } else if (allPass && relevant.length >= 2) {
      observation = 'Patrón de ejecución secuencial BUILD → TEST → AUDIT completado exitosamente en múltiples fases.';
      confidence = 'MEDIUM';
    } else {
      observation = `Observación de ejecución basada en ${relevant.length} eventos verificados.`;
      confidence = 'LOW';
    }

    const fingerprint = `${params.scope ?? 'PROJECT'}:${observation.slice(0, 40)}:${evidenceRefs.slice(0, 3).join(',')}`;
    const existing = [...this.candidates.values()].find((c) => c.fingerprint === fingerprint);
    if (existing) {
      return {
        status: 'DEDUPLICATED',
        candidate: existing,
        message: 'El aprendizaje ya fue registrado previamente para este conjunto de evidencias.'
      };
    }

    const candidateId = `cand-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const candidate: LearningCandidate = {
      candidateId,
      observation,
      rationale: 'Análisis de experiencia realizado por El Tutú a partir de evidencia verificada en CIMA.',
      evidenceRefs: Array.from(new Set(evidenceRefs)),
      confidence,
      scope: params.scope ?? (params.projectId ? 'PROJECT' : 'ORGANIZATION'),
      projectId: params.projectId ?? null,
      missionId: params.missionId ?? null,
      proposedBy: 'el-tutu',
      createdAt: this.now(),
      status: 'PROPOSED',
      fingerprint,
      verified: true
    };

    this.candidates.set(candidateId, candidate);
    this.save();
    return {
      status: 'CANDIDATE_CREATED',
      candidate,
      message: `El Tutú extrajo un aprendizaje con confianza ${confidence}.`
    };
  }

  createCandidateDirect(params: {
    observation: string;
    evidenceRefs: readonly string[];
    confidence: LearningConfidence;
    scope: LearningScope;
    projectId?: string | null;
    missionId?: string | null;
    proposedBy?: 'el-tutu' | 'el-inge' | 'human' | 'runtime';
  }): LearningCandidate | null {
    if (!params.evidenceRefs || params.evidenceRefs.length === 0) return null;
    const fingerprint = `${params.scope}:${params.observation.slice(0, 40)}:${params.evidenceRefs.slice(0, 3).join(',')}`;
    const existing = [...this.candidates.values()].find((c) => c.fingerprint === fingerprint);
    if (existing) return existing;

    const candidateId = `cand-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const candidate: LearningCandidate = {
      candidateId,
      observation: params.observation,
      evidenceRefs: [...params.evidenceRefs],
      confidence: params.confidence,
      scope: params.scope,
      projectId: params.projectId ?? null,
      missionId: params.missionId ?? null,
      proposedBy: params.proposedBy ?? 'el-tutu',
      createdAt: this.now(),
      status: 'PROPOSED',
      fingerprint,
      verified: true
    };
    this.candidates.set(candidateId, candidate);
    this.save();
    return candidate;
  }

  listCandidates(): readonly LearningCandidate[] {
    return [...this.candidates.values()];
  }

  // ─── Skill Proposals ───────────────────────────────────────────────────────

  proposeSkill(params: {
    candidateId?: string | null;
    name: string;
    description: string;
    version?: string;
    scope?: LearningScope;
    procedure: readonly string[];
    inputs?: readonly string[];
    outputs?: readonly string[];
    constraints?: readonly string[];
    requiredCapabilities?: readonly string[];
    riskClass?: SkillRiskClass;
    rationale: string;
    evidenceRefs: readonly string[];
    proposedBy?: 'el-tutu' | 'el-inge' | 'human';
  }): {
    proposal: SkillProposal;
    isDuplicate: boolean;
    isImprovement: boolean;
  } {
    const existingAdopted = [...this.adoptedSkills.values()].find((s) => s.name.toLowerCase() === params.name.toLowerCase());
    const isImprovement = !!existingAdopted;
    const version = params.version ?? (isImprovement ? this.bumpVersion(existingAdopted.version) : '1.0.0');

    const existingProposal = [...this.proposals.values()].find(
      (p) => p.name.toLowerCase() === params.name.toLowerCase() && p.version === version && p.status === 'PROPOSED'
    );
    if (existingProposal) {
      return { proposal: existingProposal, isDuplicate: true, isImprovement };
    }

    const proposalId = `prop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const proposal: SkillProposal = {
      proposalId,
      candidateId: params.candidateId ?? null,
      name: params.name,
      description: params.description,
      version,
      scope: params.scope ?? 'ORGANIZATION',
      procedure: [...params.procedure],
      inputs: params.inputs ? [...params.inputs] : [],
      outputs: params.outputs ? [...params.outputs] : [],
      constraints: params.constraints ? [...params.constraints] : [],
      requiredCapabilities: params.requiredCapabilities ? [...params.requiredCapabilities] : [],
      riskClass: params.riskClass ?? 'LOW',
      rationale: params.rationale,
      evidenceRefs: [...params.evidenceRefs],
      validationRefs: [],
      validationStatus: 'PENDING',
      validatedBy: null,
      auditStatus: 'PENDING',
      auditedBy: null,
      status: 'PROPOSED',
      proposedBy: params.proposedBy ?? 'el-tutu',
      createdAt: this.now(),
      updatedAt: this.now(),
      rejectionReason: null,
      verified: true
    };

    this.proposals.set(proposalId, proposal);
    this.save();
    return { proposal, isDuplicate: false, isImprovement };
  }

  listProposals(): readonly SkillProposal[] {
    return [...this.proposals.values()];
  }

  getProposal(proposalId: string): SkillProposal | null {
    return this.proposals.get(proposalId) ?? null;
  }

  // ─── Independent Validation & Audit ────────────────────────────────────────

  validateSkillProposal(params: {
    proposalId: string;
    validatorAgentId?: LaPitayaAgentId | 'margarito';
    validationOutcome: 'PASS' | 'FAIL';
    validationRefs: readonly string[];
  }): SkillProposal | null {
    const proposal = this.proposals.get(params.proposalId);
    if (!proposal) return null;

    const validator = params.validatorAgentId ?? 'margarito';
    const validationStatus = params.validationOutcome === 'PASS' ? 'VALIDATED' : 'FAILED';
    const updated: SkillProposal = {
      ...proposal,
      validationStatus,
      validatedBy: validator,
      validationRefs: [...params.validationRefs],
      status: validationStatus === 'VALIDATED' ? (proposal.auditStatus === 'AUDITED' ? 'AUDITED' : 'VALIDATED') : 'REJECTED',
      updatedAt: this.now()
    };
    this.proposals.set(params.proposalId, updated);
    this.save();
    return updated;
  }

  auditSkillProposal(params: {
    proposalId: string;
    auditorAgentId?: LaPitayaAgentId | 'jose-juan';
    auditOutcome: 'PASS' | 'FAIL';
    auditRefs?: readonly string[];
  }): SkillProposal | null {
    const proposal = this.proposals.get(params.proposalId);
    if (!proposal) return null;

    const auditor = params.auditorAgentId ?? 'jose-juan';
    const auditStatus = params.auditOutcome === 'PASS' ? 'AUDITED' : 'REJECTED';
    const updated: SkillProposal = {
      ...proposal,
      auditStatus,
      auditedBy: auditor,
      status: auditStatus === 'AUDITED' ? 'AUDITED' : 'REJECTED',
      updatedAt: this.now()
    };
    this.proposals.set(params.proposalId, updated);
    this.save();
    return updated;
  }

  // ─── Governed Adoption & Rejection ─────────────────────────────────────────

  adoptSkill(params: {
    proposalId: string;
    approvedBy: string;
    riskApprovalGranted?: boolean;
  }): { ok: true; skill: AdoptedSkill } | { ok: false; error: string } {
    const proposal = this.proposals.get(params.proposalId);
    if (!proposal) return { ok: false, error: 'Propuesta no encontrada.' };

    if (proposal.riskClass === 'HIGH' && !params.riskApprovalGranted) {
      return { ok: false, error: 'La skill requiere aprobación humana explícita de riesgo HIGH.' };
    }

    const skillId = `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = this.now();

    // Supersede older version if any
    for (const [id, s] of this.adoptedSkills.entries()) {
      if (s.name.toLowerCase() === proposal.name.toLowerCase() && s.status === 'ACTIVE') {
        this.adoptedSkills.set(id, {
          ...s,
          status: 'SUPERSEDED',
          updatedAt: now
        });
      }
    }

    const adoptedSkill: AdoptedSkill = {
      skillId,
      proposalId: proposal.proposalId,
      name: proposal.name,
      description: proposal.description,
      version: proposal.version,
      scope: proposal.scope,
      procedure: [...proposal.procedure],
      inputs: [...proposal.inputs],
      outputs: [...proposal.outputs],
      constraints: [...proposal.constraints],
      requiredCapabilities: [...proposal.requiredCapabilities],
      riskClass: proposal.riskClass,
      evidenceRefs: [...proposal.evidenceRefs],
      validationRefs: [...proposal.validationRefs],
      status: 'ACTIVE',
      approvedBy: params.approvedBy,
      adoptedAt: now,
      updatedAt: now,
      verified: true
    };

    this.adoptedSkills.set(skillId, adoptedSkill);
    this.proposals.set(params.proposalId, {
      ...proposal,
      status: 'ADOPTED',
      updatedAt: now
    });

    this.save();
    return { ok: true, skill: adoptedSkill };
  }

  rejectSkillProposal(params: {
    proposalId: string;
    rejectedBy: string;
    reason: string;
  }): SkillProposal | null {
    const proposal = this.proposals.get(params.proposalId);
    if (!proposal) return null;

    const updated: SkillProposal = {
      ...proposal,
      status: 'REJECTED',
      rejectionReason: params.reason,
      updatedAt: this.now()
    };
    this.proposals.set(params.proposalId, updated);
    this.save();
    return updated;
  }

  listAdoptedSkills(): readonly AdoptedSkill[] {
    return [...this.adoptedSkills.values()];
  }

  getAdoptedSkill(skillId: string): AdoptedSkill | null {
    return this.adoptedSkills.get(skillId) ?? null;
  }

  // ─── Skill Execution Trace & Feedback ──────────────────────────────────────

  recordSkillExecution(params: {
    skillId: string;
    version: string;
    agentId: LaPitayaAgentId;
    requestId: string;
    taskId?: string | null;
    sessionId?: string | null;
    outcome: 'PASS' | 'FAIL' | 'BLOCKED';
    evidenceRefs: readonly string[];
  }): SkillExecutionTrace {
    const trace: SkillExecutionTrace = {
      traceId: `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      skillId: params.skillId,
      version: params.version,
      agentId: params.agentId,
      requestId: params.requestId,
      taskId: params.taskId ?? null,
      sessionId: params.sessionId ?? null,
      outcome: params.outcome,
      evidenceRefs: [...params.evidenceRefs],
      executedAt: this.now(),
      verified: true
    };
    this.executionTraces.push(trace);
    this.save();
    return trace;
  }

  listExecutionTraces(): readonly SkillExecutionTrace[] {
    return [...this.executionTraces];
  }

  // ─── Projections & Snapshot ────────────────────────────────────────────────

  snapshot(): LearningSnapshot {
    const recentExperiences = [...this.experiences.values()].slice(-20);
    const candidates = [...this.candidates.values()];
    const proposals = [...this.proposals.values()];
    const adoptedSkills = [...this.adoptedSkills.values()];
    const rejectedProposals = proposals.filter((p) => p.status === 'REJECTED');
    const pendingValidation = proposals.filter((p) => p.status === 'PROPOSED' && p.validationStatus === 'PENDING');
    const pendingAudit = proposals.filter((p) => p.status === 'VALIDATED' && p.auditStatus === 'PENDING');
    const attention = this.deps.humanAttention?.() ?? null;

    return {
      recentExperiences,
      candidates,
      proposals,
      adoptedSkills,
      rejectedProposals,
      pendingValidation,
      pendingAudit,
      humanAttention: attention,
      lastAnalysisAt: this.lastAnalysisAt,
      verified: true
    };
  }

  // ─── Alicia Q&A (Strictly Read-Only, Zero Mutations) ────────────────────────

  answer(question: string): { known: boolean; answer: string; facts: readonly string[]; snapshotVersion: 1 } | null {
    const q = this.normalize(question);
    const s = this.snapshot();

    // 1. What did we learn from this project / What did we learn?
    if (/que aprendimos|what did we learn|lecciones aprendidas/.test(q)) {
      if (!s.candidates.length) {
        return this.makeAnswer(false, 'Todavía no hay aprendizajes organizacionales extraídos con evidencia verificada.', []);
      }
      const obs = s.candidates.map((c) => `"${c.observation}" (confianza: ${c.confidence}, alcance: ${c.scope})`).join('; ');
      return this.makeAnswer(
        true,
        `Aprendizajes verificados por El Tutú: ${obs}.`,
        s.candidates.map((c) => `candidate:${c.candidateId}`)
      );
    }

    // 2. What went wrong?
    if (/que salio mal|que fallo|what went wrong/.test(q)) {
      const failures = s.recentExperiences.filter((e) => e.outcome === 'FAIL');
      if (!failures.length) {
        return this.makeAnswer(true, 'No hay fallos registrados en las experiencias recientes verificadas.', ['experiences:no-failures']);
      }
      const summaries = failures.map((f) => f.summary).join('; ');
      return this.makeAnswer(true, `Eventos con fallo registrado: ${summaries}.`, failures.map((f) => `experience:${f.experienceId}`));
    }

    // 3. What did we improve?
    if (/que mejoramos|what did we improve/.test(q)) {
      if (!s.adoptedSkills.length && !s.proposals.length) {
        return this.makeAnswer(true, 'Aún no se han consolidado mejoras o skills adoptadas.', ['improvements:none']);
      }
      const active = s.adoptedSkills.filter((sk) => sk.status === 'ACTIVE').map((sk) => `${sk.name} (v${sk.version})`);
      return this.makeAnswer(
        true,
        `Mejoras y skills activas adoptadas: ${active.join(', ') || 'Ninguna skill adoptada aún'}.`,
        s.adoptedSkills.map((sk) => `skill:${sk.skillId}`)
      );
    }

    // 4. Did El Tutú find anything / Any repeated patterns?
    if (/el tutu encontro algo|encontro algo el tutu|patron repetido|hay algun patron/.test(q)) {
      if (!s.candidates.length) {
        return this.makeAnswer(true, 'El Tutú no ha encontrado patrones suficientes con la evidencia actual.', ['tutu:no-patterns']);
      }
      const top = s.candidates[0];
      return this.makeAnswer(
        true,
        `El Tutú identificó el siguiente patrón: "${top.observation}" basado en ${top.evidenceRefs.length} evidencia(s) verificada(s).`,
        [`candidate:${top.candidateId}`, `confidence:${top.confidence}`]
      );
    }

    // 5. Are there proposed skills?
    if (/hay skills propuestas|skills propuestas|propuestas de skill|are there proposed skills/.test(q)) {
      const props = s.proposals.filter((p) => p.status !== 'ADOPTED' && p.status !== 'REJECTED');
      if (!props.length) {
        return this.makeAnswer(true, 'No hay propuestas de skills pendientes en este momento.', ['proposals:0']);
      }
      const list = props.map((p) => `"${p.name}" v${p.version} (estado: ${p.status}, riesgo: ${p.riskClass})`).join(', ');
      return this.makeAnswer(true, `Hay ${props.length} skill(s) propuesta(s): ${list}.`, props.map((p) => `proposal:${p.proposalId}`));
    }

    // 6. What skills do we have?
    if (/que skills tenemos|cuales skills tenemos|skills activas|what skills do we have/.test(q)) {
      const active = s.adoptedSkills.filter((sk) => sk.status === 'ACTIVE');
      if (!active.length) {
        return this.makeAnswer(true, 'Actualmente no hay skills adoptadas en el registro organizacional.', ['adoptedSkills:0']);
      }
      const list = active.map((sk) => `${sk.name} v${sk.version} (${sk.description})`).join('; ');
      return this.makeAnswer(true, `Tenemos ${active.length} skill(s) adoptada(s): ${list}.`, active.map((sk) => `skill:${sk.skillId}`));
    }

    // 7. Ambiguity resolution for skills
    const matchingSkills = this.findMatchingSkills(q);
    if (matchingSkills.length > 1) {
      const names = matchingSkills.map((sk) => `"${sk.name}"`).join(' o ');
      return this.makeAnswer(true, `Hay más de una skill que coincide. ¿A cuál te refieres: ${names}?`, matchingSkills.map((sk) => `ambiguity:${sk.skillId}`));
    }

    // 8. False premise / Is this skill approved?
    if (/(?:esta|esa|la)\s+skill.*(?:aprobada|adoptada)|skill.*(?:esta|ya\s+esta)\s+aprobada|is this skill approved|aprobada.*verdad/i.test(q)) {
      const match = this.findMatchingSkillOrProposal(q);
      if (match.proposal && match.proposal.status !== 'ADOPTED') {
        return this.makeAnswer(
          true,
          `No, la skill "${match.proposal.name}" está en estado ${match.proposal.status}; todavía no está aprobada ni adoptada.`,
          [`proposal:${match.proposal.proposalId}:NOT_ADOPTED`]
        );
      }
      if (match.skill && match.skill.status === 'ACTIVE') {
        return this.makeAnswer(
          true,
          `Sí, la skill "${match.skill.name}" v${match.skill.version} está adoptada y activa (aprobada por ${match.skill.approvedBy}).`,
          [`skill:${match.skill.skillId}:ACTIVE`]
        );
      }
      return this.makeAnswer(false, 'No encontré una skill con ese nombre.', []);
    }

    // 9. Who approved this skill?
    if (/quien aprobo.*skill|who approved this skill/i.test(q)) {
      const match = this.findMatchingSkillOrProposal(q);
      if (match.skill) {
        return this.makeAnswer(true, `La skill "${match.skill.name}" fue aprobada por ${match.skill.approvedBy}.`, [`skill:${match.skill.skillId}`]);
      }
      if (match.proposal) {
        return this.makeAnswer(true, `La propuesta "${match.proposal.name}" aún no ha sido aprobada por ninguna autoridad.`, [`proposal:${match.proposal.proposalId}`]);
      }
      return this.makeAnswer(false, 'No se encontró la skill solicitada.', []);
    }

    // 10. On what evidence is this skill based?
    if (/en que evidencia se basa|cual es la evidencia|what evidence is it based on/i.test(q)) {
      const match = this.findMatchingSkillOrProposal(q);
      const refs = match.skill?.evidenceRefs ?? match.proposal?.evidenceRefs ?? [];
      const name = match.skill?.name ?? match.proposal?.name ?? 'la skill';
      if (!refs.length) {
        return this.makeAnswer(false, `No hay referencias de evidencia para ${name}.`, []);
      }
      return this.makeAnswer(true, `La skill "${name}" se basa en las siguientes referencias de evidencia: ${refs.join(', ')}.`, refs.map((r) => `evidence:${r}`));
    }

    return null;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private findMatchingSkills(normalizedQuery: string): AdoptedSkill[] {
    const list = [...this.adoptedSkills.values()];
    return list.filter((sk) => {
      const nameNorm = this.normalize(sk.name);
      return normalizedQuery.includes(nameNorm) || nameNorm.split(' ').some((w) => w.length > 3 && normalizedQuery.includes(w));
    });
  }

  private findMatchingSkillOrProposal(normalizedQuery: string): { skill?: AdoptedSkill; proposal?: SkillProposal } {
    const skills = [...this.adoptedSkills.values()];
    const proposals = [...this.proposals.values()];

    const skill = skills.find((s) => normalizedQuery.includes(this.normalize(s.name)));
    const proposal = proposals.find((p) => normalizedQuery.includes(this.normalize(p.name)));
    return { skill, proposal };
  }

  private bumpVersion(v: string): string {
    const parts = v.split('.').map((n) => parseInt(n, 10) || 0);
    const major = parts[0] ?? 1;
    const minor = parts[1] ?? 0;
    return `${major}.${minor + 1}.0`;
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
