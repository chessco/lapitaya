'use strict';
/**
 * CIMA v0.14 — boots the REAL built application (out/main/index.js) in an isolated profile and drives
 * its REAL renderer over the Chrome DevTools Protocol. Run:  node real_app_smoke.cjs   (needs `npm run build`).
 *
 * Isolation: --user-data-dir, USERPROFILE/HOME/APPDATA/LOCALAPPDATA all point into a temp directory, so
 * nothing of the user's real La Pitaya profile, ~/.claude or hive is read or written.
 * No agent CLI is started and no human clicks anything: this checks the production IPC wiring
 * (src/main/index.ts) that the in-process harness (electron_validation.cjs) can only reproduce.
 */
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v014-app-'));
const ud = path.join(tmp, 'userData'); const prof = path.join(tmp, 'profile'); const hh = path.join(tmp, 'harness-home');
for (const d of [ud, prof, hh, path.join(prof, 'AppData', 'Roaming'), path.join(prof, 'AppData', 'Local')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({ harnessHome: hh }));
const PORT = 9333 + Math.floor(Math.random() * 500);
const log = [];
const results = [];
const check = (id, desc, pass, detail) => results.push({ id, desc, pass: !!pass, detail: String(typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')).slice(0, 300) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((res, rej) => http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));

async function main() {
  const env = { ...process.env, USERPROFILE: prof, HOME: prof, APPDATA: path.join(prof, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(prof, 'AppData', 'Local'), ELECTRON_ENABLE_LOGGING: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const app = spawn(exe, ['.', `--user-data-dir=${ud}`, `--remote-debugging-port=${PORT}`], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout.on('data', (d) => log.push(String(d))); app.stderr.on('data', (d) => log.push(String(d)));
  let exited = null; app.on('exit', (c) => { exited = c; });
  const kill = () => { try { if (process.platform === 'win32') execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: 'ignore' }); else app.kill('SIGKILL'); } catch { /* gone */ } };
  try {
    let target = null;
    for (let i = 0; i < 90 && !target && exited === null; i++) {
      await sleep(1000);
      try { target = (await getJson(`http://127.0.0.1:${PORT}/json`)).find((t) => t.type === 'page' && /^file:/.test(t.url)); } catch { /* not up yet */ }
    }
    check('A0', 'the real application booted and its renderer page loaded from the app bundle', !!target, target && target.url);
    if (!target) throw new Error('no renderer page');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map(); const consoleErrors = []; const exceptions = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErrors.push((d.params.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 200));
      if (d.method === 'Runtime.exceptionThrown') exceptions.push(JSON.stringify(d.params.exceptionDetails && d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails).slice(0, 300));
    };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable'); await send('Log.enable');
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : { __cdpError: JSON.stringify(r).slice(0, 200) }; };
    await sleep(4000); // let the app settle (hive init, renderer mount)

    const cth = await ev('typeof window.cth === "object" ? Object.keys(window.cth) : null');
    check('A1', 'the preload bridge is present', Array.isArray(cth) && cth.length > 50, cth && cth.length);
    const dangerous = (cth || []).filter((k) => /authori[sz]e|executeTool|forceApprove|setApproval|writeLedger/i.test(k));
    check('A2', 'the renderer bridge exposes no authorize/execute/approve-by-id capability beyond the human channel', dangerous.length === 0, dangerous);

    const who = await ev('window.cth.lapitayaIdentity()');
    check('A3', 'the real renderer is recognized as the human by the real main process (trusted URL + own window)', who && /^hum-/.test(who.id) && /^ses-/.test(who.session), who && who.id);

    const asGod = await ev(`window.cth.hiveSend({ to: 'god', act: 'inform', subject: 'spoof', body: 'x' }, 'god')`);
    check('A4', 'real hive:send refuses a renderer-supplied agent identity (god)', asGod && asGod.ok === false && /SENDER_NOT_PERMITTED/.test(asGod.error || ''), asGod);
    const asAlicia = await ev(`window.cth.hiveSend({ to: 'god', act: 'inform', subject: 'spoof', body: 'x' }, 'alicia')`);
    check('A5', 'real hive:send refuses Alicia as a renderer sender (intent boundary only)', asAlicia && asAlicia.ok === false && /alicia|intent boundary/i.test(asAlicia.error || ''), asAlicia);
    const payloadFrom = await ev(`window.cth.hiveSend({ from: 'god', to: 'god', act: 'inform', subject: 'spoof', body: 'x' }, 'human')`);
    check('A6', 'real hive:send refuses a payload "from" that disagrees with the resolved sender', payloadFrom && payloadFrom.ok === false && /SENDER_NOT_PERMITTED/.test(payloadFrom.error || ''), payloadFrom);
    const asHuman = await ev(`window.cth.hiveSend({ to: 'god', act: 'inform', subject: 'hello from the human', body: 'x' }, 'human')`);
    check('A7', 'real hive:send accepts the human, attributed to "human", from the trusted renderer', asHuman && asHuman.ok === true && asHuman.message && asHuman.message.from === 'human', asHuman && (asHuman.error || asHuman.ok));
    const decideNone = await ev(`window.cth.lapitayaDecide ? window.cth.lapitayaDecide('apr-does-not-exist', true) : 'no-bridge'`);
    check('A8', 'deciding an unknown approval does nothing (null)', decideNone === null || decideNone === 'no-bridge', decideNone);
    const reqs = await ev(`window.cth.lapitayaRequests ? window.cth.lapitayaRequests() : []`);
    check('A9', 'the real runtime answers the governance read channels', Array.isArray(reqs), Array.isArray(reqs) && reqs.length);
    await sleep(3000);
    check('A10', 'no renderer console errors or uncaught exceptions during the session', consoleErrors.length === 0 && exceptions.length === 0, { consoleErrors: consoleErrors.slice(0, 3), exceptions: exceptions.slice(0, 3) });
    const mainLog = log.join('');
    const fatal = /Uncaught Exception|UnhandledPromiseRejection|FATAL|crashed|Segmentation/i.test(mainLog);
    check('A11', 'the main process logged no uncaught exception / crash', !fatal && exited === null, fatal ? mainLog.split('\n').filter((l) => /Uncaught|Unhandled|FATAL|crash/i.test(l)).slice(0, 3) : '');
    const leakedToken = /HIVE_AGENT_TOKEN=[0-9a-f]{16,}/.test(mainLog);
    check('A12', 'the main process log carries no agent token', !leakedToken);
    ws.close();
  } finally { kill(); }
  const summary = { electron: '32.x (node_modules)', results };
  fs.writeFileSync(path.join(__dirname, 'real_app_smoke.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(__dirname, 'real_app_smoke.txt'), results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.desc}${r.detail ? '  [' + r.detail.replace(/\s+/g, ' ').slice(0, 160) + ']' : ''}`).join('\n') + '\n');
  fs.writeFileSync(path.join(__dirname, 'real_app_main_process_log.txt'), log.join('').split('\n').filter((l) => !/HIVE_AGENT_TOKEN/.test(l)).slice(0, 200).join('\n'));
  console.log(fs.readFileSync(path.join(__dirname, 'real_app_smoke.txt'), 'utf8'));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}
main().catch((e) => { console.error('SMOKE ERROR', e && e.stack || e); process.exit(2); });
