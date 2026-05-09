/**
 * LiveStats — real-data social proof on the marketing page (audit C4).
 *
 * Reads `publicStats/global` (public, no auth) — refreshed every 30
 * minutes by the updatePublicStats Cloud Function. The doc carries
 * total learner count, quizzes taken all-time, games played this
 * week, and quizzes available right now.
 *
 * UX:
 *   - Render a 3-stat strip with a soft loading shimmer until the doc
 *     resolves.
 *   - Fade-in the actual numbers once they land (no jarring 0 → 4521
 *     pop). If a count rolls over while the page is open we skip the
 *     animation — onSnapshot updates feel "live" naturally.
 *   - If the doc is missing (cron hasn't run yet) we render nothing
 *     instead of a row of zeros — honesty beats fake activity.
 *   - Numbers use Intl.NumberFormat so 4521 → "4,521" reads cleanly
 *     for a Zambian audience.
 */

import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase/config'

const STATS_REF_PATH = ['publicStats', 'global']
const numberFmt = new Intl.NumberFormat('en-ZM')

function StatCard({ value, label, hint, loading }) {
  return (
    <div className="theme-card border theme-border rounded-radius-md p-5 text-center min-w-0">
      {loading ? (
        <div aria-hidden="true" className="space-y-2">
          <div className="mx-auto h-9 w-24 rounded-md bg-current/10 animate-pulse" />
          <div className="mx-auto h-3 w-32 rounded-md bg-current/10 animate-pulse" />
        </div>
      ) : (
        <>
          <p className="theme-text font-display font-black text-3xl sm:text-4xl tabular-nums leading-none">
            {numberFmt.format(value)}
          </p>
          <p className="theme-text font-bold text-xs sm:text-sm uppercase tracking-wider mt-2">
            {label}
          </p>
          {hint && (
            <p className="theme-text-muted text-[11px] mt-1">{hint}</p>
          )}
        </>
      )}
    </div>
  )
}

export default function LiveStats() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    const ref = doc(db, ...STATS_REF_PATH)
    // Live subscription: a marketing visitor who lingers on the page
    // sees the numbers tick up when the next 30-min cron pass writes.
    // onSnapshot also gives us automatic offline fallback (cached
    // values from the last fetch survive a connection drop).
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setStats(snap.data())
          setErrored(false)
        }
        setLoading(false)
      },
      (err) => {
        console.warn('[LiveStats] subscription error', err)
        setErrored(true)
        setLoading(false)
      },
    )
    return () => unsub()
  }, [])

  // Cron hasn't run yet, or read failed. Render nothing rather than a
  // row of zeros that would imply an empty platform.
  if (errored || (!loading && !stats)) return null

  // Avoid showing a stat strip for a brand-new install that genuinely
  // has 0 learners — same honesty principle as above.
  const hasMeaningfulData = !!stats && (
    stats.learners > 0
    || stats.quizzesTakenAllTime > 0
    || stats.gamesPlayedThisWeek > 0
  )
  if (!loading && !hasMeaningfulData) return null

  return (
    <section
      aria-label="ZedExams platform activity"
      className="mx-auto w-full max-w-6xl px-5 sm:px-8 py-8 sm:py-12"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          loading={loading}
          value={stats?.learners ?? 0}
          label="Learners on board"
          hint="and growing"
        />
        <StatCard
          loading={loading}
          value={stats?.quizzesTakenAllTime ?? 0}
          label="Quizzes taken"
          hint="all time"
        />
        <StatCard
          loading={loading}
          value={stats?.gamesPlayedThisWeek ?? 0}
          label="Games this week"
          hint="last 7 days"
        />
      </div>
    </section>
  )
}
