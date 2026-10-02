import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Approval } from '@shared/lapitaya/governance';
import { isDecisionCenterPresent, useDecisionCenterPresent } from './alicia/decisionCenterPresence';

/**
 * La Pitaya: the human side of HUMAN_APPROVAL_REQUIRED.
 *
 * Every HIGH-risk tool call the runtime denied shows here with the exact action
 * the agent attempted. Approve grants ONE execution of that identical call (the
 * agent retries it); Reject leaves it blocked. Nothing here executes anything —
 * the agent does, after the decision, through the same hook that denied it.
 */
export function GovernancePanel() {
  // v0.7: when Alicia's Decision Center is on screen (same #human tab), pending
  // HIGH approvals are decided there — one set of Approve/Reject controls per
  // runtime decision, not two competing ones. Standalone, this panel is unchanged.
  const decisionCenter = useDecisionCenterPresent();
  if (decisionCenter) return null;
  return <GovernanceApprovalsList />;
}

function GovernanceApprovalsList() {
  const { t } = useTranslation();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.cth.lapitayaObservability().then((view) => {
      const items = (view?.pendingApprovals ?? []).flatMap((o) =>
        o.approvalId && o.risk
          ? [{
              id: o.approvalId,
              agentId: o.agent ?? 'agent',
              tool: o.operation ?? 'tool',
              fingerprint: '',
              category: o.category as any,
              risk: o.risk,
              summary: o.operation ?? '',
              status: 'pending' as const,
              createdAt: o.timestamp ?? Date.now()
            }]
          : []
      );
      setApprovals(items);
    }).catch(() => setApprovals([]));
  }, []);

  useEffect(() => {
    // Mounted in the same commit as the Decision Center, it stands down before
    // asking for the approvals (their summaries carry the commands).
    const first = setTimeout(() => { if (!isDecisionCenterPresent()) refresh(); }, 0);
    const off = window.cth.onLapitayaGovernance((e) => {
      if ((e.type === 'approval-request' || e.type === 'approval-decided') && !isDecisionCenterPresent()) refresh();
    });
    return () => { clearTimeout(first); off(); };
  }, [refresh]);

  const pending = approvals.filter((a) => a.status === 'pending');
  const recent = approvals.filter((a) => a.status !== 'pending').slice(0, 5);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try { await window.cth.lapitayaDecide(id, approve); } finally { setBusy(null); refresh(); }
  };

  const box: CSSProperties = {
    padding: '8px 10px', marginBottom: 8,
    background: 'var(--cth-cream-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
    fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)'
  };
  const btn: CSSProperties = {
    padding: '2px 8px', marginInlineEnd: 6, border: 'none', cursor: 'pointer',
    fontFamily: 'var(--cth-font-ui)', fontSize: 12,
    boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)', background: 'var(--cth-cream-50, #fff)'
  };

  if (pending.length === 0 && recent.length === 0) return null;

  return (
    <div data-lapitaya-governance style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 9, marginBottom: 6, color: 'var(--cth-ink-700)' }}>
        {t('lapitaya:governance.title')}
      </div>
      {pending.map((a) => (
        <div key={a.id} style={box} data-approval-id={a.id} data-approval-status={a.status}>
          <div style={{ marginBottom: 4 }}>
            <b>{a.agentId}</b> · {t(`lapitaya:autonomy.risk.${a.risk}`)} · {a.category}
          </div>
          {/* The attempted action is evidence: shown verbatim, never translated. */}
          <code style={{ display: 'block', whiteSpace: 'pre-wrap', fontFamily: 'var(--cth-font-mono)', fontSize: 11, marginBottom: 6 }}>
            {a.summary}
          </code>
          <div style={{ fontSize: 11, color: 'var(--cth-ink-500)', marginBottom: 6 }}>{t('lapitaya:governance.approveHint')}</div>
          <button style={btn} disabled={busy === a.id} onClick={() => void decide(a.id, true)} data-action="approve">
            {t('lapitaya:governance.approve')}
          </button>
          <button style={btn} disabled={busy === a.id} onClick={() => void decide(a.id, false)} data-action="reject">
            {t('lapitaya:governance.reject')}
          </button>
        </div>
      ))}
      {recent.map((a) => (
        <div key={a.id} style={{ ...box, opacity: 0.7 }} data-approval-id={a.id} data-approval-status={a.status}>
          <b>{a.agentId}</b> · {t(`lapitaya:governance.status.${a.status}`)} · <code style={{ fontFamily: 'var(--cth-font-mono)' }}>{a.summary}</code>
        </div>
      ))}
    </div>
  );
}
