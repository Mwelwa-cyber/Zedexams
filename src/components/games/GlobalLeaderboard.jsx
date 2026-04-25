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
import { GamesSectionHeading, MetaPill, getSubjectMascot, getSubjectTheme } from './gamesUi'

/**
 * /games/leaderboard — live cross-game leaderboard.
 * Same live subscription, upgraded presentation.
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
      <section className="mb-8 rounded-[20px] border border-white/80 bg-gradient-to-br from-amber-100 via-orange-50 to-white p-6 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.18)] sm:p-7">
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
        <div className="overflow-hidden rounded-[20px] border border-white/80 bg-white/88 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)] backdrop-blur-sm">
          <LeaderCheer topRow={state.rows[0]} />
          <ol>
            {state.rows.map((row, index) => (
              <Row key={row.id} row={row} rank={index + 1} isMe={currentUser && row.userId === currentUser.uid} />
            ))}
          </ol>
        </div>
      )}

      {!currentUser && (
        <div className="mt-6 rounded-[20px] border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-5 text-center shadow-[0_18px_40px_-30px_rgba(245,158,11,0.2)]">
          <p className="text-sm leading-6 text-amber-900">
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
            className={`rounded-full px-4 py-2 text-sm font-black transition ${active ? 'bg-slate-900 text-white shadow-[0_18px_40px_-26px_rgba(15,23,42,0.45)]' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function Row({ row, rank, isMe }) {
  const trophyTone = rank === 1
    ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'
    : rank === 2
      ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-slate-900'
      : rank === 3
        ? 'bg-gradient-to-br from-orange-700 to-amber-700 text-white'
        : 'bg-slate-100 text-slate-700'

  return (
    <li className={`flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-b-0 sm:px-5 ${isMe ? 'bg-amber-50/70' : ''}`}>
      <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl font-black shadow-[0_18px_36px_-24px_rgba(15,23,42,0.24)] ${trophyTone}`}>
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-base font-black text-slate-900">
            {row.displayName || 'Anonymous'}
          </p>
          {isMe && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-700">
              You
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {row.accuracy != null && <MetaPill icon={SparklesIcon} label={`${row.accuracy}% accuracy`} />}
          {row.bestStreak > 0 && <MetaPill icon={FireIcon} label={`Streak ${row.bestStreak}`} />}
          <MetaPill icon={StarIcon} label={formatWhen(row.playedAt)} />
        </div>
      </div>
      <div className="text-right">
        <p className="text-2xl font-black tracking-tight text-slate-900">{row.score}</p>
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">pts</p>
      </div>
    </li>
  )
}

function EmptyCard() {
  return (
    <div className="zx-empty-global rounded-[20px] border border-dashed border-slate-300 bg-white/88 p-10 text-center shadow-[0_24px_60px_-34px_rgba(15,23,42,0.14)]">
      <span
        role="img"
        aria-label="Trophy"
        className="zx-empty-global-mascot mx-auto inline-flex h-20 w-20 items-center justify-center rounded-full bg-white text-[3rem] leading-none ring-4 ring-white shadow-[0_16px_36px_-14px_rgba(15,23,42,0.32)]"
      >
        🏆
      </span>
      <h3 className="mt-5 text-2xl font-black text-slate-900">The board is wide open</h3>
      <p className="mt-3 text-base leading-7 text-slate-600">
        Play a round and you’ll be the first name our mascots cheer for.
      </p>
      <Link
        to="/games"
        className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-800 active:scale-[0.98]"
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
  const theme = getSubjectTheme(topRow.subject)
  const name = topRow.displayName || 'Anonymous'
  return (
    <div className={`zx-leader-cheer relative flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r ${theme.gradient} px-4 py-3 sm:px-5`}>
      <span
        role="img"
        aria-label={mascot.name}
        className="zx-leader-mascot inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-2xl ring-2 ring-white/80 shadow-sm"
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
    <div className="rounded-[20px] border border-rose-200 bg-rose-50/90 p-6 shadow-[0_20px_40px_-30px_rgba(244,63,94,0.16)]">
      <p className="text-base font-black text-rose-700">Live leaderboard is temporarily unavailable.</p>
      <p className="mt-2 text-sm leading-6 text-rose-900/80">
        {isIndex
          ? 'The Firestore index is still building after the latest deploy. Try again in a couple of minutes.'
          : 'A temporary read error interrupted the board. Refresh shortly and it should be back.'}
      </p>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="overflow-hidden rounded-[20px] border border-white/80 bg-white/88 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.16)]">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 border-b border-slate-100 px-4 py-4 last:border-b-0 sm:px-5">
          <div className="h-12 w-12 rounded-2xl bg-slate-100 animate-pulse" />
          <div className="flex-1">
            <div className="h-4 w-1/3 rounded-full bg-slate-100 animate-pulse" />
            <div className="mt-2 h-3 w-1/2 rounded-full bg-slate-100 animate-pulse" />
          </div>
          <div className="h-7 w-12 rounded-full bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  )
}
