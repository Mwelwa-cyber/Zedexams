/**
 * NotFound — friendly 404 page shown for unknown URLs.
 *
 * App.jsx previously caught `path="*"` and silently bounced back to /, which
 * hid typos and broken links. This page gives users a clear message and a
 * way back to their role's home.
 */
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import { capture } from '../../utils/analytics'
import { reportClientError } from '../../utils/clientErrorReporting'
import { resolveRouteNotFoundSeverity, SEVERITY } from '../../utils/routeNotFoundSeverity'
import SeoHelmet from '../../shared/components/SeoHelmet'

export default function NotFound() {
  const { userProfile } = useAuth()
  const location = useLocation()

  // Record WHICH url missed, and what sent the user there. A 404 reached from
  // inside the app is a broken link we shipped, not a mistyped address — but
  // the page itself gives no clue which, so the report "a Page not found
  // appears during the create flow" has nowhere to start. Every hard-coded
  // /teacher/* link in the studio surfaces was checked against App.jsx's routes
  // and all of them resolve, so the next occurrence needs to identify itself.
  useEffect(() => {
    const path = `${location.pathname}${location.search}`
    const from = typeof document !== 'undefined' ? document.referrer : ''
    const role = userProfile?.role || 'anonymous'
    const origin = typeof window !== 'undefined' ? window.location?.origin : ''
    // A learner-role 404 is escalated (see routeNotFoundSeverity): a learner
    // arrives by tapping something we rendered, so the dead URL is a link we
    // shipped, and it is standing between them and a lesson.
    const verdict = resolveRouteNotFoundSeverity({ role, path, from, origin })

    console.warn('[404] no route matched', { path, from, role, severity: verdict.severity })
    capture('route_not_found', {
      path,
      from,
      role,
      severity: verdict.severity,
      severity_reason: verdict.reason,
      is_learner: verdict.isLearner,
      in_app_link: verdict.inApp,
    })

    // High-severity 404s ALSO go to the client-error sink, which is what the
    // admin error surface reads — an analytics event nobody has a saved view
    // for is not a report. `route_not_found` stays as the funnel event so the
    // existing 30-day counts keep working; this is an addition, not a move.
    if (verdict.severity === SEVERITY.HIGH) {
      const err = new Error(`Learner 404: ${path}`)
      err.name = 'RouteNotFound'
      // force: a broken learner link must not be dropped by the background
      // per-session budget or deduped away by an unrelated earlier error.
      reportClientError(err, 'route_not_found_learner', { force: true })
    }
  }, [location.pathname, location.search, userProfile?.role])

  const homePath = getRoleLandingPath(userProfile, '/login')
  const homeLabel = userProfile?.role === 'admin'
    ? 'Back to Admin'
    : userProfile?.role === 'teacher'
      ? 'Back to Teacher Home'
      : userProfile
        ? 'Back to Dashboard'
        : 'Go to Sign In'

  return (
    <div className="min-h-screen theme-bg flex items-center justify-center p-4">
      {/*
        `path` matters here even though the page is noindex: SeoHelmet falls
        back to the bare origin when it isn't given one, so every unknown URL
        was emitting <link rel="canonical" href="https://zedexams.com/"> next
        to <meta name="robots" content="noindex">. That pair is contradictory
        — it tells Google not to index this URL while pointing the indexing
        signal at the homepage — and Google's guidance is to never combine
        noindex with a canonical to a different page. Self-canonicalling keeps
        the noindex unambiguous.
      */}
      <SeoHelmet title="Page not found" path={location.pathname} noIndex />
      <div className="theme-card border theme-border rounded-3xl px-6 py-10 max-w-md w-full text-center shadow-sm">
        <div className="text-5xl mb-3">🧭</div>
        <p className="theme-text-muted font-black text-xs uppercase tracking-widest mb-2">404 — Page not found</p>
        <h1 className="theme-text text-2xl font-black leading-tight mb-2">
          This page got lost on the way to class.
        </h1>
        <p className="theme-text-muted text-sm mb-6">
          The link may be out of date, or the page was moved. Let's get you back somewhere useful.
        </p>
        <Link
          to={homePath}
          className="inline-flex items-center gap-2 theme-accent-fill theme-on-accent font-black text-sm px-5 py-3 rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
        >
          ← {homeLabel}
        </Link>
      </div>
    </div>
  )
}
