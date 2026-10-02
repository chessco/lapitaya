'use strict';
/**
 * CIMA v0.15 — real Electron validation of governance event integrity
 * (run:  env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron <this file>).
 *
 * REAL: the Electron main process; a trusted and an untrusted BrowserWindow with real ipcMain/ipcRenderer round trips and the
 * real sender facts feeding the real humanIdentity service; the real HookServer on the hive's named pipe and the real
 * <hive>/bin/cth-hook.cjs shim spawned with the agent's HIVE_AGENT_TOKEN; the real HiveManager and CimaRuntimeService with an
 * out-of-hive seal key; and the real operator recovery tool (scripts/lapitaya-recover.cjs) run as a separate process.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v015-electron-'));
app.setPath('userData', path.join(tmp, 'userData'));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
app.on('window-all-closed', () => { /* explicit quit */ });
const loadTs = require(path.join(ROOT, 'test', 'load-ts.cjs'));
const results = []; const seenByRenderer = []; const rendererErrors = [];
const check = (id, desc, pass, detail) => results.push({ id, desc, pass: !!pass, detail: String(typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')).slice(0, 360) });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));

/** Independent verifier: genesis, previous hash, hash, MAC, sequence, and the keyed head anchor. Knows nothing of the runtime. */
function verifyFromDisk(dir, key) {
  const file = path.join(dir, 'cima-ledger.jsonl');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = text.split('\n').filter(Boolean);
  let prev = sha('lapitaya/ledger-genesis/v1'); let seq = 0; const ids = new Set(); const types = [];
  let legacy = 0; let started = false;
  for (const [i, l] of lines.entries()) {
    let e; try { e = JSON.parse(l); } catch { return { ok: false, why: `line ${i + 1} is not JSON` }; }
    if (e.schemaVersion === undefined) { if (started) return { ok: false, why: 'legacy after chain' }; legacy++; continue; }
    if (!started && legacy) { prev = e.previousEventHash; } // boundary: trusted here only structurally
    started = true;
    if (e.sequence !== seq + 1) return { ok: false, why: `sequence ${seq} → ${e.sequence}` };
    if (e.previousEventHash !== prev) return { ok: false, why: `previous hash at ${e.sequence}` };
    const { eventHash, eventMac, ...rest } = e;
    if (eventHash !== sha('lapitaya/ledger-event/v2\n' + canon(rest))) return { ok: false, why: `hash at ${e.sequence}` };
    if (eventMac !== crypto.createHmac('sha256', key).update('lapitaya/ledger-event-mac/v1\n' + eventHash).digest('hex')) return { ok: false, why: `mac at ${e.sequence}` };
    if (ids.has(e.eventId)) return { ok: false, why: 'duplicate id' };
    ids.add(e.eventId); types.push({ seq: e.sequence, type: e.eventType, rec: e }); prev = eventHash; seq = e.sequence;
  }
  const ap = path.join(dir, 'ledger-head.json');
  if (seq > 0) {
    if (!fs.existsSync(ap)) return { ok: false, why: 'no anchor' };
    const a = JSON.parse(fs.readFileSync(ap, 'utf8'));
    const mac = crypto.createHmac('sha256', key).update('lapitaya/ledger-anchor/v1\n' + canon({ v: 1, sequence: a.sequence, hash: a.hash })).digest('hex');
    if (mac !== a.mac) return { ok: false, why: 'anchor mac' };
    if (a.sequence > seq) return { ok: false, why: `anchor ${a.sequence} > ledger ${seq}` };
    if (a.sequence === seq && a.hash !== prev) return { ok: false, why: 'anchor hash' };
  }
  return { ok: true, events: types.length, head: seq, types };
}

async function main() {
  await app.whenReady();
  const { HiveManager } = loadTs('src/main/hive.ts');
  const { HookServer } = loadTs('src/main/hooks.ts');
  const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
  const { createHumanIdentityService, newSessionId } = loadTs('src/main/humanIdentity.ts');
  const { createHumanGovernanceHandlers } = loadTs('src/main/humanGovernanceIpc.ts');
  const { loadOrCreateKey, sealApproval } = loadTs('src/main/authBinding.ts');
  const { recordBanner } = loadTs('src/shared/lapitaya/cimaRuntime.ts');
  const { projectObservability } = loadTs('src/shared/lapitaya/alicia/observability.ts');

  const home = path.join(tmp, 'harness-home'); fs.mkdirSync(home, { recursive: true });
  const hive = new HiveManager(() => home);
  const ids = ['god', 'valentin-1'];
  for (const id of ids) await hive.ensureAgent({ id, name: id, provider: 'claude', cwd: home, isGod: id === 'god' });
  const tokens = Object.fromEntries(ids.map((id) => [id, hive.registerAgentToken(id)]));
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
  ipcMain.handle('lapitaya:identity', (e) => ret(humanGov.whoAmI(e)));
  ipcMain.handle('lapitaya:decide', (e, id, a) => ret(humanGov.decide(e, id, a)));
  ipcMain.handle('lapitaya:requests', () => ret(lapitaya.listRequests()));
  ipcMain.handle('lapitaya:approvals', () => ret(lapitaya.listApprovals()));
  ipcMain.handle('lapitaya:confirmRequest', (e, id, tok) => ret(humanGov.confirmRequest(e, id, tok)));
  ipcMain.handle('lapitaya:cancelRequest', (e, id) => ret(humanGov.cancelRequest(e, id)));
  ipcMain.handle('lapitaya:ledger', (_e, n) => ret(lapitaya.ledger(typeof n === 'number' ? n : 200)));
  // the production observability handler (index.ts): ONE snapshot
  ipcMain.handle('lapitaya:observability', () => { const s = lapitaya.governanceSnapshot({ ledgerLimit: 3000, traceLimit: 1000 }); return ret(projectObservability({ ledger: s.ledger, traces: s.traces, approvals: s.approvals, requests: s.requests, health: s.health }, { recentLimit: 12 })); });
  const invoke = (w, ch, ...a) => w.webContents.executeJavaScript(`window.cth.invoke(${JSON.stringify(ch)}, ...${JSON.stringify(a)}).catch((e) => ({ __error: String(e && e.message || e) }))`);

  const shim = path.join(hive.root(), 'bin', 'cth-hook.cjs');
  const hook = (agentId, tool, input, event = 'PreToolUse', extra = {}) => new Promise((resolve) => {
    const c = spawn(process.execPath, [shim], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AGENT_ID: agentId, HIVE_AGENT_TOKEN: tokens[agentId], HIVE_SOCK: hive.sockPath() }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => { let r = {}; try { r = JSON.parse(out || '{}'); } catch { /* empty = allow */ } resolve(r); });
    c.stdin.end(JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: input, session_id: 'e2e', ...extra }));
  });
  const verdict = (r) => (r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny' ? { denied: true, reason: r.hookSpecificOutput.permissionDecisionReason || '' } : { denied: false, reason: '' });
  const ran = async (agent, tool, input) => { const a = verdict(await hook(agent, tool, input)); await hook(agent, tool, input, 'PostToolUse', { tool_response: { stdout: 'ok', stderr: '', interrupted: false } }); return a; };

  // ── 1. healthy: pending request → human confirmation → human approval → execution ──
  const idv = await invoke(trusted, 'lapitaya:identity');
  const req = lapitaya.openRequest({ intentId: 'int-e2e', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'revisa el estado del proyecto', taskId: null, target: null, signals: [] });
  const gated = verdict(await hook('valentin-1', 'Bash', { command: 'npm test' }));
  check('V1a', 'a pending request closes the floor at the real hook', gated.denied && /REQUEST_CONFIRMATION_REQUIRED/.test(gated.reason), gated.reason.slice(0, 70));
  const untrustedConfirm = await invoke(untrusted, 'lapitaya:confirmRequest', req.id, req.token);
  check('V1b', 'an untrusted page cannot confirm', untrustedConfirm && untrustedConfirm.ok === false, untrustedConfirm);
  const conf = await invoke(trusted, 'lapitaya:confirmRequest', req.id, req.token);
  check('V1c', 'the trusted human page confirms; the confirmation is recorded with the runtime-resolved human owner', conf && conf.ok === true, conf && conf.ok);
  const lowRun = await ran('valentin-1', 'Bash', { command: 'npm test' });
  check('V1d', 'LOW work executes after the confirmation', !lowRun.denied);
  const PUSH = { command: 'git push origin feature-x' };
  const h1 = verdict(await hook('valentin-1', 'Bash', PUSH));
  check('V1e', 'the HIGH call is held for a human', h1.denied && /HUMAN_APPROVAL_REQUIRED/.test(h1.reason));
  const pending = (await invoke(trusted, 'lapitaya:approvals')).find((a) => a.status === 'pending');
  const untrustedDecide = await invoke(untrusted, 'lapitaya:decide', pending.id, true);
  check('V1f', 'an untrusted page cannot approve', untrustedDecide === null);
  const decided = await invoke(trusted, 'lapitaya:decide', pending.id, true);
  check('V1g', 'the trusted human page approves', decided && decided.status === 'approved');
  const pushRun = await ran('valentin-1', 'Bash', PUSH);
  check('V1h', 'the exact approved call executes (approval consumed)', !pushRun.denied);

  const v1 = verifyFromDisk(dir, key);
  check('V2a', 'INDEPENDENT verification from disk: the chain, MACs, sequence and keyed anchor all verify', v1.ok, v1.ok ? { events: v1.events, head: v1.head } : v1.why);
  const order = v1.types.map((x) => x.type);
  const at = (t, nth = 0) => { let n = -1; for (const x of v1.types) if (x.type === t && ++n === nth) return x.seq; return -1; };
  const seqOk = at('REQUEST_PROPOSED') < at('REQUEST_CONFIRMED') && at('HUMAN_APPROVAL_REQUIRED') < at('HUMAN_APPROVED') && at('HUMAN_APPROVED') < at('APPROVAL_CONSUMED') && at('APPROVAL_CONSUMED') < at('TOOL_EXECUTED', 1) && at('REQUEST_CONFIRMED') > 0;
  check('V2b', 'the stream orders the facts: REQUEST_PROPOSED → REQUEST_CONFIRMED … HUMAN_APPROVAL_REQUIRED → HUMAN_APPROVED → APPROVAL_CONSUMED → TOOL_EXECUTED', seqOk, order.join(' › ').slice(0, 330));
  const owner = v1.types.find((x) => x.type === 'HUMAN_APPROVED').rec.human;
  check('V2c', 'the human owner on the events is the one main resolved (not a renderer argument)', owner && owner.id === idv.id && /^ses-/.test(owner.session), owner && owner.id);
  const exec = v1.types.filter((x) => x.type === 'TOOL_EXECUTED').pop().rec;
  const cons = v1.types.find((x) => x.type === 'APPROVAL_CONSUMED').rec;
  check('V2d', 'AUTHORIZED ≠ EXECUTED: the TOOL_EXECUTED event cites the authorization event it relates to', exec.authorizationEventId === cons.eventId && exec.ok === true);
  const view0 = await invoke(trusted, 'lapitaya:observability');
  check('V3a', 'Alicia (the observability projection over IPC) reports HEALTHY with facts', view0.health && view0.health.status === 'HEALTHY' && view0.recent.length > 0, view0.health);

  // ── 2. corrupted ledger ──
  const good = fs.readFileSync(path.join(dir, 'cima-ledger.jsonl'));
  const lines = good.toString('utf8').split('\n').filter(Boolean);
  fs.writeFileSync(path.join(dir, 'cima-ledger.jsonl'), [...lines.slice(0, 3), ...lines.slice(4)].join('\n') + '\n'); // delete one event in the middle
  const bad = verdict(await hook('valentin-1', 'Read', { file_path: path.join(home, 'a.ts') }));
  check('C1', 'a corrupted ledger closes governance at the real hook: LEDGER_CORRUPTED', bad.denied && /LEDGER_CORRUPTED/.test(bad.reason), bad.reason.slice(0, 100));
  check('C2', 'the independent verifier agrees the ledger is damaged', !verifyFromDisk(dir, key).ok);
  const view1 = await invoke(trusted, 'lapitaya:observability');
  check('C3', 'Alicia reports CORRUPTED and RECOVERY_REQUIRED, serves no ledger facts, and decides nothing', view1.health.status === 'CORRUPTED' && view1.health.recovery === 'RECOVERY_REQUIRED' && view1.recent.length === 0 && view1.health.codes.includes('SEQUENCE_GAP'), view1.health);
  const led = await invoke(trusted, 'lapitaya:ledger', 50);
  check('C4', 'the ledger channel serves nothing while the ledger does not verify', Array.isArray(led) && led.length === 0);
  const decideBad = await invoke(trusted, 'lapitaya:decide', 'apr-x', true);
  const confBad = await invoke(trusted, 'lapitaya:confirmRequest', req.id, 'x');
  check('C5', 'human decisions are refused while the ledger is damaged (no decision without durable evidence)', decideBad === null && confBad && confBad.ok === false && confBad.code === 'LEDGER_CORRUPTED', confBad && confBad.code);
  const noRepair = await invoke(trusted, 'lapitaya:recover', { scope: 'all' });
  const noRepair2 = await invoke(untrusted, 'lapitaya:repair');
  check('C6', 'the renderer has NO repair capability: no recover/repair channel exists', noRepair.__error && /No handler/.test(noRepair.__error) && noRepair2.__error && /No handler/.test(noRepair2.__error));
  fs.writeFileSync(path.join(dir, 'cima-ledger.jsonl'), good); // the operator restores the original bytes (an external repair)
  const healed = verdict(await hook('valentin-1', 'Read', { file_path: path.join(home, 'a.ts') }));
  const view2 = await invoke(trusted, 'lapitaya:observability');
  check('C7', 'after an external repair the verification passes again and Alicia shows RECOVERED (the repair was verified, not assumed)', !healed.denied && view2.health.status === 'HEALTHY' && view2.health.recovery === 'RECOVERED', view2.health);

  // ── 3. inconsistent proposal / invalid approval state ──
  const p2 = lapitaya.openRequest({ intentId: 'int-2', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'analiza el login', taskId: null, target: null, signals: [] });
  const pf = path.join(dir, 'proposals.json'); const origP = fs.readFileSync(pf, 'utf8');
  const rows = JSON.parse(origP); rows.find((x) => x.id === p2.id).status = 'CONFIRMED'; fs.writeFileSync(pf, JSON.stringify(rows));
  const inc = verdict(await hook('valentin-1', 'Read', { file_path: path.join(home, 'a.ts') }));
  const view3 = await invoke(trusted, 'lapitaya:observability');
  check('I1', 'a proposal edited to CONFIRMED on disk is INCONSISTENT with its events: governance closed, Alicia says so', inc.denied && /GOVERNANCE_STATE_INCONSISTENT/.test(inc.reason) && view3.health.status === 'INCONSISTENT' && view3.health.codes.includes('PROPOSAL_STATE_MISMATCH'), view3.health.codes);
  fs.writeFileSync(pf, origP);
  const cancelled = await invoke(trusted, 'lapitaya:cancelRequest', p2.id); // the human closes it (a pending request would hold the floor)
  check('I1b', 'with the proposal restored, the human cancels it through the trusted channel (an event-first transition)', cancelled && cancelled.ok === true, cancelled && cancelled.code);
  const PUSH2 = { command: 'git push origin feature-y' };
  await hook('valentin-1', 'Bash', PUSH2);
  const af = path.join(dir, 'approvals.json'); const origA = fs.readFileSync(af, 'utf8');
  const arows = JSON.parse(origA); const row = arows.find((x) => x.status === 'pending' && x.binding);
  row.status = 'approved'; row.decidedAt = 1; row.decidedBy = 'human';
  row.seal = sealApproval(key, { id: row.id, agentId: row.agentId, tool: row.tool, status: row.status, createdAt: row.createdAt, expiresAt: row.expiresAt, decidedAt: 1, decidedBy: 'human', decidedOwner: undefined, consumedAt: undefined, fingerprint: row.binding.fingerprint });
  fs.writeFileSync(af, JSON.stringify(arows));
  const forgedApproval = verdict(await hook('valentin-1', 'Bash', PUSH2));
  const view4 = await invoke(trusted, 'lapitaya:observability');
  check('I2', 'an approval "approved" in state with no HUMAN_APPROVED event — even with a valid seal — is never APPROVED', forgedApproval.denied && /GOVERNANCE_STATE_INCONSISTENT/.test(forgedApproval.reason) && view4.health.codes.includes('APPROVAL_UNEVIDENCED'), view4.health.codes);
  fs.writeFileSync(af, origA);
  const back = verdict(await hook('valentin-1', 'Read', { file_path: path.join(home, 'a.ts') }));
  check('I3', 'restoring the state files restores governance', !back.denied);

  // ── 4. real operator recovery (separate process, the shipped tool) ──
  const pre = fs.readFileSync(path.join(dir, 'cima-ledger.jsonl'));
  fs.writeFileSync(path.join(dir, 'cima-ledger.jsonl'), pre.subarray(0, pre.length - 60)); // crash-like truncation inside the last record
  const tr = verdict(await hook('valentin-1', 'Read', { file_path: path.join(home, 'a.ts') }));
  check('R1', 'a truncated final record is detected (TRUNCATED_TAIL) and governance closes', tr.denied && /LEDGER_CORRUPTED/.test(tr.reason) && /TRUNCATED_TAIL/.test(tr.reason), tr.reason.slice(0, 120));
  const cli = await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(ROOT, 'scripts', 'lapitaya-recover.cjs'), 'recover', '--hive', hive.root(), '--seal-key', keyFile, '--scope', 'all', '--operator', 'Electron Operator', '--confirm', 'RECOVER'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, out, err }));
  });
  let cliJson = null; try { cliJson = JSON.parse(cli.out); } catch { /* */ }
  check('R2', 'the operator tool recovers: exit 0, damaged ledger quarantined whole, verified prefix kept', cli.code === 0 && cliJson && cliJson.ok === true && cliJson.quarantined.some((q) => q.file.startsWith('cima-ledger.quarantine-')), (cliJson && cliJson.actions) || cli.err.slice(0, 200));
  const q = cliJson && cliJson.quarantined.find((x) => x.file.startsWith('cima-ledger.quarantine-'));
  check('R3', 'the quarantined file is byte-identical to the damaged ledger (evidence preserved)', q && sha(fs.readFileSync(path.join(dir, q.file))) === q.sha256 && sha(pre.subarray(0, pre.length - 60)) === q.sha256);
  const v3 = verifyFromDisk(dir, key);
  check('R4', 'INDEPENDENT verification of the recovered ledger passes; it ends with LEDGER_RECOVERED naming the operator', v3.ok && v3.types.at(-1).type === 'LEDGER_RECOVERED' && v3.types.at(-1).rec.operator.name === 'Electron Operator', v3.ok ? v3.types.at(-1).type : v3.why);
  const afterRecovery = verdict(await hook('valentin-1', 'Read', { file_path: path.join(home, 'a.ts') }));
  const view5 = await invoke(trusted, 'lapitaya:observability');
  check('R5', 'after recovery governance runs again and Alicia shows HEALTHY / RECOVERED', !afterRecovery.denied && view5.health.status === 'HEALTHY' && view5.health.recovery === 'RECOVERED', view5.health);
  const reasked = verdict(await hook('valentin-1', 'Bash', PUSH));
  check('R6', 'recovery invented nothing: the previously approved & consumed call needs a NEW human approval', reasked.denied && /HUMAN_APPROVAL_REQUIRED/.test(reasked.reason));
  const v4 = verifyFromDisk(dir, key); const ri = v4.ok ? v4.types.findIndex((x) => x.type === 'LEDGER_RECOVERED') : -1;
  check('R7', 'no HUMAN_APPROVED / APPROVAL_CONSUMED / REQUEST_CONFIRMED / TOOL_EXECUTED exists after the recovery boundary: nothing was invented', v4.ok && ri >= 0 && v4.types.slice(ri).every((x) => !['HUMAN_APPROVED', 'APPROVAL_CONSUMED', 'REQUEST_CONFIRMED', 'TOOL_EXECUTED'].includes(x.type)), v4.ok ? v4.types.slice(ri).map((x) => x.type).join(' › ') : v4.why);

  // ── 5. leakage / errors ──
  const secrets = [...Object.values(tokens), fs.readFileSync(keyFile, 'utf8').trim()];
  const macs = fs.readFileSync(path.join(dir, 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).eventMac).filter(Boolean);
  const leaked = secrets.filter((s) => seenByRenderer.some((v) => v.includes(s)));
  const macLeak = macs.filter((m) => seenByRenderer.some((v) => v.includes(m)));
  check('S1', 'no agent token, seal key or event MAC ever crossed IPC to a renderer', leaked.length === 0 && macLeak.length === 0 && seenByRenderer.length > 8, { crossings: seenByRenderer.length, leaked: leaked.length, macs: macLeak.length });
  check('S2', 'no renderer console errors / crashes', rendererErrors.length === 0, rendererErrors);
  check('E9', 'REAL El Inge (agent CLI) execution', false, 'NOT VALIDATED — no provider CLI/credentials are run by this harness');

  server.stop();
  fs.writeFileSync(path.join(OUT, 'electron_validation_v15.json'), JSON.stringify({ electron: process.versions.electron, node: process.versions.node, results }, null, 2));
  fs.writeFileSync(path.join(OUT, 'electron_validation_v15.txt'), `Electron ${process.versions.electron} (Node ${process.versions.node}, Chromium ${process.versions.chrome})\n` + results.map((r) => `${r.pass ? 'PASS' : (r.id === 'E9' ? 'NOT VALIDATED' : 'FAIL')}  ${r.id}  ${r.desc}${r.detail ? '  [' + r.detail.replace(/\s+/g, ' ').slice(0, 170) + ']' : ''}`).join('\n') + '\n');
  console.log(fs.readFileSync(path.join(OUT, 'electron_validation_v15.txt'), 'utf8'));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  app.exit(results.some((r) => !r.pass && r.id !== 'E9') ? 1 : 0);
}
main().catch((e) => { console.error('HARNESS ERROR', e && e.stack || e); app.exit(2); });
