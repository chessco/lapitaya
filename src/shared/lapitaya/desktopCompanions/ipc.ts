/**
 * IPC constants and channel validation for Desktop Companions — FASE 2.
 * Ensures strict isolation from CIMA / Governance IPC channels.
 */

export const COMPANION_IPC = {
  SNAPSHOT: 'lapitaya:companion:snapshot',
  SET_STATE: 'lapitaya:companion:setState',
  POSITION_CHANGED: 'lapitaya:companion:positionChanged',
  OPEN_MAIN: 'lapitaya:companion:openMain',
  TRIGGER_BUBBLE: 'lapitaya:companion:triggerBubble',
  DISMISS_BUBBLE: 'lapitaya:companion:dismissBubble',
  SET_MODE: 'lapitaya:companion:setMode',
  HIDE: 'lapitaya:companion:hide'
} as const;

export const COMPANION_ALLOWED_CHANNELS = [
  COMPANION_IPC.SNAPSHOT,
  COMPANION_IPC.SET_STATE,
  COMPANION_IPC.POSITION_CHANGED,
  COMPANION_IPC.OPEN_MAIN,
  COMPANION_IPC.TRIGGER_BUBBLE,
  COMPANION_IPC.DISMISS_BUBBLE,
  COMPANION_IPC.SET_MODE,
  COMPANION_IPC.HIDE
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
