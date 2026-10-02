/**
 * La Pitaya CIMA v0.15 — the governance event store (main process).
 *
 * Owns everything that is DERIVED FROM THE LEDGER and the traces file, and the rules for appending to them:
 *
 *   cima-ledger.jsonl   AUTHORITATIVE governance facts, as a hash-chained event stream (see ledgerChain.ts)
 *   ledger-head.json    keyed anchor of the chain head (detects tail deletion; HMAC under the seal key)
 *   traces.jsonl        execution EVIDENCE content; each trace is COMMITTED to the chain by a TOOL_EXECUTED / TOOL_FAILED
 *                       event carrying its hash — a trace that no event commits is not evidence
 *   proposals.json / approvals.json   working STATE (they hold secrets and bindings); they are checked against the
 *                       events and may never claim more authority than the events justify (`reconcile`)
 *
 * Every verification is INCREMENTAL where it can be: a process verifies the whole chain once, then only what was
 * appended since (and re-checks the last verified record). Everything runs under the governance lock, so a verification
 * is one consistent snapshot of ledger + anchor + traces + state.
 *
 * No electron import — unit-testable.
 */

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOUNDARY_EVENT_TYPE, GENESIS_HASH, LedgerChain, anchorValid, makeAnchor, stampEvent, traceHashOf, tracesLegacyDigest, eventHashOf
} from './ledgerChain';
import { readOwner } from '../shared/lapitaya/identity';
import {
  GOVERNANCE_HEALTH, LEDGER_SCHEMA_VERSION, REQUEST_TERMINAL, isValidRequestTransition,
  type GovernanceHealth, type GovernanceVerification, type IntegrityCode, type IntegrityFinding, type RecoveryState
} from '../shared/lapitaya/governanceIntegrity';

export type JsonRecord = Record<string, unknown>;
const MAX_RECENT_EVENTS = 5000;
const MAX_TRACES_IN_MEMORY = 5000;

export interface StateSnapshot {
  proposals: Array<{ id: string; status: string; intentId?: string; scope?: string }>;
  approvals: Array<{ id: string; status: string; agentId?: string }>;
}

export interface GovernanceStoreDeps {
  dir: () => string | null;
  key: () => Buffer | null;
  now: () => number;
  /** Is the governance lock held by this process right now? Writes and re-anchoring need it. */
  locked: () => boolean;
  /** Atomic JSON write into the governance directory (tmp + fsync + rename). */
  writeJson: (file: string, value: unknown) => boolean;
  /** The proposals/approvals as the runtime holds them (for the migration boundary's baseline). */
  snapshot: () => StateSnapshot;
}

const ERROR_CORRUPT: ReadonlySet<IntegrityCode> = new Set<IntegrityCode>([
  'MALFORMED_JSON', 'TRUNCATED_TAIL', 'INVALID_SCHEMA', 'UNKNOWN_SCHEMA', 'LEGACY_AFTER_CHAIN', 'DUPLICATE_EVENT_ID',
  'SEQUENCE_GAP', 'SEQUENCE_REGRESSION', 'SEQUENCE_DUPLICATE', 'PREVIOUS_HASH_MISMATCH', 'EVENT_HASH_MISMATCH', 'EVENT_MAC_INVALID', 'BOUNDARY_MISMATCH',
  'ANCHOR_MISSING', 'ANCHOR_INVALID', 'ANCHOR_MISMATCH', 'ANCHOR_TRUNCATION', 'STATE_FILE_CORRUPTED', 'LEDGER_UNREADABLE',
  'TRACE_MISSING', 'TRACE_HASH_MISMATCH', 'TRACE_MALFORMED'
]);
const ERROR_INCONSISTENT: ReadonlySet<IntegrityCode> = new Set<IntegrityCode>([
  'INVALID_TRANSITION', 'PROPOSAL_STATE_MISMATCH', 'PROPOSAL_MISSING', 'PROPOSAL_UNEVIDENCED', 'APPROVAL_STATE_MISMATCH',
  'APPROVAL_UNEVIDENCED', 'HUMAN_OWNER_INVALID', 'AUTHORIZATION_LINK_INVALID'
]);

export function classify(findings: readonly IntegrityFinding[]): GovernanceHealth {
  const errs = findings.filter((f) => f.severity === 'error');
  if (errs.some((f) => ERROR_CORRUPT.has(f.code))) return 'CORRUPTED';
  if (errs.some((f) => ERROR_INCONSISTENT.has(f.code))) return 'INCONSISTENT';
  if (errs.length) return 'UNAVAILABLE';
  return 'HEALTHY';
}

export const _GOVERNANCE_HEALTH = GOVERNANCE_HEALTH;

interface ProposalEvent { status: string; seq: number; intentId?: string; scope?: string }
interface ApprovalEvent { approvedSeq?: number; approvedAgent?: string; rejectedSeq?: number; consumedSeq?: number; retired?: boolean }

export class GovernanceEventStore {
  chain = new LedgerChain();
  private cache: { dir: string; ino: number; size: number; mtimeMs: number } | null = null;

  // derived from the ledger
  records: JsonRecord[] = [];
  assignments: JsonRecord[] = [];
  actionFingerprints = new Set<string>();
  recentEvents: JsonRecord[] = [];
  proposalEvents = new Map<string, ProposalEvent>();
  approvalEvents = new Map<string, ApprovalEvent>();
  private baselineProposals = new Map<string, string>();
  private baselineApprovals = new Map<string, string>();
  private executableDecisions = new Map<string, { seq: number; agentId: string; callFingerprint: string }>();
  decisionByCall = new Map<string, string>();
  private committedTraces = new Map<string, { hash: string; seq: number }>();
  private boundary: { tracesBytes: number; tracesDigest: string } | null = null;
  private applyFindings: IntegrityFinding[] = [];

  // traces
  traces: JsonRecord[] = [];
  private seenTraces = new Map<string, string>();
  private tracesCache: { dir: string; ino: number; size: number; offset: number } | null = null;
  private uncommitted = new Set<string>();
  private unseenCommitted = new Set<string>();
  private legacyTracesVerified = false;

  lastMode: 'incremental' | 'full' = 'full';
  /** Last verification of this process (set by `verify`). */
  last: GovernanceVerification | null = null;

  constructor(private readonly deps: GovernanceStoreDeps) {}

  reset(): void {
    this.chain = new LedgerChain();
    this.cache = null;
    this.records = []; this.assignments = []; this.actionFingerprints = new Set(); this.recentEvents = [];
    this.proposalEvents = new Map(); this.approvalEvents = new Map();
    this.baselineProposals = new Map(); this.baselineApprovals = new Map();
    this.executableDecisions = new Map(); this.decisionByCall = new Map();
    this.committedTraces = new Map(); this.boundary = null; this.applyFindings = [];
    this.traces = []; this.seenTraces = new Map(); this.tracesCache = null; this.uncommitted = new Set(); this.unseenCommitted = new Set();
    this.legacyTracesVerified = false;
  }

  // ─── ledger ────────────────────────────────────────────────────────────

  private ledgerPath(dir: string): string { return join(dir, 'cima-ledger.jsonl'); }

  /** Re-read the last verified record and check it still hashes to the head we hold (cheap tampering check). */
  private tailIntact(path: string): boolean {
    const c = this.chain;
    if (c.sequence === 0 || c.offset <= c.lastLineStart) return true;
    try {
      const fd = openSync(path, 'r');
      try {
        const len = c.offset - c.lastLineStart;
        const b = Buffer.alloc(len);
        readSync(fd, b, 0, len, c.lastLineStart);
        const rec = JSON.parse(b.toString('utf8').trim()) as JsonRecord;
        return rec.eventHash === c.hash && eventHashOf(rec) === c.hash;
      } finally { closeSync(fd); }
    } catch { return false; }
  }

  private readRange(path: string, from: number, to: number): Buffer {
    const len = to - from;
    if (len <= 0) return Buffer.alloc(0);
    const fd = openSync(path, 'r');
    try {
      const b = Buffer.alloc(len);
      let got = 0;
      while (got < len) { const n = readSync(fd, b, got, len - got, from + got); if (n <= 0) break; got += n; }
      return got === len ? b : b.subarray(0, got);
    } finally { closeSync(fd); }
  }

  /** Bring the verified chain (and everything derived from it) up to date with the file. */
  private refreshLedger(dir: string, findings: IntegrityFinding[]): 'incremental' | 'full' {
    const path = this.ledgerPath(dir);
    const key = this.deps.key();
    if (!key) {
      findings.push({ code: 'KEY_UNAVAILABLE', severity: 'error', file: 'cima-ledger.jsonl', detail: 'no seal key: the ledger events cannot be verified' });
      return 'full';
    }
    this.chain.key = key;
    let st: ReturnType<typeof statSync> | null = null;
    try { st = existsSync(path) ? statSync(path) : null; } catch (e) {
      findings.push({ code: 'LEDGER_UNREADABLE', severity: 'error', file: 'cima-ledger.jsonl', detail: String(e).slice(0, 120) });
      return 'full';
    }
    const c = this.cache;
    const same = !!(c && st && c.dir === dir && c.ino === st.ino);
    let mode: 'incremental' | 'full' = 'full';
    if (same && c && st) {
      const unchanged = st.size === c.size && st.mtimeMs === c.mtimeMs;
      if (this.chain.error && unchanged) mode = 'incremental'; // a known defect on an unchanged file: reuse the verdict
      else if (!this.chain.error && st.size >= this.chain.offset && !(st.size === c.size && st.mtimeMs !== c.mtimeMs) && this.tailIntact(path)) mode = 'incremental';
    }
    if (mode === 'full') {
      this.reset();
      this.chain.key = key;
      if (st) {
        let buf: Buffer;
        try { buf = readFileSync(path); } catch (e) {
          findings.push({ code: 'LEDGER_UNREADABLE', severity: 'error', file: 'cima-ledger.jsonl', detail: String(e).slice(0, 120) });
          return 'full';
        }
        this.consume(buf);
      }
    } else if (st && !this.chain.error && st.size > this.chain.offset) {
      let buf: Buffer;
      try { buf = this.readRange(path, this.chain.offset, st.size); } catch (e) {
        findings.push({ code: 'LEDGER_UNREADABLE', severity: 'error', file: 'cima-ledger.jsonl', detail: String(e).slice(0, 120) });
        return 'full';
      }
      this.consume(buf);
    }
    if (st) this.cache = { dir, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs };
    else this.cache = null;
    if (this.chain.error) findings.push(this.chain.error);
    return mode;
  }

  private consume(buf: Buffer): void {
    this.chain.consume(buf, {
      legacy: (rec) => this.apply(rec, null),
      event: (rec) => this.apply(rec, rec.sequence as number)
    });
  }

  /** One ledger record → the in-memory view of what the ledger says. `seq === null` = legacy (trusted as found). */
  private apply(rec: JsonRecord, seq: number | null): void {
    const finding = (code: IntegrityCode, detail: string): void => {
      this.applyFindings.push({ code, severity: 'error', file: 'cima-ledger.jsonl', detail, ...(seq !== null ? { sequence: seq } : {}) });
    };
    this.recentEvents.push(rec);
    if (this.recentEvents.length > MAX_RECENT_EVENTS) this.recentEvents.splice(0, this.recentEvents.length - MAX_RECENT_EVENTS);
    const kind = rec.kind;
    if (kind === 'cima') this.records.push(rec);
    else if (kind === 'cima-assignment') this.assignments.push(rec);
    else if (kind === 'intent') {
      const t = rec.target as { tool?: unknown } | null;
      if (rec.type === 'ACTION' && rec.status === 'GOVERNED' && typeof rec.callFingerprint === 'string' && t?.tool) this.actionFingerprints.add(rec.callFingerprint);
    } else if (kind === 'request') {
      const id = rec.proposalId;
      if (typeof id !== 'string') return;
      const tr = String(rec.transition ?? '');
      const to = String(rec.status ?? '');
      const cur = this.proposalEvents.get(id);
      if (seq === null) { // legacy: trusted as found, applied leniently
        if (tr !== 'REVALIDATED' && tr !== 'CONFIRMATION_DENIED') this.proposalEvents.set(id, { status: to, seq: 0, intentId: String(rec.intentId ?? ''), scope: String(rec.scope ?? '') });
        return;
      }
      if (tr === 'REVALIDATED' || tr === 'CONFIRMATION_DENIED') { if (!cur) finding('INVALID_TRANSITION', `${tr} for a proposal (${id}) that has no PROPOSED event`); return; }
      if (to !== tr) { finding('INVALID_TRANSITION', `transition ${tr} records status ${to}`); return; }
      const from = cur ? cur.status : null;
      if (!(isValidRequestTransition(from, tr) || (from === tr && tr === 'CONFIRMED'))) {
        finding('INVALID_TRANSITION', `proposal ${id}: ${from ?? '(none)'} → ${tr} is not a legal transition`);
        return;
      }
      this.proposalEvents.set(id, { status: tr, seq, intentId: String(rec.intentId ?? cur?.intentId ?? ''), scope: String(rec.scope ?? cur?.scope ?? '') });
    } else if (kind === 'governance') {
      const d = String(rec.decision ?? '');
      const aid = rec.approvalId;
      if (typeof aid === 'string') {
        const e: ApprovalEvent = this.approvalEvents.get(aid) ?? {};
        if (d === 'HUMAN_APPROVED' || d === 'HUMAN_REJECTED') {
          const owner = readOwner(rec.human);
          if (seq !== null && !owner) finding('HUMAN_OWNER_INVALID', `${d} for ${aid} carries no valid human owner`);
          else if (d === 'HUMAN_APPROVED') { e.approvedSeq = seq ?? 0; e.approvedAgent = String(rec.agentId ?? ''); }
          else e.rejectedSeq = seq ?? 0;
        } else if (d === 'APPROVED') e.consumedSeq = seq ?? 0;
        if (rec.rule === 'APPROVAL_INVALID') e.retired = true;
        this.approvalEvents.set(aid, e);
      }
      if (seq !== null && (d === 'ALLOW' || d === 'SUPERVISED' || d === 'APPROVED') && typeof rec.callFingerprint === 'string' && typeof rec.eventId === 'string') {
        this.executableDecisions.set(rec.eventId, { seq, agentId: String(rec.agentId ?? ''), callFingerprint: rec.callFingerprint });
        this.decisionByCall.set(`${String(rec.agentId ?? '')}\u0000${rec.callFingerprint}`, rec.eventId);
      }
    } else if (kind === 'execution' && seq !== null) {
      const tid = rec.traceId;
      if (typeof tid !== 'string' || typeof rec.traceHash !== 'string') { finding('INVALID_TRANSITION', 'execution event without traceId/traceHash'); return; }
      this.committedTraces.set(tid, { hash: rec.traceHash, seq });
      if (!this.seenTraces.has(tid)) this.unseenCommitted.add(tid);
      else if (this.seenTraces.get(tid) !== rec.traceHash) finding('TRACE_HASH_MISMATCH' as IntegrityCode, `trace ${tid} does not hash to what its event committed`);
      this.uncommitted.delete(tid);
      const link = rec.authorizationEventId;
      if (link !== null && link !== undefined) {
        const d = typeof link === 'string' ? this.executableDecisions.get(link) : undefined;
        if (!d || d.seq >= seq || d.agentId !== String(rec.agentId ?? '') || d.callFingerprint !== String(rec.callFingerprint ?? '')) {
          finding('AUTHORIZATION_LINK_INVALID', `execution of trace ${tid} cites authorization ${String(link).slice(0, 30)} that does not authorize it`);
        }
      }
    } else if (kind === 'ledger' && seq !== null && rec.eventType === BOUNDARY_EVENT_TYPE) {
      this.boundary = { tracesBytes: Number(rec.tracesBytes ?? 0), tracesDigest: String(rec.tracesDigest ?? '') };
      const b = rec.baseline as { proposals?: Array<{ id: string; status: string }>; approvals?: Array<{ id: string; status: string }> } | undefined;
      for (const p of b?.proposals ?? []) { this.baselineProposals.set(p.id, p.status); if (!this.proposalEvents.has(p.id)) this.proposalEvents.set(p.id, { status: p.status, seq: 0 }); }
      for (const a of b?.approvals ?? []) this.baselineApprovals.set(a.id, a.status);
    }
  }

  // ─── anchor ────────────────────────────────────────────────────────────

  private checkAnchor(dir: string, findings: IntegrityFinding[]): void {
    const c = this.chain;
    if (c.error) return;
    const file = 'ledger-head.json';
    const path = join(dir, file);
    const key = this.deps.key();
    if (!key) { findings.push({ code: 'KEY_UNAVAILABLE', severity: 'error', file, detail: 'no seal key: the ledger head cannot be verified' }); return; }
    let anchor: unknown = null;
    let present = false;
    try {
      if (existsSync(path)) { present = true; anchor = JSON.parse(readFileSync(path, 'utf8')); }
    } catch {
      findings.push({ code: 'ANCHOR_INVALID', severity: 'error', file, detail: 'the head anchor is not readable JSON' }); return;
    }
    if (!present) {
      if (c.sequence <= 1) return; // a crash before the first anchor write; re-anchored by the next append
      findings.push({ code: 'ANCHOR_MISSING', severity: 'error', file, detail: `the chain is at sequence ${c.sequence} but its head anchor is missing`, sequence: c.sequence });
      return;
    }
    if (!anchorValid(key, anchor)) { findings.push({ code: 'ANCHOR_INVALID', severity: 'error', file, detail: 'the head anchor does not verify under the seal key' }); return; }
    const a = anchor as { sequence: number; hash: string };
    if (a.sequence > c.sequence) {
      findings.push({ code: 'ANCHOR_TRUNCATION', severity: 'error', file, detail: `the anchor records sequence ${a.sequence} but the ledger ends at ${c.sequence}: events were removed from the tail`, sequence: a.sequence });
    } else if (a.sequence === c.sequence) {
      if (a.hash !== c.hash) findings.push({ code: 'ANCHOR_MISMATCH', severity: 'error', file, detail: `the anchor and the ledger disagree about the head hash at sequence ${c.sequence}`, sequence: c.sequence });
    } else if (a.sequence === c.sequence - 1 && a.hash === c.headPrevious) {
      findings.push({ code: 'ANCHOR_BEHIND', severity: 'warning', file, detail: 'the anchor is one event behind (a crash between append and anchor); re-anchored', sequence: c.sequence });
      if (this.deps.locked()) this.writeAnchor();
    } else {
      findings.push({ code: 'ANCHOR_MISMATCH', severity: 'error', file, detail: `the anchor (sequence ${a.sequence}) does not belong to this chain (head ${c.sequence})`, sequence: c.sequence });
    }
  }

  writeAnchor(): boolean {
    const key = this.deps.key();
    if (!key) return false;
    return this.deps.writeJson('ledger-head.json', makeAnchor(key, this.chain.sequence, this.chain.hash, this.deps.now()));
  }

  // ─── traces ────────────────────────────────────────────────────────────

  private refreshTraces(dir: string, findings: IntegrityFinding[], ledgerMode: 'incremental' | 'full'): void {
    const path = join(dir, 'traces.jsonl');
    let st: ReturnType<typeof statSync> | null = null;
    try { st = existsSync(path) ? statSync(path) : null; } catch { findings.push({ code: 'STATE_FILE_CORRUPTED', severity: 'error', file: 'traces.jsonl', detail: 'unreadable' }); return; }
    const c = this.tracesCache;
    let from = 0;
    if (ledgerMode === 'incremental' && c && st && c.dir === dir && c.ino === st.ino && st.size >= c.offset) from = c.offset;
    else { // full: the ledger view was rebuilt, so the trace view is rebuilt with it
      this.traces = []; this.seenTraces = new Map(); this.uncommitted = new Set();
      this.unseenCommitted = new Set([...this.committedTraces.keys()]);
      this.legacyTracesVerified = false;
    }
    if (!st) {
      if (this.committedTraces.size) findings.push({ code: 'TRACE_MISSING', severity: 'error', file: 'traces.jsonl', detail: `${this.committedTraces.size} committed trace(s) but traces.jsonl is gone` });
      this.tracesCache = null;
      return;
    }
    let buf: Buffer;
    try { buf = this.readRange(path, from, st.size); } catch { findings.push({ code: 'STATE_FILE_CORRUPTED', severity: 'error', file: 'traces.jsonl', detail: 'unreadable' }); return; }
    // legacy region: what traces.jsonl held when the ledger was migrated is trusted as found, but its bytes are committed
    const legacyBytes = this.boundary ? this.boundary.tracesBytes : (this.chain.sequence === 0 && this.chain.legacyEvents > 0 ? Number.POSITIVE_INFINITY : 0);
    if (this.boundary && !this.legacyTracesVerified && legacyBytes > 0) {
      const head = from === 0 ? buf.subarray(0, legacyBytes) : this.readRange(path, 0, legacyBytes);
      if (head.length !== legacyBytes || tracesLegacyDigest(head) !== this.boundary.tracesDigest) {
        findings.push({ code: 'TRACE_HASH_MISMATCH', severity: 'error', file: 'traces.jsonl', detail: 'the legacy traces region no longer matches the migration boundary' });
      }
      this.legacyTracesVerified = true;
    }
    let pos = 0;
    const base = from;
    while (pos < buf.length) {
      const nl = buf.indexOf(0x0a, pos);
      const end = nl === -1 ? buf.length : nl;
      const lineStart = base + pos;
      const text = buf.subarray(pos, end).toString('utf8').trim();
      pos = nl === -1 ? buf.length : nl + 1;
      if (!text) continue;
      let t: JsonRecord;
      try { t = JSON.parse(text) as JsonRecord; } catch {
        findings.push({ code: 'TRACE_MALFORMED', severity: 'error', file: 'traces.jsonl', detail: 'a trace record is not valid JSON' });
        continue;
      }
      const id = typeof t.id === 'string' ? t.id : '';
      const hash = traceHashOf(t);
      if (id) this.seenTraces.set(id, hash);
      const committed = id ? this.committedTraces.get(id) : undefined;
      const inLegacy = lineStart < legacyBytes;
      if (committed) {
        this.unseenCommitted.delete(id);
        if (committed.hash !== hash) findings.push({ code: 'TRACE_HASH_MISMATCH', severity: 'error', file: 'traces.jsonl', detail: `trace ${id} does not hash to what its event committed`, sequence: committed.seq });
        else this.pushTrace(t);
      } else if (inLegacy) {
        this.pushTrace(t);
      } else if (id) this.uncommitted.add(id);
    }
    this.tracesCache = { dir, ino: st.ino, size: st.size, offset: st.size };
    if (this.unseenCommitted.size) findings.push({ code: 'TRACE_MISSING', severity: 'error', file: 'traces.jsonl', detail: `${this.unseenCommitted.size} trace(s) committed by an event are missing from traces.jsonl` });
    if (this.uncommitted.size) findings.push({ code: 'TRACE_UNCOMMITTED', severity: 'warning', file: 'traces.jsonl', detail: `${this.uncommitted.size} trace(s) are not committed by any event and are not evidence` });
  }

  private pushTrace(t: JsonRecord): void {
    this.traces.push(t);
    if (this.traces.length > MAX_TRACES_IN_MEMORY) this.traces.splice(0, this.traces.length - MAX_TRACES_IN_MEMORY);
  }

  /** A trace the runtime has just written AND committed (so it is evidence from now on). */
  acceptTrace(t: JsonRecord): void {
    this.pushTrace(t);
    this.seenTraces.set(String(t.id), traceHashOf(t));
    this.unseenCommitted.delete(String(t.id));
    this.uncommitted.delete(String(t.id));
    try { const st = statSync(join(this.deps.dir()!, 'traces.jsonl')); this.tracesCache = { dir: this.deps.dir()!, ino: st.ino, size: st.size, offset: st.size }; } catch { this.tracesCache = null; }
  }

  // ─── one refresh ───────────────────────────────────────────────────────

  /** Verify ledger + anchor + traces. Returns the findings and whether the chain was extended or rebuilt. */
  refresh(): { findings: IntegrityFinding[]; mode: 'incremental' | 'full' } {
    const dir = this.deps.dir();
    const findings: IntegrityFinding[] = [];
    if (!dir) return { findings: [{ code: 'NO_HIVE', severity: 'error', file: '', detail: 'no hive root' }], mode: 'full' };
    const mode = this.refreshLedger(dir, findings);
    // apply-time findings come from the (re)built view; incremental refreshes only add new ones
    findings.push(...this.applyFindings);
    this.checkAnchor(dir, findings);
    if (!this.chain.error) this.refreshTraces(dir, findings, mode);
    if (this.chain.sequence === 0 && this.chain.legacyEvents > 0 && !findings.some((f) => f.severity === 'error')) {
      findings.push({ code: 'LEGACY_UNVERIFIED', severity: 'warning', file: 'cima-ledger.jsonl', detail: `${this.chain.legacyEvents} legacy record(s) are trusted as found until the first v0.15 write commits them` });
    } else if (this.chain.legacyEvents > 0) {
      findings.push({ code: 'LEGACY_UNVERIFIED', severity: 'warning', file: 'cima-ledger.jsonl', detail: `${this.chain.legacyEvents} legacy record(s) predate the chain: committed by the migration boundary, origin not proven` });
    }
    this.lastMode = mode;
    return { findings, mode };
  }

  // ─── state ↔ events ────────────────────────────────────────────────────

  /**
   * The events are the authoritative governance facts; proposals.json and approvals.json are working state. State that
   * claims MORE authority than the events justify is an error (INCONSISTENT → governance fails closed). State that
   * claims LESS (a crash after an event, before the state write) is reported as a warning and never grants anything.
   */
  reconcile(proposals: ReadonlyArray<{ id: string; status: string }>, approvals: ReadonlyArray<{ id: string; status: string; agentId: string }>, findings: IntegrityFinding[]): void {
    if (this.chain.sequence === 0 && this.chain.legacyEvents > 0) return; // legacy ledger, no boundary yet: trusted as found
    const err = (code: IntegrityCode, file: string, detail: string): void => { findings.push({ code, severity: 'error', file, detail }); };
    const warn = (code: IntegrityCode, file: string, detail: string): void => { findings.push({ code, severity: 'warning', file, detail }); };
    const stateIds = new Set(proposals.map((p) => p.id));
    for (const p of proposals) {
      const ev = this.proposalEvents.get(p.id);
      if (!ev) {
        if (p.status === 'CONFIRMED') err('PROPOSAL_UNEVIDENCED', 'proposals.json', `proposal ${p.id} is CONFIRMED in state but no event ever proposed it`);
        else warn('STATE_UNEVIDENCED_REDUCED', 'proposals.json', `proposal ${p.id} (${p.status}) has no event`);
        continue;
      }
      if (ev.status === p.status) continue;
      const grants = p.status === 'CONFIRMED' || (p.status === 'PROPOSED' && !REQUEST_TERMINAL.has(ev.status) && ev.status !== 'CONFIRMED');
      if (p.status === 'CONFIRMED' && ev.status !== 'CONFIRMED') err('PROPOSAL_STATE_MISMATCH', 'proposals.json', `proposal ${p.id} is CONFIRMED in state but its events say ${ev.status}`);
      else if (p.status === 'PROPOSED' && ev.status !== 'PROPOSED') warn('STATE_BEHIND_EVENTS', 'proposals.json', `proposal ${p.id} is PROPOSED in state; its events say ${ev.status}`);
      else if (grants) err('PROPOSAL_STATE_MISMATCH', 'proposals.json', `proposal ${p.id} is ${p.status} in state but its events say ${ev.status}`);
      else warn('STATE_UNEVIDENCED_REDUCED', 'proposals.json', `proposal ${p.id} is ${p.status} in state; its events say ${ev.status}`);
    }
    for (const [id, ev] of this.proposalEvents) {
      if ((ev.status === 'PROPOSED' || ev.status === 'CONFIRMED') && !stateIds.has(id)) {
        err('PROPOSAL_MISSING', 'proposals.json', `proposal ${id} is ${ev.status} by its events but is missing from proposals.json`);
      }
    }
    for (const a of approvals) {
      const ev = this.approvalEvents.get(a.id);
      const base = this.baselineApprovals.get(a.id);
      if (a.status === 'approved') {
        const evidenced = (ev?.approvedSeq !== undefined && ev.approvedAgent === a.agentId) || base === 'approved';
        if (ev?.rejectedSeq !== undefined && ev.approvedSeq === undefined) err('APPROVAL_STATE_MISMATCH', 'approvals.json', `approval ${a.id} is approved in state but its events say it was rejected`);
        else if (!evidenced) err('APPROVAL_UNEVIDENCED', 'approvals.json', `approval ${a.id} is approved in state but no HUMAN_APPROVED event (with a human owner) records it`);
      } else if (a.status === 'consumed') {
        const evidenced = ev?.approvedSeq !== undefined || base === 'approved' || base === 'consumed';
        if (!evidenced) warn('STATE_UNEVIDENCED_REDUCED', 'approvals.json', `approval ${a.id} is consumed in state but no event approved it`);
      } else if (a.status === 'pending' && ev?.approvedSeq !== undefined) {
        warn('STATE_BEHIND_EVENTS', 'approvals.json', `approval ${a.id} is pending in state; its events say it was approved`);
      }
    }
  }

  // ─── verdict ───────────────────────────────────────────────────────────

  verification(findings: IntegrityFinding[], mode: 'incremental' | 'full', recovery: RecoveryState): GovernanceVerification {
    const c = this.chain;
    const v: GovernanceVerification = {
      status: classify(findings), recovery, findings: findings.slice(0, 50),
      ledger: { events: c.events, headSequence: c.sequence, headHash: c.hash, legacyEvents: c.legacyEvents, legacyUnverified: c.legacyEvents > 0 },
      checkedAt: this.deps.now(), mode
    };
    this.last = v;
    return v;
  }

  // ─── append ────────────────────────────────────────────────────────────

  /**
   * Append one record to the ledger as the next event. The caller must hold the lock and have a healthy verification.
   * Returns false when the event could not be made durable AND anchored (the event may still be on disk; the chain
   * then simply continues from it — nothing is ever rewritten).
   */
  append(entry: unknown): boolean {
    const dir = this.deps.dir();
    if (!dir || !this.deps.locked()) return false;
    const key = this.deps.key();
    if (!key) return false;
    try {
      mkdirSync(dir, { recursive: true });
      if (this.chain.sequence === 0 && this.chain.legacyEvents > 0) { if (!this.writeEvent(dir, this.boundaryRecord(dir))) return false; }
      return this.writeEvent(dir, entry) && this.writeAnchor();
    } catch (e) {
      console.error('[lapitaya] ledger write failed:', e);
      return false;
    }
  }

  private boundaryRecord(dir: string): JsonRecord {
    const c = this.chain;
    let tracesBytes = 0; let tracesDigest = tracesLegacyDigest(Buffer.alloc(0));
    try {
      const p = join(dir, 'traces.jsonl');
      if (existsSync(p)) { const b = readFileSync(p); tracesBytes = b.length; tracesDigest = tracesLegacyDigest(b); }
    } catch { /* an unreadable traces file is reported by refresh */ }
    const s = this.deps.snapshot();
    return {
      kind: 'ledger', eventType: BOUNDARY_EVENT_TYPE, ts: this.deps.now(),
      reason: 'first v0.15 write on a ledger written by v0.14 or older',
      legacyEvents: c.legacyEvents, legacyBytes: c.legacyBytes, legacyDigest: c.legacyDigest,
      tracesBytes, tracesDigest,
      baseline: { proposals: s.proposals.map((p) => ({ id: p.id, status: p.status })), approvals: s.approvals.map((a) => ({ id: a.id, status: a.status })) }
    };
  }

  /** Write ONE event (prefixing a newline if the file ends mid-line) and move the in-memory chain to it. */
  private writeEvent(dir: string, entry: unknown): boolean {
    const c = this.chain;
    const prev = c.sequence === 0 && c.legacyEvents > 0 ? c.legacyBoundary : c.hash;
    const event = stampEvent(entry, c.sequence + 1, prev, this.deps.key()!);
    const line = JSON.stringify(event) + '\n';
    const target = join(dir, 'cima-ledger.jsonl');
    const fd = openSync(target, 'a+');
    let prefix = '';
    let size = 0;
    try {
      size = fstatSync(fd).size;
      if (size > 0) { const last = Buffer.alloc(1); readSync(fd, last, 0, 1, size - 1); if (last[0] !== 0x0a) prefix = '\n'; }
      writeSync(fd, prefix + line);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    // the chain now stands at this event
    const lineStart = size + prefix.length;
    c.eventIds.add(String(event.eventId));
    c.headPrevious = prev; c.sequence = event.sequence as number; c.hash = String(event.eventHash); c.events++;
    c.lastLineStart = lineStart; c.offset = lineStart + Buffer.byteLength(line); c.lines++;
    this.apply(event, c.sequence);
    try { const st = statSync(target); this.cache = { dir, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs }; } catch { this.cache = null; }
    return true;
  }
}

export { GENESIS_HASH, LEDGER_SCHEMA_VERSION };
