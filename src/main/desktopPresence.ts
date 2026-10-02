/**
 * DesktopPresenceService for La Pitaya Desktop Companions — FASE 1.
 *
 * Manages the desktop companion window lifecycle, visibility modes, avatar positions,
 * and safe presentation projection.
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
  CompanionVisualState
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
const WINDOW_SIZE = { width: 220, height: 220 };

export class DesktopPresenceService {
  private mode: CompanionMode = 'OFF';
  private previousModeBeforePause: CompanionMode = 'OFF';
  private companionWindow: BrowserWindow | null = null;
  private primaryVisualState: CompanionVisualState = 'IDLE';
  private positions: Map<LaPitayaAgentId, CompanionPosition> = new Map();
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

  public isWindowVisible(): boolean {
    if (!this.companionWindow || this.companionWindow.isDestroyed()) return false;
    try {
      return this.companionWindow.isVisible();
    } catch {
      return false;
    }
  }

  public getPresentation(): CompanionPresentation {
    const aliciaAvatar = getAnimalAvatar('alicia');
    const aliciaPos = this.getPosition('alicia');

    const entries: CompanionPresentationEntry[] = [
      {
        agentId: 'alicia',
        species: aliciaAvatar?.species ?? 'fox',
        visualState: this.primaryVisualState,
        statusText: `Alicia (${this.primaryVisualState})`,
        isPrimary: true,
        position: aliciaPos
      }
    ];

    return {
      mode: this.mode,
      entries,
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

    // Guard against any unauthorized IPC listeners receiving governance channels
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
}
