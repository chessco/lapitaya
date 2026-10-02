/**
 * La Pitaya CIMA v0.14 — authorization binding (main process, node:crypto).
 *
 * A human approval is bound to ONE authorization subject:
 *
 *   subject     = { v, call{agent, provider, tool, targets, input-digest}, context{task, risk, category, mode, stage, rule, request} }
 *   encoding    = canonicalJson(subject)            (sorted keys, no ambiguity — shared/lapitaya/authSubject.ts)
 *   fingerprint = SHA-256( "lapitaya/authsubject/v1\n" + encoding )   → 64 hex chars
 *
 * The domain-separation prefix keeps these digests from ever being valid for another
 * purpose. The subject holds DIGESTS of the input, never raw input, tokens or secrets,
 * so it can be stored and shown without leaking credentials.
 *
 * Approval records are additionally SEALED with HMAC-SHA256 under a runtime-held key,
 * so a hand-written or hand-edited approvals.json is not an approval.
 *
 * No cryptography of our own: SHA-256 and HMAC-SHA256 from node:crypto.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTH_SUBJECT_VERSION, canonicalJson, canonicalizePath, pathsOfInput,
  type AuthorizationCall, type AuthorizationContext, type AuthorizationSubject
} from '../shared/lapitaya/authSubject';

export const FINGERPRINT_ALG = 'sha256';
const DOMAIN_SUBJECT = 'lapitaya/authsubject/v1\n';
const DOMAIN_CALL = 'lapitaya/authcall/v1\n';
const DOMAIN_INPUT = 'lapitaya/authinput/v1\n';
const DOMAIN_SEAL = 'lapitaya/approval-seal/v1\n';

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Digest of a tool input exactly as the actor supplied it. Throws on non-JSON data (callers fail closed). */
export function inputDigest(input: unknown): string {
  return sha256(DOMAIN_INPUT + canonicalJson(input ?? null));
}

export interface CallParts {
  agent: string;
  provider: string | null;
  tool: string;
  input: unknown;
  /** Resolves a raw path to its canonical key (realpath-aware in main). Ambiguous → throws. */
  resolvePath: (raw: string) => string;
}

export function buildCall(p: CallParts): AuthorizationCall {
  const targets = [...new Set(pathsOfInput(p.input).map((raw) => p.resolvePath(raw)))].sort();
  return { agent: p.agent, provider: p.provider, tool: p.tool, targets, input: inputDigest(p.input) };
}

export function buildSubject(call: AuthorizationCall, context: AuthorizationContext): AuthorizationSubject {
  return { v: AUTH_SUBJECT_VERSION, call, context };
}

/** The AUTHORIZATION FINGERPRINT: SHA-256 over the canonical subject. */
export function subjectFingerprint(subject: AuthorizationSubject): string {
  return sha256(DOMAIN_SUBJECT + canonicalJson(subject));
}

/** The call part alone (no task/risk/stage/request): identifies "the same call" across the intent
 *  boundary and the execution boundary, and links a decision to its trace. */
export function callFingerprint(call: AuthorizationCall): string {
  return sha256(DOMAIN_CALL + canonicalJson(call));
}

export interface ApprovalBinding {
  v: typeof AUTH_SUBJECT_VERSION;
  alg: typeof FINGERPRINT_ALG;
  fingerprint: string;
  subject: AuthorizationSubject;
}

export function makeBinding(subject: AuthorizationSubject): ApprovalBinding {
  return { v: AUTH_SUBJECT_VERSION, alg: FINGERPRINT_ALG, fingerprint: subjectFingerprint(subject), subject };
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Structural + cryptographic validity of a binding: recomputing the digest from the stored
 *  subject must give the stored fingerprint, and the subject must be about `agentId`. */
export function bindingValid(b: unknown, agentId: string): b is ApprovalBinding {
  if (!b || typeof b !== 'object') return false;
  const x = b as Partial<ApprovalBinding>;
  if (x.v !== AUTH_SUBJECT_VERSION || x.alg !== FINGERPRINT_ALG) return false;
  if (typeof x.fingerprint !== 'string' || !HEX64.test(x.fingerprint)) return false;
  const s = x.subject as AuthorizationSubject | undefined;
  if (!s || s.v !== AUTH_SUBJECT_VERSION || !s.call || !s.context || s.call.agent !== agentId) return false;
  try { return subjectFingerprint(s) === x.fingerprint; } catch { return false; }
}

// ─── approval seal ─────────────────────────────────────────────────────────

/** The fields a seal covers: everything that decides whether the approval may be used. */
export interface SealedFields {
  id: string; agentId: string; tool: string; status: string;
  createdAt: number; expiresAt?: number; decidedAt?: number; decidedBy?: string; decidedOwner?: string;
  consumedAt?: number; fingerprint: string;
}

export function sealApproval(key: Buffer, f: SealedFields): string {
  return createHmac('sha256', key).update(DOMAIN_SEAL + canonicalJson(f)).digest('hex');
}

export function sealMatches(key: Buffer, f: SealedFields, seal: unknown): boolean {
  if (typeof seal !== 'string' || !HEX64.test(seal)) return false;
  const want = Buffer.from(sealApproval(key, f), 'hex');
  const got = Buffer.from(seal, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * The seal key. Production wires it outside the hive (deps.sealKey, a per-user file the agents'
 * governance paths never reach). Without it the runtime keeps `<hive>/lapitaya/.seal-key`
 * (created once, `wx`): this still defeats hand edits and copies, but it is only as private as the
 * hive directory — see docs (remaining risks). Returns null when no key can be had → fail closed.
 */
export function loadOrCreateKey(path: string): Buffer | null {
  try {
    if (existsSync(path)) {
      const k = Buffer.from(readFileSync(path, 'utf8').trim(), 'hex');
      return k.length === 32 ? k : null;
    }
    mkdirSync(join(path, '..'), { recursive: true });
    const k = randomBytes(32);
    try {
      writeFileSync(path, k.toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch {
      // lost a creation race: the winner's key is the key
      const w = Buffer.from(readFileSync(path, 'utf8').trim(), 'hex');
      return w.length === 32 ? w : null;
    }
    return k;
  } catch { return null; }
}

/** HMAC-SHA256 over a domain-separated canonical value, under the runtime-held key. */
export function keyedDigest(key: Buffer, domain: string, value: unknown): string {
  return createHmac('sha256', key).update(domain + canonicalJson(value)).digest('hex');
}

/** Canonical key of a path for subjects: ambiguous paths cannot be bound. */
export function lexicalPathKey(raw: string, base?: string | null): string {
  const c = canonicalizePath(raw, { base });
  if (c.ambiguous) throw new Error(`ambiguous path: ${c.reason}`);
  return c.key;
}
