import { useEffect, useState } from 'react'

/**
 * Sticky-top banner that appears whenever the browser reports the connection
 * is offline, and disappears once it returns. Auto-recovery is the goal —
 * Firestore + the auth recovery hook will reattach themselves on `online`,
 * the banner just gives the user a clear explanation while it does.
 *
 * Reuses existing theme tokens (no new dependencies, no design changes).
 */
export default function NetworkBanner() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  )

  useEffect(() => {
    const goOnline  = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[1000] px-4 py-2 text-center text-body-sm font-bold text-danger bg-danger-subtle border-b"
      style={{ borderColor: 'var(--danger-fg)' }}
    >
      Connection lost. Please check your internet and try again.
    </div>
  )
}
