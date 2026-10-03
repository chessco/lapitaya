'use strict';
/**
 * FASE 2.3 — Rosalba in real Electron with the real runtime.
 *
 * Run from the repo root, after `npm run build`, with ELECTRON_RUN_AS_NODE unset:
 *   node_modules\.bin\electron evidence\lapitaya-rosalba-fase2.3\06-desktop\real_electron_rosalba.cjs
 *
 * REAL: Electron main; a real HiveManager (temp hive) delivering the dispatch exactly as processSpawnRequest
 * does; the real recordSpawnAssignment; the real CimaRuntimeService (own seal key, hash-chained MAC'd ledger);
 * real fromRuntimeEvent; the real DesktopPresenceService with real transparent windows loading the BUILT
 * renderer + preload and the SAME resolver index.ts installs (hive registry name → agentByName); real
 * commands recorded through authorize()/recordTrace(); real CIMA claims through handle(); real input events
 * (sendInputEvent) for click / hover. NOT REAL: index.ts itself (its wiring is reproduced) and no agent CLI.
 */
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = __dirname;
const SHOTS = path.join(OUT, 'captures');
fs.mkdirSync(SHOTS, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-rosalba-electron-'));
app.setPath('userData', path.join(tmp, 'userData'));
app.on('window-all-closed', () => { /* explicit quit */ });

const loadTs = require(path.join(ROOT, 'test', 'load-ts.cjs'));
const results = []; const timeline = []; const consoleErrors = [];
const check = (id, desc, pass, detail) => results.push({ id, desc, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail ?? '') });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
  const { HiveManager } = loadTs('src/main/hive.ts');
  const { fromRuntimeEvent } = loadTs('src/shared/lapitaya/alicia/events.ts');
  const { DesktopPresenceService } = loadTs('src/main/desktopPresence.ts');
  const { recordSpawnAssignment } = loadTs('src/main/spawnAssignment.ts');
  const { agentByName } = loadTs('src/shared/lapitaya/agents.ts');

  const home = path.join(tmp, 'home'); fs.mkdirSync(home, { recursive: true });
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  const key = crypto.randomBytes(32);
  const kv = new Map();
  const persist = { getKv: (k) => kv.get(k), setKv: (k, v) => kv.set(k, JSON.parse(JSON.stringify(v))) };
  let presence = null; const runtimeEvents = [];
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hive.root(), godId: () => 'god', sealKey: () => key, cwdOf: () => home, providerOf: () => 'claude',
    onEvent: (e) => { const evs = fromRuntimeEvent(e, Date.now()); runtimeEvents.push({ type: e.type, kind: e.data?.kind, alicia: evs.map((x) => x.type) }); try { presence?.observeAliciaEvents(evs); } catch (err) { consoleErrors.push(String(err)); } }
  });
  hive.setCimaHandler((from, cima, id, to) => { lapitaya.handle(from, to, cima, id); return null; });
  const ignoreCalls = [];
  const mkPresence = () => new DesktopPresenceService({
    persist,
    preloadPath: path.join(ROOT, 'out', 'preload', 'companionPreload.js'),
    devServerUrl: pathToFileURL(path.join(ROOT, 'out', 'renderer', 'index.html')).href,
    mainWindowGetter: () => null,
    // exactly what src/main/index.ts installs
    resolveAgent: (hiveAgentId) => agentByName(hive.registry().agents[hiveAgentId]?.name)?.id ?? null
  });
  presence = mkPresence();

  const winOf = (id) => presence.windows.get(id);
  const hook = (id) => {
    const win = winOf(id);
    if (!win || win.__hooked) return;
    win.__hooked = true;
    win.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) consoleErrors.push(`[${id}] ${msg}`); });
    const orig = win.setIgnoreMouseEvents.bind(win);
    win.setIgnoreMouseEvents = (ignore, opts) => { ignoreCalls.push({ id, ignore }); return orig(ignore, opts); };
  };
  const dom = (id, js) => winOf(id).webContents.executeJavaScript(js);
  const snap = async (label) => {
    await sleep(1200);
    const p = presence.getPresentation();
    const row = { label, mode: p.mode, entries: p.entries.map((e) => ({ id: e.agentId, state: e.visualState, species: e.species, bubble: e.bubble ? { sourceFact: e.bubble.sourceFact ?? null, text: e.bubble.text } : null })), shots: [] };
    for (const [id, win] of presence.windows) {
      if (win.isDestroyed() || !win.isVisible()) continue;
      hook(id);
      const img = await win.webContents.capturePage();
      const file = `${String(timeline.length + 1).padStart(2, '0')}-${label}-${id}.png`;
      fs.writeFileSync(path.join(SHOTS, file), img.toPNG()); row.shots.push(file);
    }
    timeline.push(row); return row;
  };
  const st = (row, id) => row.entries.find((e) => e.id === id)?.state ?? null;
  const bub = (row, id) => row.entries.find((e) => e.id === id)?.bubble ?? null;

  const spawn = async (reqId, name, cima) => {
    const workerId = `worker-${reqId}`;
    await hive.ensureAgent({ id: workerId, name, provider: 'claude', cwd: home });
    const dispatched = hive.send({ to: workerId, conversation: `worker-${reqId}`, act: 'request', subject: name, body: `[AUTONOMOUS WORKER TASK] ${name} objective` }, 'god');
    const res = recordSpawnAssignment({ runtime: lapitaya, from: 'god', to: workerId, cima, messageId: dispatched.id });
    return { workerId, messageId: dispatched.id, res };
  };
  const run = (agentId, command) => {
    lapitaya.authorize(agentId, 'Bash', { command });
    let out = ''; let ok = false;
    try { out = execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); ok = true; } catch (e) { out = String(e.stdout || e.message); }
    lapitaya.recordTrace(agentId, ok ? 'PostToolUse' : 'PostToolUseFailure', 'Bash', { command }, { stdout: out.slice(-2000) });
    return ok;
  };
  const claim = (agentId, taskId, phase, verdict, source) => lapitaya.handle(agentId, 'god', { taskId, phase, verdict, evidence: source ? [{ type: phase === 'TEST' ? 'test-result' : 'command-output', source, result: verdict }] : [] }, `msg-${taskId}-${phase}-${verdict}-${agentId}`);

  try {
    presence.show('COMPANY');
    await sleep(2500);

    // ── R1: real spawn → assignment → Rosalba WORKING, as a dog, with her title ──
    const ros = await spawn('ros1', 'Rosalba', { taskId: 'LP-ROS-E1', phase: 'BUILD' });
    const r1 = await snap('rosalba-build-assigned');
    const w = winOf('rosalba');
    const look = await dom('rosalba', `(() => {
      const q = (r) => document.querySelector('[data-companion-role="' + r + '"]');
      const bg = (el) => getComputedStyle(el).backgroundColor;
      return { name: q('identity-name')?.textContent, subtitle: q('identity-subtitle')?.textContent,
        avatar: q('avatar')?.textContent, bubble: q('bubble')?.textContent,
        htmlBg: bg(document.documentElement), bodyBg: bg(document.body), lang: document.documentElement.lang };
    })()`);
    check('E1', 'real spawn "Rosalba" + BUILD → cima-assignment → Rosalba WORKING (El Beni untouched)',
      ros.res.recorded && st(r1, 'rosalba') === 'WORKING' && st(r1, 'el-beni') === 'IDLE' && bub(r1, 'rosalba')?.text === 'Rosalba está construyendo.', { res: ros.res, entries: r1.entries });
    check('E2', 'the window shows 🐶 Rosalba · Desarrolladora Senior',
      look.name === 'Rosalba' && /🐶/.test(look.avatar ?? '') && look.subtitle === 'Desarrolladora Senior', look);
    check('E3', 'transparent, frameless, no opaque panel (window + page background)',
      w.isVisible() && /rgba\(0, 0, 0, 0\)|transparent/.test(look.htmlBg) && /rgba\(0, 0, 0, 0\)|transparent/.test(look.bodyBg), { htmlBg: look.htmlBg, bodyBg: look.bodyBg, bg: w.getBackgroundColor() });
    check('E4', 'speech bubble shows the verified fact', /Rosalba está construyendo/.test(look.bubble ?? ''), look.bubble);
    const wp = w.webContents.getLastWebPreferences ? w.webContents.getLastWebPreferences() : {};
    check('E5', 'sandbox + contextIsolation, no nodeIntegration', wp.sandbox === true && wp.contextIsolation === true && wp.nodeIntegration === false, { sandbox: wp.sandbox, contextIsolation: wp.contextIsolation, nodeIntegration: wp.nodeIntegration });

    // ── R2: click-through until the pointer is on her; click opens her menu ──
    const rect = await dom('rosalba', `(() => { const r = document.querySelector('[data-companion-role="avatar"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    hook('rosalba');
    w.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
    await sleep(200);
    w.webContents.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
    await sleep(400);
    w.webContents.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    w.webContents.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await sleep(600);
    const menu = await dom('rosalba', `!!document.querySelector('[data-companion-role="menu"]')`);
    const shotMenu = await w.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, 'click-menu-rosalba.png'), shotMenu.toPNG());
    check('E6', 'click on Rosalba opens her menu', menu === true, { rect });
    check('E7', 'click-through: the window becomes interactive only over the creature', ignoreCalls.some((c) => c.id === 'rosalba' && c.ignore === false), ignoreCalls.filter((c) => c.id === 'rosalba'));

    // ── R3: drag (main-process move) + position persistence across a restart ──
    presence.moveCompanion('rosalba', { x: 520, y: 260 });
    await sleep(300);
    const b = w.getBounds();
    presence.savePosition('rosalba', { x: b.x, y: b.y });
    const saved = presence.getPosition('rosalba');
    check('E8', 'drag moves the window and keeps its size', b.x === 520 && b.y === 260 && b.width === 340 && b.height === 340, b);

    // ── R4: hide / restore ──
    presence.hide();
    await sleep(400);
    const hidden = !w.isVisible();
    presence.restore();
    await sleep(1200);
    check('E9', 'hide hides Rosalba; restore brings her back', hidden && winOf('rosalba').isVisible(), { hidden, visible: winOf('rosalba').isVisible() });

    // ── R5: Rosalba BUILD PASS → existing success semantics ──
    run(ros.workerId, 'node --version');
    const bp = claim(ros.workerId, 'LP-ROS-E1', 'BUILD', 'PASS', 'node --version');
    const r5 = await snap('rosalba-build-pass');
    check('E10', 'Rosalba BUILD PASS → Alicia CELEBRATING, Rosalba released', bp.verdict === 'PASS' && st(r5, 'alicia') === 'CELEBRATING' && st(r5, 'rosalba') === 'IDLE', { verdict: bp.verdict, entries: r5.entries });

    // ── R6: TEST (Margarito) → Rosalba cannot audit → AUDIT (José Juan) ──
    const mt = await spawn('marg1', 'Margarito', { taskId: 'LP-ROS-E1', phase: 'TEST' });
    run(mt.workerId, 'node --test test/lapitaya-foundation.test.cjs');
    const tp = claim(mt.workerId, 'LP-ROS-E1', 'TEST', 'PASS', 'node --test test/lapitaya-foundation.test.cjs');
    run(ros.workerId, 'git diff --stat');
    const self = claim(ros.workerId, 'LP-ROS-E1', 'AUDIT', 'PASS', 'git diff --stat');
    const jj = await spawn('jj1', 'José Juan', { taskId: 'LP-ROS-E1', phase: 'AUDIT' });
    run(jj.workerId, 'git diff --stat');
    const ap = claim(jj.workerId, 'LP-ROS-E1', 'AUDIT', 'PASS', 'git diff --stat');
    const r6 = await snap('test-audit');
    check('E11', 'Margarito TEST PASS; Rosalba self-AUDIT refused (BUILDER_NOT_AUDITOR); José Juan AUDIT PASS',
      tp.verdict === 'PASS' && self.verdict === 'BLOCKED' && self.violations.includes('BUILDER_NOT_AUDITOR') && ap.verdict === 'PASS',
      { test: tp.verdict, self: [self.verdict, self.violations], audit: [ap.verdict, ap.violations], entries: r6.entries });

    // ── R7: FOCUS follows assignment.agent, not the phase ──
    presence.setMode('FOCUS');
    await spawn('beni1', 'El Beni', { taskId: 'LP-ROS-E2', phase: 'BUILD' });
    const f1 = await snap('focus-elbeni-build');
    await spawn('ros2', 'Rosalba', { taskId: 'LP-ROS-E3', phase: 'BUILD' });
    const f2 = await snap('focus-rosalba-build');
    check('E12', 'FOCUS + El Beni BUILD → El Beni; FOCUS + Rosalba BUILD → only Rosalba WORKING',
      f1.entries.length === 1 && f1.entries[0].id === 'el-beni' && f2.entries.length === 1 && f2.entries[0].id === 'rosalba' && f2.entries[0].state === 'WORKING' && winOf('rosalba').isVisible() && !winOf('el-beni').isVisible(),
      { f1: f1.entries, f2: f2.entries });

    // ── R8: COMPANY ≤ 3, independent states ──
    presence.setMode('COMPANY');
    await spawn('marg2', 'Margarito', { taskId: 'LP-ROS-E4', phase: 'TEST' });
    const c = await snap('company');
    check('E13', 'COMPANY ≤ 3 with independent states (Rosalba WORKING next to others)',
      c.entries.length <= 3 && c.entries.some((e) => e.id === 'rosalba' && e.state === 'WORKING'), c.entries);

    // ── R9: position persists across a restart of the presence service ──
    try { presence.destroy(); } catch { /* ignore */ }
    presence = mkPresence();
    check('E14', 'Rosalba\'s position persists across a restart', JSON.stringify(presence.getPosition('rosalba')) === JSON.stringify(saved), { saved, restored: presence.getPosition('rosalba') });

    // ── integrity ──
    const ledger = fs.readFileSync(path.join(hive.root(), 'lapitaya', 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const ra = ledger.filter((e) => e.kind === 'cima-assignment' && /^worker-ros/.test(e.to));
    const health = lapitaya.verifyGovernanceState({ full: true });
    check('E15', 'Rosalba assignments are chained + MAC\'d; ledger HEALTHY',
      ra.length === 2 && ra.every((a) => a.eventId && a.sequence && a.eventHash && a.eventMac && a.previousEventHash && a.from === 'god' && a.messageId) && health.status === 'HEALTHY',
      { rosalbaAssignments: ra.map((a) => ({ eventId: a.eventId, sequence: a.sequence, to: a.to, phase: a.phase, taskId: a.taskId, hash: !!a.eventHash, mac: !!a.eventMac })), health: health.status });
    check('E16', 'no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5));
  } catch (e) {
    check('FATAL', 'harness crashed', false, String(e && e.stack || e));
  }

  const pass = results.filter((r) => r.pass).length;
  const summary = `${pass}/${results.length} PASS`;
  fs.writeFileSync(path.join(OUT, 'real_electron_rosalba.json'), JSON.stringify({ summary, results, timeline, runtimeEvents, consoleErrors }, null, 2));
  fs.writeFileSync(path.join(OUT, 'real_electron_rosalba.txt'), results.map((r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.desc}\n     ${r.detail.slice(0, 600)}`).join('\n') + `\n\n${summary}\n`);
  console.log(summary);
  try { presence.destroy(); } catch { /* ignore */ }
  app.exit(pass === results.length ? 0 : 1);
});
