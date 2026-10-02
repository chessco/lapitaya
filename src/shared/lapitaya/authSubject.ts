/**
 * La Pitaya CIMA v0.14 — canonical identities (pure: no fs, no crypto, no clock).
 *
 * Two things must be canonical BEFORE governance looks at a call:
 *
 *   1. the PATH a call names (so `a/../b`, `A\B`, `b.`, `b /` and friends are one object);
 *   2. the JSON the authorization subject is built from (so the same call always
 *      serializes to the same bytes, and different calls never share bytes).
 *
 * The cryptographic fingerprint over that encoding lives in src/main/authBinding.ts
 * (it needs node:crypto, which shared code must not import).
 */

// ─── canonical path ────────────────────────────────────────────────────────

export interface CanonicalPath {
  /** Normalized, lower-cased comparison key (`c:/users/x`, `/home/x`, `//server/share/x`, or relative). */
  key: string;
  /** Normalized spelling with the original case (what the filesystem is asked about). */
  display: string;
  /** The path is anchored (drive, root or UNC). A relative path without a base stays relative. */
  absolute: boolean;
  /** The path cannot be given a single unambiguous meaning: callers must fail closed. */
  ambiguous: boolean;
  reason?: string;
}

export interface CanonicalizeOptions {
  /** Directory a relative path is resolved against (the agent's cwd), when known. */
  base?: string | null;
  /** 8.3 short names (`PROGRA~1`) cannot be judged lexically. Default: ambiguous. Main passes
   *  'allow' for its FIRST pass, expands them through the filesystem, then canonicalizes strictly. */
  shortNames?: 'ambiguous' | 'allow';
}

const CONTROL = /[\u0000-\u001f\u007f]/;
const ENCODED = /%(?:2e|2f|5c|00)/i;
const SHORT_NAME = /~\d/;

function ambiguous(raw: string, reason: string): CanonicalPath {
  const s = raw.replace(/\\/g, '/');
  return { key: s.toLowerCase(), display: s, absolute: false, ambiguous: true, reason };
}

/** Split off an anchor: `//server/share`, `c:`, `/`, or nothing. Returns null on an ambiguous prefix. */
function anchorOf(s: string): { anchor: string; rest: string } | null {
  // Win32 extended / device prefixes: //?/C:/x  //./C:/x  → the drive path
  if (/^\/\/[?.]\//.test(s)) {
    const t = s.slice(4);
    if (/^unc\//i.test(t)) return { anchor: '//', rest: t.slice(4) };
    s = t;
  }
  const drive = /^([a-zA-Z]):(.*)$/.exec(s);
  if (drive) {
    if (!drive[2].startsWith('/')) return null; // drive-relative `C:foo`
    return { anchor: drive[1] + ':', rest: drive[2] };
  }
  if (s.startsWith('//') && !s.startsWith('///')) return { anchor: '//', rest: s.slice(2) }; // UNC
  if (s.startsWith('/')) return { anchor: '', rest: s };
  return { anchor: '', rest: s }; // relative
}

/**
 * Lexical canonicalization. The result is the same for every spelling of the same
 * object: separators, duplicate separators, `.`/`..` segments, trailing dots and
 * spaces (Win32 drops them), case. Anything that cannot be given one meaning
 * (encoded separators, NTFS streams, drive-relative paths, 8.3 short names, a `..`
 * above the root) is flagged `ambiguous`.
 */
export function canonicalizePath(raw: unknown, opts: CanonicalizeOptions = {}): CanonicalPath {
  if (typeof raw !== 'string' || !raw.trim()) return ambiguous(String(raw ?? ''), 'empty path');
  if (CONTROL.test(raw)) return ambiguous(raw, 'control character in path');
  if (ENCODED.test(raw)) return ambiguous(raw, 'encoded path separator');
  if (/^file:/i.test(raw.trim())) return ambiguous(raw, 'file: URL');

  let s = raw.trim().replace(/\\/g, '/');
  const split = anchorOf(s);
  if (!split) return ambiguous(raw, 'drive-relative path');
  let { anchor, rest } = split;
  let absolute = anchor !== '' || rest.startsWith('/');

  // A colon beyond the drive designator is an NTFS stream (`file::$DATA`) or garbage.
  if (rest.includes(':')) return ambiguous(raw, 'stream or colon in path');

  let segs = rest.split('/');
  if (!absolute && opts.base) {
    const b = canonicalizePath(opts.base, { shortNames: opts.shortNames });
    if (b.ambiguous || !b.absolute) return ambiguous(raw, 'ambiguous base directory');
    const bs = anchorOf(b.display)!;
    anchor = bs.anchor;
    segs = [...bs.rest.split('/'), ...segs];
    absolute = true;
  }

  const out: string[] = [];
  for (let seg of segs) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (absolute) return ambiguous(raw, 'path escapes the root');
      else out.push('..');
      continue;
    }
    const stripped = seg.replace(/[. ]+$/, ''); // Win32 ignores trailing dots and spaces
    if (stripped === '') return ambiguous(raw, 'segment is only dots or spaces');
    if (SHORT_NAME.test(stripped) && opts.shortNames !== 'allow') return ambiguous(raw, '8.3 short name');
    out.push(stripped);
  }
  const body = out.join('/');
  const display = anchor === '//' ? `//${body}` : anchor ? `${anchor}/${body}` : absolute ? `/${body}` : body;
  return { key: display.toLowerCase(), display, absolute, ambiguous: false };
}

/** Is `child` the same object as `root` or inside it? Both are canonical keys. */
export function isInside(child: string, root: string): boolean {
  const r = root.replace(/\/+$/, '');
  return child === r || child.startsWith(r + '/');
}

// ─── canonical JSON ────────────────────────────────────────────────────────

const MAX_DEPTH = 32;

/**
 * Deterministic JSON: object keys sorted, no insignificant whitespace, strings via
 * JSON.stringify, only finite numbers. Throws on anything that is not plain JSON data
 * (functions, symbols, bigint, cycles, non-finite numbers): callers fail closed.
 * `undefined` object members are omitted (as JSON does); `undefined` in an array is `null`.
 */
export function canonicalJson(v: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new Error('canonicalJson: too deep');
  if (v === null || v === undefined) return 'null';
  switch (typeof v) {
    case 'string': return JSON.stringify(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new Error('canonicalJson: non-finite number');
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x, depth + 1)).join(',')}]`;
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error('canonicalJson: not a plain object');
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k], depth + 1)}`).join(',')}}`;
    }
    default: throw new Error(`canonicalJson: unsupported ${typeof v}`);
  }
}

// ─── the authorization subject (shape only; digests are computed in main) ──

export const AUTH_SUBJECT_VERSION = 1;

/** WHAT is being asked: who, through which provider, which tool, exactly which input. */
export interface AuthorizationCall {
  agent: string;
  provider: string | null;
  tool: string;
  /** Canonical keys of every path the call names (sorted, unique). */
  targets: string[];
  /** SHA-256 of the canonical JSON of the RAW input (any alternative spelling is a different call). */
  input: string;
}

/** UNDER WHICH governance context the human is being asked. */
export interface AuthorizationContext {
  task: string | null;
  risk: string;
  category: string;
  mode: string;
  stage: string;
  rule: string;
  /** The confirmed REQUEST proposal in force, if any. */
  request: string | null;
  /** v0.16: the capability the runtime resolved (policy registry). Absent in subjects bound before v0.16. */
  capability?: string;
  /** v0.16: the governance policy version in force. Absent in subjects bound before v0.16. */
  policy?: number;
}

export interface AuthorizationSubject {
  v: typeof AUTH_SUBJECT_VERSION;
  call: AuthorizationCall;
  context: AuthorizationContext;
}

/** The path-bearing fields of a tool input, in the order the CLI tools define them. */
export const PATH_FIELDS = ['file_path', 'notebook_path', 'path'] as const;

export function pathsOfInput(input: unknown): string[] {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return PATH_FIELDS.flatMap((f) => (typeof i[f] === 'string' && i[f] ? [i[f] as string] : []));
}
