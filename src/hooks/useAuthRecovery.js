import { useEffect, useRef } from 'react'
import { REFRESH_THROTTLE_MS, shouldExpireSession } from './authRecoveryPolicy'
import { attestationDegraded } from '../firebase/appCheckResilient'

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
 * its `onSnapshot` listeners can fail silently. Forcing a refresh on resume,
 * then re-attaching the listener, is the cheap reliable fix. This matters
 * most for mobile / PWA users on flaky networks who leave the app open in the
 * background for long stretches.
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
        // Token is fresh again — ask the caller to re-attach any Firestore
        // listeners that may have gone silent while the tab was asleep.
        cbRef.current.onResubscribe?.()
      } catch (e) {
        if (cancelled) return
        const code = e?.code || ''
        console.warn('[auth-recovery] token refresh failed', {
          trigger,
          code,
          online: typeof navigator !== 'undefined' ? navigator.onLine : 'n/a',
        })
        const online = typeof navigator !== 'undefined' ? navigator.onLine : true
        // A placeholder App Check token fails this refresh for a reason that
        // is not the credential. See shouldExpireSession.
        if (shouldExpireSession(code, online, {
          attestationDegraded: attestationDegraded(),
        })) {
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
      // but the existing token is fresh — the throttle absorbs the duplicate.
      refresh(e?.persisted ? 'pageshow-bfcache' : 'pageshow')
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
