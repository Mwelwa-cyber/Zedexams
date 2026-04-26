/**
 * BadgesPage — full-page view of all earned + progress badges.
 */
import { useEffect, useState } from 'react'
import { Link }        from 'react-router-dom'
import {
  ArrowPathIcon,
  CheckBadgeIcon,
  LockClosedIcon,
  PuzzlePieceIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid'
import { useAuth }     from '../../contexts/AuthContext'
import { useBadges }   from '../../hooks/useBadges'
import { BADGES }      from '../../config/badges'
import BadgeCard       from '../ui/BadgeCard'
import ProfessorPako   from '../ui/ProfessorPako'
import { useDataSaver } from '../../contexts/DataSaverContext'
import { GAME_BADGES } from '../../data/gameBadges'
import { getMyGameBadges, formatAwardedAt } from '../../utils/gameBadgesService'
import { GameBadgeCard as GamesBadgeCard } from '../games/gamesUi'

export default function BadgesPage() {
  const { currentUser }       = useAuth()
  const { earned, progress, loading } = useBadges(currentUser?.uid)
  const { dataSaver }         = useDataSaver()

  // Game badges — from the /games surface
  const [gameBadges, setGameBadges] = useState(null)
  useEffect(() => {
    if (!currentUser) { setGameBadges({}); return }
    let cancelled = false
    getMyGameBadges()
      .then(({ byId }) => { if (!cancelled) setGameBadges(byId || {}) })
      .catch(() => { if (!cancelled) setGameBadges({}) })
    return () => { cancelled = true }
  }, [currentUser])

  const earnedIds = new Set(earned.map(b => b.id))
  const progressMap = Object.fromEntries(progress.map(p => [p.badge.id, p]))
  const earnedGameBadgeIds = new Set(Object.keys(gameBadges || {}))
  const totalEarned = earned.length + earnedGameBadgeIds.size
  const totalPossible = BADGES.length + GAME_BADGES.length
  const completionPct = totalPossible
    ? Math.round((totalEarned / totalPossible) * 100)
    : 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Hero — gradient surface with Pako, big counter, and a progress
          ring. Replaces the old flat header so the page opens with a
          sense of accomplishment instead of a list. */}
      <div className="relative overflow-hidden rounded-radius-lg theme-hero shadow-elev-lg shadow-elev-inner-hl px-5 py-6 sm:px-7 sm:py-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/15 blur-2xl"
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {!dataSaver && (
              <ProfessorPako
                size={68}
                mood={totalEarned > 3 ? 'excited' : 'normal'}
                animate={false}
              />
            )}
            <div className="text-white">
              <p className="text-eyebrow text-white/80">Achievements</p>
              <h1 className="inline-flex items-center gap-2 text-display-xl mt-0.5">
                <TrophyIcon className="h-7 w-7 text-amber-300" />
                My Badges
              </h1>
              <p className="text-white/85 text-body-sm mt-1">
                {totalEarned} of {totalPossible} badges earned
              </p>
            </div>
          </div>
          {/* Progress ring + numeric — gives a glanceable completion read. */}
          <div className="flex items-center gap-3 self-start sm:self-center">
            <div className="relative h-20 w-20 shrink-0">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle
                  cx="50" cy="50" r="42"
                  fill="none"
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth="8"
                />
                <circle
                  cx="50" cy="50" r="42"
                  fill="none"
                  stroke="white"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(completionPct / 100) * 263.89} 263.89`}
                  className="transition-all duration-slow ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-white font-display font-black text-base">
                {completionPct}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Game Badges (from /games) ─────────────────────────── */}
      {gameBadges && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="inline-flex items-center gap-2 font-black theme-text text-sm">
              <PuzzlePieceIcon className="h-4 w-4 text-amber-500" />
              Game Badges ({earnedGameBadgeIds.size}/{GAME_BADGES.length})
            </h2>
            <Link to="/games" className="text-xs font-black text-amber-700 hover:text-amber-900">Play games →</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 stagger">
            {GAME_BADGES.map((b) => (
              <GamesBadgeCard
                key={b.id}
                badge={b}
                earned={earnedGameBadgeIds.has(b.id)}
                subtitle={
                  earnedGameBadgeIds.has(b.id)
                    ? gameBadges[b.id]?.awardedAt
                      ? `${b.description} Earned ${formatAwardedAt(gameBadges[b.id]?.awardedAt)}.`
                      : b.description
                    : b.hint
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Earned */}
      {earned.length > 0 && (
        <section>
          <h2 className="inline-flex items-center gap-2 font-black theme-text mb-3 text-sm">
            <CheckBadgeIcon className="h-4 w-4 text-emerald-500" />
            Earned ({earned.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 stagger">
            {earned.map(b => (
              <BadgeCard key={b.id} badge={b} earned earnedAt={b.earnedAt} size="md" />
            ))}
          </div>
        </section>
      )}

      {/* In Progress */}
      {progress.length > 0 && (
        <section>
          <h2 className="inline-flex items-center gap-2 font-black theme-text mb-3 text-sm">
            <ArrowPathIcon className="h-4 w-4 text-sky-500" />
            In Progress ({progress.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 stagger">
            {progress
              .sort((a, b) => b.progress - a.progress)
              .slice(0, 6)
              .map(({ badge, progress: pct }) => (
                <BadgeCard
                  key={badge.id}
                  badge={badge}
                  earned={false}
                  progress={pct}
                  size="md"
                />
              ))}
          </div>
        </section>
      )}

      {/* Locked (not started) */}
      {(() => {
        const locked = BADGES.filter(b => !earnedIds.has(b.id) && !progressMap[b.id])
        return locked.length > 0 ? (
          <section>
            <h2 className="inline-flex items-center gap-2 font-black theme-text mb-3 text-sm">
              <LockClosedIcon className="h-4 w-4 text-slate-500" />
              Locked ({locked.length})
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 stagger">
              {locked.map(b => (
                <BadgeCard key={b.id} badge={b} earned={false} progress={0} size="md" />
              ))}
            </div>
          </section>
        ) : null
      })()}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="theme-card rounded-2xl border theme-border shadow-elev-sm p-4 animate-pulse h-24" />
          ))}
        </div>
      )}
    </div>
  )
}
