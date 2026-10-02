const { connect } = require('./cdp8.cjs');
const { sleep, pre, reasonOf, ledger, click, submit, log, out } = require('./flow8a.cjs');
const fs = require('fs'); const path = require('path'); const http = require('http');
const pageIds = () => new Promise(r => http.get('http://127.0.0.1:9335/json', x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(JSON.parse(d).filter(t => t.type === 'page').map(t => t.id))); }));
const humanTab = async (c) => { await c.ev(`(()=>{const t=[...document.querySelectorAll('button')].find(b=>/^(pregúntame|ask me)/i.test(b.innerText.trim()));t&&t.click()})()`); await sleep(2500); return c.ev('!!document.querySelector("[data-decision-center]")'); };
const card = (c, id) => c.ev(`(()=>{const e=document.querySelector('[data-proposal-id=${JSON.stringify(id)}],[data-approval-id=${JSON.stringify(id)}]');return e?{status:e.getAttribute('data-proposal-status')??null,confirmBtn:!!e.querySelector('[data-action=confirm]:not([disabled])'),approveBtn:!!e.querySelector('[data-action=approve-high]:not([disabled])'),by:(e.querySelector('[data-field=confirmed-by],[data-field=decided-by]')?.innerText)??null}:null})()`);
(async () => {
  const ids = await pageIds(); const wins = {};
  for (const id of ids) { const c = await connect(9335, id);
    if (/SELECT A HARNESS/.test(await c.ev('document.body.innerText'))) { await c.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^open$/i.test(b.innerText.trim()));b&&b.click()})()`); await sleep(9000); }
    const lang = await c.ev('document.documentElement.lang'); await humanTab(c); wins[lang] = c; }
  const EN = wins['en-US'], ES = wins['es-MX']; log('windows', { en: !!EN, es: !!ES, distinct: EN.id !== ES.id, bothHaveDC: (await EN.ev('!!document.querySelector("[data-decision-center]")')) && (await ES.ev('!!document.querySelector("[data-decision-center]")')) });
  const who = await ES.ev('window.cth.lapitayaIdentity()'); log('sameHuman', (await EN.ev('window.cth.lapitayaIdentity()')).id === who.id);
  log('en-acting-as', await EN.ev('document.querySelector("[data-field=acting-as]")?.innerText'));
  log('en-heading', await EN.ev('document.querySelector("[data-decision-center] h2")?.innerText'));
  const shot = (c, n) => c.shot(path.join(__dirname, 'shots8', n));
  // REQUEST submitted from the ES window; both windows show it; the EN window confirms
  log('es-submit', await submit(ES, 'Quiero que El Beni implemente la validación del formulario de reportes.')); await sleep(3500);
  const reqs = await ES.ev('window.cth.lapitayaRequests().then(r=>r.filter(p=>p.status==="PROPOSED").map(p=>({id:p.id,token:p.token})))'); const p = reqs[0];
  log('both-see-pending', { es: await card(ES, p.id), en: await card(EN, p.id) });
  await shot(EN, '11-two-windows-EN.png'); await shot(ES, '12-two-windows-ES.png');
  log('en-ack', await click(EN, `[data-proposal-id=${JSON.stringify(p.id)}] [data-action=acknowledge]`)); await sleep(300);
  log('en-confirm', await click(EN, `[data-proposal-id=${JSON.stringify(p.id)}] [data-action=confirm]`)); await sleep(3500);
  log('es-follows', await card(ES, p.id));
  log('es-stale-confirm-bridge', await ES.ev(`window.cth.lapitayaConfirmRequest(${JSON.stringify(p.id)}, ${JSON.stringify(p.token)}).then(r=>({ok:r.ok,code:r.code}))`));
  const L = ledger(); const conf = L.filter(e => e.transition === 'CONFIRMED' && e.proposalId === p.id); const den = L.filter(e => e.transition === 'CONFIRMATION_DENIED' && e.proposalId === p.id);
  log('ledger-request', { confirmedOnce: conf.length === 1, owner: conf[0]?.human?.id === who.id, deniedWindowDiffers: den.length === 1 && den[0].human.window !== conf[0].human.window, deniedCode: den[0]?.code });
  // HIGH: both see it; the ES window rejects; the EN window follows and cannot approve
  log('highPre', reasonOf(await pre('Bash', { command: 'rm -rf /srv/data' }))); await sleep(3500);
  const apr = (await ES.ev('window.cth.lapitayaApprovals().then(a=>a.filter(x=>x.status==="pending").map(x=>x.id))'))[0];
  log('both-see-high', { es: await card(ES, apr), en: await card(EN, apr) });
  await shot(EN, '13-high-pending-EN.png');
  log('es-ackH', await click(ES, `[data-approval-id=${JSON.stringify(apr)}] [data-action=acknowledge-high]`)); await sleep(300);
  log('es-reject', await click(ES, `[data-approval-id=${JSON.stringify(apr)}] [data-action=reject-high]`)); await sleep(3500);
  log('en-follows', { card: await card(EN, apr), pendingCount: await EN.ev('document.querySelectorAll("[data-decision-type=HIGH_APPROVAL] [data-action=approve-high]:not([disabled])").length') });
  log('en-stale-approve-bridge', await EN.ev(`window.cth.lapitayaDecide(${JSON.stringify(apr)}, true)`));
  const L2 = ledger(); const dec = L2.filter(e => e.approvalId === apr && /^HUMAN_(APPROVED|REJECTED)$/.test(e.decision));
  log('ledger-high', { count: dec.length, decision: dec[0]?.decision, owner: dec[0]?.human?.id === who.id, windowIsES_not_EN: dec[0]?.human?.window !== conf[0]?.human?.window });
  await EN.ev('(()=>{const d=document.querySelector("[data-decision-center] [data-field=history]");d&&(d.open=true)})()'); await sleep(500);
  log('en-history-sample', (await EN.ev('[...document.querySelectorAll("[data-decision-center] [data-field=decision-owner]")].slice(0,3).map(e=>e.innerText.trim())')));
  log('en-labels', [...new Set(await EN.ev('[...document.querySelectorAll("[data-field=confirmed-by],[data-field=requested-by],[data-field=closed-by],[data-field=decided-by]")].map(e=>e.previousElementSibling?.innerText)'))]);
  await shot(EN, '14-history-owner-EN.png');
  const leak = async (c, extra) => { const dom = await c.ev('document.querySelector("[data-decision-center]").innerHTML'); return { command: /rm -rf/.test(dom), srv: /\/srv\//.test(dom), hivePath: /hive3/.test(dom), session: /ses-[a-z0-9]{8,}/.test(dom), token: dom.includes(p.token) }; };
  log('leaks', { en: await leak(EN), es: await leak(ES) });
  log('rendererErrors', { en: EN.errors, es: ES.errors });
  fs.writeFileSync(path.join(__dirname, 'flow8e-result.json'), JSON.stringify(out, null, 2)); EN.close(); ES.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
