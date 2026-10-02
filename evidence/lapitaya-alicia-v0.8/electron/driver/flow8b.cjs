const { connect } = require('./cdp8.cjs');
const { sleep, pre, decisionOf, reasonOf, ledger, click, submit, log, out } = require('./flow8a.cjs');
const fs = require('fs'); const path = require('path'); const http = require('http');
const pageIds = () => new Promise(r => http.get('http://127.0.0.1:9335/json', x => { let d = ''; x.on('data', c => d += c); x.on('end', () => r(JSON.parse(d).filter(t => t.type === 'page').map(t => t.id))); }));
const humanTab = async (c) => { await c.ev(`(()=>{const t=[...document.querySelectorAll('button')].find(b=>/^pregúntame/i.test(b.innerText.trim()));t&&t.click()})()`); await sleep(2000); return c.ev('!!document.querySelector("[data-decision-center]")'); };
(async () => {
  let ids = await pageIds();
  const first = await connect(9335, ids[0]);
  if (ids.length < 2) { log('newFloor', await first.ev('window.cth.newFloor()')); await sleep(9000); ids = await pageIds(); }
  first.close();
  // M = the window that hosts the Decision Center; F = the other real app window (a second renderer with its own bridge)
  let M = null, F = null;
  for (const id of ids) { const c = await connect(9335, id); if (!M && await humanTab(c)) M = c; else if (!F) F = c; else c.close(); }
  log('windows', { count: ids.length, distinct: M.id !== F.id, M_hasDC: !!M, F_hasDC: await F.ev('!!document.querySelector("[data-decision-center]")') });
  const shot = (c, n) => c.shot(path.join(__dirname, 'shots8', n));
  const who = await M.ev('window.cth.lapitayaIdentity()');
  const whoF = await F.ev('window.cth.lapitayaIdentity()');
  log('sameHumanBothWindows', { id: whoF?.id === who.id, session: whoF?.session === who.session });
  // 1. M submits a REQUEST; F holds the (soon stale) token
  log('M-submit', await submit(M, 'Quiero que Valentin revise los permisos del módulo de reportes.')); await sleep(3000);
  const reqF = await F.ev('window.cth.lapitayaRequests().then(r=>r.filter(p=>p.status==="PROPOSED").map(p=>({id:p.id,token:p.token})))'); const p = reqF[0]; log('F-sees-pending', { count: reqF.length, hasToken: !!p?.token });
  log('M-ack', await click(M, '[data-decision-type=REQUEST_CONFIRMATION][data-proposal-status=PROPOSED] [data-action=acknowledge]')); await sleep(300);
  log('M-confirm', await click(M, '[data-decision-type=REQUEST_CONFIRMATION][data-proposal-status=PROPOSED] [data-action=confirm]')); await sleep(3000);
  log('F-replay-confirm', await F.ev(`window.cth.lapitayaConfirmRequest(${JSON.stringify(p.id)}, ${JSON.stringify(p.token)}).then(r=>({ok:r.ok,code:r.code}))`));
  log('F-cancel-after', await F.ev(`window.cth.lapitayaCancelRequest('prop-nope').then(r=>({ok:r.ok,code:r.code}))`));
  const L = ledger();
  const conf = L.filter(e => e.transition === 'CONFIRMED' && e.proposalId === p.id); const den = L.filter(e => e.transition === 'CONFIRMATION_DENIED' && e.proposalId === p.id);
  log('ledgerRequestOwnership', { confirmedRecords: conf.length, confirmedHumanIsMe: conf[0]?.human?.id === who.id, deniedCodes: den.map(d => d.code), deniedHumanIsMe: den.every(d => d.human?.id === who.id), deniedWindowDiffersFromConfirmed: den.length > 0 && den.every(d => d.human.window !== conf[0].human.window), sameSession: den.every(d => d.human.session === conf[0].human.session) });
  log('M-card-confirmedBy', await M.ev(`document.querySelector('[data-proposal-id=${JSON.stringify(p.id)}] [data-field=confirmed-by]')?.innerText ?? 'MISSING'`));
  // 2. HIGH pending; the OTHER window decides; M's UI must follow the runtime with no action of its own
  log('highPre', reasonOf(await pre('Bash', { command: 'rm -rf /srv/data' }))); await sleep(3000);
  const aprs = await F.ev('window.cth.lapitayaApprovals().then(a=>a.filter(x=>x.status==="pending").map(x=>x.id))'); const apr = aprs[0]; log('pendingHigh', aprs.length);
  log('M-sees-high', await M.ev('document.querySelectorAll("[data-decision-type=HIGH_APPROVAL] [data-action=approve-high]").length'));
  await shot(M, '06-M-high-pending.png');
  log('F-reject', await F.ev(`window.cth.lapitayaDecide(${JSON.stringify(apr)}, false)`)); await sleep(3500);
  log('M-card-after-F-decision', await M.ev(`(()=>{const e=document.querySelector('[data-approval-id=${JSON.stringify(apr)}]');return e?{approveBtnEnabled:!!e.querySelector('[data-action=approve-high]:not([disabled])'),decidedBy:e.querySelector('[data-field=decided-by]')?.innerText ?? null,state:e.querySelector('[id$=-h]')?.innerText}:'no card'})()`));
  await shot(M, '07-M-follows-F-decision.png');
  log('M-approve-stale-bridge', await M.ev(`window.cth.lapitayaDecide(${JSON.stringify(apr)}, true)`));
  log('F-approve-again', await F.ev(`window.cth.lapitayaDecide(${JSON.stringify(apr)}, true)`));
  const L2 = ledger(); const decisions = L2.filter(e => e.approvalId === apr && /^HUMAN_(APPROVED|REJECTED)$/.test(e.decision));
  log('ledgerHighOwnership', decisions.map(e => ({ decision: e.decision, humanIdIsMe: e.human?.id === e.human?.id && e.human?.id === who.id, window: e.human?.window })));
  log('approvalFinal', await F.ev(`window.cth.lapitayaApprovals().then(a=>{const x=a.find(y=>y.id===${JSON.stringify(apr)});return {status:x.status,owner:x.decidedOwner&&x.decidedOwner.id===${JSON.stringify(who.id)},window:x.decidedOwner&&x.decidedOwner.window}})`));
  log('windowOfF-decision-differs-from-M-confirm', decisions[0]?.human?.window !== conf[0]?.human?.window);
  // 3. the Decision Center in M, history, DOM leaks
  const dom = await M.ev('document.querySelector("[data-decision-center]").innerHTML + document.querySelector("[data-decision-center]").innerText');
  log('leaks', { command: /rm -rf/.test(dom), srv: /\/srv\//.test(dom), hivePath: /hive3/.test(dom), session: /ses-[a-z0-9]{8,}/.test(dom), token: dom.includes(p.token) });
  log('rendererErrors', { M: M.errors, F: F.errors });
  fs.writeFileSync(path.join(__dirname, 'flow8b-result.json'), JSON.stringify(out, null, 2)); M.close(); F.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
