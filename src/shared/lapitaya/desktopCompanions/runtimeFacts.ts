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
import { LA_PITAYA_AGENTS, type LaPitayaAgentId } from '../agents';
import type { CompanionVisualState } from './types';

export const COMPANION_FACTS = [
  'BUILD_STARTED', 'BUILD_COMPLETED', 'BUILD_FAILED',
  'TEST_STARTED', 'TEST_COMPLETED', 'TEST_FAILED',
  'AUDIT_STARTED', 'AUDIT_COMPLETED', 'AUDIT_FAILED',
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
}

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

/** The hire preset that owns a CIMA phase (BUILD → El Beni, TEST → Margarito, AUDIT → José Juan). */
export function phaseOwner(phase: CimaPhase): LaPitayaAgentId | null {
  return LA_PITAYA_AGENTS.find((a) => a.runtime === 'hire-preset' && a.cimaPhases.includes(phase))?.id ?? null;
}

const BUILDER = phaseOwner('BUILD') ?? 'el-beni';
const TESTER = phaseOwner('TEST') ?? 'margarito';
const AUDITOR = phaseOwner('AUDIT') ?? 'jose-juan';

export const COMPANION_FACT_EFFECTS: Readonly<Record<CompanionFactName, CompanionFactEffect | null>> = {
  BUILD_STARTED: { target: BUILDER, state: 'WORKING', text: 'El Beni está construyendo.', phaseAgent: BUILDER },
  BUILD_COMPLETED: { target: 'alicia', state: 'CELEBRATING', text: 'El build terminó con éxito.', phaseAgent: BUILDER, release: BUILDER },
  BUILD_FAILED: { target: BUILDER, state: 'CONCERNED', text: 'El build no pasó.', phaseAgent: BUILDER },
  TEST_STARTED: { target: TESTER, state: 'WORKING', text: 'Margarito está ejecutando pruebas.', phaseAgent: TESTER },
  TEST_COMPLETED: { target: TESTER, state: 'CELEBRATING', text: 'Las pruebas pasaron.', phaseAgent: TESTER },
  TEST_FAILED: { target: TESTER, state: 'CONCERNED', text: 'Las pruebas no pasaron.', phaseAgent: TESTER },
  AUDIT_STARTED: { target: AUDITOR, state: 'WORKING', text: 'José Juan está auditando.', phaseAgent: AUDITOR },
  AUDIT_COMPLETED: { target: AUDITOR, state: 'CELEBRATING', text: 'La auditoría terminó con veredicto PASS.', phaseAgent: AUDITOR },
  AUDIT_FAILED: { target: AUDITOR, state: 'CONCERNED', text: 'La auditoría no pasó.', phaseAgent: AUDITOR },
  REQUEST_PENDING: { target: 'alicia', state: 'ATTENTION', text: 'Hay una solicitud que necesita tu confirmación.', sticky: true },
  HUMAN_APPROVAL_REQUIRED: { target: 'alicia', state: 'ATTENTION', text: 'Hay una solicitud que necesita tu confirmación.', sticky: true },
  APPROVAL_PENDING: { target: 'alicia', state: 'ATTENTION', text: 'Hay una solicitud que necesita tu confirmación.', sticky: true },
  // Resolutions carry no state of their own: they only clear the matching pending fact.
  REQUEST_RESOLVED: null,
  APPROVAL_RESOLVED: null
};

const STARTED: Partial<Record<CimaPhase, CompanionFactName>> = { BUILD: 'BUILD_STARTED', TEST: 'TEST_STARTED', AUDIT: 'AUDIT_STARTED' };
const PASSED: Partial<Record<CimaPhase, CompanionFactName>> = { BUILD: 'BUILD_COMPLETED', TEST: 'TEST_COMPLETED', AUDIT: 'AUDIT_COMPLETED' };
const FAILED: Partial<Record<CimaPhase, CompanionFactName>> = { BUILD: 'BUILD_FAILED', TEST: 'TEST_FAILED', AUDIT: 'AUDIT_FAILED' };

/**
 * Translate one verified Alicia event into companion facts.
 *
 *   cima.phase.assigned (BUILD/TEST/AUDIT)          → *_STARTED
 *   cima.phase.changed  (BUILD/TEST/AUDIT, PASS)    → *_COMPLETED
 *   cima.phase.changed  (BUILD/TEST/AUDIT, FAIL…)   → *_FAILED
 *   approval.required                               → HUMAN_APPROVAL_REQUIRED
 *   approval.granted / approval.denied              → APPROVAL_RESOLVED
 *   request.proposed                                → REQUEST_PENDING
 *   request.confirmed / request.closed              → REQUEST_RESOLVED
 *
 * `audit.completed` is not mapped separately: the runtime emits it alongside the
 * AUDIT `cima.phase.changed`, which already carries the verdict.
 */
export function companionFactsFromAliciaEvent(ev: AliciaEvent | null | undefined): CompanionFact[] {
  if (!ev || typeof ev.type !== 'string') return [];
  const ref = typeof ev.ref === 'string' && ev.ref ? ev.ref : undefined;
  const withRef = (fact: CompanionFactName): CompanionFact[] => [ref ? { fact, ref } : { fact }];
  switch (ev.type) {
    case 'cima.phase.assigned': {
      const f = ev.phase ? STARTED[ev.phase] : undefined;
      return f ? withRef(f) : [];
    }
    case 'cima.phase.changed': {
      if (!ev.phase || !ev.verdict) return [];
      const f = ev.verdict === 'PASS' ? PASSED[ev.phase] : FAILED[ev.phase];
      return f ? withRef(f) : [];
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
