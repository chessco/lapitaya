/**
 * Companion behavior engine — FASE 3 (Living Desktop). Pure and presentation-only.
 *
 * It decides how a companion LOOKS (walk, rest, think, sleep, stroll on the desktop) from the
 * presentation state it is given: the verified runtime state, the personality, the user's
 * activity and the companion's position. It never reads governance, never creates a runtime
 * fact, and its output is never fed back into CIMA, tasks, approvals or the ledger.
 *
 * Rule of precedence: a verified runtime state always wins. Ambient behavior (walking, resting,
 * thinking, sleeping) only fills the time while the runtime state is IDLE, so an ambient beat
 * can never hide ATTENTION, WORKING, CONCERNED, PAUSED or CELEBRATING.
 */

import type { CompanionPosition, CompanionVisualState } from './types';
import type { CompanionPersonality } from './personality';

/** Ambient beats a companion may play while its runtime state is IDLE. */
export type AmbientBehavior = 'IDLE' | 'WALKING' | 'THINKING' | 'RESTING';
/** What a companion displays: its runtime state, or (when IDLE) an ambient beat or sleep. */
export type DisplayedBehavior = CompanionVisualState | 'RESTING';

/**
 * Deterministic presentation precedence, highest first. The runtime states keep the order the
 * FASE 2 relay already gives them (human attention first; CONCERNED above WORKING, as in
 * desktopPresence RELAY_PRIORITY); every ambient behavior ranks below every runtime state.
 */
export const BEHAVIOR_PRIORITY: readonly DisplayedBehavior[] = [
  'ATTENTION', 'CONCERNED', 'WORKING', 'PAUSED', 'CELEBRATING', 'THINKING', 'WALKING', 'IDLE', 'RESTING', 'SLEEPING'
];

export function behaviorRank(b: DisplayedBehavior): number {
  const i = BEHAVIOR_PRIORITY.indexOf(b);
  return i < 0 ? BEHAVIOR_PRIORITY.length : i;
}

/** The behavior to display. A non-IDLE runtime state is shown as is; ambient only fills IDLE. */
export function displayedBehavior(visualState: CompanionVisualState, ambient: AmbientBehavior, sleepAllowed: boolean): DisplayedBehavior {
  if (visualState !== 'IDLE') return visualState;
  if (sleepAllowed) return 'SLEEPING';
  return ambient;
}

/** Small deterministic PRNG (mulberry32): tests seed it; the product seeds it from the clock. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AmbientBeat {
  behavior: AmbientBehavior;
  durationMs: number;
}

/** The next ambient beat for an IDLE companion. Durations are bounded (4–14 s). */
export function nextAmbientBeat(p: CompanionPersonality, rng: () => number): AmbientBeat {
  const r = rng();
  const durationMs = 4000 + Math.floor(rng() * 10000);
  if (r < p.restFrequency) return { behavior: 'RESTING', durationMs };
  if (r < p.restFrequency + p.thinkingFrequency) return { behavior: 'THINKING', durationMs };
  if (p.walkRange > 0 && r < p.restFrequency + p.thinkingFrequency + 0.4) return { behavior: 'WALKING', durationMs };
  return { behavior: 'IDLE', durationMs };
}

export interface MovementGate {
  visualState: CompanionVisualState;
  ambientMovement: boolean;
  reducedMotion: boolean;
  dragging: boolean;
  /** A human decision is pending (Alicia must stay put and visible). */
  humanPending: boolean;
  sleeping: boolean;
}

/** Ambient movement is allowed only for an IDLE, awake, undragged companion with movement on. */
export function mayMoveAmbiently(g: MovementGate): boolean {
  return g.visualState === 'IDLE' && g.ambientMovement && !g.reducedMotion && !g.dragging && !g.humanPending && !g.sleeping;
}

/** Whether a stroll starts on this tick: `movementFrequency` strolls per hour on average. */
export function shouldStroll(p: CompanionPersonality, tickMs: number, rng: () => number): boolean {
  if (p.movementFrequency <= 0 || p.roamRadius <= 0) return false;
  return rng() < Math.min(1, (p.movementFrequency * tickMs) / 3_600_000);
}

export interface Rect { x: number; y: number; width: number; height: number }

/** Keep a window of `size` fully inside `area` (the display workArea: taskbar excluded). */
export function clampToArea(pos: CompanionPosition, size: { width: number; height: number }, area: Rect): CompanionPosition {
  const maxX = area.x + Math.max(0, area.width - size.width);
  const maxY = area.y + Math.max(0, area.height - size.height);
  return {
    x: Math.round(Math.max(area.x, Math.min(pos.x, maxX))),
    y: Math.round(Math.max(area.y, Math.min(pos.y, maxY)))
  };
}

export interface StrollPlan {
  from: CompanionPosition;
  home: CompanionPosition;
  /** The workArea of the display the companion is on (multi-monitor: its own display). */
  workArea: Rect;
  windowSize: { width: number; height: number };
  personality: CompanionPersonality;
  /** Positions of the other visible companions (for the occasional approach). */
  others: readonly CompanionPosition[];
  rng: () => number;
}

/**
 * Where an ambient stroll goes: either toward another visible companion (stopping at the
 * personality's social distance) or to a point near home. The target is always within
 * `roamRadius` of home AND inside the companion's own display workArea.
 */
export function planStroll(s: StrollPlan): CompanionPosition {
  const { home, personality: p, rng } = s;
  let target: CompanionPosition;
  if (s.others.length > 0 && rng() < 0.35) {
    const near = [...s.others].sort((a, b) => dist(a, s.from) - dist(b, s.from))[0];
    const d = Math.max(1, dist(near, s.from));
    const k = Math.max(0, (d - p.socialDistance) / d);
    target = { x: s.from.x + (near.x - s.from.x) * k, y: s.from.y + (near.y - s.from.y) * k };
  } else {
    const angle = rng() * Math.PI * 2;
    const r = rng() * p.roamRadius;
    target = { x: home.x + Math.cos(angle) * r, y: home.y + Math.sin(angle) * r };
  }
  // Never further than roamRadius from home …
  const dh = dist(target, home);
  if (dh > p.roamRadius && dh > 0) {
    target = { x: home.x + ((target.x - home.x) * p.roamRadius) / dh, y: home.y + ((target.y - home.y) * p.roamRadius) / dh };
  }
  // … and never outside its own display's workArea.
  return clampToArea(target, s.windowSize, s.workArea);
}

/** The intermediate positions of a stroll at `speed` px/s, one per `stepMs` (capped at 200 steps). */
export function strollPath(from: CompanionPosition, to: CompanionPosition, speed: number, stepMs: number): CompanionPosition[] {
  const d = dist(from, to);
  if (d < 1 || speed <= 0) return [];
  const steps = Math.min(200, Math.max(1, Math.ceil(d / ((speed * stepMs) / 1000))));
  const out: CompanionPosition[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push({ x: Math.round(from.x + ((to.x - from.x) * i) / steps), y: Math.round(from.y + ((to.y - from.y) * i) / steps) });
  }
  return out;
}

export interface SleepContext {
  /** Authoritative executions in progress (ExecutionAwakeService). */
  executionActive: boolean;
  /** A REQUEST or HIGH approval waits for the human. */
  humanPending: boolean;
  /** System idle time reported by the OS (presentation context only). */
  userIdleMs: number;
  sleepAfterMs: number;
}

/** Companions may visually sleep only when nothing runs, nothing waits for the human, and the user is away. */
export function companionSleepAllowed(c: SleepContext): boolean {
  return !c.executionActive && !c.humanPending && c.userIdleMs >= c.sleepAfterMs;
}

function dist(a: CompanionPosition, b: CompanionPosition): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
