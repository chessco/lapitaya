/**
 * The Alicia companion — state + preferences + the ports a host lends her.
 *
 * What Alicia is GIVEN (AliciaPorts) is the whole of what she can reach:
 *
 *   read   cimaStatus(taskId)   derived, frozen view of the runtime
 *          tasks() / project()  the hive's task ledger and project, read-only
 *   out    submitIntent(intent) ONE outbound channel (v0.4.1): the runtime's
 *                               intent boundary. It re-classifies the intent,
 *                               applies CIMA governance and is the only one that
 *                               may forward it to El Inge.
 *
 * There is deliberately no port for hive messaging, authorize/decide
 * (governance), submit/handle (CIMA claims), updateTaskStatus/patchTask/
 * writeTasks (task state) or any tool execution. A capability she is not
 * handed cannot be misused, and nothing in governance recognises her id as
 * special (ALICIA-05/06/09, INTENT-ARCH).
 *
 * Companion state is small and locale-free: a bounded ring of AliciaEvents and
 * the ids the human has read. Notifications, context and presence are rendered
 * from it at read time (snapshot), in whatever locales the caller passes.
 */

import { resolveLocaleSettings, type LocaleSettings } from '../locales';
import type { AliciaIntent, IntentOutcome, IntentTarget } from '../intent';
import type { RiskLevel } from '../autonomy';
import type { AliciaEvent, AliciaTechnical } from './events';
import type { AliciaCapability } from './registry';
import { ALICIA_IDENTITY, type AliciaIdentity } from './identity';
import { notificationFor, severityAtLeast, type AliciaNotification, type AliciaSeverity } from './notifications';
import { deriveAliciaContext, type AliciaContext } from './context';
import { derivePresence, type AliciaPresence } from './presence';
import { explainGovernance, type AgentNameResolver, type GovernanceExplanation } from './messages';
import type { CimaStatus } from './status';
import { createAliciaIntent } from './intent';
import { statusReply, type AliciaReply } from './conversation';

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
  /** The ONLY outbound path: the runtime intent boundary. */
  submitIntent(intent: AliciaIntent): IntentOutcome;
}

export interface AliciaCompanionState {
  identity: AliciaIdentity;
  enabled: boolean;
  context: AliciaContext;
  presence: AliciaPresence;
  /** Newest last, rendered in notificationLocale. */
  notifications: readonly AliciaNotification[];
}

export interface AliciaSubmitOptions {
  taskId?: string | null;
  target?: IntentTarget | null;
  suggestedRisk?: RiskLevel | null;
  locales?: Partial<LocaleSettings> | null;
}

export interface AliciaSubmitResult {
  /** The intent exactly as Alicia handed it to the runtime. */
  intent: AliciaIntent;
  /** The runtime's answer (classification, risk, decision, route). */
  outcome: IntentOutcome;
  /** Alicia's own reply when the runtime kept it a CONVERSATION. */
  reply: AliciaReply | null;
  /** Alicia never executes. */
  readonly executed: false;
}

export interface AliciaCompanion extends AliciaCapability {
  snapshot(opts?: { locales?: Partial<LocaleSettings> | null; focusTaskId?: string | null; now?: number }): AliciaCompanionState;
  markRead(notificationId: string): boolean;
  explain(technical: AliciaTechnical, locale?: string | null): GovernanceExplanation;
  /** Turn what the human said into an intent and hand it to the runtime boundary. */
  submit(message: string, opts?: AliciaSubmitOptions): AliciaSubmitResult;
  setPreferences(p: Partial<AliciaPreferences>): void;
}

function mergeLocales(base: LocaleSettings, given: Partial<LocaleSettings> | null | undefined): LocaleSettings {
  // Only the locales the caller actually passed override the preferences.
  const defined = Object.fromEntries(Object.entries(given ?? {}).filter(([, v]) => typeof v === 'string' && v));
  return resolveLocaleSettings({ ...base, ...defined });
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
  let intentSeq = 0;

  const notifications = (locale: string): AliciaNotification[] =>
    events
      .map(({ id, event }) => notificationFor(event, { id, locale, read: read.has(id), agentName: ports.agentName }))
      .filter((n) => severityAtLeast(n.severity, prefs.minSeverity));

  const snapshot: AliciaCompanion['snapshot'] = (o = {}) => {
    const locales = mergeLocales(prefs.locales, o.locales);
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
  };

  return {
    id: 'alicia-companion-v0.4.1',
    get enabled() { return prefs.enabled; },

    notify(event) {
      if (!prefs.enabled || !event || typeof event.type !== 'string') return;
      events.push({ id: `aln-${(++seq).toString(36)}`, event: Object.freeze({ ...event }) });
      if (events.length > prefs.maxEvents) {
        for (const dropped of events.splice(0, events.length - prefs.maxEvents)) read.delete(dropped.id);
      }
    },

    snapshot,

    markRead(notificationId) {
      if (!events.some((e) => e.id === notificationId)) return false;
      read.add(notificationId);
      return true;
    },

    explain(technical, locale) {
      return explainGovernance(technical, locale ?? prefs.locales.uiLocale);
    },

    submit(message, o = {}) {
      const t = now();
      const locales = mergeLocales(prefs.locales, o.locales);
      const intent = createAliciaIntent(message, {
        id: `int-${t.toString(36)}-${(++intentSeq).toString(36)}`,
        now: t,
        taskId: o.taskId ?? null,
        uiLocale: locales.uiLocale,
        target: o.target ?? null,
        suggestedRisk: o.suggestedRisk ?? null
      });
      let outcome: IntentOutcome;
      try {
        outcome = ports.submitIntent(intent);
      } catch (e) {
        outcome = {
          id: intent.id, status: 'BLOCKED', claimedType: intent.type, type: null, reclassified: false,
          claimedRisk: intent.risk, risk: null, decision: 'DENY', rule: 'BOUNDARY_UNAVAILABLE', route: 'none',
          signals: [], reason: String(e).slice(0, 200), executed: false
        };
      }
      const reply = outcome.route === 'producer'
        ? statusReply(snapshot({ locales, focusTaskId: o.taskId ?? null }).context, locales.uiLocale)
        : null;
      return { intent, outcome, reply, executed: false };
    },

    setPreferences(p) {
      prefs = resolveAliciaPreferences({ ...prefs, ...p, locales: { ...prefs.locales, ...(p.locales ?? {}) } });
    }
  };
}
