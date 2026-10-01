const { connect } = require('./cdp8.cjs');
const { sleep, log, out } = require('./flow8a.cjs');
const fs = require('fs'); const path = require('path'); const http = require('http');
const pageIds = () => new Promise(r => http.get('http://127.0.0.1:9335/json', x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(JSON.parse(d).filter(t => t.type === 'page').map(t => t.id))); }));
const humanTab = async (c) => { await c.ev(`(()=>{const t=[...document.querySelectorAll('button')].find(b=>/^(pregúntame|ask me)/i.test(b.innerText.trim()));t&&t.click()})()`); await sleep(2500); return c.ev('!!document.querySelector("[data-decision-center]")'); };
(async () => {
  let M = null;
  for (const id of await pageIds()) { const c = await connect(9335, id); if (!M && await humanTab(c)) M = c; else c.close(); }
  const who = await M.ev('window.cth.lapitayaIdentity()');
  await M.ev('(()=>{const d=document.querySelector("[data-decision-center] [data-field=history]");d&&(d.open=true)})()'); await sleep(500);
  log('es-history', await M.ev('[...document.querySelectorAll("[data-decision-center] [data-field=decision-owner]")].map(e=>e.innerText.trim())'));
  log('es-history-all-mine', await M.ev(`[...document.querySelectorAll("[data-decision-center] [data-field=decision-owner]")].every(e=>e.innerText.includes(${JSON.stringify(who.id)}))`));
  await M.shot(path.join(__dirname, 'shots8', '09-history-owner.es-MX.png'));
  // en-US
  await M.ev(`localStorage.setItem('cth.language','en-US'); location.reload(); 0`); await sleep(7000); M.close();
  const ids = await pageIds(); const c = await connect(9335, ids[0]);
  log('en-picker', (await c.ev('document.body.innerText.slice(0,24)')));
  await c.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^open$/i.test(b.innerText.trim()));b&&b.click()})()`); await sleep(9000);
  log('en-has-DC', await humanTab(c));
  log('en-acting-as', await c.ev('document.querySelector("[data-field=acting-as]")?.innerText ?? "MISSING"'));
  await c.ev('(()=>{const d=document.querySelector("[data-decision-center] [data-field=history]");d&&(d.open=true)})()'); await sleep(500);
  log('en-history', await c.ev('[...document.querySelectorAll("[data-decision-center] [data-field=decision-owner]")].map(e=>e.innerText.trim())'));
  log('en-labels', await c.ev('[...document.querySelectorAll("[data-field=confirmed-by],[data-field=requested-by],[data-field=closed-by]")].map(e=>e.previousElementSibling?.innerText)'));
  const dom = await c.ev('document.querySelector("[data-decision-center]").innerHTML');
  log('en-leaks', { command: /rm -rf/.test(dom), srv: /\/srv\//.test(dom), hivePath: /hive3/.test(dom), session: /ses-[a-z0-9]{8,}/.test(dom) });
  await c.shot(path.join(__dirname, 'shots8', '10-history-owner.en-US.png'));
  log('rendererErrors', c.errors);
  fs.writeFileSync(path.join(__dirname, 'flow8d-result.json'), JSON.stringify(out, null, 2)); c.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
