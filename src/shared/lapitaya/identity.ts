/**
 * La Pitaya Alicia v0.8 — human identity & decision ownership (shared types).
 *
 * Identity is RESOLVED IN MAIN from the app's own trusted context (see
 * src/main/humanIdentity.ts) and handed to the existing governance API as a
 * `HumanContext`. The renderer never supplies it, and nothing here decides,
 * authorizes, classifies or executes anything: it only names WHO.
 *
 *   HumanIdentity  who      — a stable id (+ a display name that is never authoritative)
 *   HumanContext   under which trusted context — the launch session and the window
 *   DecisionOwner  what the runtime records beside a human decision
 */

export interface HumanIdentity {
  /** Stable per installation/profile: `hum-<random>`. Never the display name. */
  id: string;
  /** Presentation only. Not unique, not authoritative. */
  displayName: string;
}

export interface HumanContext {
  human: HumanIdentity;
  /** The app launch (`ses-<random>`): a fresh one per process. */
  session: string;
  /** Electron webContents id of the window the decision came from. */
  window: number;
}

/** What the ledger / proposal / approval keep beside a human decision. */
export interface DecisionOwner {
  id: string;
  displayName: string;
  session: string;
  window: number;
}

/** The part of the owner the read-only projection may show. */
export interface SafeDecisionOwner {
  id: string;
  displayName: string;
}

export const HUMAN_ID_RE = /^hum-[a-z0-9]{12,32}$/;
export const SESSION_ID_RE = /^ses-[a-z0-9]{8,32}$/;
const NAME_MAX = 64;

/** Strip control characters and cap the length: a display name is data, never markup or a path. */
export function cleanDisplayName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim() : '';
  return s.slice(0, NAME_MAX) || 'human';
}

/** Strict shape check of a trusted context. Anything else is not a context. */
export function parseHumanContext(x: unknown): HumanContext | null {
  if (!x || typeof x !== 'object') return null;
  const c = x as Record<string, unknown>;
  const h = c.human && typeof c.human === 'object' ? c.human as Record<string, unknown> : null;
  if (!h || typeof h.id !== 'string' || !HUMAN_ID_RE.test(h.id) || typeof h.displayName !== 'string') return null;
  if (typeof c.session !== 'string' || !SESSION_ID_RE.test(c.session)) return null;
  if (typeof c.window !== 'number' || !Number.isInteger(c.window) || c.window < 0) return null;
  return { human: { id: h.id, displayName: cleanDisplayName(h.displayName) }, session: c.session, window: c.window };
}

export function ownerOf(ctx: HumanContext): DecisionOwner {
  return { id: ctx.human.id, displayName: ctx.human.displayName, session: ctx.session, window: ctx.window };
}

/** Whitelist read of an owner out of a runtime record (ledger line, proposal, approval). */
export function readOwner(x: unknown): DecisionOwner | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !HUMAN_ID_RE.test(o.id)) return null;
  if (typeof o.session !== 'string' || !SESSION_ID_RE.test(o.session)) return null;
  if (typeof o.window !== 'number' || !Number.isInteger(o.window)) return null;
  return { id: o.id, displayName: cleanDisplayName(o.displayName), session: o.session, window: o.window };
}

export function safeOwner(o: DecisionOwner | null): SafeDecisionOwner | null {
  return o ? { id: o.id, displayName: o.displayName } : null;
}
