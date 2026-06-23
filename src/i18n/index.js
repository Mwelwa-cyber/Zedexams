/**
 * i18n bootstrap (audit A7 — multilingual UI).
 *
 * Adds the localisation scaffold so a learner-facing string can move
 * from `<p>Welcome</p>` to `<p>{t('dashboard.welcome')}</p>`. The
 * actual Zambian-language translations need a native speaker — this
 * file just wires up the runtime and ships empty placeholders the
 * team can fill once translations are signed off.
 *
 * Languages on the runway:
 *   - en (English) — baseline, hand-authored.
 *   - ny (Nyanja) — Lusaka-area lingua franca; placeholder file ships
 *     empty so untranslated keys fall back to English instead of
 *     showing weird half-Nyanja strings I'd otherwise guess.
 *
 * Persistence:
 *   - `i18next-browser-languagedetector` reads `localStorage.i18nLng`
 *     first, then falls back to `<html lang>`, then English.
 *   - Saved back to localStorage on every changeLanguage call.
 *
 * Adding a new locale (for the team picking this up):
 *   1. Pick the BCP-47 tag (Bemba: 'bem', Tonga: 'toi', Lozi: 'loz').
 *   2. Mirror the English file structure under
 *      `src/i18n/locales/{tag}/{namespace}.json`.
 *   3. Register the tag in `ALL_LANGUAGES` below with `ready: false` until a
 *      Zambian native speaker signs off; flip `ready: true` to expose it.
 *   4. The language toggle picks up every `ready` locale automatically.
 */

import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import enCommon from './locales/en/common.json'
import enDashboard from './locales/en/dashboard.json'
import nyCommon from './locales/ny/common.json'
import nyDashboard from './locales/ny/dashboard.json'

// Every locale the runtime knows about, including ones still in progress.
// Used to register i18next resources + supportedLngs so a half-finished locale
// still resolves (falling back to English) for anyone who had it selected.
const ALL_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English', ready: true },
  // Nyanja is now production-visible. Incomplete keys still degrade to English
  // via returnEmptyString=false and fallbackLng='en' until translations fill out.
  { code: 'ny', label: 'Nyanja', nativeLabel: 'Chinyanja', ready: true },
]

// User-facing languages — only locales cleared for production appear in the
// LanguageToggle.
export const SUPPORTED_LANGUAGES = ALL_LANGUAGES.filter((l) => l.ready)

export const DEFAULT_LANGUAGE = 'en'

// `react-i18next` uses dot-paths within a namespace by default, so
// the JSON files can stay nested without adding a custom key separator.
i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon, dashboard: enDashboard },
      ny: { common: nyCommon, dashboard: nyDashboard },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: ALL_LANGUAGES.map((l) => l.code),
    // Treat an empty string in a locale file as "not translated yet" so it
    // falls back to English instead of rendering blank. i18next defaults this
    // to `true` (empty string counts as a valid translation), which would
    // silently break the contract the per-file `_TODO` notes promise
    // translators — "Empty values fall back to English". With `false`, a
    // partially-translated locale (real strings for some keys, "" for the
    // rest) degrades to English per-key instead of showing gaps.
    returnEmptyString: false,
    defaultNS: 'common',
    ns: ['common', 'dashboard'],
    interpolation: {
      // React already escapes; let i18next pass through so
      // `{name}` placeholders work cleanly.
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'htmlTag', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nLng',
    },
    react: {
      // Re-render on language change so a single toggle flips the UI
      // without a hard reload.
      bindI18n: 'languageChanged',
      useSuspense: false,
    },
  })

export default i18next
