import { createContext, useContext, useEffect, useState } from 'react'

const LS_KEY = 'examprep:theme'

export const THEMES = [
  { id: 'light',    label: 'Light Soft',  swatch: '#F8FAFC' },
  { id: 'warm',     label: 'Warm Cream',  swatch: '#FDF6EC' },
  { id: 'sky',      label: 'Sky Blue',    swatch: '#EFF6FF' },
  { id: 'lavender', label: 'Lavender',    swatch: '#F5F3FF' },
  { id: 'dark',     label: 'Midnight',    swatch: '#0F172A' },
]

const ThemeContext = createContext(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem(LS_KEY) || 'light' } catch { return 'light' }
  })

  function setTheme(id) {
    setThemeState(id)
    try { localStorage.setItem(LS_KEY, id) } catch { }
  }

  useEffect(() => {
    const body = document.body
    THEMES.forEach(t => body.classList.remove(`theme-${t.id}`))
    body.classList.add(`theme-${theme}`)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}
