/**
 * LanguageToggle — pick a UI language. Audit A7.
 *
 * Renders a small dropdown labelled "Language" with the supported
 * locales. Persistence + detection happens in src/i18n/index.js;
 * this component is just the presentation + change hook.
 *
 * Usage:
 *   <LanguageToggle compact />  // for the header / settings strip
 *   <LanguageToggle />          // labelled, for a settings page
 */

import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../../i18n'

export default function LanguageToggle({ compact = false, className = '' }) {
  const { i18n, t } = useTranslation()
  const current = i18n.resolvedLanguage || i18n.language || 'en'

  function handleChange(e) {
    const next = e.target.value
    if (next && next !== current) {
      i18n.changeLanguage(next).catch((err) => {
        console.warn('[LanguageToggle] changeLanguage failed', err)
      })
    }
  }

  return (
    <label className={`inline-flex items-center gap-2 ${className}`}>
      {!compact && (
        <span className="text-xs font-black theme-text-muted uppercase tracking-widest">
          {t('language.label', 'Language')}
        </span>
      )}
      <select
        value={current}
        onChange={handleChange}
        aria-label={t('language.label', 'Language')}
        className={`rounded-full border-2 theme-border theme-input text-xs font-bold py-1.5 pl-3 pr-8 ${compact ? '' : 'min-w-[8rem]'}`}
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nativeLabel}
          </option>
        ))}
      </select>
    </label>
  )
}
