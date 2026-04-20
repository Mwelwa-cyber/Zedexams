import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getTodaysChallenge, getMyStreak, todaysDateId,
} from '../../utils/dailyChallengeService'
import { gradeByValue, subjectBySlug } from '../../utils/gamesService'

/**
 * Big, kid-friendly banner for today's daily challenge. Sits at the top of
 * the GamesHub. Shows the featured game, a streak counter (when signed in),
 * and a CTA that drops the pupil straight into the play screen.
 */
export default function DailyChallengeCard() {
  const [state, setState] = useState({ loading: true })
  const [streak, setStreak] = useState({ streak: 0, longestStreak: 0, signedIn: false })
  const todayId = todaysDateId()

  useEffect(() => {
    let cancelled = false
    Promise.all([getTodaysChallenge(), getMyStreak()]).then(([challenge, s]) => {
      if (cancelled) return
      setState({ loading: false, ...challenge })
      setStreak(s)
    })
    return () => { cancelled = true }
  }, [])

  if (state.loading) return <Skeleton />
  const game = state.game
  if (!game) return null

  const grade = gradeByValue(game.grade)
  const subject = subjectBySlug(game.subject)
  const playedToday = streak.lastPlayedDate === todayId

  return (
    <section className="rounded-3xl border-2 border-amber-300 overflow-hidden shadow-md mb-8 bg-gradient-to-br from-amber-100 via-rose-100 to-orange-100">
      {/* Top strip: TODAY date + streak badge */}
      <div className="px-5 sm:px-6 pt-5 flex items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 text-[10px] font-black uppercase tracking-wider text-amber-800">
            <span aria-hidden="true">⭐</span>
            <span>Today's Daily Challenge</span>
            <span className="text-amber-600 font-mono">· {todayId}</span>
          </p>
        </div>
        <StreakBadge streak={streak} playedToday={playedToday} />
      </div>

      {/* Body: featured game */}
      <div className="px-5 sm:px-6 pb-5 pt-4 flex items-center gap-4 sm:gap-6">
        <div className="text-5xl sm:text-6xl shrink-0" aria-hidden="true">{subject?.emoji || '🎮'}</div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl sm:text-2xl font-black leading-tight truncate">{game.title}</h2>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {grade && <Chip>{grade.label}</Chip>}
            {subject && <Chip>{subject.label}</Chip>}
            {game.cbc_topic && <Chip>{game.cbc_topic}</Chip>}
          </div>
          <p className="text-sm text-slate-700 mt-2 line-clamp-2">{game.description}</p>
        </div>
      </div>

      {/* Action strip */}
      <div className="bg-white/70 px-5 sm:px-6 py-4 flex flex-col sm:flex-row items-center gap-3 justify-between">
        <p className="text-sm text-slate-700 text-center sm:text-left">
          {playedToday
            ? <>✅ <b>Done today.</b> Come back tomorrow to keep the streak going.</>
            : streak.signedIn
              ? <>Beat today's challenge to {streak.streak > 0 ? `extend your ${streak.streak}-day streak` : 'start a streak'}.</>
              : <>Sign in to track your daily streak.</>}
        </p>
        <Link
          to={`/games/play/${game.id}`}
          className="px-5 py-3 rounded-xl font-black text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-md w-full sm:w-auto text-center"
        >
          {playedToday ? 'Play again →' : 'Play today\'s challenge 🚀'}
        </Link>
      </div>
    </section>
  )
}

function StreakBadge({ streak, playedToday }) {
  if (!streak.signedIn) {
    return (
      <Link to="/login" className="text-[11px] font-black text-amber-800 underline hover:text-amber-900">
        Sign in to track your streak
      </Link>
    )
  }
  if (streak.streak === 0) {
    return <span className="text-[11px] font-black text-slate-600">No streak yet</span>
  }
  const onFire = streak.streak >= 3
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-black text-sm shadow-sm ${onFire ? 'bg-rose-500 text-white' : 'bg-white text-amber-800'}`}>
      <span aria-hidden="true">{onFire ? '🔥' : '⭐'}</span>
      <span>{streak.streak}-day streak</span>
      {playedToday && <span className="text-xs opacity-90">· today ✓</span>}
    </div>
  )
}

function Chip({ children }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-white/70 text-slate-700">
      {children}
    </span>
  )
}

function Skeleton() {
  return (
    <section className="rounded-3xl border-2 border-amber-200 bg-amber-50 p-6 mb-8">
      <div className="h-3 w-40 bg-amber-200 rounded animate-pulse mb-3"></div>
      <div className="flex gap-4">
        <div className="w-16 h-16 rounded-2xl bg-amber-200 animate-pulse shrink-0"></div>
        <div className="flex-1">
          <div className="h-5 w-3/4 bg-amber-200 rounded animate-pulse mb-2"></div>
          <div className="h-3 w-1/2 bg-amber-200 rounded animate-pulse"></div>
        </div>
      </div>
    </section>
  )
}
