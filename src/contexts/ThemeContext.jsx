import { createContext, useContext, useEffect, useState } from 'react'

const LS_KEY = 'examprep:theme'

export const THEMES = [
  { id: 'sky',      label: 'Sky Blue',      swatch: '#0EA5E9' },
  { id: 'lavender', label: 'Lavender',      swatch: '#8B5CF6' },
  { id: 'midnight', label: 'Midnight Tech', swatch: '#1E293B' },
  { id: 'oatmeal',  label: 'Warm Oatmeal',  swatch: '#D97706' },
  { id: 'solar',    label: 'Solar Yellow',  swatch: '#F59E0B' },
]

const DEFAULT_THEME = 'sky'
const LEGACY_THEME_MAP = {
  light: 'sky',
  warm: 'oatmeal',
  dark: 'midnight',
}
const THEME_IDS = THEMES.map(t => t.id)
const THEME_CLASS_IDS = [...THEME_IDS, ...Object.keys(LEGACY_THEME_MAP)]

function normalizeThemeId(id) {
  const next = LEGACY_THEME_MAP[id] || id
  return THEME_IDS.includes(next) ? next : DEFAULT_THEME
}

/**
 * Resolve the initial theme for a brand-new visitor.
 * - If they've saved a choice → use that.
 * - Otherwise → Sky (the light default).
 *
 * We intentionally do NOT read `prefers-color-scheme` here. The site's
 * content (including the quiz editor, rich-text areas, tables, and native
 * form controls) is designed for a light palette, and honouring the OS
 * dark preference would auto-flip visitors into Midnight — which many
 * users flagged as "a bit too dark" because not every surface is fully
 * dark-theme-ready yet. Users who want Midnight can still pick it from
 * the theme switcher and the choice persists via localStorage.
 */
function resolveInitialTheme() {
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) return normalizeThemeId(saved)
  } catch { /* localStorage unavailable — fall through */ }
  return DEFAULT_THEME
}

const ThemeContext = createContext(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(resolveInitialTheme)

  function setTheme(id) {
    const next = normalizeThemeId(id)
    setThemeState(next)
    try { localStorage.setItem(LS_KEY, next) } catch { }
  }

  useEffect(() => {
    const body = document.body
    THEME_CLASS_IDS.forEach(id => body.classList.remove(`theme-${id}`))
    body.classList.add(`theme-${theme}`)
    try { localStorage.setItem(LS_KEY, theme) } catch { }
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}
