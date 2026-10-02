'use strict';
/**
 * La Pitaya CIMA v0.16 — Governance Policy & Capability Registry.
 *
 * The registry DESCRIBES policy (capabilities, providers, tools, risk / autonomy baselines, evidence, completion
 * sensitivity, version); CimaRuntimeService still DECIDES. Everything here runs against the REAL runtime
 * (CimaRuntimeService), the REAL HiveManager spawn path and the REAL HookServer where a hook matters.
 *
 *   POLICY-01..40  the v0.16 matrix (§31)
 *   ADV-01..10     adversarial (§32)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { TRUSTED_HUMAN: HUMAN } = require('./fixtures/human.cjs');

const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };

const ROOT = path.resolve(__dirname, '..');
const reg = loadTs('src/shared/lapitaya/policyRegistry.ts');
const tr = loadTs('src/shared/lapitaya/toolRisk.ts');
const gov = loadTs('src/shared/lapitaya/governance.ts');
const pg = loadTs('src/shared/lapitaya/providerGovernance.ts');
const obs = loadTs('src/shared/lapitaya/alicia/observability.ts');
const chain = loadTs('src/main/ledgerChain.ts');
const { makeBinding, sealApproval, loadOrCreateKey, subjectFingerprint } = loadTs('src/main/authBinding.ts');
const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');

const PUSH = { command: 'git push origin feature-x' };
const clone = () => JSON.parse(JSON.stringify(reg.DEFAULT_POLICY));
const capOf = (p, id) => p.capabilities.find((c) => c.id === id);
const toolOf = (p, name) => p.tools.find((t) => t.tool === name);
const errs = (p) => reg.validatePolicy(p).errors;

/** A floor: real HiveManager (agents spawned through the real governance path), real runtime wired like index.ts. */
async function mk(t, o = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v016-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'el-beni-1', name: 'El Beni', provider: 'claude', cwd: home });
  const clock = { t: 1_800_000_000_000 };
  const providerOverride = {};
  const stage = { v: o.stage ?? 'SUPERVISED' };
  const mkrt = (extra = {}) => new CimaRuntimeService({
    hiveRoot: () => hive.root(), godId: () => 'god', now: () => (clock.t += 1000), lockTimeoutMs: 800,
    stage: () => stage.v,
    cwdOf: (id) => hive.registry().agents[id]?.cwd ?? null,
    providerOf: (id) => (id in providerOverride ? providerOverride[id] : hive.registry().agents[id]?.provider ?? null),
    ...(o.policy ? { policy: o.policy } : {}),
    ...extra
  });
  const rt = mkrt();
  const server = new HookServer(hive, () => null, () => ({ autoMode: true, notifications: false }), undefined, undefined, undefined, undefined, rt);
  const hook = (agentId, payload) => server.handle({ agent_id: agentId, agent_token: hive.registerAgentToken(agentId), session_id: 's-' + agentId, ...payload });
  const pre = (agentId, tool, input, extra = {}) => hook(agentId, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, ...extra });
  const denied = (r) => !!(r && r.hookSpecificOutput && r.hookSpecificOutput.permissionDecision === 'deny');
  const dir = path.join(hive.root(), 'lapitaya');
  const ledger = () => (fs.existsSync(path.join(dir, 'cima-ledger.jsonl'))
    ? fs.readFileSync(path.join(dir, 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const gov = () => ledger().filter((e) => e.kind === 'governance');
  const hiveLog = () => (fs.existsSync(path.join(hive.root(), 'log.jsonl'))
    ? fs.readFileSync(path.join(hive.root(), 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const approvalsFile = path.join(dir, 'approvals.json');
  const approve = (r, agent, tool, input) => {
    const a = r.authorize(agent, tool, input);
    assert.equal(a.decision, 'HUMAN_APPROVAL_REQUIRED', `${tool} ${JSON.stringify(input)} → ${a.decision} ${a.rule}`);
    assert.ok(r.decide(a.approvalId, true, 'human', HUMAN));
    return a.approvalId;
  };
  return { home, hive, rt, mkrt, server, hook, pre, denied, dir, ledger, gov, hiveLog, approvalsFile, approve, clock, providerOverride, stage };
}

// ─── POLICY-01..06: load, validate, reject malformed definitions ───────────

test('[POLICY-01] the registry loads: valid, versioned, every capability with a stable ASCII id', () => {
  const R = reg.POLICY_REGISTRY;
  assert.equal(R.valid, true, R.errors.join('; '));
  assert.equal(R.version, reg.CIMA_POLICY_VERSION);
  assert.equal(reg.CIMA_POLICY_VERSION, 1);
  const ids = R.listCapabilities().map((c) => c.id);
  assert.ok(ids.length >= 17);
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, id);
  for (const want of ['shell.execute', 'filesystem.write', 'filesystem.edit', 'tasks.complete', 'governance.approval', 'mcp.tool', 'provider.spawn']) {
    assert.ok(R.getCapability(want), want);
  }
  // Every provider preset that exists has a policy (no provider is ungoverned by omission).
  const { AGENT_PROVIDER_PRESETS } = loadTs('src/shared/agentProvider.ts');
  for (const p of AGENT_PROVIDER_PRESETS) assert.ok(R.getProviderPolicy(p.id), p.id);
});

test('[POLICY-02] the policy in code validates, deterministically', () => {
  const a = reg.validatePolicy(reg.DEFAULT_POLICY);
  const b = reg.validatePolicy(clone());
  assert.deepEqual(a, { ok: true, errors: [] });
  assert.deepEqual(b, a);
  // validation checks each provider declaration against the bridge the presets actually wire
  for (const p of reg.DEFAULT_POLICY.providers) assert.equal(reg.derivedEnforcement(p.id), p.enforcement, p.id);
});

test('[POLICY-03] a duplicate capability id is rejected and the registry fails closed', () => {
  const p = clone();
  p.capabilities.push({ ...capOf(p, 'filesystem.read') });
  assert.ok(errs(p).some((e) => e.startsWith('DUPLICATE_CAPABILITY filesystem.read')), errs(p).join('; '));
  const R = reg.createPolicyRegistry(p);
  assert.equal(R.valid, false);
  const r = R.resolveCapability({ provider: 'claude', tool: 'Read', operation: 'read' });
  assert.deepEqual([r.ok, r.code], [false, 'POLICY_INVALID']);
  // duplicates of providers and tool bindings too
  const q = clone(); q.providers.push({ ...q.providers[0] }); q.tools.push({ ...toolOf(q, 'Bash') });
  assert.ok(errs(q).some((e) => e.startsWith('DUPLICATE_PROVIDER claude')));
  assert.ok(errs(q).some((e) => e.startsWith('DUPLICATE_TOOL_BINDING Bash')));
});

test('[POLICY-04] an invalid risk is rejected (no new levels)', () => {
  for (const bad of ['CRITICAL', 'low', '', null, 3]) {
    const p = clone(); capOf(p, 'shell.execute').risk = bad;
    assert.ok(errs(p).some((e) => e.startsWith('INVALID_RISK shell.execute')), `${bad}: ${errs(p).join('; ')}`);
  }
});

test('[POLICY-05] an invalid autonomy is rejected (no new levels)', () => {
  for (const bad of ['YOLO', 'FULL_AUTO', 'auto', undefined]) {
    const p = clone(); capOf(p, 'shell.execute').autonomy = bad;
    assert.ok(errs(p).some((e) => e.startsWith('INVALID_AUTONOMY shell.execute')), `${bad}: ${errs(p).join('; ')}`);
  }
});

test('[POLICY-06] an invalid governance mode is rejected (AUTO · SUPERVISED · HUMAN_APPROVAL · DENIED only)', () => {
  for (const bad of ['ALLOW', 'TRUSTED', 'BYPASS', 'deny']) {
    const p = clone(); capOf(p, 'shell.execute').governanceMode = bad;
    assert.ok(errs(p).some((e) => e.startsWith('INVALID_GOVERNANCE_MODE shell.execute')), `${bad}: ${errs(p).join('; ')}`);
  }
  const p = clone(); capOf(p, 'filesystem.read').evidence = [];
  assert.ok(errs(p).some((e) => e.startsWith('MISSING_EVIDENCE_POLICY filesystem.read')));
  const q = clone(); delete capOf(q, 'filesystem.read').evidence;
  assert.ok(errs(q).some((e) => e.startsWith('MISSING_EVIDENCE_POLICY filesystem.read')));
});

// ─── POLICY-07..09: unknown provider / tool / capability → DENY ─────────────

test('[POLICY-07] an unknown provider is denied — at the tool boundary and at spawn, opt-out or not', async (t) => {
  const f = await mk(t);
  f.providerOverride['el-beni-1'] = 'evil-provider';
  const a = f.rt.authorize('el-beni-1', 'Read', { file_path: path.join(f.home, 'a.ts') });
  assert.deepEqual([a.decision, a.rule], ['DENY', 'PROVIDER_UNKNOWN']);
  const last = f.gov().at(-1);
  assert.deepEqual([last.decision, last.rule, last.policyVersion], ['DENY', 'PROVIDER_UNKNOWN', 1]);
  for (const p of ['evil-provider', 'agy', 'CLAUDE', '', 'claude ']) {
    for (const allowUngoverned of [false, true]) {
      const d = pg.spawnGovernanceDecision(p, { allowUngoverned });
      assert.deepEqual([d.allowed, d.code], [false, 'PROVIDER_UNKNOWN'], `${JSON.stringify(p)} opt-in=${allowUngoverned}`);
    }
  }
  await assert.rejects(() => f.hive.ensureAgent({ id: 'x-1', name: 'X', provider: 'evil-provider', cwd: f.home }, { allowUngovernedProviders: true }), /PROVIDER_UNKNOWN/);
  assert.ok(f.hiveLog().some((e) => e.kind === 'spawn_denied' && e.code === 'PROVIDER_UNKNOWN' && e.policyVersion === 1));
});

test('[POLICY-08] an unknown tool is denied outright (TOOL_UNKNOWN) — not LOW, not AUTO, not an approval request', async (t) => {
  const f = await mk(t);
  for (const tool of ['FrobnicateTool', 'write_file', 'mcp__', 'bash', 'Bash ', 'intent']) {
    const a = f.rt.authorize('el-beni-1', tool, { file_path: 'x.ts', command: 'ls' });
    assert.deepEqual([a.decision, a.rule], ['DENY', 'TOOL_UNKNOWN'], tool);
  }
  assert.equal(f.rt.listApprovals().length, 0, 'an unknown tool raises no approval a human could rubber-stamp');
  const r = await f.pre('el-beni-1', 'FrobnicateTool', {});
  assert.equal(f.denied(r), true);
  assert.match(r.hookSpecificOutput.permissionDecisionReason, /TOOL_UNKNOWN/);
});

test('[POLICY-09] an unknown capability is denied with a structured CAPABILITY_UNKNOWN', () => {
  const R = reg.POLICY_REGISTRY;
  assert.equal(R.getCapability('shell.root'), null);
  const r = R.resolveCapability({ provider: 'claude', tool: 'Task', operation: 'governance-state' });
  assert.deepEqual([r.ok, r.code, r.policyVersion], [false, 'CAPABILITY_UNKNOWN', 1]);
  const a = gov.authorizeToolCall({ agentId: 'a', tool: 'Task', input: {}, provider: 'claude',
    classify: () => ({ category: 'governance-tamper', risk: 'HIGH', summary: 'x', rule: 'x' }) });
  assert.deepEqual([a.decision, a.rule], ['DENY', 'CAPABILITY_UNKNOWN']);
  assert.doesNotMatch(a.reason, /unknown error/i);
});

// ─── POLICY-10..13: provider governance, connected to the real spawn path ────

test('[POLICY-10] blocking providers are governed: spawned, and their calls go through CIMA', async (t) => {
  const f = await mk(t);
  for (const p of ['claude', 'codex', 'grok', 'gemini', 'antigravity']) {
    const d = pg.spawnGovernanceDecision(p);
    assert.deepEqual([d.allowed, d.enforcement, d.capability, d.policyVersion], [true, 'blocking', 'provider.spawn', 1], p);
    f.providerOverride['el-beni-1'] = p;
    const a = f.rt.authorize('el-beni-1', 'Bash', PUSH);
    assert.deepEqual([a.decision, a.capability], ['HUMAN_APPROVAL_REQUIRED', 'shell.high-impact'], p);
  }
  await f.hive.ensureAgent({ id: 'cx-1', name: 'Codex One', provider: 'codex', cwd: f.home });
  assert.equal(f.hive.registry().agents['cx-1'].provider, 'codex');
});

test('[POLICY-11] observe-only providers are blocked by default (spawn path)', async (t) => {
  const f = await mk(t);
  for (const p of ['qwen', 'opencode', 'crush', 'pi']) {
    const d = pg.spawnGovernanceDecision(p);
    assert.deepEqual([d.allowed, d.enforcement, d.code], [false, 'observe-only', 'LAPITAYA_GOVERNANCE_UNENFORCEABLE'], p);
  }
  await assert.rejects(() => f.hive.ensureAgent({ id: 'pi-1', name: 'Pi', provider: 'pi', cwd: f.home }), /LAPITAYA_GOVERNANCE_UNENFORCEABLE/);
  assert.equal(f.hive.registry().agents['pi-1'], undefined);
});

test('[POLICY-12] none providers are blocked by default (spawn path)', async (t) => {
  const f = await mk(t);
  for (const p of ['kimi', 'copilot', 'cursor', 'custom']) {
    const d = pg.spawnGovernanceDecision(p);
    assert.deepEqual([d.allowed, d.enforcement, d.code], [false, 'none', 'LAPITAYA_GOVERNANCE_UNENFORCEABLE'], p);
  }
  await assert.rejects(() => f.hive.ensureAgent({ id: 'k-1', name: 'Kimi', provider: 'kimi', cwd: f.home }), /LAPITAYA_GOVERNANCE_UNENFORCEABLE/);
  assert.ok(f.hiveLog().some((e) => e.kind === 'spawn_denied' && e.provider === 'kimi' && e.code === 'LAPITAYA_GOVERNANCE_UNENFORCEABLE'));
});

test('[POLICY-13] the explicit human opt-in for an ungoverned provider stays explicit and is now auditable', async (t) => {
  const f = await mk(t);
  const d = pg.spawnGovernanceDecision('kimi', { allowUngoverned: true });
  assert.deepEqual([d.allowed, d.overridden, d.enforcement], [true, true, 'none']);
  assert.equal(pg.spawnGovernanceDecision('kimi', { allowUngoverned: 'yes' }).allowed, false, 'only a literal true opts in');
  await f.hive.ensureAgent({ id: 'k-2', name: 'Kimi Two', provider: 'kimi', cwd: f.home }, { allowUngovernedProviders: true });
  const log = f.hiveLog().filter((e) => e.kind === 'spawn_ungoverned_override');
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].agentId, log[0].provider, log[0].enforcement, log[0].policyVersion, log[0].capability], ['k-2', 'kimi', 'none', 1, 'provider.spawn']);
  // The opt-in is not the default anywhere in main (it is never set from a renderer argument).
  const main = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf8');
  assert.doesNotMatch(main, /allowUngovernedProviders\s*:\s*true/);
});

// ─── POLICY-14..16: resolution ──────────────────────────────────────────────

test('[POLICY-14] a tool resolves to its capability (one table, not scattered sets)', async (t) => {
  const f = await mk(t);
  const cases = [
    ['Read', { file_path: path.join(f.home, 'a.ts') }, 'filesystem.read'],
    ['Grep', { pattern: 'x' }, 'filesystem.read'],
    ['WebFetch', { url: 'https://example.com' }, 'web.fetch'],
    ['TodoWrite', { todos: [] }, 'agent.todo'],
    ['Task', { description: 'x' }, 'agent.delegate'],
    ['Write', { file_path: path.join(f.home, 'src', 'a.ts'), content: 'x' }, 'filesystem.write'],
    ['Edit', { file_path: path.join(f.home, 'src', 'a.ts'), old_string: 'a', new_string: 'b' }, 'filesystem.edit'],
    ['NotebookEdit', { notebook_path: path.join(f.home, 'n.ipynb') }, 'filesystem.edit'],
    ['Bash', { command: 'ls' }, 'shell.inspect'],
    ['run_shell_command', { command: 'ls' }, 'shell.inspect'],
    ['mcp__github__create_issue', { title: 'x' }, 'mcp.tool']
  ];
  for (const [tool, input, want] of cases) {
    const a = f.rt.authorize('el-beni-1', tool, input);
    assert.equal(a.capability, want, `${tool} → ${a.capability} (${a.decision} ${a.rule})`);
    assert.equal(a.policyVersion, 1);
  }
  assert.equal(tr.isShellTool('PowerShell'), true);
  assert.equal(tr.isWriteTool('NotebookEdit'), true);
  assert.equal(tr.isWriteTool('Read'), false);
});

test('[POLICY-15] the provider resolves through the registry (bridge, enforcement); null is unattributed, not trusted', () => {
  const R = reg.POLICY_REGISTRY;
  const r = R.resolveCapability({ provider: 'codex', tool: 'Read', operation: 'read' });
  assert.equal(r.ok, true);
  assert.deepEqual([r.provider.id, r.provider.enforcement, r.provider.bridge], ['codex', 'blocking', 'hooks:codex']);
  assert.equal(R.getProviderPolicy('qwen').bridge, 'proxy:openai');
  assert.equal(R.getProviderPolicy('kimi').bridge, null);
  const n = R.resolveCapability({ provider: null, tool: 'Read', operation: 'read' });
  assert.deepEqual([n.ok, n.provider], [true, null]);
  assert.equal(R.resolveCapability({ provider: 42, tool: 'Read', operation: 'read' }).code, 'PROVIDER_UNKNOWN');
});

test('[POLICY-16] the operation (derived by the runtime from the actual call) selects the capability', async (t) => {
  const f = await mk(t);
  const cases = [
    ['Bash', { command: 'git status' }, 'shell.inspect', 'ALLOW'],
    ['Bash', { command: 'node scripts/gen.js' }, 'shell.execute', 'SUPERVISED'],
    ['Bash', { command: 'echo x > out.txt' }, 'shell.mutation', 'SUPERVISED'],
    ['Bash', { command: 'git push' }, 'shell.high-impact', 'HUMAN_APPROVAL_REQUIRED'],
    ['Bash', { command: 'echo x > registry.json' }, 'governance.state-write', 'HUMAN_APPROVAL_REQUIRED'],
    // a mutating command naming the task ledger is also judged by the decision gate (v0.11): refused outright
    ['Bash', { command: 'echo x > tasks.json' }, 'governance.state-write', 'DENY'],
    ['Write', { file_path: path.join(f.home, '.env'), content: 'K=1' }, 'filesystem.sensitive-write', 'HUMAN_APPROVAL_REQUIRED'],
    ['Write', { file_path: path.join(f.home, 'src', 'main', 'hooks.ts'), content: 'x' }, 'governance.state-write', 'HUMAN_APPROVAL_REQUIRED'],
    ['Write', { file_path: path.join(f.home, 'src', 'shared', 'lapitaya', 'policyRegistry.ts'), content: 'x' }, 'governance.state-write', 'HUMAN_APPROVAL_REQUIRED'],
    ['Read', { file_path: path.join(f.home, '.env') }, 'filesystem.read-secret', 'HUMAN_APPROVAL_REQUIRED']
  ];
  for (const [tool, input, cap, decision] of cases) {
    const a = f.rt.authorize('el-beni-1', tool, input);
    assert.deepEqual([a.capability, a.decision], [cap, decision], `${tool} ${JSON.stringify(input)} (${a.rule})`);
  }
});

// ─── POLICY-17..21: precedence and monotonicity ─────────────────────────────

test('[POLICY-17] the policy baseline or the context can ELEVATE risk', async (t) => {
  // baseline elevation: a policy whose filesystem.write floor is MEDIUM supervises even a doc write
  const p = clone(); Object.assign(capOf(p, 'filesystem.write'), { risk: 'MEDIUM', autonomy: 'SUPERVISED', governanceMode: 'SUPERVISED' });
  const R = reg.createPolicyRegistry(p);
  assert.equal(R.valid, true, R.errors.join('; '));
  const f = await mk(t, { policy: R });
  const a = f.rt.authorize('el-beni-1', 'Write', { file_path: path.join(f.home, 'README.md'), content: 'x' });
  assert.deepEqual([a.risk, a.mode, a.decision, a.elevated, a.category], ['MEDIUM', 'SUPERVISED', 'SUPERVISED', true, 'documentation']);
  // context elevation: the same doc tool on a governance path is HIGH (canonical target decides)
  const g = f.rt.authorize('el-beni-1', 'Write', { file_path: path.join(f.hive.root(), 'lapitaya', 'notes.md'), content: 'x' });
  assert.deepEqual([g.risk, g.capability], ['HIGH', 'governance.state-write']);
});

test('[POLICY-18] a lower baseline cannot silently reduce the risk of the actual call', async (t) => {
  // A (valid) policy that maps shell high-impact work to a LOW/AUTO baseline still cannot make `git push` LOW.
  const p = clone(); Object.assign(capOf(p, 'shell.high-impact'), { risk: 'LOW', autonomy: 'AUTO', governanceMode: 'AUTO', evidence: ['GOVERNANCE_EVENT_REQUIRED'] });
  const R = reg.createPolicyRegistry(p);
  assert.equal(R.valid, true, R.errors.join('; '));
  const f = await mk(t, { policy: R });
  const a = f.rt.authorize('el-beni-1', 'Bash', PUSH);
  assert.deepEqual([a.risk, a.mode, a.decision], ['HIGH', 'HUMAN_APPROVAL', 'HUMAN_APPROVAL_REQUIRED']);
  assert.equal(a.elevated, undefined);
});

test('[POLICY-19] HIGH can never become LOW — not by policy, not by stage', async (t) => {
  const p = clone(); Object.assign(capOf(p, 'shell.high-impact'), { autonomy: 'AUTO', governanceMode: 'AUTO' });
  assert.ok(errs(p).some((e) => e.startsWith('CONFLICT shell.high-impact: HIGH risk with autonomy AUTO')));
  const f = await mk(t, { stage: 'AUTONOMOUS' });
  for (const s of ['AUTONOMOUS', 'SEMI_AUTONOMOUS', 'SUPERVISED', 'HUMAN_CONTROLLED']) {
    f.stage.v = s;
    const a = f.rt.authorize('el-beni-1', 'Bash', { command: 'rm -rf build' });
    assert.deepEqual([a.risk, a.decision], ['HIGH', 'HUMAN_APPROVAL_REQUIRED'], s);
  }
});

test('[POLICY-20] HUMAN_APPROVAL can never become AUTO', async (t) => {
  // A capability whose policy demands a human keeps it at every stage, even with a LOW call underneath.
  const p = clone(); Object.assign(capOf(p, 'filesystem.read'), { autonomy: 'HUMAN_APPROVAL', governanceMode: 'HUMAN_APPROVAL', evidence: ['GOVERNANCE_EVENT_REQUIRED', 'HUMAN_DECISION_REQUIRED'] });
  const R = reg.createPolicyRegistry(p);
  assert.equal(R.valid, true, R.errors.join('; '));
  const f = await mk(t, { policy: R, stage: 'AUTONOMOUS' });
  const a = f.rt.authorize('el-beni-1', 'Read', { file_path: path.join(f.home, 'a.ts') });
  assert.deepEqual([a.risk, a.mode, a.decision], ['LOW', 'HUMAN_APPROVAL', 'HUMAN_APPROVAL_REQUIRED']);
  // and HUMAN_APPROVAL without a human-decision evidence requirement is a definition conflict
  const q = clone(); capOf(q, 'shell.high-impact').evidence = ['GOVERNANCE_EVENT_REQUIRED'];
  assert.ok(errs(q).some((e) => e.startsWith('CONFLICT shell.high-impact: HUMAN_APPROVAL without')));
});

test('[POLICY-21] DENIED can never become ALLOW — not by stage, not by an approval', async (t) => {
  const p = clone(); capOf(p, 'filesystem.read').governanceMode = 'DENIED';
  const R = reg.createPolicyRegistry(p);
  assert.equal(R.valid, true, R.errors.join('; '));
  const f = await mk(t, { policy: R });
  for (const s of ['AUTONOMOUS', 'SUPERVISED']) {
    f.stage.v = s;
    const a = f.rt.authorize('el-beni-1', 'Read', { file_path: path.join(f.home, 'a.ts') });
    assert.deepEqual([a.decision, a.rule, a.capability], ['DENY', 'CAPABILITY_DENIED', 'filesystem.read'], s);
  }
  assert.equal(f.rt.listApprovals().length, 0, 'DENIED raises no approval');
  const q = clone(); capOf(q, 'filesystem.read').enabled = false;
  const g = gov.authorizeToolCall({ agentId: 'a', tool: 'Read', input: { file_path: '/x/a.ts' }, policy: reg.createPolicyRegistry(q) });
  assert.deepEqual([g.decision, g.rule], ['DENY', 'CAPABILITY_DISABLED']);
});

// ─── POLICY-22..26: version, subject, binding ───────────────────────────────

test('[POLICY-22] every governance decision records the policy version (and the capability) — the runtime writes them', async (t) => {
  const f = await mk(t);
  f.rt.authorize('el-beni-1', 'Read', { file_path: path.join(f.home, 'a.ts') });
  f.rt.authorize('el-beni-1', 'FrobnicateTool', {});
  const id = f.approve(f.rt, 'el-beni-1', 'Bash', PUSH);
  f.rt.authorize('el-beni-1', 'Bash', PUSH);
  fs.writeFileSync(path.join(f.hive.root(), 'tasks.json'), JSON.stringify({ tasks: [{ id: 'T-1', status: 'doing' }] }));
  f.rt.handle('god', 'el-beni-1', { taskId: 'T-1', phase: 'BUILD' });
  f.rt.authorize('el-beni-1', 'Write', { file_path: path.join(f.hive.root(), 'tasks.json'), content: JSON.stringify({ tasks: [{ id: 'T-1', status: 'done' }] }) });
  const events = f.gov();
  assert.ok(events.length >= 6);
  for (const e of events) assert.equal(e.policyVersion, 1, `${e.decision} ${e.rule}`);
  const by = (d) => events.find((e) => e.decision === d);
  assert.equal(by('ALLOW').capabilityId, 'filesystem.read');
  assert.equal(by('HUMAN_APPROVED').capabilityId, 'shell.high-impact');
  assert.equal(by('HUMAN_APPROVED').approvalId, id);
  assert.equal(by('APPROVED').capabilityId, 'shell.high-impact');
  assert.equal(events.find((e) => e.rule === 'TOOL_UNKNOWN').capabilityId, undefined);
  assert.equal(events.find((e) => e.rule === 'DECISION_GATE' && e.capabilityId === 'tasks.complete').decision, 'DENY');
  // a runtime on another policy version stamps ITS version
  const p = clone(); p.version = 7;
  const g = await mk(t, { policy: reg.createPolicyRegistry(p) });
  g.rt.authorize('el-beni-1', 'Read', { file_path: path.join(g.home, 'a.ts') });
  assert.equal(g.gov().at(-1).policyVersion, 7);
  assert.equal(g.rt.policyVersion(), 7);
});

test('[POLICY-23] the resolved capability and the policy version are part of the authorization subject', async (t) => {
  const f = await mk(t);
  const a = f.rt.authorize('el-beni-1', 'Bash', PUSH);
  const apr = f.rt.listApprovals().find((x) => x.id === a.approvalId);
  assert.equal(apr.binding.subject.context.capability, 'shell.high-impact');
  assert.equal(apr.binding.subject.context.policy, 1);
  assert.equal(apr.binding.fingerprint, a.authFingerprint);
  const s = apr.binding.subject;
  const other = { ...s, context: { ...s.context, capability: 'filesystem.read' } };
  const otherV = { ...s, context: { ...s.context, policy: 2 } };
  assert.notEqual(subjectFingerprint(other), subjectFingerprint(s));
  assert.notEqual(subjectFingerprint(otherV), subjectFingerprint(s));
});

test('[POLICY-24] a capability change invalidates a prior approval', async (t) => {
  const f = await mk(t);
  f.approve(f.rt, 'el-beni-1', 'Bash', PUSH);
  // Same hive, same call — but the policy now resolves this work to a different capability.
  const p = clone();
  p.capabilities.push({ ...capOf(p, 'shell.high-impact'), id: 'shell.publish' });
  for (const name of ['Bash', 'PowerShell', 'shell', 'run_shell_command']) toolOf(p, name).operations['high-impact'] = 'shell.publish';
  const R = reg.createPolicyRegistry(p);
  assert.equal(R.valid, true, R.errors.join('; '));
  const rt2 = f.mkrt({ policy: R });
  const a = rt2.authorize('el-beni-1', 'Bash', PUSH);
  assert.deepEqual([a.decision, a.capability], ['HUMAN_APPROVAL_REQUIRED', 'shell.publish']);
  assert.match(a.reason, /APPROVAL_CAPABILITY_MISMATCH/);
  // the original runtime can still use its own approval exactly once
  assert.equal(f.rt.authorize('el-beni-1', 'Bash', PUSH).decision, 'APPROVED');
});

test('[POLICY-25] a provider change invalidates a prior approval', async (t) => {
  const f = await mk(t);
  f.approve(f.rt, 'el-beni-1', 'Bash', PUSH);
  f.providerOverride['el-beni-1'] = 'codex';
  const a = f.rt.authorize('el-beni-1', 'Bash', PUSH);
  assert.equal(a.decision, 'HUMAN_APPROVAL_REQUIRED');
  delete f.providerOverride['el-beni-1'];
  assert.equal(f.rt.authorize('el-beni-1', 'Bash', PUSH).decision, 'APPROVED');
});

test('[POLICY-26] a tool change invalidates a prior approval', async (t) => {
  const f = await mk(t);
  f.approve(f.rt, 'el-beni-1', 'Bash', PUSH);
  for (const tool of ['PowerShell', 'shell', 'run_shell_command']) {
    assert.equal(f.rt.authorize('el-beni-1', tool, PUSH).decision, 'HUMAN_APPROVAL_REQUIRED', tool);
  }
  assert.equal(f.rt.authorize('el-beni-1', 'Bash', PUSH).decision, 'APPROVED');
});

// ─── POLICY-27..34: fail closed, no policy from agents / renderer / Alicia ───

test('[POLICY-27] an operation the policy has no capability for fails closed (never AUTO)', async (t) => {
  const p = clone();
  for (const name of ['Bash', 'PowerShell', 'shell', 'run_shell_command']) delete toolOf(p, name).operations.mutate;
  const R = reg.createPolicyRegistry(p);
  assert.equal(R.valid, true, R.errors.join('; '));
  const f = await mk(t, { policy: R });
  const a = f.rt.authorize('el-beni-1', 'Bash', { command: 'echo x > out.txt' });
  assert.deepEqual([a.decision, a.rule], ['DENY', 'CAPABILITY_UNKNOWN']);
  assert.equal(f.rt.authorize('el-beni-1', 'Bash', { command: 'ls' }).decision, 'ALLOW', 'the rest of the policy still works');
});

test('[POLICY-28] an agent cannot define a capability (call input and hook payload are not policy)', async (t) => {
  const f = await mk(t);
  const r = await f.pre('el-beni-1', 'Bash', { ...PUSH, capability: 'filesystem.read', capabilityId: 'filesystem.read' },
    { capability: 'filesystem.read', capabilityId: 'filesystem.read', policyVersion: 0 });
  assert.equal(f.denied(r), true);
  const e = f.gov().at(-1);
  assert.deepEqual([e.decision, e.capabilityId, e.policyVersion], ['HUMAN_APPROVAL_REQUIRED', 'shell.high-impact', 1]);
});

test('[POLICY-29] an agent cannot redefine risk', async (t) => {
  const f = await mk(t);
  const r = await f.pre('el-beni-1', 'Bash', { ...PUSH, risk: 'LOW', category: 'read-code' }, { risk: 'LOW', category: 'read-code' });
  assert.equal(f.denied(r), true);
  assert.deepEqual([f.gov().at(-1).risk, f.gov().at(-1).decision], ['HIGH', 'HUMAN_APPROVAL_REQUIRED']);
});

test('[POLICY-30] an agent cannot redefine autonomy — nor edit the policy code', async (t) => {
  const f = await mk(t);
  const r = await f.pre('el-beni-1', 'Bash', { ...PUSH, mode: 'AUTO', autonomy: 'AUTO' }, { mode: 'AUTO', decision: 'ALLOW', stage: 'AUTONOMOUS' });
  assert.equal(f.denied(r), true);
  assert.equal(f.gov().at(-1).mode, 'HUMAN_APPROVAL');
  for (const [tool, input] of [
    ['Write', { file_path: path.join(f.home, 'src', 'shared', 'lapitaya', 'policyRegistry.ts'), content: 'export const CIMA_POLICY_VERSION = 0;' }],
    ['Edit', { file_path: path.join(f.home, 'src', 'shared', 'lapitaya', 'policyRegistry.ts'), old_string: "'HIGH'", new_string: "'LOW'" }],
    ['Bash', { command: 'sed -i s/HIGH/LOW/ src/shared/lapitaya/policyRegistry.ts' }],
    ['PowerShell', { command: "(Get-Content src\\shared\\lapitaya\\policyRegistry.ts) -replace 'HIGH','LOW' > src\\shared\\lapitaya\\policyRegistry.ts" }]
  ]) {
    const a = f.rt.authorize('el-beni-1', tool, input);
    assert.deepEqual([a.risk, a.capability, a.decision], ['HIGH', 'governance.state-write', 'HUMAN_APPROVAL_REQUIRED'], `${tool} ${JSON.stringify(input).slice(0, 60)}`);
  }
});

test('[POLICY-31] the renderer cannot redefine policy: no channel exists, and the registry is immutable', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'src/preload/index.ts'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf8');
  const channels = [...preload.matchAll(/ipcRenderer\.(?:invoke|send|sendSync)\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(channels.length > 20);
  for (const c of channels) assert.doesNotMatch(c, /policy|capabilit|risk|autonomy/i, c);
  assert.doesNotMatch(preload, /policyRegistry|CIMA_POLICY_VERSION|createPolicyRegistry/);
  for (const m of main.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)) assert.doesNotMatch(m[1], /policy|capabilit|risk|autonomy/i, m[1]);
  assert.doesNotMatch(main, /createPolicyRegistry|policy\s*:/, 'main wires no policy of its own (the runtime uses the policy in code)');
  const R = reg.POLICY_REGISTRY;
  assert.equal(Object.isFrozen(R), true);
  assert.equal(Object.isFrozen(reg.DEFAULT_POLICY), true);
  assert.equal(Object.isFrozen(reg.DEFAULT_POLICY.capabilities[0]), true);
  assert.equal(Object.isFrozen(R.getCapability('shell.high-impact')), true);
  assert.deepEqual(Object.keys(R).sort(), ['errors', 'getCapability', 'getProviderPolicy', 'getToolPolicy', 'listCapabilities', 'resolveCapability', 'valid', 'version']);
});

test('[POLICY-32] Alicia cannot redefine policy: she reads the runtime\'s recorded facts only', () => {
  const dir = path.join(ROOT, 'src/shared/lapitaya/alicia');
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(src, /policyRegistry|createPolicyRegistry|resolveCapability|authorizeToolCall/, file);
  }
  const renderer = path.join(ROOT, 'src/renderer/src/components/alicia');
  for (const file of fs.readdirSync(renderer)) {
    assert.doesNotMatch(fs.readFileSync(path.join(renderer, file), 'utf8'), /policyRegistry|resolveCapability/, file);
  }
  // The projection shows what the runtime recorded — verbatim — and never computes it.
  const rec = { kind: 'governance', ts: 1, agentId: 'el-beni-1', tool: 'Bash', category: 'irreversible', risk: 'HIGH', mode: 'HUMAN_APPROVAL', decision: 'HUMAN_APPROVAL_REQUIRED', rule: 'shell:git-push', capabilityId: 'shell.high-impact', policyVersion: 1 };
  const [o] = obs.observeLedgerRecord(rec);
  assert.deepEqual([o.capability, o.policyVersion], ['shell.high-impact', 1]);
  const [n] = obs.observeLedgerRecord({ ...rec, capabilityId: undefined, policyVersion: undefined });
  assert.deepEqual([n.capability, n.policyVersion], [null, null], 'Alicia does not fill in a capability the runtime did not record');
  const [bad] = obs.observeLedgerRecord({ ...rec, capabilityId: 'sk-ant-abcdefabcdefabcdefabcdef0123456789', policyVersion: -1 });
  assert.deepEqual([bad.capability, bad.policyVersion], [null, null]);
});

test('[POLICY-33] a corrupted policy fails closed: nothing is authorized, nothing is spawned', async (t) => {
  const corrupt = [
    null, 'policy', { version: 1 }, { ...clone(), capabilities: 'all' }, { ...clone(), version: 0 },
    { ...clone(), tools: [{ tool: 'Bash', match: 'exact', classifier: 'shell', operations: {} }] }
  ];
  const throwing = { version: 1, get capabilities() { throw new Error('boom'); }, providers: [], tools: [] };
  for (const c of [...corrupt, throwing]) {
    const R = reg.createPolicyRegistry(c);
    assert.equal(R.valid, false);
    assert.equal(R.resolveCapability({ provider: 'claude', tool: 'Read', operation: 'read' }).code, 'POLICY_INVALID');
    assert.equal(pg.spawnGovernanceDecision('claude', { policy: R }).code, 'POLICY_INVALID');
  }
  const R = reg.createPolicyRegistry({ ...clone(), capabilities: 'all' });
  const f = await mk(t, { policy: R });
  for (const [tool, input] of [['Read', { file_path: path.join(f.home, 'a.ts') }], ['Bash', { command: 'ls' }], ['Task', { description: 'x' }]]) {
    const a = f.rt.authorize('el-beni-1', tool, input);
    assert.deepEqual([a.decision, a.rule], ['DENY', 'POLICY_INVALID'], tool);
  }
});

test('[POLICY-34] conflicting definitions fail closed', () => {
  const cases = [
    [(p) => { Object.assign(capOf(p, 'shell.execute'), { autonomy: 'AUTO', governanceMode: 'AUTO' }); }, 'CONFLICT shell.execute: MEDIUM risk with autonomy AUTO'],
    [(p) => { capOf(p, 'shell.execute').governanceMode = 'HUMAN_APPROVAL'; }, 'CONFLICT shell.execute: governanceMode HUMAN_APPROVAL disagrees'],
    [(p) => { toolOf(p, 'Read').operations.read = 'filesystem.root'; }, 'CONFLICT tool Read: operation read → unknown capability'],
    [(p) => { p.providers.find((x) => x.id === 'codex').enforcement = 'observe-only'; }, 'CONFLICT provider codex: declared observe-only, its bridge makes it blocking'],
    [(p) => { p.providers.find((x) => x.id === 'qwen').enforcement = 'blocking'; }, 'CONFLICT provider qwen: declared blocking'],
    [(p) => { p.providers = p.providers.filter((x) => x.id !== 'pi'); }, 'MISSING_PROVIDER pi'],
    [(p) => { p.providers.push({ id: 'evil', enforcement: 'blocking', bridge: 'native' }); }, 'CONFLICT provider evil: no such provider preset'],
    [(p) => { p.tools.push({ tool: 'mcp__x', match: 'prefix', classifier: 'mcp', operations: { invoke: 'mcp.tool' } }); }, 'CONFLICT tool prefix mcp__x overlaps'],
    [(p) => { p.tools.push({ tool: 'mcp__github__x', match: 'exact', classifier: 'read', operations: { read: 'filesystem.read' } }); }, 'CONFLICT tool mcp__github__x: exact binding shadowed'],
    [(p) => { capOf(p, 'filesystem.read').evidence = ['NONE', 'TRACE_REQUIRED']; }, 'CONFLICT filesystem.read: evidence NONE combined']
  ];
  for (const [mutate, want] of cases) {
    const p = clone(); mutate(p);
    const v = reg.validatePolicy(p);
    assert.equal(v.ok, false, want);
    assert.ok(v.errors.some((e) => e.startsWith(want)), `${want} ∉ ${v.errors.join('; ')}`);
    const a = gov.authorizeToolCall({ agentId: 'a', tool: 'Read', input: { file_path: '/x/a.ts' }, policy: reg.createPolicyRegistry(p) });
    assert.deepEqual([a.decision, a.rule], ['DENY', 'POLICY_INVALID'], want);
  }
});

// ─── POLICY-35..40: regression of v0.11 / v0.14 / v0.15 guarantees ─────────

test('[POLICY-35] v0.14 authorization binding: one approval, one exact call, once', async (t) => {
  const f = await mk(t);
  f.approve(f.rt, 'el-beni-1', 'Bash', PUSH);
  assert.equal(f.rt.authorize('el-beni-1', 'Bash', { command: 'git push origin feature-y' }).decision, 'HUMAN_APPROVAL_REQUIRED', 'different input');
  assert.equal(f.rt.authorize('god', 'Bash', PUSH).decision, 'HUMAN_APPROVAL_REQUIRED', 'different agent');
  assert.equal(f.rt.authorize('el-beni-1', 'Bash', PUSH).decision, 'APPROVED');
  assert.equal(f.rt.authorize('el-beni-1', 'Bash', PUSH).decision, 'HUMAN_APPROVAL_REQUIRED', 'consumed');
  // TTL
  const g = await mk(t);
  const rt = g.mkrt({ approvalTtlMs: 60_000 });
  g.approve(rt, 'el-beni-1', 'Bash', PUSH);
  g.clock.t += 120_000;
  assert.equal(rt.authorize('el-beni-1', 'Bash', PUSH).decision, 'HUMAN_APPROVAL_REQUIRED', 'expired');
});

test('[POLICY-36] v0.15 event integrity: the new fields are inside the chain; tampering them is detected and closes governance', async (t) => {
  const f = await mk(t);
  f.rt.authorize('el-beni-1', 'Read', { file_path: path.join(f.home, 'a.ts') });
  f.approve(f.rt, 'el-beni-1', 'Bash', PUSH);
  f.rt.authorize('el-beni-1', 'Bash', PUSH);
  assert.equal(f.mkrt().verifyGovernanceState({ full: true }).status, 'HEALTHY');
  const file = path.join(f.dir, 'cima-ledger.jsonl');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const i = lines.findIndex((l) => JSON.parse(l).decision === 'ALLOW');
  const e = JSON.parse(lines[i]); e.policyVersion = 0; e.capabilityId = 'filesystem.write';
  lines[i] = JSON.stringify(e);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const rt = f.mkrt();
  const v = rt.verifyGovernanceState({ full: true });
  assert.equal(v.status, 'CORRUPTED');
  assert.equal(rt.authorize('el-beni-1', 'Read', { file_path: path.join(f.home, 'a.ts') }).decision, 'DENY');
});

test('[POLICY-37] completionGate stays the authority; completion-sensitive capabilities are judged by it', async (t) => {
  const f = await mk(t);
  const tasks = path.join(f.hive.root(), 'tasks.json');
  fs.writeFileSync(tasks, JSON.stringify({ tasks: [{ id: 'T-9', status: 'doing' }] }));
  f.rt.handle('god', 'el-beni-1', { taskId: 'T-9', phase: 'BUILD' }); // a CIMA-governed task
  const done = JSON.stringify({ tasks: [{ id: 'T-9', status: 'done' }] });
  for (const [tool, input] of [
    ['Write', { file_path: tasks, content: done }],
    ['Bash', { command: `echo '${done}' > tasks.json` }],
    ['mcp__fs__write_file', { path: tasks, content: done }],
    ['NotebookEdit', { notebook_path: tasks, new_source: done }]
  ]) {
    const a = f.rt.authorize('el-beni-1', tool, input);
    assert.deepEqual([a.decision, a.rule], ['DENY', 'DECISION_GATE'], tool);
    assert.ok(reg.POLICY_REGISTRY.getCapability(a.capability)?.completionSensitive, `${tool} → ${a.capability}`);
  }
  // Not completion-sensitive (reading) → not judged; the gate itself is unchanged.
  assert.equal(f.rt.authorize('el-beni-1', 'Read', { file_path: tasks }).decision, 'ALLOW');
  const v = f.rt.completionGate('T-9');
  assert.equal(v.allowed, false);
  // a call the registry does not know never reaches completion by default
  assert.equal(f.rt.authorize('el-beni-1', 'write_tasks', { file_path: tasks, content: done }).decision, 'DENY');
  assert.equal(JSON.parse(fs.readFileSync(tasks, 'utf8')).tasks[0].status, 'doing');
});

test('[POLICY-38] provider spawn governance regression (real HiveManager): blocking spawns, others refused, decision unchanged', async (t) => {
  const f = await mk(t);
  const expected = { claude: true, codex: true, grok: true, gemini: true, antigravity: true, qwen: false, opencode: false, crush: false, pi: false, kimi: false, copilot: false, cursor: false, custom: false };
  for (const [p, allowed] of Object.entries(expected)) {
    assert.equal(pg.spawnGovernanceDecision(p).allowed, allowed, p);
  }
  await f.hive.ensureAgent({ id: 'gm-1', name: 'Gemini One', provider: 'gemini', cwd: f.home });
  await assert.rejects(() => f.hive.ensureAgent({ id: 'cr-1', name: 'Crush', provider: 'crush', cwd: f.home }), /LAPITAYA_GOVERNANCE_UNENFORCEABLE/);
});

test('[POLICY-39] MCP governance regression: classification → capability → authorization → gates; never AUTO by default', async (t) => {
  const f = await mk(t);
  const r = await f.pre('el-beni-1', 'mcp__github__create_issue', { title: 'x' });
  assert.equal(f.denied(r), false);
  const e = f.gov().at(-1);
  assert.deepEqual([e.decision, e.risk, e.capabilityId, e.rule], ['SUPERVISED', 'MEDIUM', 'mcp.tool', 'mcp']);
  for (const s of ['SUPERVISED', 'HUMAN_CONTROLLED']) {
    f.stage.v = s;
    assert.notEqual(f.rt.authorize('el-beni-1', 'mcp__srv__do', {}).decision, 'ALLOW', s);
  }
  f.stage.v = 'SUPERVISED';
  // bare / malformed MCP names are unknown tools
  assert.equal(f.rt.authorize('el-beni-1', 'mcp__', {}).rule, 'TOOL_UNKNOWN');
  // MCP cannot bypass completionGate (v0.11 COVERAGE-11)
  fs.writeFileSync(path.join(f.hive.root(), 'tasks.json'), JSON.stringify({ tasks: [{ id: 'T-2', status: 'doing' }] }));
  f.rt.handle('god', 'el-beni-1', { taskId: 'T-2', phase: 'BUILD' });
  const g = f.rt.authorize('el-beni-1', 'mcp__write_file', { file_path: path.join(f.hive.root(), 'tasks.json'), content: JSON.stringify({ tasks: [{ id: 'T-2', status: 'done' }] }) });
  assert.deepEqual([g.decision, g.rule], ['DENY', 'DECISION_GATE']);
});

test('[POLICY-40] shell governance regression: v0.11 classification unchanged; the registry adds no bypass', async (t) => {
  const f = await mk(t);
  const cases = [
    ['echo x > tasks.json', 'DECISION_GATE', 'DENY'],
    ['echo x >> registry.json', 'shell:governance-state', 'HUMAN_APPROVAL_REQUIRED'],
    ['cat foo 2> cima-ledger.jsonl', 'shell:governance-state', 'HUMAN_APPROVAL_REQUIRED'],
    ['echo $(cat a) > out.txt', 'shell:mutation', 'SUPERVISED'],
    ['find . -name x -delete', 'shell:find-destructive', 'HUMAN_APPROVAL_REQUIRED'],
    ['cat a | tee hive/lapitaya/approvals.json', 'shell:governance-state', 'HUMAN_APPROVAL_REQUIRED'],
    ['rm -rf node_modules', 'shell:recursive-delete', 'HUMAN_APPROVAL_REQUIRED'],
    ['git reset --hard HEAD~1', 'shell:git-destructive', 'HUMAN_APPROVAL_REQUIRED'],
    ['ls -la', 'shell:low', 'ALLOW'],
    ['npm test', 'shell:low', 'ALLOW'],
    ['mkdir build', 'shell:other', 'SUPERVISED']
  ];
  for (const [command, rule, decision] of cases) {
    const a = f.rt.authorize('el-beni-1', 'Bash', { command });
    assert.deepEqual([a.rule, a.decision], [rule, decision], command);
  }
  // sender authenticity (v0.14) still precedes everything
  const s = f.rt.authorize('el-beni-1', 'Bash', { command: 'echo hi > ../god/outbox/m.json' });
  assert.equal(s.decision, 'DENY');
});

// ─── ADV-01..10: adversarial ────────────────────────────────────────────────

test('[ADV-01] agent declares the tool LOW → runtime policy wins', async (t) => {
  const f = await mk(t);
  const r = await f.pre('el-beni-1', 'Bash', { command: 'rm -rf /srv/data', risk: 'LOW' }, { risk: 'LOW', tool_risk: 'LOW', category: 'read-code' });
  assert.equal(f.denied(r), true);
  assert.deepEqual([f.gov().at(-1).risk, f.gov().at(-1).capabilityId], ['HIGH', 'shell.high-impact']);
});

test('[ADV-02] agent declares its provider trusted → DENY (the runtime knows the provider)', async (t) => {
  const f = await mk(t);
  f.providerOverride['el-beni-1'] = 'evil-provider';
  const r = await f.pre('el-beni-1', 'Read', { file_path: path.join(f.home, 'a.ts') }, { provider: 'claude', trusted: true, enforcement: 'blocking' });
  assert.equal(f.denied(r), true);
  assert.equal(f.gov().at(-1).rule, 'PROVIDER_UNKNOWN');
});

test('[ADV-03] agent declares AUTO → runtime policy wins', async (t) => {
  const f = await mk(t);
  const r = await f.pre('el-beni-1', 'Bash', PUSH, { mode: 'AUTO', autonomy: 'AUTO', permissionDecision: 'allow', decision: 'ALLOW' });
  assert.equal(f.denied(r), true);
  assert.deepEqual([f.gov().at(-1).mode, f.gov().at(-1).decision], ['HUMAN_APPROVAL', 'HUMAN_APPROVAL_REQUIRED']);
});

test('[ADV-04] the renderer sends an altered risk / capability with a decision → ignored', async (t) => {
  const f = await mk(t);
  const a = f.rt.authorize('el-beni-1', 'Bash', PUSH);
  const before = f.rt.listApprovals().find((x) => x.id === a.approvalId);
  const decided = f.rt.decide(a.approvalId, true, 'human', { ...HUMAN, risk: 'LOW', capability: 'filesystem.read', policy: 0 });
  assert.ok(decided);
  assert.deepEqual([decided.risk, decided.binding.subject.context.capability, decided.binding.fingerprint], [before.risk, 'shell.high-impact', before.binding.fingerprint]);
  assert.equal(f.gov().at(-1).capabilityId, 'shell.high-impact');
  // The human IPC accepts only (id, approve); there is no argument through which policy could travel.
  const ipc = fs.readFileSync(path.join(ROOT, 'src/main/index.ts'), 'utf8');
  assert.match(ipc, /ipcMain\.handle\('lapitaya:decide', \(evt, id: unknown, approve: unknown\) => humanGov\.decide\(evt, id, approve\)\)/);
});

test('[ADV-05] Alicia (the intent boundary) sends an altered capability → the runtime resolves its own', async (t) => {
  const { floor } = require('./fixtures/lapitaya-floor.cjs');
  const g = await floor(t);
  const out = g.boundary.submit(g.intentFor('publica la rama', {
    type: 'ACTION', risk: 'LOW', capability: 'filesystem.read', target: { tool: 'Bash', input: { command: 'git push origin main' }, capability: 'filesystem.read' }
  }));
  assert.deepEqual([out.risk, out.decision], ['HIGH', 'HUMAN_APPROVAL_REQUIRED']);
  const apr = g.lapitaya.listApprovals().find((x) => x.status === 'pending');
  assert.equal(apr.binding.subject.context.capability, 'shell.high-impact');
  // the boundary's own evaluation pseudo-tool is reserved: no agent call can claim it
  const r = await g.pre('el-beni-1', 'intent', { intent: 'x' });
  assert.equal(r.hookSpecificOutput.permissionDecision, 'deny');
});

test('[ADV-06] a provider claims a different capability → the runtime resolves the actual one', async (t) => {
  const f = await mk(t);
  f.providerOverride['el-beni-1'] = 'gemini';
  const r = await f.pre('el-beni-1', 'run_shell_command', { command: 'rm -rf dist', capability: 'filesystem.read' }, { capability: 'web.fetch' });
  assert.equal(f.denied(r), true);
  const e = f.gov().at(-1);
  assert.deepEqual([e.provider, e.capabilityId, e.decision], ['gemini', 'shell.high-impact', 'HUMAN_APPROVAL_REQUIRED']);
});

test('[ADV-07] an unknown capability is denied', async (t) => {
  const f = await mk(t);
  for (const tool of ['TotallyNewTool', 'Bash_v2', 'mcp_', 'EXEC']) {
    const r = await f.pre('el-beni-1', tool, { command: 'ls' });
    assert.equal(f.denied(r), true, tool);
  }
  assert.ok(f.gov().slice(-4).every((e) => e.decision === 'DENY' && e.rule === 'TOOL_UNKNOWN'));
});

test('[ADV-08] modifying the registry at runtime is impossible; governance is unchanged after the attempts', async (t) => {
  const f = await mk(t);
  const R = reg.POLICY_REGISTRY;
  const attempts = [
    () => { R.resolveCapability = () => ({ ok: true }); },
    () => { R.valid = false; },
    () => { reg.DEFAULT_POLICY.capabilities.push({ id: 'x.y' }); },
    () => { R.getCapability('shell.high-impact').risk = 'LOW'; },
    () => { R.getCapability('shell.high-impact').evidence.length = 0; },
    () => { R.getToolPolicy('Bash').operations['high-impact'] = 'filesystem.read'; },
    () => { R.listCapabilities().pop(); },
    () => { reg.GOVERNANCE_SOURCES.shared.pop(); }
  ];
  for (const [i, fn] of attempts.entries()) assert.throws(fn, TypeError, `attempt ${i}`);
  assert.equal(f.rt.authorize('el-beni-1', 'Bash', PUSH).decision, 'HUMAN_APPROVAL_REQUIRED');
  // a registry is a COPY: mutating the source object after construction changes nothing
  const src = clone();
  const own = reg.createPolicyRegistry(src);
  capOf(src, 'shell.high-impact').risk = 'LOW';
  assert.equal(own.getCapability('shell.high-impact').risk, 'HIGH');
  // the runtime reads its registry once: there is no setter on the service
  assert.equal(typeof f.rt.setPolicy, 'undefined');
});

test('[ADV-09] an approval created under capability A does not authorize execution under capability B — even hand-edited', async (t) => {
  const f = await mk(t);
  const a = f.rt.authorize('el-beni-1', 'Bash', PUSH);
  assert.ok(f.rt.decide(a.approvalId, true, 'human', HUMAN));
  // An attacker edits approvals.json so the binding says capability B (fingerprint recomputed, seal left).
  const list = JSON.parse(fs.readFileSync(f.approvalsFile, 'utf8'));
  const apr = list.find((x) => x.id === a.approvalId);
  apr.binding = makeBinding({ ...apr.binding.subject, context: { ...apr.binding.subject.context, capability: 'filesystem.read' } });
  fs.writeFileSync(f.approvalsFile, JSON.stringify(list, null, 2));
  const rt = f.mkrt();
  const b = rt.authorize('el-beni-1', 'Bash', PUSH);
  assert.notEqual(b.decision, 'APPROVED');
  assert.ok(['DENY', 'HUMAN_APPROVAL_REQUIRED'].includes(b.decision), b.decision);
});

test('[ADV-10] an approval granted before v0.16 (no capability / policy in its subject) does not authorize under policy v1', async (t) => {
  const f = await mk(t);
  const a = f.rt.authorize('el-beni-1', 'Bash', PUSH);
  // Rewrite the PENDING request exactly as a v0.15 runtime would have bound and sealed it: no capability, no policy.
  const key = loadOrCreateKey(path.join(f.dir, '.seal.key'));
  const list = JSON.parse(fs.readFileSync(f.approvalsFile, 'utf8'));
  const apr = list.find((x) => x.id === a.approvalId);
  const { capability: _c, policy: _p, ...legacyCtx } = apr.binding.subject.context;
  apr.binding = makeBinding({ ...apr.binding.subject, context: legacyCtx });
  apr.seal = sealApproval(key, { id: apr.id, agentId: apr.agentId, tool: apr.tool, status: apr.status, createdAt: apr.createdAt, expiresAt: apr.expiresAt,
    decidedAt: apr.decidedAt, decidedBy: apr.decidedBy, decidedOwner: apr.decidedOwner?.id, consumedAt: apr.consumedAt, fingerprint: apr.binding.fingerprint });
  fs.writeFileSync(f.approvalsFile, JSON.stringify(list, null, 2));
  const rt = f.mkrt();
  const decided = rt.decide(apr.id, true, 'human', HUMAN);
  assert.ok(decided, 'the legacy request is still a well-formed approval the human can decide');
  // Defined behaviour: it is NOT used by a v1 call — the human is asked again, under policy v1 (no silent widening).
  const b = rt.authorize('el-beni-1', 'Bash', PUSH);
  assert.equal(b.decision, 'HUMAN_APPROVAL_REQUIRED');
  assert.match(b.reason, /APPROVAL_POLICY_MISMATCH .*v0 \(pre-v0\.16\)/);
  assert.notEqual(b.approvalId, apr.id);
  assert.ok(rt.decide(b.approvalId, true, 'human', HUMAN));
  assert.equal(rt.authorize('el-beni-1', 'Bash', PUSH).decision, 'APPROVED');
  // and a v1 approval does not authorize under a v2 policy
  const p = clone(); p.version = 2;
  const rt2 = f.mkrt({ policy: reg.createPolicyRegistry(p) });
  f.approve(rt, 'el-beni-1', 'Bash', PUSH);
  const c = rt2.authorize('el-beni-1', 'Bash', PUSH);
  assert.equal(c.decision, 'HUMAN_APPROVAL_REQUIRED');
  assert.match(c.reason, /APPROVAL_POLICY_MISMATCH .*v1;.*v2/);
});
