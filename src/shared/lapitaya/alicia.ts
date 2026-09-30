/**
 * Alicia — architectural boundary ONLY.
 *
 * Alicia is La Pitaya's AI companion: a persistent assistant (think 90s desktop
 * helper, reimagined with modern AI) that will explain agent activity, findings,
 * CIMA cycles and errors in the user's language. She is a NEW capability, not a
 * replacement for any hive agent, and she is NOT implemented in this phase.
 *
 * This file fixes the seam so she can be added later without touching the core:
 *
 *   core (hive, El Inge, CIMA)  ──emits──▶  AliciaEvent  ──▶  AliciaCapability
 *
 * The core only ever calls `alicia().notify(event)`. Today that resolves to a
 * no-op; a future phase registers a real implementation with
 * `registerAlicia()`. Alicia is read-only with respect to the hive: she can
 * explain, never act — any action she suggests goes through El Inge and the
 * autonomy policy like everything else.
 *
 * Evidence rule: events carry original output verbatim in `evidence`; Alicia
 * may explain it in notificationLocale but must never alter it.
 *
 * Deferred (see docs/ALICIA/README.md): personality, UI presence, desktop
 * companion, voice, pets, hardware.
 */

import type { CimaPhase, Evidence, Verdict } from './cima';

export type AliciaEvent =
  | { type: 'agent-activity'; agentId: string; summary: string }
  | { type: 'cima-phase'; phase: CimaPhase; taskId?: string }
  | { type: 'finding'; agentId: string; severity: 'info' | 'low' | 'medium' | 'high' | 'critical'; title: string; evidence?: Evidence[] }
  | { type: 'verdict'; verdict: Verdict; taskId?: string; evidence: Evidence[] }
  | { type: 'error'; message: string; evidence?: Evidence[] }
  | { type: 'approval-needed'; action: string; reason: string };

export interface AliciaCapability {
  /** Stable id of the implementation (e.g. 'none', 'alicia-ui-v1'). */
  readonly id: string;
  readonly enabled: boolean;
  /** Fire-and-forget. Must never throw into the caller and never block the hive. */
  notify(event: AliciaEvent): void;
}

/** The default: Alicia is not present. Every call is a cheap no-op. */
export const ALICIA_DISABLED: AliciaCapability = Object.freeze({
  id: 'none',
  enabled: false,
  notify: () => { /* Alicia is not implemented in Foundation v0.1 */ }
});

let current: AliciaCapability = ALICIA_DISABLED;

/** Install an Alicia implementation. Returns a function that restores the previous one. */
export function registerAlicia(impl: AliciaCapability): () => void {
  const previous = current;
  current = impl;
  return () => { current = previous; };
}

/** The active Alicia. Callers use `alicia().notify(...)`; a throwing
 *  implementation is contained here so it can never break the core. */
export function alicia(): AliciaCapability {
  const impl = current;
  return {
    id: impl.id,
    enabled: impl.enabled,
    notify(event) {
      try { impl.notify(event); } catch { /* Alicia must never break the hive */ }
    }
  };
}
