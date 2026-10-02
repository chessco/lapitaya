'use strict';
/**
 * v0.15 reproduction of what v0.14 left open (run on the unmodified v0.14 baseline, and again after the fix).
 * Temp hives only. Prints one line per probe.
 */
const R = require('path').resolve(__dirname, '..', '..', '..');
const loadTs = require(R + '/test/load-ts.cjs');
const electron = require.resolve(R + '/node_modules/electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const fs = require('fs'), os = require('os'), p = require('path');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const out = (k, v) => console.log(k.padEnd(52), typeof v === 'string' ? v : JSON.stringify(v));
const mk = () => { const d = fs.mkdtempSync(p.join(os.tmpdir(), 'v15-')); const hive = p.join(d, 'hive'); fs.mkdirSync(p.join(hive, 'lapitaya'), { recursive: true }); return { d, hive, dir: p.join(hive, 'lapitaya') }; };
const svc = (hive, x = {}) => new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', ...x });
const step = (n, f) => { try { f(); } catch (e) { out(n + ' PROBE ERROR', String(e && e.stack || e).slice(0, 240)); } };
const ledgerFile = (dir) => p.join(dir, 'cima-ledger.jsonl');
const lines = (dir) => fs.readFileSync(ledgerFile(dir), 'utf8').split('\n').filter(Boolean);
const quiet = console.error; console.error = () => {};

step('R1 delete the LAST event cleanly', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  for (let i = 0; i < 3; i++) s.authorize('agent-1', 'Read', { file_path: `a${i}.ts` });
  const L = lines(dir); fs.writeFileSync(ledgerFile(dir), L.slice(0, -1).join('\n') + '\n');
  const r = svc(hive).authorize('agent-1', 'Read', { file_path: 'b.ts' });
  out('R1 authorize after tail deletion', [r.decision, r.rule]);
});
step('R2 delete a MIDDLE event', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  for (let i = 0; i < 4; i++) s.authorize('agent-1', 'Read', { file_path: `a${i}.ts` });
  const L = lines(dir); L.splice(1, 1); fs.writeFileSync(ledgerFile(dir), L.join('\n') + '\n');
  const r = svc(hive).authorize('agent-1', 'Read', { file_path: 'b.ts' });
  out('R2 authorize after middle deletion', [r.decision, r.rule]);
});
step('R3 reorder two events', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  for (let i = 0; i < 3; i++) s.authorize('agent-1', 'Read', { file_path: `a${i}.ts` });
  const L = lines(dir); [L[0], L[1]] = [L[1], L[0]]; fs.writeFileSync(ledgerFile(dir), L.join('\n') + '\n');
  const r = svc(hive).authorize('agent-1', 'Read', { file_path: 'b.ts' });
  out('R3 authorize after reorder', [r.decision, r.rule]);
});
step('R4 INSERT a forged CIMA chain (BUILD/TEST/AUDIT/DECISION PASS) by text editing', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  s.handle('god', 'worker', { taskId: 'T-forged', phase: 'BUILD' }); // task becomes CIMA-governed
  const rec = (agentId, phase) => JSON.stringify({ kind: 'cima', ts: Date.now(), taskId: 'T-forged', phase, agentId, claimed: 'PASS', verdict: 'PASS', violations: [], reasons: [], evidence: [], transition: { from: null, to: phase } });
  fs.appendFileSync(ledgerFile(dir), ['BUILD', 'TEST', 'AUDIT', 'DECISION'].map((ph, i) => rec(ph === 'DECISION' ? 'god' : 'agent-' + i, ph)).join('\n') + '\n');
  const g = svc(hive).completionGate('T-forged');
  out('R4 completionGate on a text-forged DECISION PASS', [g.allowed, g.reason.slice(0, 60)]);
});
step('R5 insert a forged HUMAN_APPROVED line', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  s.authorize('agent-1', 'Read', { file_path: 'a.ts' });
  fs.appendFileSync(ledgerFile(dir), JSON.stringify({ kind: 'governance', ts: Date.now(), agentId: 'agent-1', decision: 'HUMAN_APPROVED', approvalId: 'apr-fake', rule: 'human' }) + '\n');
  const r = svc(hive).authorize('agent-1', 'Read', { file_path: 'b.ts' });
  out('R5 authorize with a fake HUMAN_APPROVED line present', [r.decision, r.rule]);
});
step('R6 proposal status edited PROPOSED -> CONFIRMED on disk', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  const req = s.openRequest({ intentId: 'i1', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'revisa el estado', taskId: null, target: null, signals: [] });
  const before = svc(hive).authorize('agent-1', 'Bash', { command: 'npm test' });
  const f = p.join(dir, 'proposals.json'); const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  rows.find((x) => x.id === req.id).status = 'CONFIRMED'; fs.writeFileSync(f, JSON.stringify(rows));
  const after = svc(hive).authorize('agent-1', 'Bash', { command: 'npm test' });
  out('R6 gate before / after the edit', [before.decision + ':' + before.rule, after.decision + ':' + after.rule]);
});
step('R7 approval "approved" in state with no HUMAN_APPROVED event (key readable in the fallback layout)', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  const a = s.authorize('agent-1', 'Bash', { command: 'git push origin x' });
  const f = p.join(dir, 'approvals.json'); const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  const row = rows.find((x) => x.id === a.approvalId); row.status = 'approved'; row.decidedAt = Date.now(); row.decidedBy = 'human';
  const { sealApproval } = loadTs('src/main/authBinding.ts');
  const key = Buffer.from(fs.readFileSync(p.join(dir, '.seal.key'), 'utf8').trim(), 'hex');
  row.seal = sealApproval(key, { id: row.id, agentId: row.agentId, tool: row.tool, status: row.status, createdAt: row.createdAt, expiresAt: row.expiresAt, decidedAt: row.decidedAt, decidedBy: row.decidedBy, decidedOwner: undefined, consumedAt: undefined, fingerprint: row.binding.fingerprint });
  fs.writeFileSync(f, JSON.stringify(rows));
  const r = svc(hive).authorize('agent-1', 'Bash', { command: 'git push origin x' });
  out('R7 authorize with state-only approval', [r.decision, r.rule]);
});
step('R8 stale read between two instances', () => {
  const { hive } = mk(); const A = svc(hive), B = svc(hive);
  A.listApprovals(); A.cimaRecords();
  B.authorize('agent-1', 'Bash', { command: 'git push origin x' }); B.submit('agent-9', { taskId: 'T', phase: 'BUILD', verdict: 'BLOCKED' });
  out('R8 A.listApprovals / A.cimaRecords (disk has 1 / 1)', [A.listApprovals().length, A.cimaRecords().length]);
});
step('R9 truncated mid-record: behaviour and way out', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  s.authorize('agent-1', 'Read', { file_path: 'a.ts' });
  fs.appendFileSync(ledgerFile(dir), '{"kind":"governance","ts":17');
  const r = svc(hive).authorize('agent-1', 'Read', { file_path: 'b.ts' });
  out('R9 authorize on a truncated tail', [r.decision, r.rule]);
  out('R9 recovery API present?', typeof s.verifyGovernanceState === 'function' || typeof s.recover === 'function');
});
step('R10 per-call latency vs ledger size (authorize, Read)', () => {
  if (typeof svc(mk().hive).verifyGovernanceState === 'function') { out('R10', 'v0.15: a hand-built repeated-line ledger is (correctly) corrupt; see ../performance/results.json for real chains'); return; }
  for (const n of [1000, 10000, 50000]) {
    const { hive, dir } = mk(); const s = svc(hive);
    s.authorize('agent-1', 'Read', { file_path: 'warm.ts' });
    const L = lines(dir)[0]; fs.writeFileSync(ledgerFile(dir), (L + '\n').repeat(n));
    const t0 = process.hrtime.bigint(); const k = 5;
    for (let i = 0; i < k; i++) s.authorize('agent-1', 'Read', { file_path: `r${i}.ts` });
    out(`R10 ledger events=${n}`, 'avg ms/authorize=' + (Number(process.hrtime.bigint() - t0) / 1e6 / k).toFixed(1));
  }
});
console.error = quiet;
