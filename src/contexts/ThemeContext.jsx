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

const ThemeContext = createContext(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try { return normalizeThemeId(localStorage.getItem(LS_KEY)) } catch { return DEFAULT_THEME }
  })

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
