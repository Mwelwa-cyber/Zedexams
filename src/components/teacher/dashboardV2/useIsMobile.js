import { useEffect, useState } from 'react'

const QUERY = '(max-width: 767px)'

/**
 * True below 768px — the dashboard swaps to its dedicated mobile
 * information architecture (MobileDashboardView) instead of squeezing the
 * desktop layout. Live-updates on rotate/resize.
 *
 * The canonical breakpoints for this surface:
 *   • mobile  < 768px   — mobile IA (bottom nav, drawer), desktop sidebar
 *                          removed from layout entirely
 *   • tablet  768–1023  — desktop DOM with the compact icon rail (CSS)
 *   • desktop ≥ 1024    — full desktop sidebar (CSS)
 * Layout differences within the desktop DOM are pure CSS; this hook only
 * decides which DOM (mobile vs desktop) renders.
 */
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(QUERY).matches
      : false,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(QUERY)
    // Re-sync at mount: a restored/hydrated initial state can be stale if
    // the viewport changed (e.g. rotation) before the effect ran.
    setIsMobile(mql.matches)
    const onChange = (e) => setIsMobile(e.matches)
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    // Safari < 14 / older WebViews: MediaQueryList has no addEventListener.
    // Throwing here unmounted the whole dashboard tree and left phones on
    // the CSS-default desktop layout — use the legacy listener API instead.
    if (typeof mql.addListener === 'function') {
      mql.addListener(onChange)
      return () => mql.removeListener(onChange)
    }
    return undefined
  }, [])

  return isMobile
}
