'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

// Electron is mocked before loading the main-side presentation service.
const electron = require.resolve('electron');
class MockWindow {
  constructor(opts) { this.opts = opts; this.x = opts.x ?? 0; this.y = opts.y ?? 0; this.visible = false; this.destroyed = false; this.webContents = { send: (channel, data) => { this.lastSent = { channel, data }; } }; this.listeners = {}; }
  on(name, fn) { this.listeners[name] = fn; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  loadURL() { return Promise.resolve(); }
  loadFile() { return Promise.resolve(); }
  setPosition(x, y) { this.x = x; this.y = y; }
  getPosition() { return [this.x, this.y]; }
  getBounds() { return { x: this.x, y: this.y, width: 340, height: 340 }; }
  setBounds(b) { this.x = b.x; this.y = b.y; }
  setIgnoreMouseEvents() {}
  destroy() { this.destroyed = true; }
}
const ipcMain = { _handlers: {}, on(c, fn) { this._handlers[c] = fn; }, handle(c, fn) { this._handlers[c] = fn; } };
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: {
  BrowserWindow: MockWindow,
  Menu: { buildFromTemplate: () => ({ popup() {}, closePopup() {} }) },
  Tray: class { on() {} setToolTip() {} setContextMenu() {} destroy() {} },
  nativeImage: { createFromDataURL: () => ({}) },
  ipcMain,
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
} };

const { DesktopPresenceService } = loadTs('src/main/desktopPresence.ts');
const behavior = loadTs('src/shared/lapitaya/desktopCompanions/behavior.ts');
const personality = loadTs('src/shared/lapitaya/desktopCompanions/personality.ts');
const { ExecutionAwakeService } = loadTs('src/main/executionAwake.ts');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { recordSpawnAssignment } = loadTs('src/main/spawnAssignment.ts');

function persist() { const m = new Map(); return { getKv: (k) => m.get(k), setKv: (k, v) => m.set(k, v), raw: m }; }
function timers() { let n = 0; const m = new Map(); return { setTimeout: (fn) => { const id = ++n; m.set(id, fn); return id; }, clearTimeout: (id) => m.delete(id), run: () => { for (const fn of [...m.values()]) fn(); } }; }
function presence(extra = {}) {
  const h = { persist: persist(), timers: timers(), ...extra };
  const service = new DesktopPresenceService({ browserWindowFactory: (o) => new MockWindow(o), ...h });
  return { service, windows: () => service.getPresentation().entries };
}
function fakeBlocker() { let next = 0; const held = new Set(); const calls = []; return { calls, start: (type) => { const id = ++next; held.add(id); calls.push(['start', type, id]); return id; }, stop: (id) => { held.delete(id); calls.push(['stop', id]); return true; }, isStarted: (id) => held.has(id) }; }
function assignment(taskId, phase, to = 'worker-1') { return { type: 'cima-record', data: { kind: 'cima-assignment', taskId, phase, to } }; }
function verdict(taskId, phase, verdict, agentId = 'worker-1') { return { type: 'cima-record', data: { kind: 'cima', taskId, phase, verdict, agentId } }; }

// LIVE-01…15
test('LIVE-01: only IDLE companions can start an ambient stroll', () => {
  const h = presence({ random: () => 0.01 }); h.service.show('COMPANION');
  assert.ok(h.service.ambientTick().length >= 1);
  h.service.observeAliciaEvents([{ type: 'cima.phase.changed', taskId: 't', phase: 'BUILD', verdict: 'PASS', ref: 'x' }]);
  assert.equal(behavior.mayMoveAmbiently({ visualState: 'WORKING', ambientMovement: true, reducedMotion: false, dragging: false, humanPending: false, sleeping: false }), false);
});
test('LIVE-02: runtime state wins over every ambient behavior', () => {
  for (const state of ['WORKING', 'ATTENTION', 'PAUSED', 'CONCERNED', 'CELEBRATING']) assert.equal(behavior.displayedBehavior(state, 'WALKING', false), state);
});
test('LIVE-03: ambient movement stays inside the companion display workArea', () => {
  const displays = [{ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }, { workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const h = presence({ random: () => 0.01, screenModule: { getPrimaryDisplay: () => displays[1], getDisplayMatching: (r) => r.x < 0 ? displays[0] : displays[1] } });
  h.service.show('COMPANY'); h.service.ambientTick();
  for (const e of h.service.getPresentation().entries) { const [x, y] = [e.position.x, e.position.y]; const a = x < 0 ? displays[0].workArea : displays[1].workArea; assert.ok(x >= a.x && y >= a.y && x + 340 <= a.x + a.width && y + 340 <= a.y + a.height); }
});
test('LIVE-04: ambient motion never changes the persisted home position', () => {
  const p = persist(); const h = presence({ persist: p, random: () => 0.01 }); h.service.show('MINI'); const home = h.service.getPosition('alicia'); h.service.ambientTick(); assert.deepEqual(h.service.getPosition('alicia'), home);
});
test('LIVE-05: reduced motion disables ambient movement', () => { assert.equal(behavior.mayMoveAmbiently({ visualState: 'IDLE', ambientMovement: true, reducedMotion: true, dragging: false, humanPending: false, sleeping: false }), false); });
test('LIVE-06: user preference disables ambient movement', () => { assert.equal(behavior.mayMoveAmbiently({ visualState: 'IDLE', ambientMovement: false, reducedMotion: false, dragging: false, humanPending: false, sleeping: false }), false); });
test('LIVE-07: a pending human decision blocks movement', () => { assert.equal(behavior.mayMoveAmbiently({ visualState: 'IDLE', ambientMovement: true, reducedMotion: false, dragging: false, humanPending: true, sleeping: false }), false); });
test('LIVE-08: sleep requires no execution, no pending decision and sufficient idle time', () => { const allowed = (c) => behavior.companionSleepAllowed({ executionActive: false, humanPending: false, userIdleMs: 300000, sleepAfterMs: 300000, ...c }); assert.equal(allowed({}), true); assert.equal(allowed({ executionActive: true }), false); assert.equal(allowed({ humanPending: true }), false); assert.equal(allowed({ userIdleMs: 1 }), false); });
test('LIVE-09: displayed sleep applies only to IDLE', () => { assert.equal(behavior.displayedBehavior('IDLE', 'RESTING', true), 'SLEEPING'); assert.equal(behavior.displayedBehavior('WORKING', 'RESTING', true), 'WORKING'); });
test('LIVE-10: strolling uses bounded slow steps', () => { const out = behavior.strollPath({ x: 0, y: 0 }, { x: 120, y: 0 }, 60, 60); assert.ok(out.length >= 2); assert.deepEqual(out.at(-1), { x: 120, y: 0 }); });
test('LIVE-11: planStroll respects roam radius', () => { const p = personality.COMPANION_PERSONALITIES.alicia; const to = behavior.planStroll({ from: { x: 100, y: 100 }, home: { x: 100, y: 100 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, windowSize: { width: 340, height: 340 }, personality: p, others: [], rng: () => 0.99 }); assert.ok(Math.hypot(to.x - 100, to.y - 100) <= p.roamRadius + 1); });
test('LIVE-12: all eight personalities are declarative and range-safe', () => { assert.equal(Object.keys(personality.COMPANION_PERSONALITIES).length, 8); for (const p of Object.values(personality.COMPANION_PERSONALITIES)) for (const [k, [lo, hi]] of Object.entries(personality.PERSONALITY_RANGES)) assert.ok(p[k] >= lo && p[k] <= hi, `${k}`); });
test('LIVE-13: personality work cues are presentation-only', () => { assert.equal(personality.WORK_STYLE_CUE.hosting, '💬'); assert.equal(typeof personality.getCompanionPersonality('unknown').movementFrequency, 'number'); });
test('LIVE-14: an in-progress stroll aborts when the companion becomes non-IDLE', () => { const h = presence({ random: () => 0.01 }); h.service.show('MINI'); h.service.ambientTick(); h.service.observeAliciaEvents([{ type: 'cima.phase.changed', taskId: 't', phase: 'BUILD', verdict: 'PASS', ref: 'x' }]); h.service.destroy(); assert.equal(h.service.isStrolling('alicia'), false); });
test('LIVE-15: living context exposes sleep and awake presentation without governance fields', () => { const h = presence(); h.service.setLivingContext({ executionActive: false, awakeActive: true, userIdleMs: 600000 }); const c = h.service.livingContext(); assert.equal(c.sleepAllowed, true); assert.equal(c.executionAwake, true); assert.equal('ledger' in c, false); });

// AWAKE-01…30
test('AWAKE-01: default enabled service is inactive without executions', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); assert.deepEqual(s.state(), { enabled: true, active: false, activeExecutionCount: 0, mode: null, executions: [] }); });
test('AWAKE-02: disabled setting prevents the blocker', () => { const b = fakeBlocker(); const s = new ExecutionAwakeService({ blocker: b, enabled: false }); s.workerStarted('w'); assert.equal(s.state().active, false); assert.equal(b.calls.length, 0); });
test('AWAKE-03: setting can be toggled without losing the execution', () => { const b = fakeBlocker(); const s = new ExecutionAwakeService({ blocker: b, enabled: true }); s.workerStarted('w'); s.setEnabled(false); s.setEnabled(true); assert.equal(s.state().activeExecutionCount, 1); assert.equal(s.state().active, true); });
test('AWAKE-04: blocker starts once for the first execution', () => { const b = fakeBlocker(); const s = new ExecutionAwakeService({ blocker: b, enabled: true }); s.workerStarted('w'); s.workerStarted('w'); assert.equal(b.calls.filter((x) => x[0] === 'start').length, 1); });
test('AWAKE-05: blocker stops only after the last execution ends', () => { const b = fakeBlocker(); const s = new ExecutionAwakeService({ blocker: b, enabled: true }); s.workerStarted('a'); s.workerStarted('b'); s.agentEnded('a'); assert.equal(s.state().active, true); s.agentEnded('b'); assert.equal(s.state().active, false); });
test('AWAKE-06: worker lifetime is a tracked source', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.workerStarted('w'); assert.equal(s.state().executions[0].source, 'worker'); });
test('AWAKE-07: hook turns are idempotent and close on Stop', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.noteHook('a', 'UserPromptSubmit'); s.noteHook('a', 'UserPromptSubmit'); assert.equal(s.state().activeExecutionCount, 1); s.noteHook('a', 'Stop'); assert.equal(s.state().activeExecutionCount, 0); });
test('AWAKE-08: SessionEnd closes a hook turn', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.noteHook('a', 'UserPromptSubmit'); s.noteHook('a', 'SessionEnd'); assert.equal(s.state().active, false); });
test('AWAKE-09: malformed lifecycle input is ignored', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.noteRuntimeEvent(null); s.noteRuntimeEvent({ type: 'other', data: {} }); s.noteHook(undefined, 'UserPromptSubmit'); assert.equal(s.state().activeExecutionCount, 0); });
test('AWAKE-10: real CIMA assignment starts an execution', (t) => { const r = cimaRig(t); const result = recordSpawnAssignment({ runtime: r.runtime, from: 'god', to: 'worker-build', cima: { taskId: 'T-10', phase: 'BUILD' }, messageId: 'm-10' }); assert.deepEqual(result, { recorded: true }); r.awake.noteRuntimeEvent(r.events.at(-1)); assert.equal(r.awake.state().activeExecutionCount, 1); });
test('AWAKE-11: real CIMA PASS closes the phase execution', (t) => { const r = cimaRig(t); recordSpawnAssignment({ runtime: r.runtime, from: 'god', to: 'worker-build', cima: { taskId: 'T-11', phase: 'BUILD' }, messageId: 'm-11' }); r.awake.noteRuntimeEvent(r.events.at(-1)); r.awake.noteRuntimeEvent(verdict('T-11', 'BUILD', 'PASS')); assert.equal(r.awake.state().active, false); });
test('AWAKE-12: real CIMA DECISION closes remaining task phases', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.noteRuntimeEvent(assignment('T-12', 'BUILD')); s.noteRuntimeEvent(assignment('T-12', 'TEST', 'worker-2')); s.noteRuntimeEvent({ type: 'cima-record', data: { kind: 'cima', taskId: 'T-12', phase: 'DECISION', verdict: 'PASS', agentId: 'god' } }); assert.equal(s.state().active, false); });
test('AWAKE-13: only work phases open CIMA executions', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); for (const phase of ['DECISION', 'UNKNOWN']) s.noteRuntimeEvent(assignment('T-13', phase)); assert.equal(s.state().activeExecutionCount, 0); });
test('AWAKE-14: terminal FAIL closes the matching phase', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.noteRuntimeEvent(assignment('T-14', 'TEST')); s.noteRuntimeEvent(verdict('T-14', 'TEST', 'FAIL')); assert.equal(s.state().active, false); });
test('AWAKE-15: CIMA assignment preserves task, phase and agent identity', (t) => { const r = cimaRig(t); recordSpawnAssignment({ runtime: r.runtime, from: 'god', to: 'worker-a', cima: { taskId: 'T-15', phase: 'AUDIT' }, messageId: 'm-15' }); r.awake.noteRuntimeEvent(r.events.at(-1)); const e = r.awake.state().executions[0]; assert.deepEqual({ id: e.id, source: e.source, agentId: e.agentId, taskId: e.taskId, phase: e.phase }, { id: 'cima:T-15:AUDIT:worker-a', source: 'cima', agentId: 'worker-a', taskId: 'T-15', phase: 'AUDIT' }); assert.ok(e.since >= 1_900_000_000_000); });
test('AWAKE-16: duplicate terminal signals are harmless', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.noteRuntimeEvent(assignment('T-16', 'BUILD')); s.noteRuntimeEvent(verdict('T-16', 'BUILD', 'PASS')); s.noteRuntimeEvent(verdict('T-16', 'BUILD', 'PASS')); assert.equal(s.state().activeExecutionCount, 0); });
test('AWAKE-17: agentEnded clears every source for that agent', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.workerStarted('w'); s.noteHook('w', 'UserPromptSubmit'); s.agentEnded('w'); assert.equal(s.state().activeExecutionCount, 0); });
test('AWAKE-18: unknown agent cannot create a hook execution', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.noteHook('', 'UserPromptSubmit'); assert.equal(s.state().activeExecutionCount, 0); });
test('AWAKE-19: mode is prevent-app-suspension by default', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.workerStarted('w'); assert.equal(s.state().mode, 'prevent-app-suspension'); });
test('AWAKE-20: mode changes are synchronized', () => { const b = fakeBlocker(); let mode = 'prevent-app-suspension'; const s = new ExecutionAwakeService({ blocker: b, enabled: true, mode: () => mode }); s.workerStarted('w'); mode = 'prevent-display-sleep'; s.sync(); assert.equal(s.state().mode, 'prevent-display-sleep'); });
test('AWAKE-21: safety sweep removes stale executions', () => { let now = 1000; const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true, now: () => now, maxExecutionMs: 10 }); s.workerStarted('w'); now = 1011; s.sweep(); assert.equal(s.state().active, false); });
test('AWAKE-22: sweep keeps fresh executions', () => { let now = 1000; const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true, now: () => now, maxExecutionMs: 10 }); s.workerStarted('w'); now = 1005; s.sweep(); assert.equal(s.state().active, true); });
test('AWAKE-23: dispose releases and ignores later input', () => { const b = fakeBlocker(); const s = new ExecutionAwakeService({ blocker: b, enabled: true }); s.workerStarted('w'); s.dispose(); s.workerStarted('later'); assert.equal(s.state().active, false); assert.equal(s.state().activeExecutionCount, 0); });
test('AWAKE-24: blocker start failure fails closed', () => { const s = new ExecutionAwakeService({ blocker: { start: () => { throw new Error('no'); }, stop: () => true, isStarted: () => false }, enabled: true }); s.workerStarted('w'); assert.equal(s.state().active, false); assert.equal(s.state().activeExecutionCount, 1); });
test('AWAKE-25: O-1 reassignment after PASS is ignored', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.noteRuntimeEvent(assignment('T-25', 'BUILD')); s.noteRuntimeEvent(verdict('T-25', 'BUILD', 'PASS')); s.noteRuntimeEvent(assignment('T-25', 'BUILD')); assert.equal(s.state().activeExecutionCount, 0); });
test('AWAKE-26: release is not driven by presentation state', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.workerStarted('w'); assert.equal(s.state().active, true); assert.equal(typeof s.noteRuntimeEvent, 'function'); });
test('AWAKE-27: source files contain no input simulation APIs', () => { const text = fs.readFileSync(path.resolve(__dirname, '../src/main/executionAwake.ts'), 'utf8') + fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8'); assert.doesNotMatch(text, /SendInput|mouse_event|keybd_event|SetCursorPos|robotjs|sendInputEvent|SetThreadExecutionState|powercfg/); });
test('AWAKE-28: governance presentation boundary does not read powerMonitor', () => { const files = ['src/main/desktopPresence.ts', 'src/shared/lapitaya/desktopCompanions/behavior.ts', 'src/shared/lapitaya/desktopCompanions/personality.ts']; for (const f of files) assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'), /powerMonitor/); });
test('AWAKE-29: exactly one read-only awake IPC channel exists', () => { const text = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8') + fs.readFileSync(path.resolve(__dirname, '../src/preload/index.ts'), 'utf8'); assert.equal((text.match(/lapitaya:executionAwake:state/g) || []).length, 2); assert.doesNotMatch(text, /ipcMain\.on\(['"]lapitaya:executionAwake/); });
test('AWAKE-30: execution state is presentation-safe and excludes ledger data', () => { const s = new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true }); s.workerStarted('w'); const state = s.state(); assert.deepEqual(Object.keys(state).sort(), ['active', 'activeExecutionCount', 'enabled', 'executions', 'mode']); assert.equal('ledger' in state, false); });

function cimaRig(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-awake-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const events = []; let clock = 1_900_000_000_000;
  const runtime = new CimaRuntimeService({ hiveRoot: () => root, godId: () => 'god', onEvent: (e) => events.push(e), now: () => ++clock, lockTimeoutMs: 800 });
  return { runtime, events, clock, awake: new ExecutionAwakeService({ blocker: fakeBlocker(), enabled: true, now: () => clock }) };
}
