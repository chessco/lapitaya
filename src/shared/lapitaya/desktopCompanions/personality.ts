/**
 * Companion personalities — FASE 3 (Living Desktop).
 *
 * Declarative, PRESENTATION-ONLY parameters for each member of the virtual software company.
 * They shape how a companion moves, rests, thinks and celebrates on the desktop; they never
 * change what an agent may do. A personality has no field that governance reads, and nothing
 * here is consulted by CIMA, the policy registry or the human decision path.
 *
 * Every value sits in a fixed, documented range so the behavior engine stays deterministic
 * under a seeded random source (tests) and bounded on screen (product).
 */

import type { LaPitayaAgentId } from '../agents';

/** What the companion shows while its verified runtime state is WORKING. */
export type CompanionWorkStyle = 'coordinating' | 'designing' | 'coding' | 'testing' | 'inspecting' | 'learning' | 'hosting';

export interface CompanionPersonality {
  /** Ambient desktop strolls per hour while IDLE (0–12). */
  movementFrequency: number;
  /** Stroll speed in px/s (20–120). */
  movementSpeed: number;
  /** Probability that an ambient beat is a rest (0–1). */
  restFrequency: number;
  /** Probability that an ambient beat is a thinking pause (0–1). */
  thinkingFrequency: number;
  /** Preferred distance to another visible companion when approaching (px, 120–600). */
  socialDistance: number;
  /** Celebration strength (0–1): animation speed/height scale. */
  celebrationIntensity: number;
  /** In-window walk amplitude in px (0–40). */
  walkRange: number;
  /** How far an ambient stroll may take the window from its home position (px, 0–240). */
  roamRadius: number;
  workStyle: CompanionWorkStyle;
  /** Short presentation descriptor (es-MX), never a claim about the runtime. */
  temperament: string;
}

export const PERSONALITY_RANGES = {
  movementFrequency: [0, 12],
  movementSpeed: [20, 120],
  restFrequency: [0, 1],
  thinkingFrequency: [0, 1],
  socialDistance: [120, 600],
  celebrationIntensity: [0, 1],
  walkRange: [0, 40],
  roamRadius: [0, 240]
} as const;

export const COMPANION_PERSONALITIES: Readonly<Record<LaPitayaAgentId, CompanionPersonality>> = {
  alicia: {
    movementFrequency: 4, movementSpeed: 60, restFrequency: 0.2, thinkingFrequency: 0.25, socialDistance: 220,
    celebrationIntensity: 0.9, walkRange: 30, roamRadius: 160, workStyle: 'hosting', temperament: 'curiosa, atenta, anfitriona'
  },
  'el-inge': {
    movementFrequency: 3, movementSpeed: 55, restFrequency: 0.15, thinkingFrequency: 0.35, socialDistance: 260,
    celebrationIntensity: 0.6, walkRange: 20, roamRadius: 140, workStyle: 'coordinating', temperament: 'organizado, con propósito'
  },
  valentin: {
    movementFrequency: 1, movementSpeed: 30, restFrequency: 0.3, thinkingFrequency: 0.6, socialDistance: 320,
    celebrationIntensity: 0.4, walkRange: 12, roamRadius: 90, workStyle: 'designing', temperament: 'tranquilo, observador, reflexivo'
  },
  rosalba: {
    movementFrequency: 2, movementSpeed: 40, restFrequency: 0.35, thinkingFrequency: 0.35, socialDistance: 200,
    celebrationIntensity: 0.6, walkRange: 18, roamRadius: 110, workStyle: 'coding', temperament: 'dulce, cálida, experimentada, serena'
  },
  'el-beni': {
    movementFrequency: 6, movementSpeed: 90, restFrequency: 0.1, thinkingFrequency: 0.15, socialDistance: 180,
    celebrationIntensity: 0.9, walkRange: 34, roamRadius: 200, workStyle: 'coding', temperament: 'curioso, enérgico'
  },
  margarito: {
    movementFrequency: 8, movementSpeed: 110, restFrequency: 0.1, thinkingFrequency: 0.2, socialDistance: 160,
    celebrationIntensity: 0.8, walkRange: 36, roamRadius: 180, workStyle: 'testing', temperament: 'rápido, metódico'
  },
  'jose-juan': {
    movementFrequency: 1, movementSpeed: 22, restFrequency: 0.45, thinkingFrequency: 0.35, socialDistance: 300,
    celebrationIntensity: 0.3, walkRange: 8, roamRadius: 70, workStyle: 'inspecting', temperament: 'lento, deliberado, cuidadoso'
  },
  'el-tutu': {
    movementFrequency: 7, movementSpeed: 100, restFrequency: 0.15, thinkingFrequency: 0.3, socialDistance: 170,
    celebrationIntensity: 1, walkRange: 38, roamRadius: 220, workStyle: 'learning', temperament: 'curioso, explorador'
  }
};

/** The personality of an agent; unknown ids get Alicia's calm defaults with movement off. */
export function getCompanionPersonality(agentId: string): CompanionPersonality {
  const p = (COMPANION_PERSONALITIES as Record<string, CompanionPersonality | undefined>)[agentId];
  return p ?? { ...COMPANION_PERSONALITIES.alicia, movementFrequency: 0, roamRadius: 0 };
}

/** Emoji cue shown next to a WORKING companion (presentation only). */
export const WORK_STYLE_CUE: Readonly<Record<CompanionWorkStyle, string>> = {
  coordinating: '📋',
  designing: '📐',
  coding: '⌨️',
  testing: '🧪',
  inspecting: '🔍',
  learning: '📚',
  hosting: '💬'
};
