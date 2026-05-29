import { useEffect, useRef } from 'react'

// Minimum gap between forced token refreshes. A `visibilitychange` and a
// `pageshow` can fire together when iOS restores from bfcache, and `online`
// often follows immediately after wake — we only want one network round-trip.
const REFRESH_THROTTLE_MS = 30_000

// Firebase auth error codes that mean "this session is gone, send the user
// back to login". `network-request-failed` is intentionally NOT here: an
// offline tab will recover when the radio comes back, no need to log out.
const TERMINAL_AUTH_ERRORS = new Set([
  'auth/user-token-expired',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/user-disabled',
  'auth/user-not-found',
  'auth/invalid-user-token',
  'auth/requires-recent-login',
])

/**
 * Re-validates the Firebase session whenever the tab/app comes back to life.
 *
 * Listens to `visibilitychange`, `pageshow`, and `online`. When any fires
 * with a current user, forces an ID-token refresh. On success, asks the
 * caller to re-establish dropped Firestore listeners. On terminal auth
 * failure, asks the caller to expire the session and redirect to login.
 *
 * The browser auto-refreshes ID tokens *while the tab is in the foreground*,
 * but a tab that's been backgrounded for hours misses those refreshes — and
 * its `onSnapshot` listeners can fail silently. Forcing a refresh on resume
 * is the cheap reliable fix.
 *
 * Callbacks are stashed in a ref so the effect doesn't re-run on every
 * render; only `currentUser` and `enabled` change re-arm the listeners.
 */
export function useAuthRecovery({
  currentUser,
  enabled = true,
  onResubscribe,
  onSessionExpired,
}) {
  const cbRef = useRef({ onResubscribe, onSessionExpired })
  cbRef.current = { onResubscribe, onSessionExpired }

  useEffect(() => {
    if (!enabled || !currentUser) return undefined

    let cancelled = false
    let lastRefreshAt = 0

    const refresh = async (trigger) => {
      const now = Date.now()
      if (now - lastRefreshAt < REFRESH_THROTTLE_MS) return
      lastRefreshAt = now

      try {
        await currentUser.getIdToken(true)
        if (cancelled) return
        console.info('[auth-recovery] token refreshed', {
          trigger,
          uid: currentUser.uid,
        })
        cbRef.current.onResubscribe?.()
      } catch (e) {
        if (cancelled) return
        const code = e?.code || ''
        console.warn('[auth-recovery] token refresh failed', {
          trigger,
          code,
          message: e?.message,
          online: typeof navigator !== 'undefined' ? navigator.onLine : 'n/a',
        })
        // Offline at wake: the network listener will retry once the radio
        // comes back. Don't sign the user out for a transient blip.
        if (code === 'auth/network-request-failed') return
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return
        if (TERMINAL_AUTH_ERRORS.has(code) || code.startsWith('auth/')) {
          cbRef.current.onSessionExpired?.(code || 'token-refresh-failed')
        }
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh('visibility')
    }
    const onPageShow = (e) => {
      // `persisted` is true when the page is restored from bfcache (iOS
      // Safari, Firefox). Plain forward/back navigations also fire pageshow
      // but the existing token is fresh — throttle handles the duplicate.
      if (e?.persisted) refresh('pageshow-bfcache')
      else refresh('pageshow')
    }
    const onOnline = () => refresh('online')

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
    }
  }, [currentUser, enabled])
}
