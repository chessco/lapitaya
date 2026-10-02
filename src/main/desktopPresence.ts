/**
 * DesktopPresenceService for La Pitaya Desktop Companions — FASE 2.
 *
 * Manages the desktop companion window lifecycle, visibility modes, multi-agent presence,
 * event-driven visual reactions, and safe presentation projection.
 *
 * STRICT GOVERNANCE BOUNDARY:
 * This service receives observability signals but NEVER contains or forwards
 * CIMA authority, tokens, ledger data, or approval state.
 */

import { BrowserWindow, screen, ipcMain, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import type { LaPitayaAgentId } from '../shared/lapitaya/agents';
import { LA_PITAYA_AGENT_BY_ID } from '../shared/lapitaya/agents';
import { getAnimalAvatar } from '../shared/lapitaya/desktopCompanions/animalAvatar';
import { COMPANION_IPC, isGovernanceIpcChannel } from '../shared/lapitaya/desktopCompanions/ipc';
import type {
  CompanionMode,
  CompanionPosition,
  CompanionPresentation,
  CompanionPresentationEntry,
  CompanionVisualState,
  CompanionMood,
  CompanionAnimationState,
  CompanionSpeechBubbleData,
  CompanionPreferences
} from '../shared/lapitaya/desktopCompanions/types';

export interface PersistStoreLike {
  getKv<T>(key: string): T | null | undefined;
  setKv<T>(key: string, value: T): void;
}

export interface AliciaCompanionLike {
  snapshot?: (opts?: any) => { presence?: string };
  getObservability?: () => { presence?: string; cimaStatus?: string };
  subscribeObservability?: (fn: (obs: unknown) => void) => () => void;
}

export interface DesktopPresenceDeps {
  persist?: PersistStoreLike;
  aliciaCompanion?: AliciaCompanionLike;
  screenModule?: typeof screen;
  browserWindowFactory?: (opts: BrowserWindowConstructorOptions) => BrowserWindow;
  mainWindowGetter?: () => BrowserWindow | null;
  preloadPath?: string;
  devServerUrl?: string;
}

const DEFAULT_POSITION: CompanionPosition = { x: 100, y: 100 };
const WINDOW_SIZE = { width: 340, height: 340 };
export const MAX_VISIBLE_COMPANIONS_DEFAULT = 3;

export class DesktopPresenceService {
  private mode: CompanionMode = 'OFF';
  private previousModeBeforePause: CompanionMode = 'OFF';
  private companionWindow: BrowserWindow | null = null;
  private primaryVisualState: CompanionVisualState = 'IDLE';
  private primaryMood: CompanionMood = 'CURIOUS';
  private activePhaseAgent: LaPitayaAgentId | null = null;
  private positions: Map<LaPitayaAgentId, CompanionPosition> = new Map();
  private speechBubbles: Map<LaPitayaAgentId, CompanionSpeechBubbleData> = new Map();
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
  private unsubscribeAlicia: (() => void) | null = null;

  private persist?: PersistStoreLike;
  private aliciaCompanion?: AliciaCompanionLike;
  private screenModule?: typeof screen;
  private browserWindowFactory: (opts: BrowserWindowConstructorOptions) => BrowserWindow;
  private mainWindowGetter?: () => BrowserWindow | null;
  private preloadPath: string;
  private devServerUrl?: string;

  constructor(deps: DesktopPresenceDeps = {}) {
    this.persist = deps.persist;
    this.aliciaCompanion = deps.aliciaCompanion;
    this.screenModule = deps.screenModule ?? screen;
    this.browserWindowFactory =
      deps.browserWindowFactory ?? ((opts) => new BrowserWindow(opts));
    this.mainWindowGetter = deps.mainWindowGetter;
    this.preloadPath = deps.preloadPath ?? join(__dirname, '../preload/companionPreload.js');
    this.devServerUrl = deps.devServerUrl ?? process.env.ELECTRON_RENDERER_URL;

    this.restorePositions();
    this.setupIpcHandlers();
    this.setupAliciaSubscription();
  }

  public getMode(): CompanionMode {
    return this.mode;
  }

  public setMode(mode: CompanionMode): void {
    if (this.isDestroyed) return;
    this.mode = mode;
    this.preferences.mode = mode;

    if (mode === 'OFF') {
      this.hideWindow();
    } else if (mode === 'PAUSED') {
      this.pushSnapshot();
    } else {
      this.ensureWindowCreated();
      this.showWindow();
      this.pushSnapshot();
    }
  }

  public show(mode: CompanionMode = 'MINI'): void {
    this.setMode(mode);
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

  public setState(state: CompanionVisualState): void {
    if (this.isDestroyed) return;
    this.primaryVisualState = state;
    this.pushStateUpdate(state);
    this.pushSnapshot();
  }

  public setPreferences(prefs: Partial<CompanionPreferences>): void {
    this.preferences = { ...this.preferences, ...prefs };
    if (prefs.mode) {
      this.setMode(prefs.mode);
    } else {
      this.pushSnapshot();
    }
  }

  public getPreferences(): CompanionPreferences {
    return { ...this.preferences };
  }

  public isWindowVisible(): boolean {
    if (!this.companionWindow || this.companionWindow.isDestroyed()) return false;
    try {
      return this.companionWindow.isVisible();
    } catch {
      return false;
    }
  }

  public triggerVerifiedRuntimeFact(fact: string, agentId?: LaPitayaAgentId): boolean {
    if (!fact || typeof fact !== 'string') return false;
    this.verifiedRuntimeFacts.add(fact);

    switch (fact) {
      case 'BUILD_STARTED':
        this.activePhaseAgent = 'el-beni';
        this.setState('WORKING');
        this.setSpeechBubble('el-beni', 'El Beni iniciando el build.', fact);
        break;
      case 'BUILD_COMPLETED':
        this.activePhaseAgent = 'el-beni';
        this.setState('CELEBRATING');
        this.setSpeechBubble('alicia', 'El build terminó con éxito.', fact);
        break;
      case 'TEST_STARTED':
        this.activePhaseAgent = 'margarito';
        this.setState('WORKING');
        this.setSpeechBubble('margarito', 'Margarito ejecutando pruebas.', fact);
        break;
      case 'TEST_COMPLETED':
        this.activePhaseAgent = 'margarito';
        this.setState('CELEBRATING');
        this.setSpeechBubble('margarito', 'Pruebas completadas correctamente.', fact);
        break;
      case 'AUDIT_STARTED':
        this.activePhaseAgent = 'jose-juan';
        this.setState('WORKING');
        this.setSpeechBubble('jose-juan', 'José Juan revisando auditoría.', fact);
        break;
      case 'AUDIT_COMPLETED':
        this.activePhaseAgent = 'jose-juan';
        this.setState('CELEBRATING');
        this.setSpeechBubble('jose-juan', 'Auditoría aprobada con evidencia.', fact);
        break;
      case 'REQUEST_PENDING':
      case 'APPROVAL_PENDING':
      case 'HUMAN_APPROVAL_REQUIRED':
        this.setState('ATTENTION');
        this.setSpeechBubble('alicia', 'Hay una solicitud que necesita tu confirmación.', fact);
        break;
      default:
        // Do not invent fake facts or arbitrary state changes
        break;
    }

    return true;
  }

  public setSpeechBubble(agentId: LaPitayaAgentId, text: string, sourceFact?: string): void {
    if (!LA_PITAYA_AGENT_BY_ID[agentId]) return;
    const bubble: CompanionSpeechBubbleData = {
      id: `bub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      sourceFact,
      timestamp: Date.now(),
      autoDismissMs: 6000
    };
    this.speechBubbles.set(agentId, bubble);
    this.pushSnapshot();
  }

  public dismissSpeechBubble(agentId: LaPitayaAgentId = 'alicia'): void {
    this.speechBubbles.delete(agentId);
    this.pushSnapshot();
  }

  public getPresentation(): CompanionPresentation {
    let activeAgents: LaPitayaAgentId[] = [];

    if (this.mode === 'MINI') {
      activeAgents = ['alicia'];
    } else if (this.mode === 'FOCUS') {
      activeAgents = [this.activePhaseAgent ?? 'alicia'];
    } else if (this.mode === 'COMPANY') {
      const max = this.preferences.maxVisibleCompanions || MAX_VISIBLE_COMPANIONS_DEFAULT;
      activeAgents = (['alicia', 'el-inge', 'el-beni', 'valentin', 'margarito', 'jose-juan', 'el-tutu'] as LaPitayaAgentId[]).slice(0, max);
    } else {
      activeAgents = ['alicia'];
    }

    const entries: CompanionPresentationEntry[] = activeAgents.map((id) => {
      const avatar = getAnimalAvatar(id);
      const isPrimary = id === 'alicia';
      const pos = this.getPosition(id);
      const visualState = isPrimary ? this.primaryVisualState : 'IDLE';
      const animationState = this.mapVisualToAnimationState(visualState);
      const mood = avatar?.defaultMood ?? 'CALM';
      const bubble = this.speechBubbles.get(id) ?? null;

      return {
        agentId: id,
        species: avatar?.species ?? 'fox',
        visualState,
        mood,
        animationState,
        statusText: `${avatar?.displayName ?? id} (${visualState})`,
        isPrimary,
        position: pos,
        bubble
      };
    });

    return {
      mode: this.mode,
      entries,
      activePhaseAgent: this.activePhaseAgent,
      updatedAt: Date.now()
    };
  }

  public moveCompanion(agentId: LaPitayaAgentId, pos: CompanionPosition): void {
    if (!LA_PITAYA_AGENT_BY_ID[agentId]) {
      throw new Error(`Invalid agent ID for companion movement: ${String(agentId)}`);
    }

    const validatedPos = this.ensureOnScreen(pos);
    this.positions.set(agentId, validatedPos);
    this.savePosition(agentId, validatedPos);

    if (this.companionWindow && !this.companionWindow.isDestroyed()) {
      try {
        this.companionWindow.setPosition(Math.round(validatedPos.x), Math.round(validatedPos.y));
      } catch {
        /* Best-effort window positioning */
      }
    }

    this.pushSnapshot();
  }

  public ensureOnScreen(
    pos: CompanionPosition,
    displayBounds?: { x: number; y: number; width: number; height: number }
  ): CompanionPosition {
    let bounds = displayBounds;

    if (!bounds && this.screenModule) {
      try {
        const primaryDisplay = this.screenModule.getPrimaryDisplay();
        bounds = primaryDisplay.workArea;
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

  public restorePositions(): Record<LaPitayaAgentId, CompanionPosition> {
    const result: Partial<Record<LaPitayaAgentId, CompanionPosition>> = {};
    const agents: LaPitayaAgentId[] = ['alicia', 'el-inge', 'el-beni', 'valentin', 'margarito', 'jose-juan', 'el-tutu'];

    for (const id of agents) {
      let saved: CompanionPosition | null | undefined = null;
      if (this.persist) {
        try {
          saved = this.persist.getKv<CompanionPosition>(`desktopCompanion.position.${id}`);
        } catch {
          saved = null;
        }
      }

      const initial = saved && typeof saved.x === 'number' && typeof saved.y === 'number'
        ? this.ensureOnScreen(saved)
        : { ...DEFAULT_POSITION };

      this.positions.set(id, initial);
      result[id] = initial;
    }

    return result as Record<LaPitayaAgentId, CompanionPosition>;
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.unsubscribeAlicia) {
      this.unsubscribeAlicia();
      this.unsubscribeAlicia = null;
    }
    this.hideWindow();
  }

  private ensureWindowCreated(): BrowserWindow {
    if (this.companionWindow && !this.companionWindow.isDestroyed()) {
      return this.companionWindow;
    }

    const pos = this.getPosition('alicia');

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
    this.companionWindow = win;

    win.on('closed', () => {
      this.companionWindow = null;
    });

    if (this.devServerUrl) {
      const companionUrl = `${this.devServerUrl}?companion=1#/companion`;
      win.loadURL(companionUrl).catch(() => {
        /* best effort URL load */
      });
    } else {
      const indexPath = join(__dirname, '../renderer/index.html');
      win.loadFile(indexPath, { query: { companion: '1' }, hash: 'companion' }).catch(() => {
        /* best effort file load */
      });
    }

    return win;
  }

  private showWindow(): void {
    if (this.companionWindow && !this.companionWindow.isDestroyed()) {
      try {
        this.companionWindow.show();
      } catch {
        /* Best-effort window show */
      }
    }
  }

  private hideWindow(): void {
    if (this.companionWindow && !this.companionWindow.isDestroyed()) {
      try {
        this.companionWindow.hide();
      } catch {
        /* Best-effort window hide */
      }
    }
  }

  private pushSnapshot(): void {
    if (!this.companionWindow || this.companionWindow.isDestroyed()) return;
    const snapshot = this.getPresentation();
    try {
      this.companionWindow.webContents.send(COMPANION_IPC.SNAPSHOT, snapshot);
    } catch {
      /* Best-effort webContents send */
    }
  }

  private pushStateUpdate(state: CompanionVisualState): void {
    if (!this.companionWindow || this.companionWindow.isDestroyed()) return;
    try {
      this.companionWindow.webContents.send(COMPANION_IPC.SET_STATE, state);
    } catch {
      /* Best-effort webContents send */
    }
  }

  private setupIpcHandlers(): void {
    if (!ipcMain || typeof ipcMain.on !== 'function') return;

    ipcMain.on(COMPANION_IPC.POSITION_CHANGED, (_event, pos: CompanionPosition) => {
      if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
      this.moveCompanion('alicia', pos);
    });

    ipcMain.on(COMPANION_IPC.OPEN_MAIN, () => {
      if (this.mainWindowGetter) {
        const main = this.mainWindowGetter();
        if (main && !main.isDestroyed()) {
          if (main.isMinimized()) main.restore();
          main.focus();
        }
      }
    });

    ipcMain.on(COMPANION_IPC.TRIGGER_BUBBLE, (_event, text: string) => {
      if (typeof text === 'string') {
        this.setSpeechBubble('alicia', text);
      }
    });

    ipcMain.on(COMPANION_IPC.DISMISS_BUBBLE, () => {
      this.dismissSpeechBubble('alicia');
    });

    ipcMain.on(COMPANION_IPC.SET_MODE, (_event, mode: CompanionMode) => {
      if (typeof mode === 'string') {
        this.setMode(mode);
      }
    });

    ipcMain.on(COMPANION_IPC.HIDE, () => {
      this.hide();
    });

    // Security boundary: drop any forbidden governance IPC channels
    ipcMain.on('lapitaya:companion:*', (_event, ...args) => {
      for (const arg of args) {
        if (typeof arg === 'string' && isGovernanceIpcChannel(arg)) {
          throw new Error('Forbidden governance IPC channel accessed via companion bridge');
        }
      }
    });
  }

  private setupAliciaSubscription(): void {
    if (!this.aliciaCompanion || typeof this.aliciaCompanion.subscribeObservability !== 'function') return;

    this.unsubscribeAlicia = this.aliciaCompanion.subscribeObservability((obs: any) => {
      if (obs && typeof obs.presence === 'string') {
        const mappedState = this.mapAliciaPresenceToVisualState(obs.presence);
        this.setState(mappedState);
      }
    });
  }

  private mapAliciaPresenceToVisualState(presence: string): CompanionVisualState {
    switch (presence) {
      case 'THINKING':
        return 'THINKING';
      case 'WAITING_APPROVAL':
      case 'WARNING':
        return 'CONCERNED';
      case 'CELEBRATING':
        return 'CELEBRATING';
      case 'NOTIFYING':
        return 'NOTIFYING';
      case 'BLOCKED':
        return 'PAUSED';
      case 'IDLE':
      default:
        return 'IDLE';
    }
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
