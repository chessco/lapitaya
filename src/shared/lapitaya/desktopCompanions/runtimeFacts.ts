/**
 * Verified runtime facts → Desktop Companion presentation facts — FASE 2 remediation.
 *
 * There is no new event bus. The source is the stream La Pitaya already has:
 *
 *   CimaRuntimeService.onEvent ──fromRuntimeEvent()──▶ AliciaEvent ──companionFactsFromAliciaEvent()──▶ CompanionFact
 *
 * The adapter is pure and read-only: it never mutates the event it reads, never
 * invents a field the event did not carry, and an event it does not recognise
 * yields no fact (the companion stays silent rather than guessing). It runs in the
 * main process only; nothing the companion renderer sends can reach it.
 */

import type { AliciaEvent } from '../alicia/events';
import type { CimaPhase } from '../cima';
import { defaultPhaseOwner, LA_PITAYA_AGENT_BY_ID, type LaPitayaAgentId } from '../agents';
import type { CompanionVisualState } from './types';

export const COMPANION_FACTS = [
  'BUILD_STARTED', 'BUILD_COMPLETED', 'BUILD_FAILED', 'BUILD_BLOCKED',
  'TEST_STARTED', 'TEST_COMPLETED', 'TEST_FAILED', 'TEST_BLOCKED',
  'AUDIT_STARTED', 'AUDIT_COMPLETED', 'AUDIT_FAILED', 'AUDIT_BLOCKED',
  'REQUEST_PENDING', 'REQUEST_RESOLVED',
  'HUMAN_APPROVAL_REQUIRED', 'APPROVAL_PENDING', 'APPROVAL_RESOLVED'
] as const;
export type CompanionFactName = (typeof COMPANION_FACTS)[number];

export function isCompanionFact(v: unknown): v is CompanionFactName {
  return typeof v === 'string' && (COMPANION_FACTS as readonly string[]).includes(v);
}

export interface CompanionFact {
  fact: CompanionFactName;
  /** Id of the source record (approval id, proposal id, message id) — links a pending fact to its resolution. */
  ref?: string;
  /** FASE 2.3: the La Pitaya agent the verified event names (assignment `to`, record `agentId`),
   *  resolved by the host from the hive registry. Absent when it could not be resolved. */
  agent?: LaPitayaAgentId;
}

/** Host-supplied lookup: hive agent id (worker-…) → La Pitaya agent, or null. Main builds it from
 *  the hive registry's NAME for that worker; it never reads the event's free text. */
export type CompanionAgentResolver = (hiveAgentId: string) => LaPitayaAgentId | null;

/**
 * What each fact does to the presentation. `target` is explicit: a fact never
 * updates "whoever is entries[0]". `sticky` facts keep their bubble until resolved.
 */
export interface CompanionFactEffect {
  target: LaPitayaAgentId;
  state: CompanionVisualState;
  text: string;
  /** The companion whose CIMA phase this fact belongs to (drives FOCUS mode). */
  phaseAgent?: LaPitayaAgentId;
  /** A different companion returning to IDLE because its phase ended. */
  release?: LaPitayaAgentId;
  sticky?: boolean;
}

/** The default hire preset for a CIMA phase (BUILD → El Beni, TEST → Margarito, AUDIT → José Juan):
 *  who the companions show when the event names no agent that owns the phase. */
export function phaseOwner(phase: CimaPhase): LaPitayaAgentId | null {
  return defaultPhaseOwner(phase);
}

const BUILDER = phaseOwner('BUILD') ?? 'el-beni';
const TESTER = phaseOwner('TEST') ?? 'margarito';
const AUDITOR = phaseOwner('AUDIT') ?? 'jose-juan';

export const COMPANION_FACT_EFFECTS: Readonly<Record<CompanionFactName, CompanionFactEffect | null>> = {
  BUILD_STARTED: { target: BUILDER, state: 'WORKING', text: 'El Beni está construyendo.', phaseAgent: BUILDER },
  BUILD_COMPLETED: { target: 'alicia', state: 'CELEBRATING', text: 'El build terminó con éxito.', phaseAgent: BUILDER, release: BUILDER },
  BUILD_FAILED: { target: BUILDER, state: 'CONCERNED', text: 'El build no pasó.', phaseAgent: BUILDER },
  // BLOCKED is not FAIL (PROTOCOL.md: "Use BLOCKED when you cannot validate — missing evidence, human
  // approval needed"). It maps to PAUSED — the state the FASE 2 code already gave Alicia's BLOCKED
  // presence — and its text says it was not validated, never that it failed.
  BUILD_BLOCKED: { target: BUILDER, state: 'PAUSED', text: 'El build quedó en BLOCKED: sin validar todavía.', phaseAgent: BUILDER },
  TEST_STARTED: { target: TESTER, state: 'WORKING', text: 'Margarito está ejecutando pruebas.', phaseAgent: TESTER },
  TEST_COMPLETED: { target: TESTER, state: 'CELEBRATING', text: 'Las pruebas pasaron.', phaseAgent: TESTER },
  TEST_FAILED: { target: TESTER, state: 'CONCERNED', text: 'Las pruebas no pasaron.', phaseAgent: TESTER },
  TEST_BLOCKED: { target: TESTER, state: 'PAUSED', text: 'Las pruebas quedaron en BLOCKED: sin validar todavía.', phaseAgent: TESTER },
  AUDIT_STARTED: { target: AUDITOR, state: 'WORKING', text: 'José Juan está auditando.', phaseAgent: AUDITOR },
  AUDIT_COMPLETED: { target: AUDITOR, state: 'CELEBRATING', text: 'La auditoría terminó con veredicto PASS.', phaseAgent: AUDITOR },
  AUDIT_FAILED: { target: AUDITOR, state: 'CONCERNED', text: 'La auditoría no pasó.', phaseAgent: AUDITOR },
  AUDIT_BLOCKED: { target: AUDITOR, state: 'PAUSED', text: 'La auditoría quedó en BLOCKED: sin validar todavía.', phaseAgent: AUDITOR },
  REQUEST_PENDING: { target: 'alicia', state: 'ATTENTION', text: 'Hay una solicitud que necesita tu confirmación.', sticky: true },
  HUMAN_APPROVAL_REQUIRED: { target: 'alicia', state: 'ATTENTION', text: 'Hay una solicitud que necesita tu confirmación.', sticky: true },
  APPROVAL_PENDING: { target: 'alicia', state: 'ATTENTION', text: 'Hay una solicitud que necesita tu confirmación.', sticky: true },
  // Resolutions carry no state of their own: they only clear the matching pending fact.
  REQUEST_RESOLVED: null,
  APPROVAL_RESOLVED: null
};

/**
 * The effect of a fact for the agent the event named (FASE 2.3). The table above is written for each
 * phase's default owner; a dispatched agent that owns the same phase (Rosalba on BUILD) takes that
 * owner's place — target, FOCUS agent, release and name in the text — and nothing else changes:
 * the state (WORKING / CELEBRATING / CONCERNED / PAUSED) and who celebrates a BUILD PASS (Alicia)
 * stay exactly as for the default owner. No agent, or the default owner itself → the table entry.
 */
export function companionFactEffect(fact: CompanionFactName, agent?: LaPitayaAgentId): CompanionFactEffect | null {
  const base = COMPANION_FACT_EFFECTS[fact];
  const owner = base?.phaseAgent;
  if (!base || !agent || !owner || agent === owner) return base;
  if (!LA_PITAYA_AGENT_BY_ID[agent]?.cimaPhases.some((p) => LA_PITAYA_AGENT_BY_ID[owner].cimaPhases.includes(p))) return base;
  const swap = (id: LaPitayaAgentId): LaPitayaAgentId => (id === owner ? agent : id);
  return {
    ...base,
    target: swap(base.target),
    phaseAgent: agent,
    ...(base.release ? { release: swap(base.release) } : {}),
    text: base.text.replace(LA_PITAYA_AGENT_BY_ID[owner].name, LA_PITAYA_AGENT_BY_ID[agent].name)
  };
}

const STARTED: Partial<Record<CimaPhase, CompanionFactName>> = { BUILD: 'BUILD_STARTED', TEST: 'TEST_STARTED', AUDIT: 'AUDIT_STARTED' };
const PASSED: Partial<Record<CimaPhase, CompanionFactName>> = { BUILD: 'BUILD_COMPLETED', TEST: 'TEST_COMPLETED', AUDIT: 'AUDIT_COMPLETED' };
const FAILED: Partial<Record<CimaPhase, CompanionFactName>> = { BUILD: 'BUILD_FAILED', TEST: 'TEST_FAILED', AUDIT: 'AUDIT_FAILED' };
const BLOCKED: Partial<Record<CimaPhase, CompanionFactName>> = { BUILD: 'BUILD_BLOCKED', TEST: 'TEST_BLOCKED', AUDIT: 'AUDIT_BLOCKED' };
/** Each runtime verdict keeps its own meaning; an unknown verdict yields no fact. */
const BY_VERDICT: Readonly<Record<string, Partial<Record<CimaPhase, CompanionFactName>>>> = { PASS: PASSED, FAIL: FAILED, BLOCKED };

/**
 * Translate one verified Alicia event into companion facts.
 *
 *   cima.phase.assigned (BUILD/TEST/AUDIT)          → *_STARTED
 *   cima.phase.changed  (BUILD/TEST/AUDIT, PASS)    → *_COMPLETED
 *   cima.phase.changed  (BUILD/TEST/AUDIT, FAIL)    → *_FAILED
 *   cima.phase.changed  (BUILD/TEST/AUDIT, BLOCKED) → *_BLOCKED   (BLOCKED is not FAIL)
 *   approval.required                               → HUMAN_APPROVAL_REQUIRED
 *   approval.granted / approval.denied              → APPROVAL_RESOLVED
 *   request.proposed                                → REQUEST_PENDING
 *   request.confirmed / request.closed              → REQUEST_RESOLVED
 *
 * `audit.completed` is not mapped separately: the runtime emits it alongside the
 * AUDIT `cima.phase.changed`, which already carries the verdict.
 */
export function companionFactsFromAliciaEvent(ev: AliciaEvent | null | undefined, resolveAgent?: CompanionAgentResolver): CompanionFact[] {
  if (!ev || typeof ev.type !== 'string') return [];
  const ref = typeof ev.ref === 'string' && ev.ref ? ev.ref : undefined;
  const withRef = (fact: CompanionFactName): CompanionFact[] => [ref ? { fact, ref } : { fact }];
  // A phase fact keeps the agent the verified event names — but only an agent that owns that
  // phase in the roster; anything else falls back to the phase's default owner (FASE 2.2).
  const phaseFact = (fact: CompanionFactName, phase: CimaPhase): CompanionFact[] => {
    let agent: LaPitayaAgentId | null = null;
    try { agent = ev.agentId && resolveAgent ? resolveAgent(ev.agentId) : null; } catch { agent = null; }
    const owns = agent !== null && LA_PITAYA_AGENT_BY_ID[agent]?.cimaPhases.includes(phase) === true;
    return [{ fact, ...(ref ? { ref } : {}), ...(owns ? { agent: agent as LaPitayaAgentId } : {}) }];
  };
  switch (ev.type) {
    case 'cima.phase.assigned': {
      const f = ev.phase ? STARTED[ev.phase] : undefined;
      return f && ev.phase ? phaseFact(f, ev.phase) : [];
    }
    case 'cima.phase.changed': {
      if (!ev.phase || !ev.verdict) return [];
      const f = BY_VERDICT[ev.verdict]?.[ev.phase];
      return f ? phaseFact(f, ev.phase) : [];
    }
    case 'approval.required':
      return withRef('HUMAN_APPROVAL_REQUIRED');
    case 'approval.granted':
    case 'approval.denied':
      return ref ? withRef('APPROVAL_RESOLVED') : [];
    case 'request.proposed':
      return withRef('REQUEST_PENDING');
    case 'request.confirmed':
    case 'request.closed':
      return ref ? withRef('REQUEST_RESOLVED') : [];
    default:
      return [];
  }
}
