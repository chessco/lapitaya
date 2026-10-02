/**
 * Types for La Pitaya Desktop Companions — FASE 1: Desktop Presence Foundation.
 *
 * Safe presentation projection models for the desktop companion window.
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
  | 'PAUSED';

export interface CompanionPosition {
  x: number;
  y: number;
}

export interface CompanionPresentationEntry {
  agentId: LaPitayaAgentId;
  species: string;
  visualState: CompanionVisualState;
  statusText: string;
  isPrimary: boolean;
  position: CompanionPosition;
}

export interface CompanionPresentation {
  mode: CompanionMode;
  entries: readonly CompanionPresentationEntry[];
  updatedAt: number;
}

export interface CompanionPreferences {
  mode: CompanionMode;
  alwaysOnTop: boolean;
  soundEnabled: boolean;
  opacity: number;
}
