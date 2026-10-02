'use strict';
// CIMA v0.16 — reproduce the v0.15 (bfb4daf8) provider/tool/capability resolution BEFORE any change.
// Run: node evidence/lapitaya-cima-v0.16-governance-policy-registry/baseline/reproduce_baseline.cjs
const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const ROOT = path.resolve(__dirname, '..', '..', '..');
process.chdir(ROOT);
const loadTs = require(path.join(ROOT, 'test', 'load-ts.cjs'));
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const pg = loadTs('src/shared/lapitaya/providerGovernance.ts');
const tr = loadTs('src/shared/lapitaya/toolRisk.ts');
const ap = loadTs('src/shared/agentProvider.ts');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
log('## providers (governanceEnforcement / spawnGovernanceDecision)');
for (const p of ap.AGENT_PROVIDER_PRESETS.map((x) => x.id).concat(['evil-provider', '', 'CLAUDE'])) {
  const d = pg.spawnGovernanceDecision(p); const o = pg.spawnGovernanceDecision(p, { allowUngoverned: true });
  log(`${JSON.stringify(p).padEnd(16)} enforcement=${pg.governanceEnforcement(p).padEnd(13)} allowed=${d.allowed} optIn.allowed=${o.allowed} optIn.overridden=${!!o.overridden}`);
}
log('\n## tools (classifyToolCall)');
const calls = [['Read', { file_path: 'src/a.ts' }], ['Write', { file_path: 'src/a.ts' }], ['Edit', { file_path: 'README.md' }], ['Bash', { command: 'ls' }],
  ['Bash', { command: 'echo x > out.txt' }], ['Bash', { command: 'echo x > hive/lapitaya/approvals.json' }], ['Bash', { command: 'rm -rf /' }], ['Bash', { command: 'git push' }],
  ['mcp__github__create_issue', {}], ['Task', { description: 'x' }], ['WebFetch', { url: 'x' }], ['FrobnicateTool', {}], ['write_file', { file_path: 'a.ts' }], ['', {}]];
for (const [t, i] of calls) { const r = tr.classifyToolCall(t, i); log(`${JSON.stringify(t).padEnd(28)} ${JSON.stringify(i).slice(0, 48).padEnd(50)} category=${r.category.padEnd(18)} risk=${r.risk.padEnd(6)} rule=${r.rule}`); }
log('\n## runtime authorize() — unknown tool / unknown provider / mcp');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v016-base-')); const hive = path.join(home, 'hive'); fs.mkdirSync(path.join(hive, 'lapitaya'), { recursive: true });
let prov = 'claude';
const rt = new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', providerOf: () => prov });
for (const [p, t, i] of [['claude', 'FrobnicateTool', {}], ['claude', 'mcp__x__y', {}], ['evil-provider', 'Read', { file_path: path.join(home, 'a.ts') }], ['evil-provider', 'Bash', { command: 'git push' }]]) {
  prov = p; const a = rt.authorize('agent-1', t, i);
  log(`provider=${p.padEnd(14)} tool=${t.padEnd(16)} decision=${a.decision.padEnd(24)} risk=${a.risk} rule=${a.rule}`);
}
const last = fs.readFileSync(path.join(hive, 'lapitaya', 'cima-ledger.jsonl'), 'utf8').trim().split('\n').pop();
log('\nlast governance event keys: ' + Object.keys(JSON.parse(last)).join(','));
log('policyVersion present on event: ' + ('policyVersion' in JSON.parse(last)));
fs.writeFileSync(path.join(__dirname, 'reproduce_baseline.txt'), out.join('\n') + '\n');
fs.rmSync(home, { recursive: true, force: true });
