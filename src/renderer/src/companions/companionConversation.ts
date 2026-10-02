/**
 * Companion conversation — friendly talk, never runtime telemetry (FASE 2 remediation).
 *
 * These lines are shown as `conversation` bubbles. They deliberately say nothing about
 * tasks, agents, builds, tests, audits or approvals: a statement about runtime state
 * must come from a verified runtime fact in the main process, never from here.
 */

import { LA_PITAYA_AGENT_BY_ID, type LaPitayaAgentId } from '@shared/lapitaya/agents';

export const GREETING_LINE = 'Hola. ¿En qué puedo ayudarte?';

export const CONVERSATION_LINES: readonly string[] = [
  'Hola. Aquí estoy si me necesitas.',
  'Cuando quieras platicar, abre La Pitaya.',
  'Tú tienes la última palabra en cada decisión.',
  'Me gusta acompañarte mientras trabajas.'
];

/** Which companion this window renders (`?agent=`), defaulting to Alicia for unknown ids. */
export function companionAgentFromSearch(search: string): LaPitayaAgentId {
  const id = new URLSearchParams(search).get('agent');
  return id && Object.prototype.hasOwnProperty.call(LA_PITAYA_AGENT_BY_ID, id) ? (id as LaPitayaAgentId) : 'alicia';
}
