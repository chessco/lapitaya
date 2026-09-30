'use strict';
/**
 * A La Pitaya "floor" for tests: the REAL HiveManager + HookServer +
 * CimaRuntimeService + IntentBoundary + Alicia companion, wired the way
 * src/main/index.ts wires them. Shared by the Alicia v0.4 / v0.4.1 suites.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('../load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};

const { HiveManager }        = loadTs('src/main/hive.ts');
const { HookServer }         = loadTs('src/main/hooks.ts');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { IntentBoundary }     = loadTs('src/main/intentBoundary.ts');
const { recordBanner }       = loadTs('src/shared/lapitaya/cimaRuntime.ts');
const agents                 = loadTs('src/shared/lapitaya/agents.ts');
const A                      = loadTs('src/shared/lapitaya/alicia/index.ts');

async function floor(t, companionPrefs) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-alicia-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  for (const [id, name] of [['valentin-1', 'Valentín'], ['el-beni-1', 'El Beni'],
      ['margarito-1', 'Margarito'], ['jose-juan-1', 'José Juan'], ['el-tutu-1', 'El Tutú']]) {
    await hive.ensureAgent({ id, name, provider: 'claude', cwd: home });
  }
  let clock = 1_800_000_000_000;
  const now = () => (clock += 1000);
  const runtimeEvents = [];
  let companion = null;
  const lapitaya = new CimaRuntimeService({
    hiveRoot: () => hive.root(),
    godId: () => 'god',
    phaseOf: (agentId) => agents.phaseForAgent(hive.registry(), agentId),
    onEvent: (e) => {
      runtimeEvents.push(e);
      for (const ev of A.fromRuntimeEvent(e, clock)) companion.notify(ev);
    },
    now
  });
  hive.setCimaHandler((from, cima, messageId, to) => recordBanner(lapitaya.handle(from, to, cima, messageId)));
  hive.setCompletionGate(
    (taskId) => lapitaya.completionGate(taskId),
    (taskId, reason, via) => lapitaya.recordBlockedCompletion(taskId, reason, via)
  );
  const delivered = [];
  const boundary = new IntentBoundary({
    runtime: lapitaya,
    orchestratorId: () => hive.registry().godId ?? 'god',
    deliver: (msg, from) => { const m = hive.send(msg, from); delivered.push(m); return m.id; },
    now: () => clock
  });
  // The same ports src/main/index.ts lends the companion — and nothing more.
  companion = A.createAliciaCompanion({
    now: () => clock,
    preferences: companionPrefs,
    ports: {
      cimaStatus: (taskId) => A.deriveCimaStatus({
        taskId, records: lapitaya.cimaRecords(taskId), approvals: lapitaya.listApprovals(), completion: lapitaya.completionGate(taskId)
      }),
      tasks: () => hive.tasks(),
      project: () => ({ root: home, name: path.basename(home) }),
      agentName: (id) => hive.registry().agents[id]?.name,
      submitIntent: (intent) => boundary.submit(intent)
    }
  });

  const server = new HookServer(hive, () => null, () => ({ autoMode: true, notifications: false }),
    undefined, undefined, undefined, undefined, lapitaya);
  const hook = (agentId, payload) => server.handle({ agent_id: agentId, session_id: 's-' + agentId, ...payload });
  const pre = (agentId, tool, input) => hook(agentId, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
  const post = (agentId, tool, input, response) => hook(agentId, { hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_response: response ?? {} });
  const ran = (agentId, command, stdout) => post(agentId, 'Bash', { command }, { stdout, stderr: '', interrupted: false });
  const send = (from, cima, to = 'god') => {
    const out = path.join(hive.root(), 'agents', from, 'outbox');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, `m-${Date.now()}-${Math.random().toString(36).slice(2)}.json`),
      JSON.stringify({ to, act: 'inform', subject: `${cima.phase} result`, body: 'agent prose', cima }));
    hive.routeOnce();
  };
  /** BUILD (el-beni) → TEST (margarito) → AUDIT (jose-juan), all real PASS. */
  const chain = async (taskId) => {
    hive.addTask({ id: taskId, title: 'Alicia test task', status: 'doing', assignee: 'el-beni-1', dependsOn: [], priority: 1, createdAt: new Date().toISOString() });
    await ran('el-beni-1', 'npm run build', 'built OK');
    await ran('el-beni-1', 'git diff --stat', ' 2 files changed, 10 insertions(+)');
    send('el-beni-1', { taskId, phase: 'BUILD', verdict: 'PASS', evidence: [
      { type: 'command-output', source: 'npm run build', result: 'built OK' },
      { type: 'diff', source: 'git diff --stat', result: ' 2 files changed, 10 insertions(+)' }
    ] });
    await ran('margarito-1', 'npm test', 'tests 12 pass 12 fail 0');
    send('margarito-1', { taskId, phase: 'TEST', verdict: 'PASS', evidence: [{ type: 'test-result', source: 'npm test', result: 'pass 12' }] });
    await ran('jose-juan-1', 'git diff main', 'clean');
    send('jose-juan-1', { taskId, phase: 'AUDIT', verdict: 'PASS', evidence: [{ type: 'command-output', source: 'git diff main' }] });
  };
  const ledgerPath = () => path.join(hive.root(), 'lapitaya', 'cima-ledger.jsonl');
  const ledger = () => (fs.existsSync(ledgerPath())
    ? fs.readFileSync(ledgerPath(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const tracesPath = () => path.join(hive.root(), 'lapitaya', 'traces.jsonl');
  const traces = () => (fs.existsSync(tracesPath())
    ? fs.readFileSync(tracesPath(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const intentFor = (message, extra = {}) => ({
    id: `int-test-${Math.random().toString(36).slice(2, 8)}`, source: 'alicia', type: 'CONVERSATION', message,
    context: {}, requestedBy: 'human', target: null, risk: null, status: 'RECEIVED', createdAt: clock, ...extra
  });
  return { home, hive, lapitaya, boundary, companion, server, runtimeEvents, delivered, pre, post, ran, send, chain, ledger, traces, intentFor, now };
}

module.exports = { floor, loadTs, A, agents };
