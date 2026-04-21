/**
 * BadgesPage — full-page view of all earned + progress badges.
 */
import { useEffect, useState } from 'react'
import { Link }        from 'react-router-dom'
import { useAuth }     from '../../contexts/AuthContext'
import { useBadges }   from '../../hooks/useBadges'
import { BADGES }      from '../../config/badges'
import BadgeCard       from '../ui/BadgeCard'
import ProfessorPako   from '../ui/ProfessorPako'
import { useDataSaver } from '../../contexts/DataSaverContext'
import { GAME_BADGES, BADGE_TIER_STYLES } from '../../data/gameBadges'
import { getMyGameBadges, formatAwardedAt } from '../../utils/gameBadgesService'

export default function BadgesPage() {
  const { currentUser }       = useAuth()
  const { earned, progress, loading } = useBadges(currentUser?.uid)
  const { dataSaver }         = useDataSaver()

  // Game badges — from the /games surface
  const [gameBadges, setGameBadges] = useState(null)
  useEffect(() => {
    if (!currentUser) { setGameBadges({}); return }
    let cancelled = false
    getMyGameBadges().then(({ byId }) => { if (!cancelled) setGameBadges(byId || {}) })
    return () => { cancelled = true }
  }, [currentUser])

  const earnedIds = new Set(earned.map(b => b.id))
  const progressMap = Object.fromEntries(progress.map(p => [p.badge.id, p]))
  const earnedGameBadgeIds = new Set(Object.keys(gameBadges || {}))
  const totalEarned = earned.length + earnedGameBadgeIds.size
  const totalPossible = BADGES.length + GAME_BADGES.length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        {!dataSaver && <ProfessorPako size={60} mood={totalEarned > 3 ? 'excited' : 'normal'} animate={false} />}
        <div>
          <h1 className="text-2xl font-black theme-text">🏆 My Badges</h1>
          <p className="theme-text-muted text-sm mt-0.5">
            {totalEarned} of {totalPossible} badges earned
          </p>
        </div>
      </div>

      {/* ── Game Badges (from /games) ─────────────────────────── */}
      {gameBadges && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black theme-text text-sm">🎮 Game Badges ({earnedGameBadgeIds.size}/{GAME_BADGES.length})</h2>
            <Link to="/games" className="text-xs font-black text-amber-700 hover:text-amber-900">Play games →</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {GAME_BADGES.map((b) => (
              <GameBadgeCard
                key={b.id}
                badge={b}
                earned={earnedGameBadgeIds.has(b.id)}
                awardedAt={gameBadges[b.id]?.awardedAt}
              />
            ))}
          </div>
        </section>
      )}

      {/* Earned */}
      {earned.length > 0 && (
        <section>
          <h2 className="font-black theme-text mb-3 text-sm">✅ Earned ({earned.length})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {earned.map(b => (
              <BadgeCard key={b.id} badge={b} earned earnedAt={b.earnedAt} size="md" />
            ))}
          </div>
        </section>
      )}

      {/* In Progress */}
      {progress.length > 0 && (
        <section>
          <h2 className="font-black theme-text mb-3 text-sm">🔄 In Progress ({progress.length})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {progress
              .sort((a, b) => b.progress - a.progress)
              .slice(0, 6)
              .map(({ badge, progress: pct, avgScore, totalAttempts }) => (
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
            <h2 className="font-black theme-text mb-3 text-sm">🔒 Locked ({locked.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div key={i} className="theme-card rounded-2xl border theme-border p-4 animate-pulse h-24" />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Game Badge card (used above) ─────────────────────────────── */

function GameBadgeCard({ badge, earned, awardedAt }) {
  const tier = BADGE_TIER_STYLES[badge.tier] || BADGE_TIER_STYLES.bronze
  if (earned) {
    return (
      <div className={`relative rounded-2xl border-2 ${tier.border} ${tier.bg} p-4`}>
        <div className="flex items-start gap-3">
          <div className="text-4xl shrink-0" aria-hidden="true">{badge.icon}</div>
          <div className="flex-1 min-w-0">
            <h3 className={`font-black leading-tight ${tier.text}`}>{badge.name}</h3>
            <p className="text-xs theme-text-muted mt-0.5 line-clamp-2">{badge.description}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${tier.text} bg-white/70`}>
                {tier.label}
              </span>
              {awardedAt && (
                <span className="text-[10px] font-bold theme-text-muted">
                  earned {formatAwardedAt(awardedAt)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="relative rounded-2xl border-2 border-dashed theme-border theme-card p-4 opacity-80">
      <div className="flex items-start gap-3">
        <div className="text-4xl shrink-0 grayscale opacity-50" aria-hidden="true">{badge.icon}</div>
        <div className="flex-1 min-w-0">
          <h3 className="font-black theme-text leading-tight">{badge.name}</h3>
          <p className="text-xs theme-text-muted mt-0.5 line-clamp-2">{badge.hint}</p>
          <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider theme-text-muted theme-bg-subtle">
            🔒 Locked
          </span>
        </div>
      </div>
    </div>
  )
}
