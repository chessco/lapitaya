import type { CompanyOSSnapshot } from '../company/osTypes';

export interface CompanyOSAnswer {
  known: boolean;
  answer: string;
  facts: readonly string[];
  snapshotVersion: 2;
  isRefutation?: boolean;
  intentProposal?: boolean;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function answerCompanyOSQuestion(
  question: string,
  snapshot: CompanyOSSnapshot,
  locale = 'es-MX'
): CompanyOSAnswer {
  const q = normalize(question);
  const isEn = locale.startsWith('en');

  // ─── FALSE PREMISE REFUTATIONS ──────────────────────────────────────────
  if (q.includes('saltarse cima') || q.includes('bypasses cima') || q.includes('saltar gobernanza')) {
    return {
      known: true,
      isRefutation: true,
      snapshotVersion: 2,
      answer: isEn
        ? 'Refutation: Priority dictates the order of authorized work, but CIMA strictly governs authority and risk. High priority never bypasses governance.'
        : 'Refutación: La prioridad determina el orden del trabajo autorizado, pero CIMA gobierna estrictamente la autoridad y el riesgo. Mayor prioridad nunca elude la gobernanza.',
      facts: ['PRIORITY != RISK', 'PRIORITY != AUTHORIZATION', 'CIMA_GOVERNANCE_UNBROKEN']
    };
  }

  if (q.includes('inge puede crear un nuevo objetivo') || q.includes('inge creates strategic goal')) {
    return {
      known: true,
      isRefutation: true,
      snapshotVersion: 2,
      answer: isEn
        ? 'Refutation: Strategic objectives require exclusive Human authority. El Inge coordinates operations and proposes plans, but cannot invent company goals.'
        : 'Refutación: Los objetivos estratégicos provienen exclusivamente de la autoridad humana. El Inge coordina operaciones y propone planes, pero no inventa objetivos estratégicos.',
      facts: ['HUMAN_STRATEGIC_AUTHORITY', 'EL_INGE_COORDINATION_ONLY']
    };
  }

  if (q.includes('asignarse solo') || q.includes('assign itself')) {
    return {
      known: true,
      isRefutation: true,
      snapshotVersion: 2,
      answer: isEn
        ? 'Refutation: Agents cannot self-assign. Assignments require an authorized mission plan, capacity availability, and CIMA phase validation.'
        : 'Refutación: Los agentes no pueden asignarse a sí mismos. Las asignaciones requieren un plan de misión autorizado, capacidad disponible y validación de fase CIMA.',
      facts: ['AVAILABLE != ASSIGNED', 'BUILDER_AUDITOR_SEPARATION']
    };
  }

  if (q.includes('cualquier agente puede usarlo') || q.includes('any agent can use resource')) {
    return {
      known: true,
      isRefutation: true,
      snapshotVersion: 2,
      answer: isEn
        ? 'Refutation: Resource availability does not equal permission to use. Every tool and resource invocation must be authorized within an approved scope.'
        : 'Refutación: Que un recurso esté disponible no otorga permiso para usarlo. Cada uso de herramienta y recurso debe estar autorizado en un alcance aprobado.',
      facts: ['RESOURCE_AVAILABLE != PERMITTED']
    };
  }

  if (q.includes('pause borra') || q.includes('pause deletes')) {
    return {
      known: true,
      isRefutation: true,
      snapshotVersion: 2,
      answer: isEn
        ? 'Refutation: Company Pause freezes operational execution without erasing portfolio, state, or historical ledger evidence.'
        : 'Refutación: Pausar la empresa congela la ejecución operacional sin borrar el portafolio, el estado ni la evidencia histórica del ledger.',
      facts: ['PAUSE_NON_DESTRUCTIVE', 'EVIDENCE_PRESERVED']
    };
  }

  if (q.includes('reiniciar la pitaya vuelve a autorizar') || q.includes('restart reauthorizes')) {
    return {
      known: true,
      isRefutation: true,
      snapshotVersion: 2,
      answer: isEn
        ? 'Refutation: System restart reconstructs durable state but never grants fresh or expired authorization.'
        : 'Refutación: El reinicio reconstruye el estado durable pero nunca otorga autorización nueva ni renueva envelopes caducados.',
      facts: ['RESTART != REAUTHORIZATION']
    };
  }

  if (q.includes('presupuesto de otro') || q.includes('budget of another')) {
    return {
      known: true,
      isRefutation: true,
      snapshotVersion: 2,
      answer: isEn
        ? 'Refutation: Project budgets and Autonomy Envelopes are strictly isolated. A project cannot consume another project budget.'
        : 'Refutación: Los presupuestos y envelopes de proyectos están estrictamente aislados. Un proyecto no puede consumir el presupuesto de otro.',
      facts: ['PROJECT_BUDGET_ISOLATION']
    };
  }

  if (q.includes('skill activa tiene permiso global') || q.includes('skill has global permission')) {
    return {
      known: true,
      isRefutation: true,
      snapshotVersion: 2,
      answer: isEn
        ? 'Refutation: Adopted Skills are verified capability templates, not universal permission grants.'
        : 'Refutación: Las Skills adoptadas son plantillas de capacidad verificadas, no permisos globales ni autorizaciones de elusión.',
      facts: ['SKILL != AUTHORIZATION']
    };
  }

  // ─── ACTION REQUEST INTENTS ─────────────────────────────────────────────
  if (q.startsWith('prioriza ') || q.startsWith('prioritize ') || q.startsWith('pausa la empresa') || q.startsWith('pause company')) {
    return {
      known: true,
      intentProposal: true,
      snapshotVersion: 2,
      answer: isEn
        ? 'Action request detected: Routed to the Human Intent Boundary for authorized execution.'
        : 'Solicitud de acción detectada: Canalizada a través del IntentBoundary para confirmación y ejecución autorizada.',
      facts: ['INTENT_BOUNDARY_CROSSING_REQUIRED']
    };
  }

  // ─── 15 CANONICAL QUERIES ───────────────────────────────────────────────

  // Q1: What is the company doing?
  if (q.includes('que esta haciendo la empresa') || q.includes('what is the company doing')) {
    if (snapshot.isPaused) {
      return {
        known: true,
        snapshotVersion: 2,
        answer: isEn
          ? 'The company is currently PAUSED by the operator. No autonomous operations are running.'
          : 'La empresa está actualmente PAUSADA por el operador. No hay operaciones autónomas en ejecución.',
        facts: ['COMPANY_PAUSED', `HEALTH_${snapshot.health.status}`]
      };
    }
    const running = snapshot.operationsCenter?.activeOperations?.filter((o) => o.status === 'RUNNING') ?? [];
    if (running.length === 0) {
      return {
        known: true,
        snapshotVersion: 2,
        answer: isEn
          ? `The company is IDLE in ${snapshot.operatingMode ?? 'SUPERVISED'} mode. Portfolio contains ${snapshot.portfolio.summary.totalProjects} project(s).`
          : `La empresa está en estado IDLE en modo ${snapshot.operatingMode ?? 'SUPERVISED'}. El portafolio contiene ${snapshot.portfolio.summary.totalProjects} proyecto(s).`,
        facts: [`MODE_${snapshot.operatingMode}`, `HEALTH_${snapshot.health.status}`]
      };
    }
    const opsSummary = running.map((o) => `${o.projectName} (${o.missionTitle})`).join(', ');
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `The company is actively running ${running.length} operation(s): ${opsSummary}.`
        : `La empresa está ejecutando activamente ${running.length} operación(es): ${opsSummary}.`,
      facts: [`RUNNING_OPS_${running.length}`, `HEALTH_${snapshot.health.status}`]
    };
  }

  // Q2: What projects are active?
  if (q.includes('proyectos estan activos') || q.includes('projects are active') || q.includes('cuantos proyectos')) {
    const active = snapshot.portfolio.projects.filter((p) => p.status === 'ACTIVE');
    if (active.length === 0) {
      return {
        known: true,
        snapshotVersion: 2,
        answer: isEn ? 'There are currently no active projects.' : 'Actualmente no hay proyectos activos.',
        facts: ['ACTIVE_PROJECTS_0']
      };
    }
    const names = active.map((p) => `${p.name} [Prioridad: ${p.priority}]`).join(', ');
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `There are ${active.length} active project(s): ${names}.`
        : `Hay ${active.length} proyecto(s) activo(s): ${names}.`,
      facts: active.map((p) => `PROJECT_${p.projectId}_${p.priority}`)
    };
  }

  // Q3: Which project has top priority?
  if (q.includes('proyecto prioritario') || q.includes('top priority project') || q.includes('mayor prioridad')) {
    if (snapshot.portfolio.projects.length === 0) {
      return {
        known: true,
        snapshotVersion: 2,
        answer: isEn ? 'No projects in portfolio.' : 'No hay proyectos en el portafolio.',
        facts: ['PORTFOLIO_EMPTY']
      };
    }
    const critical = snapshot.portfolio.projects.find((p) => p.priority === 'CRITICAL');
    const top = critical ?? snapshot.portfolio.projects[0];
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `Top priority project is "${top.name}" with priority ${top.priority}.`
        : `El proyecto prioritario es "${top.name}" con prioridad ${top.priority}.`,
      facts: [`TOP_PRIORITY_${top.projectId}_${top.priority}`]
    };
  }

  // Q4: What mission is next and why?
  if (q.includes('mision sigue') || q.includes('what mission is next') || q.includes('siguiente mision')) {
    const next = snapshot.workQueue.items.find((i) => i.status === 'READY');
    if (!next) {
      return {
        known: true,
        snapshotVersion: 2,
        answer: isEn ? 'No ready missions in work queue.' : 'No hay misiones en estado READY en la cola de trabajo.',
        facts: ['QUEUE_NO_READY_ITEMS']
      };
    }
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `Next mission is ${next.missionId} on project ${next.projectId} (Priority: ${next.priority}, Reason: ${next.reasonCode}).`
        : `La siguiente misión es ${next.missionId} del proyecto ${next.projectId} (Prioridad: ${next.priority}, Razón: ${next.reasonCode}).`,
      facts: [`NEXT_MISSION_${next.missionId}_${next.priority}`]
    };
  }

  // Q5: Who is working?
  if (q.includes('quien esta trabajando') || q.includes('who is working')) {
    const working = snapshot.capacity.filter((c) => c.state === 'EXECUTING' || c.state === 'ASSIGNED');
    if (working.length === 0) {
      return {
        known: true,
        snapshotVersion: 2,
        answer: isEn ? 'No agents are currently working.' : 'Ningún agente está trabajando actualmente.',
        facts: ['WORKING_AGENTS_0']
      };
    }
    const names = working.map((c) => `${c.agentId} (${c.state} en ${c.currentAssignment?.projectId ?? 'tarea'})`).join(', ');
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn ? `Active working agents: ${names}.` : `Agentes trabajando: ${names}.`,
      facts: working.map((c) => `WORKING_${c.agentId}`)
    };
  }

  // Q6: Who is available?
  if (q.includes('quien esta disponible') || q.includes('who is available')) {
    const available = snapshot.capacity.filter((c) => c.state === 'AVAILABLE');
    const names = available.map((c) => c.agentId).join(', ');
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `Available agents (${available.length}): ${names || 'none'}.`
        : `Agentes disponibles (${available.length}): ${names || 'ninguno'}.`,
      facts: available.map((c) => `AVAILABLE_${c.agentId}`)
    };
  }

  // Q7: What is blocked?
  if (q.includes('que esta bloqueado') || q.includes('what is blocked')) {
    const blockedQueue = snapshot.workQueue.items.filter(
      (i) => i.status === 'BLOCKED' || i.status === 'WAITING_DEPENDENCY' || i.status === 'WAITING_HUMAN'
    );
    if (blockedQueue.length === 0) {
      return {
        known: true,
        snapshotVersion: 2,
        answer: isEn ? 'Nothing is currently blocked.' : 'Nada está bloqueado actualmente.',
        facts: ['BLOCKED_ITEMS_0']
      };
    }
    const details = blockedQueue.map((i) => `${i.missionId} (${i.status}: ${i.reasonCode})`).join(', ');
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn ? `Blocked work items: ${details}.` : `Trabajo bloqueado: ${details}.`,
      facts: blockedQueue.map((i) => `BLOCKED_${i.missionId}_${i.status}`)
    };
  }

  // Q8: What needs human attention?
  if (q.includes('necesita mi atencion') || q.includes('needs my attention') || q.includes('atencion humana')) {
    const items = snapshot.humanAttentionCenter.items;
    if (items.length === 0) {
      return {
        known: true,
        snapshotVersion: 2,
        answer: isEn ? 'No pending items require your attention.' : 'No hay elementos pendientes que requieran tu atención.',
        facts: ['ATTENTION_ITEMS_0']
      };
    }
    const details = items.map((i) => `[${i.severity}] ${i.summary} (${i.reason})`).join('; ');
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `Items requiring human attention (${items.length}): ${details}.`
        : `Elementos que requieren tu atención (${items.length}): ${details}.`,
      facts: items.map((i) => `ATTENTION_${i.id}`)
    };
  }

  // Q9: Autonomous work running?
  if (q.includes('trabajo autonomo') || q.includes('autonomous work')) {
    const runningOps = snapshot.operationsCenter?.activeOperations?.filter((o) => o.status === 'RUNNING') ?? [];
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `There are ${runningOps.length} autonomous operation(s) active within Autonomy Envelopes.`
        : `Hay ${runningOps.length} operación(es) autónoma(s) activa(s) dentro de Autonomy Envelopes.`,
      facts: [`AUTONOMOUS_OPS_${runningOps.length}`]
    };
  }

  // Q10: Resource constraints?
  if (q.includes('recursos') || q.includes('resources') || q.includes('limitando el trabajo')) {
    const constrained = snapshot.resources.filter((r) => r.availableAmount <= 0 || r.contendingProjects.length > 0);
    if (constrained.length === 0) {
      return {
        known: true,
        snapshotVersion: 2,
        answer: isEn ? 'All resources are within normal capacity limits.' : 'Todos los recursos operan dentro de límites normales.',
        facts: ['RESOURCES_HEALTHY']
      };
    }
    const details = constrained.map((r) => `${r.name} (${r.availableAmount} ${r.unit} disponibles)`).join(', ');
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn ? `Constrained resources: ${details}.` : `Recursos con restricciones: ${details}.`,
      facts: constrained.map((r) => `RESOURCE_CONSTRAINED_${r.resourceId}`)
    };
  }

  // Q11: What was recently completed?
  if (q.includes('se completo') || q.includes('completed recently') || q.includes('completado')) {
    const completed = snapshot.portfolio.projects.filter((p) => p.status === 'COMPLETED');
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `Completed projects: ${completed.length}, verified deliveries: ${snapshot.metrics.completedDeliveries}, pass rate: ${Math.round(snapshot.metrics.overallPassRate * 100)}%.`
        : `Proyectos completados: ${completed.length}, entregas verificadas: ${snapshot.metrics.completedDeliveries}, tasa de éxito: ${Math.round(snapshot.metrics.overallPassRate * 100)}%.`,
      facts: [`COMPLETED_PROJECTS_${completed.length}`, `DELIVERIES_${snapshot.metrics.completedDeliveries}`]
    };
  }

  // Q12: What did the company learn?
  if (q.includes('que aprendio') || q.includes('what did the company learn') || q.includes('aprendizaje')) {
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `The company has ${snapshot.metrics.adoptedSkillsInUse} adopted skill(s) actively verified in production.`
        : `La empresa cuenta con ${snapshot.metrics.adoptedSkillsInUse} habilidad(es) adoptada(s) y verificada(s) en producción.`,
      facts: [`SKILLS_IN_USE_${snapshot.metrics.adoptedSkillsInUse}`]
    };
  }

  // Q13: Why was this work chosen over another?
  if (q.includes('por que elegiste este trabajo') || q.includes('why was this work chosen')) {
    const top = snapshot.workQueue.items[0];
    if (!top) {
      return {
        known: true,
        snapshotVersion: 2,
        answer: isEn ? 'No work currently scheduled.' : 'No hay trabajo programado actualmente.',
        facts: ['NO_WORK_SCHEDULED']
      };
    }
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `Mission ${top.missionId} was chosen based on priority ranking (${top.priority}), satisfied dependencies, and available agent capacity.`
        : `La misión ${top.missionId} fue seleccionada por ranking de prioridad (${top.priority}), dependencias satisfechas y capacidad de agentes disponible.`,
      facts: [`DECISION_RANK_${top.rank}`, `REASON_${top.reasonCode}`]
    };
  }

  // Q14: Are there risks or governance issues?
  if (q.includes('riesgo') || q.includes('risk') || q.includes('gobernanza') || q.includes('governance')) {
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? `Company health is ${snapshot.health.status} (score: ${snapshot.health.score}). Active reason codes: ${snapshot.health.reasonCodes.join(', ')}.`
        : `La salud de la empresa es ${snapshot.health.status} (puntuación: ${snapshot.health.score}). Códigos activos: ${snapshot.health.reasonCodes.join(', ')}.`,
      facts: [`HEALTH_${snapshot.health.status}`, `SCORE_${snapshot.health.score}`]
    };
  }

  // Q15: What happens if I close La Pitaya now?
  if (q.includes('si cierro la pitaya') || q.includes('if i close la pitaya') || q.includes('cerrar')) {
    return {
      known: true,
      snapshotVersion: 2,
      answer: isEn
        ? 'Closing La Pitaya safely preserves project states, human priorities, and ledger evidence. On restart, any operation that was running is restored as PAUSED: nothing resumes without valid authorization, and no operations are duplicated.'
        : 'Cerrar La Pitaya preserva de forma segura el estado de los proyectos, las prioridades y el ledger de evidencias. Al reiniciar, toda operación que estaba en ejecución se restaura en PAUSA: nada se reanuda sin autorización válida y no se duplican operaciones.',
      facts: ['SHUTDOWN_SAFE', 'PERSISTENCE_PRESERVED', 'RESTART_NOT_REAUTHORIZATION']
    };
  }

  // Default fallback
  return {
    known: false,
    snapshotVersion: 2,
    answer: isEn
      ? 'I could not find verified company facts for your query.'
      : 'No encontré hechos verificados de la empresa para responder tu consulta.',
    facts: []
  };
}

export function getCompanyOSAnswer(
  snapshot: CompanyOSSnapshot,
  question: string,
  locale?: string
): CompanyOSAnswer {
  return answerCompanyOSQuestion(question, snapshot, locale);
}

