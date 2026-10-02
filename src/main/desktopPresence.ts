/**
 * DesktopPresenceService for La Pitaya Desktop Companions — FASE 2.
 *
 * Manages the desktop companion windows' lifecycle, visibility modes, multi-agent presence,
 * event-driven visual reactions, and safe presentation projection.
 *
 * STRICT GOVERNANCE BOUNDARY:
 * This service receives observability signals but NEVER contains or forwards
 * CIMA authority, tokens, ledger data, or approval state. Runtime reactions come
 * only from verified runtime events handed to it by the main process
 * (`observeAliciaEvents`); nothing a companion renderer sends can create one.
 *
 * Presentation model (FASE 2 remediation):
 *  - every companion has its OWN visual state and bubble; a fact names its target explicitly;
 *  - every visible companion has its OWN transparent window and persisted position;
 *  - Alicia relays the state of a companion that is not on screen (in MINI she is the only one,
 *    so a build in progress would otherwise be invisible); `relayedFrom` says whose state it is;
 *  - a pending human request outranks everything on Alicia until the runtime resolves it.
 */

import {
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  screen,
  ipcMain,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions
} from 'electron';
import { join } from 'node:path';
import type { LaPitayaAgentId } from '../shared/lapitaya/agents';
import { LA_PITAYA_AGENT_BY_ID } from '../shared/lapitaya/agents';
import type { AliciaEvent } from '../shared/lapitaya/alicia/events';
import { getAnimalAvatar } from '../shared/lapitaya/desktopCompanions/animalAvatar';
import { COMPANION_IPC } from '../shared/lapitaya/desktopCompanions/ipc';
import {
  COMPANION_FACT_EFFECTS,
  companionFactsFromAliciaEvent,
  isCompanionFact
} from '../shared/lapitaya/desktopCompanions/runtimeFacts';
import {
  isCompanionMode,
  type CompanionMode,
  type CompanionPosition,
  type CompanionPresentation,
  type CompanionPresentationEntry,
  type CompanionVisualState,
  type CompanionAnimationState,
  type CompanionSpeechBubbleData,
  type CompanionPreferences
} from '../shared/lapitaya/desktopCompanions/types';
import { COMPANION_TRAY_ICON_DATA_URL } from './desktopPresenceTrayIcon';

export interface PersistStoreLike {
  getKv<T>(key: string): T | null | undefined;
  setKv<T>(key: string, value: T): void;
}

export interface TimersLike {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface Bounds { x: number; y: number; width: number; height: number }

export interface DesktopPresenceDeps {
  persist?: PersistStoreLike;
  screenModule?: typeof screen;
  browserWindowFactory?: (opts: BrowserWindowConstructorOptions) => BrowserWindow;
  mainWindowGetter?: () => BrowserWindow | null;
  preloadPath?: string;
  devServerUrl?: string;
  timers?: TimersLike;
  now?: () => number;
}

const DEFAULT_POSITION: CompanionPosition = { x: 100, y: 100 };
const WINDOW_SIZE = { width: 340, height: 340 };
export const MAX_VISIBLE_COMPANIONS_DEFAULT = 3;
/** How long a CELEBRATING companion celebrates before returning to rest. */
export const CELEBRATE_MS = 8000;
/** Auto-dismiss delay for non-sticky bubbles. */
export const BUBBLE_AUTO_DISMISS_MS = 6000;

const ALL_AGENTS: readonly LaPitayaAgentId[] = ['alicia', 'el-inge', 'el-beni', 'valentin', 'margarito', 'jose-juan', 'el-tutu'];
/** COMPANY fills the seats after Alicia with the most recently active companions, then in CIMA work order. */
const COMPANY_FILL_ORDER: readonly LaPitayaAgentId[] = ['el-beni', 'margarito', 'jose-juan', 'el-inge', 'valentin', 'el-tutu'];
const VISIBLE_MODES: readonly CompanionMode[] = ['MINI', 'COMPANION', 'COMPANY', 'FOCUS'];

/** How strongly a state asks for the human's eye — decides what Alicia relays. */
const RELAY_PRIORITY: Partial<Record<CompanionVisualState, number>> = {
  ATTENTION: 5, CONCERNED: 4, WORKING: 3, CELEBRATING: 2, THINKING: 1
};
/** States Alicia holds regardless of what she could relay. */
const HARD_STATES: readonly CompanionVisualState[] = ['OFFLINE', 'PAUSED'];

const defaultTimers: TimersLike = {
  setTimeout: (fn, ms) => {
    const h = setTimeout(fn, ms);
    (h as { unref?: () => void }).unref?.();
    return h;
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
};

export class DesktopPresenceService {
  private mode: CompanionMode = 'OFF';
  private previousModeBeforePause: CompanionMode = 'OFF';
  private lastVisibleMode: CompanionMode = 'MINI';
  private windows: Map<LaPitayaAgentId, BrowserWindow> = new Map();
  /** Windows whose renderer finished loading (shown only then, so no unstyled frame flashes). */
  private loaded: Set<LaPitayaAgentId> = new Set();
  private states: Map<LaPitayaAgentId, CompanionVisualState> = new Map();
  private stateTimers: Map<LaPitayaAgentId, unknown> = new Map();
  private lastActivity: Map<LaPitayaAgentId, number> = new Map();
  private activePhaseAgent: LaPitayaAgentId | null = null;
  private positions: Map<LaPitayaAgentId, CompanionPosition> = new Map();
  private speechBubbles: Map<LaPitayaAgentId, CompanionSpeechBubbleData> = new Map();
  private bubbleTimers: Map<LaPitayaAgentId, unknown> = new Map();
  /** Pending human requests (approval / request confirmation) by source ref. */
  private pendingHuman: Map<string, string> = new Map();
  private verifiedRuntimeFacts: Set<string> = new Set();
  private preferences: CompanionPreferences = {
    mode: 'MINI',
    alwaysOnTop: true,
    soundEnabled: false,
    opacity: 1,
    reducedMotion: false,
    maxVisibleCompanions: MAX_VISIBLE_COMPANIONS_DEFAULT
  };
  private isDestroyed = false;
  /** Window position (and cursor point) at the start of an in-progress handle drag, per companion. */
  private dragOrigins: Map<LaPitayaAgentId, { win: CompanionPosition; cursor: CompanionPosition | null }> = new Map();
  /** Positions re-read once the persist store is open (it opens in whenReady, after construction). */
  private positionsReloaded = false;
  private tray: Tray | null = null;
  private seq = 0;

  private persist?: PersistStoreLike;
  private screenModule?: typeof screen;
  private browserWindowFactory: (opts: BrowserWindowConstructorOptions) => BrowserWindow;
  private mainWindowGetter?: () => BrowserWindow | null;
  private preloadPath: string;
  private devServerUrl?: string;
  private timers: TimersLike;
  private now: () => number;

  constructor(deps: DesktopPresenceDeps = {}) {
    this.persist = deps.persist;
    this.screenModule = deps.screenModule ?? screen;
    this.browserWindowFactory =
      deps.browserWindowFactory ?? ((opts) => new BrowserWindow(opts));
    this.mainWindowGetter = deps.mainWindowGetter;
    this.preloadPath = deps.preloadPath ?? join(__dirname, '../preload/companionPreload.js');
    this.devServerUrl = deps.devServerUrl ?? process.env.ELECTRON_RENDERER_URL;
    this.timers = deps.timers ?? defaultTimers;
    this.now = deps.now ?? (() => Date.now());

    this.restorePositions();
    this.setupIpcHandlers();
  }

  // ─── Modes ─────────────────────────────────────────────────────────────────

  public getMode(): CompanionMode {
    return this.mode;
  }

  /** Switch mode. Anything outside COMPANION_MODES is rejected with no state mutation. */
  public setMode(mode: CompanionMode): boolean {
    if (this.isDestroyed || !isCompanionMode(mode)) return false;
    this.mode = mode;
    this.preferences.mode = mode;
    if (VISIBLE_MODES.includes(mode)) this.lastVisibleMode = mode;
    this.syncWindows();
    this.pushSnapshot();
    this.refreshTray();
    return true;
  }

  public show(mode: CompanionMode = 'MINI'): boolean {
    return this.setMode(mode);
  }

  /** Bring the companions back in the mode they were last shown in. */
  public restore(): boolean {
    return this.setMode(this.lastVisibleMode);
  }

  public hide(): void {
    this.setMode('OFF');
  }

  public pause(): void {
    if (this.mode !== 'PAUSED' && this.mode !== 'OFF') {
      this.previousModeBeforePause = this.mode;
      this.setMode('PAUSED');
    }
  }

  public resume(): void {
    if (this.mode === 'PAUSED') {
      const restoreMode = this.previousModeBeforePause !== 'OFF' && this.previousModeBeforePause !== 'PAUSED'
        ? this.previousModeBeforePause
        : 'MINI';
      this.setMode(restoreMode);
    }
  }

  public setPreferences(prefs: Partial<CompanionPreferences>): void {
    const { mode, ...rest } = prefs;
    this.preferences = { ...this.preferences, ...rest };
    if (mode !== undefined) {
      this.setMode(mode);
    } else {
      this.syncWindows();
      this.pushSnapshot();
    }
  }

  public getPreferences(): CompanionPreferences {
    return { ...this.preferences };
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  /** Set one companion's visual state (Alicia when no agent is named). */
  public setState(state: CompanionVisualState, agentId: LaPitayaAgentId = 'alicia'): void {
    if (this.isDestroyed || !LA_PITAYA_AGENT_BY_ID[agentId]) return;
    this.applyState(agentId, state);
    this.pushSnapshot();
  }

  public getAgentState(agentId: LaPitayaAgentId): CompanionVisualState {
    return this.states.get(agentId) ?? 'IDLE';
  }

  public isWindowVisible(agentId?: LaPitayaAgentId): boolean {
    const wins = agentId ? [this.windows.get(agentId)] : [...this.windows.values()];
    return wins.some((w) => {
      if (!w || w.isDestroyed()) return false;
      try {
        return w.isVisible();
      } catch {
        return false;
      }
    });
  }

  // ─── Verified runtime facts ────────────────────────────────────────────────

  /**
   * Feed verified runtime events (CimaRuntimeService.onEvent → fromRuntimeEvent). Main process only.
   * A failure here never propagates back into the governance event path.
   */
  public observeAliciaEvents(events: readonly AliciaEvent[]): void {
    for (const ev of events) {
      try {
        for (const f of companionFactsFromAliciaEvent(ev)) this.triggerVerifiedRuntimeFact(f.fact, { ref: f.ref });
      } catch {
        /* presentation must never break the runtime */
      }
    }
  }

  /** Apply one verified fact. Unknown facts are rejected: no state change, no bubble. */
  public triggerVerifiedRuntimeFact(fact: string, meta: { ref?: string } = {}): boolean {
    if (this.isDestroyed || !isCompanionFact(fact)) return false;
    this.verifiedRuntimeFacts.add(fact);
    const effect = COMPANION_FACT_EFFECTS[fact];

    if (!effect) {
      // A resolution: clear exactly the pending request it names.
      if (meta.ref && this.pendingHuman.delete(meta.ref) && this.pendingHuman.size === 0) {
        if (this.getAgentState('alicia') === 'ATTENTION') this.applyState('alicia', 'IDLE');
        const b = this.speechBubbles.get('alicia');
        if (b && b.autoDismissMs === undefined) this.clearBubble('alicia');
      }
      this.syncWindows();
      this.pushSnapshot();
      return true;
    }

    if (effect.sticky) this.pendingHuman.set(meta.ref ?? `${fact}-${this.now()}-${++this.seq}`, fact);
    if (effect.phaseAgent) this.activePhaseAgent = effect.phaseAgent;
    if (effect.release) {
      this.applyState(effect.release, 'IDLE');
      this.clearBubble(effect.release);
    }

    const humanPending = this.pendingHuman.size > 0;
    if (effect.target === 'alicia' && humanPending && !effect.sticky) {
      // A pending human request outranks everything on Alicia: keep ATTENTION and its bubble.
    } else {
      this.applyState(effect.target, effect.state);
      this.setBubble(effect.target, {
        id: this.bubbleId(),
        text: effect.text,
        kind: 'runtime-fact',
        sourceFact: fact,
        timestamp: this.now(),
        ...(effect.sticky ? {} : { autoDismissMs: BUBBLE_AUTO_DISMISS_MS })
      });
    }

    this.syncWindows();
    this.pushSnapshot();
    return true;
  }

  // ─── Bubbles ───────────────────────────────────────────────────────────────

  /** A conversation bubble. Never a runtime fact: no `sourceFact`, whatever the text says. */
  public setSpeechBubble(agentId: LaPitayaAgentId, text: string): void {
    if (!LA_PITAYA_AGENT_BY_ID[agentId] || typeof text !== 'string') return;
    this.setBubble(agentId, {
      id: this.bubbleId(),
      text,
      kind: 'conversation',
      timestamp: this.now(),
      autoDismissMs: BUBBLE_AUTO_DISMISS_MS
    });
    this.pushSnapshot();
  }

  public dismissSpeechBubble(agentId: LaPitayaAgentId = 'alicia'): void {
    this.clearBubble(agentId);
    this.pushSnapshot();
  }

  // ─── Presentation ──────────────────────────────────────────────────────────

  /** Which companions are on screen for the current mode. */
  public getVisibleAgents(): LaPitayaAgentId[] {
    if (this.mode === 'FOCUS') {
      return [this.pendingHuman.size > 0 ? 'alicia' : this.activePhaseAgent ?? 'alicia'];
    }
    if (this.mode === 'COMPANY') {
      const max = Math.max(1, Math.min(this.preferences.maxVisibleCompanions || MAX_VISIBLE_COMPANIONS_DEFAULT, MAX_VISIBLE_COMPANIONS_DEFAULT));
      const recent = [...this.lastActivity.entries()]
        .filter(([id]) => id !== 'alicia')
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
      const seats: LaPitayaAgentId[] = ['alicia'];
      for (const id of [...recent, ...COMPANY_FILL_ORDER]) {
        if (seats.length >= max) break;
        if (!seats.includes(id)) seats.push(id);
      }
      return seats;
    }
    return ['alicia'];
  }

  public getPresentation(): CompanionPresentation {
    const visible = this.getVisibleAgents();
    const entries: CompanionPresentationEntry[] = visible.map((id) => {
      const avatar = getAnimalAvatar(id);
      const isPrimary = id === 'alicia';
      let visualState = this.getAgentState(id);
      let bubble = this.speechBubbles.get(id) ?? null;
      let relayedFrom: LaPitayaAgentId | null = null;

      if (isPrimary && !HARD_STATES.includes(visualState)) {
        const relay = this.strongestOffscreen(visible);
        if (relay && (RELAY_PRIORITY[relay.state] ?? 0) > (RELAY_PRIORITY[visualState] ?? 0)) {
          visualState = relay.state;
          relayedFrom = relay.agentId;
          bubble = bubble ?? this.speechBubbles.get(relay.agentId) ?? null;
        }
      }

      const displayName = LA_PITAYA_AGENT_BY_ID[id].name;
      return {
        agentId: id,
        displayName,
        species: avatar?.species ?? 'fox',
        visualState,
        mood: avatar?.defaultMood ?? 'CALM',
        animationState: this.mapVisualToAnimationState(visualState),
        statusText: `${displayName} (${visualState})`,
        isPrimary,
        position: this.getPosition(id),
        bubble,
        relayedFrom
      };
    });

    return {
      mode: this.mode,
      entries,
      activePhaseAgent: this.activePhaseAgent,
      updatedAt: this.now()
    };
  }

  // ─── Positions ─────────────────────────────────────────────────────────────

  public moveCompanion(agentId: LaPitayaAgentId, pos: CompanionPosition): void {
    if (!LA_PITAYA_AGENT_BY_ID[agentId]) {
      throw new Error(`Invalid agent ID for companion movement: ${String(agentId)}`);
    }

    const validatedPos = this.ensureOnScreen(pos);
    this.positions.set(agentId, validatedPos);
    this.savePosition(agentId, validatedPos);

    const win = this.windows.get(agentId);
    if (win && !win.isDestroyed()) this.placeWindow(win, validatedPos);

    this.pushSnapshot();
  }

  /**
   * Clamp a window position into a work area. Without explicit bounds it uses the work area of the
   * display the window overlaps most (Electron's `getDisplayMatching`, which falls back to the nearest
   * display when the window is off every display) — never blindly the primary display.
   */
  public ensureOnScreen(pos: CompanionPosition, displayBounds?: Bounds): CompanionPosition {
    let bounds = displayBounds;

    if (!bounds && this.screenModule) {
      try {
        const rect = { x: Math.round(pos.x), y: Math.round(pos.y), ...WINDOW_SIZE };
        bounds = typeof this.screenModule.getDisplayMatching === 'function'
          ? this.screenModule.getDisplayMatching(rect).workArea
          : this.screenModule.getPrimaryDisplay().workArea;
      } catch {
        /* Fallback bounds if screen API is unavailable */
      }
    }

    if (!bounds) {
      bounds = { x: 0, y: 0, width: 1920, height: 1080 };
    }

    const minX = bounds.x;
    const maxX = bounds.x + bounds.width - WINDOW_SIZE.width;
    const minY = bounds.y;
    const maxY = bounds.y + bounds.height - WINDOW_SIZE.height;

    const clampedX = Math.max(minX, Math.min(pos.x, maxX));
    const clampedY = Math.max(minY, Math.min(pos.y, maxY));

    return { x: clampedX, y: clampedY };
  }

  public getPosition(agentId: LaPitayaAgentId): CompanionPosition {
    return this.positions.get(agentId) ?? DEFAULT_POSITION;
  }

  public savePosition(agentId: LaPitayaAgentId, pos: CompanionPosition): void {
    if (!this.persist) return;
    try {
      this.persist.setKv(`desktopCompanion.position.${agentId}`, pos);
    } catch {
      /* DB best-effort */
    }
  }

  /**
   * Load persisted positions (or staggered defaults). Not clamped here: this runs before the app is
   * ready, when the screen API is unavailable. Each position is clamped to its own display when the
   * companion's window is created.
   */
  public restorePositions(): Record<LaPitayaAgentId, CompanionPosition> {
    const result: Partial<Record<LaPitayaAgentId, CompanionPosition>> = {};

    for (const id of ALL_AGENTS) {
      let saved: CompanionPosition | null | undefined = null;
      if (this.persist) {
        try {
          saved = this.persist.getKv<CompanionPosition>(`desktopCompanion.position.${id}`);
        } catch {
          saved = null;
        }
      }

      const initial = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
        ? { x: saved.x, y: saved.y }
        : this.defaultPosition(id);

      this.positions.set(id, initial);
      result[id] = initial;
    }

    return result as Record<LaPitayaAgentId, CompanionPosition>;
  }

  /** Re-read persisted positions without touching companions that have none saved. */
  private reloadSavedPositions(): void {
    if (!this.persist) return;
    for (const id of ALL_AGENTS) {
      try {
        const saved = this.persist.getKv<CompanionPosition>(`desktopCompanion.position.${id}`);
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) this.positions.set(id, { x: saved.x, y: saved.y });
      } catch {
        /* DB best-effort */
      }
    }
  }

  // ─── Tray (hide / show without restarting La Pitaya) ────────────────────────

  /** Install the notification-area icon that restores hidden companions and switches modes. */
  public installTray(): void {
    if (this.tray || this.isDestroyed) return;
    try {
      const icon = nativeImage.createFromDataURL(COMPANION_TRAY_ICON_DATA_URL).resize({ width: 16, height: 16 });
      this.tray = new Tray(icon);
      this.tray.setToolTip('La Pitaya — compañeros');
      this.tray.on('click', () => {
        if (this.mode === 'OFF') this.restore();
        else this.hide();
      });
      this.refreshTray();
    } catch (e) {
      console.error('[desktopPresence] tray unavailable:', e);
      this.tray = null;
    }
  }

  /** The tray menu, as data (clicks included) so it is testable without a real Tray. */
  public trayMenuTemplate(): MenuItemConstructorOptions[] {
    const hidden = this.mode === 'OFF';
    const modeItem = (label: string, mode: CompanionMode): MenuItemConstructorOptions => ({
      label,
      type: 'radio',
      checked: this.mode === mode,
      click: () => { this.setMode(mode); }
    });
    return [
      { label: 'Mostrar compañeros', enabled: hidden, click: () => { this.restore(); } },
      { label: 'Ocultar compañeros', enabled: !hidden, click: () => { this.hide(); } },
      { type: 'separator' },
      modeItem('Modo Mini (Alicia)', 'MINI'),
      modeItem('Modo Compañía', 'COMPANY'),
      modeItem('Modo Enfoque', 'FOCUS'),
      { type: 'separator' },
      { label: 'Abrir La Pitaya', click: () => { this.focusMain(); } }
    ];
  }

  public destroy(): void {
    this.isDestroyed = true;
    for (const h of [...this.bubbleTimers.values(), ...this.stateTimers.values()]) this.timers.clearTimeout(h);
    this.bubbleTimers.clear();
    this.stateTimers.clear();
    for (const w of this.windows.values()) {
      try {
        if (!w.isDestroyed()) w.hide();
      } catch {
        /* window gone */
      }
    }
    try {
      this.tray?.destroy();
    } catch {
      /* tray gone */
    }
    this.tray = null;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private defaultPosition(id: LaPitayaAgentId): CompanionPosition {
    if (id === 'alicia') return { ...DEFAULT_POSITION };
    const i = COMPANY_FILL_ORDER.indexOf(id);
    return { x: DEFAULT_POSITION.x + 300 * (i + 1), y: DEFAULT_POSITION.y };
  }

  private bubbleId(): string {
    return `bub-${this.now()}-${(++this.seq).toString(36)}`;
  }

  private applyState(agentId: LaPitayaAgentId, state: CompanionVisualState): void {
    const pendingTimer = this.stateTimers.get(agentId);
    if (pendingTimer !== undefined) {
      this.timers.clearTimeout(pendingTimer);
      this.stateTimers.delete(agentId);
    }
    this.states.set(agentId, state);
    if (state !== 'IDLE') this.lastActivity.set(agentId, this.now());

    if (state === 'CELEBRATING') {
      const handle = this.timers.setTimeout(() => {
        this.stateTimers.delete(agentId);
        if (this.isDestroyed || this.states.get(agentId) !== 'CELEBRATING') return;
        this.states.set(agentId, agentId === 'alicia' && this.pendingHuman.size > 0 ? 'ATTENTION' : 'IDLE');
        this.pushSnapshot();
      }, CELEBRATE_MS);
      this.stateTimers.set(agentId, handle);
    }
  }

  private setBubble(agentId: LaPitayaAgentId, bubble: CompanionSpeechBubbleData): void {
    this.clearBubble(agentId);
    this.speechBubbles.set(agentId, bubble);
    if (bubble.autoDismissMs !== undefined) {
      const handle = this.timers.setTimeout(() => {
        this.bubbleTimers.delete(agentId);
        if (this.speechBubbles.get(agentId)?.id !== bubble.id) return;
        this.speechBubbles.delete(agentId);
        this.pushSnapshot();
      }, bubble.autoDismissMs);
      this.bubbleTimers.set(agentId, handle);
    }
  }

  private clearBubble(agentId: LaPitayaAgentId): void {
    const handle = this.bubbleTimers.get(agentId);
    if (handle !== undefined) {
      this.timers.clearTimeout(handle);
      this.bubbleTimers.delete(agentId);
    }
    this.speechBubbles.delete(agentId);
  }

  /** The off-screen companion whose state most asks for attention (most recent on a tie). */
  private strongestOffscreen(visible: readonly LaPitayaAgentId[]): { agentId: LaPitayaAgentId; state: CompanionVisualState } | null {
    let best: { agentId: LaPitayaAgentId; state: CompanionVisualState; p: number; t: number } | null = null;
    for (const [agentId, state] of this.states) {
      if (visible.includes(agentId)) continue;
      const p = RELAY_PRIORITY[state] ?? 0;
      if (p === 0) continue;
      const t = this.lastActivity.get(agentId) ?? 0;
      if (!best || p > best.p || (p === best.p && t > best.t)) best = { agentId, state, p, t };
    }
    return best ? { agentId: best.agentId, state: best.state } : null;
  }

  /** Create/show a window per visible companion; hide the rest. */
  private syncWindows(): void {
    if (this.isDestroyed || this.mode === 'PAUSED') return;
    const visible = this.mode === 'OFF' ? [] : this.getVisibleAgents();
    for (const id of visible) {
      const win = this.ensureWindowCreated(id);
      if (!this.loaded.has(id)) continue; // shown by did-finish-load
      try {
        if (!win.isVisible()) win.show();
      } catch {
        /* Best-effort window show */
      }
    }
    for (const [id, win] of this.windows) {
      if (visible.includes(id) || win.isDestroyed()) continue;
      try {
        win.hide();
      } catch {
        /* Best-effort window hide */
      }
    }
  }

  private ensureWindowCreated(agentId: LaPitayaAgentId): BrowserWindow {
    const existing = this.windows.get(agentId);
    if (existing && !existing.isDestroyed()) return existing;

    if (!this.positionsReloaded) {
      this.positionsReloaded = true;
      this.reloadSavedPositions();
    }
    // Clamp now (the screen API is available once windows exist) against the display the position is on.
    const pos = this.ensureOnScreen(this.getPosition(agentId));
    this.positions.set(agentId, pos);

    const winOpts: BrowserWindowConstructorOptions = {
      width: WINDOW_SIZE.width,
      height: WINDOW_SIZE.height,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      transparent: true,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    };

    const win = this.browserWindowFactory(winOpts);
    this.windows.set(agentId, win);
    // The window is mostly transparent: let clicks through until the pointer is over the creature.
    this.setClickThrough(win, true);

    win.on('closed', () => {
      if (this.windows.get(agentId) === win) {
        this.windows.delete(agentId);
        this.loaded.delete(agentId);
      }
    });
    // The OS drag (via the renderer's drag handle) ends in `moved`: persist it, clamped to its display.
    win.on('moved', () => this.handleWindowMoved(agentId, win));
    if (typeof win.webContents?.on === 'function') {
      win.webContents.on('did-finish-load', () => {
        this.loaded.add(agentId);
        this.syncWindows();
        this.pushSnapshot();
      });
    } else {
      this.loaded.add(agentId); // no load lifecycle to wait for
    }

    const query = { companion: '1', agent: agentId };
    if (this.devServerUrl) {
      const companionUrl = `${this.devServerUrl}?companion=1&agent=${encodeURIComponent(agentId)}#/companion`;
      win.loadURL(companionUrl).catch(() => {
        /* best effort URL load */
      });
    } else {
      const indexPath = join(__dirname, '../renderer/index.html');
      win.loadFile(indexPath, { query, hash: 'companion' }).catch(() => {
        /* best effort file load */
      });
    }

    return win;
  }

  private handleWindowMoved(agentId: LaPitayaAgentId, win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    let x: number;
    let y: number;
    try {
      [x, y] = win.getPosition();
    } catch {
      return;
    }
    const clamped = this.ensureOnScreen({ x, y });
    this.positions.set(agentId, clamped);
    this.savePosition(agentId, clamped);
    if (clamped.x !== x || clamped.y !== y) this.placeWindow(win, clamped);
  }

  private cursorPoint(): CompanionPosition | null {
    try {
      return typeof this.screenModule?.getCursorScreenPoint === 'function' ? this.screenModule.getCursorScreenPoint() : null;
    } catch {
      return null;
    }
  }

  /** Move a companion window keeping its size (on Windows a bare setPosition across scale factors can resize it). */
  private placeWindow(win: BrowserWindow, pos: CompanionPosition): void {
    const x = Math.round(pos.x);
    const y = Math.round(pos.y);
    try {
      if (typeof win.setBounds === 'function') win.setBounds({ x, y, ...WINDOW_SIZE });
      else win.setPosition(x, y);
    } catch {
      /* Best-effort window positioning */
    }
  }

  private setClickThrough(win: BrowserWindow, through: boolean): void {
    if (typeof win.setIgnoreMouseEvents !== 'function') return;
    try {
      win.setIgnoreMouseEvents(through, { forward: true });
    } catch {
      /* window gone */
    }
  }

  private focusMain(): void {
    const main = this.mainWindowGetter?.();
    if (!main || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    if (!main.isVisible()) main.show();
    main.focus();
  }

  private refreshTray(): void {
    if (!this.tray) return;
    try {
      this.tray.setContextMenu(Menu.buildFromTemplate(this.trayMenuTemplate()));
    } catch {
      /* tray gone */
    }
  }

  private pushSnapshot(): void {
    if (this.windows.size === 0) return;
    const snapshot = this.getPresentation();
    for (const win of this.windows.values()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(COMPANION_IPC.SNAPSHOT, snapshot);
      } catch {
        /* Best-effort webContents send */
      }
    }
  }

  /** The companion whose window sent an IPC message — or null for any other sender. */
  private agentForSender(event: { sender?: unknown } | null | undefined): LaPitayaAgentId | null {
    const sender = event?.sender;
    if (!sender) return null;
    for (const [id, win] of this.windows) {
      if (!win.isDestroyed() && win.webContents === sender) return id;
    }
    return null;
  }

  private setupIpcHandlers(): void {
    if (!ipcMain || typeof ipcMain.on !== 'function') return;

    // Only companion windows may drive these channels; every payload is validated.
    ipcMain.on(COMPANION_IPC.REQUEST_SNAPSHOT, (event) => {
      const agentId = this.agentForSender(event);
      const win = agentId ? this.windows.get(agentId) : undefined;
      if (!win || win.isDestroyed()) return;
      try {
        win.webContents.send(COMPANION_IPC.SNAPSHOT, this.getPresentation());
      } catch {
        /* Best-effort webContents send */
      }
    });

    ipcMain.on(COMPANION_IPC.OPEN_MAIN, (event) => {
      if (!this.agentForSender(event)) return;
      this.focusMain();
    });

    ipcMain.on(COMPANION_IPC.DISMISS_BUBBLE, (event) => {
      const agentId = this.agentForSender(event);
      if (!agentId) return;
      const entry = this.getPresentation().entries.find((e) => e.agentId === agentId);
      const owner = entry?.bubble && !this.speechBubbles.has(agentId) && entry.relayedFrom ? entry.relayedFrom : agentId;
      const bubble = this.speechBubbles.get(owner);
      // A sticky bubble (pending human request) stays until the runtime resolves it.
      if (!bubble || bubble.autoDismissMs === undefined) return;
      this.dismissSpeechBubble(owner);
    });

    ipcMain.on(COMPANION_IPC.SET_MODE, (event, mode: unknown) => {
      if (!this.agentForSender(event) || !isCompanionMode(mode)) return;
      this.setMode(mode);
    });

    ipcMain.on(COMPANION_IPC.HIDE, (event) => {
      if (!this.agentForSender(event)) return;
      this.hide();
    });

    ipcMain.on(COMPANION_IPC.DRAG, (event, payload: unknown) => {
      const agentId = this.agentForSender(event);
      const win = agentId ? this.windows.get(agentId) : undefined;
      if (!agentId || !win || win.isDestroyed()) return;
      const p = (payload && typeof payload === 'object' ? payload : {}) as { phase?: unknown; dx?: unknown; dy?: unknown };
      const dx = typeof p.dx === 'number' && Number.isFinite(p.dx) && Math.abs(p.dx) <= 20000 ? p.dx : null;
      const dy = typeof p.dy === 'number' && Number.isFinite(p.dy) && Math.abs(p.dy) <= 20000 ? p.dy : null;
      if (p.phase === 'start') {
        try {
          const [x, y] = win.getPosition();
          this.dragOrigins.set(agentId, { win: { x, y }, cursor: this.cursorPoint() });
        } catch {
          /* window gone */
        }
      } else if (p.phase === 'move') {
        const origin = this.dragOrigins.get(agentId);
        if (!origin) return;
        // Prefer the main process' cursor point: one coordinate space across displays with different
        // scale factors (a renderer's screenX changes units when the window crosses to another DPI).
        const cursor = origin.cursor ? this.cursorPoint() : null;
        const delta = cursor && origin.cursor
          ? { x: cursor.x - origin.cursor.x, y: cursor.y - origin.cursor.y }
          : dx !== null && dy !== null ? { x: dx, y: dy } : null;
        if (!delta) return;
        // Free movement while dragging (it may cross displays); clamped when the drag ends.
        this.placeWindow(win, { x: origin.win.x + delta.x, y: origin.win.y + delta.y });
      } else if (p.phase === 'end') {
        if (!this.dragOrigins.delete(agentId)) return;
        this.handleWindowMoved(agentId, win);
      }
    });

    ipcMain.on(COMPANION_IPC.SET_INTERACTIVE, (event, interactive: unknown) => {
      const agentId = this.agentForSender(event);
      const win = agentId ? this.windows.get(agentId) : undefined;
      if (!win || win.isDestroyed() || typeof interactive !== 'boolean') return;
      this.setClickThrough(win, !interactive);
    });
  }

  private mapVisualToAnimationState(state: CompanionVisualState): CompanionAnimationState {
    switch (state) {
      case 'WALKING':
        return 'walk';
      case 'THINKING':
      case 'SUGGESTING':
        return 'think';
      case 'WORKING':
        return 'work';
      case 'CELEBRATING':
      case 'HAPPY':
        return 'celebrate';
      case 'CONCERNED':
        return 'concern';
      case 'SLEEPING':
        return 'sleep';
      case 'ATTENTION':
      case 'NOTIFYING':
        return 'attention';
      case 'OFFLINE':
      case 'PAUSED':
        return 'offline';
      case 'IDLE':
      default:
        return 'idle';
    }
  }
}
