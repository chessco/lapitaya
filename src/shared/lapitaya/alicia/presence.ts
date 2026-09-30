/**
 * AliciaPresence — how Alicia would "look" right now. MODEL ONLY in v0.4: no
 * avatar, no animation, no desktop or device surface consumes it yet.
 *
 * Presence is derived from the unread notifications, never stored, so it can
 * never disagree with the facts behind it. Priority: what needs the human most
 * wins (an approval waiting beats a celebration).
 */

import type { AliciaNotification } from './notifications';

export const ALICIA_PRESENCE_STATES = [
  'IDLE', 'THINKING', 'NOTIFYING', 'WAITING_APPROVAL', 'CELEBRATING', 'WARNING', 'BLOCKED'
] as const;
export type AliciaPresence = (typeof ALICIA_PRESENCE_STATES)[number];

export function derivePresence(unread: readonly Pick<AliciaNotification, 'type' | 'eventType'>[], thinking = false): AliciaPresence {
  if (unread.some((n) => n.type === 'APPROVAL_REQUIRED')) return 'WAITING_APPROVAL';
  if (unread.some((n) => n.type === 'BLOCKED')) return 'BLOCKED';
  if (unread.some((n) => n.type === 'ERROR' || n.type === 'WARNING')) return 'WARNING';
  if (unread.some((n) => n.eventType === 'workflow.completed')) return 'CELEBRATING';
  if (unread.length) return 'NOTIFYING';
  return thinking ? 'THINKING' : 'IDLE';
}
