/**
 * Types for La Pitaya Desktop Companions — FASE 2: Living Desktop Experience.
 *
 * Safe presentation projection models for transparent, living desktop creatures.
 * Strictly decoupled from CIMA / Governance data structures (no ledger, no tokens,
 * no HMAC, no approval state, no risk metrics).
 */

import type { LaPitayaAgentId } from '../agents';

/** The authoritative set of companion modes. `SET_MODE` rejects anything else. */
export const COMPANION_MODES = ['OFF', 'MINI', 'COMPANION', 'COMPANY', 'FOCUS', 'PAUSED'] as const;

export type CompanionMode = (typeof COMPANION_MODES)[number];

export function isCompanionMode(v: unknown): v is CompanionMode {
  return typeof v === 'string' && (COMPANION_MODES as readonly string[]).includes(v);
}

export type CompanionVisualState =
  | 'IDLE'
  | 'WALKING'
  | 'SLEEPING'
  | 'THINKING'
  | 'WORKING'
  | 'CELEBRATING'
  | 'SUGGESTING'
  | 'CONCERNED'
  | 'NOTIFYING'
  | 'PAUSED'
  | 'HAPPY'
  | 'ATTENTION'
  | 'OFFLINE';

export type CompanionMood =
  | 'HAPPY'
  | 'CURIOUS'
  | 'FOCUSED'
  | 'CALM'
  | 'SLEEPY'
  | 'EXCITED';

export type CompanionAnimationState =
  | 'idle'
  | 'walk'
  | 'think'
  | 'work'
  | 'celebrate'
  | 'concern'
  | 'sleep'
  | 'attention'
  | 'offline';

/**
 * What a bubble IS, so a friendly line can never pass for telemetry:
 *  - `runtime-fact`  — produced in the main process from a verified runtime event; always carries `sourceFact`.
 *  - `conversation`  — friendly interaction; never carries `sourceFact`, never states runtime facts.
 */
export type CompanionBubbleKind = 'runtime-fact' | 'conversation';

export interface CompanionSpeechBubbleData {
  id: string;
  text: string;
  kind: CompanionBubbleKind;
  /** The verified runtime fact behind a `runtime-fact` bubble (e.g. `BUILD_COMPLETED`). */
  sourceFact?: string;
  timestamp: number;
  /** Auto-dismiss delay. Absent = sticky (stays until its fact is resolved, e.g. a pending human approval). */
  autoDismissMs?: number;
}

export interface CompanionPosition {
  x: number;
  y: number;
}

export interface CompanionPresentationEntry {
  agentId: LaPitayaAgentId;
  /** Canonical agent name (es-MX spelling); the renderer localizes it with `agentDisplayName`. */
  displayName: string;
  species: string;
  visualState: CompanionVisualState;
  mood: CompanionMood;
  animationState: CompanionAnimationState;
  statusText: string;
  isPrimary: boolean;
  position: CompanionPosition;
  bubble?: CompanionSpeechBubbleData | null;
  /** Set on Alicia when she is relaying the state of a companion that is not on screen. */
  relayedFrom?: LaPitayaAgentId | null;
}

export interface CompanionPresentation {
  mode: CompanionMode;
  entries: readonly CompanionPresentationEntry[];
  activePhaseAgent?: LaPitayaAgentId | null;
  updatedAt: number;
}

export interface CompanionPreferences {
  mode: CompanionMode;
  alwaysOnTop: boolean;
  soundEnabled: boolean;
  opacity: number;
  reducedMotion: boolean;
  maxVisibleCompanions: number;
}
