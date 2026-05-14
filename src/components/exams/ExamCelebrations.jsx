import { useEffect, useRef, useState } from 'react'
import Confetti from '../games/Confetti'

/**
 * ExamCelebrations — animated overlay shown on the ExamResultsPage to make
 * a fresh submission feel like an event.
 *
 * Props:
 *   result      — the object returned by recordExamCompletion()
 *   myRank      — viewer's rank on today's leaderboard for this subject
 *   leaderboardSize — total participants today (for context)
 *
 * Rendered components:
 *   - Confetti burst for personal best, top-3 finish, or level-up
 *   - A stacked banner list: personal best, rank, level-up, streak milestone
 *   - Animated XP gain
 *
 * Banners are dismissible and auto-clear after 14s.
 */
export default function ExamCelebrations({ result, myRank = null, leaderboardSize = 0 }) {
  const [dismissed, setDismissed] = useState(new Set())
  const [fire, setFire] = useState(0)
  const firedRef = useRef(false)

  useEffect(() => {
    if (!result?.ok || result.deduped) return
    if (firedRef.current) return
    firedRef.current = true
    // Confetti for any "big" moment.
    if (
      result.isPersonalBest ||
      result.leveledUp ||
      (myRank && myRank <= 3) ||
      (result.streakMilestone && result.streakMilestone >= 3)
    ) {
      setFire(t => t + 1)
    }
    const id = setTimeout(() => setDismissed(new Set(['rank', 'pb', 'level', 'streak'])), 14000)
    return () => clearTimeout(id)
  }, [result?.ok, result?.deduped, result?.isPersonalBest, result?.leveledUp, result?.streakMilestone, myRank])

  if (!result?.ok || result.deduped) return null

  const banners = []
  if (result.isPersonalBest && !dismissed.has('pb')) {
    banners.push({
      key: 'pb',
      tone: 'green',
      icon: '🌟',
      title: 'New personal best!',
      detail: result.previousBestPercentage > 0
        ? `Up from ${result.previousBestPercentage}% — keep climbing.`
        : 'You set the bar. Time to beat it.',
    })
  }
  if (myRank != null && myRank > 0 && !dismissed.has('rank')) {
    if (myRank === 1) {
      banners.push({
        key: 'rank',
        tone: 'gold',
        icon: '🥇',
        title: `#1 today — you are leading the leaderboard!`,
        detail: leaderboardSize > 1 ? `Out of ${leaderboardSize} students.` : null,
      })
    } else if (myRank <= 3) {
      banners.push({
        key: 'rank',
        tone: 'gold',
        icon: myRank === 2 ? '🥈' : '🥉',
        title: `Top 3 finish — Rank #${myRank}!`,
        detail: leaderboardSize > 1 ? `Out of ${leaderboardSize} students today.` : null,
      })
    } else if (myRank <= 10) {
      banners.push({
        key: 'rank',
        tone: 'amber',
        icon: '🏆',
        title: `You entered the Top 10 — Rank #${myRank}!`,
        detail: leaderboardSize > 1 ? `Out of ${leaderboardSize} students.` : null,
      })
    }
  }
  if (result.leveledUp && !dismissed.has('level')) {
    banners.push({
      key: 'level',
      tone: 'purple',
      icon: result.newLevel?.icon ?? '⭐',
      title: `Level Up! You are now Level ${result.newLevel.level} (${result.newLevel.title}).`,
      detail: `+${result.xpEarned} XP earned this round.`,
    })
  } else if (result.xpEarned && !dismissed.has('xp')) {
    banners.push({
      key: 'xp',
      tone: 'blue',
      icon: '⭐',
      title: `+${result.xpEarned} XP earned`,
      detail: result.newLevel?.nextLevel
        ? `${result.newLevel.xpRemaining} XP to ${result.newLevel.nextLevel.title}.`
        : null,
    })
  }
  if (result.streakMilestone && !dismissed.has('streak')) {
    banners.push({
      key: 'streak',
      tone: 'red',
      icon: '🔥',
      title: `${result.streakAfter}-day streak unlocked!`,
      detail: result.streakMilestone === 1
        ? 'Come back tomorrow to keep it alive.'
        : 'Protect the chain — practise again tomorrow.',
    })
  } else if (result.streakAfter > 0 && result.streakAfter !== result.streakBefore && !dismissed.has('streak')) {
    banners.push({
      key: 'streak',
      tone: 'orange',
      icon: '🔥',
      title: `${result.streakAfter}-day streak going strong.`,
      detail: 'Keep the chain alive — practise again tomorrow.',
    })
  }

  if (banners.length === 0) return null

  return (
    <>
      <Confetti fire={fire} />
      <div className="space-y-2.5">
        {banners.map((b, i) => (
          <Banner
            key={b.key}
            banner={b}
            index={i}
            onDismiss={() => setDismissed(prev => new Set(prev).add(b.key))}
          />
        ))}
      </div>
      <style>{`
        @keyframes zx-celebrate-slide {
          0%   { transform: translateY(-8px) scale(0.97); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>
    </>
  )
}

const TONES = {
  gold:   'from-yellow-50 to-amber-50 border-amber-300 text-amber-900',
  amber:  'from-amber-50 to-orange-50 border-amber-300 text-amber-900',
  green:  'from-emerald-50 to-green-50 border-emerald-300 text-emerald-900',
  blue:   'from-sky-50 to-blue-50 border-blue-300 text-blue-900',
  purple: 'from-violet-50 to-fuchsia-50 border-violet-300 text-violet-900',
  red:    'from-rose-50 to-red-50 border-rose-300 text-rose-900',
  orange: 'from-orange-50 to-amber-50 border-orange-300 text-orange-900',
}

function Banner({ banner, index, onDismiss }) {
  const tone = TONES[banner.tone] || TONES.amber
  return (
    <div
      className={`relative flex items-start gap-3 rounded-2xl border-2 bg-gradient-to-br p-3 shadow-sm ${tone}`}
      style={{ animation: `zx-celebrate-slide 0.45s ease-out ${index * 90}ms both` }}
    >
      <span className="text-2xl flex-shrink-0" aria-hidden="true">{banner.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-black leading-snug">{banner.title}</p>
        {banner.detail && (
          <p className="text-xs font-bold opacity-80 mt-0.5">{banner.detail}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-current opacity-50 hover:opacity-100"
      >
        ×
      </button>
    </div>
  )
}
