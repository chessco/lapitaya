import { useEffect, useState } from 'react';
import type { ObservabilityView } from '@shared/lapitaya/alicia';

/**
 * La Pitaya Alicia v0.6 — the read-only governance projection, refreshed on
 * the existing `lapitaya:governance` stream (no new bus). The projection is
 * computed in main from the runtime's own records; this hook only fetches it.
 * It has no way to write, decide, confirm or approve anything.
 */
export function useGovernanceObservability(): ObservabilityView | null {
  const [view, setView] = useState<ObservabilityView | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      try {
        void window.cth.lapitayaObservability()
          .then((v) => { if (alive) setView(v); })
          .catch(() => { if (alive) setView(null); });
      } catch { if (alive) setView(null); }
    };
    // Tool calls can come in bursts: coalesce refreshes.
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(load, 250); };
    load();
    let off: (() => void) | undefined;
    try { off = window.cth.onLapitayaGovernance(() => schedule()); } catch { off = undefined; }
    return () => { alive = false; if (timer) clearTimeout(timer); off?.(); };
  }, []);
  return view;
}
