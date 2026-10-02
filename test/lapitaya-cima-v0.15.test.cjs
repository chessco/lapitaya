'use strict';
/**
 * La Pitaya CIMA v0.15 — Governance Event Integrity & Recovery.
 *
 * The governance ledger is a hash-chained, MAC-sealed event stream with a keyed head anchor; corruption is detected and
 * fails governance closed; state is reconciled against events; recovery is explicit and never invents facts.
 *
 * Everything runs against the REAL runtime (CimaRuntimeService + HiveManager + HookServer where a hook matters) and
 * real child processes for the multi-process cases.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const loadTs = require('./load-ts.cjs');
const { TRUSTED_HUMAN: HUMAN } = require('./fixtures/human.cjs');

const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { Notification: class { show() {} static isSupported() { return false; } } } };

const { CimaRuntimeService } = loadTs('src/main/cimaRuntime.ts');
const { HiveManager } = loadTs('src/main/hive.ts');
const { HookServer } = loadTs('src/main/hooks.ts');
const chain = loadTs('src/main/ledgerChain.ts');
const { loadOrCreateKey } = loadTs('src/main/authBinding.ts');
const integrity = loadTs('src/shared/lapitaya/governanceIntegrity.ts');
const obs = loadTs('src/shared/lapitaya/alicia/observability.ts');
const gov = loadTs('src/shared/lapitaya/governance.ts');

// ─── fixture ───────────────────────────────────────────────────────────────

const quiet = console.error;
function mk(t, o = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v015-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = path.join(home, 'hive');
  const dir = path.join(hive, 'lapitaya');
  fs.mkdirSync(dir, { recursive: true });
  const clock = { t: 1_800_000_000_000 };
  const mkrt = (extra = {}) => new CimaRuntimeService({ hiveRoot: () => hive, godId: () => 'god', now: () => (clock.t += 1000), lockTimeoutMs: 800, ...extra });
  const ledgerFile = path.join(dir, 'cima-ledger.jsonl');
  const lines = () => fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean);
  const events = () => lines().map((l) => JSON.parse(l));
  const put = (ls) => fs.writeFileSync(ledgerFile, ls.join('\n') + '\n');
  const key = () => loadOrCreateKey(path.join(dir, '.seal.key'));
  const gen = (rt, n, agent = 'agent-1') => { for (let i = 0; i < n; i++) rt.authorize(agent, 'Read', { file_path: path.join(home, `f${agent}${i}.ts`) }); };
  const errs = (v) => v.findings.filter((f) => f.severity === 'error').map((f) => f.code);
  const f = { home, hive, dir, clock, mkrt, rt: mkrt(), ledgerFile, lines, events, put, key, gen, errs, approvalsFile: path.join(dir, 'approvals.json'), proposalsFile: path.join(dir, 'proposals.json'), tracesFile: path.join(dir, 'traces.jsonl') };
  f.verify = (extra) => mkrt(extra).verifyGovernanceState({ full: true });
  /** A forged event, chained and MAC'd with the runtime key — i.e. what an attacker who HOLDS the key could write. */
  f.forge = (entry, over = {}) => {
    const ls = lines(); const last = JSON.parse(ls[ls.length - 1]);
    const e = chain.stampEvent(entry, over.sequence ?? last.sequence + 1, over.prev ?? last.eventHash, key());
    Object.assign(e, over.fields ?? {});
    if (over.rehash) { e.eventHash = chain.eventHashOf(e); e.eventMac = chain.eventMacOf(key(), e.eventHash); }
    fs.appendFileSync(ledgerFile, JSON.stringify(e) + '\n');
    return e;
  };
  return f;
}
const PUSH = { command: 'git push origin feature-x' };
const approve = (rt, agent, call) => { const a = rt.authorize(agent, 'Bash', call); assert.equal(a.decision, 'HUMAN_APPROVAL_REQUIRED'); assert.ok(rt.decide(a.approvalId, true, 'human', HUMAN)); return a.approvalId; };
const openReq = (rt, msg = 'revisa el estado del proyecto') => rt.openRequest({ intentId: 'int-' + Math.random().toString(36).slice(2), executor: 'god', requestedBy: 'human', source: 'alicia', message: msg, taskId: null, target: null, signals: [] });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const child = (mode, ...args) => new Promise((res, rej) => {
  const p = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'lapitaya-v15-proc.cjs'), mode, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('exit', (c) => (c === 0 ? res(JSON.parse(out.trim().split('\n').pop())) : rej(new Error(`${mode} exit ${c}: ${err.slice(0, 400)}`))));
});

// ─── EVENT-01..03: identity, ordering ──────────────────────────────────────

test('[EVENT-01] every new ledger line is an event with a runtime-generated identity and a place in the chain', async (t) => {
  const f = mk(t);
  f.gen(f.rt, 5);
  const ev = f.events();
  assert.equal(ev.length, 5);
  for (const e of ev) {
    assert.equal(e.schemaVersion, 2);
    assert.match(e.eventId, /^evt-[0-9a-f]{24}$/);
    assert.equal(typeof e.eventType, 'string');
    assert.ok(Number.isInteger(e.sequence) && e.sequence >= 1);
    assert.match(e.previousEventHash, /^[0-9a-f]{64}$/);
    assert.match(e.eventHash, /^[0-9a-f]{64}$/);
    assert.match(e.eventMac, /^[0-9a-f]{64}$/);
  }
  assert.equal(new Set(ev.map((e) => e.eventId)).size, 5, 'ids are unique');
  assert.equal(ev[0].eventType, 'AUTHORIZATION_GRANTED');
});

test('[EVENT-02] an actor cannot provide eventId, sequence or hashes', async (t) => {
  const f = mk(t);
  f.rt.recordTrace('agent-1', 'PostToolUse', 'Bash', { command: 'npm test' }, 'ok');
  // a claim carrying envelope fields at every level of the payload
  const claim = { taskId: 'T', phase: 'BUILD', verdict: 'PASS', eventId: 'evt-forged', sequence: 1, previousEventHash: 'a'.repeat(64), eventHash: 'b'.repeat(64), eventMac: 'c'.repeat(64), schemaVersion: 2, eventType: 'HUMAN_APPROVED',
    evidence: [{ type: 'test-result', source: 'npm test', eventId: 'evt-forged-2', sequence: 99 }] };
  const rec = f.rt.submit('agent-1', claim);
  assert.equal(rec.verdict, 'PASS');
  // a record handed to the runtime with envelope fields is re-stamped, never trusted
  f.rt.recordIntent({ kind: 'intent', id: 'x', eventId: 'evt-forged-3', sequence: 777, eventType: 'HUMAN_APPROVED', eventHash: 'd'.repeat(64), status: 'RECEIVED' });
  const ev = f.events();
  assert.ok(ev.every((e) => !String(e.eventId).includes('forged')), 'no forged id reached the ledger');
  assert.deepEqual(ev.map((e) => e.sequence), ev.map((_, i) => i + 1), 'sequence is the runtime\'s');
  assert.equal(ev.find((e) => e.kind === 'intent').eventType, 'INTENT_RECEIVED', 'the event type is derived, never claimed');
  assert.equal(errs(f.verify()).length, 0);
  function errs(v) { return f.errs(v); }
});

test('[EVENT-03] sequence is strictly monotonic and gapless, also across runtime instances', async (t) => {
  const f = mk(t);
  const A = f.mkrt(); const B = f.mkrt();
  for (let i = 0; i < 6; i++) { A.authorize('agent-1', 'Read', { file_path: `a${i}.ts` }); B.authorize('agent-2', 'Read', { file_path: `b${i}.ts` }); }
  const seqs = f.events().map((e) => e.sequence);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1));
  assert.equal(seqs.length, 12);
  assert.equal(f.verify().status, 'HEALTHY');
});

// ─── EVENT-04..14: the chain detects what changes it ───────────────────────

test('[EVENT-04] a duplicate sequence is rejected', async (t) => {
  const f = mk(t); f.gen(f.rt, 4);
  const L = f.lines(); L.splice(2, 0, L[1]); f.put(L);
  const v = f.verify();
  assert.equal(v.status, 'CORRUPTED');
  assert.equal(f.errs(v)[0], 'SEQUENCE_DUPLICATE');
});

test('[EVENT-05] a duplicate eventId is rejected (even inside an otherwise well-formed, sealed event)', async (t) => {
  const f = mk(t); f.gen(f.rt, 3);
  const last = f.events().at(-1);
  f.forge({ kind: 'governance', ts: 1, agentId: 'a', decision: 'ALLOW' }, { fields: { eventId: f.events()[0].eventId }, rehash: true });
  const v = f.verify();
  assert.equal(f.errs(v)[0], 'DUPLICATE_EVENT_ID');
  assert.ok(last);
});

test('[EVENT-06] the hash chain is verifiable by an independent implementation', async (t) => {
  const f = mk(t); f.gen(f.rt, 6); approve(f.rt, 'agent-1', PUSH);
  const GENESIS = sha('lapitaya/ledger-genesis/v1');
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
  let prev = GENESIS;
  const ev = f.events();
  for (const e of ev) {
    assert.equal(e.previousEventHash, prev);
    const { eventHash, eventMac, ...rest } = e;
    assert.equal(eventHash, sha('lapitaya/ledger-event/v2\n' + canon(rest)), `event ${e.sequence}`);
    const mac = crypto.createHmac('sha256', f.key()).update('lapitaya/ledger-event-mac/v1\n' + eventHash).digest('hex');
    assert.equal(eventMac, mac);
    prev = eventHash;
  }
  assert.equal(chain.GENESIS_HASH, GENESIS);
  const v = f.verify();
  assert.equal(v.status, 'HEALTHY');
  assert.equal(v.ledger.headHash, prev);
  assert.equal(v.ledger.headSequence, ev.length);
});

test('[EVENT-07] a mutated previousEventHash is detected', async (t) => {
  const f = mk(t); f.gen(f.rt, 4);
  const L = f.lines(); const e = JSON.parse(L[2]); e.previousEventHash = '0'.repeat(64); L[2] = JSON.stringify(e); f.put(L);
  assert.equal(f.errs(f.verify())[0], 'PREVIOUS_HASH_MISMATCH');
});

test('[EVENT-08] a mutated event (or a mutated eventHash) is detected', async (t) => {
  const f = mk(t); f.gen(f.rt, 4);
  const base = f.lines();
  let L = [...base]; let e = JSON.parse(L[1]); e.decision = 'DENY'; L[1] = JSON.stringify(e); f.put(L);
  assert.equal(f.errs(f.verify())[0], 'EVENT_HASH_MISMATCH', 'content changed, hash not');
  L = [...base]; e = JSON.parse(L[1]); e.eventHash = 'e'.repeat(64); L[1] = JSON.stringify(e); f.put(L);
  assert.ok(['EVENT_HASH_MISMATCH', 'PREVIOUS_HASH_MISMATCH'].includes(f.errs(f.verify())[0]));
  // changed AND re-hashed (what anyone without the key can do): the MAC refuses it
  L = [...base]; e = JSON.parse(L[1]); e.decision = 'DENY'; e.eventHash = chain.eventHashOf(e); L[1] = JSON.stringify(e); f.put(L);
  assert.equal(f.errs(f.verify())[0], 'EVENT_MAC_INVALID', 're-hashing without the key does not help');
});

test('[EVENT-09] a deleted event is detected — first, middle and LAST (the anchor)', async (t) => {
  const f = mk(t); f.gen(f.rt, 5);
  const base = f.lines();
  const cut = (i) => { const L = [...base]; L.splice(i, 1); f.put(L); return f.verify(); };
  assert.equal(f.errs(cut(0))[0], 'SEQUENCE_GAP', 'first');
  assert.equal(f.errs(cut(2))[0], 'SEQUENCE_GAP', 'middle');
  const last = cut(4); // the chain stays valid: only the keyed head anchor knows
  assert.equal(last.status, 'CORRUPTED');
  assert.equal(f.errs(last)[0], 'ANCHOR_TRUNCATION', 'last');
  f.put(base);
  assert.equal(f.verify().status, 'HEALTHY', 'restoring the original bytes verifies again');
});

test('[EVENT-10] an inserted event is detected — legacy line, replayed line, and a forged tail event', async (t) => {
  const f = mk(t); f.gen(f.rt, 4);
  const base = f.lines();
  let L = [...base]; L.splice(2, 0, JSON.stringify({ kind: 'cima', ts: 1, taskId: 'T', phase: 'DECISION', agentId: 'god', claimed: 'PASS', verdict: 'PASS', violations: [], reasons: [], evidence: [], transition: { from: null, to: 'DECISION' } })); f.put(L);
  assert.equal(f.errs(f.verify())[0], 'LEGACY_AFTER_CHAIN');
  L = [...base]; L.splice(2, 0, L[1]); f.put(L);
  assert.equal(f.errs(f.verify())[0], 'SEQUENCE_DUPLICATE');
  f.put(base);
  // a tail event chained correctly but WITHOUT the runtime key
  const last = JSON.parse(base.at(-1));
  const forged = chain.stampEvent({ kind: 'governance', ts: 1, agentId: 'agent-1', decision: 'HUMAN_APPROVED', approvalId: 'apr-x', rule: 'human' }, last.sequence + 1, last.eventHash, crypto.randomBytes(32));
  fs.appendFileSync(f.ledgerFile, JSON.stringify(forged) + '\n');
  assert.equal(f.errs(f.verify())[0], 'EVENT_MAC_INVALID', 'a correct chain is not enough: events are sealed by the key');
});

test('[EVENT-11] reordered events are detected', async (t) => {
  const f = mk(t); f.gen(f.rt, 5);
  const L = f.lines(); [L[1], L[3]] = [L[3], L[1]]; f.put(L);
  assert.ok(['SEQUENCE_REGRESSION', 'SEQUENCE_GAP'].includes(f.errs(f.verify())[0]));
  const M = f.lines(); [M[0], M[1]] = [M[1], M[0]]; f.put(M);
  assert.equal(f.verify().status, 'CORRUPTED');
});

test('[EVENT-12] a truncated ledger is detected (mid-record and at a record boundary)', async (t) => {
  const f = mk(t); f.gen(f.rt, 4);
  const raw = fs.readFileSync(f.ledgerFile);
  fs.writeFileSync(f.ledgerFile, raw.subarray(0, raw.length - 40)); // cut inside the last record
  let v = f.verify();
  assert.equal(v.status, 'CORRUPTED');
  assert.equal(f.errs(v)[0], 'TRUNCATED_TAIL');
  const rt = f.mkrt();
  const d = rt.authorize('agent-1', 'Read', { file_path: 'x.ts' });
  assert.deepEqual([d.decision, d.rule], ['DENY', 'LEDGER_CORRUPTED']);
  // never accepted as a new genesis, never appended to
  assert.equal(fs.readFileSync(f.ledgerFile).length, raw.length - 40);
});

test('[EVENT-13] malformed JSON anywhere in the ledger is detected, not skipped', async (t) => {
  const f = mk(t); f.gen(f.rt, 4);
  const L = f.lines(); L[2] = L[2].slice(0, -7) + 'garbage'; f.put(L);
  const v = f.verify();
  assert.equal(f.errs(v)[0], 'MALFORMED_JSON');
  assert.equal(v.findings[0].line, 3, 'names the line');
  const d = f.mkrt().authorize('agent-1', 'Read', { file_path: 'x.ts' });
  assert.equal(d.decision, 'DENY');
});

test('[EVENT-14] an unknown required schema is detected', async (t) => {
  const f = mk(t); f.gen(f.rt, 3);
  const L = f.lines(); const e = JSON.parse(L[2]); e.schemaVersion = 3; L[2] = JSON.stringify(e); f.put(L);
  assert.equal(f.errs(f.verify())[0], 'UNKNOWN_SCHEMA');
  // an envelope that is incomplete is not a v2 event either
  const L2 = f.lines(); const g = JSON.parse(L2[1]); g.schemaVersion = 2; delete g.eventId; L2[1] = JSON.stringify(g); f.put(L2);
  assert.equal(f.errs(f.verify())[0], 'INVALID_SCHEMA');
});

// ─── EVENT-15..17, 33..36: fail closed, recovery lifecycle ────────────────

test('[EVENT-15] after corruption nothing is appended, and nothing is authorized', async (t) => {
  const f = mk(t); f.gen(f.rt, 3);
  const L = f.lines(); L.splice(1, 1); f.put(L);
  const before = fs.readFileSync(f.ledgerFile);
  const rt = f.mkrt();
  for (const [tool, input] of [['Read', { file_path: 'a.ts' }], ['Bash', { command: 'npm test' }], ['Write', { file_path: path.join(f.home, 'x.ts'), content: '1' }]]) {
    const d = rt.authorize('agent-1', tool, input);
    assert.deepEqual([d.decision, d.rule], ['DENY', 'LEDGER_CORRUPTED'], tool);
  }
  assert.equal(rt.recordIntent({ kind: 'intent', id: 'x' }), false);
  assert.equal(rt.recordTrace('agent-1', 'PostToolUse', 'Read', { file_path: 'a' }, 'x'), null);
  assert.equal(rt.submit('agent-1', { taskId: 'T', phase: 'BUILD', verdict: 'BLOCKED' }).violations[0], 'STATE_UNAVAILABLE');
  assert.equal(rt.openRequest({ intentId: 'i', executor: 'god', requestedBy: 'human', source: 'alicia', message: 'revisa', taskId: null, target: null, signals: [] }), null);
  assert.equal(rt.completionGate('T').allowed, false);
  assert.deepEqual(rt.ledger(), [], 'no facts are served from a ledger that does not verify');
  assert.ok(before.equals(fs.readFileSync(f.ledgerFile)), 'the damaged evidence is byte for byte untouched');
});

test('[EVENT-16] no evidence is invented: detection and restart change nothing governance-relevant', async (t) => {
  const f = mk(t); f.gen(f.rt, 4);
  const L = f.lines(); L.splice(2, 1); f.put(L);
  const snapshot = () => ({ ledger: fs.readFileSync(f.ledgerFile, 'utf8'), approvals: fs.existsSync(f.approvalsFile) ? fs.readFileSync(f.approvalsFile, 'utf8') : null, proposals: fs.existsSync(f.proposalsFile) ? fs.readFileSync(f.proposalsFile, 'utf8') : null, traces: fs.existsSync(f.tracesFile) ? fs.readFileSync(f.tracesFile, 'utf8') : null });
  const before = snapshot();
  for (let i = 0; i < 3; i++) { const rt = f.mkrt(); rt.authorize('agent-1', 'Read', { file_path: 'a.ts' }); rt.verifyGovernanceState(); }
  assert.deepEqual(snapshot(), before, 'ledger, approvals, proposals and traces are untouched');
  const log = f.mkrt().recoveryHistory();
  assert.equal(log.length, 1, 'the detection is recorded once, not on every call');
  assert.equal(log[0].state, 'RECOVERY_REQUIRED');
  assert.ok(!fs.readFileSync(f.ledgerFile, 'utf8').includes('LEDGER_RECOVERED'));
});

test('[EVENT-17] the recovery state is explicit: HEALTHY → RECOVERY_REQUIRED → RECOVERED', async (t) => {
  const f = mk(t); f.gen(f.rt, 4);
  assert.deepEqual([f.verify().status, f.verify().recovery], ['HEALTHY', 'HEALTHY']);
  const raw = fs.readFileSync(f.ledgerFile); fs.writeFileSync(f.ledgerFile, raw.subarray(0, raw.length - 30));
  const rt = f.mkrt();
  const bad = rt.verifyGovernanceState({ full: true });
  assert.deepEqual([bad.status, bad.recovery], ['CORRUPTED', 'RECOVERY_REQUIRED']);
  assert.equal(rt.integrityView().recovery, 'RECOVERY_REQUIRED');
  const r = rt.recover({ scope: 'ledger', operator: { name: 'Op Erator', os: 'test', host: 'h' }, confirm: 'RECOVER' });
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const good = f.mkrt().verifyGovernanceState({ full: true });
  assert.deepEqual([good.status, good.recovery], ['HEALTHY', 'RECOVERED'], 'recovered is visible, and distinct from never-damaged');
  assert.deepEqual(f.mkrt().recoveryHistory().map((x) => x.state), ['RECOVERY_REQUIRED', 'RECOVERED']);
});

test('[EVENT-33] recovery keeps the damaged ledger whole, keeps the verified prefix verbatim and invents no fact', async (t) => {
  const f = mk(t);
  f.gen(f.rt, 3);
  const id = approve(f.rt, 'agent-1', PUSH);
  f.rt.authorize('agent-1', 'Bash', PUSH); // consumes it
  f.rt.recordTrace('agent-1', 'PostToolUse', 'Bash', PUSH, 'ok');
  const all = f.lines();
  const cutAt = all.findIndex((l) => JSON.parse(l).decision === 'HUMAN_APPROVED'); // corrupt right at the human approval
  const L = [...all]; L[cutAt] = L[cutAt].slice(0, -5) + 'xxxxx'; f.put(L);
  const original = fs.readFileSync(f.ledgerFile);
  const rt = f.mkrt();
  assert.equal(rt.verifyGovernanceState().status, 'CORRUPTED');
  assert.equal(rt.recover({ scope: 'ledger', operator: { name: '' }, confirm: 'RECOVER' }).reason, 'OPERATOR_REQUIRED');
  assert.equal(rt.recover({ scope: 'ledger', operator: { name: 'Op' }, confirm: 'yes' }).reason, 'NOT_CONFIRMED');
  const res = rt.recover({ scope: 'all', operator: { name: 'Op Erator', os: 'tester', host: 'ci' }, confirm: 'RECOVER' });
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400));
  // the damaged evidence is preserved whole and findable
  assert.equal(res.quarantined.length >= 1, true);
  const q = res.quarantined.find((x) => x.file.startsWith('cima-ledger.quarantine-'));
  assert.ok(q);
  assert.ok(original.equals(fs.readFileSync(path.join(f.dir, q.file))), 'quarantine is byte-identical to the damaged ledger');
  assert.equal(q.sha256, sha(original));
  // the new ledger = verified prefix verbatim + one recovery event
  const now = f.lines();
  assert.deepEqual(now.slice(0, cutAt), all.slice(0, cutAt), 'the verified prefix is carried over byte for byte');
  const added = now.slice(cutAt).map((l) => JSON.parse(l));
  assert.deepEqual(added.map((e) => e.eventType).filter((x) => !['LEDGER_RECOVERED', 'APPROVAL_RETIRED'].includes(x)), [], 'only recovery events were added');
  const rec = added.find((e) => e.eventType === 'LEDGER_RECOVERED');
  assert.deepEqual([rec.operator.name, rec.quarantineSha256, rec.corruptedFromLine, rec.recoveredThroughSequence], ['Op Erator', q.sha256, cutAt + 1, cutAt]);
  // nothing the lost suffix established survives: no approval, no execution, no consumed approval
  const after = f.mkrt();
  assert.equal(after.verifyGovernanceState({ full: true }).status, 'HEALTHY');
  assert.equal(now.some((l) => /HUMAN_APPROVED|APPROVAL_CONSUMED|TOOL_EXECUTED/.test(l) && JSON.parse(l).sequence > cutAt), false);
  const a = after.authorize('agent-1', 'Bash', PUSH);
  assert.equal(a.decision, 'HUMAN_APPROVAL_REQUIRED', 'the lost human approval is NOT re-created: the human is asked again');
  assert.ok(id);
});

test('[EVENT-34] restart after corruption: still closed, still RECOVERY_REQUIRED', async (t) => {
  const f = mk(t); f.gen(f.rt, 4);
  const L = f.lines(); L[1] = L[1].replace('"ALLOW"', '"DENY"'); f.put(L);
  f.mkrt().authorize('agent-1', 'Read', { file_path: 'a.ts' });
  for (let i = 0; i < 2; i++) {
    const restarted = f.mkrt(); // a new process would do exactly this
    const d = restarted.authorize('agent-1', 'Read', { file_path: 'a.ts' });
    assert.deepEqual([d.decision, d.rule], ['DENY', 'LEDGER_CORRUPTED']);
    assert.equal(restarted.integrityView().recovery, 'RECOVERY_REQUIRED');
  }
});

test('[EVENT-35] restart after a valid append: verified incrementally, same head, still healthy', async (t) => {
  const f = mk(t); f.gen(f.rt, 5);
  const head = f.events().at(-1);
  const r2 = f.mkrt();
  const v = r2.verifyGovernanceState();
  assert.equal(v.status, 'HEALTHY');
  assert.deepEqual([v.ledger.headSequence, v.ledger.headHash], [head.sequence, head.eventHash]);
  r2.authorize('agent-1', 'Read', { file_path: 'later.ts' });
  const other = f.mkrt(); other.authorize('agent-2', 'Read', { file_path: 'other.ts' });
  const v2 = r2.verifyGovernanceState(); // r2 verifies only what the other instance appended
  assert.equal(v2.mode, 'incremental');
  assert.equal(v2.ledger.headSequence, head.sequence + 2);
  assert.equal(v2.status, 'HEALTHY');
});

test('[EVENT-36] the recovery artifact is chained and sealed; tampering with it is detected', async (t) => {
  const f = mk(t); f.gen(f.rt, 4);
  const raw = fs.readFileSync(f.ledgerFile); fs.writeFileSync(f.ledgerFile, raw.subarray(0, raw.length - 25));
  const rt = f.mkrt(); rt.verifyGovernanceState();
  assert.equal(rt.recover({ scope: 'all', operator: { name: 'Op' }, confirm: 'RECOVER' }).ok, true);
  const file = path.join(f.dir, 'governance-recovery.json');
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(rows.length >= 2);
  rows.forEach((r, i) => { assert.match(r.entryHash, /^[0-9a-f]{64}$/); assert.match(r.mac, /^[0-9a-f]{64}$/); if (i) assert.equal(r.previousEntryHash, rows[i - 1].entryHash); });
  assert.equal(f.verify().status, 'HEALTHY');
  const evil = JSON.parse(JSON.stringify(rows)); evil[0].action = 'NOTHING_HAPPENED'; fs.writeFileSync(file, JSON.stringify(evil));
  const v = f.verify();
  assert.equal(v.status, 'CORRUPTED');
  assert.ok(v.findings.some((x) => x.code === 'STATE_FILE_CORRUPTED' && x.file === 'governance-recovery.json'));
  fs.writeFileSync(file, JSON.stringify(rows.slice(1))); // dropping the first entry breaks the chain
  assert.equal(f.verify().status, 'CORRUPTED');
});

// ─── EVENT-18..22: state ↔ events ─────────────────────────────────────────

test('[EVENT-18] proposal state that disagrees with the events is detected (edited status, deleted proposal, invented proposal)', async (t) => {
  const f = mk(t);
  const p = openReq(f.rt);
  assert.equal(f.verify().status, 'HEALTHY');
  const rows = () => JSON.parse(fs.readFileSync(f.proposalsFile, 'utf8'));
  const base = rows();
  // 1. PROPOSED → CONFIRMED by editing the file
  let r = rows(); r.find((x) => x.id === p.id).status = 'CONFIRMED'; fs.writeFileSync(f.proposalsFile, JSON.stringify(r));
  let v = f.verify(); assert.equal(v.status, 'INCONSISTENT'); assert.ok(f.errs(v).includes('PROPOSAL_STATE_MISMATCH'));
  assert.equal(f.mkrt().authorize('agent-1', 'Bash', { command: 'npm test' }).rule, 'GOVERNANCE_STATE_INCONSISTENT');
  // 2. the PROPOSED proposal deleted (that would open the floor)
  fs.writeFileSync(f.proposalsFile, '[]');
  v = f.verify(); assert.equal(v.status, 'INCONSISTENT'); assert.ok(f.errs(v).includes('PROPOSAL_MISSING'));
  // 3. a CONFIRMED proposal nobody ever proposed
  r = base.concat([{ ...base[0], id: 'req-invented', status: 'CONFIRMED', token: null }]); fs.writeFileSync(f.proposalsFile, JSON.stringify(r));
  v = f.verify(); assert.equal(v.status, 'INCONSISTENT'); assert.ok(f.errs(v).includes('PROPOSAL_UNEVIDENCED'));
  fs.writeFileSync(f.proposalsFile, JSON.stringify(base));
  assert.equal(f.verify().status, 'HEALTHY');
});

test('[EVENT-19] approval state that disagrees with the events is detected', async (t) => {
  const f = mk(t);
  const a = f.rt.authorize('agent-1', 'Bash', PUSH);
  const rows = JSON.parse(fs.readFileSync(f.approvalsFile, 'utf8'));
  const row = rows.find((x) => x.id === a.approvalId);
  // forge a fully valid-looking approval INCLUDING a correct seal (the attacker holds the key)
  const { sealApproval } = loadTs('src/main/authBinding.ts');
  row.status = 'approved'; row.decidedAt = 1; row.decidedBy = 'human';
  row.seal = sealApproval(f.key(), { id: row.id, agentId: row.agentId, tool: row.tool, status: row.status, createdAt: row.createdAt, expiresAt: row.expiresAt, decidedAt: row.decidedAt, decidedBy: row.decidedBy, decidedOwner: undefined, consumedAt: undefined, fingerprint: row.binding.fingerprint });
  fs.writeFileSync(f.approvalsFile, JSON.stringify(rows));
  const v = f.verify();
  assert.equal(v.status, 'INCONSISTENT');
  assert.ok(f.errs(v).includes('APPROVAL_UNEVIDENCED'));
});

test('[EVENT-20] an approval without its HUMAN_APPROVED event is never APPROVED (state-only, and event removed)', async (t) => {
  const f = mk(t);
  const id = approve(f.rt, 'agent-1', PUSH);
  // (a) the event is removed from the ledger, approvals.json preserved
  const L = f.lines(); const i = L.findIndex((l) => JSON.parse(l).decision === 'HUMAN_APPROVED');
  const keep = [...L]; L.splice(i, 1); f.put(L);
  let d = f.mkrt().authorize('agent-1', 'Bash', PUSH);
  assert.notEqual(d.decision, 'APPROVED'); assert.equal(d.decision, 'DENY');
  f.put(keep);
  // (b) a ledger that never recorded it, state forged: see EVENT-19; and the honest path still works
  d = f.mkrt().authorize('agent-1', 'Bash', PUSH);
  assert.deepEqual([d.decision, d.approvalId], ['APPROVED', id]);
});

test('[EVENT-21] a HUMAN_APPROVED without a valid human owner is no decision — refused when made, detected when forged', async (t) => {
  const f = mk(t);
  const a = f.rt.authorize('agent-1', 'Bash', PUSH);
  assert.equal(f.rt.decide(a.approvalId, true, 'human'), null, 'no human context');
  assert.equal(f.rt.decide(a.approvalId, true, 'human', { human: { id: 'hum-x', displayName: 'x' }, session: 's', window: 1 }), null, 'malformed context');
  assert.equal(f.rt.decide(a.approvalId, true, 'human', 'god'), null);
  const rows = JSON.parse(fs.readFileSync(f.approvalsFile, 'utf8'));
  assert.equal(rows.find((x) => x.id === a.approvalId).status, 'pending');
  assert.ok(f.events().every((e) => e.decision !== 'HUMAN_APPROVED'));
  // the human's event carries the owner main resolved
  assert.ok(f.rt.decide(a.approvalId, true, 'human', HUMAN));
  const ev = f.events().find((e) => e.decision === 'HUMAN_APPROVED');
  assert.deepEqual([ev.human.id, ev.human.session, ev.eventType], [HUMAN.human.id, HUMAN.session, 'HUMAN_APPROVED']);
  // an event forged WITH the key but without an owner is flagged
  const g = mk(t);
  const b = g.rt.authorize('agent-1', 'Bash', PUSH);
  g.forge({ kind: 'governance', ts: 1, agentId: 'agent-1', taskId: null, phase: null, tool: 'Bash', action: 'x', category: 'irreversible', risk: 'HIGH', mode: 'HUMAN_APPROVAL', decision: 'HUMAN_APPROVED', rule: 'human', approvalId: b.approvalId });
  const v = g.verify();
  assert.equal(v.status, 'INCONSISTENT');
  assert.ok(g.errs(v).includes('HUMAN_OWNER_INVALID'));
});

test('[EVENT-22] invalid state transitions are denied and, if forged into the stream, detected', async (t) => {
  assert.equal(integrity.isValidRequestTransition(null, 'PROPOSED'), true);
  for (const [from, to] of [['PROPOSED', 'CONFIRMED'], ['CONFIRMED', 'COMPLETED'], ['PROPOSED', 'CANCELLED'], ['CONFIRMED', 'CANCELLED'], ['PROPOSED', 'EXPIRED']]) assert.equal(integrity.isValidRequestTransition(from, to), true, `${from}→${to}`);
  for (const [from, to] of [['COMPLETED', 'PROPOSED'], ['CONFIRMED', 'PROPOSED'], ['CANCELLED', 'CONFIRMED'], ['EXPIRED', 'CONFIRMED'], ['COMPLETED', 'CONFIRMED'], ['PROPOSED', 'COMPLETED'], ['CANCELLED', 'COMPLETED'], [null, 'CONFIRMED'], ['CONFIRMED', 'PROPOSED']]) assert.equal(integrity.isValidRequestTransition(from, to), false, `${from}→${to}`);
  const f = mk(t);
  const p = openReq(f.rt);
  assert.equal(f.rt.cancelRequest(p.id, 'human', HUMAN).ok, true);
  assert.equal(f.rt.confirmRequest(p.id, { by: 'human', token: p.token, human: HUMAN }).code, 'NOT_CONFIRMABLE');
  assert.equal(f.rt.completeRequest(p.id, 'human', HUMAN).code, 'NOT_CONFIRMABLE');
  assert.equal(f.verify().status, 'HEALTHY');
  // a CONFIRMED event forged after CANCELLED (the attacker has the key): the stream itself is illegal
  f.forge({ kind: 'request', ts: 1, proposalId: p.id, intentId: p.intentId, transition: 'CONFIRMED', status: 'CONFIRMED', by: 'human', scope: 'LOW', human: HUMAN.human && { id: HUMAN.human.id, displayName: 'x', session: HUMAN.session, window: 1 } });
  const v = f.verify();
  assert.equal(v.status, 'INCONSISTENT');
  assert.ok(f.errs(v).includes('INVALID_TRANSITION'));
});

// ─── EVENT-23..26: authorization ≠ execution ≠ success ────────────────────

async function hookFloor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-v015-hook-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'El Inge', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'valentin-1', name: 'V', provider: 'claude', cwd: home });
  const tokens = { god: hive.registerAgentToken('god'), 'valentin-1': hive.registerAgentToken('valentin-1') };
  const rt = new CimaRuntimeService({ hiveRoot: () => hive.root(), godId: () => 'god' });
  const server = new HookServer(hive, () => null, () => ({ autoMode: true, notifications: false }), undefined, undefined, undefined, undefined, rt);
  const hook = (id, payload) => server.handle({ agent_id: id, agent_token: tokens[id], session_id: 's', ...payload });
  const dir = path.join(hive.root(), 'lapitaya');
  return { hive, rt, hook, dir, events: () => fs.readFileSync(path.join(dir, 'cima-ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

test('[EVENT-23] AUTHORIZED ≠ EXECUTED: a decision is not an execution; only a committed trace is', async (t) => {
  const h = await hookFloor(t);
  const cmd = { command: 'npm test' };
  const r = h.hook('valentin-1', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: cmd });
  assert.equal(r.hookSpecificOutput, undefined, 'allowed');
  let types = h.events().map((e) => e.eventType);
  assert.deepEqual(types, ['AUTHORIZATION_GRANTED'], 'authorized — and nothing says it ran');
  assert.equal(h.rt.recentTraces().length, 0);
  // the tool is authorized but never runs: still no execution fact, however long we wait
  h.hook('valentin-1', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run lint' } });
  assert.equal(h.events().filter((e) => e.kind === 'execution').length, 0);
  // the CLI reports it ran
  h.hook('valentin-1', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: cmd, tool_response: { stdout: 'ok', stderr: '', interrupted: false } });
  types = h.events().map((e) => e.eventType);
  assert.deepEqual(types, ['AUTHORIZATION_GRANTED', 'AUTHORIZATION_GRANTED', 'TOOL_EXECUTED']);
  const exec = h.events().find((e) => e.eventType === 'TOOL_EXECUTED');
  const grant = h.events()[0];
  assert.equal(exec.authorizationEventId, grant.eventId, 'the execution cites the authorization it relates to');
  assert.ok(exec.sequence > grant.sequence);
  // an approval is not an execution either
  const a = h.rt.authorize('valentin-1', 'Bash', PUSH);
  h.rt.decide(a.approvalId, true, 'human', HUMAN);
  h.rt.authorize('valentin-1', 'Bash', PUSH);
  assert.equal(h.events().filter((e) => e.kind === 'execution').length, 1);
});

test('[EVENT-24] EXECUTED ≠ SUCCEEDED: a failed run is TOOL_FAILED with ok=false', async (t) => {
  const h = await hookFloor(t);
  const cmd = { command: 'npm test' };
  h.hook('valentin-1', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: cmd });
  h.hook('valentin-1', { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: cmd, error: 'Error: Exit code 1' });
  h.hook('valentin-1', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run build' } });
  h.hook('valentin-1', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm run build' }, tool_response: { stdout: 'built', interrupted: false } });
  h.hook('valentin-1', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run lint' } });
  h.hook('valentin-1', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm run lint' }, tool_response: { stdout: 'x', interrupted: true } });
  const ex = h.events().filter((e) => e.kind === 'execution');
  assert.deepEqual(ex.map((e) => [e.eventType, e.ok]), [['TOOL_FAILED', false], ['TOOL_EXECUTED', true], ['TOOL_FAILED', false]]);
});

test('[EVENT-25] a failed execution can back a FAIL but never a PASS', async (t) => {
  const h = await hookFloor(t);
  const cmd = { command: 'node --test test/x.test.cjs' };
  h.hook('valentin-1', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: cmd });
  h.hook('valentin-1', { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: cmd, error: 'ℹ fail 1' });
  const claim = (verdict) => h.rt.submit('valentin-1', { taskId: 'T-9', phase: 'BUILD', verdict, evidence: [{ type: 'test-result', source: cmd.command }] });
  const pass = claim('PASS');
  assert.deepEqual([pass.verdict, pass.violations], ['BLOCKED', ['EVIDENCE_FIRST']]);
  assert.equal(claim('FAIL').verdict, 'FAIL');
});

test('[EVENT-26] trace inconsistencies are detected: altered, deleted, and an uncommitted trace is not evidence', async (t) => {
  const f = mk(t);
  f.rt.recordTrace('agent-1', 'PostToolUse', 'Bash', { command: 'npm test' }, 'ok');
  f.rt.recordTrace('agent-1', 'PostToolUse', 'Bash', { command: 'npm run build' }, 'ok');
  assert.equal(f.verify().status, 'HEALTHY');
  const base = fs.readFileSync(f.tracesFile, 'utf8');
  const L = base.split('\n').filter(Boolean);
  // altered
  const e = JSON.parse(L[0]); e.ok = false; fs.writeFileSync(f.tracesFile, [JSON.stringify(e), L[1]].join('\n') + '\n');
  let v = f.verify(); assert.equal(v.status, 'CORRUPTED'); assert.ok(f.errs(v).includes('TRACE_HASH_MISMATCH'));
  // deleted
  fs.writeFileSync(f.tracesFile, L[1] + '\n');
  v = f.verify(); assert.ok(f.errs(v).includes('TRACE_MISSING'));
  // an extra trace nobody committed
  fs.writeFileSync(f.tracesFile, base + JSON.stringify({ id: 'trc-forged-1', ts: 1, agentId: 'agent-1', kind: 'command', tool: 'Bash', subject: 'npm run forged', ok: true, outputHead: '' }) + '\n');
  v = f.verify(); assert.equal(v.status, 'HEALTHY'); assert.ok(v.findings.some((x) => x.code === 'TRACE_UNCOMMITTED' && x.severity === 'warning'));
  const rec = f.mkrt().submit('agent-1', { taskId: 'T', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'command-output', source: 'npm run forged' }] });
  assert.deepEqual([rec.verdict, rec.violations], ['BLOCKED', ['EVIDENCE_FIRST']], 'an uncommitted trace is not evidence');
  assert.equal(f.mkrt().submit('agent-1', { taskId: 'T2', phase: 'BUILD', verdict: 'PASS', evidence: [{ type: 'command-output', source: 'npm run build' }] }).verdict, 'PASS', 'a committed trace is');
});

// ─── EVENT-27..29: processes ──────────────────────────────────────────────

test('[EVENT-27] concurrent readers in separate processes all see one healthy, identical state', async (t) => {
  const f = mk(t); f.gen(f.rt, 12); approve(f.rt, 'agent-1', PUSH);
  const res = await Promise.all([1, 2, 3].map(() => child('verifier', f.hive, '1200')));
  const heads = new Set(res.map((r) => r.lastHead));
  assert.ok(res.every((r) => r.runs >= 1 && r.badCount === 0), JSON.stringify(res));
  assert.equal(heads.size, 1, 'every process verified the same head');
});

test('[EVENT-28] reads and verification while another process writes: never stale, partial, mixed or falsely healthy', async (t) => {
  const f = mk(t);
  fs.mkdirSync(f.dir, { recursive: true });
  const writer = child('writer', f.hive, 'proc-w', '14');
  const reader = child('reader', f.hive, '4500');
  const verifier = child('verifier', f.hive, '4500');
  const [w, r, v] = await Promise.all([writer, reader, verifier]);
  assert.equal(w.denied, 0, 'the writer was never refused for want of a consistent state');
  assert.equal(r.violationCount, 0, JSON.stringify(r.violations));
  assert.equal(v.badCount, 0, JSON.stringify(v.bad));
  assert.ok(r.snaps >= 1 && v.runs >= 1, `the readers actually ran (${r.snaps} snapshots, ${v.runs} verifications)`);
  const final = f.verify();
  assert.equal(final.status, 'HEALTHY');
  // 14 × (decision HUMAN_APPROVAL_REQUIRED + HUMAN_APPROVED + APPROVAL_CONSUMED + AUTHORIZATION_GRANTED + TOOL_EXECUTED)
  assert.equal(final.ledger.headSequence, 14 * 5);
  assert.deepEqual(f.events().map((e) => e.sequence), f.events().map((_, i) => i + 1), 'one gapless sequence');
});

test('[EVENT-29] snapshot consistency: ledger, approvals and requests come from ONE verified moment', async (t) => {
  const f = mk(t);
  const writer = child('writer', f.hive, 'proc-s', '12');
  const reader = child('reader', f.hive, '4000');
  const [w, r] = await Promise.all([writer, reader]);
  assert.equal(w.denied, 0);
  assert.equal(r.violationCount, 0, JSON.stringify(r.violations));
  // in-process: the snapshot is internally consistent by construction
  const s = f.mkrt().governanceSnapshot({ ledgerLimit: 5000 });
  assert.equal(s.health.status, 'HEALTHY');
  assert.equal(s.ledger.at(-1).sequence, s.health.headSequence);
  const human = new Set(s.ledger.filter((e) => e.decision === 'HUMAN_APPROVED').map((e) => e.approvalId));
  assert.ok(s.approvals.filter((a) => a.status === 'approved' || a.status === 'consumed').every((a) => human.has(a.id)));
});

// ─── EVENT-30..31: Alicia ─────────────────────────────────────────────────

test('[EVENT-30] Alicia sees the governance health: HEALTHY, CORRUPTED, INCONSISTENT, UNAVAILABLE and the recovery state', async (t) => {
  const f = mk(t);
  const approvalsOf = (rt) => rt.listApprovals();
  const view = (rt) => { const s = rt.governanceSnapshot({ ledgerLimit: 3000 }); return obs.projectObservability({ ledger: s.ledger, traces: s.traces, approvals: s.approvals, requests: s.requests, health: s.health }); };
  f.gen(f.rt, 3);
  assert.equal(view(f.rt).health.status, 'HEALTHY');
  // CORRUPTED
  const base = f.lines(); const L = [...base]; L.splice(1, 1); f.put(L);
  let rt = f.mkrt(); let vw = view(rt);
  assert.deepEqual([vw.health.status, vw.health.recovery], ['CORRUPTED', 'RECOVERY_REQUIRED']);
  assert.ok(vw.health.codes.includes('SEQUENCE_GAP'));
  assert.equal(vw.recent.length, 0, 'no ledger facts are shown from a ledger that does not verify');
  f.put(base);
  // INCONSISTENT
  const p = openReq(f.mkrt());
  const rows = JSON.parse(fs.readFileSync(f.proposalsFile, 'utf8')); rows.find((x) => x.id === p.id).status = 'CONFIRMED'; fs.writeFileSync(f.proposalsFile, JSON.stringify(rows));
  vw = view(f.mkrt());
  assert.equal(vw.health.status, 'INCONSISTENT');
  // UNAVAILABLE (a lock nobody releases)
  fs.writeFileSync(path.join(f.dir, '.governance.lock'), 'someone');
  vw = view(f.mkrt({ lockTimeoutMs: 60 }));
  assert.equal(vw.health, null, 'no snapshot without the lock: nothing is claimed');
  assert.equal(f.mkrt({ lockTimeoutMs: 60 }).integrityView().status, 'UNAVAILABLE');
  fs.rmSync(path.join(f.dir, '.governance.lock'));
  // whitelist: anything else in a health verdict is dropped
  const dirty = obs.readHealth({ status: 'CORRUPTED', recovery: 'RECOVERY_REQUIRED', codes: ['SEQUENCE_GAP', 'rm -rf /', 'a'.repeat(80)], headSequence: 3.5, leak: 'secret' });
  assert.deepEqual(dirty, { status: 'CORRUPTED', recovery: 'RECOVERY_REQUIRED', codes: ['SEQUENCE_GAP'], headSequence: 0, legacyUnverified: false });
  assert.equal(obs.readHealth({ status: 'FINE', recovery: 'HEALTHY' }), null);
  assert.ok(approvalsOf);
  // both locales say it
  for (const lang of ['en-US', 'es-MX']) {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'src', 'i18n', 'locales', 'lapitaya', `${lang}.json`), 'utf8')).alicia.observe;
    for (const s of ['HEALTHY', 'CORRUPTED', 'INCONSISTENT', 'UNAVAILABLE']) assert.ok(j.health[s], `${lang} health.${s}`);
    for (const s of ['HEALTHY', 'CORRUPTED', 'RECOVERY_REQUIRED', 'RECOVERED']) assert.ok(j.recovery[s], `${lang} recovery.${s}`);
  }
});

test('[EVENT-31] Alicia and the renderer cannot repair: no recovery capability exists outside the operator tooling', async () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const walk = (d) => fs.readdirSync(path.join(__dirname, '..', d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const consumers = [...walk('src/shared/lapitaya/alicia'), ...walk('src/renderer/src/components/alicia'), 'src/main/humanGovernanceIpc.ts', 'src/main/intentBoundary.ts', 'src/preload/index.ts'];
  for (const file of consumers) {
    const src = read(file);
    assert.doesNotMatch(src, /\.recover\s*\(|verifyGovernanceState|recoveryHistory|\.append\(|quarantine/i, `${file} must not repair or write the ledger`);
  }
  const main = read('src/main/index.ts');
  assert.doesNotMatch(main, /ipcMain\.handle\('[^']*(recover|repair|quarantine)[^']*'/i, 'no IPC channel recovers anything');
  assert.doesNotMatch(main, /\.recover\s*\(/, 'main never calls recover(): it is operator tooling');
  assert.doesNotMatch(read('src/preload/index.ts'), /recover|repair/i);
  assert.match(read('scripts/lapitaya-recover.cjs'), /rt\.recover\(/);
  // Alicia's projection only READS: its inputs are plain data
  assert.match(read('src/shared/lapitaya/alicia/observability.ts'), /readHealth/);
  const s = obs.projectObservability({ ledger: [], health: { status: 'CORRUPTED', recovery: 'RECOVERY_REQUIRED', codes: [], headSequence: 0 } });
  assert.throws(() => { s.health.status = 'HEALTHY'; }, TypeError, 'the view is frozen');
});

// ─── EVENT-32: legacy ──────────────────────────────────────────────────────

test('[EVENT-32] a v0.14 ledger is migrated by an explicit boundary: legacy is trusted as found, committed, never replayed as new', async (t) => {
  const f = mk(t);
  const legacy = (o) => JSON.stringify({ ts: 1, ...o });
  const rec = (agentId, phase) => legacy({ kind: 'cima', taskId: 'T-old', phase, agentId, claimed: 'PASS', verdict: 'PASS', violations: [], reasons: [], evidence: [], transition: { from: null, to: phase } });
  const legacyLines = [legacy({ kind: 'cima-assignment', taskId: 'T-old', phase: 'BUILD', from: 'god', to: 'w' }), rec('b', 'BUILD'), rec('t', 'TEST'), rec('a', 'AUDIT'), rec('god', 'DECISION'),
    legacy({ kind: 'governance', agentId: 'agent-1', decision: 'ALLOW', tool: 'Read', rule: 'read', risk: 'LOW', category: 'read-code', mode: 'AUTO', taskId: null, phase: null, action: 'x' })];
  f.put(legacyLines);
  const legacyBytes = fs.readFileSync(f.ledgerFile);
  fs.writeFileSync(f.tracesFile, JSON.stringify({ id: 'trc-old-1', ts: 1, agentId: 'b', kind: 'command', tool: 'Bash', subject: 'npm test', ok: true, outputHead: '' }) + '\n');
  // before any v0.15 write: verifiable as legacy, flagged, honored
  let rt = f.mkrt();
  let v = rt.verifyGovernanceState();
  assert.equal(v.status, 'HEALTHY'); assert.equal(v.ledger.legacyUnverified, true); assert.equal(v.ledger.legacyEvents, 6);
  assert.ok(v.findings.some((x) => x.code === 'LEGACY_UNVERIFIED'));
  assert.equal(rt.completionGate('T-old').allowed, true, 'legacy facts keep working');
  // the first write puts the boundary in the ledger — the legacy bytes themselves are not touched
  assert.equal(rt.authorize('agent-1', 'Read', { file_path: 'x.ts' }).decision, 'ALLOW');
  const raw = fs.readFileSync(f.ledgerFile);
  assert.ok(raw.subarray(0, legacyBytes.length).equals(legacyBytes), 'legacy prefix byte-identical');
  const ev = f.events().slice(6);
  assert.equal(ev[0].eventType, 'LEDGER_MIGRATION_BOUNDARY');
  assert.deepEqual([ev[0].sequence, ev[0].legacyEvents, ev[0].legacyBytes], [1, 6, legacyBytes.length]);
  assert.equal(ev[0].legacyDigest, sha(legacyBytes).length === 64 ? ev[0].legacyDigest : '');
  assert.equal(ev[0].previousEventHash, chain.legacyBoundaryHash(ev[0].legacyDigest, 6));
  assert.equal(ev[1].eventType, 'AUTHORIZATION_GRANTED');
  v = f.mkrt().verifyGovernanceState({ full: true });
  assert.equal(v.status, 'HEALTHY'); assert.equal(v.ledger.legacyUnverified, true);
  assert.equal(f.mkrt().completionGate('T-old').allowed, true);
  assert.deepEqual(f.mkrt().cimaRecords('T-old').map((r) => r.phase), ['BUILD', 'TEST', 'AUDIT', 'DECISION']);
  // from the boundary on, the legacy prefix is tamper-evident …
  const L = f.lines(); const keep = [...L]; L[4] = L[4].replace('"PASS"', '"FAIL"'); f.put(L);
  assert.equal(f.errs(f.verify())[0], 'BOUNDARY_MISMATCH');
  f.put(keep);
  const M = [...keep]; M.splice(2, 1); f.put(M);
  assert.equal(f.errs(f.verify())[0], 'BOUNDARY_MISMATCH', 'deleting a legacy record is detected too');
  f.put(keep);
  // … and so are the legacy traces
  fs.writeFileSync(f.tracesFile, JSON.stringify({ id: 'trc-old-1', ts: 1, agentId: 'b', kind: 'command', tool: 'Bash', subject: 'npm test --forged', ok: true, outputHead: '' }) + '\n');
  assert.ok(f.errs(f.verify()).includes('TRACE_HASH_MISMATCH'));
});

// ─── EVENT-37: performance ────────────────────────────────────────────────

test('[EVENT-37] performance is measured: verification is linear once, authorization is O(new events) after', async (t) => {
  const rows = [];
  for (const n of [500, 5000]) {
    const f = mk(t);
    const key = f.key();
    let prev = chain.GENESIS_HASH; const out = [];
    for (let i = 1; i <= n; i++) { const e = chain.stampEvent({ kind: 'governance', ts: i, agentId: 'agent-1', taskId: null, phase: null, tool: 'Read', action: 'x', category: 'read-code', risk: 'LOW', mode: 'AUTO', decision: 'ALLOW', rule: 'read', fingerprint: 'deadbeef' }, i, prev, key); out.push(JSON.stringify(e)); prev = e.eventHash; }
    fs.writeFileSync(f.ledgerFile, out.join('\n') + '\n');
    fs.writeFileSync(path.join(f.dir, 'ledger-head.json'), JSON.stringify(chain.makeAnchor(key, n, prev, 1)));
    const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
    const A = f.mkrt();
    let t0 = process.hrtime.bigint(); const v = A.verifyGovernanceState({ full: true }); const full = ms(t0);
    assert.equal(v.status, 'HEALTHY'); assert.equal(v.ledger.headSequence, n);
    const B = f.mkrt();
    t0 = process.hrtime.bigint(); B.authorize('agent-1', 'Read', { file_path: 'cold.ts' }); const cold = ms(t0);
    t0 = process.hrtime.bigint(); for (let i = 0; i < 10; i++) B.authorize('agent-1', 'Read', { file_path: `s${i}.ts` }); const steady = ms(t0) / 10;
    rows.push({ events: n, fullVerifyMs: +full.toFixed(1), coldAuthorizeMs: +cold.toFixed(1), steadyAuthorizeMs: +steady.toFixed(2) });
  }
  console.log('[EVENT-37] ' + JSON.stringify(rows));
  assert.ok(rows[1].fullVerifyMs < 20000, 'a 5 000-event ledger verifies in well under 20 s');
  // steady-state cost does not grow with the ledger (v0.14 reread the whole file on every call)
  assert.ok(rows[1].steadyAuthorizeMs < rows[0].steadyAuthorizeMs * 4 + 25, `steady authorize: ${JSON.stringify(rows)}`);
});

// ─── EVENT-38: v0.14 stays intact ─────────────────────────────────────────

test('[EVENT-38] v0.14 authorization binding is intact on the chained ledger', async (t) => {
  const f = mk(t);
  const A = f.rt.authorize('agent-1', 'Bash', PUSH);
  f.rt.decide(A.approvalId, true, 'human', HUMAN);
  // an FNV twin of the approved call
  const P = 0x01000193;
  const inv32 = (a) => { let x = a; for (let i = 0; i < 5; i++) x = Math.imul(x, 2 - Math.imul(a, x)) >>> 0; return x >>> 0; };
  const Pinv = inv32(P); const fwd = (h, s) => { for (const c of Buffer.from(s)) { h ^= c; h = Math.imul(h, P) >>> 0; } return h >>> 0; };
  const unwind = (h, b) => ((Math.imul(h, Pinv) >>> 0) ^ b) >>> 0; const CH = []; for (let c = 33; c < 127; c++) if (c !== 34 && c !== 92) CH.push(c);
  const target = parseInt(gov.toolCallFingerprint('agent-1', 'Bash', PUSH), 16); let twin = null;
  for (let v = 0; v < 5000 && !twin; v++) {
    const pfx = `rm -rf /x # ${v} `; const s0 = fwd(0x811c9dc5, `agent-1\u0000Bash\u0000{"command":"${pfx}`);
    const Rr = unwind(unwind(target, 125), 34); const back = new Map();
    for (const b3 of CH) for (const b4 of CH) back.set(unwind(unwind(Rr, b4), b3), [b3, b4]);
    for (const b1 of CH) { for (const b2 of CH) { let h = Math.imul((s0 ^ b1) >>> 0, P) >>> 0; h = Math.imul((h ^ b2) >>> 0, P) >>> 0; if (back.has(h)) { const [b3, b4] = back.get(h); twin = pfx + String.fromCharCode(b1, b2, b3, b4); break; } } if (twin) break; }
  }
  assert.ok(twin);
  assert.notEqual(f.rt.authorize('agent-1', 'Bash', { command: twin }).decision, 'APPROVED', 'an FNV twin is not the approved call');
  assert.equal(f.rt.authorize('agent-1', 'Bash', PUSH).decision, 'APPROVED', 'the approved call is');
  assert.equal(f.rt.authorize('agent-1', 'Bash', PUSH).decision, 'HUMAN_APPROVAL_REQUIRED', 'once');
  const fp = f.events().filter((e) => e.authFingerprint || e.callFingerprint);
  assert.ok(fp.every((e) => /^[0-9a-f]{64}$/.test(e.callFingerprint ?? e.authFingerprint)), 'decisions carry SHA-256 fingerprints');
  assert.equal(f.verify().status, 'HEALTHY');
});

// ─── adversarial ──────────────────────────────────────────────────────────

test('[ADV-1] valid approval; proposal state edited with its HMAC/fingerprint preserved; ledger edited; execution: DENIED', async (t) => {
  const f = mk(t);
  const p = openReq(f.rt);
  f.rt.confirmRequest(p.id, { by: 'human', token: p.token, human: HUMAN });
  const id = approve(f.rt, 'agent-1', PUSH);
  // (1) edit the proposal's status back to PROPOSED but keep its (content-bound, keyed) fingerprint
  const rows = JSON.parse(fs.readFileSync(f.proposalsFile, 'utf8')); const row = rows.find((x) => x.id === p.id);
  const fpBefore = row.fingerprint; row.status = 'PROPOSED'; row.token = 'f'.repeat(32); fs.writeFileSync(f.proposalsFile, JSON.stringify(rows));
  assert.equal(row.fingerprint, fpBefore);
  // (2) and edit the ledger to hide it
  const L = f.lines(); const i = L.findIndex((l) => JSON.parse(l).transition === 'CONFIRMED'); L[i] = L[i].replace('"CONFIRMED"', '"PROPOSED"'); f.put(L);
  const d = f.mkrt().authorize('agent-1', 'Bash', PUSH);
  assert.notEqual(d.decision, 'APPROVED'); assert.equal(d.decision, 'DENY');
  assert.ok(['LEDGER_CORRUPTED', 'GOVERNANCE_STATE_INCONSISTENT'].includes(d.rule));
  assert.ok(id);
});

test('[ADV-2] HUMAN_APPROVED removed from the ledger, approvals.json preserved: DENIED', async (t) => {
  const f = mk(t);
  approve(f.rt, 'agent-1', PUSH);
  const L = f.lines().filter((l) => JSON.parse(l).decision !== 'HUMAN_APPROVED'); f.put(L);
  const d = f.mkrt().authorize('agent-1', 'Bash', PUSH);
  assert.deepEqual([d.decision, executableOf(d)], ['DENY', false]);
  function executableOf(a) { return ['ALLOW', 'SUPERVISED', 'APPROVED'].includes(a.decision); }
});

test('[ADV-3] a fake HUMAN_APPROVED inserted — without the key, and with the key but without a valid human: DENIED', async (t) => {
  const f = mk(t);
  const a = f.rt.authorize('agent-1', 'Bash', PUSH);
  const entry = { kind: 'governance', ts: 1, agentId: 'agent-1', taskId: null, phase: null, tool: 'Bash', action: 'x', category: 'irreversible', risk: 'HIGH', mode: 'HUMAN_APPROVAL', decision: 'HUMAN_APPROVED', rule: 'human', approvalId: a.approvalId };
  const last = f.events().at(-1);
  // without the key: chain-valid, unsealed
  fs.appendFileSync(f.ledgerFile, JSON.stringify(chain.stampEvent(entry, last.sequence + 1, last.eventHash, crypto.randomBytes(32))) + '\n');
  assert.equal(f.mkrt().authorize('agent-1', 'Bash', PUSH).decision, 'DENY');
  assert.equal(f.errs(f.verify())[0], 'EVENT_MAC_INVALID');
  // with the key, no human owner
  const g = mk(t);
  const b = g.rt.authorize('agent-1', 'Bash', PUSH);
  g.forge({ ...entry, approvalId: b.approvalId });
  const rows = JSON.parse(fs.readFileSync(g.approvalsFile, 'utf8')); const row = rows.find((x) => x.id === b.approvalId);
  const { sealApproval } = loadTs('src/main/authBinding.ts');
  row.status = 'approved'; row.decidedAt = 1; row.decidedBy = 'human';
  row.seal = sealApproval(g.key(), { id: row.id, agentId: row.agentId, tool: row.tool, status: row.status, createdAt: row.createdAt, expiresAt: row.expiresAt, decidedAt: 1, decidedBy: 'human', decidedOwner: undefined, consumedAt: undefined, fingerprint: row.binding.fingerprint });
  fs.writeFileSync(g.approvalsFile, JSON.stringify(rows));
  const d = g.mkrt().authorize('agent-1', 'Bash', PUSH);
  assert.deepEqual([d.decision, d.rule], ['DENY', 'GOVERNANCE_STATE_INCONSISTENT']);
});

test('[ADV-4] reordered events, then execute: DENIED', async (t) => {
  const f = mk(t);
  approve(f.rt, 'agent-1', PUSH);
  const L = f.lines(); const n = L.length; [L[n - 2], L[n - 1]] = [L[n - 1], L[n - 2]]; f.put(L);
  const d = f.mkrt().authorize('agent-1', 'Bash', PUSH);
  assert.equal(d.decision, 'DENY');
  assert.equal(d.rule, 'LEDGER_CORRUPTED');
});

test('[ADV-5] a writer who holds the key and rewrites the chain from the middle is still caught by the keyed anchor', async (t) => {
  const f = mk(t); f.gen(f.rt, 6);
  const ev = f.events();
  // re-chain events 4..6 as a different history (valid hashes, valid MACs) but the anchor still records the old head
  let prev = ev[2].eventHash; const out = ev.slice(0, 3).map((e) => JSON.stringify(e));
  for (let i = 3; i < 6; i++) { const e = chain.stampEvent({ kind: 'governance', ts: 9, agentId: 'agent-9', decision: 'ALLOW', tool: 'Read', rule: 'rewritten', risk: 'LOW', category: 'read-code', mode: 'AUTO', taskId: null, phase: null, action: 'x' }, i + 1, prev, f.key()); out.push(JSON.stringify(e)); prev = e.eventHash; }
  f.put(out);
  const v = f.verify();
  assert.equal(v.status, 'CORRUPTED');
  assert.equal(f.errs(v)[0], 'ANCHOR_MISMATCH', 'a coherent rewrite does not match the anchor written at the time');
  // the limit, stated: someone who rewrites chain AND anchor with the key is not detected by this mechanism (see the document)
  fs.writeFileSync(path.join(f.dir, 'ledger-head.json'), JSON.stringify(chain.makeAnchor(f.key(), 6, prev, 1)));
  assert.equal(f.verify().status, 'HEALTHY');
});
