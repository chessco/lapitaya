/**
 * IPC constants and channel validation for Desktop Companions — FASE 2.
 * Ensures strict isolation from CIMA / Governance IPC channels.
 *
 * Every channel is explicit (Electron has no wildcard channels). Isolation is
 * enforced by the companion preload, which binds each bridge method to one fixed
 * channel below and exposes no generic send/invoke; the validators here are the
 * declarative statement of that allow-list.
 *
 * Dragging is a pointer-captured drag reported to main (not `-webkit-app-region: drag`): a native
 * drag region receives no DOM pointer events, which breaks the click-through hover tracking.
 *
 * There is deliberately no renderer → main channel that sets a bubble text, a
 * visual state or a runtime fact: those come only from verified runtime events
 * in the main process.
 */

export const COMPANION_IPC = {
  /** main → renderer: the presentation snapshot. */
  SNAPSHOT: 'lapitaya:companion:snapshot',
  /** renderer → main: send me the current snapshot (the renderer subscribes after the page has loaded). */
  REQUEST_SNAPSHOT: 'lapitaya:companion:requestSnapshot',
  /** main → renderer: a visual state change. */
  SET_STATE: 'lapitaya:companion:setState',
  /** Reserved: window positions are read by main from the window's own `moved` event. */
  POSITION_CHANGED: 'lapitaya:companion:positionChanged',
  /** renderer → main: focus the main La Pitaya window. */
  OPEN_MAIN: 'lapitaya:companion:openMain',
  /** renderer → main: dismiss the sending companion's bubble. */
  DISMISS_BUBBLE: 'lapitaya:companion:dismissBubble',
  /** renderer → main: switch mode (validated against COMPANION_MODES). */
  SET_MODE: 'lapitaya:companion:setMode',
  /** renderer → main: hide the companions (La Pitaya keeps running). */
  HIDE: 'lapitaya:companion:hide',
  /** renderer → main: the pointer is over (true) / left (false) the creature, so the
   *  transparent rest of the window lets clicks through to whatever is underneath. */
  SET_INTERACTIVE: 'lapitaya:companion:setInteractive',
  /** renderer → main: drag-handle pointer drag ({ phase: 'start' | 'move' | 'end', dx, dy } in screen DIPs). */
  DRAG: 'lapitaya:companion:drag'
} as const;

export type CompanionDragPhase = 'start' | 'move' | 'end';

export const COMPANION_ALLOWED_CHANNELS = [
  COMPANION_IPC.SNAPSHOT,
  COMPANION_IPC.REQUEST_SNAPSHOT,
  COMPANION_IPC.SET_STATE,
  COMPANION_IPC.POSITION_CHANGED,
  COMPANION_IPC.OPEN_MAIN,
  COMPANION_IPC.DISMISS_BUBBLE,
  COMPANION_IPC.SET_MODE,
  COMPANION_IPC.HIDE,
  COMPANION_IPC.SET_INTERACTIVE,
  COMPANION_IPC.DRAG
] as const;

const FORBIDDEN_GOVERNANCE_TERMS = [
  'approve',
  'authorize',
  'risk',
  'autonomy',
  'capability',
  'execute',
  'ledger',
  'cima',
  'governance',
  'token',
  'hmac',
  'auth'
];

/**
 * Returns true if the channel name mentions any governance, authority or CIMA terms.
 */
export function isGovernanceIpcChannel(channel: string): boolean {
  const normalized = channel.toLowerCase();
  return FORBIDDEN_GOVERNANCE_TERMS.some((term) => normalized.includes(term));
}

/**
 * Validates whether an IPC channel is safe to expose to the companion renderer process.
 */
export function isAllowedCompanionChannel(channel: string): boolean {
  if (isGovernanceIpcChannel(channel)) return false;
  return (COMPANION_ALLOWED_CHANNELS as readonly string[]).includes(channel);
}
