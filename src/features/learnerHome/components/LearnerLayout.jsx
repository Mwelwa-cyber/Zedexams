/**
 * LearnerLayout — LearnerShell as a layout route. The shell used to be a
 * per-page wrapper, so the header and navigation remounted on every tab
 * change (the chrome flicker). Mounted once on a pathless <Route
 * element>, the chrome persists while only the page content swaps.
 *
 * The Suspense boundary lives INSIDE the shell (same pattern as
 * TeacherLayout) so a lazy page chunk loading doesn't blank the
 * navigation. Auth guards stay on each child route's own line — the
 * route-guard scripts parse them per line, and the chrome itself renders
 * nothing account-specific.
 */
import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import LearnerShell from './LearnerShell'
import PageLoader from '../../../shared/components/PageLoader'

export default function LearnerLayout() {
  return (
    <LearnerShell>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </LearnerShell>
  )
}
