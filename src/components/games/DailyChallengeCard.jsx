import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClockIcon,
  PlayIcon,
  SparklesIcon,
  StarIcon,
} from '@heroicons/react/24/solid'
import {
  getGameTypeTheme,
  getSubjectMascot,
  getSubjectTheme,
} from './gamesUi'

/**
 * Featured hero for the Games hub. Mockup-faithful teal slab with an orange
 * "Play now" pill, mascot circle, and on-tap confetti burst. Data is
 * loaded by GamesHub so this component stays purely presentational.
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
  const subjectTheme = getSubjectTheme(game.subject)
  const typeTheme = getGameTypeTheme(game.type)
  const mascot = getSubjectMascot(game.subject)
  const playedToday = streak?.lastPlayedDate === challenge.dateId
  const streakLine = buildStreakLine(streak, playedToday)

  return (
    <section
      className="zx-hero relative overflow-hidden rounded-[26px] border-2 border-slate-900 bg-[#0E5E70] p-5 text-white shadow-[0_6px_0_#0F1B2D]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 88% 14%, rgba(255,255,255,0.14) 0, transparent 28%), radial-gradient(circle at 12% 95%, rgba(255,154,62,0.32) 0, transparent 38%)',
        }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-slate-900 bg-[#FF7A1A] px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.08em] text-white shadow-[0_2px_0_#0F1B2D]">
          <SparklesIcon className="h-3.5 w-3.5" />
          Daily Challenge
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-white/85">
          <ClockIcon className="h-3.5 w-3.5" />
          Refresh in {timeLeft}
        </span>
      </div>

      <h1 className="font-display relative mt-3.5 max-w-[230px] text-[38px] font-bold leading-[0.95] tracking-tight">
        {game.title}
      </h1>
      {game.description && (
        <p className="relative mt-1.5 max-w-[230px] text-[14px] font-semibold text-white/88">
          {game.description}
        </p>
      )}

      <HeroMascot emoji={mascot.emoji} label={mascot.name} />

      <div className="relative mt-3.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] font-semibold text-white/85">
        <span className="inline-flex items-center gap-1">📖 {subjectTheme.label}</span>
        <span className="inline-flex items-center gap-1">📋 {typeTheme.label}</span>
        <span className="inline-flex items-center gap-1"><StarIcon className="h-3.5 w-3.5" /> {Number(game.points) || 0} pts</span>
      </div>

      <HeroCTA
        gameId={game.id}
        playedToday={playedToday}
        streakLine={streakLine}
        gradeLabel={hideGrade ? null : game.grade ? `Grade ${game.grade}` : null}
      />
    </section>
  )
}

function HeroMascot({ emoji, label }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="absolute right-[-8px] top-[42px] grid h-[124px] w-[124px] place-items-center rounded-full border-2 border-slate-900 bg-white text-[70px] leading-none shadow-[0_2px_0_#0F1B2D]"
      style={{ transform: 'rotate(6deg)' }}
    >
      <span aria-hidden="true" className="absolute -left-1.5 -top-2.5 text-[22px]">⭐</span>
      <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 text-[18px]">✨</span>
      <span aria-hidden="true" className="zx-hero-bob inline-block">{emoji}</span>
    </div>
  )
}

function HeroCTA({ gameId, playedToday, streakLine, gradeLabel }) {
  const hostRef = useRef(null)
  const linkRef = useRef(null)

  function celebrate() {
    const host = hostRef.current
    if (!host) return
    const colors = ['#FF7A1A', '#0E5E70', '#EAB308', '#16A34A', '#2563EB', '#FFFFFF']
    for (let i = 0; i < 28; i += 1) {
      const piece = document.createElement('span')
      piece.className = 'zx-confetti-piece'
      piece.style.left = `${Math.random() * 100}%`
      piece.style.background = colors[i % colors.length]
      piece.style.animationDelay = `${Math.random() * 0.25}s`
      piece.style.transform = `rotate(${Math.random() * 360}deg)`
      host.appendChild(piece)
      setTimeout(() => piece.remove(), 1500)
    }
  }

  return (
    <div className="relative mt-4 flex flex-wrap items-center gap-3">
      <Link
        to={`/games/play/${gameId}`}
        ref={linkRef}
        onClick={celebrate}
        className="zx-play-btn inline-flex items-center gap-1.5 rounded-full border-2 border-slate-900 bg-[#FF7A1A] px-5 py-3 text-[15px] font-bold text-white shadow-[0_2px_0_#0F1B2D] transition active:translate-y-[2px] active:shadow-none"
      >
        <PlayIcon className="h-4 w-4" />
        {playedToday ? 'Play again' : 'Play now ▸'}
      </Link>
      {streakLine && (
        <span className="text-[12px] font-bold text-white/92">{streakLine}</span>
      )}
      {gradeLabel && (
        <span className="ml-auto rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white/85">
          {gradeLabel}
        </span>
      )}
      <div
        ref={hostRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      />

      <style>{`
        @keyframes zx-confetti-fall {
          0%   { transform: translateY(-20px) rotate(0deg);   opacity: 1; }
          100% { transform: translateY(220px) rotate(720deg); opacity: 0; }
        }
        .zx-confetti-piece {
          position: absolute;
          top: -12px;
          width: 8px;
          height: 14px;
          border-radius: 2px;
          animation: zx-confetti-fall 1.2s ease-out forwards;
        }
        @keyframes zx-pulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.04); }
        }
        .zx-play-btn { animation: zx-pulse 2s ease-in-out infinite; }
        @keyframes zx-hero-bob {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50%      { transform: translateY(-6px) rotate(-3deg); }
        }
        .zx-hero-bob { animation: zx-hero-bob 2.4s ease-in-out infinite; transform-origin: center; }
        @media (prefers-reduced-motion: reduce) {
          .zx-play-btn, .zx-hero-bob { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

function buildStreakLine(streak, playedToday) {
  if (!streak?.signedIn) return 'Sign in to save your streak'
  if (playedToday) return '🔥 Streak saved for today!'
  const n = streak.streak || 0
  if (n <= 0) return '🔥 Win once to start a streak'
  return `🔥 Keep your ${n}-day streak alive`
}

function Skeleton() {
  return (
    <section className="relative overflow-hidden rounded-[26px] border-2 border-slate-900 bg-[#0E5E70]/85 p-5 text-white shadow-[0_6px_0_#0F1B2D]">
      <div className="flex items-start justify-between gap-3">
        <div className="h-7 w-36 animate-pulse rounded-full bg-white/25" />
        <div className="h-4 w-28 animate-pulse rounded-full bg-white/20" />
      </div>
      <div className="mt-4 h-10 w-2/3 animate-pulse rounded-2xl bg-white/25" />
      <div className="mt-2 h-4 w-3/4 animate-pulse rounded-full bg-white/20" />
      <div className="mt-3 flex gap-3">
        <div className="h-4 w-16 animate-pulse rounded bg-white/20" />
        <div className="h-4 w-16 animate-pulse rounded bg-white/20" />
        <div className="h-4 w-16 animate-pulse rounded bg-white/20" />
      </div>
      <div className="mt-4 h-11 w-32 animate-pulse rounded-full bg-white/30" />
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
