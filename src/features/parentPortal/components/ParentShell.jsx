/**
 * ParentShell — the scaffold every /family route renders inside.
 *
 * Mounted once as a layout route (see ParentLayout), so the navigation
 * persists while only the page swaps — the same fix LearnerLayout made
 * for the learner side's chrome flicker. The Suspense boundary is INSIDE
 * the shell so a lazy page chunk loading cannot blank the navigation.
 *
 * It renders `.lhx .pax`: the learner design system supplies the tokens,
 * the page column and Night mode, and parentApp.css adds only the
 * genuinely parent-shaped components on top. One palette, one Night
 * mode, no second set of white patches to find.
 */
import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../styles/parentApp.css'
import ParentBottomNav from './ParentBottomNav'
import { OfflineBanner } from './ParentPrimitives'
import PageLoader from '../../../shared/components/PageLoader'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'

export default function ParentShell() {
  const online = useNetworkStatus()

  return (
    <div className="lhx pax">
      <div className="lhx-page">
        {online === false && <OfflineBanner />}
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </div>
      <ParentBottomNav />
    </div>
  )
}
