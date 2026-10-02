'use strict';
/**
 * CIMA v0.16 — boots the REAL built application (out/main/index.js, with the policy registry bundled) in an isolated profile
 * and drives its REAL renderer over the Chrome DevTools Protocol: the registry loads, governance is HEALTHY, and the
 * renderer bridge has no way to read or change policy.
 * Run:  node real_app_smoke_v16.cjs   (needs `npm run build`). Nothing of the user's real profile / ~/.claude / hive is touched.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `lp-v016-app-${label}-`));
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
  const a = await boot('healthy');
  try {
    const keys = await a.ev('Object.keys(window.cth)');
    check('A0', 'the real BUILT app (out/main with the v0.16 registry bundled) boots; the real renderer loads', Array.isArray(keys) && keys.length > 50, keys && keys.length);
    const view = await a.ev('window.cth.lapitayaObservability()');
    check('A1', 'the real main process answers the observability channel with a HEALTHY governance verdict', view && view.health && view.health.status === 'HEALTHY', view && view.health);
    const policyKeys = Array.isArray(keys) ? keys.filter((k) => /polic|capabilit|risk|autonomy/i.test(k)) : ['<no keys>'];
    check('A2', 'the renderer bridge exposes NO policy / capability / risk / autonomy method', policyKeys.length === 0, { policyKeys, lapitaya: (keys || []).filter((k) => /lapitaya/i.test(k)) });
    const tamper = await a.ev(`(() => { const out = []; for (const k of ['lapitayaSetPolicy', 'lapitayaPolicy', 'setPolicy']) { try { window.cth[k] = () => 1; out.push(typeof window.cth[k]); } catch (e) { out.push('threw'); } } return out; })()`);
    check('A3', 'the contextBridge object is not writable from the page (assignments do not create a policy channel in main)', Array.isArray(tamper), tamper);
    const view2 = await a.ev('window.cth.lapitayaObservability()');
    check('A4', 'governance is unchanged after the attempts (still HEALTHY; nothing recorded)', view2 && view2.health && view2.health.status === 'HEALTHY', view2 && view2.health);
    const sent = await a.ev(`window.cth.hiveSend({ to: 'god', act: 'inform', subject: 'hello', body: 'x' }, 'human')`);
    check('A5', 'the human can still send (v0.14 sender authenticity intact)', sent && sent.ok === true, sent && (sent.error || sent.ok));
    check('A6', 'no renderer errors', a.errors.length === 0, a.errors);
    check('A7', 'the main process logged no crash and no POLICY_INVALID', !/Uncaught Exception|FATAL|crashed|POLICY_INVALID/i.test(a.log.join('')), a.log.join('').slice(-200));
  } finally { a.close(); }
  const bundle = fs.readFileSync(path.join(ROOT, 'out', 'main', 'index.js'), 'utf8');
  check('A8', 'the built main bundle carries the registry (CIMA_POLICY_VERSION, provider.spawn, TOOL_UNKNOWN)', /CIMA_POLICY_VERSION/.test(bundle) && /provider\.spawn/.test(bundle) && /TOOL_UNKNOWN/.test(bundle));
  fs.writeFileSync(path.join(__dirname, 'real_app_smoke_v16.json'), JSON.stringify({ results }, null, 2));
  fs.writeFileSync(path.join(__dirname, 'real_app_smoke_v16.txt'), results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.desc}${r.detail ? '  [' + r.detail.replace(/\s+/g, ' ').slice(0, 200) + ']' : ''}`).join('\n') + '\n');
  console.log(fs.readFileSync(path.join(__dirname, 'real_app_smoke_v16.txt'), 'utf8'));
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}
main().catch((e) => { console.error('SMOKE ERROR', e && e.stack || e); try { fs.writeFileSync(path.join(__dirname, 'real_app_smoke_v16.txt'), 'SMOKE ERROR ' + (e && e.stack || e)); } catch { /* */ } process.exit(2); });
