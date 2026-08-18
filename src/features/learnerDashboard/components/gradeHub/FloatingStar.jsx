/**
 * One decorative star drifting behind the hero.
 *
 * Memoised, and its `style` must be a stable module-scope object — see
 * FLOATING_STAR_STYLES in ./dashboardArt.
 */
import { memo } from 'react'

const FloatingStar = memo(function FloatingStar({ style }) {
  return (
    <span
      className="absolute text-white/20 select-none pointer-events-none animate-float"
      style={style}
    >★</span>
  )
})

export default FloatingStar
