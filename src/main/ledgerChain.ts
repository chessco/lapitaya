/**
 * La Pitaya CIMA v0.15 — the governance event chain (main process, node:crypto, no fs).
 *
 * `cima-ledger.jsonl` stays JSON Lines, but every NEW line is an EVENT with an identity, a position and a link
 * to its predecessor:
 *
 *   { …the v0.14 record fields…,
 *     schemaVersion: 2, eventId, eventType, sequence, previousEventHash, eventHash }
 *
 *   eventHash = SHA-256( "lapitaya/ledger-event/v2\n" ‖ canonicalJson(event without eventHash) )
 *
 * The chain starts at GENESIS_HASH (sequence 1). A ledger written by v0.14 or older has lines WITHOUT that envelope:
 * they are the LEGACY prefix. The runtime never rewrites them; the first v2 event is a LEDGER_MIGRATION_BOUNDARY whose
 * previousEventHash commits to the exact bytes of the legacy prefix, so from the boundary on nobody can alter,
 * remove or reorder them undetected — but their ORIGIN is not proven (they are trusted as found: LEGACY_UNVERIFIED).
 *
 * What the chain detects: modification, deletion, insertion, reordering, truncation (with the keyed head anchor),
 * duplicate/regressing sequences, duplicate ids, unknown schemas, malformed and truncated records.
 * What it does NOT do: stop a writer who holds the seal key and rewrites chain AND anchor. See the v0.15 document.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '../shared/lapitaya/authSubject';
import { LEDGER_SCHEMA_VERSION, type IntegrityFinding } from '../shared/lapitaya/governanceIntegrity';

const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

export const DOMAIN_GENESIS = 'lapitaya/ledger-genesis/v1';
export const DOMAIN_EVENT = 'lapitaya/ledger-event/v2\n';
export const DOMAIN_LEGACY = 'lapitaya/ledger-legacy-boundary/v1\n';
export const DOMAIN_ANCHOR = 'lapitaya/ledger-anchor/v1\n';
export const DOMAIN_TRACE = 'lapitaya/trace/v1\n';
export const DOMAIN_EVENT_MAC = 'lapitaya/ledger-event-mac/v1\n';
export const DOMAIN_TRACES_LEGACY = 'lapitaya/traces-legacy/v1\n';

export const GENESIS_HASH = sha256(DOMAIN_GENESIS);
export const BOUNDARY_EVENT_TYPE = 'LEDGER_MIGRATION_BOUNDARY';
const HEX64 = /^[0-9a-f]{64}$/;

/** Fields only the runtime may set: whatever a record carries under these names is discarded before stamping. */
const ENVELOPE_FIELDS = ['schemaVersion', 'eventId', 'eventType', 'sequence', 'previousEventHash', 'eventHash', 'eventMac'] as const;

export function eventHashOf(event: Record<string, unknown>): string {
  const { eventHash: _h, eventMac: _m, ...rest } = event;
  return sha256(DOMAIN_EVENT + canonicalJson(rest));
}

/**
 * The keyed seal of one event: HMAC-SHA256(seal key, eventHash). A bare hash chain can be recomputed by anyone who can
 * write the file; the MAC cannot — so an event cannot be forged, inserted or re-chained without the runtime's key.
 */
export function eventMacOf(key: Buffer, eventHash: string): string {
  return createHmac('sha256', key).update(DOMAIN_EVENT_MAC + eventHash).digest('hex');
}

function macMatches(key: Buffer, eventHash: string, mac: unknown): boolean {
  if (typeof mac !== 'string' || !HEX64.test(mac)) return false;
  const want = Buffer.from(eventMacOf(key, eventHash), 'hex');
  const got = Buffer.from(mac, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Hash of one trace record, as committed by its TOOL_EXECUTED / TOOL_FAILED event. */
export function traceHashOf(trace: unknown): string {
  return sha256(DOMAIN_TRACE + canonicalJson(trace));
}

export function newEventId(): string {
  return `evt-${randomBytes(12).toString('hex')}`;
}

/** What a legacy prefix commits to: a digest of its exact bytes and the number of records in it. */
export function legacyBoundaryHash(legacyDigestHex: string, legacyEvents: number): string {
  return sha256(`${DOMAIN_LEGACY}${legacyDigestHex}:${legacyEvents}`);
}

export function tracesLegacyDigest(bytes: Buffer): string {
  return sha256(Buffer.concat([Buffer.from(DOMAIN_TRACES_LEGACY, 'utf8'), bytes]));
}

/** The runtime's name for what a ledger record IS. Derived — never taken from an actor. */
export function eventTypeOf(entry: Record<string, unknown>): string {
  const kind = String(entry.kind ?? '');
  if (kind === 'governance') {
    const d = String(entry.decision ?? '');
    if (entry.rule === 'APPROVAL_INVALID') return 'APPROVAL_RETIRED';
    if (d === 'HUMAN_APPROVED' || d === 'HUMAN_REJECTED' || d === 'HUMAN_APPROVAL_REQUIRED') return d;
    if (d === 'APPROVED') return 'APPROVAL_CONSUMED';
    if (d === 'ALLOW' || d === 'SUPERVISED') return 'AUTHORIZATION_GRANTED';
    if (d === 'DENY') return 'AUTHORIZATION_DENIED';
    return 'GOVERNANCE_DECISION';
  }
  if (kind === 'request') return `REQUEST_${String(entry.transition ?? 'EVENT')}`;
  if (kind === 'cima') return 'CIMA_RECORD';
  if (kind === 'cima-assignment') return 'CIMA_ASSIGNMENT';
  if (kind === 'intent') return `INTENT_${String(entry.status ?? 'EVENT')}`;
  if (kind === 'execution') return String(entry.eventType ?? 'TOOL_EXECUTED');
  if (kind === 'ledger') return String(entry.eventType ?? 'LEDGER_EVENT');
  return 'EVENT';
}

/** Stamp a record into an event: strips any envelope field the record carried, then adds ours. */
export function stampEvent(entry: unknown, sequence: number, previousEventHash: string, key: Buffer): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(entry as Record<string, unknown>) };
  for (const f of ENVELOPE_FIELDS) delete rest[f];
  const eventType = eventTypeOf({ ...rest, eventType: (entry as Record<string, unknown>).eventType });
  const event: Record<string, unknown> = {
    ...rest, schemaVersion: LEDGER_SCHEMA_VERSION, eventId: newEventId(), eventType, sequence, previousEventHash
  };
  event.eventHash = eventHashOf(event);
  event.eventMac = eventMacOf(key, String(event.eventHash));
  return event;
}

// ─── the keyed head anchor (detects tail deletion, which a bare hash chain cannot) ────────────────────────

export interface Anchor { v: 1; sequence: number; hash: string; ts: number; mac: string }

export function anchorMac(key: Buffer, sequence: number, hash: string): string {
  return createHmac('sha256', key).update(DOMAIN_ANCHOR + canonicalJson({ v: 1, sequence, hash })).digest('hex');
}

export function makeAnchor(key: Buffer, sequence: number, hash: string, ts: number): Anchor {
  return { v: 1, sequence, hash, ts, mac: anchorMac(key, sequence, hash) };
}

export function anchorValid(key: Buffer, a: unknown): a is Anchor {
  if (!a || typeof a !== 'object') return false;
  const x = a as Partial<Anchor>;
  if (x.v !== 1 || !Number.isInteger(x.sequence) || (x.sequence as number) < 0 || typeof x.hash !== 'string' || !HEX64.test(x.hash)) return false;
  if (typeof x.mac !== 'string' || !HEX64.test(x.mac)) return false;
  const want = Buffer.from(anchorMac(key, x.sequence as number, x.hash), 'hex');
  const got = Buffer.from(x.mac, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}

// ─── incremental verification ─────────────────────────────────────────────────────────────────────────

export interface ChainHandlers {
  /** A legacy (pre-v0.15) record, in file order. */
  legacy(entry: Record<string, unknown>): void;
  /** A verified v0.15 event, in chain order. */
  event(event: Record<string, unknown>, line: number): void;
}

/**
 * The verified prefix of a ledger. `consume` feeds it raw bytes that START at `offset` (the end of what is already
 * verified); it stops at the FIRST defect and records it — nothing after a defect is trusted, applied or skipped.
 */
export class LedgerChain {
  sequence = 0;
  hash = GENESIS_HASH;
  /** `previousEventHash` of the head event (the lag-by-one anchor rule needs the hash one step back). */
  headPrevious = GENESIS_HASH;
  eventIds = new Set<string>();
  legacyEvents = 0;
  legacyBytes = 0;
  /** The seal key events are MAC-verified with (set by the store before each verification). */
  key: Buffer | null = null;
  /** Bytes of the ledger verified so far (always on a record boundary). */
  offset = 0;
  /** Where the last verified record begins (for the cheap tail re-check). */
  lastLineStart = 0;
  lines = 0;
  events = 0;
  /** The tail's last byte was not a newline although the record verified (the next append must add one). */
  missingNewline = false;
  error: IntegrityFinding | null = null;
  /** Byte offset where the first defective record begins (valid prefix = [0, errorOffset)). */
  errorOffset = -1;
  private legacyHasher = createHash('sha256');
  private started = false;

  get legacyDigest(): string { return this.legacyHasher.copy().digest('hex'); }
  get legacyBoundary(): string { return legacyBoundaryHash(this.legacyDigest, this.legacyEvents); }
  get ok(): boolean { return this.error === null; }

  private fail(code: IntegrityFinding['code'], detail: string, at: number, line: number, sequence?: number): void {
    this.error = { code, severity: 'error', file: 'cima-ledger.jsonl', detail, line, ...(sequence !== undefined ? { sequence } : {}) };
    this.errorOffset = at;
  }

  consume(buf: Buffer, h: ChainHandlers): void {
    if (this.error) return;
    if (this.missingNewline && buf.length > 0 && buf[0] === 0x0a) {
      // the previous record verified without its newline; the append that follows supplies it
      buf = buf.subarray(1);
      this.offset += 1;
      this.missingNewline = false;
    }
    const base = this.offset;
    let pos = 0;
    while (pos < buf.length && !this.error) {
      const nl = buf.indexOf(0x0a, pos);
      const complete = nl !== -1;
      const end = complete ? nl : buf.length;
      const raw = buf.subarray(pos, end);
      const at = base + pos;
      const lineNo = this.lines + 1;
      const consumed = (complete ? end + 1 : end) - pos;
      if (raw.length === 0 || raw.toString('utf8').trim() === '') {
        if (this.started) { this.fail('INVALID_SCHEMA', 'blank line inside the event chain', at, lineNo); return; }
        // blank lines in the legacy region were always tolerated; they are part of the committed bytes
        this.legacyHasher.update(buf.subarray(pos, pos + consumed));
        pos += consumed; this.lines++; this.offset = base + pos;
        continue;
      }
      let obj: unknown;
      try { obj = JSON.parse(raw.toString('utf8')); } catch {
        this.fail(complete ? 'MALFORMED_JSON' : 'TRUNCATED_TAIL', complete ? 'record is not valid JSON' : 'final record is incomplete', at, lineNo);
        return;
      }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { this.fail('INVALID_SCHEMA', 'record is not a JSON object', at, lineNo); return; }
      const rec = obj as Record<string, unknown>;
      const sv = rec.schemaVersion;

      if (sv === undefined) {
        // ── legacy record
        if (this.started) { this.fail('LEGACY_AFTER_CHAIN', 'a record without the event envelope follows the chain (schema downgrade)', at, lineNo); return; }
        if (!complete) { this.fail('TRUNCATED_TAIL', 'final legacy record has no terminating newline', at, lineNo); return; }
        this.legacyHasher.update(buf.subarray(pos, pos + consumed));
        this.legacyEvents++; this.legacyBytes += consumed;
        h.legacy(rec);
      } else {
        // ── v0.15 event
        if (sv !== LEDGER_SCHEMA_VERSION) {
          this.fail('UNKNOWN_SCHEMA', `schemaVersion ${JSON.stringify(sv).slice(0, 20)} is not understood by this runtime`, at, lineNo);
          return;
        }
        const seq = rec.sequence;
        const prev = rec.previousEventHash;
        const hash = rec.eventHash;
        const id = rec.eventId;
        if (typeof id !== 'string' || !id || typeof rec.eventType !== 'string' || !rec.eventType
          || !Number.isInteger(seq) || (seq as number) < 1 || typeof prev !== 'string' || !HEX64.test(prev) || typeof hash !== 'string' || !HEX64.test(hash)) {
          this.fail('INVALID_SCHEMA', 'event envelope is incomplete or ill-typed', at, lineNo);
          return;
        }
        const s = seq as number;
        if (s === this.sequence) { this.fail('SEQUENCE_DUPLICATE', `sequence ${s} appears twice`, at, lineNo, s); return; }
        if (s < this.sequence) { this.fail('SEQUENCE_REGRESSION', `sequence ${s} follows ${this.sequence}`, at, lineNo, s); return; }
        if (s !== this.sequence + 1) { this.fail('SEQUENCE_GAP', `sequence jumps from ${this.sequence} to ${s}`, at, lineNo, s); return; }
        if (this.eventIds.has(id)) { this.fail('DUPLICATE_EVENT_ID', `eventId ${id} appears twice`, at, lineNo, s); return; }
        if (!this.started && this.legacyEvents > 0) {
          if (rec.eventType !== BOUNDARY_EVENT_TYPE) { this.fail('BOUNDARY_MISMATCH', 'the first event after a legacy prefix is not the migration boundary', at, lineNo, s); return; }
          if (prev !== this.legacyBoundary) { this.fail('BOUNDARY_MISMATCH', 'the migration boundary does not commit to the legacy prefix on disk', at, lineNo, s); return; }
        } else if (prev !== this.hash) {
          this.fail('PREVIOUS_HASH_MISMATCH', 'previousEventHash does not match the previous event', at, lineNo, s); return;
        }
        if (eventHashOf(rec) !== hash) { this.fail('EVENT_HASH_MISMATCH', 'the event does not hash to its eventHash', at, lineNo, s); return; }
        if (!this.key || !macMatches(this.key, hash, rec.eventMac)) { this.fail('EVENT_MAC_INVALID', 'the event is not sealed by the runtime key (forged, re-chained or sealed under another key)', at, lineNo, s); return; }
        this.started = true;
        this.eventIds.add(id);
        this.headPrevious = prev;
        this.sequence = s; this.hash = hash; this.events++;
        h.event(rec, lineNo);
      }
      this.lastLineStart = at;
      if (!complete) this.missingNewline = true;
      this.lines++;
      pos += consumed;
      this.offset = at + consumed;
    }
  }
}
