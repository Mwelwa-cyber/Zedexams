import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FireIcon,
  SparklesIcon,
  StarIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid'
import { useAuth } from '../../contexts/AuthContext'
import { subscribeToGlobalLeaderboard, formatWhen } from '../../utils/gamesService'
import GamesShell from './GamesShell'
import { GamesSectionHeading, MetaPill, getSubjectMascot } from './gamesUi'

const TILE_BG = {
  mathematics: 'bg-orange-100',
  english:     'bg-blue-100',
  science:     'bg-green-100',
  social:      'bg-yellow-100',
}

/**
 * /games/leaderboard — live cross-game leaderboard.
 */
export default function GlobalLeaderboard() {
  const [win, setWin] = useState('all')
  const [state, setState] = useState({ rows: null, error: null })
  const { currentUser } = useAuth()

  useEffect(() => {
    document.title = 'Live Leaderboard — ZedExams Games'
    setState({ rows: null, error: null })
    const unsub = subscribeToGlobalLeaderboard({ window: win, max: 25 }, (next) => setState(next))
    return () => unsub()
  }, [win])

  return (
    <GamesShell crumbs={[{ label: 'Live Leaderboard' }]}>
      <section className="zx-card mb-8 rounded-[22px] bg-white p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <MetaPill icon={TrophyIcon} label="Live scores" />
          <MetaPill icon={SparklesIcon} label="Top 25 players" />
          <MetaPill icon={FireIcon} label={win === 'today' ? 'Today' : win === 'week' ? 'This week' : 'All time'} />
        </div>
        <div className="mt-5">
          <GamesSectionHeading
            eyebrow="Leaderboard"
            title="See who is climbing fastest"
            description="The board refreshes in real time so learners can spot their position, chase streaks, and celebrate new highs."
          />
        </div>
      </section>

      <WindowTabs value={win} onChange={setWin} />

      {state.error && <ErrorCard error={state.error} />}
      {!state.error && state.rows == null && <Skeleton />}
      {!state.error && state.rows != null && state.rows.length === 0 && <EmptyCard />}
      {!state.error && state.rows != null && state.rows.length > 0 && (
        <div className="zx-card overflow-hidden rounded-[22px] bg-white">
          <LeaderCheer topRow={state.rows[0]} />
          <ol>
            {state.rows.map((row, index) => (
              <Row key={row.id} row={row} rank={index + 1} isMe={currentUser && row.userId === currentUser.uid} />
            ))}
          </ol>
        </div>
      )}

      {!currentUser && (
        <div className="zx-card mt-6 rounded-[18px] bg-amber-100 p-5 text-center text-amber-900">
          <p className="text-sm leading-6">
            Sign in to save scores and appear on the live board.{' '}
            <Link to="/login?redirect=/games/leaderboard" className="font-black underline">
              Sign in
            </Link>
          </p>
        </div>
      )}
    </GamesShell>
  )
}

function WindowTabs({ value, onChange }) {
  const tabs = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'all', label: 'All Time' },
  ]

  return (
    <div className="mb-5 flex gap-2 overflow-x-auto">
      {tabs.map((tab) => {
        const active = value === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`zx-sticker-btn rounded-[14px] px-4 py-2 text-sm ${active ? 'zx-sticker-btn-dark' : 'zx-sticker-btn-secondary'}`}
          >
            {tab.label}
          </button>
        )
      })}
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
    <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[12px] border-2 border-slate-900 font-display text-lg font-bold text-slate-900 ${tone}`}>
      {rank}
    </span>
  )
}

function Row({ row, rank, isMe }) {
  return (
    <li className={`flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-b-0 sm:px-5 ${isMe ? 'bg-amber-50' : ''}`}>
      <RankTile rank={rank} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-display text-base font-bold text-slate-900">
            {row.displayName || 'Anonymous'}
          </p>
          {isMe && <span className="zx-chip">You</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {row.accuracy != null && <MetaPill icon={SparklesIcon} label={`${row.accuracy}% accuracy`} />}
          {row.bestStreak > 0 && <MetaPill icon={FireIcon} label={`Streak ${row.bestStreak}`} />}
          <MetaPill icon={StarIcon} label={formatWhen(row.playedAt)} />
        </div>
      </div>
      <div className="text-right">
        <p className="font-display text-2xl font-bold tracking-tight text-slate-900">{row.score}</p>
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-400">pts</p>
      </div>
    </li>
  )
}

function EmptyCard() {
  return (
    <div className="zx-empty-global zx-card rounded-[22px] bg-white p-10 text-center">
      <span
        role="img"
        aria-label="Trophy"
        className="zx-empty-global-mascot mx-auto grid h-20 w-20 place-items-center rounded-[18px] border-2 border-slate-900 bg-yellow-100 text-[3rem] leading-none"
      >
        🏆
      </span>
      <h3 className="font-display mt-5 text-2xl font-bold text-slate-900">The board is wide open</h3>
      <p className="mt-3 text-base leading-7 text-slate-600">
        Play a round and you’ll be the first name our mascots cheer for.
      </p>
      <Link
        to="/games"
        className="zx-sticker-btn zx-sticker-btn-dark mt-6 rounded-[14px] px-4 py-2.5 text-sm"
      >
        Play a game
      </Link>
      <style>{`
        .zx-empty-global .zx-empty-global-mascot {
          animation: zx-empty-global-bob 3.6s ease-in-out infinite;
          transform-origin: center;
        }
        @keyframes zx-empty-global-bob {
          0%, 100% { transform: translateY(0)   rotate(-4deg); }
          50%      { transform: translateY(-5px) rotate(4deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .zx-empty-global .zx-empty-global-mascot { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

function LeaderCheer({ topRow }) {
  const mascot = getSubjectMascot(topRow.subject)
  const tileBg = TILE_BG[String(topRow.subject || '').toLowerCase()] || 'bg-orange-100'
  const name = topRow.displayName || 'Anonymous'
  return (
    <div className="zx-leader-cheer relative flex items-center gap-3 border-b border-slate-100 bg-amber-50 px-4 py-3 sm:px-5">
      <span
        role="img"
        aria-label={mascot.name}
        className={`zx-leader-mascot grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border-2 border-slate-900 text-2xl ${tileBg}`}
      >
        {mascot.emoji}
      </span>
      <p className="min-w-0 flex-1 text-sm leading-snug text-slate-800">
        <span className="font-black">{mascot.name}</span> cheers:{' '}
        <span className="font-black text-slate-900">“{name}</span>
        <span className="text-slate-700">{` is leading the board!”`}</span>
      </p>
      <style>{`
        .zx-leader-cheer .zx-leader-mascot {
          animation: zx-global-leader-bob 4s ease-in-out infinite;
          transform-origin: center;
        }
        @keyframes zx-global-leader-bob {
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

function ErrorCard({ error }) {
  const isIndex = /index|inadequate|FAILED_PRECONDITION/i.test(String(error))

  return (
    <div className="zx-card rounded-[18px] bg-rose-100 p-6 text-rose-900">
      <p className="text-base font-black">Live leaderboard is temporarily unavailable.</p>
      <p className="mt-2 text-sm leading-6 opacity-90">
        {isIndex
          ? 'The Firestore index is still building after the latest deploy. Try again in a couple of minutes.'
          : 'A temporary read error interrupted the board. Refresh shortly and it should be back.'}
      </p>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="zx-card overflow-hidden rounded-[22px] bg-white">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-b-0 sm:px-5">
          <div className="h-12 w-12 rounded-[12px] border-2 border-slate-900 bg-slate-100 animate-pulse" />
          <div className="flex-1">
            <div className="h-4 w-1/3 rounded bg-slate-100 animate-pulse" />
            <div className="mt-2 h-3 w-1/2 rounded bg-slate-100 animate-pulse" />
          </div>
          <div className="h-7 w-12 rounded bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
