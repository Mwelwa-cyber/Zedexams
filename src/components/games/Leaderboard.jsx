import { useEffect, useState } from 'react'
import { TrophyIcon, FireIcon, SparklesIcon } from '@heroicons/react/24/solid'
import { useAuth } from '../../contexts/AuthContext'
import { formatWhen, getLeaderboard } from '../../utils/gamesService'
import { MetaPill, getSubjectMascot, getSubjectTheme } from './gamesUi'

/**
 * Top-N scores for a single game.
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

  if (rows == null) return <Skeleton />

  if (rows.length === 0) {
    return (
      <div className="zx-empty-leader rounded-[20px] border border-dashed border-slate-300 bg-white/88 p-8 text-center shadow-[0_24px_60px_-34px_rgba(15,23,42,0.14)]">
        <span
          role="img"
          aria-label="Game Pal"
          className="zx-empty-leader-mascot mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-white text-[2.6rem] leading-none ring-4 ring-white shadow-[0_14px_28px_-12px_rgba(15,23,42,0.32)]"
        >
          🏆
        </span>
        <h3 className="mt-4 text-xl font-black text-slate-900">Be the first on this board</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Finish a round and claim the opening spot — your mascot will cheer!
        </p>
        <style>{`
          .zx-empty-leader .zx-empty-leader-mascot {
            animation: zx-empty-leader-bob 3.6s ease-in-out infinite;
            transform-origin: center;
          }
          @keyframes zx-empty-leader-bob {
            0%, 100% { transform: translateY(0)   rotate(-4deg); }
            50%      { transform: translateY(-4px) rotate(4deg); }
          }
          @media (prefers-reduced-motion: reduce) {
            .zx-empty-leader .zx-empty-leader-mascot { animation: none !important; }
          }
        `}</style>
      </div>
    )
  }

  const topRow = rows[0]

  return (
    <div className="overflow-hidden rounded-[20px] border border-white/80 bg-white/88 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)]">
      <header className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white">
            <TrophyIcon className="h-6 w-6 text-amber-300" />
          </span>
          <div>
            <h3 className="text-lg font-black text-slate-900">Top {Math.min(rows.length, limit)} scores</h3>
            <p className="text-sm text-slate-500">Fastest points, best accuracy, biggest streaks.</p>
          </div>
        </div>
      </header>
      {topRow && <LeaderCheer topRow={topRow} />}
      <ol>
        {rows.map((row, index) => {
          const isMe = currentUser && row.userId === currentUser.uid
          return (
            <li
              key={row.id}
              className={`flex items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0 ${isMe ? 'bg-amber-50/70' : ''}`}
            >
              <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl font-black ${index === 0 ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white' : index === 1 ? 'bg-slate-200 text-slate-900' : index === 2 ? 'bg-gradient-to-br from-orange-700 to-amber-700 text-white' : 'bg-slate-100 text-slate-700'}`}>
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-black text-slate-900">{row.displayName || 'Anonymous'}</p>
                  {isMe && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-700">
                      You
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <MetaPill icon={SparklesIcon} label={`${row.accuracy ?? 0}% accuracy`} />
                  <MetaPill icon={FireIcon} label={`Streak ${row.bestStreak ?? 0}`} />
                  <MetaPill icon={TrophyIcon} label={formatWhen(row.playedAt)} />
                </div>
              </div>
              <span className="text-2xl font-black tracking-tight text-slate-900">{row.score}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function LeaderCheer({ topRow }) {
  const mascot = getSubjectMascot(topRow.subject)
  const theme = getSubjectTheme(topRow.subject)
  const name = topRow.displayName || 'Anonymous'
  return (
    <div className={`zx-leader-cheer relative flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r ${theme.gradient} px-5 py-3`}>
      <span
        role="img"
        aria-label={mascot.name}
        className="zx-leader-mascot inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-2xl ring-2 ring-white/80 shadow-sm"
      >
        {mascot.emoji}
      </span>
      <p className="min-w-0 flex-1 text-sm leading-snug text-slate-800">
        <span className="font-black">{mascot.name}</span> cheers:{' '}
        <span className="font-black text-slate-900">“{name}</span>
        <span className="text-slate-700">{` is leading the pack!”`}</span>
      </p>
      <style>{`
        .zx-leader-cheer .zx-leader-mascot {
          animation: zx-leader-bob 4s ease-in-out infinite;
          transform-origin: center;
        }
        @keyframes zx-leader-bob {
          0%, 100% { transform: translateY(0)   rotate(-3deg); }
          50%      { transform: translateY(-2px) rotate(3deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .zx-leader-cheer .zx-leader-mascot { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="rounded-[20px] border border-white/80 bg-white/88 p-5 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)]">
      <div className="h-6 w-36 rounded-full bg-slate-100 animate-pulse" />
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="mt-4 flex items-center gap-4">
          <div className="h-10 w-10 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="flex-1">
            <div className="h-4 w-1/2 rounded-full bg-slate-100 animate-pulse" />
            <div className="mt-2 h-3 w-2/3 rounded-full bg-slate-100 animate-pulse" />
          </div>
          <div className="h-6 w-12 rounded-full bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
