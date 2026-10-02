/**
 * Animal Avatar registry and mapping for La Pitaya Desktop Companions.
 * Maps each agent to an extensible animal species representation.
 */

import type { LaPitayaAgentId } from '../agents';
import type { CompanionVisualState } from './types';

export type AnimalSpecies =
  | 'fox'
  | 'beaver'
  | 'cat'
  | 'owl'
  | 'hamster'
  | 'turtle'
  | 'rabbit';

export interface AnimalAvatar {
  agentId: LaPitayaAgentId;
  species: AnimalSpecies;
  displayName: string;
  defaultColor: string;
  allowedStates: readonly CompanionVisualState[];
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
  'PAUSED'
];

export const ANIMAL_AVATAR_REGISTRY: Readonly<Record<LaPitayaAgentId, AnimalAvatar>> = {
  'alicia': {
    agentId: 'alicia',
    species: 'fox',
    displayName: 'Alicia (Fox)',
    defaultColor: '#E65100',
    allowedStates: ALL_VISUAL_STATES
  },
  'el-inge': {
    agentId: 'el-inge',
    species: 'beaver',
    displayName: 'El Inge (Beaver)',
    defaultColor: '#795548',
    allowedStates: ALL_VISUAL_STATES
  },
  'el-beni': {
    agentId: 'el-beni',
    species: 'cat',
    displayName: 'El Beni (Cat)',
    defaultColor: '#FF9800',
    allowedStates: ALL_VISUAL_STATES
  },
  'valentin': {
    agentId: 'valentin',
    species: 'owl',
    displayName: 'Valentín (Owl)',
    defaultColor: '#3F51B5',
    allowedStates: ALL_VISUAL_STATES
  },
  'margarito': {
    agentId: 'margarito',
    species: 'hamster',
    displayName: 'Margarito (Hamster)',
    defaultColor: '#8D6E63',
    allowedStates: ALL_VISUAL_STATES
  },
  'jose-juan': {
    agentId: 'jose-juan',
    species: 'turtle',
    displayName: 'José Juan (Turtle)',
    defaultColor: '#2E7D32',
    allowedStates: ALL_VISUAL_STATES
  },
  'el-tutu': {
    agentId: 'el-tutu',
    species: 'rabbit',
    displayName: 'El Tutú (Rabbit)',
    defaultColor: '#9E9E9E',
    allowedStates: ALL_VISUAL_STATES
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
