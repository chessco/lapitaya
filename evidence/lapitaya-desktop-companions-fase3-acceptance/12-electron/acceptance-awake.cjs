'use strict';
// Acceptance-only harness. It does not modify application code or CIMA semantics.
const { app, powerSaveBlocker } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..', '..');
const loadTs = require(path.join(root, 'test', 'load-ts.cjs'));
const { ExecutionAwakeService } = loadTs('src/main/executionAwake.ts');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { recordSpawnAssignment } = loadTs('src/main/spawnAssignment.ts');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-fase3-acceptance-'));
app.setPath('userData', path.join(dir, 'userData'));

app.whenReady().then(() => {
  const transitions = [];
  const awake = new ExecutionAwakeService({ blocker: powerSaveBlocker, enabled: true, onChange: (s) => transitions.push({ at: Date.now(), enabled: s.enabled, active: s.active, count: s.activeExecutionCount, mode: s.mode }) });
  const runtimeEvents = [];
  const runtime = new CimaRuntimeService({ hiveRoot: () => path.join(dir, 'hive'), godId: () => 'god', onEvent: (e) => { runtimeEvents.push(e); awake.noteRuntimeEvent(e); } });
  const results = [];
  const check = (id, pass, detail) => results.push({ id, pass: !!pass, detail });
  const state = () => ({ ...awake.state(), blockerIds: awake.state().executions.map((e) => e.id) });
  const blockerIsHeld = () => { const id = awake['blockerId']; return id !== null && powerSaveBlocker.isStarted(id); };

  // OFF is a real policy decision: an execution is tracked, but no blocker is held.
  awake.setEnabled(false); awake.workerStarted('off-agent');
  check('OFF-01', awake.state().activeExecutionCount === 1 && !awake.state().active && !blockerIsHeld(), state());
  awake.agentEnded('off-agent'); awake.setEnabled(true);
  check('ON-01', awake.state().activeExecutionCount === 0 && !blockerIsHeld(), state());

  // Multiple executions and toggle while work continues.
  awake.workerStarted('A'); const aOn = blockerIsHeld(); awake.workerStarted('B');
  check('MULTI-01', awake.state().activeExecutionCount === 2 && blockerIsHeld(), state());
  awake.agentEnded('A'); check('MULTI-02', awake.state().activeExecutionCount === 1 && blockerIsHeld(), state());
  awake.setEnabled(false); check('TOGGLE-01', awake.state().activeExecutionCount === 1 && !blockerIsHeld(), state());
  awake.setEnabled(true); check('TOGGLE-02', awake.state().activeExecutionCount === 1 && blockerIsHeld(), state());
  awake.agentEnded('B'); check('MULTI-03', awake.state().activeExecutionCount === 0 && !blockerIsHeld(), state());
  check('ON-02', aOn === true, transitions);

  // Real CIMA assignment events, followed by terminal lifecycle events and O-1.
  const spawn = (taskId, phase, agentId) => { const before = runtimeEvents.length; const out = recordSpawnAssignment({ runtime, from: 'god', to: agentId, cima: { taskId, phase }, messageId: `m-${taskId}-${phase}` }); return { out, event: runtimeEvents[before] }; };
  const phase = (taskId, phase, agentId) => { awake.noteRuntimeEvent({ type: 'cima-record', data: { kind: 'cima', taskId, phase, verdict: 'PASS', agentId } }); };
  for (const [phaseName, agentId] of [['BUILD', 'rosalba-1'], ['TEST', 'margarito-1'], ['AUDIT', 'jose-juan-1']]) {
    const x = spawn('CHAIN-1', phaseName, agentId);
    check(`CHAIN-${phaseName}-START`, x.out.recorded === true && !!x.event && awake.state().active, { state: state(), runtimeEvent: x.event?.data });
    phase('CHAIN-1', phaseName, agentId);
    check(`CHAIN-${phaseName}-PASS`, !awake.state().active, state());
  }
  // O-1: after PASS, the release reassignment is ignored.
  const o1 = spawn('CHAIN-1', 'AUDIT', 'jose-juan-1');
  check('O1-01', o1.out.recorded === true && !awake.state().active && awake.state().activeExecutionCount === 0, { state: state(), event: o1.event?.data });
  check('CHAIN-FINAL', !awake.state().active && awake.state().activeExecutionCount === 0, state());

  const memory = process.getProcessMemoryInfo ? process.getProcessMemoryInfo() : Promise.resolve(null);
  Promise.resolve(memory).then((m) => {
    const output = { pass: results.every((r) => r.pass), results, transitions, runtimeEventCount: runtimeEvents.length, process: { rssKb: m?.residentSet ?? null, cpu: process.getCPUUsage?.() ?? null }, notes: ['Screen lock not exercised in this unattended harness.', 'Ambient CPU is covered by LIVE tests; this harness measures the Electron main process lifecycle.', 'O-1 is classified as lifecycle noise; no CIMA correction is made.'] };
    fs.writeFileSync(path.join(__dirname, 'acceptance-awake.json'), JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output));
    awake.dispose();
    app.quit();
  });
}).catch((e) => { console.error(e); app.exit(1); });
