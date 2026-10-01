const { connect } = require('./cdp8.cjs');
const net = require('net'); const crypto = require('crypto'); const path = require('path'); const fs = require('fs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BS = String.fromCharCode(92);
const root = path.join(__dirname, 'hive3', 'hive').split('/').join(BS);
const pipe = BS + BS + '.' + BS + 'pipe' + BS + 'munder-difflin-' + crypto.createHash('sha1').update(root).digest('hex').slice(0, 12);
const hook = (payload) => new Promise((res, rej) => { const s = net.createConnection(pipe); let d = ''; s.on('connect', () => s.write(JSON.stringify({ agent_id: 'god', session_id: 's-god', ...payload }) + '\n')); s.on('data', c => d += c); s.on('end', () => res(d ? JSON.parse(d) : {})); s.on('error', rej); });
const pre = (tool, input) => hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
const decisionOf = (r) => r?.hookSpecificOutput?.permissionDecision ?? 'allow';
const reasonOf = (r) => (r?.hookSpecificOutput?.permissionDecisionReason ?? '').slice(0, 40);
const ledger = () => { const f = path.join(__dirname, 'hive3', 'hive', 'lapitaya', 'cima-ledger.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; };
const click = (c, sel) => c.ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return 'missing';if(b.disabled)return 'disabled';b.click();return 'ok'})()`);
const submit = (c, msg) => c.ev(`(()=>{const i=document.querySelector('[data-alicia-panel] input[type=text],[data-alicia-panel] input:not([type])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(msg)});i.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()`).then(async () => { await sleep(300); return click(c, '[data-action=send]'); });
const out = {}; const log = (k, v) => { out[k] = v; console.log(k, JSON.stringify(v)); };
module.exports = { sleep, pre, decisionOf, reasonOf, ledger, click, submit, log, out, hook };
if (require.main === module) (async () => {
  const c = await connect(9335, 0);
  fs.mkdirSync(path.join(__dirname, 'shots8'), { recursive: true });
  const shot = (n) => c.shot(path.join(__dirname, 'shots8', n));
  await c.ev(`(()=>{const t=[...document.querySelectorAll('button')].find(b=>/^pregúntame/i.test(b.innerText.trim()));t&&t.click()})()`); await sleep(2000);
  // ID-01: the trusted identity main resolved for this window
  const who = await c.ev('window.cth.lapitayaIdentity()'); log('identity', who);
  log('identityShape', who && /^hum-[a-z0-9]{12,32}$/.test(who.id) && /^ses-/.test(who.session) && Object.keys(who).sort().join());
  log('actingAs', (await c.ev('document.querySelector("[data-field=acting-as]")?.innerText ?? "MISSING"')));
  const cfg = await c.ev('window.cth.getConfig().then(c=>c.humanId ?? null)'); log('persistedHumanIdMatches', cfg === who.id);
  await shot('01-acting-as.png');
  // REQUEST → confirm by UI
  log('submit1', await submit(c, 'Quiero que El Beni implemente la validación del formulario.')); await sleep(2500);
  log('requestedByShown', await c.ev('document.querySelector("[data-decision-type=REQUEST_CONFIRMATION] [data-field=requested-by]")?.innerText ?? "MISSING"'));
  const reqs = await c.ev('window.cth.lapitayaRequests().then(r=>r.map(p=>({id:p.id,status:p.status,token:p.token,requestedOwner:p.requestedOwner&&p.requestedOwner.id})))');
  const p1 = reqs.find(p => p.status === 'PROPOSED'); log('p1', { id: p1.id, requestedOwnerIsMe: p1.requestedOwner === who.id });
  // ID-09..12: spoof attempts through the only bridge a renderer has (extra args are not read)
  log('spoofConfirmWrongToken', await c.ev(`window.cth.lapitayaConfirmRequest(${JSON.stringify(p1.id)}, 'forged', {human:{id:'hum-evil0000000000',displayName:'Mallory'}}, 'mallory').then(r=>({ok:r.ok,code:r.code}))`));
  log('ack', await click(c, '[data-action=acknowledge]')); await sleep(300);
  await shot('02-request-pending.png');
  log('confirm', await click(c, '[data-action=confirm]')); await sleep(2500);
  log('confirmedByShown', await c.ev('document.querySelector("[data-decision-type=REQUEST_CONFIRMATION] [data-field=confirmed-by]")?.innerText ?? "MISSING"'));
  await shot('03-request-confirmed.png');
  // replay with the consumed token
  log('replayConsumedToken', await c.ev(`window.cth.lapitayaConfirmRequest(${JSON.stringify(p1.id)}, ${JSON.stringify(p1.token)}, {human:{id:'${who.id}'}}).then(r=>({ok:r.ok,code:r.code}))`));
  // ledger ownership (ID-03 / ID-07 / ID-29)
  const L1 = ledger(); const conf = L1.find(e => e.kind === 'request' && e.transition === 'CONFIRMED' && e.proposalId === p1.id);
  log('ledgerConfirmed', conf && { by: conf.by, humanIdIsMe: conf.human?.id === who.id, sessionIsMine: conf.human?.session === who.session, windowInt: Number.isInteger(conf.human?.window), name: conf.human?.displayName === who.displayName });
  log('noMalloryInLedger', !JSON.stringify(L1).toLowerCase().includes('mallory'));
  log('ledgerDenied', L1.filter(e => e.transition === 'CONFIRMATION_DENIED').map(e => ({ code: e.code, humanIdIsMe: e.human?.id === who.id })));
  // cancel by UI
  log('cancelCard', await click(c, '[data-decision-type=REQUEST_CONFIRMATION] [data-action=cancel]')); await sleep(2500);
  const L2 = ledger(); const canc = L2.find(e => e.kind === 'request' && e.transition === 'CANCELLED' && e.proposalId === p1.id);
  log('ledgerCancelled', canc && { humanIdIsMe: canc.human?.id === who.id });
  log('closedByShown', await c.ev('document.querySelector("[data-field=closed-by]")?.innerText ?? "MISSING"'));
  // HIGH: needs a confirmed REQUEST first
  log('submit2', await submit(c, 'Quiero que El Beni agregue pruebas al formulario de contacto.')); await sleep(2500);
  log('ack2', await click(c, '[data-action=acknowledge]')); await sleep(300); log('confirm2', await click(c, '[data-action=confirm]')); await sleep(2500);
  log('highPre', reasonOf(await pre('Bash', { command: 'rm -rf /srv/data' }))); await sleep(2500);
  const apr = (await c.ev('window.cth.lapitayaApprovals().then(a=>a.filter(x=>x.status==="pending").map(x=>x.id))'))[0]; log('apr1', !!apr);
  await shot('04-high-pending.png');
  log('ackH', await click(c, '[data-action=acknowledge-high]')); await sleep(300);
  log('spoofDecideExtraArgs', 'sent with the real click below');
  log('approve', await click(c, '[data-action=approve-high]')); await sleep(2500);
  log('decidedByShown', await c.ev('document.querySelector("[data-decision-type=HIGH_APPROVAL] [data-field=decided-by]")?.innerText ?? "MISSING"'));
  const L3 = ledger(); const ap = L3.find(e => e.kind === 'governance' && e.approvalId === apr && e.decision === 'HUMAN_APPROVED');
  log('ledgerApproved', ap && { rule: ap.rule, humanIdIsMe: ap.human?.id === who.id, sessionIsMine: ap.human?.session === who.session });
  log('retryAfterApprove', decisionOf(await pre('Bash', { command: 'rm -rf /srv/data' })));
  log('nextAttemptOneShot', reasonOf(await pre('Bash', { command: 'rm -rf /srv/data' }))); await sleep(2500);
  log('replayDecideApproved', await c.ev(`window.cth.lapitayaDecide(${JSON.stringify(apr)}, true)`));
  log('flipDecideApproved', await c.ev(`window.cth.lapitayaDecide(${JSON.stringify(apr)}, false)`));
  const apr2 = (await c.ev('window.cth.lapitayaApprovals().then(a=>a.filter(x=>x.status==="pending").map(x=>x.id))'))[0];
  log('ackH2', await click(c, '[data-action=acknowledge-high]')); log('reject', await click(c, '[data-action=reject-high]')); await sleep(2500);
  const L4 = ledger(); const rj = L4.find(e => e.kind === 'governance' && e.approvalId === apr2 && e.decision === 'HUMAN_REJECTED');
  log('ledgerRejected', rj && { humanIdIsMe: rj.human?.id === who.id });
  log('approvalRecordOwner', await c.ev(`window.cth.lapitayaApprovals().then(a=>a.filter(x=>x.status!=="pending").map(x=>({st:x.status,mine:x.decidedOwner&&x.decidedOwner.id===${JSON.stringify(who.id)}})))`));
  await shot('05-high-rejected.png');
  // leaks
  const dom = await c.ev('document.querySelector("[data-decision-center]").innerHTML + document.querySelector("[data-decision-center]").innerText');
  const tokens = reqs.map(r => r.token).filter(Boolean);
  log('leaks', { command: /rm -rf/.test(dom), srv: /\/srv\//.test(dom), hivePath: /hive3/.test(dom), session: /ses-[a-z0-9]{8,}/.test(dom), token: tokens.some(t => dom.includes(t)), fingerprint: /fingerprint/i.test(dom) });
  log('rendererErrors', c.errors);
  fs.writeFileSync(path.join(__dirname, 'flow8a-result.json'), JSON.stringify(out, null, 2)); c.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
