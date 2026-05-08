import { useEffect, useState } from 'react'

/**
 * Tracks browser online/offline state. Reads `navigator.onLine` on
 * mount and subscribes to the global `online` / `offline` events.
 *
 * `navigator.onLine` is famously unreliable — it's true if there's a
 * link-layer connection, even when the gateway is down. For ZedExams'
 * use case (showing a "you're offline, work will sync" banner) the
 * false positives are acceptable: the banner disappears on the first
 * successful Firestore write or page navigation, so a brief misread
 * just briefly hides the banner.
 *
 * Used by <OfflineBanner />. Could also gate any future "send"
 * actions that should obviously fail offline.
 */
export function useNetworkStatus() {
  // Default to true on SSR / non-browser environments so we never
  // render the offline banner before we know.
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    function handleOnline() { setOnline(true) }
    function handleOffline() { setOnline(false) }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return online
}
