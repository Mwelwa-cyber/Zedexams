import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import useLearnerStats from '../../hooks/useLearnerStats'
import { streakBadge } from '../../utils/gamificationService'

/**
 * StreakXpCard — the headline gamification panel on the student dashboard.
 *
 *   ⭐ Level + title + XP progress bar
 *   🔥 Streak counter with milestone badge
 *   🏆 Best percentage to date
 *
 * Subscribes to /learnerStats/{uid} in real time, so a fresh exam submission
 * (which writes XP + streak via gamificationService.recordExamCompletion)
 * is reflected here within ms — no reload needed.
 */
export default function StreakXpCard() {
  const { currentUser } = useAuth()
  const { stats, level, loading } = useLearnerStats(currentUser?.uid)

  if (!currentUser?.uid) return null

  const streak = stats?.currentStreak ?? 0
  const longest = stats?.longestStreak ?? 0
  const best = stats?.bestPercentage ?? 0
  const exams = stats?.examsCompleted ?? 0
  const streakInfo = streakBadge(streak)

  return (
    <section className="rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-amber-700">
            Your progress
          </p>
          <h2 className="mt-0.5 text-lg font-black text-slate-800 flex items-center gap-2">
            <span aria-hidden="true">{level.icon}</span>
            Level {level.level} · {level.title}
          </h2>
        </div>
        <Link
          to="/my-badges"
          className="rounded-full bg-white/80 px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-200 hover:bg-white"
        >
          Badges →
        </Link>
      </div>

      {/* XP bar */}
      <div className="mt-3">
        <div className="flex items-end justify-between gap-2 mb-1">
          <p className="text-xs font-bold text-slate-600">
            {loading ? '…' : `${stats?.xp ?? 0} XP`}
          </p>
          <p className="text-xs font-bold text-slate-500">
            {level.nextLevel
              ? `${level.xpRemaining} XP to ${level.nextLevel.title}`
              : 'Max level reached'}
          </p>
        </div>
        <div className="h-3 w-full rounded-full bg-white/70 ring-1 ring-amber-200 overflow-hidden">
          <div
            className="h-3 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 transition-all duration-700"
            style={{ width: `${level.progress}%` }}
          />
        </div>
      </div>

      {/* Three-up stat row */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-white/80 ring-1 ring-amber-200 p-2.5 text-center">
          <p className="text-xl font-black text-orange-600 flex items-center justify-center gap-1">
            <span aria-hidden="true">🔥</span>{streak}
          </p>
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 mt-0.5">
            Day streak
          </p>
          {streakInfo && (
            <p className="text-[10px] font-bold text-amber-700 truncate">{streakInfo.label}</p>
          )}
        </div>
        <div className="rounded-xl bg-white/80 ring-1 ring-amber-200 p-2.5 text-center">
          <p className="text-xl font-black text-green-600">
            {best > 0 ? `${best}%` : '—'}
          </p>
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 mt-0.5">
            Best %
          </p>
          {longest > 0 && (
            <p className="text-[10px] font-bold text-slate-500">Longest: {longest}d</p>
          )}
        </div>
        <div className="rounded-xl bg-white/80 ring-1 ring-amber-200 p-2.5 text-center">
          <p className="text-xl font-black text-blue-600">{exams}</p>
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 mt-0.5">
            Exams done
          </p>
          <Link
            to="/exams/leaderboard"
            className="text-[10px] font-bold text-blue-600 hover:underline"
          >
            Leaderboard →
          </Link>
        </div>
      </div>

      {/* Encouragement / next milestone */}
      <p className="mt-3 text-xs font-bold text-slate-600">
        {streak === 0
          ? '👉 Complete a daily exam today to start your streak.'
          : streak < 3
            ? `Keep going — ${3 - streak} more day${3 - streak === 1 ? '' : 's'} unlocks your 3-day badge.`
            : streak < 7
              ? `${7 - streak} more day${7 - streak === 1 ? '' : 's'} to a 7-day streak. You can do it!`
              : streak < 30
                ? `${30 - streak} more day${30 - streak === 1 ? '' : 's'} until the 30-day Diamond Streak.`
                : '👑 You are on a Diamond Streak. Don’t break the chain.'}
      </p>
    </section>
  )
}
