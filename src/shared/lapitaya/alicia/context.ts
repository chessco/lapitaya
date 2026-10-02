/**
 * AliciaContext — the small, explicit picture Alicia works from.
 *
 *   derived   recomputed on every read from the sources below; never persisted
 *   minimal   ids, a few labels and bounded lists — not a copy of the system
 *   scoped    one project, the task in focus, the recent past
 *   auditable `provenance` names the source of every field
 *
 * Alicia is not a second database. The sources of truth stay where they are:
 * CIMA records and the governance ledger (CimaRuntimeService), the task ledger
 * and registry (hive), locale settings (the UI's i18n store).
 */

import type { CimaPhase } from '../cima';
import type { RiskLevel } from '../autonomy';
import { resolveLocaleSettings, type LocaleSettings } from '../locales';
import type { AliciaEvent } from './events';
import type { AliciaNotification } from './notifications';
import type { CimaStatus } from './status';
import { displayAgent, type AgentNameResolver } from './messages';

export const MAX_RECENT_EVENTS = 20;
export const MAX_CONTEXT_NOTIFICATIONS = 5;

export type ContextProvenance = 'user' | 'hive' | 'task-ledger' | 'cima-runtime' | 'governance' | 'events' | 'settings' | 'none';

export interface AliciaContext {
  readonly user: { readonly id: 'human'; readonly displayName: string | null };
  readonly currentProject: { readonly root: string | null; readonly name: string | null } | null;
  readonly currentTask: { readonly id: string; readonly title: string | null; readonly status: string | null; readonly assignee: string | null } | null;
  /** The CIMA status of the task in focus (a derived, frozen snapshot). */
  readonly currentWorkflow: CimaStatus | null;
  readonly currentAgent: { readonly id: string; readonly name: string } | null;
  readonly currentCimaPhase: CimaPhase | null;
  readonly currentRisk: RiskLevel | null;
  readonly lastDecision: { readonly taskId: string; readonly verdict: string; readonly agentId: string; readonly ts: number } | null;
  readonly notifications: { readonly unread: number; readonly total: number; readonly latest: readonly AliciaNotification[] };
  readonly recentEvents: readonly AliciaEvent[];
  readonly uiLocale: string;
  readonly agentLocale: string;
  readonly notificationLocale: string;
  readonly provenance: Readonly<Record<string, ContextProvenance>>;
  readonly derivedAt: number;
}

export interface AliciaContextSources {
  now: number;
  locales?: Partial<LocaleSettings> | null;
  user?: { displayName?: string | null } | null;
  project?: { root?: string | null; name?: string | null } | null;
  /** HiveManager.tasks() — read to describe the task in focus. */
  tasks?: unknown;
  /** Newest last. */
  events: readonly AliciaEvent[];
  /** Newest last. */
  notifications?: readonly AliciaNotification[];
  /** Read-only view of the runtime for one task. */
  cimaStatus?: (taskId: string) => CimaStatus | null;
  /** The task the UI has selected, if any; otherwise the latest task in the events. */
  focusTaskId?: string | null;
  agentName?: AgentNameResolver;
}

function findTask(tasks: unknown, id: string): Record<string, unknown> | null {
  const list = Array.isArray(tasks) ? tasks : (tasks && typeof tasks === 'object' ? (tasks as { tasks?: unknown }).tasks : null);
  if (!Array.isArray(list)) return null;
  return (list.find((t) => t && typeof t === 'object' && (t as { id?: unknown }).id === id) as Record<string, unknown>) ?? null;
}

const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function deriveAliciaContext(src: AliciaContextSources): AliciaContext {
  const locales = resolveLocaleSettings(src.locales);
  const events = src.events.slice(-MAX_RECENT_EVENTS);
  const newestFirst = [...src.events].reverse();
  const provenance: Record<string, ContextProvenance> = {
    user: src.user ? 'user' : 'none',
    uiLocale: 'settings', agentLocale: 'settings', notificationLocale: 'settings',
    recentEvents: 'events', notifications: 'events'
  };

  const taskId = src.focusTaskId ?? newestFirst.find((e) => e.taskId)?.taskId ?? null;
  let currentTask: AliciaContext['currentTask'] = null;
  if (taskId) {
    const t = findTask(src.tasks, taskId);
    currentTask = { id: taskId, title: s(t?.title), status: s(t?.status), assignee: s(t?.assignee) };
    provenance.currentTask = t ? 'task-ledger' : 'events';
  }

  let currentWorkflow: CimaStatus | null = null;
  if (taskId && src.cimaStatus) {
    try { currentWorkflow = src.cimaStatus(taskId); } catch { currentWorkflow = null; }
    if (currentWorkflow) provenance.currentWorkflow = 'cima-runtime';
  }

  const agentEvent = newestFirst.find((e) => e.agentId && e.agentId !== 'human');
  const currentAgent = agentEvent?.agentId
    ? { id: agentEvent.agentId, name: displayAgent(agentEvent.agentId, locales.uiLocale, src.agentName) }
    : null;
  if (currentAgent) provenance.currentAgent = agentEvent!.source === 'hooks' ? 'hive' : agentEvent!.source === 'governance' ? 'governance' : 'events';

  const phaseEvent = newestFirst.find((e) => e.phase && (!taskId || e.taskId === taskId));
  const currentCimaPhase = currentWorkflow?.phase ?? phaseEvent?.phase ?? null;
  if (currentCimaPhase) provenance.currentCimaPhase = currentWorkflow?.phase ? 'cima-runtime' : 'events';

  // An approval is still pending when no later grant/denial for it was seen.
  const decided = new Set(src.events.filter((e) => e.type === 'approval.granted' || e.type === 'approval.denied').map((e) => e.ref));
  const pendingApproval = newestFirst.find((e) => e.type === 'approval.required' && !decided.has(e.ref));
  const currentRisk = (currentWorkflow?.risk ?? (pendingApproval?.technical?.risk as RiskLevel | undefined) ?? null);
  if (currentRisk) provenance.currentRisk = currentWorkflow?.risk ? 'cima-runtime' : 'governance';

  const decisionEvent = newestFirst.find((e) => e.phase === 'DECISION' && e.type === 'cima.phase.changed' && e.taskId && e.agentId && e.verdict);
  const lastDecision = decisionEvent
    ? { taskId: decisionEvent.taskId!, verdict: decisionEvent.verdict!, agentId: decisionEvent.agentId!, ts: decisionEvent.ts }
    : null;
  if (lastDecision) provenance.lastDecision = 'cima-runtime';

  const all = src.notifications ?? [];
  const currentProject = src.project ? { root: src.project.root ?? null, name: src.project.name ?? null } : null;
  if (currentProject) provenance.currentProject = 'hive';

  return Object.freeze({
    user: Object.freeze({ id: 'human' as const, displayName: src.user?.displayName ?? null }),
    currentProject,
    currentTask,
    currentWorkflow,
    currentAgent,
    currentCimaPhase,
    currentRisk,
    lastDecision,
    notifications: Object.freeze({
      unread: all.filter((n) => !n.read).length,
      total: all.length,
      latest: Object.freeze(all.slice(-MAX_CONTEXT_NOTIFICATIONS))
    }),
    recentEvents: Object.freeze(events),
    uiLocale: locales.uiLocale,
    agentLocale: locales.agentLocale,
    notificationLocale: locales.notificationLocale,
    provenance: Object.freeze(provenance),
    derivedAt: src.now
  });
}
