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
    <section className="rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border-2 border-violet-300 bg-white text-lg">
            ✨
          </div>
          <div className="min-w-0">
            <p className="font-black text-violet-900 text-sm sm:text-base">
              New here, or things feel off? Run Platform Health
            </p>
            <p className="mt-0.5 text-xs text-violet-800/85 leading-relaxed max-w-2xl">
              The agent pipeline (lesson plans, worksheets, notes, flashcards, rubrics) runs server-side and fails silently when the Anthropic key, agent controls, or CBC KB aren't set up. Platform Health checks all three in 5 seconds and lets you initialise missing pieces with one click.
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Link
                to="/admin/agents"
                className="rounded-lg bg-violet-600 px-3 py-1.5 font-black text-white no-underline hover:bg-violet-700"
              >
                Open Platform Health →
              </Link>
              <Link
                to="/admin/cbc-kb"
                className="rounded-lg border-2 border-violet-300 bg-white px-3 py-1.5 font-black text-violet-700 no-underline hover:bg-violet-50"
              >
                Manage CBC KB
              </Link>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black text-violet-700 hover:bg-white"
          aria-label="Dismiss"
        >
          Dismiss ×
        </button>
      </div>
    </section>
  )
}
