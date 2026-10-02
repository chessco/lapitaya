'use strict';
/**
 * Desktop Companions FASE 2 remediation — real Electron + real runtime validation.
 *
 * Run from the repo root, after `npm run build`, with ELECTRON_RUN_AS_NODE unset:
 *   node_modules\.bin\electron evidence\lapitaya-desktop-companions-fase2-remediation\electron\real_runtime_companions.cjs
 *
 * REAL: the Electron main process; the real CimaRuntimeService (sandbox hive in a temp dir, its own seal key) producing
 * its own events through onEvent; the real fromRuntimeEvent adapter; the real DesktopPresenceService with real
 * transparent BrowserWindows loading the BUILT renderer (out/renderer) through the BUILT companion preload
 * (out/preload/companionPreload.js); real commands executed and recorded as traces through the runtime's own
 * authorize()/recordTrace() (the calls the PreToolUse/PostToolUse hooks make); real CIMA claims through handle();
 * a real HIGH-risk authorization (never executed) raising a real HUMAN_APPROVAL_REQUIRED; a real REQUEST proposal
 * through the real IntentBoundary.
 * NOT REAL: src/main/index.ts itself (its one-line wiring `fromRuntimeEvent → observeAliciaEvents` is reproduced);
 * no agent CLI runs (the harness plays the agents' tool calls); no human decision is forged — the approval stays
 * pending (resolution is covered by COMP-67 with the runtime's real approval-decided payload shape).
 * Nothing here touches the user's hive, config or governance state: everything lives in a temp dir.
 */
const { app, BrowserWindow } = require('electron');
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-companions-fase2-'));
app.setPath('userData', path.join(tmp, 'userData'));
app.on('window-all-closed', () => { /* explicit quit */ });

const loadTs = require(path.join(ROOT, 'test', 'load-ts.cjs'));
const results = [];
const timeline = [];
const consoleErrors = [];
const check = (id, desc, pass, detail) => results.push({ id, desc, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail ?? '') });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
  const { IntentBoundary } = loadTs('src/main/intentBoundary.ts');
  const { fromRuntimeEvent } = loadTs('src/shared/lapitaya/alicia/events.ts');
  const { createAliciaIntent } = loadTs('src/shared/lapitaya/alicia/intent.ts');
  const { DesktopPresenceService } = loadTs('src/main/desktopPresence.ts');

  const hiveRoot = path.join(tmp, 'hive');
  const cwd = path.join(tmp, 'project');
  fs.mkdirSync(hiveRoot, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  const key = crypto.randomBytes(32);
  const agents = { god: 'El Inge', 'beni-1': 'El Beni', 'marga-1': 'Margarito', 'jj-1': 'José Juan' };
  const phaseOf = { god: 'CONTEXT', 'beni-1': 'BUILD', 'marga-1': 'TEST', 'jj-1': 'AUDIT' };

  let presence = null;
  const runtimeEvents = [];
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hiveRoot,
    godId: () => 'god',
    sealKey: () => key,
    cwdOf: () => cwd,
    providerOf: () => 'claude',
    phaseOf: (id) => phaseOf[id] ?? null,
    taskOf: () => 'T-COMP-1',
    // Reproduces src/main/index.ts: fromRuntimeEvent → (alicia().notify) → desktopPresence.observeAliciaEvents.
    onEvent: (e) => {
      const evs = fromRuntimeEvent(e, Date.now());
      runtimeEvents.push({ type: e.type, alicia: evs.map((x) => x.type) });
      try { presence?.observeAliciaEvents(evs); } catch (err) { consoleErrors.push(`observe: ${err}`); }
    }
  });

  presence = new DesktopPresenceService({
    preloadPath: path.join(ROOT, 'out', 'preload', 'companionPreload.js'),
    devServerUrl: pathToFileURL(path.join(ROOT, 'out', 'renderer', 'index.html')).href,
    mainWindowGetter: () => null
  });

  const windows = () => presence.windows; // runtime access for evidence only
  const hookConsole = (win, id) => {
    if (win.__hooked) return;
    win.__hooked = true;
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) consoleErrors.push(`[${id}] ${message}`); });
  };

  const snap = async (label) => {
    await sleep(900);
    const p = presence.getPresentation();
    const row = { label, mode: p.mode, entries: p.entries.map((e) => ({ id: e.agentId, state: e.visualState, relayedFrom: e.relayedFrom ?? null, bubble: e.bubble ? { kind: e.bubble.kind, sourceFact: e.bubble.sourceFact ?? null, text: e.bubble.text } : null })) };
    const shots = [];
    for (const [id, win] of windows()) {
      if (win.isDestroyed() || !win.isVisible()) continue;
      hookConsole(win, id);
      const img = await win.webContents.capturePage();
      const file = `${String(timeline.length + 1).padStart(2, '0')}-${label}-${id}.png`;
      fs.writeFileSync(path.join(SHOTS, file), img.toPNG());
      const bmp = img.toBitmap(); const size = img.getSize();
      const alphaAt = (x, y) => bmp[(y * size.width + x) * 4 + 3];
      shots.push({ id, file, size, cornerAlpha: alphaAt(2, 2), bounds: win.getBounds() });
    }
    row.windows = shots;
    timeline.push(row);
    return row;
  };
  const stateOf = (row, id) => row.entries.find((e) => e.id === id)?.state ?? null;

  /** An agent runs a real command: PreToolUse authorize → execute → PostToolUse trace. */
  const runCommand = (agentId, command) => {
    const auth = lapitaya.authorize(agentId, 'Bash', { command });
    let out = '';
    let ok = false;
    if (auth.decision === 'ALLOW' || auth.decision === 'SUPERVISED') {
      try { out = execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 }); ok = true; } catch (e) { out = String(e.stdout || e.message); }
      lapitaya.recordTrace(agentId, ok ? 'PostToolUse' : 'PostToolUseFailure', 'Bash', { command }, { stdout: out.slice(-4000) });
    }
    return { decision: auth.decision, rule: auth.rule, ok, tail: out.trim().split('\n').slice(-3).join(' | ') };
  };
  const claim = (agentId, phase, command, verdict = 'PASS') =>
    lapitaya.handle(agentId, 'god', {
      taskId: 'T-COMP-1', phase, verdict,
      evidence: [{ type: phase === 'TEST' ? 'test-result' : 'command-output', source: command, description: `${phase} run`, result: verdict }]
    }, `msg-${phase}-${verdict}`);

  try {
    presence.show('COMPANY');
    await sleep(2500);
    const r0 = await snap('startup-company');
    check('R1', 'COMPANY: three separate transparent companion windows render (Alicia + two companions)',
      r0.windows.length === 3 && r0.windows.every((w) => w.cornerAlpha === 0), r0.windows.map((w) => `${w.id}:alpha=${w.cornerAlpha}`).join(', '));

    // ── BUILD ── El Beni
    lapitaya.handle('god', 'beni-1', { taskId: 'T-COMP-1', phase: 'BUILD' }, 'msg-assign-build');
    const r1 = await snap('build-started');
    check('R2', 'real BUILD assignment → El Beni WORKING (Alicia untouched)', stateOf(r1, 'el-beni') === 'WORKING' && stateOf(r1, 'alicia') === 'IDLE', r1.entries);
    const buildCmd = 'node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json';
    const build = runCommand('beni-1', buildCmd);
    const buildRec = claim('beni-1', 'BUILD', buildCmd);
    const r2 = await snap('build-completed');
    check('R3', 'real BUILD PASS (verified evidence) → Alicia CELEBRATING, El Beni released',
      buildRec.verdict === 'PASS' && buildRec.violations.length === 0 && stateOf(r2, 'alicia') === 'CELEBRATING' && stateOf(r2, 'el-beni') === 'IDLE',
      { build, verdict: buildRec.verdict, violations: buildRec.violations, alicia: stateOf(r2, 'alicia'), beni: stateOf(r2, 'el-beni') });

    // ── TEST ── Margarito
    lapitaya.handle('god', 'marga-1', { taskId: 'T-COMP-1', phase: 'TEST' }, 'msg-assign-test');
    const r3 = await snap('test-started');
    check('R4', 'real TEST assignment → Margarito WORKING', stateOf(r3, 'margarito') === 'WORKING', r3.entries);
    const testCmd = 'node --test test/lapitaya-desktop-companions.test.cjs';
    const testRun = runCommand('marga-1', testCmd);
    const testRec = claim('marga-1', 'TEST', testCmd);
    const r4 = await snap('test-completed');
    check('R5', 'real TEST PASS → Margarito CELEBRATING', testRec.verdict === 'PASS' && stateOf(r4, 'margarito') === 'CELEBRATING',
      { testRun, verdict: testRec.verdict, violations: testRec.violations, margarito: stateOf(r4, 'margarito') });

    // ── AUDIT ── José Juan
    lapitaya.handle('god', 'jj-1', { taskId: 'T-COMP-1', phase: 'AUDIT' }, 'msg-assign-audit');
    const r5 = await snap('audit-started');
    check('R6', 'real AUDIT assignment → José Juan WORKING (takes a COMPANY seat)', stateOf(r5, 'jose-juan') === 'WORKING', r5.entries);
    const auditCmd = 'git diff --stat';
    const audit = runCommand('jj-1', auditCmd);
    const auditRec = claim('jj-1', 'AUDIT', auditCmd);
    const r6 = await snap('audit-completed');
    check('R7', 'real AUDIT PASS → José Juan CELEBRATING', auditRec.verdict === 'PASS' && stateOf(r6, 'jose-juan') === 'CELEBRATING',
      { audit, verdict: auditRec.verdict, violations: auditRec.violations, jj: stateOf(r6, 'jose-juan') });

    // ── FOCUS ── follows the phase companion with its real state
    presence.setMode('FOCUS');
    lapitaya.handle('god', 'marga-1', { taskId: 'T-COMP-2', phase: 'TEST' }, 'msg-assign-test-2');
    const r7 = await snap('focus-test');
    check('R8', 'FOCUS shows only the phase companion (Margarito) in its real WORKING state',
      r7.entries.length === 1 && r7.entries[0].id === 'margarito' && r7.entries[0].state === 'WORKING' && r7.windows.length === 1, r7.entries);
    presence.setMode('COMPANY');

    // ── REQUEST_PENDING ── a real REQUEST proposal through the real IntentBoundary
    const boundary = new IntentBoundary({ runtime: lapitaya, orchestratorId: () => 'god', deliver: () => 'msg-delivered' });
    const intent = createAliciaIntent('Por favor implementa la validación del formulario de contacto en src/form.ts', { id: 'int-comp-1', now: Date.now(), taskId: 'T-COMP-3', uiLocale: 'es-MX' });
    const outcome = boundary.submit(intent);
    const r9 = await snap('request-pending');
    const proposed = runtimeEvents.some((e) => e.type === 'request' && e.alicia.includes('request.proposed'));
    check('R9', 'real REQUEST proposal (IntentBoundary → openRequest) → Alicia ATTENTION',
      proposed && stateOf(r9, 'alicia') === 'ATTENTION', { status: outcome.status, route: outcome.route, proposed, alicia: stateOf(r9, 'alicia') });

    const req = lapitaya.listRequests().find((x) => x.status === 'PROPOSED');
    if (req) lapitaya.withdrawRequest(req.id, 'acceptance harness cleanup');
    const r10 = await snap('request-withdrawn');
    check('R10', 'the runtime withdrawing that request (request.closed) clears Alicia\'s ATTENTION',
      !!req && stateOf(r10, 'alicia') !== 'ATTENTION', { req: req?.id, alicia: stateOf(r10, 'alicia'), lastEvents: runtimeEvents.slice(-2) });

    // ── HUMAN_APPROVAL_REQUIRED ── a real HIGH-risk call (never executed)
    const high = lapitaya.authorize('beni-1', 'Bash', { command: 'git push --force origin main' });
    const r8 = await snap('approval-required');
    const pending = lapitaya.listApprovals().filter((a) => a.status === 'pending');
    check('R11', 'real HUMAN_APPROVAL_REQUIRED → Alicia ATTENTION with a sticky runtime-fact bubble',
      high.decision === 'HUMAN_APPROVAL_REQUIRED' && pending.length === 1 && stateOf(r8, 'alicia') === 'ATTENTION' &&
      r8.entries.find((e) => e.id === 'alicia').bubble?.sourceFact === 'HUMAN_APPROVAL_REQUIRED',
      { decision: high.decision, pending: pending.length, alicia: r8.entries.find((e) => e.id === 'alicia') });

    // ── The companion cannot approve: its renderer only has the presentation bridge ──
    const aliciaWin = windows().get('alicia');
    const probe = await aliciaWin.webContents.executeJavaScript(`(() => {
      const b = window.companionBridge;
      const keys = b ? Object.keys(b).sort() : [];
      const forged = ['approve', 'APPROVAL_RESOLVED', { id: ${JSON.stringify(pending[0]?.id ?? '')}, approve: true }];
      for (const k of keys) { if (k === 'hide' || k === 'onSnapshot') continue; for (const f of forged) { try { b[k](f, f, f); } catch (e) {} } }
      return { keys, api: typeof window.api, require: typeof window.require, process: typeof window.process, ipcRenderer: typeof window.ipcRenderer };
    })()`);
    await sleep(600);
    const stillPending = lapitaya.listApprovals().filter((a) => a.status === 'pending').length;
    check('R12', 'companion renderer: presentation-only bridge, no window.api/require/process; forged calls approve nothing',
      JSON.stringify(probe.keys) === JSON.stringify(['dismissBubble', 'drag', 'hide', 'onSnapshot', 'open', 'setInteractive', 'setMode']) &&
      probe.api === 'undefined' && probe.require === 'undefined' && probe.process === 'undefined' && stillPending === 1 &&
      presence.getAgentState('alicia') === 'ATTENTION',
      { probe, stillPending, alicia: presence.getAgentState('alicia') });

    // ── Hide / restore without restarting ──
    presence.hide();
    await sleep(500);
    const hidden = [...windows().values()].every((w) => !w.isVisible());
    presence.restore();
    await sleep(1500);
    const restored = windows().get('alicia').isVisible() && presence.getMode() === 'COMPANY';
    check('R13', 'hide → all companion windows hidden; restore → back in COMPANY, no restart', hidden && restored, { hidden, restored });

    check('R14', 'no renderer console errors in companion windows', consoleErrors.length === 0, consoleErrors.slice(0, 5));
  } catch (e) {
    check('FATAL', 'harness crashed', false, String(e && e.stack || e));
  }

  const pass = results.filter((r) => r.pass).length;
  const summary = `${pass}/${results.length} PASS`;
  fs.writeFileSync(path.join(OUT, 'real_runtime_companions.json'), JSON.stringify({ summary, results, timeline, runtimeEvents, consoleErrors, tmp }, null, 2));
  fs.writeFileSync(path.join(OUT, 'real_runtime_companions.txt'),
    results.map((r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.desc}\n     ${r.detail.slice(0, 600)}`).join('\n') + `\n\n${summary}\n`);
  console.log(summary);
  try { presence.destroy(); } catch { /* ignore */ }
  app.exit(pass === results.length ? 0 : 1);
});
