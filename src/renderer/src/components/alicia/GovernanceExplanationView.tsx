import type { CSSProperties } from 'react';
import { observationVars, type GovernanceObservation, type ObservabilityView } from '@shared/lapitaya/alicia/observability';

/**
 * La Pitaya Alicia v0.6 — governance explanation, rendered from the runtime's
 * read-only projection. Every value shown is a runtime fact or "No disponible";
 * every sentence is an i18n key the projection selected deterministically.
 * Nothing here is editable or clickable except the native timeline toggle.
 */

type T = (key: string, opts?: Record<string, unknown>) => string;
const NS = 'lapitaya:alicia.observe';

const muted: CSSProperties = { fontSize: 11, color: 'var(--cth-ink-500)' };
const mono: CSSProperties = { fontFamily: 'var(--cth-font-mono)', fontSize: 11 };
const dl: CSSProperties = { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 8, rowGap: 2, margin: '4px 0 0', fontSize: 11 };
const dd: CSSProperties = { margin: 0 };

function vars(t: T, o: GovernanceObservation): Record<string, unknown> {
  return { ...observationVars(o), riskLabel: o.risk ? t(`lapitaya:autonomy.risk.${o.risk}`).toLowerCase() : '' };
}
const k = (key: string) => `lapitaya:${key}`;
const time = (ts: number | null) => (ts === null ? '—' : new Date(ts).toISOString().slice(11, 19));

/** "¿Qué ocurrió? / ¿Por qué? / Riesgo / Autonomía / Regla / ¿Qué sigue? / Evidencia" for one fact. */
export function ObservationExplanation({ t, obs, headingLevel = 'h4' }: { t: T; obs: GovernanceObservation; headingLevel?: 'h4' | 'h5' }) {
  const v = vars(t, obs);
  const na = <span style={muted}>{t(`${NS}.notAvailable`)}</span>;
  const H = headingLevel;
  const blocking = obs.nextState === 'NOT_EXECUTED' || obs.nextState === 'WAITING_HUMAN_APPROVAL' || obs.nextState === 'TASK_NOT_COMPLETED';
  return (
    <article
      data-observation={obs.category}
      data-event-id={obs.eventId}
      data-next={obs.nextState}
      aria-label={t(k(obs.keys.what), v)}
      style={{ fontSize: 12 }}
    >
      <H style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>
        {t(k(obs.keys.what), v)}
        {obs.count > 1 && <span data-field="count" style={{ ...muted, marginInlineStart: 6 }}>{t(`${NS}.repeated`, { count: obs.count })}</span>}
      </H>
      <dl style={dl}>
        <dt>{t(`${NS}.labels.why`)}</dt>
        <dd data-field="why" style={dd}>{t(k(obs.keys.why), v)}</dd>
        <dt>{t(`${NS}.labels.state`)}</dt>
        <dd data-field="state" style={dd}><code style={mono}>{obs.category}</code>{obs.runtimeStatus && <> · <code style={mono}>{obs.runtimeStatus}</code></>}</dd>
        <dt>{t(`${NS}.labels.risk`)}</dt>
        <dd data-field="risk" style={dd}>{obs.risk ? <><b>{obs.risk}</b> · {t(`lapitaya:autonomy.risk.${obs.risk}`)}</> : na}</dd>
        {obs.scope && (<>
          <dt>{t(`${NS}.labels.scope`)}</dt>
          <dd data-field="scope" style={dd}><b>{obs.scope}</b></dd>
        </>)}
        <dt>{t(`${NS}.labels.autonomy`)}</dt>
        <dd data-field="autonomy" style={dd}>{obs.keys.autonomy ? t(k(obs.keys.autonomy)) : na}</dd>
        <dt>{t(`${NS}.labels.rule`)}</dt>
        <dd data-field="rule" style={dd}>{obs.rule ? <code style={mono}>{obs.rule}</code> : na}</dd>
        <dt>{t(`${NS}.labels.next`)}</dt>
        <dd data-field="next" style={{ ...dd, fontWeight: blocking ? 700 : 400 }}>{t(k(obs.keys.next), v)}</dd>
        {obs.keys.humanAction && (<>
          <dt>{t(`${NS}.labels.humanAction`)}</dt>
          <dd data-field="human-action" style={{ ...dd, fontWeight: 700 }}>{t(k(obs.keys.humanAction), v)}</dd>
        </>)}
        <dt>{t(`${NS}.evidence`)}</dt>
        <dd data-field="evidence" style={dd}>
          {obs.evidence ? <code style={mono}>{obs.evidence.source} · {obs.evidence.ref}</code> : <span style={muted}>{t(`${NS}.noEvidence`)}</span>}
        </dd>
      </dl>
    </article>
  );
}

/** A REQUEST card's governance block: its latest fact and its read-only timeline. */
export function ProposalGovernance({ t, proposalId, entry }: {
  t: T; proposalId: string;
  entry: { timeline: readonly GovernanceObservation[]; latest: GovernanceObservation | null } | undefined;
}) {
  if (!entry || !entry.latest) return null;
  const listId = `alicia-timeline-${proposalId}`;
  return (
    <div data-field="governance" style={{ margin: '6px 0', paddingTop: 6, borderTop: '1px dashed var(--cth-ink-300)' }}>
      <div style={{ ...muted, fontWeight: 700, marginBottom: 2 }}>{t(`${NS}.sectionTitle`)}</div>
      <ObservationExplanation t={t} obs={entry.latest} headingLevel="h5" />
      <details data-field="timeline" style={{ marginTop: 4, fontSize: 11 }}>
        <summary>{t(`${NS}.timelineToggle`, { count: entry.timeline.length })}</summary>
        <ol id={listId} aria-label={t(`${NS}.timelineLabel`, { proposalId })} style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
          {entry.timeline.map((o) => (
            <li key={o.eventId} data-observation={o.category} data-event-id={o.eventId}>
              <time style={mono}>{time(o.timestamp)}</time>{' '}
              <code style={mono}>{o.category}</code>{' '}
              {t(k(o.keys.what), vars(t, o))}
              {o.count > 1 && <span style={{ ...muted, marginInlineStart: 4 }}>{t(`${NS}.repeated`, { count: o.count })}</span>}
              {o.evidence && <span style={{ ...muted, marginInlineStart: 4 }}>· {o.evidence.ref}</span>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

/** Recent relevant facts across the floor (blocks, confirmations, approvals, completion, execution). */
export function GovernanceActivity({ t, view }: { t: T; view: ObservabilityView }) {
  return (
    <section data-field="governance-activity" aria-labelledby="alicia-governance-activity" style={{ marginBottom: 8 }}>
      <h3 id="alicia-governance-activity" style={{ margin: '0 0 2px', fontFamily: 'var(--cth-font-display)', fontSize: 9, color: 'var(--cth-ink-700)' }}>
        {t(`${NS}.activityTitle`)}
      </h3>
      <div style={{ ...muted, marginBottom: 4 }}>{t(`${NS}.activityHint`)}</div>
      {view.recent.length === 0
        ? <div style={muted}>{t(`${NS}.activityEmpty`)}</div>
        : (
          <ul aria-live="polite" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {view.recent.map((o) => (
              <li key={o.eventId} style={{ padding: '6px 8px', marginBottom: 6, background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
                <ObservationExplanation t={t} obs={o} />
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
