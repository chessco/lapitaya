import { randomBytes } from 'node:crypto';
import { cleanDisplayName, HUMAN_ID_RE, type HumanContext, type HumanIdentity } from '../shared/lapitaya/identity';

/**
 * La Pitaya Alicia v0.8 — the trusted human identity.
 *
 * Resolved HERE, in main, from the application's own context; the renderer can
 * neither supply nor alter it. It identifies the human behind a governance
 * decision (WHO), nothing more: it authorizes nothing, classifies nothing and
 * is not an account system — one stable id per installation/profile, the OS
 * user name for display, the app launch as the session and the window the
 * decision came from.
 *
 *   IPC event ──▶ is it one of OUR windows' main frame, on OUR renderer URL?
 *                 ├─ no  → null   (the caller refuses; nothing is recorded as human)
 *                 └─ yes → HumanContext { human, session, window }
 */

/** What main can say about the sender of an IPC event (Electron-free, so it is testable). */
export interface SenderFacts {
  /** webContents.id */
  webContentsId: number;
  destroyed: boolean;
  /** The event came from the window's main frame (not an iframe / child). */
  isMainFrame: boolean;
  /** The frame's URL when the event was sent. */
  url: string;
  /** The webContents belongs to one of this app's own BrowserWindows. */
  ownWindow: boolean;
}

export interface HumanIdentityDeps {
  readHumanId(): string | null;
  writeHumanId(id: string): void;
  osUserName(): string;
  /** `ses-<random>` for this launch. */
  sessionId: string;
  describeSender(evt: unknown): SenderFacts | null;
  /** URL prefixes the app's own renderer is served from (file:// build dir, dev server origin). */
  trustedUrlPrefixes(): readonly string[];
}

export function newHumanId(): string {
  return `hum-${randomBytes(10).toString('hex')}`;
}
export function newSessionId(): string {
  return `ses-${randomBytes(8).toString('hex')}`;
}

export function createHumanIdentityService(deps: HumanIdentityDeps) {
  let cached: HumanIdentity | null = null;

  /** The stable identity of this installation/profile. Created once, then persisted. */
  function identity(): HumanIdentity {
    if (cached) return cached;
    let id = deps.readHumanId();
    if (!id || !HUMAN_ID_RE.test(id)) { id = newHumanId(); deps.writeHumanId(id); }
    cached = { id, displayName: cleanDisplayName(deps.osUserName()) };
    return cached;
  }

  /** The trusted context for a human-facing IPC event, or null when the sender is not trustworthy. */
  function resolve(evt: unknown): HumanContext | null {
    const s = deps.describeSender(evt);
    if (!s || s.destroyed || !s.ownWindow || !s.isMainFrame) return null;
    if (!Number.isInteger(s.webContentsId) || s.webContentsId < 0) return null;
    if (typeof s.url !== 'string' || !deps.trustedUrlPrefixes().some((p) => s.url.startsWith(p))) return null;
    return { human: identity(), session: deps.sessionId, window: s.webContentsId };
  }

  return { identity, resolve, sessionId: deps.sessionId };
}
export type HumanIdentityService = ReturnType<typeof createHumanIdentityService>;
