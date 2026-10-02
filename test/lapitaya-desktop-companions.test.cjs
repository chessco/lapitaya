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

// ─── FASE 2 REMEDIATION (acceptance gate FAIL → regression tests) ───────────

const electronMock = require.cache[electron].exports;
const { fromRuntimeEvent } = loadTs('src/shared/lapitaya/alicia/events.ts');
const { companionFactsFromAliciaEvent, phaseOwner } = loadTs('src/shared/lapitaya/desktopCompanions/runtimeFacts.ts');
const { isCompanionMode } = loadTs('src/shared/lapitaya/desktopCompanions/types.ts');
const { agentDisplayName } = loadTs('src/shared/lapitaya/agents.ts');
const companionDocument = loadTs('src/renderer/src/companions/companionDocument.ts');
const { CONVERSATION_LINES, GREETING_LINE, companionAgentFromSearch } = loadTs('src/renderer/src/companions/companionConversation.ts');
const { CompanionCreature, ROLE_ATTR } = loadTs('src/renderer/src/companions/CompanionCreature.tsx');
const { renderToStaticMarkup } = require('react-dom/server');
const fs = require('node:fs');
const path = require('node:path');

/** Manual timers: nothing fires until advance(). */
function createFakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; pending.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && pending.has(id)) { pending.delete(id); t.fn(); }
      }
    }
  };
}

/** Service whose windows are captured, with fake timers. */
function createHarness(extra = {}) {
  const created = [];
  const timers = createFakeTimers();
  const factory = (opts) => {
    const w = new electronMock.BrowserWindow(opts);
    w.loadArgs = null;
    w.loadFile = (p, o) => { w.loadArgs = o; return Promise.resolve(); };
    created.push(w);
    return w;
  };
  const service = new DesktopPresenceService({ browserWindowFactory: factory, timers, ...extra });
  const windowOf = (agentId) => created.filter((w) => w.loadArgs?.query?.agent === agentId).pop();
  return { service, created, timers, windowOf };
}

const entryOf = (p, id) => p.entries.find((e) => e.agentId === id);

/** Walk a React element tree (no DOM needed). */
function findAll(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) findAll(n, pred, out); return out; }
  if (node.props) {
    if (pred(node)) out.push(node);
    findAll(node.props.children, pred, out);
  }
  return out;
}
const byRole = (tree, role) => findAll(tree, (n) => n.props && n.props[ROLE_ATTR] === role);

function creatureProps(over = {}) {
  const calls = [];
  const h = (name) => (e) => calls.push({ name, e });
  return {
    calls,
    props: {
      entry: {
        agentId: 'alicia', displayName: 'Alicia', species: 'fox', visualState: 'IDLE', mood: 'CURIOUS',
        animationState: 'idle', statusText: 'Alicia (IDLE)', isPrimary: true, position: { x: 0, y: 0 }, bubble: null, relayedFrom: null
      },
      displayName: 'Alicia', relayedName: null, relayedSpecies: null, bubble: null,
      showMenu: false, showGallery: false, isSleeping: false, walkOffset: 0, galleryEntries: [],
      onAvatarClick: h('avatar'), onSpeak: h('speak'), onOpenApp: h('open'), onToggleGallery: h('gallery'),
      onHide: h('hide'), onDismissBubble: h('dismiss'),
      ...over
    }
  };
}

test('COMP-51: Companion renderer root is transparent (scoped to ?companion=1)', () => {
  const classes = new Set();
  const appended = [];
  let splashRemoved = false;
  const doc = {
    documentElement: { classList: { add: (c) => classes.add(c) } },
    head: { appendChild: (n) => appended.push(n) },
    getElementById: (id) => (id === 'cth-splash' ? { remove: () => { splashRemoved = true; } } : appended.find((n) => n.id === id) ?? null),
    createElement: () => ({ id: '', textContent: null })
  };
  companionDocument.applyCompanionDocument(doc);
  companionDocument.applyCompanionDocument(doc); // idempotent
  assert.ok(classes.has(companionDocument.COMPANION_DOCUMENT_CLASS));
  assert.strictEqual(appended.length, 1);
  const css = appended[0].textContent;
  for (const sel of ['html.lp-companion,', 'html.lp-companion body,', 'html.lp-companion #root']) assert.ok(css.includes(sel), sel);
  assert.match(css, /background: transparent !important/);
  assert.match(css, /background-image: none !important/);
  assert.ok(splashRemoved);
  // Scoped: only companion locations opt in; the main app is untouched.
  assert.strictEqual(companionDocument.isCompanionLocation({ search: '?companion=1&agent=alicia', hash: '' }), true);
  assert.strictEqual(companionDocument.isCompanionLocation({ search: '', hash: '' }), false);
  const mainTsx = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/main.tsx'), 'utf8');
  assert.match(mainTsx, /if \(isCompanion\) \{[\s\S]*applyCompanionDocument\(document\)/);
  const globalCss = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/design/global.css'), 'utf8');
  assert.match(globalCss, /background: var\(--cth-cream-100\)/, 'main app background unchanged');
  // The window itself is transparent and frameless.
  const { service, windowOf } = createHarness();
  service.show('MINI');
  const opts = windowOf('alicia').opts;
  assert.strictEqual(opts.transparent, true);
  assert.strictEqual(opts.frame, false);
  assert.strictEqual(opts.backgroundColor, '#00000000');
});

test('COMP-52: Avatar click reaches its DOM handler (avatar is no-drag)', () => {
  const { props, calls } = creatureProps();
  const tree = CompanionCreature(props);
  const [avatar] = byRole(tree, 'avatar');
  assert.ok(avatar, 'avatar rendered');
  assert.strictEqual(avatar.props.style.WebkitAppRegion, 'no-drag');
  assert.strictEqual(typeof avatar.props.onClick, 'function');
  avatar.props.onClick({ stopPropagation() {} });
  assert.deepStrictEqual(calls.map((c) => c.name), ['avatar']);
  // The avatar's ancestors are not drag regions either.
  const [creature] = byRole(tree, 'creature');
  assert.strictEqual(creature.props.style.WebkitAppRegion, 'no-drag');
  // Menu actions are wired when the menu is open.
  const open = CompanionCreature(creatureProps({ showMenu: true }).props);
  for (const role of ['menu-speak', 'menu-open', 'menu-gallery', 'menu-hide']) {
    assert.strictEqual(typeof byRole(open, role)[0]?.props.onClick, 'function', role);
  }
});

test('COMP-53: Drag handle moves the window (pointer drag), persisted & clamped; avatar stays clickable', () => {
  const tree = CompanionCreature(creatureProps({ onHandlePointerDown() {}, onHandlePointerMove() {}, onHandlePointerUp() {} }).props);
  // No native drag region anywhere: it would swallow clicks and break click-through.
  assert.strictEqual(findAll(tree, (n) => n.props?.style?.WebkitAppRegion === 'drag').length, 0);
  const [handle] = byRole(tree, 'drag-handle');
  assert.strictEqual(typeof handle.props.onPointerDown, 'function');
  assert.strictEqual(typeof handle.props.onPointerMove, 'function');
  assert.strictEqual(handle.props.onPointerUp, handle.props.onLostPointerCapture);
  assert.strictEqual(handle.props.onClick, undefined);
  assert.strictEqual(handle.props.style.animation, undefined, 'handle never animates');
  assert.strictEqual(handle.props.style.transform, undefined, 'handle never transforms');
  assert.strictEqual(byRole(byRole(tree, 'creature')[0], 'drag-handle').length, 0, 'handle is not inside the avatar group');

  const persist = createMockPersist();
  const { service, windowOf } = createHarness({ persist });
  service.show('MINI');
  const win = windowOf('alicia');
  const drag = electronMock.ipcMain._handlers['lapitaya:companion:drag'];
  const ev = { sender: win.webContents };
  drag(ev, { phase: 'start', dx: 0, dy: 0 });
  drag(ev, { phase: 'move', dx: 300, dy: 50 });
  assert.deepStrictEqual(win.getPosition(), [400, 150]);
  drag(ev, { phase: 'move', dx: 600, dy: 200 });
  drag(ev, { phase: 'end', dx: 0, dy: 0 });
  assert.deepStrictEqual(persist.getKv('desktopCompanion.position.alicia'), { x: 700, y: 300 });
  // Dragged past the edge → clamped back into the work area on release.
  drag(ev, { phase: 'start', dx: 0, dy: 0 });
  drag(ev, { phase: 'move', dx: 5000, dy: 5000 });
  drag(ev, { phase: 'end', dx: 0, dy: 0 });
  assert.deepStrictEqual(win.getPosition(), [1920 - 340, 1080 - 340]);
  assert.deepStrictEqual(persist.getKv('desktopCompanion.position.alicia'), { x: 1920 - 340, y: 1080 - 340 });
  // Junk and foreign senders are ignored.
  drag(ev, { phase: 'move', dx: 10, dy: 10 }); // no drag in progress
  drag(ev, { phase: 'start' });
  drag(ev, { phase: 'move', dx: NaN, dy: 1 });
  drag(ev, { phase: 'move', dx: 1e9, dy: 1 });
  drag({ sender: { id: 'main-window' } }, { phase: 'move', dx: -500, dy: -500 });
  assert.deepStrictEqual(win.getPosition(), [1920 - 340, 1080 - 340]);
  drag(ev, { phase: 'end' });
  // The OS `moved` event (e.g. Windows snap) is also persisted & clamped.
  win._x = 700; win._y = 300;
  win.listeners.moved();
  assert.deepStrictEqual(persist.getKv('desktopCompanion.position.alicia'), { x: 700, y: 300 });
});

test('COMP-54: BUILD_STARTED targets El Beni (not entries[0])', () => {
  const { service } = createHarness();
  service.setMode('COMPANY');
  service.triggerVerifiedRuntimeFact('BUILD_STARTED');
  assert.strictEqual(phaseOwner('BUILD'), 'el-beni');
  assert.strictEqual(service.getAgentState('el-beni'), 'WORKING');
  assert.strictEqual(service.getAgentState('alicia'), 'IDLE');
  const p = service.getPresentation();
  assert.strictEqual(entryOf(p, 'el-beni').visualState, 'WORKING');
  assert.strictEqual(entryOf(p, 'el-beni').bubble.sourceFact, 'BUILD_STARTED');
  assert.strictEqual(entryOf(p, 'alicia').visualState, 'IDLE', 'El Beni is on screen: Alicia relays nothing');
  // BUILD_COMPLETED → Alicia celebrates, El Beni is released.
  service.triggerVerifiedRuntimeFact('BUILD_COMPLETED');
  assert.strictEqual(service.getAgentState('alicia'), 'CELEBRATING');
  assert.strictEqual(service.getAgentState('el-beni'), 'IDLE');
});

test('COMP-55: TEST_STARTED / TEST_COMPLETED target Margarito', () => {
  const { service } = createHarness();
  service.triggerVerifiedRuntimeFact('TEST_STARTED');
  assert.strictEqual(service.getAgentState('margarito'), 'WORKING');
  assert.strictEqual(service.getAgentState('alicia'), 'IDLE');
  service.triggerVerifiedRuntimeFact('TEST_COMPLETED');
  assert.strictEqual(service.getAgentState('margarito'), 'CELEBRATING');
  assert.strictEqual(service.getPresentation().activePhaseAgent, 'margarito');
});

test('COMP-56: AUDIT_STARTED / AUDIT_COMPLETED target José Juan', () => {
  const { service } = createHarness();
  service.triggerVerifiedRuntimeFact('AUDIT_STARTED');
  assert.strictEqual(service.getAgentState('jose-juan'), 'WORKING');
  service.triggerVerifiedRuntimeFact('AUDIT_COMPLETED');
  assert.strictEqual(service.getAgentState('jose-juan'), 'CELEBRATING');
  assert.strictEqual(service.getAgentState('alicia'), 'IDLE');
});

test('COMP-57: REQUEST_PENDING / HUMAN_APPROVAL_REQUIRED target Alicia until resolved', () => {
  const { service, timers } = createHarness();
  service.triggerVerifiedRuntimeFact('REQUEST_PENDING', { ref: 'prop-1' });
  service.triggerVerifiedRuntimeFact('HUMAN_APPROVAL_REQUIRED', { ref: 'apr-1' });
  assert.strictEqual(service.getAgentState('alicia'), 'ATTENTION');
  // A non-human fact for Alicia does not bury a pending request.
  service.triggerVerifiedRuntimeFact('BUILD_COMPLETED');
  assert.strictEqual(service.getAgentState('alicia'), 'ATTENTION');
  timers.advance(60000);
  assert.strictEqual(service.getAgentState('alicia'), 'ATTENTION');
  assert.ok(service.getPresentation().entries[0].bubble, 'sticky bubble stays reachable');
  service.triggerVerifiedRuntimeFact('APPROVAL_RESOLVED', { ref: 'apr-1' });
  assert.strictEqual(service.getAgentState('alicia'), 'ATTENTION', 'one request still pending');
  service.triggerVerifiedRuntimeFact('REQUEST_RESOLVED', { ref: 'prop-1' });
  assert.strictEqual(service.getAgentState('alicia'), 'IDLE');
  assert.strictEqual(service.getPresentation().entries[0].bubble, null);
});

test('COMP-58: Multiple companion states coexist', () => {
  const { service } = createHarness();
  service.triggerVerifiedRuntimeFact('BUILD_STARTED');
  service.triggerVerifiedRuntimeFact('HUMAN_APPROVAL_REQUIRED', { ref: 'apr-9' });
  assert.strictEqual(service.getAgentState('alicia'), 'ATTENTION');
  assert.strictEqual(service.getAgentState('el-beni'), 'WORKING');
  assert.strictEqual(service.getAgentState('margarito'), 'IDLE');
  assert.strictEqual(service.getAgentState('jose-juan'), 'IDLE');
  service.setMode('COMPANY');
  const p = service.getPresentation();
  assert.strictEqual(entryOf(p, 'alicia').visualState, 'ATTENTION');
  assert.strictEqual(entryOf(p, 'el-beni').visualState, 'WORKING');
});

test('COMP-59: COMPANY renders up to 3 separate companions, each in its own window', () => {
  const { service, created, windowOf } = createHarness();
  service.triggerVerifiedRuntimeFact('TEST_STARTED');
  service.setMode('COMPANY');
  const ids = service.getPresentation().entries.map((e) => e.agentId);
  assert.strictEqual(ids.length, 3);
  assert.strictEqual(new Set(ids).size, 3);
  assert.strictEqual(ids[0], 'alicia');
  assert.ok(ids.includes('margarito'), 'the recently active companion takes a seat');
  for (const id of ids) {
    const w = windowOf(id);
    assert.ok(w, `window for ${id}`);
    assert.strictEqual(w.isVisible(), true);
  }
  assert.strictEqual(created.length, 3);
  // Independent positions.
  const positions = ids.map((id) => JSON.stringify(entryOf(service.getPresentation(), id).position));
  assert.strictEqual(new Set(positions).size, 3);
  // Never more than MAX_VISIBLE_COMPANIONS, even if preferences ask for more.
  service.setPreferences({ maxVisibleCompanions: 7 });
  assert.strictEqual(service.getPresentation().entries.length, MAX_VISIBLE_COMPANIONS_DEFAULT);
  // The creature renders the entry it is given (one per window).
  const html = renderToStaticMarkup(CompanionCreature(creatureProps({
    entry: { ...entryOf(service.getPresentation(), 'margarito') }, displayName: 'Margarito'
  }).props));
  assert.match(html, /🐹/);
  assert.match(html, /Margarito/);
});

test('COMP-60: FOCUS selects the phase companion and keeps its real state', () => {
  const { service, windowOf } = createHarness();
  service.setMode('FOCUS');
  service.triggerVerifiedRuntimeFact('BUILD_STARTED');
  let p = service.getPresentation();
  assert.deepStrictEqual(p.entries.map((e) => e.agentId), ['el-beni']);
  assert.strictEqual(p.entries[0].visualState, 'WORKING');
  assert.strictEqual(windowOf('el-beni').isVisible(), true);
  service.triggerVerifiedRuntimeFact('TEST_STARTED');
  p = service.getPresentation();
  assert.deepStrictEqual(p.entries.map((e) => e.agentId), ['margarito']);
  assert.strictEqual(p.entries[0].visualState, 'WORKING');
  assert.strictEqual(windowOf('el-beni').isVisible(), false);
  service.triggerVerifiedRuntimeFact('AUDIT_STARTED');
  assert.deepStrictEqual(service.getPresentation().entries.map((e) => e.agentId), ['jose-juan']);
  // A pending human request is the most relevant thing: FOCUS shows Alicia.
  service.triggerVerifiedRuntimeFact('HUMAN_APPROVAL_REQUIRED', { ref: 'apr-f' });
  p = service.getPresentation();
  assert.deepStrictEqual(p.entries.map((e) => e.agentId), ['alicia']);
  assert.strictEqual(p.entries[0].visualState, 'ATTENTION');
});

test('COMP-61: Invalid mode is rejected with no state mutation', () => {
  const { service } = createHarness();
  service.show('MINI');
  assert.strictEqual(service.setMode('NOT_A_MODE'), false);
  assert.strictEqual(service.setMode(''), false);
  assert.strictEqual(service.setMode(42), false);
  assert.strictEqual(service.getMode(), 'MINI');
  assert.strictEqual(service.getPreferences().mode, 'MINI');
  assert.strictEqual(isCompanionMode('COMPANY'), true);
  assert.strictEqual(isCompanionMode('company'), false);
  // Over IPC, from the companion's own window.
  const { service: s2, windowOf } = createHarness();
  s2.show('MINI');
  electronMock.ipcMain._handlers['lapitaya:companion:setMode']({ sender: windowOf('alicia').webContents }, 'ROOT');
  assert.strictEqual(s2.getMode(), 'MINI');
  electronMock.ipcMain._handlers['lapitaya:companion:setMode']({ sender: windowOf('alicia').webContents }, 'COMPANY');
  assert.strictEqual(s2.getMode(), 'COMPANY');
});

test('COMP-62: Bubble auto-dismiss works (but not for a pending human request)', () => {
  const { service, timers } = createHarness();
  service.setMode('COMPANY');
  service.triggerVerifiedRuntimeFact('BUILD_STARTED');
  const b = entryOf(service.getPresentation(), 'el-beni').bubble;
  assert.strictEqual(b.autoDismissMs, 6000);
  timers.advance(5999);
  assert.ok(entryOf(service.getPresentation(), 'el-beni').bubble);
  timers.advance(1);
  assert.strictEqual(entryOf(service.getPresentation(), 'el-beni').bubble, null);
  // CELEBRATING returns to rest.
  service.triggerVerifiedRuntimeFact('TEST_COMPLETED');
  timers.advance(8000);
  assert.strictEqual(service.getAgentState('margarito'), 'IDLE');
  // Sticky approval bubble survives.
  service.triggerVerifiedRuntimeFact('HUMAN_APPROVAL_REQUIRED', { ref: 'apr-x' });
  timers.advance(600000);
  const sticky = entryOf(service.getPresentation(), 'alicia').bubble;
  assert.ok(sticky);
  assert.strictEqual(sticky.autoDismissMs, undefined);
});

test('COMP-63: Hide/show presentation state works without restarting', () => {
  const { service, windowOf } = createHarness();
  service.show('COMPANY');
  service.hide();
  assert.strictEqual(service.getMode(), 'OFF');
  assert.strictEqual(service.isWindowVisible(), false);
  const menu = service.trayMenuTemplate();
  const showItem = menu.find((i) => i.label === 'Mostrar compañeros');
  assert.strictEqual(showItem.enabled, true);
  showItem.click();
  assert.strictEqual(service.getMode(), 'COMPANY', 'restored in the mode it was hidden from');
  assert.strictEqual(windowOf('alicia').isVisible(), true);
  // Hide over IPC from the companion window, then the tray restores again.
  electronMock.ipcMain._handlers['lapitaya:companion:hide']({ sender: windowOf('alicia').webContents });
  assert.strictEqual(service.getMode(), 'OFF');
  assert.strictEqual(service.restore(), true);
  assert.strictEqual(service.isWindowVisible('alicia'), true);
  // Tray mode radios are presentation only.
  service.trayMenuTemplate().find((i) => i.label === 'Modo Enfoque').click();
  assert.strictEqual(service.getMode(), 'FOCUS');
});

test('COMP-64: Companion identity renders the agent name (species is secondary)', () => {
  const { service } = createHarness();
  const entry = service.getPresentation().entries[0];
  assert.strictEqual(entry.displayName, 'Alicia');
  assert.strictEqual(agentDisplayName('jose-juan', 'es-MX'), 'José Juan');
  assert.strictEqual(agentDisplayName('jose-juan', 'en-US'), 'Jose Juan');
  const tree = CompanionCreature(creatureProps({ entry, displayName: 'Alicia' }).props);
  const [name] = byRole(tree, 'identity-name');
  assert.strictEqual(name.props.children, 'Alicia');
  const html = renderToStaticMarkup(tree);
  assert.match(html, />Alicia</);
  assert.doesNotMatch(html, />FOX</);
});

test('COMP-65: Multi-monitor — clamps to the display the companion is on, not the primary', () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1032 } },
    { workArea: { x: -1920, y: 0, width: 1920, height: 1032 } },
    { workArea: { x: -3840, y: 0, width: 1280, height: 672 } }
  ];
  const overlap = (r, a) => Math.max(0, Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x)) *
    Math.max(0, Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y));
  const screenModule = {
    getPrimaryDisplay: () => displays[0],
    getDisplayMatching: (r) => displays.slice().sort((a, b) => overlap(r, b.workArea) - overlap(r, a.workArea))[0]
  };
  const persist = createMockPersist();
  const { service, windowOf } = createHarness({ persist, screenModule });
  // On the left monitor: stays there.
  assert.deepStrictEqual(service.ensureOnScreen({ x: -1500, y: 200 }), { x: -1500, y: 200 });
  // Hanging off the bottom of the small tertiary monitor: clamped into ITS work area.
  assert.deepStrictEqual(service.ensureOnScreen({ x: -3700, y: 600 }), { x: -3700, y: 672 - 340 });
  service.show('MINI');
  const win = windowOf('alicia');
  win._x = -1700; win._y = 900;
  win.listeners.moved();
  assert.deepStrictEqual(persist.getKv('desktopCompanion.position.alicia'), { x: -1700, y: 1032 - 340 });
});

test('COMP-66: Restart restores the position on its own display', () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1032 } },
    { workArea: { x: -1920, y: 0, width: 1920, height: 1032 } }
  ];
  const screenModule = {
    getPrimaryDisplay: () => displays[0],
    getDisplayMatching: (r) => (r.x < 0 ? displays[1] : displays[0])
  };
  const persist = createMockPersist();
  persist.setKv('desktopCompanion.position.alicia', { x: -1200, y: 300 });
  const { service, windowOf } = createHarness({ persist, screenModule });
  service.show('MINI');
  const opts = windowOf('alicia').opts;
  assert.strictEqual(opts.x, -1200, 'not forced onto the primary display');
  assert.strictEqual(opts.y, 300);
});

test('COMP-67: Real runtime payloads (CimaRuntimeService.onEvent → fromRuntimeEvent) drive the companions', () => {
  const { service } = createHarness();
  const assign = (phase, to) => ({ type: 'cima-record', data: { kind: 'cima-assignment', taskId: 'T-1', phase, from: 'el-inge', to, messageId: `m-${phase}`, ts: 1 } });
  const record = (phase, verdict, agentId) => ({
    type: 'cima-record',
    data: { kind: 'cima', taskId: 'T-1', phase, verdict, claimed: verdict, agentId, messageId: `r-${phase}`, ts: 2, violations: [], reasons: [], evidence: [] }
  });
  const feed = (e) => service.observeAliciaEvents(fromRuntimeEvent(e, 10));

  feed(assign('BUILD', 'agent-beni'));
  assert.strictEqual(service.getAgentState('el-beni'), 'WORKING');
  feed(record('BUILD', 'PASS', 'agent-beni'));
  assert.strictEqual(service.getAgentState('alicia'), 'CELEBRATING');
  assert.strictEqual(service.getAgentState('el-beni'), 'IDLE');
  feed(assign('TEST', 'agent-marga'));
  assert.strictEqual(service.getAgentState('margarito'), 'WORKING');
  feed(record('TEST', 'FAIL', 'agent-marga'));
  assert.strictEqual(service.getAgentState('margarito'), 'CONCERNED', 'a failing verdict is never celebrated');
  feed(assign('AUDIT', 'agent-jj'));
  assert.strictEqual(service.getAgentState('jose-juan'), 'WORKING');
  feed(record('AUDIT', 'PASS', 'agent-jj'));
  assert.strictEqual(service.getAgentState('jose-juan'), 'CELEBRATING');

  feed({ type: 'approval-request', data: { id: 'apr-77', agentId: 'agent-beni', summary: 'git push', risk: 'HIGH', status: 'pending' } });
  assert.strictEqual(service.getAgentState('alicia'), 'ATTENTION');
  feed({ type: 'approval-decided', data: { id: 'apr-77', agentId: 'agent-beni', status: 'approved', decidedAt: 20 } });
  assert.strictEqual(service.getAgentState('alicia'), 'IDLE');

  feed({ type: 'request', data: { kind: 'request', proposalId: 'p-5', transition: 'PROPOSED', message: 'x' } });
  assert.strictEqual(service.getAgentState('alicia'), 'ATTENTION');
  feed({ type: 'request', data: { kind: 'request', proposalId: 'p-5', transition: 'CONFIRMED' } });
  assert.strictEqual(service.getAgentState('alicia'), 'IDLE');

  // The adapter is read-only and silent on what it does not know.
  const ev = Object.freeze({ type: 'cima.phase.assigned', ts: 1, source: 'cima-runtime', phase: 'BUILD', ref: 'm' });
  assert.deepStrictEqual(companionFactsFromAliciaEvent(ev), [{ fact: 'BUILD_STARTED', ref: 'm' }]);
  assert.deepStrictEqual(companionFactsFromAliciaEvent({ type: 'task.created', ts: 1, source: 'hive' }), []);
  assert.deepStrictEqual(companionFactsFromAliciaEvent({ type: 'cima.phase.assigned', ts: 1, source: 'cima-runtime', phase: 'LEARN' }), []);
  // The main process actually wires it.
  const indexTs = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8');
  assert.match(indexTs, /desktopPresence\.observeAliciaEvents\(aliciaEvents\)/);
});

test('ADV-09: Companion cannot reach governance IPC (preload surface + window isolation)', () => {
  const sent = [];
  let exposed = null;
  electronMock.contextBridge = { exposeInMainWorld: (key, api) => { exposed = { key, api }; } };
  electronMock.ipcRenderer = {
    send: (ch) => sent.push(ch),
    invoke: () => { throw new Error('invoke must not be reachable'); },
    on: (ch) => sent.push(`on:${ch}`),
    removeListener: () => {}
  };
  loadTs('src/preload/companionPreload.ts');
  assert.strictEqual(exposed.key, 'companionBridge');
  assert.deepStrictEqual(Object.keys(exposed.api).sort(), ['dismissBubble', 'drag', 'hide', 'onSnapshot', 'open', 'setInteractive', 'setMode']);
  exposed.api.onSnapshot(() => {});
  exposed.api.open();
  exposed.api.dismissBubble();
  exposed.api.setMode('MINI');
  exposed.api.hide();
  exposed.api.setInteractive(true);
  exposed.api.drag('move', 1, 2);
  assert.ok(sent.length >= 7);
  for (const entry of sent) {
    const ch = entry.replace(/^on:/, '');
    assert.strictEqual(isAllowedCompanionChannel(ch), true, ch);
    assert.strictEqual(isGovernanceIpcChannel(ch), false, ch);
  }
  // No generic passthrough: no method takes a channel name.
  for (const fn of Object.values(exposed.api)) assert.ok(fn.length <= 3);
  // The companion window: sandboxed, isolated, own preload (never the main preload that carries window.api).
  const { service, windowOf } = createHarness({ preloadPath: '/out/preload/companionPreload.js' });
  service.show('MINI');
  const wp = windowOf('alicia').opts.webPreferences;
  assert.strictEqual(wp.sandbox, true);
  assert.strictEqual(wp.contextIsolation, true);
  assert.strictEqual(wp.nodeIntegration, false);
  assert.match(wp.preload, /companionPreload\.js$/);
  // The service registers no wildcard / dead channels.
  for (const ch of Object.keys(electronMock.ipcMain._handlers)) assert.doesNotMatch(ch, /\*/);
});

test('ADV-10: Companion cannot forge runtime facts over IPC', () => {
  const { service, windowOf } = createHarness();
  service.show('MINI');
  const sender = windowOf('alicia').webContents;
  const forged = ['BUILD_COMPLETED', { fact: 'HUMAN_APPROVAL_REQUIRED' }, 'APPROVAL_RESOLVED', 'COMPANY'];
  for (const [ch, fn] of Object.entries(electronMock.ipcMain._handlers)) {
    if (ch === 'lapitaya:companion:hide' || ch === 'lapitaya:companion:setMode') continue;
    for (const payload of forged) fn({ sender }, payload);
  }
  for (const id of ['alicia', 'el-beni', 'margarito', 'jose-juan']) assert.strictEqual(service.getAgentState(id), 'IDLE', id);
  const p = service.getPresentation();
  assert.ok(p.entries.every((e) => !e.bubble || e.bubble.kind !== 'runtime-fact'));
  // A foreign sender (e.g. the main window) cannot drive companion channels at all.
  electronMock.ipcMain._handlers['lapitaya:companion:setMode']({ sender: { id: 'main-window' } }, 'COMPANY');
  electronMock.ipcMain._handlers['lapitaya:companion:hide']({ sender: { id: 'main-window' } });
  assert.strictEqual(service.getMode(), 'MINI');
  // Unknown facts are rejected even in the main process.
  assert.strictEqual(service.triggerVerifiedRuntimeFact('TOTALLY_REAL_FACT'), false);
  // No IPC channel exists that sets text, state or facts.
  assert.strictEqual(COMPANION_IPC.TRIGGER_BUBBLE, undefined);
});

test('ADV-11: Unverified presentation message cannot masquerade as a verified runtime fact', () => {
  const { service } = createHarness();
  service.setSpeechBubble('alicia', 'El build terminó con éxito.');
  const b = service.getPresentation().entries[0].bubble;
  assert.strictEqual(b.kind, 'conversation');
  assert.strictEqual(b.sourceFact, undefined);
  service.triggerVerifiedRuntimeFact('BUILD_COMPLETED');
  const f = service.getPresentation().entries[0].bubble;
  assert.strictEqual(f.kind, 'runtime-fact');
  assert.strictEqual(f.sourceFact, 'BUILD_COMPLETED');
  // Only runtime-fact bubbles carry the "verified" mark.
  const conv = renderToStaticMarkup(CompanionCreature(creatureProps({ bubble: b }).props));
  const fact = renderToStaticMarkup(CompanionCreature(creatureProps({ bubble: f }).props));
  assert.doesNotMatch(conv, /hecho verificado/);
  assert.match(fact, /hecho verificado/);
  // Conversation lines never claim runtime state.
  const runtimeTerms = /build|prueba|test|auditor|aprob|agente|El Inge|Margarito|El Beni|José Juan|tarea|ejecut|tranquilo|atentos/i;
  for (const line of [...CONVERSATION_LINES, GREETING_LINE]) assert.doesNotMatch(line, runtimeTerms, line);
  assert.strictEqual(companionAgentFromSearch('?companion=1&agent=margarito'), 'margarito');
  assert.strictEqual(companionAgentFromSearch('?companion=1&agent=__proto__'), 'alicia');
});

test('COMP-68: A renderer that subscribes after load still receives its snapshot', () => {
  const { service, windowOf } = createHarness();
  service.show('MINI');
  const win = windowOf('alicia');
  win.lastSent = null;
  electronMock.ipcMain._handlers['lapitaya:companion:requestSnapshot']({ sender: win.webContents });
  assert.strictEqual(win.lastSent.channel, 'lapitaya:companion:snapshot');
  assert.strictEqual(win.lastSent.data.entries[0].agentId, 'alicia');
  // Nobody else can pull it.
  win.lastSent = null;
  electronMock.ipcMain._handlers['lapitaya:companion:requestSnapshot']({ sender: { id: 'main-window' } });
  assert.strictEqual(win.lastSent, null);
});

test('COMP-69: Transparent area is click-through; only the creature takes the pointer', () => {
  const { service, windowOf } = createHarness();
  const calls = [];
  const orig = electronMock.BrowserWindow.prototype.setIgnoreMouseEvents;
  electronMock.BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, opts) { calls.push({ win: this, ignore, forward: opts?.forward }); };
  try {
    service.show('MINI');
    const win = windowOf('alicia');
    assert.deepStrictEqual(calls.filter((c) => c.win === win).map((c) => [c.ignore, c.forward]), [[true, true]]);
    const h = electronMock.ipcMain._handlers['lapitaya:companion:setInteractive'];
    h({ sender: win.webContents }, true);
    h({ sender: win.webContents }, false);
    h({ sender: win.webContents }, 'yes');              // not a boolean → ignored
    h({ sender: { id: 'main-window' } }, true);         // foreign sender → ignored
    assert.deepStrictEqual(calls.filter((c) => c.win === win).map((c) => c.ignore), [true, false, true]);
  } finally {
    if (orig) electronMock.BrowserWindow.prototype.setIgnoreMouseEvents = orig;
    else delete electronMock.BrowserWindow.prototype.setIgnoreMouseEvents;
  }
  // Every interactive part reports hover; the drag handle sits inside a no-drag frame that does.
  const seen = [];
  const tree = CompanionCreature(creatureProps({ showMenu: true, showGallery: true, onInteractiveChange: (v) => seen.push(v) }).props);
  for (const role of ['bubble', 'creature', 'gallery', 'drag-handle']) {
    const [n] = byRole(tree, role);
    assert.ok(n, role);
    n.props.onMouseEnter();
    n.props.onMouseLeave();
  }
  assert.deepStrictEqual(seen, [true, false, true, false, true, false, true, false]);
  assert.strictEqual(byRole(tree, 'drag-handle')[0].props.style.WebkitAppRegion, 'no-drag');
});

test('COMP-70: Positions saved by a previous run are restored even though the store opens after construction', () => {
  // Like PersistStore: getKv returns undefined until open() (which main calls in whenReady).
  const data = new Map([['desktopCompanion.position.alicia', { x: 528, y: 233 }]]);
  let open = false;
  const persist = {
    getKv: (k) => (open ? data.get(k) : undefined),
    setKv: (k, v) => { if (open) data.set(k, v); }
  };
  const { service, windowOf } = createHarness({ persist });
  assert.deepStrictEqual(service.getPosition('alicia'), { x: 100, y: 100 }, 'store not open yet');
  open = true;
  service.show('MINI');
  assert.strictEqual(windowOf('alicia').opts.x, 528);
  assert.strictEqual(windowOf('alicia').opts.y, 233);
  // A companion without a saved position keeps its default.
  service.setMode('COMPANY');
  assert.strictEqual(windowOf('el-beni').opts.x, 400);
});

test('COMP-71: Drag deltas come from the main-process cursor (one coordinate space across DPI scales)', () => {
  let cursor = { x: 500, y: 500 };
  const screenModule = {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1032 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1032 } }),
    getCursorScreenPoint: () => cursor
  };
  const { service, windowOf } = createHarness({ screenModule });
  service.show('MINI');
  const win = windowOf('alicia');
  const bounds = [];
  win.setBounds = (b) => { bounds.push(b); win._x = b.x; win._y = b.y; };
  const drag = electronMock.ipcMain._handlers['lapitaya:companion:drag'];
  const ev = { sender: win.webContents };
  drag(ev, { phase: 'start', dx: 0, dy: 0 });
  cursor = { x: 650, y: 560 };
  // The renderer's own (possibly rescaled) delta is ignored when main can read the cursor.
  drag(ev, { phase: 'move', dx: 9999, dy: 9999 });
  assert.deepStrictEqual(win.getPosition(), [250, 160]);
  assert.deepStrictEqual(bounds.at(-1), { x: 250, y: 160, width: 340, height: 340 }, 'size is kept explicitly');
  drag(ev, { phase: 'end', dx: 0, dy: 0 });
  assert.deepStrictEqual(service.getPosition('alicia'), { x: 250, y: 160 });
});
