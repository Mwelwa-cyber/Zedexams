import { useEffect, useState } from 'react'
import { getWeeklyChampions } from '../../utils/gamificationService'

/**
 * WeeklyChampions — aggregated top scorers across the past 7 daily
 * leaderboards. Sort key is `totalScore` (sum of daily percentages),
 * tie-broken by best rank reached on any single day.
 *
 * Re-uses the existing per-day leaderboard index — no extra Firestore
 * index is required. Cost: 7 small `getDocs` reads on mount.
 */
export default function WeeklyChampions({ subject, grade, currentUserId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getWeeklyChampions({ subject: subject || undefined, grade: grade || undefined })
      .then(list => { if (!cancelled) { setRows(list); setLoading(false) } })
      .catch(err => {
        if (cancelled) return
        console.warn('WeeklyChampions load failed', err)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [subject, grade])

  const trophyFor = (i) => i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`

  return (
    <section className="theme-card rounded-2xl border theme-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-black theme-text flex items-center gap-2">
            <span aria-hidden="true">👑</span> Weekly Champions
          </h3>
          <p className="theme-text-muted text-[11px] font-bold">
            Best of the past 7 days
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="theme-text-muted text-xs font-bold py-3 text-center">
          Not enough submissions this week to crown a champion.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {rows.slice(0, 5).map((c, i) => {
            const isMe = c.userId === currentUserId
            return (
              <li
                key={c.userId}
                className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${
                  isMe ? 'bg-amber-50 border border-amber-300' : 'bg-slate-50'
                }`}
              >
                <span className="w-6 text-center font-black text-sm">
                  {trophyFor(i)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black theme-text truncate">
                    {c.displayName}{isMe ? ' 👈 You' : ''}
                  </p>
                  <p className="theme-text-muted text-[10px] font-bold">
                    {c.activeDays} day{c.activeDays === 1 ? '' : 's'} · {c.totalAttempts} attempt{c.totalAttempts === 1 ? '' : 's'} · avg {c.avgPercentage}%
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-amber-700">{c.bestPercentage}%</p>
                  <p className="text-[10px] font-bold theme-text-muted">best</p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
