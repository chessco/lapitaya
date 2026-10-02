'use strict';
/**
 * CIMA v0.16 — performance of capability resolution and authorize(), before (bfb4daf8 tree) and after (v0.16 tree).
 * Usage: node perf_v16.cjs <repoRoot> <label> [outJson]
 * Same machine, same inputs, same order; ledger in a fresh temp hive per run. Reports median / p95 in microseconds.
 */
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..'));
const LABEL = process.argv[3] || 'run';
const loadTs = require(path.join(ROOT, 'test', 'load-ts.cjs'));
const electron = require.resolve('electron', { paths: [ROOT] });
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
process.chdir(ROOT);
const tr = loadTs('src/shared/lapitaya/toolRisk.ts');
const gov = loadTs('src/shared/lapitaya/governance.ts');
let reg = null; try { reg = loadTs('src/shared/lapitaya/policyRegistry.ts'); } catch { /* baseline: no registry */ }
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');

const CALLS = [
  ['Read', { file_path: '/repo/src/a.ts' }], ['Write', { file_path: '/repo/src/a.ts', content: 'x' }], ['Edit', { file_path: '/repo/README.md', old_string: 'a', new_string: 'b' }],
  ['Bash', { command: 'ls -la' }], ['Bash', { command: 'echo x > out.txt' }], ['Bash', { command: 'npm run gen' }], ['mcp__github__create_issue', { title: 'x' }], ['Task', { description: 'x' }]
];
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const us = (ns) => Number(ns) / 1000;
function bench(name, n, fn) {
  for (let i = 0; i < Math.min(200, n); i++) fn(i); // warm-up
  const t = [];
  for (let i = 0; i < n; i++) { const s = process.hrtime.bigint(); fn(i); t.push(us(process.hrtime.bigint() - s)); }
  return { name, n, medianUs: +q(t, 0.5).toFixed(2), p95Us: +q(t, 0.95).toFixed(2), meanUs: +(t.reduce((a, b) => a + b, 0) / n).toFixed(2) };
}
const out = { label: LABEL, root: ROOT, node: process.version, platform: process.platform, hasRegistry: !!reg, results: [] };
out.results.push(bench('classifyToolCall (pure)', 20000, (i) => { const [t, x] = CALLS[i % CALLS.length]; tr.classifyToolCall(t, x); }));
if (reg) {
  out.results.push(bench('resolveCapability (registry lookup)', 20000, (i) => {
    const [t, x] = CALLS[i % CALLS.length]; const b = reg.POLICY_REGISTRY.getToolPolicy(t);
    reg.POLICY_REGISTRY.resolveCapability({ provider: 'claude', tool: t, operation: tr.operationOf(b.classifier, tr.classifyToolCall(t, x)) });
  }));
}
out.results.push(bench('authorizeToolCall (pure decision)', 20000, (i) => { const [t, x] = CALLS[i % CALLS.length]; gov.authorizeToolCall({ agentId: 'a-1', tool: t, input: x, provider: 'claude' }); }));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v016-perf-'));
const hive = path.join(home, 'hive'); fs.mkdirSync(path.join(hive, 'lapitaya'), { recursive: true });
const rt = new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', providerOf: () => 'claude' });
out.results.push(bench('CimaRuntimeService.authorize (lock + ledger event + fsync)', 400, (i) => { const [t, x] = CALLS[i % CALLS.length]; rt.authorize('a-1', t, x); }));
fs.rmSync(home, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 2));
if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 2) + '\n');
