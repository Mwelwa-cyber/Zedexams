import { useCallback, useEffect, useRef } from 'react'

// Shared key so every tab in the same origin observes the same activity stream.
const STORAGE_KEY = 'zedexams_last_activity'
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'mousemove', 'scroll']
// Throttle so a moving mouse doesn't write to localStorage on every pixel.
const THROTTLE_MS = 1000

/**
 * Auto-logout after `idleMs` of no user activity, with a `warnMs` countdown
 * preceding it. Activity in any tab of the same origin counts (via the
 * `storage` event) so a user typing in tab B doesn't get logged out of tab A.
 *
 * Callbacks do not need to be memoized — they're stashed in a ref so the
 * effect only re-runs when `enabled` / `idleMs` / `warnMs` change.
 */
export function useIdleTimeout({
  enabled,
  idleMs,
  warnMs,
  onWarn,
  onTick,
  onTimeout,
  onResumeActivity,
}) {
  const cbRef = useRef({ onWarn, onTick, onTimeout, onResumeActivity })
  cbRef.current = { onWarn, onTick, onTimeout, onResumeActivity }

  const stayActiveRef = useRef(() => {})

  useEffect(() => {
    if (!enabled) return undefined

    let warnTimer = null
    let logoutTimer = null
    let tickTimer = null
    let inWarning = false
    let lastBroadcast = 0
    let cancelled = false

    const clearTimers = () => {
      if (warnTimer) { clearTimeout(warnTimer); warnTimer = null }
      if (logoutTimer) { clearTimeout(logoutTimer); logoutTimer = null }
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
    }

    const schedule = (fromTs) => {
      clearTimers()
      if (cancelled) return
      const elapsed = Math.max(0, Date.now() - fromTs)
      const warnInMs = Math.max(0, idleMs - warnMs - elapsed)
      const logoutInMs = Math.max(0, idleMs - elapsed)

      warnTimer = setTimeout(() => {
        inWarning = true
        let secondsLeft = Math.ceil(warnMs / 1000)
        cbRef.current.onWarn?.(secondsLeft)
        tickTimer = setInterval(() => {
          secondsLeft -= 1
          if (secondsLeft >= 0) cbRef.current.onTick?.(secondsLeft)
        }, 1000)
      }, warnInMs)

      logoutTimer = setTimeout(() => {
        clearTimers()
        inWarning = false
        cbRef.current.onTimeout?.()
      }, logoutInMs)
    }

    const reset = (ts, { broadcast }) => {
      if (inWarning) {
        inWarning = false
        cbRef.current.onResumeActivity?.()
      }
      if (broadcast) {
        try { localStorage.setItem(STORAGE_KEY, String(ts)) } catch (_e) { /* quota / private mode */ }
      }
      schedule(ts)
    }

    // On mount, honour the most recent activity timestamp from any tab so
    // refreshing the page mid-session doesn't reset the user's idle window.
    let initialTs = Date.now()
    try {
      const stored = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10)
      if (Number.isFinite(stored) && stored > 0) {
        const age = Date.now() - stored
        if (age >= 0 && age < idleMs) initialTs = stored
      }
    } catch (_e) { /* ignore */ }
    try { localStorage.setItem(STORAGE_KEY, String(initialTs)) } catch (_e) { /* ignore */ }
    schedule(initialTs)

    const handleActivity = () => {
      const now = Date.now()
      if (now - lastBroadcast < THROTTLE_MS) return
      lastBroadcast = now
      reset(now, { broadcast: true })
    }

    const handleStorage = (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      const ts = parseInt(e.newValue, 10)
      if (!Number.isFinite(ts)) return
      reset(ts, { broadcast: false })
    }

    ACTIVITY_EVENTS.forEach(ev =>
      window.addEventListener(ev, handleActivity, { passive: true })
    )
    window.addEventListener('storage', handleStorage)

    stayActiveRef.current = () => reset(Date.now(), { broadcast: true })

    return () => {
      cancelled = true
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, handleActivity))
      window.removeEventListener('storage', handleStorage)
      clearTimers()
      stayActiveRef.current = () => {}
    }
  }, [enabled, idleMs, warnMs])

  const stayActive = useCallback(() => stayActiveRef.current(), [])
  return { stayActive }
}
