/**
 * LearnerLayout — LearnerShell as a layout route. The shell used to be a
 * per-page wrapper, so the header and navigation remounted on every tab
 * change (the chrome flicker). Mounted once on a pathless <Route
 * element>, the chrome persists while only the page content swaps.
 *
 * The Suspense boundary lives INSIDE the shell (same pattern as
 * TeacherLayout) so a lazy page chunk loading doesn't blank the
 * navigation. The ErrorBoundary sits at the same altitude for the same
 * reason: a page that throws shows the prototype's error card (Zed-style
 * "Oops" + Try again + Go to Home) INSIDE the chrome instead of
 * bubbling to the app-wide full-screen crash card. `resetKey` is the
 * pathname, so tapping a nav tab away from a broken page recovers
 * without a reload — which is also what makes the card's "Go to Home"
 * button work. Auth guards stay on each child route's own line — the
 * route-guard scripts parse them per line, and the chrome itself renders
 * nothing account-specific.
 */
import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import LearnerShell from './LearnerShell'
import LearnerErrorCard from './LearnerErrorCard'
import ErrorBoundary from '../../../shared/components/ErrorBoundary'
import PageLoader from '../../../shared/components/PageLoader'

export default function LearnerLayout() {
  const location = useLocation()
  return (
    <LearnerShell>
      <ErrorBoundary
        resetKey={location.pathname}
        fallback={({ retry }) => <LearnerErrorCard onRetry={retry} />}
      >
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </LearnerShell>
  )
}
