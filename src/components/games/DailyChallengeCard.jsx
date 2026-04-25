import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClockIcon,
  FireIcon,
  PlayIcon,
  SparklesIcon,
  StarIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid'
import { gradeByValue } from '../../utils/gamesService'
import {
  MetaPill,
  getGameTypeTheme,
  getSubjectTheme,
} from './gamesUi'

/**
 * Featured hero for the Games hub. Purely presentational — the data is
 * loaded by GamesHub so we can reuse it across stats and recommendations.
 */
export default function DailyChallengeCard({ challenge, streak, loading, hideGrade = false }) {
  const [timeLeft, setTimeLeft] = useState(() => formatCountdown(getMsUntilNextUtcMidnight()))

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(formatCountdown(getMsUntilNextUtcMidnight()))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  if (loading) return <Skeleton />
  if (!challenge?.game) return null

  const game = challenge.game
  const grade = hideGrade ? null : gradeByValue(game.grade)
  const subjectTheme = getSubjectTheme(game.subject)
  const typeTheme = getGameTypeTheme(game.type)
  const playedToday = streak?.lastPlayedDate === challenge.dateId

  return (
    <section className={`relative mb-10 overflow-hidden rounded-[20px] border ${subjectTheme.border} bg-gradient-to-br ${subjectTheme.gradient} p-6 shadow-[0_28px_80px_-36px_rgba(15,23,42,0.28)] sm:p-8`}>
      <div className="absolute inset-y-0 right-0 w-48 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.8),_transparent_64%)]" />
      <div className="absolute -top-12 right-10 h-36 w-36 rounded-full bg-white/35 blur-3xl" />
      <div className="absolute bottom-0 left-0 h-32 w-32 rounded-full bg-white/25 blur-3xl" />

      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/88 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-slate-700">
              <SparklesIcon className="h-4 w-4 text-amber-500" />
              Daily challenge
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-600">
              <ClockIcon className="h-4 w-4" />
              Refreshes in {timeLeft}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {grade && <MetaPill icon={SparklesIcon} label={grade.label} />}
            <MetaPill icon={subjectTheme.icon} label={subjectTheme.label} />
            <MetaPill icon={typeTheme.icon} label={typeTheme.label} />
            <MetaPill icon={StarIcon} label={`${Number(game.points) || 0} pts`} />
          </div>

          <h1 className="mt-5 max-w-2xl text-3xl font-black tracking-tight text-slate-900 sm:text-4xl lg:text-[2.8rem] lg:leading-[1.02]">
            {game.title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700 sm:text-lg">
            {game.description}
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <StatusCard
              icon={FireIcon}
              title={streak?.signedIn ? `${streak.streak || 0}-day streak 🔥` : 'Start a streak!'}
              description={
                streak?.signedIn
                  ? playedToday
                    ? 'Nice work today! See you tomorrow.'
                    : streak?.streak
                      ? `One win keeps your ${streak.streak}-day fire alive!`
                      : 'Win today to start your streak!'
                  : 'Sign in to save your wins and streaks.'
              }
            />
            <StatusCard
              icon={TrophyIcon}
              title={playedToday ? 'Done for today! ✅' : 'Today’s game!'}
              description={
                playedToday
                  ? 'Play again to beat your best time!'
                  : 'Win to earn points and badges!'
              }
            />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to={`/games/play/${game.id}`}
              className={`inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r ${subjectTheme.strongGradient} px-6 py-3.5 text-base font-black text-white shadow-[0_20px_40px_-24px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 active:scale-[0.98]`}
            >
              <PlayIcon className="h-5 w-5" />
              {playedToday ? 'Play again' : 'Play now'}
            </Link>
            <p className="text-sm font-medium text-slate-600">
              {streak?.signedIn ? 'Scores save automatically after each finished round.' : 'You can play without signing in and save later.'}
            </p>
          </div>
        </div>

        <HeroArtwork subjectTheme={subjectTheme} />
      </div>
    </section>
  )
}

function StatusCard({ icon, title, description }) {
  const Icon = icon

  return (
    <div className="rounded-2xl bg-white/72 p-4 shadow-[0_18px_36px_-30px_rgba(15,23,42,0.25)] backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
    </div>
  )
}

function HeroArtwork({ subjectTheme }) {
  return (
    <div className="relative mx-auto hidden w-full max-w-[23rem] items-center justify-center self-stretch lg:flex">
      <div className={`absolute inset-8 rounded-full bg-gradient-to-br ${subjectTheme.strongGradient} opacity-20 blur-3xl`} />
      <div className="relative aspect-[4/4.2] w-full overflow-hidden rounded-[28px] border-2 border-white/80 bg-white/80 p-6 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.25)] backdrop-blur-xl">
        <div className="absolute -right-6 top-6 h-28 w-28 rounded-full bg-amber-200/55 blur-2xl" />
        <div className="absolute left-0 top-16 h-24 w-24 rounded-full bg-sky-200/40 blur-2xl" />
        <div className="absolute bottom-0 right-6 h-28 w-28 rounded-full bg-emerald-200/45 blur-2xl" />

        <div className="relative flex h-full flex-col items-center justify-center gap-4 text-center">
          <div className="text-[6rem] leading-none" aria-hidden="true">🎮</div>
          <div>
            <p className="text-xl font-black text-slate-900">Ready to play?</p>
            <p className="mt-1 text-sm font-medium text-slate-600">
              Tap the button and have fun!
            </p>
          </div>
          <div className="flex items-center gap-2 text-2xl" aria-hidden="true">
            <span>⭐</span><span>🏆</span><span>🔥</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <section className="mb-10 overflow-hidden rounded-[20px] border border-amber-100 bg-gradient-to-br from-amber-100 via-orange-50 to-white p-6 sm:p-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
        <div className="space-y-4">
          <div className="h-8 w-40 rounded-full bg-white/80 animate-pulse" />
          <div className="h-6 w-52 rounded-full bg-white/70 animate-pulse" />
          <div className="h-14 w-full max-w-xl rounded-3xl bg-white/70 animate-pulse" />
          <div className="h-6 w-full max-w-2xl rounded-full bg-white/65 animate-pulse" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-28 rounded-2xl bg-white/70 animate-pulse" />
            <div className="h-28 rounded-2xl bg-white/70 animate-pulse" />
          </div>
          <div className="h-12 w-40 rounded-full bg-white/80 animate-pulse" />
        </div>
        <div className="h-80 rounded-[28px] bg-white/75 animate-pulse" />
      </div>
    </section>
  )
}

function getMsUntilNextUtcMidnight() {
  const now = new Date()
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  )
  return Math.max(0, next - now.getTime())
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}
