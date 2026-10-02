'use strict';
/**
 * Desktop Companions FASE 2.2 — real Electron + real runtime: spawn assignment & verdict semantics.
 *
 * Run from the repo root, after `npm run build`, with ELECTRON_RUN_AS_NODE unset:
 *   node_modules\.bin\electron evidence\lapitaya-desktop-companions-fase2.2\electron\real_runtime_assignment.cjs
 *
 * REAL: Electron main; a real HiveManager (temp hive) delivering the dispatch message exactly as
 * processSpawnRequest does (`hive.send(..., 'god')`); the real recordSpawnAssignment called with that
 * message id; the real CimaRuntimeService (own seal key) recording the assignment in its hash-chained
 * ledger and emitting it; real fromRuntimeEvent; the real DesktopPresenceService with real transparent
 * windows loading the BUILT renderer + preload; real commands recorded through authorize()/recordTrace();
 * real CIMA claims through handle(). The chain is verified with verifyGovernanceState({ full: true }).
 * NOT REAL: index.ts itself (its 3-line wiring is reproduced); no agent CLI (the live gate covers that).
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-companions-fase22-'));
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

  const home = path.join(tmp, 'home'); fs.mkdirSync(home, { recursive: true });
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  const key = crypto.randomBytes(32);
  let presence = null; const runtimeEvents = [];
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hive.root(), godId: () => 'god', sealKey: () => key, cwdOf: () => home, providerOf: () => 'claude',
    onEvent: (e) => { const evs = fromRuntimeEvent(e, Date.now()); runtimeEvents.push({ type: e.type, kind: e.data?.kind, alicia: evs.map((x) => x.type) }); try { presence?.observeAliciaEvents(evs); } catch (err) { consoleErrors.push(String(err)); } }
  });
  hive.setCimaHandler((from, cima, id, to) => { lapitaya.handle(from, to, cima, id); return null; });
  presence = new DesktopPresenceService({
    preloadPath: path.join(ROOT, 'out', 'preload', 'companionPreload.js'),
    devServerUrl: pathToFileURL(path.join(ROOT, 'out', 'renderer', 'index.html')).href,
    mainWindowGetter: () => null
  });

  const snap = async (label) => {
    await sleep(900);
    const p = presence.getPresentation();
    const row = { label, mode: p.mode, entries: p.entries.map((e) => ({ id: e.agentId, state: e.visualState, bubble: e.bubble ? { kind: e.bubble.kind, sourceFact: e.bubble.sourceFact ?? null, text: e.bubble.text } : null })), shots: [] };
    for (const [id, win] of presence.windows) {
      if (win.isDestroyed() || !win.isVisible()) continue;
      if (!win.__hooked) { win.__hooked = true; win.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) consoleErrors.push(`[${id}] ${msg}`); }); }
      const img = await win.webContents.capturePage();
      const file = `${String(timeline.length + 1).padStart(2, '0')}-${label}-${id}.png`;
      fs.writeFileSync(path.join(SHOTS, file), img.toPNG()); row.shots.push(file);
    }
    timeline.push(row); return row;
  };
  const st = (row, id) => row.entries.find((e) => e.id === id)?.state ?? null;
  const bub = (row, id) => row.entries.find((e) => e.id === id)?.bubble ?? null;

  /** processSpawnRequest, reproduced: dispatch the objective, then record the request's `cima`. */
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
  const claim = (agentId, taskId, phase, verdict, source) => lapitaya.handle(agentId, 'god', { taskId, phase, verdict, evidence: source ? [{ type: phase === 'TEST' ? 'test-result' : 'command-output', source, result: verdict }] : [] }, `msg-${taskId}-${phase}-${verdict}`);

  try {
    presence.show('COMPANY');
    await sleep(2500);

    // ── F1: BUILD/TEST/AUDIT assignments from the spawn path ──
    const b = await spawn('build1', 'El Beni', { taskId: 'T-22', phase: 'BUILD' });
    const r1 = await snap('build-assigned');
    check('A1', 'spawn BUILD assignment → recorded by the runtime → El Beni WORKING', b.res.recorded && st(r1, 'el-beni') === 'WORKING' && bub(r1, 'el-beni')?.sourceFact === 'BUILD_STARTED', { res: b.res, beni: st(r1, 'el-beni') });
    run(b.workerId, 'node --version');
    const bp = claim(b.workerId, 'T-22', 'BUILD', 'PASS', 'node --version');
    const r2 = await snap('build-pass');
    check('A2', 'BUILD PASS → Alicia CELEBRATING, El Beni released', bp.verdict === 'PASS' && st(r2, 'alicia') === 'CELEBRATING' && st(r2, 'el-beni') === 'IDLE', { verdict: bp.verdict, violations: bp.violations });

    const tt = await spawn('test1', 'Margarito', { taskId: 'T-22', phase: 'TEST' });
    const r3 = await snap('test-assigned');
    check('A3', 'spawn TEST assignment → Margarito WORKING', tt.res.recorded && st(r3, 'margarito') === 'WORKING', { res: tt.res, margarito: st(r3, 'margarito') });
    run(tt.workerId, 'node --test test/lapitaya-foundation.test.cjs');
    const tp = claim(tt.workerId, 'T-22', 'TEST', 'PASS', 'node --test test/lapitaya-foundation.test.cjs');
    const r4 = await snap('test-pass');
    check('A4', 'TEST PASS → Margarito CELEBRATING', tp.verdict === 'PASS' && st(r4, 'margarito') === 'CELEBRATING', { verdict: tp.verdict, violations: tp.violations });

    const au = await spawn('audit1', 'José Juan', { taskId: 'T-22', phase: 'AUDIT' });
    const r5 = await snap('audit-assigned');
    check('A5', 'spawn AUDIT assignment → José Juan WORKING; Margarito untouched', au.res.recorded && st(r5, 'jose-juan') === 'WORKING' && st(r5, 'margarito') === 'CELEBRATING', r5.entries);
    run(au.workerId, 'git diff --stat');
    const ap = claim(au.workerId, 'T-22', 'AUDIT', 'PASS', 'git diff --stat');
    const r6 = await snap('audit-pass');
    check('A6', 'AUDIT PASS → José Juan CELEBRATING', ap.verdict === 'PASS' && st(r6, 'jose-juan') === 'CELEBRATING', { verdict: ap.verdict, violations: ap.violations });

    // ── FOCUS follows the assignment ──
    presence.setMode('FOCUS');
    const t2 = await spawn('test2', 'Margarito', { taskId: 'T-23', phase: 'TEST' });
    const r7 = await snap('focus-test-assigned');
    check('A7', 'FOCUS + TEST assignment → only Margarito, WORKING (before any completion)', t2.res.recorded && r7.entries.length === 1 && r7.entries[0].id === 'margarito' && r7.entries[0].state === 'WORKING', r7.entries);

    // ── F2: PASS ≠ FAIL ≠ BLOCKED ──
    presence.setMode('COMPANY');
    run(t2.workerId, 'node -e "process.exit(1)"');
    const tf = claim(t2.workerId, 'T-23', 'TEST', 'FAIL', 'node -e "process.exit(1)"');
    const r8 = await snap('test-fail');
    check('A8', 'TEST FAIL → Margarito CONCERNED with failure text', tf.verdict === 'FAIL' && st(r8, 'margarito') === 'CONCERNED' && /no pasaron/.test(bub(r8, 'margarito')?.text ?? ''), { verdict: tf.verdict, violations: tf.violations, b: bub(r8, 'margarito') });

    const b3 = await spawn('build3', 'El Beni', { taskId: 'T-24', phase: 'BUILD' });
    const bb = claim(b3.workerId, 'T-24', 'BUILD', 'BLOCKED', '');
    const r9 = await snap('build-blocked');
    const bt = bub(r9, 'el-beni');
    check('A9', 'BUILD BLOCKED → El Beni PAUSED, BLOCKED text, no failure text, not CONCERNED',
      bb.verdict === 'BLOCKED' && st(r9, 'el-beni') === 'PAUSED' && bt?.sourceFact === 'BUILD_BLOCKED' && !/no pas|fall/i.test(bt?.text ?? ''),
      { verdict: bb.verdict, violations: bb.violations, beni: st(r9, 'el-beni'), bubble: bt });
    check('A10', 'PASS, FAIL and BLOCKED render three different states',
      new Set([st(r6, 'jose-juan'), st(r8, 'margarito'), st(r9, 'el-beni')]).size === 3, [st(r6, 'jose-juan'), st(r8, 'margarito'), st(r9, 'el-beni')]);

    // ── claims cannot ride the spawn path ──
    const forged = await spawn('forged', 'El Beni', { taskId: 'T-25', phase: 'BUILD', verdict: 'PASS', evidence: [] });
    const recs = lapitaya.cimaRecords('T-25');
    check('A11', 'a spawn `cima` carrying a verdict is refused, nothing recorded for the task', !forged.res.recorded && forged.res.reason === 'not-an-assignment' && recs.length === 0, { res: forged.res, recs: recs.length });

    // ── integrity ──
    const ledger = fs.readFileSync(path.join(hive.root(), 'lapitaya', 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const assignments = ledger.filter((e) => e.kind === 'cima-assignment');
    const health = lapitaya.verifyGovernanceState({ full: true });
    check('A12', 'assignments are chained, MAC\'d governance events; the ledger verifies HEALTHY',
      assignments.length === 5 && assignments.every((a) => a.eventHash && a.eventMac && a.previousEventHash && a.from === 'god' && a.messageId) && health.status === 'HEALTHY',
      { assignments: assignments.map((a) => `${a.phase}:${a.taskId}:${a.to}`), health: health.status });
    check('A13', 'no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 5));
  } catch (e) {
    check('FATAL', 'harness crashed', false, String(e && e.stack || e));
  }

  const pass = results.filter((r) => r.pass).length;
  const summary = `${pass}/${results.length} PASS`;
  fs.writeFileSync(path.join(OUT, 'real_runtime_assignment.json'), JSON.stringify({ summary, results, timeline, runtimeEvents, consoleErrors }, null, 2));
  fs.writeFileSync(path.join(OUT, 'real_runtime_assignment.txt'), results.map((r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.desc}\n     ${r.detail.slice(0, 500)}`).join('\n') + `\n\n${summary}\n`);
  console.log(summary);
  try { presence.destroy(); } catch { /* ignore */ }
  app.exit(pass === results.length ? 0 : 1);
});
