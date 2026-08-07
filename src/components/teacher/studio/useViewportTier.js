import { useEffect, useState } from 'react'

/**
 * Which of the studio's three width tiers the viewport is in.
 *
 *   narrow  < 768px   — phone. The bottom dock owns view navigation, the
 *                       document title stacks onto two lines, and tapping it
 *                       opens the paper-details sheet.
 *   medium  768–899   — the title compresses ("EOT 1") but stays on one line.
 *   wide    ≥ 900px   — the title prints in full.
 *
 * A hook rather than a media query because the title is COMPOSED differently
 * per tier, not merely styled differently — the narrow form is two elements
 * with different content, and rendering all three and hiding two would ship
 * three copies of the title to every screen reader.
 *
 * Mirrors the defensive shape of dashboardV2/useIsMobile: re-syncs at mount
 * (a hydrated initial state can be stale after a rotate) and falls back to the
 * legacy addListener API, because throwing here would unmount the studio.
 */

const NARROW = '(max-width: 767px)'
const WIDE = '(min-width: 900px)'

function readTier() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide'
  if (window.matchMedia(NARROW).matches) return 'narrow'
  if (window.matchMedia(WIDE).matches) return 'wide'
  return 'medium'
}

export default function useViewportTier() {
  const [tier, setTier] = useState(readTier)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    setTier(readTier())
    const sync = () => setTier(readTier())
    const lists = [window.matchMedia(NARROW), window.matchMedia(WIDE)]
    const teardown = lists.map((mql) => {
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', sync)
        return () => mql.removeEventListener('change', sync)
      }
      if (typeof mql.addListener === 'function') {
        mql.addListener(sync)
        return () => mql.removeListener(sync)
      }
      return () => {}
    })
    return () => teardown.forEach((off) => off())
  }, [])

  return tier
}
