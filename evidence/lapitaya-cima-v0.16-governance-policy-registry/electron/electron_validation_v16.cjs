'use strict';
/**
 * CIMA v0.16 — real Electron validation of the Governance Policy & Capability Registry
 * (run from the repo root:  node_modules\.bin\electron evidence\lapitaya-cima-v0.16-governance-policy-registry\electron\electron_validation_v16.cjs
 *  with ELECTRON_RUN_AS_NODE unset).
 *
 * REAL: the Electron main process (the registry is loaded and validated INSIDE it); a trusted and an untrusted
 * BrowserWindow with real ipcMain/ipcRenderer round trips feeding the real humanIdentity service and the real human
 * governance handlers; the real HookServer on the hive's pipe/socket and the real <hive>/bin/cth-hook.cjs shim spawned
 * with the agent's HIVE_AGENT_TOKEN; the real HiveManager spawn path (ensureAgent → spawnGovernanceDecision); the real
 * CimaRuntimeService with an out-of-hive seal key; the observability projection over IPC (what Alicia shows).
 * The ledger is verified from disk by an INDEPENDENT implementation in this file (no runtime code).
 * NOT REAL: src/main/index.ts itself (its governance wiring is reproduced); no agent CLI runs → real El Inge: NOT VALIDATED.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v016-electron-'));
app.setPath('userData', path.join(tmp, 'userData'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
app.on('window-all-closed', () => { /* explicit quit */ });
const loadTs = require(path.join(ROOT, 'test', 'load-ts.cjs'));
const results = []; const seenByRenderer = []; const rendererErrors = [];
const check = (id, desc, pass, detail) => results.push({ id, desc, pass: !!pass, detail: String(typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')).slice(0, 360) });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));

/** Independent verifier: genesis, previous hash, hash, MAC, sequence, keyed head anchor. Knows nothing of the runtime. */
function verifyFromDisk(dir, key) {
  const file = path.join(dir, 'cima-ledger.jsonl');
  const lines = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n').filter(Boolean);
  let prev = sha('lapitaya/ledger-genesis/v1'); let seq = 0; const ids = new Set(); const events = [];
  for (const [i, l] of lines.entries()) {
    let e; try { e = JSON.parse(l); } catch { return { ok: false, why: `line ${i + 1} is not JSON` }; }
    if (e.sequence !== seq + 1) return { ok: false, why: `sequence ${seq} → ${e.sequence}` };
    if (e.previousEventHash !== prev) return { ok: false, why: `previous hash at ${e.sequence}` };
    const { eventHash, eventMac, ...rest } = e;
    if (eventHash !== sha('lapitaya/ledger-event/v2\n' + canon(rest))) return { ok: false, why: `hash at ${e.sequence}` };
    if (eventMac !== crypto.createHmac('sha256', key).update('lapitaya/ledger-event-mac/v1\n' + eventHash).digest('hex')) return { ok: false, why: `mac at ${e.sequence}` };
    if (ids.has(e.eventId)) return { ok: false, why: 'duplicate id' };
    ids.add(e.eventId); events.push(e); prev = eventHash; seq = e.sequence;
  }
  const ap = path.join(dir, 'ledger-head.json');
  if (seq > 0) {
    if (!fs.existsSync(ap)) return { ok: false, why: 'no anchor' };
    const a = JSON.parse(fs.readFileSync(ap, 'utf8'));
    const mac = crypto.createHmac('sha256', key).update('lapitaya/ledger-anchor/v1\n' + canon({ v: 1, sequence: a.sequence, hash: a.hash })).digest('hex');
    if (mac !== a.mac) return { ok: false, why: 'anchor mac' };
    if (a.sequence > seq) return { ok: false, why: `anchor ${a.sequence} > ledger ${seq}` };
  }
  return { ok: true, head: seq, events };
}

async function main() {
  await app.whenReady();
  const reg = loadTs('src/shared/lapitaya/policyRegistry.ts');
  const { HiveManager } = loadTs('src/main/hive.ts');
  const { HookServer } = loadTs('src/main/hooks.ts');
  const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
  const { createHumanIdentityService, newSessionId } = loadTs('src/main/humanIdentity.ts');
  const { createHumanGovernanceHandlers } = loadTs('src/main/humanGovernanceIpc.ts');
  const { loadOrCreateKey } = loadTs('src/main/authBinding.ts');
  const { recordBanner } = loadTs('src/shared/lapitaya/cimaRuntime.ts');
  const { projectObservability } = loadTs('src/shared/lapitaya/alicia/observability.ts');

  // ── 1. the policy loads inside the Electron main process ──
  const R = reg.POLICY_REGISTRY;
  check('E1', 'the governance policy loads and validates inside the Electron main process; it is frozen', R.valid && R.version === 1 && Object.isFrozen(R) && Object.isFrozen(reg.DEFAULT_POLICY.capabilities[0]),
    { valid: R.valid, version: R.version, capabilities: R.listCapabilities().length, errors: R.errors.length });

  const home = path.join(tmp, 'harness-home'); fs.mkdirSync(home, { recursive: true });
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'valentin-1', name: 'Valentin', provider: 'claude', cwd: home });

  // ── 2. provider governance on the REAL spawn path ──
  const spawnTry = async (meta, opts) => { try { await hive.ensureAgent(meta, opts); return { ok: true }; } catch (e) { return { ok: false, err: String(e && e.message || e) }; } };
  const gem = await spawnTry({ id: 'gemini-1', name: 'Gemini One', provider: 'gemini', cwd: home });
  const kimi = await spawnTry({ id: 'kimi-1', name: 'Kimi', provider: 'kimi', cwd: home });
  const pi = await spawnTry({ id: 'pi-1', name: 'Pi', provider: 'pi', cwd: home });
  const evil = await spawnTry({ id: 'evil-1', name: 'Evil', provider: 'evil-provider', cwd: home }, { allowUngovernedProviders: true });
  const optIn = await spawnTry({ id: 'kimi-2', name: 'Kimi Two', provider: 'kimi', cwd: home }, { allowUngovernedProviders: true });
  const log = fs.readFileSync(path.join(hive.root(), 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const override = log.find((e) => e.kind === 'spawn_ungoverned_override');
  check('E2', 'provider governance on the real spawn path: blocking spawns; none / observe-only refused; unknown refused even with the opt-out; the opt-out is logged',
    gem.ok && !kimi.ok && /LAPITAYA_GOVERNANCE_UNENFORCEABLE/.test(kimi.err) && !pi.ok && !evil.ok && /PROVIDER_UNKNOWN/.test(evil.err) && optIn.ok && override && override.provider === 'kimi' && override.policyVersion === 1,
    { gemini: gem.ok, kimi: kimi.ok, pi: pi.ok, evil: evil.err && evil.err.slice(0, 40), override: override && { provider: override.provider, enforcement: override.enforcement, policyVersion: override.policyVersion } });

  const tokens = Object.fromEntries(['god', 'valentin-1', 'gemini-1'].map((id) => [id, hive.registerAgentToken(id)]));
  const keyFile = path.join(app.getPath('userData'), 'lapitaya-governance-seal.key');
  const key = loadOrCreateKey(keyFile);
  const lapitaya = new CimaRuntimeService({ hiveRoot: () => hive.root(), godId: () => 'god', sealKey: () => key, cwdOf: (id) => hive.registry().agents[id]?.cwd ?? null, providerOf: (id) => hive.registry().agents[id]?.provider ?? null });
  hive.setCimaHandler((from, cima, id, to) => recordBanner(lapitaya.handle(from, to, cima, id)));
  const server = new HookServer(hive, () => null, () => ({ autoMode: true, notifications: false }), undefined, undefined, undefined, undefined, lapitaya);
  server.start();
  const dir = path.join(hive.root(), 'lapitaya');

  const trustedDir = path.join(tmp, 'renderer'); const untrustedDir = path.join(tmp, 'untrusted');
  fs.mkdirSync(trustedDir); fs.mkdirSync(untrustedDir);
  fs.writeFileSync(path.join(trustedDir, 'index.html'), '<!doctype html><title>trusted</title>');
  fs.writeFileSync(path.join(untrustedDir, 'index.html'), '<!doctype html><title>untrusted</title>');
  const preload = path.join(tmp, 'preload.cjs');
  fs.writeFileSync(preload, `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('cth', { invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a) });`);
  const mkWin = async (d) => {
    const w = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: false } });
    w.webContents.on('console-message', (_e, level, message) => { if (level >= 3) rendererErrors.push(message); });
    w.webContents.on('render-process-gone', (_e, x) => rendererErrors.push('gone ' + x.reason));
    await w.loadFile(path.join(d, 'index.html')); return w;
  };
  const trusted = await mkWin(trustedDir); const untrusted = await mkWin(untrustedDir);
  const identity = createHumanIdentityService({
    readHumanId: () => { try { return fs.readFileSync(path.join(tmp, 'human-id'), 'utf8').trim() || null; } catch { return null; } },
    writeHumanId: (id) => fs.writeFileSync(path.join(tmp, 'human-id'), id), osUserName: () => os.userInfo().username, sessionId: newSessionId(),
    describeSender: (evt) => { const wc = evt && evt.sender; if (!wc) return null; let url = ''; try { url = evt.senderFrame && evt.senderFrame.url || ''; } catch { /* */ } return { webContentsId: wc.id, destroyed: wc.isDestroyed(), isMainFrame: !!evt.senderFrame && evt.senderFrame === wc.mainFrame, url, ownWindow: !!BrowserWindow.fromWebContents(wc) }; },
    trustedUrlPrefixes: () => [pathToFileURL(trustedDir + path.sep).href]
  });
  const humanGov = createHumanGovernanceHandlers({ runtime: lapitaya, identity });
  const ret = (v) => { try { seenByRenderer.push(JSON.stringify(v)); } catch { /* */ } return v; };
  // the production channels (index.ts) — there is NO policy channel in production, and none is registered here
  ipcMain.handle('lapitaya:identity', (e) => ret(humanGov.whoAmI(e)));
  ipcMain.handle('lapitaya:decide', (e, id, a) => ret(humanGov.decide(e, id, a)));
  ipcMain.handle('lapitaya:approvals', () => ret(lapitaya.listApprovals()));
  ipcMain.handle('lapitaya:ledger', (_e, n) => ret(lapitaya.ledger(typeof n === 'number' ? n : 200)));
  ipcMain.handle('lapitaya:observability', () => { const s = lapitaya.governanceSnapshot({ ledgerLimit: 3000, traceLimit: 1000 }); return ret(projectObservability({ ledger: s.ledger, traces: s.traces, approvals: s.approvals, requests: s.requests, health: s.health }, { recentLimit: 40 })); });
  const invoke = (w, ch, ...a) => w.webContents.executeJavaScript(`window.cth.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(a)}).catch((e) => ({ __error: String(e && e.message || e) }))`);

  const shim = path.join(hive.root(), 'bin', 'cth-hook.cjs');
  const hook = (agentId, tool, input, event = 'PreToolUse', extra = {}) => new Promise((resolve) => {
    const c = spawn(process.execPath, [shim], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AGENT_ID: agentId, HIVE_AGENT_TOKEN: tokens[agentId], HIVE_SOCK: hive.sockPath() }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => { let r = {}; try { r = JSON.parse(out || '{}'); } catch { /* empty = allow */ } resolve(r); });
    c.stdin.end(JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: input, session_id: 'e2e', ...extra }));
  });
  const verdict = (r) => (r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny' ? { denied: true, reason: r.hookSpecificOutput.permissionDecisionReason || '' } : { denied: false, reason: '' });
  const ran = async (agent, tool, input) => { const a = verdict(await hook(agent, tool, input)); if (!a.denied) await hook(agent, tool, input, 'PostToolUse', { tool_response: { stdout: 'ok', stderr: '', interrupted: false } }); return a; };
  const lastGov = () => { const v = verifyFromDisk(dir, key); return v.ok ? v.events.filter((e) => e.kind === 'governance').at(-1) : null; };

  // ── 3. tool governance at the real hook ──
  const read = await ran('valentin-1', 'Read', { file_path: path.join(home, 'README.md') });
  const readEv = lastGov();
  const unk = verdict(await hook('valentin-1', 'FrobnicateTool', { x: 1 }));
  const unkEv = lastGov();
  check('E3', 'tool governance at the real hook: a known LOW tool runs; an unknown tool is DENIED (TOOL_UNKNOWN), not held for approval',
    !read.denied && readEv.decision === 'ALLOW' && unk.denied && /TOOL_UNKNOWN/.test(unk.reason) && unkEv.rule === 'TOOL_UNKNOWN' && lapitaya.listApprovals().length === 0, { read: readEv.decision, unknown: unkEv.rule });

  // ── 4. capability resolution, recorded by the runtime ──
  const calls = [
    ['valentin-1', 'Bash', { command: 'git status' }, 'shell.inspect'],
    ['valentin-1', 'Bash', { command: 'echo x > out.txt' }, 'shell.mutation'],
    ['valentin-1', 'Write', { file_path: path.join(home, 'src', 'a.ts'), content: 'x' }, 'filesystem.write'],
    ['valentin-1', 'mcp__github__create_issue', { title: 'x' }, 'mcp.tool'],
    ['gemini-1', 'run_shell_command', { command: 'ls' }, 'shell.inspect']
  ];
  const got = [];
  for (const [agent, tool, input, want] of calls) { await hook(agent, tool, input); const e = lastGov(); got.push([tool, e.capabilityId, e.provider, want]); }
  check('E4', 'capability resolution: every call lands on the ledger with the capability the RUNTIME resolved (and its provider)', got.every(([, c, , w]) => c === w) && got[4][2] === 'gemini', got.map(([t, c, p]) => `${t}→${c}(${p})`).join(' · '));

  // ── 5. risk resolution: the agent's claims are ignored ──
  const PUSH = { command: 'git push origin feature-x' };
  const h1 = verdict(await hook('valentin-1', 'Bash', { ...PUSH }, 'PreToolUse', { risk: 'LOW', mode: 'AUTO', capability: 'filesystem.read', policyVersion: 0 }));
  const h1ev = lastGov();
  check('E5', 'risk resolution: `git push` is HIGH / HUMAN_APPROVAL with capability shell.high-impact although the payload claims LOW / AUTO / filesystem.read',
    h1.denied && /HUMAN_APPROVAL_REQUIRED/.test(h1.reason) && h1ev.risk === 'HIGH' && h1ev.mode === 'HUMAN_APPROVAL' && h1ev.capabilityId === 'shell.high-impact' && h1ev.policyVersion === 1, { risk: h1ev.risk, cap: h1ev.capabilityId, v: h1ev.policyVersion });

  // ── 6. human approval through the trusted channel (extra arguments are not policy) ──
  const pending = (await invoke(trusted, 'lapitaya:approvals')).find((a) => a.status === 'pending');
  const untrustedDecide = await invoke(untrusted, 'lapitaya:decide', pending.id, true);
  const decided = await invoke(trusted, 'lapitaya:decide', pending.id, true, { risk: 'LOW', capability: 'filesystem.read', policyVersion: 0 });
  const after = (await invoke(trusted, 'lapitaya:approvals')).find((a) => a.id === pending.id);
  const humanEv = lastGov();
  check('E6', 'human approval: the untrusted page cannot approve; the trusted page approves; extra (policy-like) arguments are ignored',
    untrustedDecide === null && decided && decided.status === 'approved' && after.binding.subject.context.capability === 'shell.high-impact' && after.risk === 'HIGH' && humanEv.decision === 'HUMAN_APPROVED' && humanEv.capabilityId === 'shell.high-impact' && humanEv.policyVersion === 1,
    { untrusted: untrustedDecide, decided: decided && decided.status, cap: after.binding.subject.context.capability, policy: after.binding.subject.context.policy });

  // ── 7. authorization binding (v0.14) with the capability in the subject ──
  const otherTool = verdict(await hook('valentin-1', 'PowerShell', PUSH));
  const exact = await ran('valentin-1', 'Bash', PUSH);
  const again = verdict(await hook('valentin-1', 'Bash', PUSH));
  check('E7', 'authorization binding: a different tool needs its own approval; the exact approved call runs once; then it needs a new approval',
    otherTool.denied && !exact.denied && again.denied && /HUMAN_APPROVAL_REQUIRED/.test(again.reason));

  // ── 8. every governance event carries the policy version; the chain verifies independently ──
  const v = verifyFromDisk(dir, key);
  const govEvents = v.ok ? v.events.filter((e) => e.kind === 'governance') : [];
  check('E8', 'INDEPENDENT verification from disk: chain + MACs + anchor verify, and EVERY governance event names policyVersion 1',
    v.ok && govEvents.length >= 10 && govEvents.every((e) => e.policyVersion === 1), v.ok ? { events: v.events.length, governance: govEvents.length, versions: [...new Set(govEvents.map((e) => e.policyVersion))] } : v.why);

  // ── 9. Alicia's projection shows the runtime's capability / version (read-only) ──
  const view = await invoke(trusted, 'lapitaya:observability');
  const withCap = view.recent.filter((o) => o.capability);
  check('E9', 'Alicia (the observability projection over IPC) shows capability and policy version exactly as the runtime recorded them',
    view.health.status === 'HEALTHY' && withCap.length > 0 && withCap.every((o) => o.policyVersion === 1) && withCap.some((o) => o.capability === 'shell.high-impact'),
    { health: view.health.status, shown: withCap.slice(0, 4).map((o) => `${o.operation}→${o.capability}/v${o.policyVersion}`) });

  // ── 10. unknown capability / tool denial ──
  const u1 = verdict(await hook('valentin-1', 'mcp__', {}));
  const u2 = verdict(await hook('valentin-1', 'TotallyNewTool', { command: 'ls' }));
  const u3 = verdict(await hook('valentin-1', 'intent', { intent: 'x' }));
  check('E10', 'unknown capability / tool denial at the real hook (bare MCP prefix, unknown tool, the runtime-reserved intent tool)', u1.denied && u2.denied && u3.denied, [u1.reason.slice(0, 40), u2.reason.slice(0, 40), u3.reason.slice(0, 40)]);

  // ── 11. the renderer cannot alter policy ──
  const tries = await Promise.all([
    invoke(trusted, 'lapitaya:policy'), invoke(trusted, 'lapitaya:setPolicy', { capabilities: [] }), invoke(untrusted, 'lapitaya:capabilities'),
    invoke(trusted, 'lapitaya:setRisk', 'shell.high-impact', 'LOW'), invoke(trusted, 'governance:policy')
  ]);
  const stillHigh = verdict(await hook('valentin-1', 'Bash', { command: 'git push origin feature-z' }));
  check('E11', 'the renderer cannot alter policy: no policy channel exists (every attempt "No handler"), and governance is unchanged afterwards',
    tries.every((t) => t && t.__error && /No handler/.test(t.__error)) && stillHigh.denied && /HUMAN_APPROVAL_REQUIRED/.test(stillHigh.reason) && R.valid && R.getCapability('shell.high-impact').risk === 'HIGH',
    tries.map((t) => (t && t.__error ? 'No handler' : JSON.stringify(t))).join(' · '));

  // ── 12. errors / leakage ──
  const secrets = [...Object.values(tokens), fs.readFileSync(keyFile, 'utf8').trim()];
  const leaked = secrets.filter((s) => seenByRenderer.some((x) => x.includes(s)));
  check('E12', 'no renderer console errors / crashes; no agent token or seal key crossed IPC', rendererErrors.length === 0 && leaked.length === 0 && seenByRenderer.length >= 5, { errors: rendererErrors, leaked: leaked.length, crossings: seenByRenderer.length });
  check('E13', 'REAL El Inge (agent CLI) execution', false, 'NOT VALIDATED — no provider CLI/credentials are run by this harness');

  server.stop();
  fs.writeFileSync(path.join(OUT, 'electron_validation_v16.json'), JSON.stringify({ electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, platform: process.platform, results }, null, 2));
  fs.writeFileSync(path.join(OUT, 'electron_validation_v16.txt'), `Electron ${process.versions.electron} (Node ${process.versions.node}, Chromium ${process.versions.chrome}) on ${process.platform}\n` + results.map((r) => `${r.pass ? 'PASS' : (r.id === 'E13' ? 'NOT VALIDATED' : 'FAIL')}  ${r.id}  ${r.desc}${r.detail ? '  [' + r.detail.replace(/\s+/g, ' ').slice(0, 220) + ']' : ''}`).join('\n') + '\n');
  console.log(fs.readFileSync(path.join(OUT, 'electron_validation_v16.txt'), 'utf8'));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  app.exit(results.some((r) => !r.pass && r.id !== 'E13') ? 1 : 0);
}
main().catch((e) => {
  try { fs.writeFileSync(path.join(OUT, 'electron_validation_v16.txt'), 'HARNESS ERROR ' + (e && e.stack || e) + '\n' + results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.desc}`).join('\n')); } catch { /* */ }
  console.error('HARNESS ERROR', e && e.stack || e); app.exit(2);
});
