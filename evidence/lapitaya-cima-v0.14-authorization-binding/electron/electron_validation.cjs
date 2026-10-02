'use strict';
/**
 * CIMA v0.14 — real Electron validation (run with:  node_modules/.bin/electron <this file>).
 *
 * What is REAL here: the Electron main process, real BrowserWindows (one trusted renderer page, one
 * untrusted page), real ipcMain/ipcRenderer round trips with the real sender facts (webContents id,
 * senderFrame, URL) feeding the real humanIdentity service; the real HookServer listening on the hive's
 * real named pipe; the real <hive>/bin/cth-hook.cjs shim spawned per call with the agent's HIVE_AGENT_TOKEN
 * environment — i.e. the same hook path an agent CLI uses; the real HiveManager router; the real
 * CimaRuntimeService with an out-of-hive seal key.
 *
 * What is NOT here: src/main/index.ts itself (the whole application, ~5.6k lines with updater, PTYs, …)
 * is not booted; its governance IPC wiring is reproduced line for line below. And no agent CLI/provider
 * runs, so a "real El Inge execution" is NOT VALIDATED (reported as such).
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v014-electron-'));
app.setPath('userData', path.join(tmp, 'userData'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
app.on('window-all-closed', () => { /* keep alive until we quit explicitly */ });

const loadTs = require(path.join(ROOT, 'test', 'load-ts.cjs'));
const results = [];
const seenByRenderer = []; // every value that crossed IPC back to a renderer
const rendererErrors = [];
const check = (id, desc, pass, detail) => { results.push({ id, desc, pass: !!pass, detail: detail === undefined ? '' : String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) }); };

// FNV-32 second preimage (attack material)
const P = 0x01000193;
const inv32 = (a) => { let x = a; for (let i = 0; i < 5; i++) x = Math.imul(x, 2 - Math.imul(a, x)) >>> 0; return x >>> 0; };
const Pinv = inv32(P);
const fwd = (h, s) => { for (const c of Buffer.from(s)) { h ^= c; h = Math.imul(h, P) >>> 0; } return h >>> 0; };
const unwind = (h, b) => ((Math.imul(h, Pinv) >>> 0) ^ b) >>> 0;
const CHARS = []; for (let c = 33; c < 127; c++) if (c !== 34 && c !== 92) CHARS.push(c);
function collide(agent, tool, base, target) {
  for (let v = 0; v < 5000; v++) {
    const pfx = `${base}${v} `;
    const s0 = fwd(0x811c9dc5, `${agent}\u0000${tool}\u0000{"command":"${pfx}`);
    const Rr = unwind(unwind(target >>> 0, 125), 34);
    const back = new Map();
    for (const b3 of CHARS) for (const b4 of CHARS) back.set(unwind(unwind(Rr, b4), b3), [b3, b4]);
    for (const b1 of CHARS) for (const b2 of CHARS) {
      let h = Math.imul((s0 ^ b1) >>> 0, P) >>> 0; h = Math.imul((h ^ b2) >>> 0, P) >>> 0;
      if (back.has(h)) { const [b3, b4] = back.get(h); return pfx + String.fromCharCode(b1, b2, b3, b4); }
    }
  }
  return null;
}

async function main() {
  await app.whenReady();
  const { HiveManager } = loadTs('src/main/hive.ts');
  const { HookServer } = loadTs('src/main/hooks.ts');
  const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
  const { createHumanIdentityService, newSessionId } = loadTs('src/main/humanIdentity.ts');
  const { createHumanGovernanceHandlers, resolveRendererSender } = loadTs('src/main/humanGovernanceIpc.ts');
  const { loadOrCreateKey } = loadTs('src/main/authBinding.ts');
  const gov = loadTs('src/shared/lapitaya/governance.ts');
  const { recordBanner } = loadTs('src/shared/lapitaya/cimaRuntime.ts');

  const home = path.join(tmp, 'harness-home');
  fs.mkdirSync(home, { recursive: true });
  const hive = new HiveManager(() => home);
  const ids = ['god', 'valentin-1', 'el-beni-1', 'attacker'];
  for (const id of ids) await hive.ensureAgent({ id, name: id, provider: 'claude', cwd: home, isGod: id === 'god' });
  const tokens = Object.fromEntries(ids.map((id) => [id, hive.registerAgentToken(id)]));
  const sealKeyPath = path.join(app.getPath('userData'), 'lapitaya-governance-seal.key');
  const sealKey = loadOrCreateKey(sealKeyPath);
  const events = [];
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hive.root(), godId: () => hive.registry().godId ?? 'god', sealKey: () => sealKey,
    cwdOf: (id) => hive.registry().agents[id]?.cwd ?? null, providerOf: (id) => hive.registry().agents[id]?.provider ?? null,
    onEvent: (e) => events.push(e)
  });
  hive.setCimaHandler((from, cima, id, to) => recordBanner(lapitaya.handle(from, to, cima, id)));
  const server = new HookServer(hive, () => null, () => ({ autoMode: true, notifications: false }), undefined, undefined, undefined, undefined, lapitaya);
  server.start();

  // ── two real renderer pages: trusted (inside the app's renderer dir) and untrusted (anywhere else)
  const trustedDir = path.join(tmp, 'renderer'); const untrustedDir = path.join(tmp, 'untrusted');
  fs.mkdirSync(trustedDir); fs.mkdirSync(untrustedDir);
  fs.writeFileSync(path.join(trustedDir, 'index.html'), '<!doctype html><title>trusted</title><body>ok</body>');
  fs.writeFileSync(path.join(untrustedDir, 'index.html'), '<!doctype html><title>untrusted</title><body>no</body>');
  const preload = path.join(tmp, 'preload.cjs');
  fs.writeFileSync(preload, `const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cth', { invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a) });`);
  const mkWin = async (dir) => {
    const w = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: false, nodeIntegration: false } });
    w.webContents.on('console-message', (_e, level, message) => { if (level >= 3) rendererErrors.push(message); });
    w.webContents.on('render-process-gone', (_e, d) => rendererErrors.push('render-process-gone ' + d.reason));
    w.webContents.on('did-fail-load', (_e, code, desc) => rendererErrors.push(`did-fail-load ${code} ${desc}`));
    await w.loadFile(path.join(dir, 'index.html'));
    return w;
  };
  const trusted = await mkWin(trustedDir);
  const untrusted = await mkWin(untrustedDir);

  // ── the production governance IPC wiring (src/main/index.ts), reproduced
  const humanIdentity = createHumanIdentityService({
    readHumanId: () => { try { return fs.readFileSync(path.join(tmp, 'human-id'), 'utf8').trim() || null; } catch { return null; } },
    writeHumanId: (id) => fs.writeFileSync(path.join(tmp, 'human-id'), id),
    osUserName: () => os.userInfo().username,
    sessionId: newSessionId(),
    describeSender: (evt) => {
      const wc = evt && evt.sender;
      if (!wc || typeof wc.id !== 'number') return null;
      let url = ''; try { url = evt.senderFrame && evt.senderFrame.url || ''; } catch { url = ''; }
      return { webContentsId: wc.id, destroyed: wc.isDestroyed(), isMainFrame: !!evt.senderFrame && evt.senderFrame === wc.mainFrame, url, ownWindow: !!BrowserWindow.fromWebContents(wc) };
    },
    trustedUrlPrefixes: () => [pathToFileURL(trustedDir + path.sep).href]
  });
  const humanGov = createHumanGovernanceHandlers({ runtime: lapitaya, identity: humanIdentity });
  const ret = (v) => { try { seenByRenderer.push(JSON.stringify(v)); } catch { /* unserializable */ } return v; };
  ipcMain.handle('lapitaya:decide', (evt, id, approve) => ret(humanGov.decide(evt, id, approve)));
  ipcMain.handle('lapitaya:identity', (evt) => ret(humanGov.whoAmI(evt)));
  ipcMain.handle('lapitaya:requests', () => ret(lapitaya.listRequests()));
  ipcMain.handle('lapitaya:approvals', () => ret(lapitaya.listApprovals()));
  ipcMain.handle('lapitaya:confirmRequest', (evt, id, token) => ret(humanGov.confirmRequest(evt, id, token)));
  ipcMain.handle('lapitaya:cancelRequest', (evt, id) => ret(humanGov.cancelRequest(evt, id)));
  ipcMain.handle('hive:send', (evt, partial, from) => {
    const who = resolveRendererSender(humanIdentity, evt, from, partial);
    if (!who.ok) return ret({ ok: false, error: who.error });
    const msg = hive.send(partial ?? {}, who.sender);
    return ret({ ok: true, message: msg });
  });
  const invoke = (win, ch, ...args) => win.webContents.executeJavaScript(`window.cth.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(args)}).catch((e) => ({ __error: String(e && e.message || e) }))`);

  // ── the real hook shim
  const shim = path.join(hive.root(), 'bin', 'cth-hook.cjs');
  const hook = (agentId, tool, input, event = 'PreToolUse', token = tokens[agentId], claimId = agentId) => new Promise((resolve) => {
    const child = spawn(process.execPath, [shim], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AGENT_ID: claimId, HIVE_AGENT_TOKEN: token ?? '', HIVE_SOCK: hive.sockPath() }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => { let r = {}; try { r = JSON.parse(out || '{}'); } catch { /* empty = allow */ } resolve(r); });
    child.stdin.end(JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: input, session_id: 'e2e-' + agentId }));
  });
  const verdict = (r) => (r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny' ? { denied: true, reason: r.hookSpecificOutput.permissionDecisionReason || '' } : { denied: false, reason: '' });
  check('E0', 'the real cth-hook shim and named pipe are in place', fs.existsSync(shim) && !!hive.sockPath(), shim);

  // 1. human identity
  const idTrusted = await invoke(trusted, 'lapitaya:identity');
  const idUntrusted = await invoke(untrusted, 'lapitaya:identity');
  check('E1', 'human identity: trusted renderer page gets a runtime-resolved identity; an untrusted page gets none', idTrusted && /^hum-/.test(idTrusted.id) && idUntrusted === null, { trusted: idTrusted && idTrusted.id, untrusted: idUntrusted });

  // 2. REQUEST confirmation
  const req = lapitaya.openRequest({ intentId: 'int-e2e', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'revisa el estado del proyecto', taskId: null, target: null, signals: [] });
  const gated = verdict(await hook('valentin-1', 'Bash', { command: 'npm test' }));
  check('E2a', 'a PROPOSED request closes the floor at the real hook (REQUEST_CONFIRMATION_REQUIRED)', gated.denied && /REQUEST_CONFIRMATION_REQUIRED/.test(gated.reason), gated.reason.slice(0, 80));
  const untrustedConfirm = await invoke(untrusted, 'lapitaya:confirmRequest', req.id, req.token);
  check('E2b', 'an untrusted page cannot confirm', untrustedConfirm && untrustedConfirm.ok === false && untrustedConfirm.code === 'NOT_AUTHORIZED', untrustedConfirm);
  const wrongTok = await invoke(trusted, 'lapitaya:confirmRequest', req.id, 'nope');
  check('E2c', 'a wrong confirmation token is TAMPERED', wrongTok && wrongTok.code === 'TAMPERED', wrongTok);
  const okConfirm = await invoke(trusted, 'lapitaya:confirmRequest', req.id, req.token);
  check('E2d', 'the trusted human page confirms, recorded with the human owner', okConfirm && okConfirm.ok === true && okConfirm.proposal.confirmedOwner && /^hum-/.test(okConfirm.proposal.confirmedOwner.id), okConfirm && okConfirm.ok);
  const replayConfirm = await invoke(trusted, 'lapitaya:confirmRequest', req.id, req.token);
  check('E2e', 'confirmation replay is NOT_CONFIRMABLE', replayConfirm && replayConfirm.code === 'NOT_CONFIRMABLE', replayConfirm);
  check('E2f', 'after confirmation LOW work runs through the real hook', !verdict(await hook('valentin-1', 'Bash', { command: 'npm test' })).denied);

  // 3. HIGH approval, consumption, replay
  const PUSH = { command: 'git push origin feature-x' };
  const h1 = verdict(await hook('valentin-1', 'Bash', PUSH));
  check('E3a', 'HIGH call is denied at the real hook until a human approves', h1.denied && /HUMAN_APPROVAL_REQUIRED/.test(h1.reason), h1.reason.slice(0, 80));
  const pending = (await invoke(trusted, 'lapitaya:approvals')).find((a) => a.status === 'pending' && a.agentId === 'valentin-1');
  check('E3b', 'the pending approval carries a SHA-256 binding and exposes no seal to the renderer', pending && /^[0-9a-f]{64}$/.test(pending.binding.fingerprint) && pending.seal === undefined, pending && pending.binding.fingerprint);
  const untrustedDecide = await invoke(untrusted, 'lapitaya:decide', pending.id, true);
  check('E3c', 'an untrusted page cannot approve', untrustedDecide === null, untrustedDecide);
  const forgedExtra = await invoke(untrusted, 'lapitaya:decide', pending.id, true, 'god', { id: 'hum-forged0000000000' });
  check('E3d', 'extra identity arguments from an untrusted page are ignored', forgedExtra === null, forgedExtra);
  const decided = await invoke(trusted, 'lapitaya:decide', pending.id, true);
  check('E3e', 'the trusted human page approves', decided && decided.status === 'approved', decided);

  // 4. FNV attack through the real hook, with the approval of A in force
  const cmdB = collide('valentin-1', 'Bash', 'rm -rf /important/data # ', parseInt(gov.toolCallFingerprint('valentin-1', 'Bash', PUSH), 16));
  const atk = verdict(await hook('valentin-1', 'Bash', { command: cmdB }));
  check('E4a', 'FNV-32 twin of the approved call is DENIED at the real hook', !!cmdB && gov.toolCallFingerprint('valentin-1', 'Bash', { command: cmdB }) === gov.toolCallFingerprint('valentin-1', 'Bash', PUSH) && atk.denied, cmdB);
  const other = verdict(await hook('el-beni-1', 'Bash', PUSH));
  check('E4b', 'the approval of agent A is useless to agent B', other.denied);
  const run = verdict(await hook('valentin-1', 'Bash', PUSH));
  check('E4c', 'the exact approved call runs (approval consumed before execution)', !run.denied);
  const replay = verdict(await hook('valentin-1', 'Bash', PUSH));
  check('E4d', 'approval replay is denied', replay.denied && /HUMAN_APPROVAL_REQUIRED/.test(replay.reason), replay.reason.slice(0, 60));

  // 5. modified approval on disk
  const PUSH2 = { command: 'git push origin feature-z' };
  await hook('valentin-1', 'Bash', PUSH2);
  const p2 = (await invoke(trusted, 'lapitaya:approvals')).find((a) => a.status === 'pending' && a.agentId === 'valentin-1');
  await invoke(trusted, 'lapitaya:decide', p2.id, true);
  const af = path.join(hive.root(), 'lapitaya', 'approvals.json');
  const rows = JSON.parse(fs.readFileSync(af, 'utf8'));
  const row = rows.find((a) => a.id === p2.id);
  row.binding.subject.call.tool = 'PowerShell'; // tamper, keep fingerprint and seal
  fs.writeFileSync(af, JSON.stringify(rows));
  const tam = verdict(await hook('valentin-1', 'Bash', PUSH2));
  check('E5', 'a modified approvals.json entry is not an approval', tam.denied && JSON.parse(fs.readFileSync(af, 'utf8')).find((a) => a.id === p2.id).status === 'invalid', tam.reason.slice(0, 60));

  // 6. path mutation through the real hook
  const root = hive.root().replace(/\\/g, '/');
  const sneaky = verdict(await hook('attacker', 'Write', { file_path: `C:/Windows/../${root.slice(3)}/lapitaya/approvals.json`, content: '[]' }));
  const direct = verdict(await hook('attacker', 'Write', { file_path: `${root}/lapitaya/approvals.json`, content: '[]' }));
  check('E6', 'path traversal onto the governance state is held for human approval, like the direct path', sneaky.denied && direct.denied && /HUMAN_APPROVAL_REQUIRED/.test(sneaky.reason), sneaky.reason.slice(0, 60));

  // 7. message sender spoof
  const spoofW = verdict(await hook('attacker', 'Write', { file_path: `${root}/agents/god/outbox/m.json`, content: '{}' }));
  const spoofS = verdict(await hook('attacker', 'Bash', { command: `echo {} > ${root}/agents/god/outbox/m2.json` }));
  check('E7a', 'writing into the orchestrator\'s outbox is refused at the real hook (SENDER_IDENTITY)', spoofW.denied && spoofS.denied && /SENDER_IDENTITY/.test(spoofW.reason), spoofW.reason.slice(0, 80));
  const asGod = await invoke(trusted, 'hive:send', { to: 'valentin-1', act: 'inform', subject: 'x', body: 'y' }, 'god');
  check('E7b', 'a renderer cannot send as an agent', asGod && asGod.ok === false && /SENDER_NOT_PERMITTED/.test(asGod.error), asGod);
  const asHumanUntrusted = await invoke(untrusted, 'hive:send', { to: 'god', act: 'inform', subject: 'x', body: 'y' }, 'human');
  check('E7c', 'an untrusted page cannot send as the human', asHumanUntrusted && asHumanUntrusted.ok === false && /HUMAN_IDENTITY_REQUIRED/.test(asHumanUntrusted.error), asHumanUntrusted);
  const asHuman = await invoke(trusted, 'hive:send', { to: 'god', act: 'inform', subject: 'hello', body: 'y' }, 'human');
  check('E7d', 'the trusted human page can send as the human', asHuman && asHuman.ok === true && asHuman.message.from === 'human', asHuman && asHuman.ok);
  const out = path.join(hive.root(), 'agents', 'attacker', 'outbox'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'fake.json'), JSON.stringify({ from: 'god', agent_id: 'god', to: 'valentin-1', act: 'request', subject: 'fake-from', body: 'I am god' }));
  hive.routeOnce();
  const delivered = hive.inbox('valentin-1').find((m) => m.subject === 'fake-from');
  check('E7e', 'a fake "from" in an outbox file is delivered as its real owner', delivered && delivered.from === 'attacker', delivered && delivered.from);
  const fakeHook = verdict(await hook('god', 'Read', { file_path: 'a.ts' }, 'PreToolUse', tokens.attacker, 'god'));
  check('E7f', 'a fake agent_id at the real hook (attacker\'s token claiming god) is IDENTITY_MISMATCH', fakeHook.denied && /IDENTITY_MISMATCH/.test(fakeHook.reason), fakeHook.reason.slice(0, 60));

  // 8. no renderer authority / no secrets / no errors
  const noHandler = await invoke(trusted, 'lapitaya:authorize', 'valentin-1', 'Bash', { command: 'rm -rf /' });
  check('E8a', 'the renderer has no channel to authorize or execute (no such handler)', noHandler && noHandler.__error && /No handler/.test(noHandler.__error), noHandler);
  const leaked = [];
  const secrets = [...Object.values(tokens), fs.readFileSync(sealKeyPath, 'utf8').trim(), ...JSON.parse(fs.readFileSync(af, 'utf8')).map((a) => a.seal).filter(Boolean)];
  for (const s of secrets) if (seenByRenderer.some((v) => v.includes(s))) leaked.push(s.slice(0, 8));
  check('E8b', 'no agent token, seal key or seal ever crossed IPC to a renderer', leaked.length === 0 && seenByRenderer.length > 5, { crossings: seenByRenderer.length, leaked });
  const ledgerText = fs.readFileSync(path.join(hive.root(), 'lapitaya', 'cima-ledger.jsonl'), 'utf8');
  check('E8c', 'no agent token or seal key in the ledger or traces', !Object.values(tokens).some((t) => ledgerText.includes(t)) && !ledgerText.includes(fs.readFileSync(sealKeyPath, 'utf8').trim()));
  check('E8d', 'no renderer console errors / crashes / load failures', rendererErrors.length === 0, rendererErrors);
  check('E9', 'REAL El Inge (agent CLI) execution', false, 'NOT VALIDATED — no provider CLI/credentials are run by this harness');

  server.stop();
  const summary = { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, results };
  fs.writeFileSync(path.join(OUT, 'electron_validation.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'electron_validation.txt'),
    `Electron ${process.versions.electron} (Node ${process.versions.node}, Chromium ${process.versions.chrome})\n` +
    results.map((r) => `${r.pass ? 'PASS' : (r.id === 'E9' ? 'NOT VALIDATED' : 'FAIL')}  ${r.id}  ${r.desc}${r.detail ? '  [' + r.detail.replace(/\s+/g, ' ').slice(0, 160) + ']' : ''}`).join('\n') + '\n');
  const failed = results.filter((r) => !r.pass && r.id !== 'E9');
  console.log(fs.readFileSync(path.join(OUT, 'electron_validation.txt'), 'utf8'));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  app.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS ERROR', e && e.stack || e); app.exit(2); });
