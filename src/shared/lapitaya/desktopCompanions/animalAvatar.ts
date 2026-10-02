/**
 * Animal Avatar registry and mapping for La Pitaya Desktop Companions — FASE 2.
 * Maps each agent to an extensible animal species representation with personality metadata.
 */

import type { LaPitayaAgentId } from '../agents';
import type { CompanionVisualState, CompanionMood } from './types';

export type AnimalSpecies =
  | 'fox'
  | 'beaver'
  | 'cat'
  | 'owl'
  | 'hamster'
  | 'turtle'
  | 'rabbit';

export interface AnimalAvatarPersonality {
  traits: readonly string[];
  greeting: string;
  idleBehaviorDescription: string;
}

export interface AnimalAvatar {
  agentId: LaPitayaAgentId;
  species: AnimalSpecies;
  displayName: string;
  emoji: string;
  defaultColor: string;
  defaultMood: CompanionMood;
  allowedStates: readonly CompanionVisualState[];
  personality: AnimalAvatarPersonality;
}

const ALL_VISUAL_STATES: readonly CompanionVisualState[] = [
  'IDLE',
  'WALKING',
  'SLEEPING',
  'THINKING',
  'WORKING',
  'CELEBRATING',
  'SUGGESTING',
  'CONCERNED',
  'NOTIFYING',
  'PAUSED',
  'HAPPY',
  'ATTENTION',
  'OFFLINE'
];

export const ANIMAL_AVATAR_REGISTRY: Readonly<Record<LaPitayaAgentId, AnimalAvatar>> = {
  'alicia': {
    agentId: 'alicia',
    species: 'fox',
    displayName: 'Alicia (Fox)',
    emoji: '🦊',
    defaultColor: '#E65100',
    defaultMood: 'CURIOUS',
    allowedStates: ALL_VISUAL_STATES,
    personality: {
      traits: ['curious', 'friendly', 'smart', 'expressive', 'calm'],
      greeting: 'Hola, aquí estoy en tu escritorio.',
      idleBehaviorDescription: 'Alicia observa con curiosidad, camina suavemente y descansa.'
    }
  },
  'el-inge': {
    agentId: 'el-inge',
    species: 'beaver',
    displayName: 'El Inge (Beaver)',
    emoji: '🦫',
    defaultColor: '#795548',
    defaultMood: 'FOCUSED',
    allowedStates: ALL_VISUAL_STATES,
    personality: {
      traits: ['orchestrator', 'methodical', 'leader'],
      greeting: 'El Inge coordinando la empresa virtual.',
      idleBehaviorDescription: 'Supervisa las tareas del equipo.'
    }
  },
  'el-beni': {
    agentId: 'el-beni',
    species: 'cat',
    displayName: 'El Beni (Cat)',
    emoji: '🐱',
    defaultColor: '#FF9800',
    defaultMood: 'HAPPY',
    allowedStates: ALL_VISUAL_STATES,
    personality: {
      traits: ['builder', 'energetic', 'practical'],
      greeting: 'El Beni listo para construir código.',
      idleBehaviorDescription: 'Revisa planos y herramientas de construcción.'
    }
  },
  'valentin': {
    agentId: 'valentin',
    species: 'owl',
    displayName: 'Valentín (Owl)',
    emoji: '🦉',
    defaultColor: '#3F51B5',
    defaultMood: 'CALM',
    allowedStates: ALL_VISUAL_STATES,
    personality: {
      traits: ['architect', 'wise', 'observant'],
      greeting: 'Valentín analizando la arquitectura.',
      idleBehaviorDescription: 'Observa en silencio la estructura del sistema.'
    }
  },
  'margarito': {
    agentId: 'margarito',
    species: 'hamster',
    displayName: 'Margarito (Hamster)',
    emoji: '🐹',
    defaultColor: '#8D6E63',
    defaultMood: 'FOCUSED',
    allowedStates: ALL_VISUAL_STATES,
    personality: {
      traits: ['tester', 'meticulous', 'alert'],
      greeting: 'Margarito probando casos de prueba.',
      idleBehaviorDescription: 'Inspecciona bordes y ejecuta suites de test.'
    }
  },
  'jose-juan': {
    agentId: 'jose-juan',
    species: 'turtle',
    displayName: 'José Juan (Turtle)',
    emoji: '🐢',
    defaultColor: '#2E7D32',
    defaultMood: 'CALM',
    allowedStates: ALL_VISUAL_STATES,
    personality: {
      traits: ['auditor', 'careful', 'deliberate'],
      greeting: 'José Juan auditando la calidad.',
      idleBehaviorDescription: 'Verifica evidencias con paciencia y precisión.'
    }
  },
  'el-tutu': {
    agentId: 'el-tutu',
    species: 'rabbit',
    displayName: 'El Tutú (Rabbit)',
    emoji: '🐰',
    defaultColor: '#9E9E9E',
    defaultMood: 'EXCITED',
    allowedStates: ALL_VISUAL_STATES,
    personality: {
      traits: ['learner', 'quick', 'eager'],
      greeting: 'El Tutú consolidando aprendizajes.',
      idleBehaviorDescription: 'Anota lecciones y resúmenes de decisión.'
    }
  }
};

export function getAnimalAvatar(agentId: LaPitayaAgentId): AnimalAvatar | undefined {
  return ANIMAL_AVATAR_REGISTRY[agentId];
}

export function isAllowedCompanionState(agentId: LaPitayaAgentId, state: CompanionVisualState): boolean {
  const avatar = getAnimalAvatar(agentId);
  if (!avatar) return false;
  return avatar.allowedStates.includes(state);
}
