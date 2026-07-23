import { useEffect, useState } from 'react'

const QUERY = '(max-width: 767px)'

/**
 * True below 768px — the dashboard swaps to its dedicated mobile
 * information architecture (MobileDashboardView) instead of squeezing the
 * desktop layout. Live-updates on rotate/resize.
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
    const onChange = (e) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
