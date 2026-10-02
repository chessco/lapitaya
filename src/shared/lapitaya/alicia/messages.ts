/**
 * Alicia's words — localized text AROUND technical facts, never instead of them.
 *
 * The strings live in the existing `lapitaya` i18n namespace
 * (renderer/src/i18n/locales/lapitaya/*.json, key `alicia.*`), so the UI
 * (`t('lapitaya:alicia.…')`) and any non-UI host read the same catalog. This
 * module resolves them without i18next so main, tests and a future device host
 * can use it; placeholders use the i18next `{{name}}` syntax.
 *
 * Rules (docs/LA_PITAYA_ALICIA_ARCHITECTURE_04.md §13):
 *   - es-MX for any Spanish locale, en-US for everything else (the fallback).
 *   - Identifiers stay intact: `phase`, `verdict`, `rule`, `risk`, `decision`
 *     are interpolated verbatim; only `*Label` values are localized labels.
 *   - An explanation always travels with the technical detail it explains.
 */

import esMX from '../../../renderer/src/i18n/locales/lapitaya/es-MX.json';
import enUS from '../../../renderer/src/i18n/locales/lapitaya/en-US.json';
import { isSpanish } from '../locales';
import { agentByName, agentDisplayName } from '../agents';
import type { AliciaTechnical } from './events';

type Catalog = typeof enUS;

export type AliciaLocale = 'es-MX' | 'en-US';

/** The catalog locale Alicia uses for a requested locale. */
export function aliciaLocale(locale: string | null | undefined): AliciaLocale {
  return isSpanish(locale) ? 'es-MX' : 'en-US';
}

function lookup(catalog: unknown, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** `lapitaya:<key>` for a locale, falling back to en-US, then to the key itself. */
export function aliciaText(locale: string | null | undefined, key: string, vars: Record<string, string | number | undefined> = {}): string {
  const catalog: Catalog = aliciaLocale(locale) === 'es-MX' ? (esMX as Catalog) : enUS;
  const template = lookup(catalog, key) ?? lookup(enUS, key) ?? key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? '' : String(v);
  }).replace(/\s+([.,:;])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** Localized label for a CIMA phase id (the id itself is never replaced). */
export function phaseLabel(locale: string | null | undefined, phase: string): string {
  const t = aliciaText(locale, `cima.phases.${phase}`);
  return t === `cima.phases.${phase}` ? phase : t;
}

/** Localized, lower-case risk label ("riesgo alto" / "high risk"). */
export function riskLabel(locale: string | null | undefined, risk: string): string {
  const t = aliciaText(locale, `autonomy.risk.${risk}`);
  return t === `autonomy.risk.${risk}` ? risk : t.toLowerCase();
}

/** Resolves a hive agent id to a display name. Hosts pass one built from the
 *  hive registry; the default understands La Pitaya names and falls back to the id. */
export type AgentNameResolver = (agentId: string) => string | undefined;

export function displayAgent(agentId: string | undefined, locale: string | null | undefined, resolve?: AgentNameResolver): string {
  if (!agentId) return '';
  if (agentId === 'human') return aliciaLocale(locale) === 'es-MX' ? 'Tú' : 'You';
  const registryName = resolve?.(agentId);
  // Hive ids are "<name-slug>-<suffix>" (el-beni-munh8ii6); the La Pitaya roster
  // gives the locale spelling (José Juan / Jose Juan).
  const guess = registryName ?? agentId.replace(/-[a-z0-9]{4,}$/i, '').replace(/-/g, ' ');
  const known = agentByName(guess);
  if (known) return agentDisplayName(known.id, locale);
  return registryName ?? agentId;
}

export interface GovernanceExplanation {
  /** Localized sentence for the human. */
  text: string;
  /** The exact runtime detail the sentence explains — always present, never translated. */
  technical: Readonly<AliciaTechnical>;
}

const EXPLAINED = new Set([
  'HUMAN_APPROVAL_REQUIRED', 'SUPERVISED', 'APPROVED', 'HUMAN_APPROVED', 'HUMAN_REJECTED', 'DENY',
  'DECISION_GATE', 'EVIDENCE_FIRST', 'BUILDER_NOT_AUDITOR', 'AUDITOR_MODIFIED_CODE', 'TRANSITION',
  'DECISION_AUTHORITY', 'MALFORMED', 'ALLOW',
  // v0.4.1 intent boundary
  'NOT_AUTHORIZED', 'INTENT_INVALID', 'INTENT_TARGET', 'INTENT_MISMATCH', 'DELIVERY_FAILED', 'BOUNDARY_UNAVAILABLE',
  // v0.4.2 REQUEST execution gate
  'REQUEST_CONFIRMATION_REQUIRED', 'REQUEST_SCOPE_EXCEEDED', 'NOT_CONFIRMABLE', 'TAMPERED', 'STALE_PROPOSAL',
  'UNKNOWN_PROPOSAL', 'WRONG_CONTEXT', 'INVALID_CONFIRMATION'
]);

/** Decisions that explain themselves; their `rule` is classification detail
 *  (e.g. a toolRisk rule id), kept in `technical` rather than in the sentence. */
const SELF_EXPLAINING = new Set(['HUMAN_APPROVAL_REQUIRED', 'SUPERVISED', 'APPROVED', 'HUMAN_APPROVED', 'HUMAN_REJECTED', 'ALLOW']);

export function explanationKey(t: AliciaTechnical): string {
  if (t.rule && EXPLAINED.has(t.rule)) return t.rule;
  if (t.decision && SELF_EXPLAINING.has(t.decision)) return t.decision;
  // A refusal for a rule the catalog does not know: name it, never fall back to
  // a generic sentence that would hide the real reason.
  if (t.rule) return 'UNKNOWN';
  return t.decision && EXPLAINED.has(t.decision) ? t.decision : 'UNKNOWN';
}

/**
 * Translate a governance fact into human language. A known rule wins over the
 * decision (DENY + DECISION_GATE explains the gate), and an unknown rule is
 * named, not hidden.
 *
 *   explainGovernance({decision:'HUMAN_APPROVAL_REQUIRED', risk:'HIGH', rule:'AUTONOMY_POLICY'}, 'es-MX').text
 *   → "Esta acción requiere tu aprobación porque está clasificada como riesgo alto."
 */
export function explainGovernance(technical: AliciaTechnical, locale: string | null | undefined): GovernanceExplanation {
  const frozen = Object.freeze({ ...technical, ...(technical.violations ? { violations: Object.freeze([...technical.violations]) } : {}) });
  const vars = { riskLabel: technical.risk ? riskLabel(locale, technical.risk) : '', rule: technical.rule ?? technical.decision ?? '?' };
  return { text: aliciaText(locale, `alicia.explain.${explanationKey(technical)}`, vars), technical: frozen };
}
