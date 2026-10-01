const { connect } = require('./cdp.cjs'); const path = require('path'); const fs = require('fs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const click = (c, sel) => c.ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return 'missing';if(b.disabled)return 'disabled';b.click();return 'ok'})()`);
const out = {}; const log = (k, v) => { out[k] = v; console.log(k, JSON.stringify(v)); };
const submit = (c, msg) => c.ev(`(()=>{const i=document.querySelector('[data-alicia-panel] input[type=text],[data-alicia-panel] input:not([type])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(msg)});i.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()`).then(async () => { await sleep(300); return click(c, '[data-action=send]'); });
(async () => {
  let c = await connect();
  const shot = (n) => c.shot(path.join(__dirname, 'shots', n));
  const reqs = () => c.ev('window.cth.lapitayaRequests().then(r=>r.map(p=>({id:p.id,status:p.status,hasToken:!!p.token})))');
  log('before', await reqs());
  // cancel through the UI
  log('submitCancel', await submit(c, 'Quiero que Valentin revise los permisos del módulo de pagos.')); await sleep(2500);
  log('cancel', await click(c, '[data-action=cancel]')); await sleep(2500);
  await shot('06-cancelled.png'); log('afterCancel', await reqs());
  // forged token on a fresh proposal, then a stale/replayed one
  log('submitForge', await submit(c, 'Quiero que El Beni agregue pruebas al formulario de contacto.')); await sleep(2500);
  const all = await reqs(); const pending = all.find(p => p.status === 'PROPOSED'); const done = all.find(p => p.status === 'CONFIRMED' || p.status === 'COMPLETED' || /CONFIRM/.test(p.status));
  log('forged', await c.ev(`window.cth.lapitayaConfirmRequest(${JSON.stringify(pending?.id)}, 'forged-token').then(r=>r.ok===false?{ok:false,code:r.code}:r)`));
  log('wrongTarget', await c.ev(`window.cth.lapitayaConfirmRequest('prop-does-not-exist','x').then(r=>({ok:r.ok,code:r.code}))`));
  log('replayConfirmed', done ? await c.ev(`window.cth.lapitayaConfirmRequest(${JSON.stringify(done.id)}, 'whatever').then(r=>({ok:r.ok,code:r.code}))`) : 'no confirmed proposal found');
  log('decideUnknown', await c.ev(`window.cth.lapitayaDecide('apr-nope', true)`));
  log('decideBadArgs', await c.ev(`window.cth.lapitayaDecide(5, 'yes')`));
  await sleep(1500); await shot('07-forged-refused.png');
  const dc = await c.ev('document.querySelector("[data-decision-center]").innerText'); log('dcHasHistory', /resueltas|rechaz|cancelad/i.test(dc));
  log('errorsEs', c.errors);
  // en-US
  await c.ev(`localStorage.setItem('cth.language','en-US'); location.reload(); 0`); await sleep(6000); c.close(); c = await connect();
  log('pickerText', (await c.ev('document.body.innerText.slice(0,40)')));
  await c.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^open$/i.test(b.innerText.trim()));b&&b.click()})()`); await sleep(9000);
  log('tabEn', await c.ev(`(()=>{const t=[...document.querySelectorAll('button')].find(b=>/^ask me/i.test(b.innerText.trim()));if(!t)return [...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,30).join(';');t.click();return 'clicked'})()`)); await sleep(2500);
  const en = await c.ev('document.querySelector("[data-decision-center]")?.innerText ?? "NO DC"');
  log('enHeading', /HUMAN DECISIONS/.test(en)); log('enSample', en.slice(0, 200));
  await c.ev(`(()=>{const d=document.querySelector('[data-decision-center] details');d&&(d.open=true)})()`); await sleep(500);
  await c.shot(path.join(__dirname, 'shots', '08-en-US.png'));
  const dom = await c.ev('document.querySelector("[data-decision-center]").innerHTML'); log('leaksEn', { rm: /rm -rf/.test(dom), srv: /\/srv\//.test(dom) });
  log('errorsEn', c.errors);
  fs.writeFileSync(path.join(__dirname, 'flow2-result.json'), JSON.stringify(out, null, 2)); c.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
