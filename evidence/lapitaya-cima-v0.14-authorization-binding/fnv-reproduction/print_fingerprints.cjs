'use strict';
// Prints the legacy FNV-32 and the v0.14 SHA-256 authorization fingerprints of CALL A and CALL B (temp hive only).
const R = require('path').resolve(__dirname, '..', '..', '..');
const loadTs = require(R + '/test/load-ts.cjs');
const electron = require.resolve(R + '/node_modules/electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const fs = require('fs'), os = require('os'), p = require('path');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const gov = loadTs('src/shared/lapitaya/governance.ts');
const { craft } = require('./repro_v013_findings.cjs');
const d = fs.mkdtempSync(p.join(os.tmpdir(), 'v14fp-')); const hive = p.join(d, 'hive'); fs.mkdirSync(p.join(hive, 'lapitaya'), { recursive: true });
const rt = new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god' });
const A = { command: 'git push origin feature-x' };
const fnvA = gov.toolCallFingerprint('agent-1', 'Bash', A);
const cmdB = craft('agent-1', 'Bash', 'rm -rf /important/data # ', parseInt(fnvA, 16));
const B = { command: cmdB };
const a = rt.authorize('agent-1', 'Bash', A);
rt.decide(a.approvalId, true, 'human');
const b = rt.authorize('agent-1', 'Bash', B);
const a2 = rt.authorize('agent-1', 'Bash', A);
console.log(JSON.stringify({
  callA: A.command, fnvA, sha256A: a.authFingerprint,
  callB: cmdB, fnvB: gov.toolCallFingerprint('agent-1', 'Bash', B), sha256B: b.authFingerprint,
  newResultB: [b.decision, b.category, b.rule], newResultAAfterApproval: [a2.decision]
}, null, 2));
fs.rmSync(d, { recursive: true, force: true });
