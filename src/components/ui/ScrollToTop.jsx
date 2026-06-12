/**
 * ScrollToTop — resets the window scroll position to the top on every
 * client-side navigation.
 *
 * React Router v6 with BrowserRouter does NOT reset scroll on route
 * transitions: the app transitions URLs entirely in JS (no real page
 * reload), so the browser never resets scrollY. The result is that
 * navigating to a new route (e.g. opening a studio or document editor)
 * inherits the previous page's scroll offset, landing the user partway
 * down the page instead of at the top.
 *
 * Fix: listen for pathname changes and call window.scrollTo(0, 0) before
 * the new route renders. Using 'instant' (no animation) so the user never
 * sees a flash of the old position. Falls back to { top: 0 } for older
 * browsers that don't support the 'behavior' option.
 *
 * Must be rendered inside <BrowserRouter> so it can call useLocation().
 * Placed in App.jsx next to ThemeApplicator (same pattern — a render-null
 * component that runs a side-effect on location change).
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export default function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    // 'instant' skips the smooth-scroll animation so there is no visible
    // jump. window.scrollTo({ top: 0 }) is the fallback for environments
    // that don't accept the behavior option (old Android WebViews).
    try {
      window.scrollTo({ top: 0, behavior: 'instant' })
    } catch {
      window.scrollTo(0, 0)
    }
  }, [pathname])
  return null
}
