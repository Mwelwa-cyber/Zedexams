import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useSessionRestoration — derives the session-restoration STAGE from the real
 * auth/profile flow and owns the timeout + offline + retry mechanics for
 * <SessionRestorationScreen>. Deliberately UI-free so it unit-tests cleanly and
 * so the screen stays purely presentational.
 *
 * Stage is derived from real signals — never a timer alone:
 *   - no user yet .................... 'restoring-auth'  (Firebase restoring session)
 *   - user resolved, profile pending . 'loading-profile' (auth done; fetching profile)
 *   - user + profile both present .... 'loading-dashboard' (about to reveal the app)
 *   - a profile read failed .......... 'error'
 *   - browser offline ................ 'offline'  (wins over the above)
 *   - still working past timeoutMs ... 'timeout'
 *
 * We never advance to 'loading-profile' before a valid user exists, nor to
 * 'loading-dashboard' before the profile has resolved.
 *
 * @param {object}   p
 * @param {object?}  p.currentUser   Firebase user, or null while unresolved/signed-out.
 * @param {object?}  p.userProfile   Firestore profile, or null while pending.
 * @param {string?}  p.profileIssue  'missing' | 'unreadable' | null.
 * @param {Function} p.retry         async () => void — re-runs restoration. In-flight-guarded here.
 * @param {number}  [p.timeoutMs=10000]
 * @param {string?} [p.forcedStage]  Override the derived working-stage (e.g. 'loading-dashboard').
 */
export function useSessionRestoration({
  currentUser,
  userProfile,
  profileIssue = null,
  retry,
  timeoutMs = 10_000,
  forcedStage = null,
}) {
  const initialOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false
  const [isOffline, setIsOffline] = useState(!initialOnline)
  const [timedOut, setTimedOut] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState(null)

  // Guards against double-fires: a retry already in flight, and state writes
  // after unmount (a slow retry resolving into a torn-down component).
  const retryInFlightRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Derive the "working" stage from real auth signals.
  let workingStage
  if (currentUser && userProfile) workingStage = 'loading-dashboard'
  else if (currentUser) workingStage = 'loading-profile'
  else workingStage = 'restoring-auth'
  if (forcedStage) workingStage = forcedStage

  // Terminal precedence: offline > profile error > timeout > working stage.
  let stage
  if (isOffline) stage = 'offline'
  else if (profileIssue) stage = 'error'
  else if (timedOut) stage = 'timeout'
  else stage = workingStage

  // ── Timeout watchdog ──────────────────────────────────────────────────
  // Arm only while genuinely still working (not once we're already terminal),
  // and re-arm whenever the working stage advances so real progress resets it.
  useEffect(() => {
    if (isOffline || profileIssue) return undefined
    setTimedOut(false)
    const t = setTimeout(() => {
      if (mountedRef.current) setTimedOut(true)
    }, timeoutMs)
    return () => clearTimeout(t)
  }, [workingStage, isOffline, profileIssue, timeoutMs])

  // ── Retry ─────────────────────────────────────────────────────────────
  const runRetry = useCallback(async ({ auto = false } = {}) => {
    // Prevent multiple simultaneous retry requests.
    if (retryInFlightRef.current) return
    // Never hammer Firebase while the browser reports itself offline; an
    // auto-retry on the `online` event is the intended exception.
    if (!auto && typeof navigator !== 'undefined' && navigator.onLine === false) {
      setIsOffline(true)
      return
    }
    retryInFlightRef.current = true
    if (mountedRef.current) {
      setRetrying(true)
      setError(null)
      setTimedOut(false) // reset the timeout so the watchdog re-arms
    }
    try {
      await retry?.()
    } catch (e) {
      if (mountedRef.current) setError(e?.code || e?.message || 'retry-failed')
      // A dev-only breadcrumb; never logs tokens/PII (retry throws are auth codes).
      if (import.meta.env.DEV) console.warn('[session-restoration] retry failed:', e)
    } finally {
      // Safe despite the await: the guard sets this true synchronously at entry,
      // so any concurrent call already bailed before reaching here.
      // eslint-disable-next-line require-atomic-updates
      retryInFlightRef.current = false
      if (mountedRef.current) setRetrying(false)
    }
  }, [retry])

  const onRetry = useCallback(() => { void runRetry({ auto: false }) }, [runRetry])

  // ── Online / offline listeners ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onOffline = () => { if (mountedRef.current) setIsOffline(true) }
    const onOnline = () => {
      if (!mountedRef.current) return
      setIsOffline(false)
      // Connection restored: retry exactly once (guarded), rather than an
      // endless auto-retry loop. Clearing timedOut lets the watchdog re-arm.
      setTimedOut(false)
      void runRetry({ auto: true })
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [runRetry])

  return { stage, error, retrying, isOffline, timedOut, onRetry }
}
