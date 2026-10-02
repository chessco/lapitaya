'use strict';
/**
 * CIMA v0.15 — boots the REAL built application (out/main/index.js) twice in isolated profiles and drives its REAL renderer over
 * the Chrome DevTools Protocol:  (1) a healthy hive,  (2) a hive whose ledger was damaged before launch.
 * Run:  node real_app_smoke_v15.cjs   (needs `npm run build`). Nothing of the user's real profile / ~/.claude / hive is touched.
 */
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const results = [];
const check = (id, desc, pass, detail) => results.push({ id, desc, pass: !!pass, detail: String(typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')).slice(0, 300) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url) => new Promise((res, rej) => http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));

async function boot(label, seed) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `lp-v015-app-${label}-`));
  const ud = path.join(tmp, 'userData'); const prof = path.join(tmp, 'profile'); const hh = path.join(tmp, 'harness-home');
  for (const d of [ud, prof, hh, path.join(prof, 'AppData', 'Roaming'), path.join(prof, 'AppData', 'Local')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(ud, 'config.json'), JSON.stringify({ harnessHome: hh }));
  if (seed) seed({ hh, ud });
  const PORT = 9333 + Math.floor(Math.random() * 500);
  const env = { ...process.env, USERPROFILE: prof, HOME: prof, APPDATA: path.join(prof, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(prof, 'AppData', 'Local') };
  delete env.ELECTRON_RUN_AS_NODE;
  const exe = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  const app = spawn(exe, ['.', `--user-data-dir=${ud}`, `--remote-debugging-port=${PORT}`], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = []; app.stdout.on('data', (d) => log.push(String(d))); app.stderr.on('data', (d) => log.push(String(d)));
  let exited = null; app.on('exit', (c) => { exited = c; });
  const kill = () => { try { if (process.platform === 'win32') execSync(`taskkill /PID ${app.pid} /T /F`, { stdio: 'ignore' }); else app.kill('SIGKILL'); } catch { /* gone */ } };
  let target = null;
  for (let i = 0; i < 90 && !target && exited === null; i++) { await sleep(1000); try { target = (await getJson(`http://127.0.0.1:${PORT}/json`)).find((t) => t.type === 'page' && /^file:/.test(t.url)); } catch { /* not yet */ } }
  if (!target) { kill(); throw new Error(`${label}: no renderer page`); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; } if (d.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(d.params.exceptionDetails).slice(0, 200)); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error'); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : { __cdpError: JSON.stringify(r).slice(0, 200) }; };
  await sleep(4000);
  return { tmp, hh, ev, errors, log, kill, close: () => { try { ws.close(); } catch { /* */ } kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } } };
}

async function main() {
  // ── 1. healthy ──
  let a = await boot('healthy');
  try {
    const keys = await a.ev('Object.keys(window.cth)');
    check('H0', 'the real app boots on a fresh healthy hive; the real renderer loads', Array.isArray(keys) && keys.length > 50, keys && keys.length);
    const view = await a.ev('window.cth.lapitayaObservability()');
    check('H1', 'the real main process answers the observability channel with a HEALTHY governance verdict (v0.15 snapshot path)', view && view.health && view.health.status === 'HEALTHY' && view.health.recovery === 'HEALTHY', view && view.health);
    const sent = await a.ev(`window.cth.hiveSend({ to: 'god', act: 'inform', subject: 'hello', body: 'x' }, 'human')`);
    check('H2', 'the human can still send (v0.14 sender authenticity intact)', sent && sent.ok === true, sent && (sent.error || sent.ok));
    const spoof = await a.ev(`window.cth.hiveSend({ to: 'god', act: 'inform', subject: 's', body: 'x' }, 'god')`);
    check('H3', 'a renderer still cannot send as an agent', spoof && spoof.ok === false && /SENDER_NOT_PERMITTED/.test(spoof.error || ''), spoof && spoof.error);
    const ledger = await a.ev('window.cth.lapitayaLedger(50)');
    check('H4', 'the ledger channel never carries a keyed seal (a fresh hive has no events yet; the in-process harness S1 covers a populated ledger)', Array.isArray(ledger) && ledger.every((e) => e.eventMac === undefined), Array.isArray(ledger) && ledger.length);
    check('H5', 'no renderer errors', a.errors.length === 0, a.errors);
  } finally { a.close(); }

  // ── 2. damaged ledger at launch ──
  const seed = ({ hh }) => {
    const dir = path.join(hh, 'hive', 'lapitaya'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cima-ledger.jsonl'), '{"kind":"governance","ts":1,"decision":"ALLOW"}\n{"schemaVersion":2,"eventId":"evt-x","eventType":"X","sequence":1,"previousEventHash":"' + '0'.repeat(64) + '","eventHash":"' + '1'.repeat(64) + '"}\n');
  };
  a = await boot('damaged', seed);
  try {
    const view = await a.ev('window.cth.lapitayaObservability()');
    check('D1', 'the real app on a damaged ledger reports CORRUPTED and RECOVERY_REQUIRED to the renderer, with codes, and serves no facts', view && view.health && view.health.status === 'CORRUPTED' && view.health.recovery === 'RECOVERY_REQUIRED' && view.health.codes.length > 0 && view.recent.length === 0, view && view.health);
    const led = await a.ev('window.cth.lapitayaLedger(50)');
    check('D2', 'the ledger channel serves nothing', Array.isArray(led) && led.length === 0, led);
    const conf = await a.ev(`window.cth.lapitayaConfirmRequest('req-x', 'tok')`);
    const dec = await a.ev(`window.cth.lapitayaDecide('apr-x', true)`);
    check('D3', 'human channels decide nothing while the ledger is damaged', dec === null && conf && conf.ok === false, { conf: conf && conf.code, dec });
    const keys = await a.ev('Object.keys(window.cth)');
    check('D4', 'the renderer bridge has no recover/repair/quarantine capability', Array.isArray(keys) && !keys.some((k) => /recover|repair|quarantine|verifyGovernance/i.test(k)), keys.filter((k) => /lapitaya/i.test(k)));
    const raw = fs.readFileSync(path.join(a.hh, 'hive', 'lapitaya', 'cima-ledger.jsonl'), 'utf8');
    check('D5', 'the damaged ledger was left exactly as found (no silent repair, nothing appended)', raw.split('\n').filter(Boolean).length === 2 && !/LEDGER_RECOVERED|LEDGER_MIGRATION/.test(raw));
    const sent = await a.ev(`window.cth.hiveSend({ to: 'god', act: 'inform', subject: 'hello', body: 'x' }, 'human')`);
    check('D6', 'the app itself keeps running (messaging is not governance): no crash', sent && typeof sent === 'object' && a.errors.length === 0, a.errors);
    check('D7', 'the main process logged no crash', !/Uncaught Exception|FATAL|crashed/i.test(a.log.join('')));
  } finally { a.close(); }
  fs.writeFileSync(path.join(__dirname, 'real_app_smoke_v15.json'), JSON.stringify({ results }, null, 2));
  fs.writeFileSync(path.join(__dirname, 'real_app_smoke_v15.txt'), results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.desc}${r.detail ? '  [' + r.detail.replace(/\s+/g, ' ').slice(0, 170) + ']' : ''}`).join('\n') + '\n');
  console.log(fs.readFileSync(path.join(__dirname, 'real_app_smoke_v15.txt'), 'utf8'));
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}
main().catch((e) => { console.error('SMOKE ERROR', e && e.stack || e); process.exit(2); });
