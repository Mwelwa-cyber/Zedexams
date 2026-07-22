import { useCallback, useState } from 'react'

const STORAGE_KEY = 'zedexams:tdv2-theme'

/**
 * Light/dark theme for the V2 dashboard surfaces, toggled from the account
 * menu and persisted per device. Deliberately independent of the app-wide
 * ThemeContext: the V2 design system is brand-fixed (navy/teal/cream/copper)
 * and offers exactly two calibrated variants, while ThemeContext's learner
 * themes restyle the rest of the app.
 */
export default function useDashboardTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch { /* storage unavailable — theme still applies for the session */ }
      return next
    })
  }, [])

  return { theme, dark: theme === 'dark', toggleTheme }
}
