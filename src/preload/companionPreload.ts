/**
 * Isolated Electron Preload script for Desktop Companion windows.
 *
 * Exposes ONLY safe presentation bridge APIs (`window.companionBridge`).
 * NO governance, CIMA, filesystem, terminal, or arbitrary IPC access.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { COMPANION_IPC } from '../shared/lapitaya/desktopCompanions/ipc';
import type { CompanionPresentation, CompanionVisualState, CompanionPosition } from '../shared/lapitaya/desktopCompanions/types';

export interface CompanionBridgeAPI {
  onSnapshot: (callback: (snapshot: CompanionPresentation) => void) => () => void;
  onSetState: (callback: (state: CompanionVisualState) => void) => () => void;
  positionChanged: (pos: CompanionPosition) => void;
  open: () => void;
}

const companionBridge: CompanionBridgeAPI = {
  onSnapshot: (callback) => {
    const handler = (_event: unknown, snapshot: CompanionPresentation) => {
      callback(snapshot);
    };
    ipcRenderer.on(COMPANION_IPC.SNAPSHOT, handler);
    return () => {
      ipcRenderer.removeListener(COMPANION_IPC.SNAPSHOT, handler);
    };
  },
  onSetState: (callback) => {
    const handler = (_event: unknown, state: CompanionVisualState) => {
      callback(state);
    };
    ipcRenderer.on(COMPANION_IPC.SET_STATE, handler);
    return () => {
      ipcRenderer.removeListener(COMPANION_IPC.SET_STATE, handler);
    };
  },
  positionChanged: (pos: CompanionPosition) => {
    if (typeof pos?.x === 'number' && typeof pos?.y === 'number') {
      ipcRenderer.send(COMPANION_IPC.POSITION_CHANGED, pos);
    }
  },
  open: () => {
    ipcRenderer.send(COMPANION_IPC.OPEN_MAIN);
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
