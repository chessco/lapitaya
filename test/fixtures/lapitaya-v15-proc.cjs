'use strict';
/**
 * Child process for the v0.15 multi-process tests. Usage: node lapitaya-v15-proc.cjs <mode> <hiveRoot> <arg…>
 *   writer   <hive> <agent> <n>      n × { HIGH call → human approval → exact call (consumes it) } plus LOW calls and traces
 *   reader   <hive> <ms>             governanceSnapshot() / verify / ledger() / cimaRecords() in a loop; prints every observation
 *   verifier <hive> <ms>             verifyGovernanceState({ full: true }) in a loop
 * Output: one JSON object per line.
 */
const path = require('node:path');
const loadTs = require('../load-ts.cjs');
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { TRUSTED_HUMAN } = require('./human.cjs');

const [mode, hive, a1, a2] = process.argv.slice(2);
console.error = () => {};
const rt = new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', lockTimeoutMs: 30000 });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (mode === 'writer') {
  const agent = a1; const n = Number(a2);
  let denied = 0;
  for (let i = 0; i < n; i++) {
    const call = { command: `git push origin ${agent}-${i}` };
    const first = rt.authorize(agent, 'Bash', call);
    if (first.decision !== 'HUMAN_APPROVAL_REQUIRED') denied++;
    const decided = rt.decide(first.approvalId, true, 'human', TRUSTED_HUMAN);
    if (!decided) denied++;
    const run = rt.authorize(agent, 'Bash', call);
    if (run.decision !== 'APPROVED') denied++;
    const read = rt.authorize(agent, 'Read', { file_path: path.join(hive, `r-${agent}-${i}.ts`) });
    if (read.decision !== 'ALLOW') denied++;
    rt.recordTrace(agent, 'PostToolUse', 'Read', { file_path: path.join(hive, `r-${agent}-${i}.ts`) }, 'ok');
  }
  out({ mode, agent, n, denied });
} else if (mode === 'reader') {
  const until = Date.now() + Number(a1);
  let lastHead = 0; let snaps = 0; const violations = [];
  while (Date.now() < until) {
    const s = rt.governanceSnapshot({ ledgerLimit: 50000 });
    snaps++;
    if (!s.health) { violations.push('no health'); continue; }
    if (s.health.status !== 'HEALTHY') violations.push(`status ${s.health.status} ${s.health.codes.join(',')}`);
    const head = s.health.headSequence;
    if (head < lastHead) violations.push(`head went backwards ${lastHead} → ${head}`);
    lastHead = head;
    const tail = s.ledger.at(-1);
    if (tail && tail.sequence !== head) violations.push(`ledger tail ${tail.sequence} ≠ verified head ${head}`);
    const human = new Set(s.ledger.filter((e) => e.decision === 'HUMAN_APPROVED').map((e) => e.approvalId));
    for (const a of s.approvals) if ((a.status === 'approved' || a.status === 'consumed') && !human.has(a.id)) violations.push(`approval ${a.id} ${a.status} without its HUMAN_APPROVED event in the same snapshot`);
    const seqs = s.ledger.map((e) => e.sequence).filter((x) => typeof x === 'number');
    for (let i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1] + 1) { violations.push(`gap/duplicate in one snapshot: ${seqs[i - 1]} → ${seqs[i]}`); break; }
  }
  out({ mode, snaps, lastHead, violations: violations.slice(0, 10), violationCount: violations.length });
} else if (mode === 'verifier') {
  const until = Date.now() + Number(a1);
  let runs = 0; const bad = []; let lastHead = 0;
  while (Date.now() < until) {
    const v = rt.verifyGovernanceState({ full: true });
    runs++;
    if (v.status !== 'HEALTHY') bad.push(`${v.status}:${v.findings.filter((f) => f.severity === 'error').map((f) => f.code).join(',')}`);
    if (v.ledger.headSequence < lastHead) bad.push('head went backwards');
    lastHead = v.ledger.headSequence;
  }
  out({ mode, runs, lastHead, bad: bad.slice(0, 10), badCount: bad.length });
}
