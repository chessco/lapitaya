#!/usr/bin/env node
'use strict';
/**
 * La Pitaya CIMA v0.15 — operator tooling for the governance ledger.
 *
 *   node scripts/lapitaya-recover.cjs verify  --hive <dir> [--seal-key <file>] [--full]
 *   node scripts/lapitaya-recover.cjs history --hive <dir> [--seal-key <file>]
 *   node scripts/lapitaya-recover.cjs recover --hive <dir> [--seal-key <file>] --scope ledger|state|all \
 *                                             --operator "<your name>" --confirm RECOVER
 *
 * Run it with La Pitaya CLOSED (the runtime's own lock protects a running app, but a recovery is an operator decision,
 * not something to race against agents). It needs the SAME seal key the app uses (default: <hive>/lapitaya/.seal.key,
 * the layout of tests and tools; the app keeps it at <userData>/lapitaya-governance-seal.key — pass it with --seal-key).
 *
 * What recovery does and does not do (full text: docs/LA_PITAYA_CIMA_RUNTIME_15_GOVERNANCE_EVENT_INTEGRITY.md):
 *   - the damaged ledger is KEPT, whole, as cima-ledger.quarantine-<ts>-<sha8>.jsonl; it is never edited;
 *   - the new ledger is the verified prefix, byte for byte, plus ONE LEDGER_RECOVERED event naming the quarantine,
 *     its SHA-256, the first bad line and you;
 *   - events at and after the first defect are NOT replayed — what only they established is simply no longer established;
 *   - nothing is ever created as APPROVED / CONFIRMED / PASS / EXECUTED.
 * It is not reachable from the application, the renderer, an agent or Alicia.
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : undefined; };
const flag = (name) => args.includes(`--${name}`);
const die = (msg) => { console.error(msg); process.exit(2); };

if (!['verify', 'history', 'recover'].includes(cmd)) die('usage: lapitaya-recover.cjs verify|history|recover --hive <dir> [--seal-key <file>] ...');
const hive = opt('hive');
if (!hive || !fs.existsSync(hive)) die('--hive <the hive directory> is required');

const ROOT = path.resolve(__dirname, '..');
// the runtime imports electron for notifications only in other modules; none of the loaded ones needs it
const loadTs = require(path.join(ROOT, 'test', 'load-ts.cjs'));
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { loadOrCreateKey } = loadTs('src/main/authBinding.ts');

const keyFile = opt('seal-key');
const key = keyFile ? (fs.existsSync(keyFile) ? loadOrCreateKey(keyFile) : null) : undefined;
if (keyFile && !key) die(`cannot read the seal key at ${keyFile}`);
const rt = new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', ...(key ? { sealKey: () => key } : {}) });

if (cmd === 'verify') {
  const v = rt.verifyGovernanceState({ full: flag('full') });
  console.log(JSON.stringify(v, null, 2));
  process.exit(v.status === 'HEALTHY' ? 0 : 1);
}
if (cmd === 'history') {
  console.log(JSON.stringify(rt.recoveryHistory(), null, 2));
  process.exit(0);
}
const scope = opt('scope');
if (!['ledger', 'state', 'all'].includes(scope)) die('--scope ledger|state|all is required');
const operator = opt('operator');
if (!operator) die('--operator "<your name>" is required: the recovery is recorded under it');
const res = rt.recover({ scope, operator: { name: operator, os: os.userInfo().username, host: os.hostname() }, confirm: opt('confirm') ?? '' });
console.log(JSON.stringify(res, null, 2));
process.exit(res.ok ? 0 : 1);
