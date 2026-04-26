/**
 * BadgeCard — displays a single competency badge.
 *
 * Props:
 *   badge     — badge object from badges.js
 *   earned    — boolean (true = earned, false = locked/in progress)
 *   earnedAt  — Firestore Timestamp or Date (optional)
 *   progress  — 0-100 (shown when not yet earned)
 *   size      — 'sm' | 'md' | 'lg' (default 'md')
 *   compact   — true = small icon-only chip for strips
 */
import { BADGE_TIERS } from '../../config/badges'

export default function BadgeCard({ badge, earned = false, earnedAt = null, progress = 0, size = 'md', compact = false }) {
  if (!badge) return null

  const tier   = BADGE_TIERS[badge.tier] ?? BADGE_TIERS.bronze

  function fmt(ts) {
    if (!ts) return null
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  // ── Compact chip (for badge strips) ──────────────────────────
  if (compact) {
    return (
      <div
        title={`${badge.name} — ${earned ? 'Earned' : `${progress}% progress`}`}
        className={`flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-2xl border transition-all ${
          earned
            ? `${tier.bg} ${tier.text} border-transparent shadow-sm`
            : 'bg-gray-50 border-gray-200 text-gray-400'
        }`}
        style={{ minWidth: 64 }}
      >
        <span className={`text-2xl ${earned ? '' : 'grayscale opacity-50'}`}>{badge.icon}</span>
        <span className="text-xs font-black text-center leading-tight" style={{ maxWidth: 70 }}>
          {badge.name}
        </span>
        {earned && (
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${tier.bg} ${tier.text}`}>
            {tier.label}
          </span>
        )}
        {!earned && progress > 0 && (
          <div className="w-full bg-gray-200 rounded-full h-1 mt-0.5">
            <div
              className="bg-blue-500 h-1 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  // ── Full card ────────────────────────────────────────────────
  const sizeClasses = {
    sm: 'p-3 rounded-2xl',
    md: 'p-4 rounded-2xl',
    lg: 'p-5 rounded-3xl',
  }[size] ?? 'p-4 rounded-2xl'

  const iconSizes = { sm: 'text-3xl', md: 'text-4xl', lg: 'text-5xl' }[size] ?? 'text-4xl'

  return (
    <div
      className={`relative border transition-all ${sizeClasses} ${
        earned
          ? `bg-white theme-border shadow-sm hover:shadow-md`
          : 'bg-gray-50 theme-border opacity-75'
      }`}
    >
      {/* Tier ribbon */}
      <div className={`absolute top-2 right-2 text-xs font-bold px-2 py-0.5 rounded-full ${tier.bg} ${tier.text}`}>
        {tier.label}
      </div>

      {/* Lock overlay */}
      {!earned && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded-2xl pointer-events-none">
          <span className="text-2xl opacity-40">🔒</span>
        </div>
      )}

      <div className="flex items-start gap-3">
        {/* Icon */}
        <span className={`${iconSizes} ${earned ? '' : 'grayscale opacity-40'} flex-shrink-0`}>
          {badge.icon}
        </span>

        {/* Info */}
        <div className="flex-1 min-w-0 pt-0.5">
          <p className={`font-black text-sm leading-snug ${earned ? 'text-gray-800' : 'text-gray-500'}`}>
            {badge.name}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{badge.description}</p>

          {/* Competency tag */}
          <span className="inline-block mt-1.5 bg-blue-50 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
            {badge.competency}
          </span>

          {/* Earned date */}
          {earned && earnedAt && (
            <p className="text-xs text-gray-400 mt-1.5">🗓 Earned {fmt(earnedAt)}</p>
          )}

          {/* Progress bar (not earned) */}
          {!earned && (
            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Progress</span>
                <span className="font-bold">{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {badge.criteria.minAttempts > 1
                  ? `Complete ${badge.criteria.minAttempts} qualifying quizzes with ${badge.criteria.minScore}%+`
                  : `Score ${badge.criteria.minScore}%+ in ${badge.subject !== 'any' ? badge.subject.replace('-', ' ') : 'any subject'}`
                }
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
