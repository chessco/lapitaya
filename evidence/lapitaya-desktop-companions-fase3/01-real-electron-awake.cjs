'use strict';
// FASE 3 real Electron smoke: real powerSaveBlocker + real ExecutionAwakeService + real CIMA.
const { app, powerSaveBlocker } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const loadTs = require(path.join(root, 'test', 'load-ts.cjs'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-fase3-electron-'));
app.setPath('userData', path.join(tmp, 'userData'));
app.whenReady().then(() => {
  const { ExecutionAwakeService } = loadTs('src/main/executionAwake.ts');
  const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
  const events = [];
  const awake = new ExecutionAwakeService({ blocker: powerSaveBlocker, enabled: true, onChange: (s) => events.push({ ...s, at: Date.now() }) });
  const runtime = new CimaRuntimeService({ hiveRoot: () => path.join(tmp, 'hive'), godId: () => 'god', onEvent: awake.noteRuntimeEvent.bind(awake) });
  const before = process.getProcessMemoryInfo ? process.getProcessMemoryInfo() : Promise.resolve(null);
  const cpu0 = process.getCPUUsage ? process.getCPUUsage() : null;
  awake.workerStarted('live-agent-1');
  const id = awake.state().executions[0]?.id;
  const blockerHeld = awake.state().active && id && powerSaveBlocker.isStarted(awake['blockerId']);
  awake.agentEnded('live-agent-1');
  const released = !awake.state().active;
  const cpu1 = process.getCPUUsage ? process.getCPUUsage() : null;
  Promise.resolve(before).then((memory) => {
    const result = { pass: !!blockerHeld && released, blockerHeld: !!blockerHeld, released, executions: awake.state().activeExecutionCount, memory, cpuBefore: cpu0, cpuAfter: cpu1, transitions: events.length, note: 'O-1 lifecycle noise is ignored by ExecutionAwake; CIMA correction remains separate.' };
    fs.writeFileSync(path.join(__dirname, '01-real-electron-awake.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    awake.dispose();
    app.quit();
  });
}).catch((error) => { console.error(error); app.exit(1); });
