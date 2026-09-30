import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { AliciaCompanionState } from '@shared/lapitaya/alicia';
import { getLocaleSettings } from '@/i18n';
import { aliciaLineKey, createConfirmationController, type ConfirmationController, type ConfirmationPort } from './confirmationController';
import { AliciaPanelView, lineForSubmit, NS, type AliciaLine } from './AliciaPanelView';

/**
 * La Pitaya Alicia v0.5 — Human Confirmation UI.
 *
 * Alicia PRESENTS a REQUEST proposal and RECEIVES the human's decision; the
 * runtime decides what that means. Confirm and Cancel call the existing
 * human-channel IPC (lapitaya:confirmRequest / lapitaya:cancelRequest) and
 * nothing else — no approval, no tool, no hive message, no El Inge. A
 * confirmed REQUEST still goes through CIMA at every tool call; HIGH actions
 * still need their own approval in the Governance panel.
 */

/** The human-channel IPC the panel is allowed to use — nothing more. */
export function ipcConfirmationPort(): ConfirmationPort {
  return {
    requests: () => window.cth.lapitayaRequests(),
    approvals: () => window.cth.lapitayaApprovals(),
    confirm: (id, token) => window.cth.lapitayaConfirmRequest(id, token),
    cancel: (id) => window.cth.lapitayaCancelRequest(id)
  };
}

export function AliciaPanel() {
  const { t, i18n } = useTranslation();
  const controllerRef = useRef<ConfirmationController | null>(null);
  if (!controllerRef.current) controllerRef.current = createConfirmationController(ipcConfirmationPort());
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [alicia, setAlicia] = useState<AliciaCompanionState | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<AliciaLine[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const locales = useCallback(() => ({ ...getLocaleSettings(), uiLocale: i18n.language }), [i18n.language]);
  const refreshAlicia = useCallback(() => {
    void window.cth.aliciaSnapshot({ locales: locales() }).then(setAlicia).catch(() => setAlicia(null));
  }, [locales]);

  useEffect(() => {
    void controller.refresh();
    refreshAlicia();
    // The existing runtime event stream — no new bus.
    return window.cth.onLapitayaGovernance((e) => {
      if (e.type === 'request' || e.type === 'approval-request' || e.type === 'approval-decided') void controller.refresh();
      refreshAlicia();
    });
  }, [controller, refreshAlicia]);

  const say = (text: string) => setLines((ls) => [...ls, { from: 'alicia' as const, text }].slice(-8));

  const decide = async (id: string, op: 'confirm' | 'cancel') => {
    const res = op === 'confirm' ? await controller.confirm(id) : await controller.cancel(id);
    if (!res) return; // dropped: another decision was in flight, or nothing to do
    const view = controller.getSnapshot().views.find((v) => v.id === id);
    const key = view ? aliciaLineKey(view) : null;
    if (key) say(t(`${NS}.said.${key}`, { code: res.ok ? '' : res.code }));
    setAcknowledged((s) => { const n = new Set(s); n.delete(id); return n; });
    refreshAlicia();
  };

  const goToProposal = () => {
    const pending = controller.getSnapshot().views.find((v) => v.status === 'PROPOSED');
    if (!pending) return;
    document.getElementById(`alicia-proposal-${pending.id}-h`)?.focus();
    // The runtime's notification pointed here; reading it is all Alicia does with it.
    for (const n of alicia?.notifications ?? []) {
      if (!n.read && n.action?.kind === 'open-requests' && n.action.ref === pending.id) void window.cth.aliciaMarkRead(n.id);
    }
    refreshAlicia();
  };

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setLines((ls) => [...ls, { from: 'human' as const, text: message }].slice(-8));
    setDraft('');
    try {
      const r = await window.cth.aliciaSubmit(message, { locales: locales() });
      say(lineForSubmit(t, r));
    } catch {
      say(t(`${NS}.conversation.failed`));
    } finally {
      setSending(false);
      void controller.refresh();
      refreshAlicia();
    }
  };


  return (
    <AliciaPanelView
      t={t}
      snapshot={snapshot}
      presence={alicia?.presence ?? null}
      acknowledged={acknowledged}
      lines={lines}
      draft={draft}
      sending={sending}
      onAcknowledge={(id, v) => setAcknowledged((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; })}
      onConfirm={(id) => void decide(id, 'confirm')}
      onCancel={(id) => void decide(id, 'cancel')}
      onGoToProposal={goToProposal}
      onDraft={setDraft}
      onSend={() => void send()}
    />
  );
}

/** A count on the #human tab while a proposal waits — leads the human to it. */
export function AliciaPendingBadge() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  useEffect(() => {
    // The badge lives in the tab bar, which every agent needs: whatever the
    // bridge does, it may hide itself but never take the tab bar down.
    const load = () => {
      try {
        void window.cth.lapitayaRequests()
          .then((r) => setCount(r.filter((p) => p.status === 'PROPOSED').length))
          .catch(() => setCount(0));
      } catch { setCount(0); }
    };
    load();
    try {
      return window.cth.onLapitayaGovernance((e) => { if (e.type === 'request') load(); });
    } catch { return undefined; }
  }, []);
  if (!count) return null;
  return (
    <span
      data-alicia-pending-badge
      role="status"
      aria-label={t(`${NS}.pendingBadge`, { count })}
      title={t(`${NS}.pendingBadge`, { count })}
      style={{ marginInlineStart: 4, padding: '0 5px', fontSize: 11, fontWeight: 700, boxShadow: 'inset 0 0 0 1px currentColor' }}
    >
      {count}
    </span>
  );
}
