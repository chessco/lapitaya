import type { CSSProperties, ReactNode } from 'react';
import type { GovernanceObservation } from '@shared/lapitaya/alicia/observability';
import type { DecisionCenterModel, HighDecisionView } from './decisionCenter';
import { FactTimeline, ObservationExplanation } from './GovernanceExplanationView';

/**
 * La Pitaya Alicia v0.7 — Human Decisions (Decision Center), pure render.
 * Pending REQUEST confirmations and pending HIGH approvals in one place, each
 * with the runtime's explanation, evidence and timeline (v0.6 projection).
 * REQUEST cards are the v0.5 cards (passed in); HIGH cards are here. The two
 * mechanisms stay distinct in words, controls and IPC.
 */

type T = (key: string, opts?: Record<string, unknown>) => string;
const NS = 'lapitaya:alicia.decisions';

const box: CSSProperties = {
  padding: '8px 10px', marginBottom: 8,
  background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)'
};
const highBox: CSSProperties = { ...box, boxShadow: 'inset 0 0 0 2px var(--cth-ink-900)' };
const btn: CSSProperties = {
  padding: '3px 10px', marginInlineEnd: 8, border: 'none', cursor: 'pointer',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12,
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', background: 'var(--cth-cream-50, #fff)', color: 'var(--cth-ink-900)'
};
const approveBtn: CSSProperties = { ...btn, fontWeight: 700, boxShadow: 'inset 0 0 0 2px var(--cth-ink-900)' };
const muted: CSSProperties = { fontSize: 11, color: 'var(--cth-ink-500)' };
const mono: CSSProperties = { fontFamily: 'var(--cth-font-mono)', fontSize: 11 };
const badge: CSSProperties = { display: 'inline-block', padding: '0 6px', marginBottom: 4, fontSize: 10, fontWeight: 700, boxShadow: 'inset 0 0 0 1px currentColor' };
const h3: CSSProperties = { margin: '8px 0 4px', fontSize: 11, fontWeight: 700, color: 'var(--cth-ink-700)' };
const time = (ts: number | null) => (ts === null ? '—' : new Date(ts).toISOString().replace('T', ' ').slice(0, 19));

/** One pending (or just-decided) HIGH-risk human approval. */
export function HighApprovalCard({ t, d, acknowledged, onAcknowledge, onApprove, onReject }: {
  t: T; d: HighDecisionView; acknowledged: boolean;
  onAcknowledge(id: string, value: boolean): void; onApprove(id: string): void; onReject(id: string): void;
}) {
  const base = `alicia-high-${d.approvalId}`;
  const o = d.fact;
  const failed = d.outcome && !d.outcome.ok ? d.outcome.code : null;
  return (
    <section
      id={base}
      aria-labelledby={`${base}-h`}
      data-decision-type="HIGH_APPROVAL"
      data-approval-id={d.approvalId}
      data-ui-state={d.uiState}
      data-risk={o.risk ?? ''}
      style={highBox}
    >
      <span data-field="decision-type" style={badge}>{t(`${NS}.type.HIGH_APPROVAL`)}</span>
      <div id={`${base}-h`} tabIndex={-1} style={{ fontWeight: 700, marginBottom: 4 }}>{t(`${NS}.highState.${d.uiState}`)}</div>
      <p id={`${base}-meaning`} style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700 }}>{t(`${NS}.typeMeaning.HIGH_APPROVAL`)}</p>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 8, rowGap: 2, margin: '0 0 6px', fontSize: 11 }}>
        <dt>approvalId</dt>
        <dd data-field="approvalId" style={{ margin: 0 }}><code style={mono}>{d.approvalId}</code></dd>
        <dt>{t(`${NS}.fields.agent`)}</dt>
        <dd data-field="agent" style={{ margin: 0 }}>{o.agent ? <code style={mono}>{o.agent}</code> : <span style={muted}>{t('lapitaya:alicia.observe.notAvailable')}</span>}</dd>
        <dt>{t(`${NS}.fields.operation`)}</dt>
        <dd data-field="operation" style={{ margin: 0 }}>{o.operation ? <code style={mono}>{o.operation}</code> : <span style={muted}>{t('lapitaya:alicia.observe.notAvailable')}</span>}</dd>
        {o.taskId && (<>
          <dt>{t(`${NS}.fields.task`)}</dt>
          <dd data-field="task" style={{ margin: 0 }}><code style={mono}>{o.taskId}</code></dd>
        </>)}
        {o.proposalId && (<>
          <dt>{t(`${NS}.fields.request`)}</dt>
          <dd data-field="related-request" style={{ margin: 0 }}><code style={mono}>{o.proposalId}</code></dd>
        </>)}
        <dt>{t(`${NS}.fields.created`)}</dt>
        <dd data-field="created" style={{ margin: 0 }}>{time(o.timestamp)}</dd>
      </dl>
      {o.proposalId && <p data-field="not-a-confirmation" style={{ ...muted, margin: '0 0 6px' }}>{t(`${NS}.relatedRequest`, { proposalId: o.proposalId })}</p>}
      <p style={{ ...muted, margin: '0 0 6px' }}>{t(`${NS}.exactCallNote`)}</p>

      <ObservationExplanation t={t} obs={o} headingLevel="h5" />
      <FactTimeline t={t} id={`${base}-timeline`} timeline={d.timeline} labelKey={`${NS}.timelineLabel`} labelVars={{ approvalId: d.approvalId }} />

      <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'} data-field="outcome" style={{ fontSize: 11, margin: '6px 0' }}>
        {failed && <><span>{t(`${NS}.errors.${failed}`)}</span>{' '}<code style={mono}>{failed}</code>{' '}<span style={muted}>{t('lapitaya:alicia.confirmation.noRetry')}</span></>}
        {!failed && d.outcome?.ok && <span>{t(`${NS}.said.${d.outcome.op === 'approve' ? 'approved' : 'rejected'}`)}</span>}
      </div>

      {d.pending && (<>
        <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 6, fontSize: 11 }}>
          <input
            type="checkbox"
            data-action="acknowledge-high"
            checked={acknowledged}
            disabled={!d.canDecide}
            onChange={(e) => onAcknowledge(d.approvalId, e.currentTarget.checked)}
          />
          <span>{t(`${NS}.ack`)}</span>
        </label>
        <div role="group" aria-label={t(`${NS}.decisionGroup`)}>
          <button type="button" style={btn} data-action="reject-high" disabled={!d.canDecide}
            aria-busy={d.uiState === 'REJECTING'} aria-describedby={`${base}-meaning`} onClick={() => onReject(d.approvalId)}>
            {t(`${NS}.reject`)}
          </button>
          <button type="button" style={approveBtn} data-action="approve-high" disabled={!d.canDecide || !acknowledged}
            aria-busy={d.uiState === 'APPROVING'} aria-describedby={`${base}-meaning`} onClick={() => onApprove(d.approvalId)}>
            {t(`${NS}.approve`)}
          </button>
        </div>
      </>)}
    </section>
  );
}

/** Resolved human decisions, as the runtime recorded them (read only). */
export function DecisionHistory({ t, history }: { t: T; history: readonly GovernanceObservation[] }) {
  if (!history.length) return <p style={muted}>{t(`${NS}.historyEmpty`)}</p>;
  return (
    <ol data-field="decision-history" aria-label={t(`${NS}.historyTitle`)} style={{ margin: 0, paddingInlineStart: 18, fontSize: 11 }}>
      {history.map((o) => (
        <li key={o.eventId} data-observation={o.category} data-event-id={o.eventId} style={{ marginBottom: 2 }}>
          <time style={mono}>{time(o.timestamp)}</time>{' '}
          <code style={mono}>{o.category}</code>{' '}
          {t(`lapitaya:${o.keys.what}`, { proposalId: o.proposalId ?? '—', approvalId: o.approvalId ?? '—', agent: o.agent ?? '—', operation: o.operation ?? '—', decision: o.decision ?? '—' })}
          {o.rule && <> · <code style={mono}>{o.rule}</code></>}
          {o.evidence && <span style={{ ...muted, marginInlineStart: 4 }}>· {o.evidence.ref}</span>}
        </li>
      ))}
    </ol>
  );
}

/** The Decision Center: summary, the REQUEST ≠ HIGH distinction, pending decisions, history. */
export function DecisionCenterSection({ t, model, requestCards, highCards }: {
  t: T; model: DecisionCenterModel; requestCards: ReactNode; highCards: ReactNode;
}) {
  return (
    <section data-decision-center aria-labelledby="alicia-decision-center" style={{ marginBottom: 10 }}>
      <h2 id="alicia-decision-center" style={{ margin: '0 0 2px', fontFamily: 'var(--cth-font-display)', fontSize: 10, color: 'var(--cth-ink-900)' }}>
        {t(`${NS}.title`)}
      </h2>
      <p role="status" data-field="decision-counts" style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700 }}>
        {model.counts.total
          ? t(`${NS}.counts`, { total: model.counts.total, requests: model.counts.requests, high: model.counts.high })
          : t(`${NS}.none`)}
      </p>
      <p data-field="distinction" style={{ ...muted, margin: '0 0 6px' }}>{t(`${NS}.distinction`)}</p>
      {!model.observed && <p role="alert" style={{ ...muted, margin: '0 0 6px' }}>{t(`${NS}.unobserved`)}</p>}
      <h3 style={h3}>{t(`${NS}.highTitle`)}</h3>
      {model.high.length ? highCards : <p style={muted}>{t(`${NS}.noHigh`)}</p>}
      <h3 style={h3}>{t(`${NS}.requestTitle`)}</h3>
      {requestCards}
      <details data-field="history" style={{ marginTop: 6, fontSize: 11 }}>
        <summary>{t(`${NS}.historyToggle`, { count: model.history.length })}</summary>
        <DecisionHistory t={t} history={model.history} />
      </details>
    </section>
  );
}
