/**
 * AliciaNotification — one event, presented to the human.
 *
 * Built at read time from a stored, locale-free AliciaEvent, so switching
 * notificationLocale re-renders every notification and nothing localized is
 * ever persisted. The technical detail and the evidence travel with the words:
 * Alicia may soften the phrasing, never hide the real reason.
 *
 * `action` only ever points the human at an existing surface (the governance
 * approvals panel, a task). It is `humanOnly`: Alicia cannot perform it.
 */

import type { VerifiedEvidence } from '../cimaRuntime';
import type { AliciaEvent, AliciaEventType, AliciaSource, AliciaTechnical } from './events';
import { aliciaText, displayAgent, explainGovernance, phaseLabel, type AgentNameResolver } from './messages';

export const ALICIA_NOTIFICATION_TYPES = ['INFO', 'SUCCESS', 'WARNING', 'BLOCKED', 'APPROVAL_REQUIRED', 'ERROR'] as const;
export type AliciaNotificationType = (typeof ALICIA_NOTIFICATION_TYPES)[number];

export const ALICIA_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type AliciaSeverity = (typeof ALICIA_SEVERITIES)[number];

export interface AliciaNotificationAction {
  kind: 'open-approvals' | 'open-task';
  ref: string;
  /** Only the human can act on this; Alicia merely points at it. */
  readonly humanOnly: true;
}

export interface AliciaNotification {
  id: string;
  eventType: AliciaEventType;
  type: AliciaNotificationType;
  severity: AliciaSeverity;
  title: string;
  message: string;
  timestamp: number;
  source: AliciaSource;
  context: { taskId?: string; agentId?: string; phase?: string };
  /** Verbatim runtime detail (risk, rule, decision, tool, reason). */
  technical: Readonly<AliciaTechnical>;
  /** Verbatim evidence the runtime recorded, if the event carried any. */
  evidence: readonly VerifiedEvidence[];
  action: AliciaNotificationAction | null;
  read: boolean;
}

const KIND: Readonly<Record<AliciaEventType, [AliciaNotificationType, AliciaSeverity]>> = {
  'task.created': ['INFO', 'info'],
  'task.started': ['INFO', 'info'],
  'task.blocked': ['WARNING', 'medium'],
  'task.completed': ['SUCCESS', 'info'],
  'agent.started': ['INFO', 'info'],
  'agent.completed': ['INFO', 'info'],
  'agent.failed': ['ERROR', 'medium'],
  'cima.phase.assigned': ['INFO', 'info'],
  'cima.phase.changed': ['SUCCESS', 'info'],
  'governance.blocked': ['BLOCKED', 'high'],
  'governance.supervised': ['INFO', 'low'],
  'approval.required': ['APPROVAL_REQUIRED', 'high'],
  'approval.granted': ['SUCCESS', 'info'],
  'approval.denied': ['WARNING', 'low'],
  'audit.completed': ['SUCCESS', 'info'],
  'workflow.completed': ['SUCCESS', 'info'],
  error: ['ERROR', 'high']
};

function classify(e: AliciaEvent): [AliciaNotificationType, AliciaSeverity] {
  const base = KIND[e.type];
  if ((e.type === 'cima.phase.changed' || e.type === 'audit.completed') && e.verdict && e.verdict !== 'PASS') {
    return e.verdict === 'BLOCKED' ? ['BLOCKED', 'medium'] : ['WARNING', 'medium'];
  }
  return base;
}

export function severityAtLeast(s: AliciaSeverity, min: AliciaSeverity): boolean {
  return ALICIA_SEVERITIES.indexOf(s) >= ALICIA_SEVERITIES.indexOf(min);
}

export function notificationFor(
  event: AliciaEvent,
  opts: { id: string; locale: string | null | undefined; read?: boolean; agentName?: AgentNameResolver }
): AliciaNotification {
  const { locale } = opts;
  const [type, severity] = classify(event);
  const technical = Object.freeze({ ...(event.technical ?? {}) });
  const governed = event.type.startsWith('governance.') || event.type.startsWith('approval.');
  const explanation = governed ? explainGovernance(technical, locale).text : '';
  const key = `alicia.notifications.${event.type.replace(/\./g, '_')}`;
  const vars = {
    task: event.taskId ? (event.subject && !governed ? `${event.taskId} (${event.subject})` : event.taskId) : '',
    agent: displayAgent(event.agentId, locale, opts.agentName),
    from: displayAgent(event.fromAgentId, locale, opts.agentName),
    phase: event.phase ?? '',
    phaseLabel: event.phase ? phaseLabel(locale, event.phase) : '',
    verdict: event.verdict ?? '',
    rule: technical.rule ?? technical.decision ?? '',
    explanation
  };
  let action: AliciaNotificationAction | null = null;
  if (event.type === 'approval.required' && technical.approvalId) action = { kind: 'open-approvals', ref: technical.approvalId, humanOnly: true };
  else if (event.taskId) action = { kind: 'open-task', ref: event.taskId, humanOnly: true };
  return {
    id: opts.id,
    eventType: event.type,
    type,
    severity,
    title: aliciaText(locale, `${key}.title`, vars),
    message: aliciaText(locale, `${key}.message`, vars),
    timestamp: event.ts,
    source: event.source,
    context: {
      ...(event.taskId ? { taskId: event.taskId } : {}),
      ...(event.agentId ? { agentId: event.agentId } : {}),
      ...(event.phase ? { phase: event.phase } : {})
    },
    technical,
    evidence: Object.freeze((event.evidence ?? []).map((e) => ({ ...e }))),
    action,
    read: opts.read ?? false
  };
}
