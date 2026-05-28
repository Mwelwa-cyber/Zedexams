/**
 * AdminSetupBanner — short, dismissable banner pointing first-time
 * admins at the Platform Health card. Sits at the top of
 * AdminDashboard above the stats row. Hidden once dismissed
 * (localStorage key) so returning admins don't see it forever.
 *
 * Intentionally tiny — no Firestore reads on mount, no Cloud Function
 * pings. The Platform Health panel itself does the actual health check
 * once you click through. Goal is just to make the diagnostic
 * discoverable, not to duplicate it here.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'

const DISMISS_KEY = 'admin.setupBanner.dismissedV1'
const HEALTH_CHECKS = ['AI keys', 'Agent controls', 'CBC KB']

function readDismissed() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export default function AdminSetupBanner() {
  const [dismissed, setDismissed] = useState(() => readDismissed())

  if (dismissed) return null

  function dismiss() {
    setDismissed(true)
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // localStorage failure is non-fatal — banner just reappears next load.
    }
  }

  return (
    <section className="admin-game-card rounded-[18px] bg-white p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="admin-game-tile tone-blue grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base">
            <span aria-hidden="true">✓</span>
          </div>
          <div className="min-w-0">
            <p className="font-black text-sm sm:text-base" style={{ color: '#0F1B2D' }}>
              Platform health
            </p>
            <p className="mt-0.5 max-w-2xl text-xs font-semibold leading-relaxed" style={{ color: '#4A5A6E' }}>
              Check the services that keep generators, approvals, and curriculum tools running.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {HEALTH_CHECKS.map(label => (
                <span key={label} className="admin-game-pill-outline admin-game-pill">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Link
            to="/admin/agents"
            className="admin-game-btn-primary min-h-0 px-3 py-2 text-xs no-underline"
          >
            Run check
          </Link>
          <Link
            to="/admin/cbc-kb"
            className="admin-game-btn-ghost min-h-0 px-3 py-2 text-xs no-underline"
          >
            CBC KB
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="admin-game-btn-ghost min-h-0 px-2.5 py-2 text-xs"
            aria-label="Dismiss platform health banner"
          >
            Dismiss
          </button>
        </div>
      </div>
    </section>
  )
}
