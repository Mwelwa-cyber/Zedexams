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
  defaultTheme: 'oatmeal',
  featureFlags: {},
  // Android in-app update nudge — see AndroidUpdateBanner.jsx.
  androidLatestBuild: 0,
  androidApkUrl: '',
  androidUpdateMessage: '',
}

/**
 * `live` — is this still a LIVE read of settings/global, or the last thing we
 * heard before the subscription died?
 *
 * Firestore does not resume a listener after it calls `onError`. The provider
 * used to warn, set `loaded = true`, and leave the last settings in place — so
 * a client whose subscription died after one successful snapshot kept that
 * snapshot **indefinitely**, and an admin toggle could no longer reach it until
 * the page reloaded. For most settings that is the right behaviour: the last
 * known `siteName` beats reverting to a default over a transient error. For a
 * FEATURE FLAG it is the opposite, because a flag's whole safety argument is
 * that flipping it off reverts every client within seconds.
 *
 * So the state is reported rather than acted on here, and each consumer decides.
 * `useAssessmentEngineFlag` fails closed on `live === false`; a consumer reading
 * `supportEmail` can ignore it entirely.
 *
 * Deliberately NOT a resubscribe-with-backoff: the errors that reach `onError`
 * are terminal (permission, precondition), and retrying them is a storm rather
 * than a recovery. Reload is the recovery.
 */
const PlatformSettingsContext = createContext({ settings: DEFAULTS, loaded: false, live: true })

export function usePlatformSettings() {
  return useContext(PlatformSettingsContext)
}

export function PlatformSettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS)
  const [loaded, setLoaded] = useState(false)
  // Starts true: before the first snapshot nothing has failed, and `loaded`
  // already says the value is not yet known.
  const [live, setLive] = useState(true)

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
        setLive(true)
      },
      err => {
        console.warn('settings/global subscription failed:', err)
        setLoaded(true)
        // The settings themselves are KEPT. What changes is the claim we make
        // about them: they are the last thing we heard, not the current value.
        setLive(false)
      },
    )
    return () => unsub()
  }, [])

  return (
    <PlatformSettingsContext.Provider value={{ settings, loaded, live }}>
      {children}
    </PlatformSettingsContext.Provider>
  )
}
