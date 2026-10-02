/**
 * La Pitaya locale model.
 *
 * Three INDEPENDENT locale settings, because the three audiences differ:
 *
 *   uiLocale           — the language of the app's own interface (i18next).
 *   agentLocale        — the language La Pitaya asks its agents to write in.
 *                        Agents often work best in English even when the human
 *                        reads Spanish, so this is never derived from uiLocale.
 *   notificationLocale — the language of toasts / OS notifications / Alicia's
 *                        future summaries.
 *
 * Evidence is never localized: logs, stack traces, CLI/test/git output, API
 * responses, code and file paths are shown exactly as produced. A locale only
 * changes the words La Pitaya itself writes AROUND that evidence.
 *
 * Pure data + functions, no DOM, so main, renderer and tests share it.
 */

/** Locales with a full translation today. `es-MX` is the product default. */
export const ACTIVE_LOCALES = ['es-MX', 'en-US'] as const;
/** Locales the architecture is ready for but that are not translated yet.
 *  Adding one = a locales/<code>.json + an entry in i18n/index.ts LANGUAGES. */
export const PLANNED_LOCALES = ['pt-BR', 'fr-FR', 'de-DE', 'ja-JP', 'zh-CN'] as const;

export type ActiveLocale = (typeof ACTIVE_LOCALES)[number];
export type PlannedLocale = (typeof PLANNED_LOCALES)[number];
export type LaPitayaLocale = ActiveLocale | PlannedLocale;

export const DEFAULT_LOCALE: ActiveLocale = 'es-MX';
/** Technical fallback: any key or name missing in a locale resolves here. */
export const FALLBACK_LOCALE: ActiveLocale = 'en-US';

export interface LocaleSettings {
  uiLocale: string;
  agentLocale: string;
  notificationLocale: string;
}

export const DEFAULT_LOCALE_SETTINGS: Readonly<LocaleSettings> = Object.freeze({
  uiLocale: DEFAULT_LOCALE,
  // Agents default to English: it is the language their CLIs, tools and most
  // training data use. The human can switch it independently.
  agentLocale: FALLBACK_LOCALE,
  notificationLocale: DEFAULT_LOCALE
});

/** Legacy codes written by the upstream app, mapped onto La Pitaya's codes. */
const LEGACY_ALIASES: Readonly<Record<string, string>> = { en: 'en-US', es: 'es-MX' };

/** Normalize a stored/requested code: legacy alias → canonical, else as-is. */
export function canonicalLocale(code: string | null | undefined): string | null {
  const c = code?.trim();
  if (!c) return null;
  return LEGACY_ALIASES[c] ?? c;
}

/** Fill any missing/blank field of a partial settings object with defaults.
 *  Each field is resolved on its own — one never inherits another. */
export function resolveLocaleSettings(partial: Partial<LocaleSettings> | null | undefined): LocaleSettings {
  return {
    uiLocale: canonicalLocale(partial?.uiLocale) ?? DEFAULT_LOCALE_SETTINGS.uiLocale,
    agentLocale: canonicalLocale(partial?.agentLocale) ?? DEFAULT_LOCALE_SETTINGS.agentLocale,
    notificationLocale: canonicalLocale(partial?.notificationLocale) ?? DEFAULT_LOCALE_SETTINGS.notificationLocale
  };
}

/** True for any English locale — used for the "no accents in English" rule. */
export function isEnglish(code: string | null | undefined): boolean {
  return !!code && /^en(-|$)/i.test(code);
}

/** True for any Spanish locale. */
export function isSpanish(code: string | null | undefined): boolean {
  return !!code && /^es(-|$)/i.test(code);
}

/** Strip diacritics (Valentín → Valentin, José → Jose, Tutú → Tutu). Used for
 *  en-US, where a name has an exact ASCII spelling. */
export function toAscii(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
