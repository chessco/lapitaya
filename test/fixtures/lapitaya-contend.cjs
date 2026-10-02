'use strict';
/** Child process for the multi-process contention test: N governed calls against a shared hive. */
const path = require('node:path');
const loadTs = require('../load-ts.cjs');
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const [hiveRoot, agentId, n] = process.argv.slice(2);
const rt = new CimaRuntimeService({ hiveRoot: () => hiveRoot, godId: () => 'god', lockTimeoutMs: 20000 });
let denied = 0;
for (let i = 0; i < Number(n); i++) {
  const a = rt.authorize(agentId, 'Read', { file_path: path.join(hiveRoot, '..', `f-${agentId}-${i}.ts`) });
  if (a.decision !== 'ALLOW') denied++;
  rt.recordTrace(agentId, 'PostToolUse', 'Read', { file_path: `f-${agentId}-${i}.ts` }, 'ok');
}
console.log(JSON.stringify({ agentId, denied }));
