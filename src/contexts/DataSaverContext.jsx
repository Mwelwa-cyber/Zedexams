/**
 * DataSaverContext
 * ─────────────────────────────────────────────────
 * Provides a global toggle for "Data Saver Mode" — optimised for
 * learners in Zambia on limited mobile data.
 *
 * When ON:
 *   • Images are hidden or replaced with placeholders
 *   • CSS animations are disabled (class `ds-no-anim` added to body)
 *   • Heavy backgrounds (gradients, patterns) are simplified
 *   • Media auto-load is suppressed
 *
 * State is persisted to localStorage so the preference survives
 * a page refresh.
 */
import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'

const DataSaverContext = createContext({ dataSaver: false, toggleDataSaver: () => {} })

const LS_KEY = 'examprep:dataSaver'

export function DataSaverProvider({ children }) {
  const [dataSaver, setDataSaver] = useState(() => {
    try { return localStorage.getItem(LS_KEY) === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, String(dataSaver)) } catch { /* noop */ }
    // Add/remove body class so CSS can react globally
    document.body.classList.toggle('data-saver', dataSaver)
  }, [dataSaver])

  // Stable identity: the updater uses the functional form, so it closes over
  // nothing and never needs to be rebuilt.
  const toggleDataSaver = useCallback(() => setDataSaver(v => !v), [])

  // Memoised so a re-render of an ANCESTOR provider doesn't re-render every
  // data-saver consumer. main.jsx nests these providers
  // (Auth → Theme → DataSaver → PlatformSettings), so without this an auth
  // state change — sign-in, token refresh, profile reload — handed every
  // useDataSaver() consumer a brand-new object and re-rendered it, even though
  // the toggle itself changes maybe once in a session.
  const value = useMemo(
    () => ({ dataSaver, toggleDataSaver }),
    [dataSaver, toggleDataSaver],
  )

  return (
    <DataSaverContext.Provider value={value}>
      {children}
    </DataSaverContext.Provider>
  )
}

export function useDataSaver() {
  return useContext(DataSaverContext)
}
