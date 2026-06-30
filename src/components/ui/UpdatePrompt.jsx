import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePwaUpdate } from '../../hooks/usePwaUpdate'
import { pwaReloadOnNavigate } from '../../hooks/pwaAutoReload'
import { isCriticalWorkInFlight, subscribeCriticalWork } from '../../utils/criticalWork'
import Icon from './Icon'
import { RefreshCw, XMarkIcon } from './icons'

/**
 * UpdatePrompt — surfaces a new service-worker build to the user (audit A1.2).
 *
 * The PWA SW uses `registerType: 'autoUpdate'` (vite.config.js): a new build's
 * SW activates + claims clients automatically, and public/sw-reload-clients.js
 * posts SW_RELOAD_REQUEST so usePwaUpdate flips `updateReady`. We deliberately
 * do NOT hard-reload the instant that happens — a reload mid-operation (e.g. a
 * 15-30 s document import) would destroy the work. So crossover happens two
 * ways, both at safe moments:
 *   1. Auto: on the user's NEXT in-app navigation (a route teardown point) —
 *      see the pwaReloadOnNavigate effect below. This reaches returning users
 *      without any tap. Long-running ops don't navigate, so they're safe.
 *   2. Manual: this toast ("Refresh now") for users who stay on one screen.
 *
 * The toast is dismissible — "Later" hides it for the session (and also opts
 * out of the auto-reload, since updateReady goes false); the next deploy
 * re-shows it.
 *
 * Mounted inside <App /> so it renders on every route, but inert (returns
 * null) until updateReady flips. Capacitor users never see this — the hook
 * short-circuits to no-op on native.
 */
export default function UpdatePrompt() {
  const { updateReady, update, dismiss } = usePwaUpdate()
  const location = useLocation()

  // Latest update() in a ref so the navigation effect never closes over a
  // stale value and doesn't need `update` in its dependency array.
  const updateRef = useRef(update)
  updateRef.current = update
  const armedRef = useRef(false)

  // Track critical work in flight (e.g. a lesson-plan generation) so we never
  // reload onto a new build mid-operation and wipe the user's in-progress work.
  const [busy, setBusy] = useState(isCriticalWorkInFlight())
  useEffect(() => subscribeCriticalWork(setBusy), [])

  // Apply a pending update on the next in-app navigation. Arms at the location
  // where the update became ready, then reloads on the following route change —
  // but stays disarmed while critical work is in flight, so the swap waits for
  // the operation to finish and the user to navigate.
  useEffect(() => {
    const { armed, reload } = pwaReloadOnNavigate({ armed: armedRef.current, updateReady, busy })
    armedRef.current = armed
    if (reload) updateRef.current()
  }, [updateReady, location.pathname, busy])

  if (!updateReady) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-print="hide"
      className="fixed inset-x-3 bottom-3 z-[90] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[360px] theme-card theme-border rounded-radius-md border p-4 shadow-elev-lg"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-radius-sm bg-[color:var(--accent-bg)] text-[color:var(--accent)]">
          <Icon as={RefreshCw} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="theme-text text-sm font-black">New version available</p>
          <p className="theme-text-muted mt-1 text-xs leading-snug">
            Refresh when you are ready to load the latest ZedExams update.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={update}
              className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-bold shadow-sm transition hover:opacity-90 active:scale-[0.98]"
            >
              Refresh now
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full theme-text-muted px-3 py-1.5 text-xs font-bold transition hover:theme-text hover:theme-bg-subtle active:scale-[0.98]"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss update prompt"
          className="-mr-1 -mt-1 rounded-full p-1.5 theme-text-muted transition hover:theme-text hover:theme-bg-subtle active:scale-[0.98]"
        >
          <Icon as={XMarkIcon} size="sm" />
        </button>
      </div>
    </div>
  )
}
