/**
 * La Pitaya — FASE 2.3 — Rosalba, Senior Software Developer (ROS-01 … ROS-35).
 *
 * Real pieces only: the canonical registry, a real HiveManager on a temp hive, the real HookServer
 * (traces + PreToolUse governance), the real CimaRuntimeService (hash-chained, MAC'd ledger), the
 * real spawn assignment path and the real DesktopPresence — wired exactly like src/main/index.ts:
 *
 *   recordSpawnAssignment → CimaRuntimeService.onEvent → fromRuntimeEvent → DesktopPresence.observeAliciaEvents
 *   DesktopPresence.resolveAgent = hive registry NAME of the worker → agentByName
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { TRUSTED_HUMAN: HUMAN } = require('./fixtures/human.cjs');

// ─── electron mock (companion windows + hive notifications) ─────────────────
const electron = require.resolve('electron');
class MockBrowserWindow {
  constructor(opts) {
    this.opts = opts; this._visible = false; this._destroyed = false; this.listeners = {};
    this.webContents = { send: (channel, data) => { this.lastSent = { channel, data }; }, on: () => {} };
  }
  on(event, fn) { this.listeners[event] = fn; }
  show() { this._visible = true; }
  hide() { this._visible = false; }
  isVisible() { return this._visible; }
  isDestroyed() { return this._destroyed; }
  loadURL() { return Promise.resolve(); }
  loadFile() { return Promise.resolve(); }
  setIgnoreMouseEvents() {}
  setPosition() {}
  getPosition() { return [0, 0]; }
}
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: {
    BrowserWindow: MockBrowserWindow,
    Notification: class { show() {} static isSupported() { return false; } },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    ipcMain: { _handlers: {}, on(channel, fn) { this._handlers[channel] = fn; } }
  }
};
const electronMock = require.cache[electron].exports;

const agents = loadTs('src/shared/lapitaya/agents.ts');
const { ANIMAL_AVATAR_REGISTRY, getAnimalAvatar } = loadTs('src/shared/lapitaya/desktopCompanions/animalAvatar.ts');
const { companionFactsFromAliciaEvent, companionFactEffect, phaseOwner } = loadTs('src/shared/lapitaya/desktopCompanions/runtimeFacts.ts');
const { DesktopPresenceService, MAX_VISIBLE_COMPANIONS_DEFAULT } = loadTs('src/main/desktopPresence.ts');
const { fromRuntimeEvent } = loadTs('src/shared/lapitaya/alicia/events.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { recordSpawnAssignment } = loadTs('src/main/spawnAssignment.ts');
const { recordBanner } = loadTs('src/shared/lapitaya/cimaRuntime.ts');
const { DEFAULT_POLICY, POLICY_REGISTRY } = loadTs('src/shared/lapitaya/policyRegistry.ts');
const { CIMA_GOD_BRIEFING } = loadTs('src/shared/lapitaya/cimaBriefing.ts');
const { SPECIES_EMOJI_MAP } = loadTs('src/renderer/src/companions/CompanionCreature.tsx');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const i18n = (loc) => JSON.parse(src(`src/renderer/src/i18n/locales/lapitaya/${loc}.json`));

/** What src/main/index.ts gives DesktopPresence. */
const resolverFor = (hive) => (hiveAgentId) => agents.agentByName(hive.registry().agents[hiveAgentId]?.name)?.id ?? null;

/** A temp hive: El Inge + one worker per role (named exactly as El Inge's spawn-request would name them). */
async function rig(t, { config = { autoMode: true, notifications: false }, resolver = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-rosalba-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  for (const [id, name] of [['worker-ros1', 'Rosalba'], ['worker-beni1', 'El Beni'], ['worker-marg1', 'Margarito'],
    ['worker-jj1', 'José Juan'], ['worker-x1', 'Somebody Else']]) {
    await hive.ensureAgent({ id, name, provider: 'claude', cwd: home });
  }
  const windows = [];
  const presence = new DesktopPresenceService({
    browserWindowFactory: (opts) => { const w = new MockBrowserWindow(opts); windows.push(w); return w; },
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
    ...(resolver ? { resolveAgent: resolverFor(hive) } : {})
  });
  const events = [];
  let clock = 1_800_000_000_000;
  const mkrt = () => new CimaRuntimeService({
    hiveRoot: () => hive.root(), godId: () => 'god',
    phaseOf: (agentId) => agents.phaseForAgent(hive.registry(), agentId),
    now: () => (clock += 1000), lockTimeoutMs: 800,
    onEvent: (e) => { events.push(e); presence.observeAliciaEvents(fromRuntimeEvent(e, clock)); }
  });
  const runtime = mkrt();
  hive.setCimaHandler((from, cima, id, to) => recordBanner(runtime.handle(from, to, cima, id)));
  const server = new HookServer(hive, () => null, () => config, undefined, undefined, undefined, undefined, runtime);
  const hook = (agentId, payload) => server.handle({ agent_id: agentId, agent_token: hive.registerAgentToken(agentId), session_id: `s-${agentId}`, ...payload });
  const pre = (agentId, tool, input) => hook(agentId, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
  const ran = (agentId, command, stdout) => hook(agentId, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout, stderr: '', interrupted: false } });
  const wrote = (agentId, file) => hook(agentId, { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'b' }, tool_response: {} });
  /** A phase result in the agent's outbox, routed like the real hive does. */
  const send = (from, cima) => {
    const out = path.join(hive.root(), 'agents', from, 'outbox');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `m-${Date.now()}-${Math.random().toString(36).slice(2)}.json`),
      JSON.stringify({ to: 'god', act: 'inform', subject: `${cima.phase} result`, body: 'agent prose', cima }));
    hive.routeOnce();
    const recs = runtime.cimaRecords();
    return recs[recs.length - 1];
  };
  /** What processSpawnRequest does after dispatching the objective (El Inge = god). */
  const spawn = (workerId, cima, messageId = `msg-${workerId}`) => recordSpawnAssignment({ runtime, from: 'god', to: workerId, cima, messageId });
  const ledgerFile = path.join(hive.root(), 'lapitaya', 'cima-ledger.jsonl');
  const ledger = () => (fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const denied = (r) => r?.hookSpecificOutput?.permissionDecision === 'deny';
  const shown = () => presence.getPresentation().entries.map((e) => [e.agentId, e.visualState]);
  const entry = (id) => presence.getPresentation().entries.find((e) => e.agentId === id);
  return { home, hive, presence, windows, runtime, mkrt, events, pre, ran, wrote, send, spawn, ledger, denied, shown, entry };
}

/** A BUILD that passes with evidence the harness really observed. */
async function rosalbaBuildPass(r, taskId) {
  r.spawn('worker-ros1', { taskId, phase: 'BUILD' });
  await r.wrote('worker-ros1', path.join(r.home, 'src', 'feature.cjs'));
  await r.ran('worker-ros1', 'node --test test/feature.test.cjs', 'ℹ pass 4');
  return r.send('worker-ros1', { taskId, phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'test-result', source: 'node --test test/feature.test.cjs' }] });
}

// ─── identity ───────────────────────────────────────────────────────────────

test('ROS-01: Rosalba exists in the canonical agent registry', () => {
  assert.ok(agents.LA_PITAYA_AGENT_BY_ID.rosalba);
  assert.ok(agents.LA_PITAYA_AGENTS.some((a) => a.id === 'rosalba'));
  assert.ok(agents.LA_PITAYA_HIRE_PRESETS.some((a) => a.id === 'rosalba'), 'hireable through the existing Add-Agent flow');
  assert.deepEqual(agents.LA_PITAYA_AGENTS.map((a) => a.id),
    ['el-inge', 'valentin', 'rosalba', 'el-beni', 'margarito', 'jose-juan', 'el-tutu', 'alicia'], 'the company has 8 members, in workflow order');
});

test('ROS-02: Rosalba canonical ID is `rosalba` (no aliases)', () => {
  const a = agents.LA_PITAYA_AGENT_BY_ID.rosalba;
  assert.equal(a.id, 'rosalba');
  assert.equal(a.name, 'Rosalba');
  assert.equal(agents.agentByName('Rosalba').id, 'rosalba');
  assert.equal(agents.agentByName('  rosalba ').id, 'rosalba');
  for (const alias of ['rosalba-agent', 'senior-dev', 'developer2']) assert.equal(agents.LA_PITAYA_AGENT_BY_ID[alias], undefined, alias);
  assert.equal(agents.LA_PITAYA_AGENTS.filter((x) => /rosalba/i.test(x.id)).length, 1);
});

test('ROS-03: Rosalba role = Senior Software Developer', () => {
  const a = agents.LA_PITAYA_AGENT_BY_ID.rosalba;
  assert.equal(a.title, 'Senior Software Developer');
  assert.equal(a.seniority, 'senior');
  assert.equal(agents.agentTitleKey(a), 'lapitaya:titles.rosalba');
  assert.match(a.description, /^Senior Software Developer/);
  assert.match(CIMA_GOD_BRIEFING, /Rosalba \(Senior Software Developer, BUILD\)/, 'El Inge is briefed on her');
  assert.match(CIMA_GOD_BRIEFING, /El Beni \(Builder, BUILD\)/, 'El Beni keeps his line');
});

test('ROS-04: Rosalba maps to Dog 🐶', () => {
  const av = getAnimalAvatar('rosalba');
  assert.equal(av.species, 'dog');
  assert.equal(av.emoji, '🐶');
  assert.equal(SPECIES_EMOJI_MAP.dog, '🐶', 'the companion renderer draws her');
  for (const t of ['sweet', 'serene', 'reliable']) assert.ok(av.personality.traits.includes(t), t);
  for (const bad of ['aggressive', 'guard', 'military']) assert.ok(!av.personality.traits.includes(bad), bad);
});

test('ROS-05: Rosalba is classified as Builder for CIMA separation purposes', async (t) => {
  const a = agents.LA_PITAYA_AGENT_BY_ID.rosalba;
  assert.equal(a.role, 'builder');
  assert.equal(a.runtime, 'hire-preset');
  assert.deepEqual([...a.cimaPhases], ['BUILD']);
  const r = await rig(t);
  assert.equal(agents.phaseForAgent(r.hive.registry(), 'worker-ros1'), 'BUILD', 'the runtime stamps her governance with BUILD');
  // No new authority vocabulary anywhere in the roster/governance sources.
  for (const f of ['src/shared/lapitaya/agents.ts', 'src/shared/lapitaya/cimaRuntime.ts', 'src/shared/lapitaya/policyRegistry.ts', 'src/main/cimaRuntime.ts']) {
    assert.doesNotMatch(code(f), /SENIOR_(APPROVAL|AUTHORITY|GOVERNANCE)|role:\s*'senior/, f);
  }
});

// ─── Builder != Auditor · governance ─────────────────────────────────────────

test('ROS-06: Rosalba cannot audit (or test-pass) her own work', async (t) => {
  const r = await rig(t);
  assert.equal((await rosalbaBuildPass(r, 'LP-ROS-6')).verdict, 'PASS');
  await r.ran('worker-ros1', 'git diff --stat', ' src/feature.cjs | 4 ++--');
  const selfAudit = r.send('worker-ros1', { taskId: 'LP-ROS-6', phase: 'AUDIT', verdict: 'PASS', evidence: [{ type: 'diff', source: 'git diff --stat' }] });
  assert.equal(selfAudit.verdict, 'BLOCKED');
  assert.ok(selfAudit.violations.includes('BUILDER_NOT_AUDITOR'));
  const selfTest = r.send('worker-ros1', { taskId: 'LP-ROS-6', phase: 'TEST', verdict: 'PASS', evidence: [{ type: 'test-result', source: 'node --test test/feature.test.cjs' }] });
  assert.ok(selfTest.violations.includes('BUILDER_NOT_AUDITOR'));
});

test('ROS-07: Rosalba cannot approve HIGH', async (t) => {
  const r = await rig(t);
  assert.equal(r.denied(await r.pre('worker-ros1', 'Bash', { command: 'git push origin main' })), true);
  const [a] = r.runtime.listApprovals();
  assert.equal(a.status, 'pending');
  // A decision is only a decision with a trusted human context; an agent id is not one.
  assert.equal(r.runtime.decide(a.id, true, 'worker-ros1'), null);
  assert.equal(r.runtime.decide(a.id, true, 'rosalba', { human: { id: 'rosalba', displayName: 'Rosalba' } }), null);
  assert.equal(r.runtime.listApprovals().find((x) => x.id === a.id).status, 'pending', 'still waiting for the human');
  assert.equal(r.denied(await r.pre('worker-ros1', 'Bash', { command: 'git push origin main' })), true);
  // The human decision path has no agent-specific door.
  assert.doesNotMatch(code('src/main/humanGovernanceIpc.ts'), /rosalba|senior/i);
});

test('ROS-08: a HIGH action by Rosalba requires HUMAN_APPROVAL (even in autoMode)', async (t) => {
  const r = await rig(t, { config: { autoMode: true, notifications: false } });
  const res = await r.pre('worker-ros1', 'Bash', { command: 'node scripts/migrate.cjs --drop-all-tables' });
  assert.equal(r.denied(res), true);
  assert.match(res.hookSpecificOutput.permissionDecisionReason, /^HUMAN_APPROVAL_REQUIRED/);
  const pending = r.runtime.listApprovals().filter((a) => a.status === 'pending');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].agentId, 'worker-ros1');
  assert.equal(pending[0].risk, 'HIGH');
  // Only a human decision opens it — once.
  r.runtime.decide(pending[0].id, true, 'human', HUMAN);
  assert.equal(r.denied(await r.pre('worker-ros1', 'Bash', { command: 'node scripts/migrate.cjs --drop-all-tables' })), false);
  assert.equal(r.denied(await r.pre('worker-ros1', 'Bash', { command: 'node scripts/migrate.cjs --drop-all-tables' })), true);
});

// ─── dispatch · spawn · assignment ───────────────────────────────────────────

test('ROS-09: El Inge can dispatch BUILD to Rosalba (existing spawn path, documented for him)', async (t) => {
  const r = await rig(t);
  assert.deepEqual(r.spawn('worker-ros1', { taskId: 'LP-ROS-9', phase: 'BUILD' }), { recorded: true });
  const a = r.ledger().find((e) => e.kind === 'cima-assignment');
  assert.equal(a.from, 'god');
  assert.equal(a.to, 'worker-ros1');
  const hiveTs = src('src/main/hive.ts');
  assert.match(hiveTs, /"name": "Rosalba"/);
  assert.match(hiveTs, /"name": "El Beni"/);
  assert.match(hiveTs, /never by herself/);
  // No second dispatch mechanism: the spawn-request contract is unchanged.
  const index = src('src/main/index.ts');
  assert.match(index, /interface SpawnRequest \{[\s\S]*?name\?: string;[\s\S]*?cima\?: unknown;/);
  assert.doesNotMatch(code('src/main/index.ts'), /rosalba/i, 'main has no Rosalba special case');
});

test('ROS-10: Rosalba spawn carries a structured CIMA assignment (and only an assignment)', async (t) => {
  const r = await rig(t);
  assert.deepEqual(r.spawn('worker-ros1', { taskId: 'LP-ROS-10', phase: 'BUILD' }), { recorded: true });
  const claim = r.spawn('worker-ros1', { taskId: 'LP-ROS-10', phase: 'BUILD', verdict: 'PASS', evidence: [] });
  assert.equal(claim.recorded, false);
  assert.equal(claim.reason, 'not-an-assignment');
  assert.ok(!r.ledger().some((e) => e.kind === 'cima'), 'no verdict recorded in her name');
});

test('ROS-11: Rosalba BUILD generates a real cima-assignment', async (t) => {
  const r = await rig(t);
  r.spawn('worker-ros1', { taskId: 'LP-ROS-11', phase: 'BUILD' });
  const as = r.ledger().filter((e) => e.kind === 'cima-assignment');
  assert.equal(as.length, 1);
  assert.equal(as[0].phase, 'BUILD');
  assert.equal(as[0].eventType, 'CIMA_ASSIGNMENT');
  assert.ok(r.events.some((e) => e.type === 'cima-record' && e.data.kind === 'cima-assignment' && e.data.to === 'worker-ros1'));
});

test('ROS-12: the assignment preserves task identity', async (t) => {
  const r = await rig(t);
  r.spawn('worker-ros1', { taskId: '  LP-ROS-12  ', phase: 'build' });
  const a = r.ledger().find((e) => e.kind === 'cima-assignment');
  assert.equal(a.taskId, 'LP-ROS-12');
  assert.equal(a.phase, 'BUILD');
  const ev = fromRuntimeEvent(r.events.find((e) => e.type === 'cima-record'), 0)[0];
  assert.equal(ev.taskId, 'LP-ROS-12');
});

test('ROS-13: the assignment preserves runtime identity (orchestrator → Rosalba worker, dispatch message)', async (t) => {
  const r = await rig(t);
  r.spawn('worker-ros1', { taskId: 'LP-ROS-13', phase: 'BUILD' }, 'msg-dispatch-ros');
  const a = r.ledger().find((e) => e.kind === 'cima-assignment');
  assert.equal(a.from, 'god');
  assert.equal(a.to, 'worker-ros1');
  assert.equal(a.messageId, 'msg-dispatch-ros');
  const ev = fromRuntimeEvent(r.events.find((e) => e.type === 'cima-record'), 0)[0];
  assert.equal(ev.agentId, 'worker-ros1');
  assert.equal(ev.fromAgentId, 'god');
  assert.equal(ev.ref, 'msg-dispatch-ros');
  assert.equal(r.hive.registry().agents['worker-ros1'].name, 'Rosalba', 'who she is comes from the hive registry');
});

test('ROS-14: Rosalba events participate in the event integrity chain', async (t) => {
  const r = await rig(t);
  await rosalbaBuildPass(r, 'LP-ROS-14');
  const L = r.ledger();
  for (const e of L.filter((x) => x.kind === 'cima-assignment' || x.kind === 'cima')) {
    for (const k of ['eventId', 'sequence', 'previousEventHash', 'eventHash', 'eventMac', 'ts']) assert.ok(e[k] !== undefined, `${e.kind} carries ${k}`);
  }
  for (let i = 1; i < L.length; i++) {
    assert.equal(L[i].sequence, L[i - 1].sequence + 1);
    assert.equal(L[i].previousEventHash, L[i - 1].eventHash);
  }
  assert.equal(r.mkrt().verifyGovernanceState({ full: true }).status, 'HEALTHY');
});

// ─── presentation ────────────────────────────────────────────────────────────

test('ROS-15: Rosalba BUILD → Rosalba WORKING (not El Beni)', async (t) => {
  const r = await rig(t);
  r.presence.setMode('COMPANY');
  r.spawn('worker-ros1', { taskId: 'LP-ROS-15', phase: 'BUILD' });
  assert.equal(r.presence.getAgentState('rosalba'), 'WORKING');
  assert.equal(r.presence.getAgentState('el-beni'), 'IDLE');
  const e = r.entry('rosalba');
  assert.equal(e.visualState, 'WORKING');
  assert.equal(e.species, 'dog');
  assert.equal(e.bubble.text, 'Rosalba está construyendo.');
  assert.equal(e.bubble.sourceFact, 'BUILD_STARTED');
});

test('ROS-16: Rosalba BUILD PASS follows the existing success semantics (Alicia celebrates, Rosalba released)', async (t) => {
  const r = await rig(t);
  r.presence.setMode('COMPANY');
  assert.equal((await rosalbaBuildPass(r, 'LP-ROS-16')).verdict, 'PASS');
  assert.equal(r.presence.getAgentState('alicia'), 'CELEBRATING');
  assert.equal(r.entry('alicia').bubble.text, 'El build terminó con éxito.');
  assert.equal(r.presence.getAgentState('rosalba'), 'IDLE');
  assert.equal(r.presence.getAgentState('el-beni'), 'IDLE');
});

test('ROS-17: Rosalba BUILD FAIL → Rosalba CONCERNED', async (t) => {
  const r = await rig(t);
  r.spawn('worker-ros1', { taskId: 'LP-ROS-17', phase: 'BUILD' });
  await r.ran('worker-ros1', 'npm run build', 'error TS2322: Type mismatch');
  const rec = r.send('worker-ros1', { taskId: 'LP-ROS-17', phase: 'BUILD', verdict: 'FAIL', evidence: [{ type: 'command-output', source: 'npm run build' }] });
  assert.equal(rec.verdict, 'FAIL');
  assert.equal(r.presence.getAgentState('rosalba'), 'CONCERNED');
  assert.equal(r.presence.getAgentState('el-beni'), 'IDLE');
});

test('ROS-18: Rosalba BUILD BLOCKED → Rosalba PAUSED', async (t) => {
  const r = await rig(t);
  r.spawn('worker-ros1', { taskId: 'LP-ROS-18', phase: 'BUILD' });
  const rec = r.send('worker-ros1', { taskId: 'LP-ROS-18', phase: 'BUILD', verdict: 'BLOCKED', evidence: [] });
  assert.equal(rec.verdict, 'BLOCKED');
  assert.equal(r.presence.getAgentState('rosalba'), 'PAUSED');
  assert.notEqual(r.presence.getAgentState('rosalba'), 'CONCERNED');
});

test('ROS-19: Rosalba BLOCKED produces no failure text', async (t) => {
  const r = await rig(t);
  r.presence.setMode('COMPANY');
  r.spawn('worker-ros1', { taskId: 'LP-ROS-19', phase: 'BUILD' });
  r.send('worker-ros1', { taskId: 'LP-ROS-19', phase: 'BUILD', verdict: 'BLOCKED', evidence: [] });
  const b = r.entry('rosalba').bubble;
  assert.equal(b.sourceFact, 'BUILD_BLOCKED');
  assert.match(b.text, /BLOCKED: sin validar todavía/);
  assert.doesNotMatch(b.text, /no pasó|falló|fail/i);
});

test('ROS-20: FOCUS + Rosalba BUILD → only Rosalba, WORKING', async (t) => {
  const r = await rig(t);
  r.presence.setMode('FOCUS');
  r.spawn('worker-ros1', { taskId: 'LP-ROS-20', phase: 'BUILD' });
  assert.deepEqual(r.shown(), [['rosalba', 'WORKING']]);
  assert.equal(r.presence.getPresentation().activePhaseAgent, 'rosalba');
});

test('ROS-21: FOCUS + El Beni BUILD → only El Beni, WORKING', async (t) => {
  const r = await rig(t);
  r.presence.setMode('FOCUS');
  r.spawn('worker-beni1', { taskId: 'LP-ROS-21', phase: 'BUILD' });
  assert.deepEqual(r.shown(), [['el-beni', 'WORKING']]);
  // and FOCUS follows the next assignment, whoever the builder is
  r.spawn('worker-ros1', { taskId: 'LP-ROS-21b', phase: 'BUILD' });
  assert.deepEqual(r.shown(), [['rosalba', 'WORKING']]);
});

test('ROS-22: the BUILD phase does not hardcode El Beni', () => {
  const resolve = (id) => ({ 'worker-ros1': 'rosalba', 'worker-beni1': 'el-beni' })[id] ?? null;
  const assigned = (agentId) => ({ type: 'cima.phase.assigned', ts: 1, source: 'cima-runtime', taskId: 'T', phase: 'BUILD', agentId, ref: 'm' });
  assert.deepEqual(companionFactsFromAliciaEvent(assigned('worker-ros1'), resolve), [{ fact: 'BUILD_STARTED', ref: 'm', agent: 'rosalba' }]);
  assert.deepEqual(companionFactsFromAliciaEvent(assigned('worker-beni1'), resolve), [{ fact: 'BUILD_STARTED', ref: 'm', agent: 'el-beni' }]);
  assert.equal(companionFactEffect('BUILD_STARTED', 'rosalba').target, 'rosalba');
  assert.equal(companionFactEffect('BUILD_FAILED', 'rosalba').target, 'rosalba');
  assert.equal(companionFactEffect('BUILD_COMPLETED', 'rosalba').release, 'rosalba');
  assert.equal(companionFactEffect('BUILD_COMPLETED', 'rosalba').target, 'alicia');
  // The default owner of BUILD is still El Beni (an event that names no builder).
  assert.equal(phaseOwner('BUILD'), 'el-beni');
  assert.equal(agents.defaultPhaseOwner('BUILD'), 'el-beni');
  assert.deepEqual(companionFactsFromAliciaEvent(assigned('worker-ros1')), [{ fact: 'BUILD_STARTED', ref: 'm' }]);
});

test('ROS-23: COMPANY can include Rosalba', async (t) => {
  const r = await rig(t);
  r.presence.setMode('COMPANY');
  r.spawn('worker-ros1', { taskId: 'LP-ROS-23', phase: 'BUILD' });
  const ids = r.presence.getVisibleAgents();
  assert.ok(ids.includes('rosalba'));
  assert.ok(ids.includes('alicia'));
});

test('ROS-24: COMPANY remains max 3', async (t) => {
  const r = await rig(t);
  r.presence.setMode('COMPANY');
  r.spawn('worker-ros1', { taskId: 'A', phase: 'BUILD' });
  r.spawn('worker-beni1', { taskId: 'B', phase: 'BUILD' });
  r.spawn('worker-marg1', { taskId: 'C', phase: 'TEST' });
  r.spawn('worker-jj1', { taskId: 'D', phase: 'AUDIT' });
  assert.equal(MAX_VISIBLE_COMPANIONS_DEFAULT, 3);
  assert.ok(r.presence.getPresentation().entries.length <= 3);
  r.presence.setPreferences({ maxVisibleCompanions: 8 });
  assert.ok(r.presence.getPresentation().entries.length <= 3, 'the cap cannot be raised by preference');
});

test('ROS-25: Rosalba state is independent from El Beni', async (t) => {
  const r = await rig(t);
  r.spawn('worker-beni1', { taskId: 'LP-B', phase: 'BUILD' });
  assert.equal((await rosalbaBuildPass(r, 'LP-R')).verdict, 'PASS');
  assert.equal(r.presence.getAgentState('rosalba'), 'IDLE', 'her PASS released her');
  assert.equal(r.presence.getAgentState('el-beni'), 'WORKING', 'El Beni keeps working on his own task');
  r.spawn('worker-ros1', { taskId: 'LP-R2', phase: 'BUILD' });
  r.send('worker-ros1', { taskId: 'LP-R2', phase: 'BUILD', verdict: 'BLOCKED', evidence: [] });
  assert.equal(r.presence.getAgentState('rosalba'), 'PAUSED');
  assert.equal(r.presence.getAgentState('el-beni'), 'WORKING');
});

test('ROS-26: Rosalba state is independent from Alicia', async (t) => {
  const r = await rig(t);
  r.presence.setMode('COMPANY');
  r.spawn('worker-ros1', { taskId: 'LP-ROS-26', phase: 'BUILD' });
  await r.pre('worker-ros1', 'Bash', { command: 'git push origin main' });
  assert.equal(r.presence.getAgentState('alicia'), 'ATTENTION', 'the HIGH request asks the human through Alicia');
  assert.equal(r.presence.getAgentState('rosalba'), 'WORKING', 'Rosalba is not moved by it');
  const [a] = r.runtime.listApprovals();
  r.runtime.decide(a.id, false, 'human', HUMAN);
  assert.notEqual(r.presence.getAgentState('alicia'), 'ATTENTION');
  assert.equal(r.presence.getAgentState('rosalba'), 'WORKING');
});

test('ROS-27: the Rosalba companion renderer has no governance authority', async (t) => {
  const r = await rig(t);
  r.presence.setMode('COMPANY');
  r.spawn('worker-ros1', { taskId: 'LP-ROS-27', phase: 'BUILD' });
  assert.ok(r.windows.length > 0);
  // Forged payloads from a companion window change nothing.
  const sender = r.windows[r.windows.length - 1].webContents;
  for (const fn of Object.values(electronMock.ipcMain._handlers)) {
    for (const payload of ['BUILD_COMPLETED', { fact: 'BUILD_COMPLETED', agent: 'rosalba' }, { approve: true }, { taskId: 'X', phase: 'AUDIT', to: 'rosalba' }]) fn({ sender }, payload);
  }
  assert.equal(r.presence.getAgentState('rosalba'), 'WORKING');
  assert.ok(!r.ledger().some((e) => e.kind === 'cima'), 'no verdict reached the ledger');
  for (const f of ['src/renderer/src/companions/CompanionApp.tsx', 'src/renderer/src/companions/CompanionCreature.tsx', 'src/preload/companionPreload.ts']) {
    assert.doesNotMatch(code(f), /approve|authoriz|decide\(|cima-assignment|triggerVerified|appendLedger/i, f);
  }
});

test('ROS-28: the Rosalba companion exposes presentation-only IPC (sandboxed)', async (t) => {
  const r = await rig(t);
  r.presence.setMode('FOCUS');
  r.spawn('worker-ros1', { taskId: 'LP-ROS-28', phase: 'BUILD' });
  const wp = r.windows[r.windows.length - 1].opts.webPreferences;
  assert.equal(wp.sandbox, true);
  assert.equal(wp.contextIsolation, true);
  assert.equal(wp.nodeIntegration, false);
  const preload = code('src/preload/companionPreload.ts');
  const keys = [...preload.matchAll(/^\s{2}([a-zA-Z]+): \(/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), ['dismissBubble', 'drag', 'hide', 'onSnapshot', 'open', 'setInteractive', 'setMode']);
  assert.doesNotMatch(preload, /rosalba/i, 'no agent-specific channel');
  for (const ch of ['rosalba:approve', 'rosalba:authorize', 'rosalba:execute-high', 'rosalba:ledger', 'rosalba:governance']) {
    assert.ok(!Object.keys(electronMock.ipcMain._handlers).includes(ch), ch);
  }
});

// ─── i18n ────────────────────────────────────────────────────────────────────

test('ROS-29: es-MX strings resolve', () => {
  assert.equal(agents.agentDisplayName('rosalba', 'es-MX'), 'Rosalba');
  assert.equal(i18n('es-MX').titles.rosalba, 'Desarrolladora Senior');
  assert.equal(i18n('es-MX').roles.builder, 'Constructor', 'existing role strings untouched');
});

test('ROS-30: en-US strings resolve', () => {
  assert.equal(agents.agentDisplayName('rosalba', 'en-US'), 'Rosalba');
  assert.equal(i18n('en-US').titles.rosalba, 'Senior Software Developer');
  assert.equal(i18n('en-US').roles.builder, 'Builder');
  // every title key the registry asks for exists in both locales
  for (const a of agents.LA_PITAYA_AGENTS.filter((x) => x.title)) {
    for (const loc of ['es-MX', 'en-US']) assert.ok(i18n(loc).titles[a.id], `${loc} titles.${a.id}`);
  }
});

// ─── compatibility ───────────────────────────────────────────────────────────

test('ROS-31: the existing seven agents remain unchanged', () => {
  const expected = {
    'el-inge': ['orchestrator', 'god', 'CONTEXT,DECISION,ITERATE', 'michael', 'beaver', '🦫'],
    valentin: ['architect', 'hire-preset', 'ARCHITECT', 'oscar', 'owl', '🦉'],
    'el-beni': ['builder', 'hire-preset', 'BUILD', 'jim', 'cat', '🐱'],
    margarito: ['tester', 'hire-preset', 'TEST', 'dwight', 'hamster', '🐹'],
    'jose-juan': ['auditor', 'hire-preset', 'AUDIT', 'angela', 'turtle', '🐢'],
    'el-tutu': ['learner', 'hire-preset', 'LEARN,DECISION', 'kevin', 'rabbit', '🐰'],
    alicia: ['companion', 'capability', '', undefined, 'fox', '🦊']
  };
  for (const [id, [role, runtime, phases, character, species, emoji]] of Object.entries(expected)) {
    const a = agents.LA_PITAYA_AGENT_BY_ID[id];
    assert.deepEqual([a.role, a.runtime, a.cimaPhases.join(','), a.character, ANIMAL_AVATAR_REGISTRY[id].species, ANIMAL_AVATAR_REGISTRY[id].emoji],
      [role, runtime, phases, character, species, emoji], id);
    assert.equal(a.seniority, undefined, `${id} gained no seniority`);
    assert.equal(a.title, undefined, `${id} gained no title`);
  }
  // Existing companions keep their default seats (positions are persisted per agent).
  const p = new DesktopPresenceService({ browserWindowFactory: (o) => new MockBrowserWindow(o) });
  assert.deepEqual(['alicia', 'el-beni', 'margarito', 'jose-juan', 'el-inge', 'valentin', 'el-tutu'].map((id) => p.getPosition(id).x),
    [100, 400, 700, 1000, 1300, 1600, 1900]);
});

test('ROS-32: FASE 2.2 behaviour stays compatible (no resolver → phase default owner)', async (t) => {
  const r = await rig(t, { resolver: false });
  r.presence.setMode('FOCUS');
  r.spawn('worker-ros1', { taskId: 'LP-ROS-32', phase: 'BUILD' });
  assert.deepEqual(r.shown(), [['el-beni', 'WORKING']]);
  assert.equal(r.entry('el-beni').bubble.text, 'El Beni está construyendo.');
  r.spawn('worker-marg1', { taskId: 'LP-ROS-32', phase: 'TEST' });
  assert.deepEqual(r.shown(), [['margarito', 'WORKING']]);
});

test('ROS-33: Builder != Auditor remains enforced across the senior flow', async (t) => {
  const r = await rig(t);
  assert.equal((await rosalbaBuildPass(r, 'LP-ROS-33')).verdict, 'PASS');
  r.spawn('worker-marg1', { taskId: 'LP-ROS-33', phase: 'TEST' });
  await r.ran('worker-marg1', 'node --test test/feature.test.cjs', 'ℹ pass 4');
  assert.equal(r.send('worker-marg1', { taskId: 'LP-ROS-33', phase: 'TEST', verdict: 'PASS', evidence: [{ type: 'test-result', source: 'node --test test/feature.test.cjs' }] }).verdict, 'PASS');
  // Rosalba still cannot audit the task she built …
  await r.ran('worker-ros1', 'git diff', 'diff --git a/src/feature.cjs');
  assert.ok(r.send('worker-ros1', { taskId: 'LP-ROS-33', phase: 'AUDIT', verdict: 'PASS', evidence: [{ type: 'diff', source: 'git diff' }] }).violations.includes('BUILDER_NOT_AUDITOR'));
  // … while the independent auditor passes it.
  r.spawn('worker-jj1', { taskId: 'LP-ROS-33', phase: 'AUDIT' });
  await r.ran('worker-jj1', 'git diff', 'diff --git a/src/feature.cjs');
  assert.equal(r.send('worker-jj1', { taskId: 'LP-ROS-33', phase: 'AUDIT', verdict: 'PASS', evidence: [{ type: 'diff', source: 'git diff' }] }).verdict, 'PASS');
  assert.equal(r.presence.getAgentState('jose-juan'), 'CELEBRATING');
});

test('ROS-34: an unknown or non-owning agent fails closed to the FASE 2.2 owner', async (t) => {
  const r = await rig(t);
  r.presence.setMode('FOCUS');
  r.spawn('worker-x1', { taskId: 'LP-ROS-34', phase: 'BUILD' }); // a worker named "Somebody Else"
  assert.deepEqual(r.shown(), [['el-beni', 'WORKING']]);
  // A resolver answer that does not own the phase is ignored (no cross-phase spoofing).
  const ev = { type: 'cima.phase.assigned', ts: 1, source: 'cima-runtime', taskId: 'T', phase: 'BUILD', agentId: 'w' };
  assert.deepEqual(companionFactsFromAliciaEvent(ev, () => 'margarito'), [{ fact: 'BUILD_STARTED' }]);
  assert.deepEqual(companionFactsFromAliciaEvent(ev, () => { throw new Error('registry gone'); }), [{ fact: 'BUILD_STARTED' }]);
  // An agent id outside the roster is ignored by the presence too.
  const p = new DesktopPresenceService({ browserWindowFactory: (o) => new MockBrowserWindow(o), timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  assert.equal(p.triggerVerifiedRuntimeFact('BUILD_STARTED', { agent: 'senior-dev' }), true);
  assert.equal(p.getAgentState('el-beni'), 'WORKING');
  assert.equal(p.triggerVerifiedRuntimeFact('ROSALBA_APPROVED', { agent: 'rosalba' }), false, 'unknown facts are still rejected');
});

test('ROS-36: Rosalba\'s companion position is saved and restored like every other companion', () => {
  const kv = new Map();
  const persist = { getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, v) };
  const mk = () => new DesktopPresenceService({ persist, browserWindowFactory: (o) => new MockBrowserWindow(o), timers: { setTimeout: () => 0, clearTimeout: () => {} } });
  const a = mk();
  assert.deepEqual(a.getPosition('rosalba'), { x: 2200, y: 100 }, 'her own staggered default seat, after the existing seven');
  a.savePosition('rosalba', { x: 520, y: 260 });
  assert.deepEqual(mk().getPosition('rosalba'), { x: 520, y: 260 }, 'restored after a restart');
  // the seat list is the canonical roster (no second hand-kept array)
  assert.match(code('src/main/desktopPresence.ts'), /const ALL_AGENTS: readonly LaPitayaAgentId\[\] = LA_PITAYA_AGENTS\.map\(\(a\) => a\.id\);/);
});

test('ROS-35: Rosalba cannot mutate the policy / capability registry at runtime', async (t) => {
  assert.ok(Object.isFrozen(DEFAULT_POLICY));
  assert.throws(() => { DEFAULT_POLICY.capabilities.push({ id: 'rosalba.approve' }); });
  assert.ok(!JSON.stringify(DEFAULT_POLICY).toLowerCase().includes('rosalba'), 'no Rosalba-specific capability');
  assert.ok(POLICY_REGISTRY);
  const r = await rig(t);
  const target = path.join(ROOT, 'src', 'shared', 'lapitaya', 'policyRegistry.ts');
  const res = await r.pre('worker-ros1', 'Edit', { file_path: target, old_string: 'HIGH', new_string: 'LOW' });
  assert.equal(r.denied(res), true, 'writing the policy is governance-tamper');
  const g = r.ledger().filter((e) => e.kind === 'governance' && e.agentId === 'worker-ros1').pop();
  assert.equal(g.risk, 'HIGH');
  assert.equal(g.category, 'governance-tamper');
});
