import { useSyncExternalStore } from 'react';

/**
 * La Pitaya Alicia v0.7 — is the Decision Center on screen?
 *
 * The #human tab mounts Alicia (with the Decision Center) next to the classic
 * Governance panel. While the Decision Center is mounted, pending HIGH
 * approvals are decided there, so the classic panel stands down instead of
 * offering a second, competing set of Approve/Reject buttons for the same
 * runtime decision. Presentation state only — it grants or denies nothing.
 */
let mounted = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function markDecisionCenterMounted(): () => void {
  mounted += 1;
  emit();
  return () => { mounted = Math.max(0, mounted - 1); emit(); };
}

export function isDecisionCenterPresent(): boolean {
  return mounted > 0;
}

export function useDecisionCenterPresent(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    isDecisionCenterPresent,
    () => false
  );
}
