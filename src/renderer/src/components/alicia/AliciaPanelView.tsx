import type { CSSProperties, FormEvent } from 'react';
import type { AliciaSubmitResult } from '@shared/lapitaya/alicia';
import type { ObservabilityView } from '@shared/lapitaya/alicia/observability';
import { EXPLAINED_CODES, type ConfirmationSnapshot, type ProposalView } from './confirmationController';
import { GovernanceActivity, GovernanceHealthBanner, ProposalGovernance } from './GovernanceExplanationView';
import type { AcknowledgedIds, DecisionCenterModel, HighDecisionView } from './decisionCenter';
import { DecisionCenterSection, HighApprovalCard } from './DecisionCenterView';

/**
 * La Pitaya Alicia v0.5 — the Human Confirmation UI, as a pure render of the
 * runtime's state (no window, no IPC, no i18n instance: `t` is passed in).
 * The container (AliciaPanel.tsx) wires it to the human-channel IPC.
 */

export type T = (key: string, opts?: Record<string, unknown>) => string;

export const NS = 'lapitaya:alicia.confirmation';

export interface AliciaLine { from: 'human' | 'alicia'; text: string }

export interface AliciaPanelViewProps {
  t: T;
  snapshot: ConfirmationSnapshot;
  presence: string | null;
  /** Per-card "I have read it" acknowledgement — the Confirm button needs it. */
  acknowledged: ReadonlySet<string>;
  lines: readonly AliciaLine[];
  draft: string;
  sending: boolean;
  onAcknowledge(id: string, value: boolean): void;
  onConfirm(id: string): void;
  onCancel(id: string): void;
  onGoToProposal(): void;
  onDraft(value: string): void;
  onSend(): void;
  /** v0.6: the runtime's read-only governance projection (absent → nothing extra is shown). */
  observability?: ObservabilityView | null;
  /** v0.7: the Human Decisions center (absent → the v0.5/v0.6 panel, unchanged). */
  decisions?: DecisionCenterModel | null;
  highAcknowledged?: AcknowledgedIds;
  onAcknowledgeHigh?(id: string, value: boolean): void;
  onApproveHigh?(id: string): void;
  onRejectHigh?(id: string): void;
}

const box: CSSProperties = {
  padding: '8px 10px', marginBottom: 8,
  background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)'
};
const btn: CSSProperties = {
  padding: '3px 10px', marginInlineEnd: 8, border: 'none', cursor: 'pointer',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12,
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', background: 'var(--cth-cream-50, #fff)', color: 'var(--cth-ink-900)'
};
// Confirm is the deliberate action: heavier frame, never the default focus,
// placed after Cancel, and enabled only after the acknowledgement.
const confirmBtn: CSSProperties = { ...btn, fontWeight: 700, boxShadow: 'inset 0 0 0 2px var(--cth-ink-900)' };
const muted: CSSProperties = { fontSize: 11, color: 'var(--cth-ink-500)' };
const mono: CSSProperties = { fontFamily: 'var(--cth-font-mono)', fontSize: 11 };
const FOCUS_CSS = '[data-alicia-panel] button:focus-visible,[data-alicia-panel] input:focus-visible,[data-alicia-panel] [tabindex]:focus-visible{outline:2px solid var(--cth-ink-900);outline-offset:2px}' +
  '[data-alicia-panel] button:disabled{cursor:not-allowed;opacity:.55}';

function refusalText(t: T, code: string): string {
  if (EXPLAINED_CODES.has(code)) return t(`lapitaya:alicia.explain.${code}`);
  if (code === 'LEDGER_UNAVAILABLE' || code === 'IPC_ERROR') return t(`${NS}.errors.${code}`);
  return t('lapitaya:alicia.explain.UNKNOWN', { rule: code });
}

export function AliciaProposalCard({ t, view, acknowledged, onAcknowledge, onConfirm, onCancel, observability, decisionType }: {
  t: T; view: ProposalView; acknowledged: boolean;
  onAcknowledge(id: string, value: boolean): void; onConfirm(id: string): void; onCancel(id: string): void;
  observability?: ObservabilityView | null;
  /** v0.7: labels the card as a REQUEST confirmation inside the Decision Center. */
  decisionType?: 'REQUEST_CONFIRMATION';
}) {
  const base = `alicia-proposal-${view.id}`;
  const active = view.status === 'PROPOSED' || view.status === 'CONFIRMED';
  const failed = view.outcome && !view.outcome.ok ? view.outcome.code : null;
  return (
    <section
      id={base}
      aria-labelledby={`${base}-h`}
      data-proposal-id={view.id}
      data-proposal-status={view.status}
      data-ui-state={view.uiState}
      data-scope={view.scope}
      {...(decisionType ? { 'data-decision-type': decisionType } : {})}
      style={{ ...box, opacity: active || view.outcome ? 1 : 0.7 }}
    >
      {decisionType && (<>
        <span data-field="decision-type" style={{ display: 'inline-block', padding: '0 6px', marginBottom: 4, fontSize: 10, fontWeight: 700, boxShadow: 'inset 0 0 0 1px currentColor' }}>
          {t(`lapitaya:alicia.decisions.type.${decisionType}`)}
        </span>
        <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700 }}>{t(`lapitaya:alicia.decisions.typeMeaning.${decisionType}`)}</p>
      </>)}
      <div id={`${base}-h`} tabIndex={-1} style={{ fontWeight: 700, marginBottom: 4 }}>
        {t(`${NS}.state.${view.uiState}`)}
      </div>
      <div style={{ marginBottom: 4 }}>{t(`${NS}.understood`)}</div>
      {/* The human's own words, verbatim — never paraphrased or translated. */}
      <blockquote data-field="message" style={{ margin: '0 0 6px', paddingInlineStart: 8, borderInlineStart: '2px solid var(--cth-ink-300)' }}>
        {view.message}
      </blockquote>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 8, rowGap: 2, margin: '0 0 6px' }}>
        <dt>{t(`${NS}.fields.risk`)}</dt>
        {/* Runtime-assigned scope, shown as given: the UI never computes risk. */}
        <dd data-field="scope" style={{ margin: 0 }}>
          <b>{view.scope}</b> · {t(`lapitaya:autonomy.risk.${view.scope}`)}
        </dd>
        <dt>{t(`${NS}.fields.status`)}</dt>
        <dd data-field="status" style={{ margin: 0 }}><code style={mono}>{view.status}</code></dd>
        <dt>{t(`${NS}.fields.executor`)}</dt>
        <dd data-field="executor" style={{ margin: 0 }}><code style={mono}>{view.executor}</code></dd>
        {view.taskId && (<>
          <dt>{t(`${NS}.fields.task`)}</dt>
          <dd data-field="task" style={{ margin: 0 }}><code style={mono}>{view.taskId}</code></dd>
        </>)}
        <dt>proposalId</dt>
        <dd data-field="proposalId" style={{ margin: 0 }}><code style={mono}>{view.id}</code></dd>
        {view.requestedBy && (<>
          <dt>{t('lapitaya:alicia.decisions.owner.requestedBy')}</dt>
          <dd data-field="requested-by" style={{ margin: 0 }}>{t('lapitaya:alicia.decisions.owner.person', { name: view.requestedBy.displayName, id: view.requestedBy.id })}</dd>
        </>)}
        {view.confirmedBy && (<>
          <dt>{t('lapitaya:alicia.decisions.owner.confirmedBy')}</dt>
          <dd data-field="confirmed-by" style={{ margin: 0 }}>{t('lapitaya:alicia.decisions.owner.person', { name: view.confirmedBy.displayName, id: view.confirmedBy.id })}</dd>
        </>)}
        {view.closedBy && (<>
          <dt>{t(view.status === 'COMPLETED' ? 'lapitaya:alicia.decisions.owner.completedBy' : 'lapitaya:alicia.decisions.owner.cancelledBy')}</dt>
          <dd data-field="closed-by" style={{ margin: 0 }}>{t('lapitaya:alicia.decisions.owner.person', { name: view.closedBy.displayName, id: view.closedBy.id })}</dd>
        </>)}
        <dt>{t(`${NS}.fields.created`)}</dt>
        <dd data-field="createdAt" style={{ margin: 0 }}>{new Date(view.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</dd>
      </dl>

      {view.status === 'PROPOSED' && (<>
        <p id={`${base}-scope`} style={{ ...muted, margin: '0 0 4px' }}>{t(`${NS}.scopeExplain.${view.scope}`)}</p>
        <p id={`${base}-meaning`} style={{ ...muted, margin: '0 0 4px' }}>{t(`${NS}.meaning`)}</p>
        <p id={`${base}-high`} data-field="high-note" style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700 }}>{t(`${NS}.highNote`)}</p>
        <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 6, fontSize: 11 }}>
          <input
            type="checkbox"
            data-action="acknowledge"
            checked={acknowledged}
            disabled={view.busy || !view.canConfirm}
            onChange={(e) => onAcknowledge(view.id, e.currentTarget.checked)}
          />
          <span>{t(`${NS}.ack`)}</span>
        </label>
      </>)}

      {view.status === 'CONFIRMED' && (
        <p data-field="confirmed-note" style={{ margin: '0 0 6px', fontSize: 11 }}>{t(`${NS}.confirmedNote`)}</p>
      )}
      {view.pendingHighApprovals > 0 && (
        <p role="alert" data-field="high-approval" style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700 }}>
          {t(`${NS}.highPending`, { count: view.pendingHighApprovals })}
        </p>
      )}

      {observability && <ProposalGovernance t={t} proposalId={view.id} entry={observability.byProposal[view.id]} />}

      {/* The runtime's answer. Not retried: the human decides what to do next. */}
      <div role={failed ? 'alert' : 'status'} aria-live={failed ? 'assertive' : 'polite'} data-field="outcome" style={{ fontSize: 11, marginBottom: active ? 6 : 0 }}>
        {failed && (<>
          <span>{refusalText(t, failed)}</span>{' '}
          <code style={mono}>{failed}</code>{' '}
          <span style={muted}>{t(`${NS}.noRetry`)}</span>
        </>)}
      </div>

      {active && (
        <div role="group" aria-label={t(`${NS}.decisionGroup`)}>
          <button
            type="button"
            style={btn}
            data-action="cancel"
            disabled={!view.canCancel}
            aria-busy={view.uiState === 'CANCELING'}
            onClick={() => onCancel(view.id)}
          >
            {t(`${NS}.cancel`)}
          </button>
          {view.status === 'PROPOSED' && (
            <button
              type="button"
              style={confirmBtn}
              data-action="confirm"
              disabled={!view.canConfirm || !acknowledged}
              aria-busy={view.uiState === 'CONFIRMING'}
              aria-describedby={`${base}-meaning ${base}-high`}
              onClick={() => onConfirm(view.id)}
            >
              {t(`${NS}.confirm`)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Pure render of the whole panel (also what the renderer tests render). */
export function AliciaPanelView(p: AliciaPanelViewProps) {
  const { t, snapshot } = p;
  const { views } = snapshot;
  return (
    <div data-alicia-panel role="region" aria-labelledby="alicia-panel-title" style={{ padding: '8px 10px 0', marginBottom: 12 }}>
      <style>{FOCUS_CSS}</style>
      <div id="alicia-panel-title" style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, marginBottom: 4, color: 'var(--cth-ink-700)' }}>
        {t(`${NS}.title`)}
        {p.presence && <span data-field="presence" style={{ marginInlineStart: 6 }}>· {t(`lapitaya:alicia.presence.${p.presence}`)}</span>}
      </div>
      <div style={{ ...muted, marginBottom: 6 }}>{t(`${NS}.role`)}</div>

      {snapshot.pendingCount > 0 && (
        <div role="status" data-field="pending-banner" style={{ ...box, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{t(`${NS}.pendingBanner`, { count: snapshot.pendingCount })}</span>
          <button type="button" style={btn} data-action="go-to-proposal" onClick={p.onGoToProposal}>{t(`${NS}.goToProposal`)}</button>
        </div>
      )}

      {!snapshot.loaded && <div style={muted}>{t(`${NS}.loading`)}</div>}
      {snapshot.loadError && <div role="alert" style={{ ...box, fontSize: 11 }}>{t(`${NS}.loadError`)}</div>}
      {snapshot.loaded && !snapshot.loadError && views.length === 0 && <div style={{ ...muted, marginBottom: 6 }}>{t(`${NS}.empty`)}</div>}

      {p.decisions && <DecisionCenterBlock p={p} views={views} />}
      {!p.decisions && views.map((v) => (
        <AliciaProposalCard
          key={v.id} t={t} view={v} acknowledged={p.acknowledged.has(v.id)}
          onAcknowledge={p.onAcknowledge} onConfirm={p.onConfirm} onCancel={p.onCancel}
          observability={p.observability}
        />
      ))}

      {p.observability && <GovernanceHealthBanner t={t} view={p.observability} />}
      {p.observability && <GovernanceActivity t={t} view={p.observability} />}

      <div aria-live="polite" data-field="conversation" style={{ marginBottom: 6 }}>
        {p.lines.map((l, i) => (
          <div key={i} data-from={l.from} style={{ fontSize: 12, marginBottom: 2 }}>
            <b>{t(`${NS}.conversation.${l.from}`)}:</b> {l.text}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e: FormEvent) => { e.preventDefault(); p.onSend(); }}
        style={{ display: 'flex', gap: 6 }}
      >
        <label htmlFor="alicia-draft" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {t(`${NS}.conversation.label`)}
        </label>
        <input
          id="alicia-draft"
          data-field="draft"
          value={p.draft}
          disabled={p.sending}
          placeholder={t(`${NS}.conversation.placeholder`)}
          onChange={(e) => p.onDraft(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 0, padding: '3px 6px', fontFamily: 'var(--cth-font-ui)', fontSize: 12, border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', background: 'var(--cth-cream-50, #fff)', color: 'var(--cth-ink-900)' }}
        />
        <button type="submit" style={btn} data-action="send" disabled={p.sending || !p.draft.trim()}>
          {t(`${NS}.conversation.send`)}
        </button>
      </form>
    </div>
  );
}

/** v0.7: the Human Decisions center — pending HIGH approvals + the REQUEST cards, one surface. */
function DecisionCenterBlock({ p, views }: { p: AliciaPanelViewProps; views: readonly ProposalView[] }) {
  if (!p.decisions) return null;
  return (
    <DecisionCenterSection
      t={p.t} model={p.decisions}
      requestCards={views.map((v) => requestDecisionCard(p, v))}
      highCards={p.decisions.high.map((d) => highDecisionCard(p, d))}
    />
  );
}

function requestDecisionCard(p: AliciaPanelViewProps, v: ProposalView) {
  return (
    <AliciaProposalCard
      key={v.id} t={p.t} view={v} acknowledged={p.acknowledged.has(v.id)}
      onAcknowledge={p.onAcknowledge} onConfirm={p.onConfirm} onCancel={p.onCancel}
      observability={p.observability} decisionType="REQUEST_CONFIRMATION"
    />
  );
}

function highDecisionCard(p: AliciaPanelViewProps, d: HighDecisionView) {
  const noop = () => { /* no handler wired: the card stays inert */ };
  return (
    <HighApprovalCard
      key={d.approvalId} t={p.t} d={d} acknowledged={!!p.highAcknowledged?.has(d.approvalId)}
      onAcknowledge={p.onAcknowledgeHigh ?? noop} onApprove={p.onApproveHigh ?? noop} onReject={p.onRejectHigh ?? noop}
    />
  );
}

/** What Alicia says back after a message, from the runtime's outcome only. */
export function lineForSubmit(t: T, r: ({ ok: true } & AliciaSubmitResult) | { ok: false; error: string }): string {
  if (!r.ok) return t(`${NS}.conversation.failed`);
  if (r.reply) return r.reply.text;
  const o = r.outcome;
  if (o.status === 'BLOCKED') return t(`${NS}.conversation.blocked`, { rule: o.rule });
  if (o.type === 'REQUEST' && o.proposalId) return t(`${NS}.conversation.forwarded`, { id: o.proposalId });
  return t(`${NS}.conversation.governed`, { risk: o.risk ?? '—', decision: o.decision });
}

