/**
 * Types for La Pitaya Desktop Companions — FASE 2: Living Desktop Experience.
 *
 * Safe presentation projection models for transparent, living desktop creatures.
 * Strictly decoupled from CIMA / Governance data structures (no ledger, no tokens,
 * no HMAC, no approval state, no risk metrics).
 */

import type { LaPitayaAgentId } from '../agents';

export type CompanionMode =
  | 'OFF'
  | 'MINI'
  | 'COMPANION'
  | 'COMPANY'
  | 'FOCUS'
  | 'PAUSED';

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

export interface CompanionSpeechBubbleData {
  id: string;
  text: string;
  sourceFact?: string;
  timestamp: number;
  autoDismissMs?: number;
}

export interface CompanionPosition {
  x: number;
  y: number;
}

export interface CompanionPresentationEntry {
  agentId: LaPitayaAgentId;
  species: string;
  visualState: CompanionVisualState;
  mood: CompanionMood;
  animationState: CompanionAnimationState;
  statusText: string;
  isPrimary: boolean;
  position: CompanionPosition;
  bubble?: CompanionSpeechBubbleData | null;
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
