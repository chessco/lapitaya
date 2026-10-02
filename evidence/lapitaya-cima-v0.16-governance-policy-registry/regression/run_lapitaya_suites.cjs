'use strict';
// Runs every La Pitaya suite in its own `node --test` process (4 at a time) and prints exact per-suite counts.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const ORDER = [
  ['Foundation', 'lapitaya-foundation'], ['v0.2', 'lapitaya-cima-runtime'], ['v0.3', 'lapitaya-cima-runtime-v03'], ['v0.3.1', 'lapitaya-cima-runtime-v031'],
  ['v0.4', 'lapitaya-alicia-v04'], ['v0.4.1', 'lapitaya-alicia-v041'], ['v0.4.2', 'lapitaya-alicia-v042'], ['v0.5', 'lapitaya-alicia-v05'],
  ['v0.6', 'lapitaya-alicia-v06'], ['v0.7', 'lapitaya-alicia-v07'], ['v0.8', 'lapitaya-alicia-v08'], ['v0.9', 'lapitaya-alicia-v09'],
  ['v0.10', 'lapitaya-cima-v0.10'], ['v0.11', 'lapitaya-cima-v0.11'], ['v0.12', 'lapitaya-cima-v0.12'], ['v0.14', 'lapitaya-cima-v0.14'], ['v0.15', 'lapitaya-cima-v0.15'], ['v0.16', 'lapitaya-cima-v0.16']
];
const run = ([label, file]) => new Promise((resolve) => {
  const p = spawn(process.execPath, ['--test', '--test-reporter=spec', path.join('test', `${file}.test.cjs`)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => {
    const n = (k) => Number((new RegExp(`^ℹ ${k} (\\d+)`, 'm').exec(out) || [0, NaN])[1]);
    fs.writeFileSync(path.join(__dirname, 'suites', `${file}.txt`), out);
    resolve({ label, file, tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), code });
  });
});
(async () => {
  fs.mkdirSync(path.join(__dirname, 'suites'), { recursive: true });
  const results = []; const queue = [...ORDER];
  await Promise.all([0, 1, 2, 3].map(async () => { while (queue.length) results.push(await run(queue.shift())); }));
  results.sort((a, b) => ORDER.findIndex((o) => o[0] === a.label) - ORDER.findIndex((o) => o[0] === b.label));
  const lines = results.map((r) => `${r.label.padEnd(11)} ${r.file.padEnd(28)} tests ${String(r.tests).padStart(3)}  pass ${String(r.pass).padStart(3)}  fail ${String(r.fail).padStart(2)}  skipped ${r.skipped}`);
  const tot = results.reduce((a, r) => ({ t: a.t + r.tests, p: a.p + r.pass, f: a.f + r.fail, s: a.s + r.skipped }), { t: 0, p: 0, f: 0, s: 0 });
  lines.push(`${'TOTAL'.padEnd(11)} ${''.padEnd(28)} tests ${String(tot.t).padStart(3)}  pass ${String(tot.p).padStart(3)}  fail ${String(tot.f).padStart(2)}  skipped ${tot.s}`);
  fs.writeFileSync(path.join(__dirname, 'lapitaya-suites-summary.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  process.exit(tot.f ? 1 : 0);
})();
