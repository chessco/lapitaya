const WebSocket = require('C:/PitayaCode/LaPitaya/node_modules/ws');
const http = require('http');
const fs = require('fs');
exports.connect = async (port = 9334) => {
  const list = await new Promise((res, rej) => http.get(`http://127.0.0.1:${port}/json`, r => { let d=''; r.on('data', c => d+=c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = new Map(); const errors = [];
  ws.on('message', m => { const j = JSON.parse(m);
    if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); }
    else if (j.method === 'Runtime.exceptionThrown') errors.push(j.params.exceptionDetails.text + ' ' + (j.params.exceptionDetails.exception?.description ?? ''));
    else if (j.method === 'Runtime.consoleAPICalled' && j.params.type === 'error') errors.push('console.error: ' + j.params.args.map(a => a.value ?? a.description).join(' ')); });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? { __err: r.result.exceptionDetails.exception?.description } : r.result.result.value; };
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
  return { ev, shot, send, errors, close: () => ws.close() };
};
