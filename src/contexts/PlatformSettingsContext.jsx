import { createContext, useContext, useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'

const DEFAULTS = {
  siteName: 'ZedExams',
  supportEmail: 'support@zedexams.com',
  maintenanceMode: false,
  maintenanceMessage: 'We are doing some quick maintenance. Please check back shortly.',
  registrationOpen: true,
  maxExamAttemptsPerDay: 3,
  defaultGrade: '7',
  defaultTheme: 'sky',
  featureFlags: {},
}

const PlatformSettingsContext = createContext({ settings: DEFAULTS, loaded: false })

export function usePlatformSettings() {
  return useContext(PlatformSettingsContext)
}

export function PlatformSettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'global'),
      snap => {
        if (snap.exists()) {
          setSettings({ ...DEFAULTS, ...snap.data() })
        } else {
          setSettings(DEFAULTS)
        }
        setLoaded(true)
      },
      err => {
        console.warn('settings/global subscription failed:', err)
        setLoaded(true)
      },
    )
    return () => unsub()
  }, [])

  // Reflect site name in the tab title so admins see a rename instantly.
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = settings.siteName ? `${settings.siteName}` : 'ZedExams'
  }, [settings.siteName])

  return (
    <PlatformSettingsContext.Provider value={{ settings, loaded }}>
      {children}
    </PlatformSettingsContext.Provider>
  )
}
