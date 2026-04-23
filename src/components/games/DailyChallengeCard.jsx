import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getTodaysChallenge, getMyStreak, todaysDateId,
} from '../../utils/dailyChallengeService'
import { gradeByValue, subjectBySlug } from '../../utils/gamesService'

/**
 * Big, kid-friendly banner for today's daily challenge. Sits at the top of
 * the GamesHub. Shows the featured game, a streak counter (when signed in),
 * a countdown until midnight UTC, and a CTA that drops the pupil straight
 * into the play screen.
 */
export default function DailyChallengeCard() {
  const [state, setState] = useState({ loading: true })
  const [streak, setStreak] = useState({ streak: 0, longestStreak: 0, signedIn: false })
  const [now, setNow] = useState(() => new Date())
  const todayId = todaysDateId()

  useEffect(() => {
    let cancelled = false
    Promise.all([getTodaysChallenge(), getMyStreak()])
      .then(([challenge, s]) => {
        if (cancelled) return
        setState({ loading: false, ...challenge })
        setStreak(s)
      })
      .catch(() => {
        if (cancelled) return
        setState({ loading: false, game: null })
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  if (state.loading) return <Skeleton />
  const game = state.game
  if (!game) return null

  const grade = gradeByValue(game.grade)
  const subject = subjectBySlug(game.subject)
  const playedToday = streak.lastPlayedDate === todayId
  const countdown = msUntilMidnightUTC(now)

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-amber-200/70 shadow-[0_10px_40px_-12px_rgba(251,146,60,0.35)] mb-6 sm:mb-8 bg-gradient-to-br from-amber-50 via-rose-50 to-orange-100 animate-slide-in-soft">
      {/* decorative blobs */}
      <div aria-hidden="true" className="absolute -top-16 -left-10 w-56 h-56 rounded-full bg-amber-200/50 blur-3xl" />
      <div aria-hidden="true" className="absolute -bottom-20 right-0 w-72 h-72 rounded-full bg-rose-200/40 blur-3xl" />

      <div className="relative grid md:grid-cols-[1.4fr_1fr] gap-0">
        {/* Left: content */}
        <div className="p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/90 text-[10px] font-black uppercase tracking-wider text-amber-800 shadow-sm">
              <span aria-hidden="true">⭐</span>
              <span>Today's Daily Challenge</span>
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-black text-amber-700/80">
              <span aria-hidden="true">📅</span>
              <span>{formatPrettyDate(todayId)}</span>
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight text-slate-900">
            {game.title}
          </h2>

          <div className="flex flex-wrap gap-1.5 mt-3">
            {grade && <Chip tone="amber">{grade.label}</Chip>}
            {subject && <Chip tone="rose">{subject.emoji} {subject.label}</Chip>}
            {game.cbc_topic && <Chip tone="emerald">{game.cbc_topic}</Chip>}
          </div>

          <p className="text-sm sm:text-base text-slate-700 mt-3 line-clamp-2">{game.description}</p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              to={`/games/play/${game.id}`}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl font-black text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-orange-500/25 hover:-translate-y-0.5 transition"
            >
              <span>{playedToday ? 'Play Again' : "Play Today's Challenge"}</span>
              <span aria-hidden="true">🚀</span>
            </Link>

            <div className="flex items-center gap-2">
              <CountdownPill ms={countdown} label="Ends in" />
              <StreakBadge streak={streak} playedToday={playedToday} />
            </div>
          </div>
        </div>

        {/* Right: mascot illustration panel */}
        <div className="relative hidden md:flex items-end justify-center p-5 sm:p-7">
          <Mascot subject={subject} />
        </div>
      </div>
    </section>
  )
}

function Mascot({ subject }) {
  const emoji = subject?.emoji || '🤖'
  return (
    <div className="relative w-full flex items-center justify-center">
      <div className="relative">
        {/* floating tiles around mascot */}
        <div aria-hidden="true" className="absolute -top-4 -left-8 w-10 h-10 rounded-xl bg-white shadow-md rotate-[-8deg] flex items-center justify-center text-lg">
          ✏️
        </div>
        <div aria-hidden="true" className="absolute -top-6 right-0 w-10 h-10 rounded-xl bg-white shadow-md rotate-[10deg] flex items-center justify-center text-lg">
          📚
        </div>
        <div aria-hidden="true" className="absolute bottom-2 -right-8 w-10 h-10 rounded-xl bg-white shadow-md rotate-[-6deg] flex items-center justify-center text-lg">
          🎯
        </div>
        <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-gradient-to-br from-indigo-400 via-sky-400 to-cyan-400 border-4 border-white shadow-xl flex items-center justify-center text-5xl sm:text-6xl">
          <span aria-hidden="true">{emoji}</span>
        </div>
      </div>
    </div>
  )
}

function CountdownPill({ ms, label = 'Ends in' }) {
  if (ms == null || ms <= 0) return null
  const hours = Math.floor(ms / 3_600_000)
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  const text = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 border border-amber-200 text-xs font-black text-amber-800 shadow-sm">
      <span aria-hidden="true">⏳</span>
      <span className="text-slate-500 font-bold">{label}</span>
      <span className="font-mono">{text}</span>
    </span>
  )
}

function StreakBadge({ streak, playedToday }) {
  if (!streak.signedIn) {
    return (
      <Link
        to="/login"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 border border-slate-200 text-xs font-black text-slate-700 hover:bg-white shadow-sm"
      >
        <span aria-hidden="true">🔒</span>
        <span>Sign in for streaks</span>
      </Link>
    )
  }
  if (streak.streak === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 border border-slate-200 text-xs font-black text-slate-600 shadow-sm">
        <span aria-hidden="true">✨</span>
        Start your streak
      </span>
    )
  }
  const onFire = streak.streak >= 3
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black shadow-sm ${onFire ? 'bg-rose-500 text-white' : 'bg-white text-amber-800 border border-amber-200'}`}>
      <span aria-hidden="true">{onFire ? '🔥' : '⭐'}</span>
      <span>{streak.streak}-day streak</span>
      {playedToday && <span className="opacity-80">· today ✓</span>}
    </span>
  )
}

function Chip({ children, tone = 'slate' }) {
  const tones = {
    amber:   'bg-amber-100 text-amber-800 border-amber-200',
    rose:    'bg-rose-100 text-rose-800 border-rose-200',
    emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    slate:   'bg-white text-slate-700 border-slate-200',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wide border ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  )
}

function Skeleton() {
  return (
    <section className="rounded-[28px] border border-amber-200/70 bg-amber-50 p-6 mb-8">
      <div className="h-3 w-40 bg-amber-200 rounded animate-pulse mb-4"></div>
      <div className="flex gap-4">
        <div className="flex-1">
          <div className="h-6 w-3/4 bg-amber-200 rounded animate-pulse mb-3"></div>
          <div className="h-3 w-1/2 bg-amber-200 rounded animate-pulse mb-4"></div>
          <div className="h-10 w-40 bg-amber-200 rounded-xl animate-pulse"></div>
        </div>
        <div className="w-36 h-36 rounded-full bg-amber-200 animate-pulse hidden md:block" />
      </div>
    </section>
  )
}

function msUntilMidnightUTC(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(0, next - now.getTime())
}

function formatPrettyDate(dateId) {
  try {
    const [y, m, d] = dateId.split('-').map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateId
  }
}
