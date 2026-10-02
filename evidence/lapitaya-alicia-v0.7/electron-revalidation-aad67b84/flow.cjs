const { connect } = require('./cdp.cjs');
const net = require('net'); const crypto = require('crypto'); const path = require('path'); const fs = require('fs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BS = String.fromCharCode(92);
const root = path.join(__dirname, 'hive2', 'hive').split('/').join(BS);
const pipe = BS + BS + '.' + BS + 'pipe' + BS + 'munder-difflin-' + crypto.createHash('sha1').update(root).digest('hex').slice(0, 12);
const hook = (payload) => new Promise((res, rej) => { const s = net.createConnection(pipe); let d = ''; s.on('connect', () => s.write(JSON.stringify({ agent_id: 'god', session_id: 's-god', ...payload }) + '\n')); s.on('data', c => d += c); s.on('end', () => res(d ? JSON.parse(d) : {})); s.on('error', rej); });
const pre = (tool, input) => hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
const click = (c, sel) => c.ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return 'missing';if(b.disabled)return 'disabled';b.click();return 'ok'})()`);
const out = {}; const log = (k, v) => { out[k] = v; console.log(k, JSON.stringify(v)); };
(async () => {
  const c = await connect();
  const shot = (n) => c.shot(path.join(__dirname, 'shots', n)); fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  log('pipe', pipe);
  // REQUEST through the Alicia UI
  log('typed', await c.ev(`(()=>{const i=document.querySelector('[data-alicia-panel] input[type=text],[data-alicia-panel] input:not([type])');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'Quiero que El Beni implemente la validación del formulario.');i.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()`));
  await sleep(300); log('send', await click(c, '[data-action=send]')); await sleep(2500);
  log('requestCard', await c.ev(`[...document.querySelectorAll('[data-decision-type]')].map(e=>e.getAttribute('data-decision-type')+':'+(e.getAttribute('data-state')||''))`));
  log('requestText', await c.ev(`(document.querySelector('[data-alicia-panel]').innerText.match(/CONFIRMACI[ÓO]N[\s\S]{0,500}/)||['none'])[0]`));
  await shot('02-request-pending.png');
  // Before confirming: a HIGH-style call must be denied for lack of a confirmed REQUEST
  const r0 = await pre('Bash', { command: 'npm test' }); log('preBeforeConfirm', r0?.hookSpecificOutput?.permissionDecisionReason?.slice(0, 40));
  // Confirm via UI: acknowledge, then confirm, double click
  log('ack', await click(c, '[data-action=acknowledge]')); await sleep(300);
  log('confirm1', await click(c, '[data-action=confirm]'));
  log('confirm2', await click(c, '[data-action=confirm]')); await sleep(2500);
  const r1 = await pre('Bash', { command: 'npm test' }); log('preAfterConfirm', r1?.hookSpecificOutput?.permissionDecision ?? 'allow(no deny)');
  // HIGH call → human approval required
  const r2 = await pre('Bash', { command: 'rm -rf /srv/data' }); log('highPre', r2?.hookSpecificOutput?.permissionDecisionReason?.slice(0, 60));
  await sleep(2500);
  log('highCard', await c.ev(`[...document.querySelectorAll('[data-decision-type=HIGH_APPROVAL]')].map(e=>({risk:e.querySelector('[data-risk]')?.getAttribute('data-risk'),id:e.getAttribute('data-approval-id'),text:e.innerText.slice(0,120)}))`));
  await shot('03-high-pending.png');
  log('requestConfirmedDidNotApprove', (r2?.hookSpecificOutput?.permissionDecision) === 'deny');
  // Approve via UI (ack, then approve twice quickly)
  log('ackH', await click(c, '[data-action=acknowledge-high]')); await sleep(300);
  log('approve1', await click(c, '[data-action=approve-high]')); log('approve2', await click(c, '[data-action=approve-high]')); await sleep(2500);
  const r3 = await pre('Bash', { command: 'rm -rf /srv/data' }); log('retryAfterApprove', r3?.hookSpecificOutput?.permissionDecision ?? 'allow(no deny)');
  const r4 = await pre('Bash', { command: 'rm -rf /srv/data' }); log('nextAttemptOneShot', r4?.hookSpecificOutput?.permissionDecisionReason?.slice(0, 40));
  await sleep(2500); await shot('04-high-approved.png');
  // second HIGH → reject
  log('ackH2', await click(c, '[data-action=acknowledge-high]')); // may be absent
  log('reject', await click(c, '[data-action=reject-high]')); await sleep(2500);
  const r5 = await pre('Bash', { command: 'rm -rf /srv/data' }); log('retryAfterReject', r5?.hookSpecificOutput?.permissionDecisionReason?.slice(0, 40));
  await shot('05-high-rejected.png');
  // sensitive data in the DOM
  const dom = await c.ev('document.querySelector("[data-decision-center]").innerHTML + document.querySelector("[data-decision-center]").innerText');
  log('leaks', { command: /rm -rf/.test(dom), srv: /\/srv\//.test(dom), hivePath: /hive2/.test(dom), token: /token/i.test(dom) && /[0-9a-f]{24,}/.test(dom) });
  log('rendererErrors', c.errors);
  fs.writeFileSync(path.join(__dirname, 'flow-result.json'), JSON.stringify(out, null, 2));
  c.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
