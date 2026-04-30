import { useEffect, useState } from 'react'
import { TrophyIcon, FireIcon, SparklesIcon } from '@heroicons/react/24/solid'
import { useAuth } from '../../contexts/AuthContext'
import { formatWhen, getLeaderboard } from '../../utils/gamesService'
import { MetaPill, getSubjectMascot } from './gamesUi'

const TILE_BG = {
  mathematics: 'bg-orange-100',
  english:     'bg-blue-100',
  science:     'bg-green-100',
  social:      'bg-yellow-100',
}

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
      <div className="zx-empty-leader zx-card rounded-[22px] bg-white p-8 text-center">
        <span
          role="img"
          aria-label="Game Pal"
          className="zx-empty-leader-mascot mx-auto grid h-16 w-16 place-items-center rounded-[14px] border-2 border-slate-900 bg-orange-100 text-[2.6rem] leading-none"
        >
          🏆
        </span>
        <h3 className="font-display mt-4 text-xl font-bold text-slate-900">Be the first on this board</h3>
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
    <div className="zx-card overflow-hidden rounded-[22px] bg-white">
      <header className="border-b-2 border-slate-900 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[12px] border-2 border-slate-900 bg-slate-900 text-white">
            <TrophyIcon className="h-6 w-6 text-amber-300" />
          </span>
          <div>
            <p className="zx-eyebrow">Leaderboard</p>
            <h3 className="font-display text-lg font-bold text-slate-900">Top {Math.min(rows.length, limit)} scores</h3>
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
              className={`flex items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0 ${isMe ? 'bg-amber-50' : ''}`}
            >
              <RankTile rank={index + 1} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-display font-bold text-slate-900">{row.displayName || 'Anonymous'}</p>
                  {isMe && <span className="zx-chip">You</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <MetaPill icon={SparklesIcon} label={`${row.accuracy ?? 0}% accuracy`} />
                  <MetaPill icon={FireIcon} label={`Streak ${row.bestStreak ?? 0}`} />
                  <MetaPill icon={TrophyIcon} label={formatWhen(row.playedAt)} />
                </div>
              </div>
              <span className="font-display text-2xl font-bold tracking-tight text-slate-900">{row.score}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function RankTile({ rank }) {
  const tone =
    rank === 1 ? 'bg-yellow-300' :
    rank === 2 ? 'bg-slate-200' :
    rank === 3 ? 'bg-orange-300' :
    'bg-white'
  return (
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border-2 border-slate-900 font-display text-base font-bold text-slate-900 ${tone}`}>
      {rank}
    </span>
  )
}

function LeaderCheer({ topRow }) {
  const mascot = getSubjectMascot(topRow.subject)
  const tileBg = TILE_BG[String(topRow.subject || '').toLowerCase()] || 'bg-orange-100'
  const name = topRow.displayName || 'Anonymous'
  return (
    <div className="zx-leader-cheer relative flex items-center gap-3 border-b border-slate-100 bg-amber-50 px-5 py-3">
      <span
        role="img"
        aria-label={mascot.name}
        className={`zx-leader-mascot grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border-2 border-slate-900 text-2xl ${tileBg}`}
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
    <div className="zx-card rounded-[22px] bg-white p-5">
      <div className="h-6 w-36 rounded bg-slate-100 animate-pulse" />
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="mt-4 flex items-center gap-4">
          <div className="h-10 w-10 rounded-[10px] border-2 border-slate-900 bg-slate-100 animate-pulse" />
          <div className="flex-1">
            <div className="h-4 w-1/2 rounded bg-slate-100 animate-pulse" />
            <div className="mt-2 h-3 w-2/3 rounded bg-slate-100 animate-pulse" />
          </div>
          <div className="h-6 w-12 rounded bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
