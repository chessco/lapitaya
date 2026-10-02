/**
 * The Alicia seam (Foundation v0.1; moved here in v0.4, same behaviour).
 *
 *   core (hive, El Inge, CIMA runtime) ──AliciaEvent──▶ alicia().notify(event) ──▶ AliciaCapability
 *
 * The core only ever calls `alicia().notify(event)`. By default that is a
 * no-op; a host (the main process today, a desktop/device host later) installs
 * a companion with `registerAlicia()`. The direction is one-way: the core hands
 * Alicia facts, Alicia never gets a handle on the core.
 *
 * Evidence rule: events carry the runtime's evidence verbatim; Alicia may
 * explain it, never alter it.
 */

import type { AliciaEvent } from './events';

export interface AliciaCapability {
  /** Stable id of the implementation (e.g. 'none', 'alicia-companion-v0.4'). */
  readonly id: string;
  readonly enabled: boolean;
  /** Fire-and-forget. Must never throw into the caller and never block the hive. */
  notify(event: AliciaEvent): void;
}

/** The default: Alicia is not present. Every call is a cheap no-op. */
export const ALICIA_DISABLED: AliciaCapability = Object.freeze({
  id: 'none',
  enabled: false,
  notify: () => { /* no companion registered */ }
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
