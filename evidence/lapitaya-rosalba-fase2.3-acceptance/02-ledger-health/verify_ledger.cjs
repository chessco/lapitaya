// Read-only ledger verification on a COPY of the live hive's governance files (the live hive is never opened).
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = 'C:/PitayaCode/LaPitaya';
const loadTs = require(path.join(ROOT, 'test', 'load-ts.cjs'));
const electron = require.resolve('electron', { paths: [ROOT] });
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const src = 'C:/Users/chess/HarnessAgents/hive/lapitaya';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-verify-'));
fs.cpSync(src, path.join(tmp, 'lapitaya'), { recursive: true });
const { loadOrCreateKey } = loadTs('src/main/authBinding.ts');
const keyFile = path.join(process.env.APPDATA, 'munder-difflin', 'lapitaya-governance-seal.key');
if (!fs.existsSync(keyFile)) throw new Error('no seal key');
const key = loadOrCreateKey(keyFile); // read-only: the file exists
const rt = new CimaRuntimeService({ hiveRoot: () => tmp, godId: () => 'god', sealKey: () => key, lockTimeoutMs: 2000 });
const v = rt.verifyGovernanceState({ full: true });
const lines = fs.readFileSync(path.join(tmp, 'lapitaya', 'cima-ledger.jsonl'), 'utf8').trim().split('\n');
const last = JSON.parse(lines[lines.length - 1]);
console.log(JSON.stringify({ at: new Date().toISOString(), status: v.status, recovery: v.recovery, mode: v.mode, ledger: { events: v.ledger.events, headSequence: v.ledger.headSequence, headHash: String(v.ledger.headHash).slice(0, 12) + '…', legacyEvents: v.ledger.legacyEvents, legacyUnverified: v.ledger.legacyUnverified }, lastLineSequence: last.sequence, findings: (v.findings || []).map((f) => ({ code: f.code, severity: f.severity, file: f.file })) }, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
