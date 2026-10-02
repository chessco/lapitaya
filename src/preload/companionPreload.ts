/**
 * Isolated Electron Preload script for Desktop Companion windows — FASE 2.
 *
 * Exposes ONLY safe presentation bridge APIs (`window.companionBridge`).
 * NO governance, CIMA, filesystem, terminal, or arbitrary IPC access.
 * Every method is bound to one fixed channel; there is no generic send/invoke
 * and no method that sets a bubble text, a visual state or a runtime fact.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { COMPANION_IPC, type CompanionDragPhase } from '../shared/lapitaya/desktopCompanions/ipc';
import type {
  CompanionPresentation,
  CompanionMode
} from '../shared/lapitaya/desktopCompanions/types';

export interface CompanionBridgeAPI {
  onSnapshot: (callback: (snapshot: CompanionPresentation) => void) => () => void;
  open: () => void;
  dismissBubble: () => void;
  setMode: (mode: CompanionMode) => void;
  hide: () => void;
  setInteractive: (interactive: boolean) => void;
  drag: (phase: CompanionDragPhase, dx: number, dy: number) => void;
}

const companionBridge: CompanionBridgeAPI = {
  onSnapshot: (callback) => {
    const handler = (_event: unknown, snapshot: CompanionPresentation) => {
      callback(snapshot);
    };
    ipcRenderer.on(COMPANION_IPC.SNAPSHOT, handler);
    // The page subscribes after it has loaded: ask for the snapshot it may have missed.
    ipcRenderer.send(COMPANION_IPC.REQUEST_SNAPSHOT);
    return () => {
      ipcRenderer.removeListener(COMPANION_IPC.SNAPSHOT, handler);
    };
  },
  open: () => {
    ipcRenderer.send(COMPANION_IPC.OPEN_MAIN);
  },
  dismissBubble: () => {
    ipcRenderer.send(COMPANION_IPC.DISMISS_BUBBLE);
  },
  setMode: (mode: CompanionMode) => {
    if (typeof mode === 'string') {
      ipcRenderer.send(COMPANION_IPC.SET_MODE, mode);
    }
  },
  hide: () => {
    ipcRenderer.send(COMPANION_IPC.HIDE);
  },
  setInteractive: (interactive: boolean) => {
    ipcRenderer.send(COMPANION_IPC.SET_INTERACTIVE, interactive === true);
  },
  drag: (phase: CompanionDragPhase, dx: number, dy: number) => {
    if (typeof phase === 'string' && Number.isFinite(dx) && Number.isFinite(dy)) {
      ipcRenderer.send(COMPANION_IPC.DRAG, { phase, dx, dy });
    }
  }
};

try {
  contextBridge.exposeInMainWorld('companionBridge', companionBridge);
} catch (err) {
  // If contextBridge is unavailable (e.g. in non-isolated test runner mock environment)
  (window as unknown as Record<string, unknown>).companionBridge = companionBridge;
}

declare global {
  interface Window {
    companionBridge: CompanionBridgeAPI;
  }
}
