/**
 * La Pitaya — Desktop Companions — FASE 2 Test Suite
 *
 * Validates requirements COMP-01 to COMP-50 + Adversarial Security Tests.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

// Mock electron before loading desktopPresence
const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron,
  filename: electron,
  loaded: true,
  exports: {
    BrowserWindow: class MockBrowserWindow {
      constructor(opts) {
        this.opts = opts;
        this._visible = false;
        this._destroyed = false;
        this._x = opts.x ?? 0;
        this._y = opts.y ?? 0;
        this.webContents = {
          send: (channel, data) => {
            this.lastSent = { channel, data };
          }
        };
        this.listeners = {};
      }
      on(event, fn) {
        this.listeners[event] = fn;
      }
      show() {
        this._visible = true;
      }
      hide() {
        this._visible = false;
      }
      isVisible() {
        return this._visible;
      }
      isDestroyed() {
        return this._destroyed;
      }
      loadURL() {
        return Promise.resolve();
      }
      loadFile() {
        return Promise.resolve();
      }
      setPosition(x, y) {
        this._x = x;
        this._y = y;
      }
      getPosition() {
        return [this._x, this._y];
      }
      destroy() {
        this._destroyed = true;
      }
    },
    screen: {
      getPrimaryDisplay() {
        return {
          workArea: { x: 0, y: 0, width: 1920, height: 1080 }
        };
      }
    },
    ipcMain: {
      _handlers: {},
      on(channel, fn) {
        this._handlers[channel] = fn;
      }
    }
  }
};

const { DesktopPresenceService, MAX_VISIBLE_COMPANIONS_DEFAULT } = loadTs('src/main/desktopPresence.ts');
const { getAnimalAvatar, isAllowedCompanionState, ANIMAL_AVATAR_REGISTRY } = loadTs('src/shared/lapitaya/desktopCompanions/animalAvatar.ts');
const { isAllowedCompanionChannel, isGovernanceIpcChannel, COMPANION_IPC } = loadTs('src/shared/lapitaya/desktopCompanions/ipc.ts');

function createMockPersist() {
  const store = new Map();
  return {
    getKv(key) {
      return store.get(key);
    },
    setKv(key, val) {
      store.set(key, val);
    },
    _raw: store
  };
}

test('COMP-01: Creates DesktopPresenceService instance with default options', () => {
  const service = new DesktopPresenceService();
  assert.ok(service);
  assert.strictEqual(service.getMode(), 'OFF');
});

test('COMP-02: getMode() returns initial mode OFF', () => {
  const service = new DesktopPresenceService();
  assert.strictEqual(service.getMode(), 'OFF');
});

test('COMP-03: setMode("MINI") updates mode to MINI', () => {
  const service = new DesktopPresenceService();
  service.setMode('MINI');
  assert.strictEqual(service.getMode(), 'MINI');
});

test('COMP-04: show("MINI") sets mode to MINI and makes window visible', () => {
  const service = new DesktopPresenceService();
  service.show('MINI');
  assert.strictEqual(service.getMode(), 'MINI');
  assert.strictEqual(service.isWindowVisible(), true);
});

test('COMP-05: hide() sets mode to OFF and hides window', () => {
  const service = new DesktopPresenceService();
  service.show('MINI');
  assert.strictEqual(service.isWindowVisible(), true);
  service.hide();
  assert.strictEqual(service.getMode(), 'OFF');
  assert.strictEqual(service.isWindowVisible(), false);
});

test('COMP-06: pause() sets mode to PAUSED and remembers previous mode', () => {
  const service = new DesktopPresenceService();
  service.show('MINI');
  service.pause();
  assert.strictEqual(service.getMode(), 'PAUSED');
});

test('COMP-07: resume() restores previous mode from PAUSED', () => {
  const service = new DesktopPresenceService();
  service.show('MINI');
  service.pause();
  assert.strictEqual(service.getMode(), 'PAUSED');
  service.resume();
  assert.strictEqual(service.getMode(), 'MINI');
});

test('COMP-08: setState("THINKING") updates visual state', () => {
  const service = new DesktopPresenceService();
  service.show('MINI');
  service.setState('THINKING');
  const presentation = service.getPresentation();
  assert.strictEqual(presentation.entries[0].visualState, 'THINKING');
});

test('COMP-09: getPresentation() returns safe presentation projection structure', () => {
  const service = new DesktopPresenceService();
  service.show('MINI');
  const p = service.getPresentation();
  assert.strictEqual(p.mode, 'MINI');
  assert.ok(Array.isArray(p.entries));
  assert.strictEqual(typeof p.updatedAt, 'number');
});

test('COMP-10: CompanionPresentation contains alicia as primary entry with fox species', () => {
  const service = new DesktopPresenceService();
  const p = service.getPresentation();
  const primary = p.entries.find((e) => e.isPrimary);
  assert.ok(primary);
  assert.strictEqual(primary.agentId, 'alicia');
  assert.strictEqual(primary.species, 'fox');
});

test('COMP-11: moveCompanion("alicia", pos) updates position for alicia', () => {
  const service = new DesktopPresenceService();
  service.moveCompanion('alicia', { x: 300, y: 400 });
  const pos = service.getPosition('alicia');
  assert.strictEqual(pos.x, 300);
  assert.strictEqual(pos.y, 400);
});

test('COMP-12: ensureOnScreen() clamps coordinates within work area', () => {
  const service = new DesktopPresenceService();
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const clampedFar = service.ensureOnScreen({ x: 5000, y: 5000 }, display);
  assert.strictEqual(clampedFar.x, 1920 - 340);
  assert.strictEqual(clampedFar.y, 1080 - 340);

  const clampedNeg = service.ensureOnScreen({ x: -100, y: -100 }, display);
  assert.strictEqual(clampedNeg.x, 0);
  assert.strictEqual(clampedNeg.y, 0);
});

test('COMP-13: restorePositions() loads persisted positions or defaults', () => {
  const persist = createMockPersist();
  persist.setKv('desktopCompanion.position.alicia', { x: 250, y: 350 });
  const service = new DesktopPresenceService({ persist });
  const pos = service.getPosition('alicia');
  assert.strictEqual(pos.x, 250);
  assert.strictEqual(pos.y, 350);
});

test('COMP-14: savePosition() persists position to store', () => {
  const persist = createMockPersist();
  const service = new DesktopPresenceService({ persist });
  service.savePosition('alicia', { x: 450, y: 550 });
  assert.deepStrictEqual(persist.getKv('desktopCompanion.position.alicia'), { x: 450, y: 550 });
});

test('COMP-15: isWindowVisible() returns false when mode is OFF', () => {
  const service = new DesktopPresenceService();
  assert.strictEqual(service.isWindowVisible(), false);
});

test('COMP-16: getAnimalAvatar("alicia") returns fox avatar configuration', () => {
  const avatar = getAnimalAvatar('alicia');
  assert.ok(avatar);
  assert.strictEqual(avatar.species, 'fox');
  assert.strictEqual(avatar.defaultColor, '#E65100');
});

test('COMP-17: getAnimalAvatar("el-inge") returns beaver avatar configuration', () => {
  const avatar = getAnimalAvatar('el-inge');
  assert.ok(avatar);
  assert.strictEqual(avatar.species, 'beaver');
});

test('COMP-18: getAnimalAvatar("el-beni") returns cat avatar configuration', () => {
  const avatar = getAnimalAvatar('el-beni');
  assert.ok(avatar);
  assert.strictEqual(avatar.species, 'cat');
});

test('COMP-19: getAnimalAvatar("valentin") returns owl avatar configuration', () => {
  const avatar = getAnimalAvatar('valentin');
  assert.ok(avatar);
  assert.strictEqual(avatar.species, 'owl');
});

test('COMP-20: getAnimalAvatar("margarito") returns hamster avatar configuration', () => {
  const avatar = getAnimalAvatar('margarito');
  assert.ok(avatar);
  assert.strictEqual(avatar.species, 'hamster');
});

test('COMP-21: getAnimalAvatar("jose-juan") returns turtle avatar configuration', () => {
  const avatar = getAnimalAvatar('jose-juan');
  assert.ok(avatar);
  assert.strictEqual(avatar.species, 'turtle');
});

test('COMP-22: getAnimalAvatar("el-tutu") returns rabbit avatar configuration', () => {
  const avatar = getAnimalAvatar('el-tutu');
  assert.ok(avatar);
  assert.strictEqual(avatar.species, 'rabbit');
});

test('COMP-23: isAllowedCompanionState() validates visual state for agent', () => {
  assert.strictEqual(isAllowedCompanionState('alicia', 'THINKING'), true);
  assert.strictEqual(isAllowedCompanionState('alicia', 'CELEBRATING'), true);
});

test('COMP-24: isAllowedCompanionChannel() allows safe companion channels', () => {
  assert.strictEqual(isAllowedCompanionChannel(COMPANION_IPC.SNAPSHOT), true);
  assert.strictEqual(isAllowedCompanionChannel(COMPANION_IPC.SET_STATE), true);
  assert.strictEqual(isAllowedCompanionChannel(COMPANION_IPC.POSITION_CHANGED), true);
  assert.strictEqual(isAllowedCompanionChannel(COMPANION_IPC.OPEN_MAIN), true);
});

test('COMP-25: isGovernanceIpcChannel() detects forbidden CIMA/governance terms', () => {
  assert.strictEqual(isGovernanceIpcChannel('lapitaya:cima:approve'), true);
  assert.strictEqual(isGovernanceIpcChannel('lapitaya:governance:risk'), true);
  assert.strictEqual(isGovernanceIpcChannel('lapitaya:companion:snapshot'), false);
});

// FASE 2 NEW REQUIREMENTS TESTS (COMP-26 TO COMP-50)

test('COMP-26: Transparent companion window configuration', () => {
  const service = new DesktopPresenceService();
  service.show('MINI');
  assert.strictEqual(service.isWindowVisible(), true);
});

test('COMP-27: Idle animation state', () => {
  const service = new DesktopPresenceService();
  service.setState('IDLE');
  const p = service.getPresentation();
  assert.strictEqual(p.entries[0].animationState, 'idle');
});

test('COMP-28: Working animation state', () => {
  const service = new DesktopPresenceService();
  service.setState('WORKING');
  const p = service.getPresentation();
  assert.strictEqual(p.entries[0].animationState, 'work');
});

test('COMP-29: Celebration animation state', () => {
  const service = new DesktopPresenceService();
  service.setState('CELEBRATING');
  const p = service.getPresentation();
  assert.strictEqual(p.entries[0].animationState, 'celebrate');
});

test('COMP-30: Sleep animation state', () => {
  const service = new DesktopPresenceService();
  service.setState('SLEEPING');
  const p = service.getPresentation();
  assert.strictEqual(p.entries[0].animationState, 'sleep');
});

test('COMP-31: Attention animation state', () => {
  const service = new DesktopPresenceService();
  service.setState('ATTENTION');
  const p = service.getPresentation();
  assert.strictEqual(p.entries[0].animationState, 'attention');
});

test('COMP-32: Movement remains within display bounds', () => {
  const service = new DesktopPresenceService();
  const pos = service.ensureOnScreen({ x: 9999, y: 9999 });
  assert.ok(pos.x <= 1920 - 340);
  assert.ok(pos.y <= 1080 - 340);
});

test('COMP-33: Position persists across restarts', () => {
  const persist = createMockPersist();
  const s1 = new DesktopPresenceService({ persist });
  s1.moveCompanion('alicia', { x: 320, y: 420 });

  const s2 = new DesktopPresenceService({ persist });
  assert.deepStrictEqual(s2.getPosition('alicia'), { x: 320, y: 420 });
});

test('COMP-34: setSpeechBubble triggers active speech bubble', () => {
  const service = new DesktopPresenceService();
  service.setSpeechBubble('alicia', 'Hola, Francisco.');
  const p = service.getPresentation();
  assert.ok(p.entries[0].bubble);
  assert.strictEqual(p.entries[0].bubble.text, 'Hola, Francisco.');
});

test('COMP-35: dismissSpeechBubble clears active bubble', () => {
  const service = new DesktopPresenceService();
  service.setSpeechBubble('alicia', 'Mensaje temporal.');
  service.dismissSpeechBubble('alicia');
  const p = service.getPresentation();
  assert.strictEqual(p.entries[0].bubble, null);
});

test('COMP-36: Runtime BUILD_STARTED event changes visual state & active phase agent', () => {
  const service = new DesktopPresenceService();
  service.triggerVerifiedRuntimeFact('BUILD_STARTED');
  const p = service.getPresentation();
  assert.strictEqual(p.activePhaseAgent, 'el-beni');
  assert.strictEqual(p.entries[0].visualState, 'WORKING');
});

test('COMP-37: Runtime TEST_STARTED event changes visual state', () => {
  const service = new DesktopPresenceService();
  service.triggerVerifiedRuntimeFact('TEST_STARTED');
  const p = service.getPresentation();
  assert.strictEqual(p.activePhaseAgent, 'margarito');
  assert.strictEqual(p.entries[0].visualState, 'WORKING');
});

test('COMP-38: Runtime AUDIT_STARTED event changes visual state', () => {
  const service = new DesktopPresenceService();
  service.triggerVerifiedRuntimeFact('AUDIT_STARTED');
  const p = service.getPresentation();
  assert.strictEqual(p.activePhaseAgent, 'jose-juan');
  assert.strictEqual(p.entries[0].visualState, 'WORKING');
});

test('COMP-39: REQUEST_PENDING produces attention state', () => {
  const service = new DesktopPresenceService();
  service.triggerVerifiedRuntimeFact('REQUEST_PENDING');
  const p = service.getPresentation();
  assert.strictEqual(p.entries[0].visualState, 'ATTENTION');
});

test('COMP-40: HUMAN_APPROVAL_REQUIRED produces attention state', () => {
  const service = new DesktopPresenceService();
  service.triggerVerifiedRuntimeFact('HUMAN_APPROVAL_REQUIRED');
  const p = service.getPresentation();
  assert.strictEqual(p.entries[0].visualState, 'ATTENTION');
});

test('COMP-41: Unknown runtime event does NOT invent fake state', () => {
  const service = new DesktopPresenceService();
  const initialState = service.getPresentation().entries[0].visualState;
  service.triggerVerifiedRuntimeFact('UNVERIFIED_FAKE_EVENT');
  const finalState = service.getPresentation().entries[0].visualState;
  assert.strictEqual(initialState, finalState);
});

test('COMP-42: Companion renderer cannot approve tasks', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:approveTask'), false);
});

test('COMP-43: Companion renderer cannot execute tools', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:executeTool'), false);
});

test('COMP-44: Companion renderer cannot modify risk classification', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:modifyRisk'), false);
});

test('COMP-45: Companion renderer cannot access CIMA ledger', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:readLedger'), false);
});

test('COMP-46: Companion renderer cannot access HMAC signatures', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:accessHmac'), false);
});

test('COMP-47: Reduced motion preference support', () => {
  const service = new DesktopPresenceService();
  service.setPreferences({ reducedMotion: true });
  assert.strictEqual(service.getPreferences().reducedMotion, true);
});

test('COMP-48: Sound disabled preference support', () => {
  const service = new DesktopPresenceService();
  assert.strictEqual(service.getPreferences().soundEnabled, false);
});

test('COMP-49: Offline visual state support', () => {
  const service = new DesktopPresenceService();
  service.setState('OFFLINE');
  const p = service.getPresentation();
  assert.strictEqual(p.entries[0].visualState, 'OFFLINE');
  assert.strictEqual(p.entries[0].animationState, 'offline');
});

test('COMP-50: Multiple companion limit in company mode', () => {
  const service = new DesktopPresenceService();
  service.setMode('COMPANY');
  const p = service.getPresentation();
  assert.ok(p.entries.length <= MAX_VISIBLE_COMPANIONS_DEFAULT);
});

// ADVERSARIAL SECURITY TESTS

test('ADV-01: Reject invalid agent ID in moveCompanion', () => {
  const service = new DesktopPresenceService();
  assert.throws(() => {
    service.moveCompanion('unknown-hacker-agent', { x: 10, y: 10 });
  }, /Invalid agent ID/);
});

test('ADV-02: Reject channel containing "approve" in IPC validator', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:approveTask'), false);
});

test('ADV-03: Reject channel containing "risk" in IPC validator', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:riskScore'), false);
});

test('ADV-04: Reject channel containing "autonomy" in IPC validator', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:autonomyLevel'), false);
});

test('ADV-05: Reject channel containing "capability" in IPC validator', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:grantCapability'), false);
});

test('ADV-06: Reject channel containing "ledger" in IPC validator', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:readLedger'), false);
});

test('ADV-07: Reject channel containing "cima" in IPC validator', () => {
  assert.strictEqual(isAllowedCompanionChannel('lapitaya:companion:cimaBypass'), false);
});

test('ADV-08: Verify getPresentation() output contains zero governance data fields', () => {
  const service = new DesktopPresenceService();
  service.show('MINI');
  const p = service.getPresentation();

  assert.strictEqual(p.ledger, undefined);
  assert.strictEqual(p.tokens, undefined);
  assert.strictEqual(p.hmac, undefined);
  assert.strictEqual(p.approvals, undefined);
  assert.strictEqual(p.risk, undefined);
  assert.strictEqual(p.autonomy, undefined);
});
