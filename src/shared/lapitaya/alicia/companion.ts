/**
 * The Alicia companion — state + preferences + the ports a host lends her.
 *
 * What Alicia is GIVEN (AliciaPorts) is the whole of what she can reach:
 *
 *   read   cimaStatus(taskId)   derived, frozen view of the runtime
 *          tasks() / project()  the hive's task ledger and project, read-only
 *          autonomyStage()      to preview governance the way the runtime would
 *   write  sendToOrchestrator() ONE outbound channel: a hive request to El Inge,
 *                               sent as ALICIA_ACTOR_ID
 *
 * There is deliberately no port for authorize/decide (governance), submit/handle
 * (CIMA claims), updateTaskStatus/patchTask/writeTasks (task state) or any tool
 * execution. A capability she is not handed cannot be misused, and nothing in
 * governance recognises her id as special (ALICIA-05/06/09).
 *
 * Companion state is small and locale-free: a bounded ring of AliciaEvents and
 * the ids the human has read. Notifications, context and presence are rendered
 * from it at read time (snapshot), in whatever locales the caller passes.
 */

import { resolveLocaleSettings, type LocaleSettings } from '../locales';
import { DEFAULT_AUTONOMY_STAGE, type AutonomyStage } from '../autonomy';
import type { AliciaEvent } from './events';
import type { AliciaCapability } from './registry';
import { ALICIA_IDENTITY, type AliciaIdentity } from './identity';
import { notificationFor, severityAtLeast, type AliciaNotification, type AliciaSeverity } from './notifications';
import { deriveAliciaContext, type AliciaContext } from './context';
import { derivePresence, type AliciaPresence } from './presence';
import { explainGovernance, type AgentNameResolver, type GovernanceExplanation } from './messages';
import type { CimaStatus } from './status';
import {
  previewGovernance, toOrchestratorRequest,
  type AliciaIntent, type GovernancePreview, type OrchestratorRequest
} from './intent';
import type { AliciaTechnical } from './events';

export interface AliciaPreferences {
  enabled: boolean;
  /** Notifications below this severity are kept as events but not surfaced. */
  minSeverity: AliciaSeverity;
  /** Size of the event ring. */
  maxEvents: number;
  locales: LocaleSettings;
}

export const DEFAULT_ALICIA_PREFERENCES: Readonly<AliciaPreferences> = Object.freeze({
  enabled: true,
  minSeverity: 'info',
  maxEvents: 100,
  locales: resolveLocaleSettings(null)
});

export function resolveAliciaPreferences(p: Partial<AliciaPreferences> | null | undefined): AliciaPreferences {
  const maxEvents = typeof p?.maxEvents === 'number' && p.maxEvents > 0 ? Math.min(Math.floor(p.maxEvents), 1000) : DEFAULT_ALICIA_PREFERENCES.maxEvents;
  return {
    enabled: p?.enabled ?? DEFAULT_ALICIA_PREFERENCES.enabled,
    minSeverity: p?.minSeverity ?? DEFAULT_ALICIA_PREFERENCES.minSeverity,
    maxEvents,
    locales: resolveLocaleSettings(p?.locales)
  };
}

export interface AliciaPorts {
  cimaStatus?(taskId: string): CimaStatus | null;
  tasks?(): unknown;
  project?(): { root: string | null; name: string | null } | null;
  agentName?: AgentNameResolver;
  autonomyStage?(): AutonomyStage;
  orchestratorId(): string;
  sendToOrchestrator(request: OrchestratorRequest): { ok: boolean; error?: string };
}

export interface AliciaCompanionState {
  identity: AliciaIdentity;
  enabled: boolean;
  context: AliciaContext;
  presence: AliciaPresence;
  /** Newest last, rendered in notificationLocale. */
  notifications: readonly AliciaNotification[];
}

export interface AliciaRequestResult {
  /** A request reached El Inge's inbox (prepare/request intents only). */
  delivered: boolean;
  to: string | null;
  preview: GovernancePreview | null;
  /** Alicia never executes. Present so no caller can mistake a result for execution. */
  readonly executed: false;
  error?: string;
}

export interface AliciaCompanion extends AliciaCapability {
  snapshot(opts?: { locales?: Partial<LocaleSettings> | null; focusTaskId?: string | null; now?: number }): AliciaCompanionState;
  markRead(notificationId: string): boolean;
  explain(technical: AliciaTechnical, locale?: string | null): GovernanceExplanation;
  request(intent: AliciaIntent): AliciaRequestResult;
  setPreferences(p: Partial<AliciaPreferences>): void;
}

export function createAliciaCompanion(opts: {
  ports: AliciaPorts;
  preferences?: Partial<AliciaPreferences>;
  now?: () => number;
}): AliciaCompanion {
  const { ports } = opts;
  const now = opts.now ?? (() => Date.now());
  let prefs = resolveAliciaPreferences(opts.preferences);
  const events: { id: string; event: AliciaEvent }[] = [];
  const read = new Set<string>();
  let seq = 0;

  const notifications = (locale: string): AliciaNotification[] =>
    events
      .map(({ id, event }) => notificationFor(event, { id, locale, read: read.has(id), agentName: ports.agentName }))
      .filter((n) => severityAtLeast(n.severity, prefs.minSeverity));

  return {
    id: 'alicia-companion-v0.4',
    get enabled() { return prefs.enabled; },

    notify(event) {
      if (!prefs.enabled || !event || typeof event.type !== 'string') return;
      events.push({ id: `aln-${(++seq).toString(36)}`, event: Object.freeze({ ...event }) });
      if (events.length > prefs.maxEvents) {
        for (const dropped of events.splice(0, events.length - prefs.maxEvents)) read.delete(dropped.id);
      }
    },

    snapshot(o = {}) {
      // Only the locales the caller actually passed override the preferences.
      const given = Object.fromEntries(Object.entries(o.locales ?? {}).filter(([, v]) => typeof v === 'string' && v));
      const locales = resolveLocaleSettings({ ...prefs.locales, ...given });
      const list = notifications(locales.notificationLocale);
      const safe = <T>(f: (() => T) | undefined): T | undefined => { try { return f?.(); } catch { return undefined; } };
      const context = deriveAliciaContext({
        now: o.now ?? now(),
        locales,
        project: safe(ports.project ? () => ports.project!() : undefined) ?? null,
        tasks: safe(ports.tasks ? () => ports.tasks!() : undefined),
        events: events.map((e) => e.event),
        notifications: list,
        cimaStatus: ports.cimaStatus ? (id) => ports.cimaStatus!(id) : undefined,
        focusTaskId: o.focusTaskId ?? null,
        agentName: ports.agentName
      });
      return Object.freeze({
        identity: ALICIA_IDENTITY,
        enabled: prefs.enabled,
        context,
        presence: derivePresence(list.filter((n) => !n.read)),
        notifications: Object.freeze(list)
      });
    },

    markRead(notificationId) {
      if (!events.some((e) => e.id === notificationId)) return false;
      read.add(notificationId);
      return true;
    },

    explain(technical, locale) {
      return explainGovernance(technical, locale ?? prefs.locales.uiLocale);
    },

    request(intent) {
      const preview = intent.action ? previewGovernance(intent.action, ports.autonomyStage?.() ?? DEFAULT_AUTONOMY_STAGE) : null;
      if (!prefs.enabled) return { delivered: false, to: null, preview, executed: false, error: 'Alicia is disabled' };
      let to: string;
      try { to = ports.orchestratorId(); } catch { return { delivered: false, to: null, preview, executed: false, error: 'orchestrator unavailable' }; }
      const req = toOrchestratorRequest(intent, to, preview);
      if (!req) return { delivered: false, to: null, preview, executed: false };
      try {
        const r = ports.sendToOrchestrator(req);
        return { delivered: !!r?.ok, to, preview, executed: false, ...(r?.ok ? {} : { error: r?.error ?? 'not delivered' }) };
      } catch (e) {
        return { delivered: false, to, preview, executed: false, error: String(e).slice(0, 200) };
      }
    },

    setPreferences(p) {
      prefs = resolveAliciaPreferences({ ...prefs, ...p, locales: { ...prefs.locales, ...(p.locales ?? {}) } });
    }
  };
}
