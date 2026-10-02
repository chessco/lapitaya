'use strict';
// Prints, for each spelling of the governance file: its canonical key, ambiguity, and the runtime's decision (v0.14).
const R = require('path').resolve(__dirname, '..', '..', '..');
const loadTs = require(R + '/test/load-ts.cjs');
const electron = require.resolve(R + '/node_modules/electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const fs = require('fs'), os = require('os'), p = require('path');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const subj = loadTs('src/shared/lapitaya/authSubject.ts');
const d = fs.mkdtempSync(p.join(os.tmpdir(), 'v14pt-')); const hive = p.join(d, 'hive'); fs.mkdirSync(p.join(hive, 'lapitaya'), { recursive: true });
let cwd = hive;
const rt = new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', cwdOf: () => cwd });
const h = hive.replace(/\\/g, '/');
const rows = [
  ['absolute', `${h}/lapitaya/approvals.json`], ['backslashes', hive + '\\lapitaya\\approvals.json'],
  ['dot segment', `${h}/./lapitaya/approvals.json`], ['dot-dot', `${h}/agents/x/../../lapitaya/approvals.json`],
  ['dot-dot via other drive path', `C:/Windows/../${h.slice(3)}/lapitaya/approvals.json`],
  ['duplicate separators', `${h}//lapitaya//approvals.json`], ['case variant', `${h}/LAPITAYA/Approvals.JSON`],
  ['trailing dot', `${h}/lapitaya./approvals.json`], ['trailing space', `${h}/lapitaya /approvals.json`],
  ['extended-length prefix', '//?/' + h + '/lapitaya/approvals.json'],
  ['relative (cwd = hive)', 'lapitaya/approvals.json'], ['relative dot-dot (cwd = hive)', 'agents/x/../../lapitaya/approvals.json'],
  ['percent-encoded dot-dot', `${h}/%2e%2e/lapitaya/approvals.json`], ['NTFS stream', `${h}/lapitaya/approvals.json::$DATA`],
  ['drive-relative', 'C:lapitaya/approvals.json'], ['file: URL', 'file:///' + h + '/lapitaya/approvals.json'],
  ['8.3 short name that exists (expanded by the filesystem)', 'C:/PROGRA~1/x/lapitaya/approvals.json'], ['8.3 short name that cannot be expanded', 'C:/NOSUCH~1/x/lapitaya/approvals.json'], ['escapes the root', 'C:/../lapitaya/approvals.json']
];
console.log('spelling'.padEnd(34), 'ambiguous'.padEnd(10), 'canonical key (tail)'.padEnd(36), 'decision / category');
for (const [name, raw] of rows) {
  const c = subj.canonicalizePath(raw, { base: hive });
  const a = rt.authorize('agent-1', 'Write', { file_path: raw, content: '[]' });
  console.log(name.padEnd(34), String(c.ambiguous).padEnd(10), (c.ambiguous ? '(' + c.reason + ')' : c.key.slice(-34)).padEnd(36), `${a.decision} / ${a.category}`);
}
fs.rmSync(d, { recursive: true, force: true });
