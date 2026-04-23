import { useEffect, useState } from 'react'
import { formatWhen, getLeaderboard } from '../../utils/gamesService'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Top-N scores for a given game. Public read — anyone can see it.
 * Falls back to a friendly empty state when no scores exist yet (or when
 * the composite index is still building on a fresh deploy).
 */
export default function Leaderboard({ gameId, limit = 10 }) {
  const { currentUser } = useAuth()
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const data = await getLeaderboard(gameId, limit)
      if (!cancelled) setRows(data)
    }
    load()
    return () => { cancelled = true }
  }, [gameId, limit])

  if (rows == null) {
    return <Skeleton />
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-3xl border-2 border-dashed border-slate-300 p-8 text-center">
        <div className="text-4xl mb-2">🏆</div>
        <h3 className="text-lg font-black mb-1">Be the first on the board</h3>
        <p className="text-slate-600 text-sm">
          {currentUser
            ? 'Play this game to claim the top spot.'
            : 'Sign in and play this game to claim the top spot.'}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-3xl border-2 border-slate-200 overflow-hidden">
      <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-lg font-black flex items-center gap-2">🏆 Top {Math.min(rows.length, limit)} scores</h3>
      </header>
      <ol>
        {rows.map((r, i) => {
          const isMe = currentUser && r.userId === currentUser.uid
          return (
            <li
              key={r.id}
              className={`flex items-center gap-3 px-5 py-3 border-b last:border-b-0 border-slate-100 ${isMe ? 'bg-amber-50' : ''}`}
            >
              <span className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-black ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-slate-800' : i === 2 ? 'bg-amber-700 text-white' : 'bg-slate-100 text-slate-700'}`}>
                {i + 1}
              </span>
              <span className="flex-1 min-w-0">
                <span className="font-black truncate block">{r.displayName || 'Anonymous'} {isMe && <span className="text-amber-700 text-xs ml-1">· you</span>}</span>
                <span className="text-xs text-slate-500">
                  {r.accuracy ?? 0}% accuracy · streak {r.bestStreak ?? 0} · {formatWhen(r.playedAt)}
                </span>
              </span>
              <span className="text-xl font-black tabular-nums text-amber-700 shrink-0">
                {r.score}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="bg-white rounded-3xl border-2 border-slate-200 p-5">
      <div className="h-5 w-1/3 bg-slate-200 rounded animate-pulse mb-4"></div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-100 animate-pulse"></div>
          <div className="flex-1">
            <div className="h-3 bg-slate-100 rounded animate-pulse w-2/3 mb-1.5"></div>
            <div className="h-2.5 bg-slate-100 rounded animate-pulse w-1/2"></div>
          </div>
          <div className="w-12 h-5 bg-slate-100 rounded animate-pulse"></div>
        </div>
      ))}
    </div>
  )
}
