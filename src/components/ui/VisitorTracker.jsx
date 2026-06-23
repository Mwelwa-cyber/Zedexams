/**
 * VisitorTracker — fires a first-party page-view beacon on every client-
 * side navigation, feeding the /admin/visitors dashboard.
 *
 * Render-null side-effect component (same pattern as ScrollToTop): it
 * listens for pathname changes via useLocation and calls trackPageview.
 * All the consent + best-effort logic lives in utils/visitorTracking; this
 * is just the router glue. Must be rendered inside <BrowserRouter>.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackPageview } from '../../utils/visitorTracking'

export default function VisitorTracker() {
  const { pathname } = useLocation()
  useEffect(() => {
    trackPageview(pathname)
  }, [pathname])
  return null
}
