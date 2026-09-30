/**
 * i18n bootstrap — react-i18next with inline JSON resources.
 *
 * La Pitaya: Spanish (es-MX) is the default UI language and English (en-US) is
 * the technical fallback for any missing key. The user's choice is persisted in
 * localStorage (`cth.language`). With nothing saved the app starts in es-MX,
 * ALWAYS — it deliberately does not read navigator.language, so the language
 * never changes on its own; it moves only when someone picks one in Settings.
 * The upstream code `en` is migrated to `en-US` on read.
 *
 * The UI language is only one of three locale settings — see
 * @shared/lapitaya/locales.ts. agentLocale and notificationLocale are stored
 * separately below and never follow the UI language implicitly.
 *
 * Adding a language: drop a `locales/<code>.json` with the exact same key
 * tree as `en.json`, register it in `resources` and `supportedLngs`, and add
 * an entry to `LANGUAGES` (Settings → General exposes the picker from that
 * list). Give it `dir: 'rtl'` if it is a right-to-left script. No other code
 * needs to change.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_GOD_NAME } from '@shared/godIdentity';
import { DEFAULT_LOCALE_SETTINGS, FALLBACK_LOCALE, canonicalLocale, resolveLocaleSettings, type LocaleSettings } from '@shared/lapitaya/locales';
import esMX from './locales/es-MX.json';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import ar from './locales/ar.json';
// La Pitaya's own strings (roles, CIMA phases, locale settings) live in a
// separate `lapitaya` namespace. Only es-MX and en-US ship it; every other
// locale falls back to en-US for this namespace alone.
import lapitayaEsMX from './locales/lapitaya/es-MX.json';
import lapitayaEnUS from './locales/lapitaya/en-US.json';

/**
 * The languages the Settings picker offers, in display order.
 *
 * `dir` is the language's WRITING DIRECTION, and it is the ONLY thing the app
 * keys right-to-left layout off. Not the OS locale, not the content of a
 * document, not a system font — the language the user picked here, and nothing
 * else. That is what makes RTL inert for everybody who has not picked an RTL
 * language: `dir` is 'ltr' for every one of them, so every `isRtl` branch in
 * the renderer takes the same path it took before Arabic existed.
 */
export const LANGUAGES = [
  { code: 'es-MX', label: 'Español (México)', dir: 'ltr' },
  { code: 'en-US', label: 'English (US)', dir: 'ltr' },
  { code: 'zh-CN', label: '简体中文', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' }
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

/** Language codes that read right-to-left, derived from LANGUAGES itself so a
 *  new locale cannot be registered with a direction and then forgotten here. */
const RTL_CODES: ReadonlySet<string> = new Set(
  LANGUAGES.filter((l) => l.dir === 'rtl').map((l) => l.code)
);

/**
 * Does this language code read right-to-left?
 *
 * Deliberately EXACT-MATCH on a registered code rather than a prefix or a
 * script guess. An unknown code is left-to-right, which is the direction every
 * user had before this shipped — an unrecognised value must never be able to
 * mirror somebody's UI.
 */
export function isRtlLanguage(lng: string | undefined | null): boolean {
  return !!lng && RTL_CODES.has(lng);
}

/** `'rtl'` or `'ltr'` for a language code, for a `dir` attribute. */
export function directionFor(lng: string | undefined | null): 'rtl' | 'ltr' {
  return isRtlLanguage(lng) ? 'rtl' : 'ltr';
}

const STORAGE_KEY = 'cth.language';

const SUPPORTED: readonly string[] = LANGUAGES.map((l) => l.code);

/**
 * The orchestrator's display name, for every string that talks about it.
 *
 * The user can rename the god, and roughly forty strings mention it. Baking
 * "Michael" into the locale files would silently undo that rename everywhere at
 * once — a bug this codebase has already fixed three times in the spawn path.
 * So the locales say `{{godName}}` and the live name is supplied here as an
 * i18next DEFAULT VARIABLE, which means no call site has to pass it. A call site
 * that needs a variant (an upper-cased title, say) still overrides it by passing
 * `godName` explicitly.
 */
export function setGodName(name: string | undefined | null): void {
  const next = name?.trim() || DEFAULT_GOD_NAME;
  const interpolation = i18n.options.interpolation ?? (i18n.options.interpolation = {});
  const vars = interpolation.defaultVariables ?? (interpolation.defaultVariables = {});
  if (vars.godName === next) return;
  vars.godName = next;
  // react-i18next re-renders on this event. Without it a rename would only
  // reach strings that happened to re-render for some other reason.
  i18n.emit('languageChanged', i18n.language);
}

/** The saved choice, or es-MX. Never the OS locale — see the note above.
 *  A legacy upstream value (`en`) is read as its La Pitaya code (`en-US`). */
function detectLanguage(): string {
  try {
    const saved = canonicalLocale(window.localStorage.getItem(STORAGE_KEY));
    if (saved && SUPPORTED.includes(saved as LanguageCode)) return saved;
  } catch { /* localStorage unavailable — the default it is */ }
  return DEFAULT_LOCALE_SETTINGS.uiLocale;
}

/** Switch language now and persist the choice for next launch. */
export function setLanguage(lng: string): void {
  void i18n.changeLanguage(lng);
  try { window.localStorage.setItem(STORAGE_KEY, lng); } catch { /* best-effort */ }
}

// --- agentLocale / notificationLocale -----------------------------------------
// Stored independently of the UI language (see @shared/lapitaya/locales.ts).

const AGENT_LOCALE_KEY = 'lapitaya.agentLocale';
const NOTIFICATION_LOCALE_KEY = 'lapitaya.notificationLocale';

function readKey(key: string): string | undefined {
  try { return window.localStorage.getItem(key) ?? undefined; } catch { return undefined; }
}

/** The three locale settings in effect right now. */
export function getLocaleSettings(): LocaleSettings {
  return resolveLocaleSettings({
    uiLocale: i18n.language,
    agentLocale: readKey(AGENT_LOCALE_KEY),
    notificationLocale: readKey(NOTIFICATION_LOCALE_KEY)
  });
}

export function setAgentLocale(code: string): void {
  try { window.localStorage.setItem(AGENT_LOCALE_KEY, code); } catch { /* best-effort */ }
}

export function setNotificationLocale(code: string): void {
  try { window.localStorage.setItem(NOTIFICATION_LOCALE_KEY, code); } catch { /* best-effort */ }
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      'es-MX': { translation: esMX, lapitaya: lapitayaEsMX },
      'en-US': { translation: en, lapitaya: lapitayaEnUS },
      'zh-CN': { translation: zhCN },
      ar: { translation: ar }
    },
    lng: detectLanguage(),
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: ['es-MX', 'en-US', 'zh-CN', 'ar'],
    ns: ['translation', 'lapitaya'],
    defaultNS: 'translation',
    // Resources are bundled inline, so nothing ever suspends — the string is
    // there at init time. Keeping this false lets every component call
    // useTranslation() without wrapping the tree in <Suspense>.
    react: { useSuspense: false },
    // `defaultVariables` is what lets every {{godName}} string resolve without
    // its call site knowing god's name. setGodName() keeps it current.
    interpolation: { escapeValue: false, defaultVariables: { godName: DEFAULT_GOD_NAME } },
    returnNull: false
  });

export default i18n;
