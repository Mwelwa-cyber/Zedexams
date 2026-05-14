import { useEffect, useRef, useState } from 'react'
import { subscribeToRecentActivity, timeAgo } from '../../utils/gamificationService'

/**
 * LiveActivityFeed — a "feel-alive" side panel that streams the latest
 * submitted attempts for the current filter. Each row reads:
 *   <medal/name> just scored <pct>% in <subject>  ·  Xm ago
 *
 * Subscribes via gamificationService.subscribeToRecentActivity, which
 * uses the existing daily leaderboard index (no new index needed).
 */
export default function LiveActivityFeed({ subject, grade, date }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const unsubRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    unsubRef.current = subscribeToRecentActivity(
      { subject: subject || undefined, grade: grade || undefined, date },
      (next) => { setRows(next); setLoading(false) },
    )
    return () => { if (unsubRef.current) { unsubRef.current(); unsubRef.current = null } }
  }, [subject, grade, date])

  return (
    <section className="theme-card rounded-2xl border theme-border p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-black theme-text flex items-center gap-2">
          <span aria-hidden="true">📣</span> Live Activity
        </h3>
        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-red-600">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
          </span>
          Live
        </span>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-8 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="theme-text-muted text-xs font-bold py-3 text-center">
          No submissions yet today. Be the first!
        </p>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {rows.map(r => {
            const tone = r.percentage >= 80
              ? 'border-l-green-400 bg-green-50/60'
              : r.percentage >= 60
                ? 'border-l-amber-400 bg-amber-50/60'
                : 'border-l-slate-300 bg-slate-50/60'
            const emoji = r.percentage >= 80 ? '🌟' : r.percentage >= 60 ? '👍' : '📘'
            return (
              <li
                key={r.id}
                className={`rounded-md border-l-2 px-2 py-1.5 text-xs ${tone}`}
                style={{ animation: 'zx-feed-pop 0.35s ease-out' }}
              >
                <p className="font-bold theme-text leading-snug truncate">
                  <span className="mr-1" aria-hidden="true">{emoji}</span>
                  <span className="font-black">{r.displayName}</span>{' '}
                  scored <span className="font-black">{r.percentage}%</span>
                  {r.subject && <> in <span className="font-bold">{r.subject}</span></>}
                </p>
                <p className="theme-text-muted text-[10px] font-bold mt-0.5">
                  {r.score}/{r.totalMarks} marks · {timeAgo(r.submittedAt)}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      <style>{`
        @keyframes zx-feed-pop {
          0%   { opacity: 0; transform: translateX(-6px); }
          100% { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </section>
  )
}
