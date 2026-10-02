'use strict';
/**
 * v0.15 ledger performance: how long does it take to VERIFY the chain and to AUTHORIZE, as the ledger grows?
 * Builds valid chains of N events directly (same code the runtime uses), then measures with real CimaRuntimeService instances.
 *   node measure.cjs            → prints a table and writes results.json
 */
const R = require('path').resolve(__dirname, '..', '..', '..');
const loadTs = require(R + '/test/load-ts.cjs');
const electron = require.resolve(R + '/node_modules/electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const fs = require('fs'), os = require('os'), p = require('path');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const chain = loadTs('src/main/ledgerChain.ts');
const { loadOrCreateKey } = loadTs('src/main/authBinding.ts');
const console_error = console.error; console.error = () => {};

function buildChain(dir, n) {
  fs.mkdirSync(dir, { recursive: true });
  const key = loadOrCreateKey(p.join(dir, '.seal.key'));
  let prev = chain.GENESIS_HASH; const out = [];
  for (let i = 1; i <= n; i++) {
    const e = chain.stampEvent({ kind: 'governance', ts: 1_700_000_000_000 + i, agentId: 'agent-1', taskId: null, phase: null, tool: 'Read', action: `read f${i}.ts`, category: 'read-code', risk: 'LOW', mode: 'AUTO', decision: 'ALLOW', rule: 'read', fingerprint: 'deadbeef' }, i, prev, key);
    out.push(JSON.stringify(e)); prev = e.eventHash;
  }
  fs.writeFileSync(p.join(dir, 'cima-ledger.jsonl'), out.join('\n') + '\n');
  fs.writeFileSync(p.join(dir, 'ledger-head.json'), JSON.stringify(chain.makeAnchor(key, n, prev, Date.now())));
  return key;
}
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const rows = [];
for (const n of [1000, 10000, 50000, 100000]) {
  const d = fs.mkdtempSync(p.join(os.tmpdir(), 'v15perf-')); const hive = p.join(d, 'hive'); const dir = p.join(hive, 'lapitaya');
  const bytes0 = (buildChain(dir, n), fs.statSync(p.join(dir, 'cima-ledger.jsonl')).size);
  const mk = () => new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god' });
  const A = mk();
  let t0 = process.hrtime.bigint(); const v = A.verifyGovernanceState({ full: true }); const fullVerify = ms(t0);
  const status = v.status;
  const B = mk();
  t0 = process.hrtime.bigint(); B.authorize('agent-1', 'Read', { file_path: 'cold.ts' }); const firstAuthorize = ms(t0);
  const k = 30; t0 = process.hrtime.bigint(); for (let i = 0; i < k; i++) B.authorize('agent-1', 'Read', { file_path: `s${i}.ts` }); const steady = ms(t0) / k;
  // another process appends; this instance verifies only the delta
  const C = mk(); C.authorize('agent-2', 'Read', { file_path: 'other.ts' });
  t0 = process.hrtime.bigint(); B.authorize('agent-1', 'Read', { file_path: 'after-other.ts' }); const afterForeignAppend = ms(t0);
  t0 = process.hrtime.bigint(); B.verifyGovernanceState(); const incrementalVerify = ms(t0);
  t0 = process.hrtime.bigint(); B.ledger(200); const readTail = ms(t0);
  rows.push({ events: n, ledgerBytes: bytes0, status, fullVerifyMs: +fullVerify.toFixed(1), firstAuthorizeColdMs: +firstAuthorize.toFixed(1), steadyAuthorizeMs: +steady.toFixed(2), authorizeAfterForeignAppendMs: +afterForeignAppend.toFixed(2), incrementalVerifyMs: +incrementalVerify.toFixed(2), readTailMs: +readTail.toFixed(2) });
  fs.rmSync(d, { recursive: true, force: true });
}
console.error = console_error;
const v014 = [{ events: 1000, authorizeMs: 7.4 }, { events: 10000, authorizeMs: 36.8 }, { events: 50000, authorizeMs: 129.4 }];
fs.writeFileSync(p.join(__dirname, 'results.json'), JSON.stringify({ node: process.version, platform: process.platform, v015: rows, v014_baseline_authorize_ms: v014 }, null, 2));
const head = 'events   bytes      status   fullVerify  firstAuthorize(cold)  steadyAuthorize  afterForeignAppend  incrementalVerify  readTail';
console.log(head);
for (const r of rows) console.log(`${String(r.events).padEnd(8)} ${String(r.ledgerBytes).padEnd(10)} ${r.status.padEnd(8)} ${String(r.fullVerifyMs).padEnd(11)} ${String(r.firstAuthorizeColdMs).padEnd(21)} ${String(r.steadyAuthorizeMs).padEnd(16)} ${String(r.authorizeAfterForeignAppendMs).padEnd(19)} ${String(r.incrementalVerifyMs).padEnd(18)} ${r.readTailMs}`);
console.log('\nv0.14 baseline (per authorize, every call rereads the whole ledger):', v014.map((x) => `${x.events}→${x.authorizeMs} ms`).join(', '));
