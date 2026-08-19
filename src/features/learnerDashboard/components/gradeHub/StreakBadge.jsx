/**
 * The "N day streak!" pill. Renders nothing below two days — a one-day streak
 * is not yet a streak.
 */
import { memo } from 'react'
import { FireIcon } from '../../../../shared/components/icons'
import Icon from '../../../../shared/components/Icon'

const StreakBadge = memo(function StreakBadge({ streak, tone = 'page' }) {
  if (!streak || streak < 2) return null
  // The hero is always a dark gradient, so the badge keeps the
  // translucent-white look there. Anywhere on a light surface we use a
  // warm orange tile that reads on white cards.
  const heroPalette = {
    wrap: 'bg-orange-500/15 border-orange-300/40',
    icon: 'text-orange-200',
    text: 'text-orange-100',
  }
  const pagePalette = {
    wrap: 'bg-orange-50 border-orange-200',
    icon: 'text-orange-600',
    text: 'text-orange-700',
  }
  const p = tone === 'hero' ? heroPalette : pagePalette
  return (
    <div className={`flex items-center gap-1 border rounded-full px-2.5 py-1 ${p.wrap}`}>
      <Icon as={FireIcon} size="sm" strokeWidth={2.1} className={p.icon} />
      <span className={`text-xs font-black ${p.text}`}>{streak} day streak!</span>
    </div>
  )
})

export default StreakBadge
