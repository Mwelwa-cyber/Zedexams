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
 *
 * ── Two things live here rather than on each page ───────────────────
 *
 * `GuardianChildrenProvider` gives the whole section one children fetch
 * instead of one per screen, which is what lets the chrome ask a
 * question (is anybody still on the free plan?) without doubling the
 * calls the page already makes.
 *
 * `FamilyPlanBanner` is inside `.lhx-page` on purpose. The app-level
 * subscription strip renders above the router and full bleed, and at
 * >=1000px the family navigation is a fixed sidebar painted over its
 * left edge — so it arrived clipped, and it reached the four family
 * screens inconsistently. In the page column it is offset like every
 * other element and appears on all four, once.
 */
import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../styles/parentApp.css'
import ParentBottomNav from './ParentBottomNav'
import FamilyPlanBanner from './FamilyPlanBanner'
import { OfflineBanner } from './ParentPrimitives'
import PageLoader from '../../../shared/components/PageLoader'
import { GuardianChildrenProvider } from '../hooks/useGuardianChildren'
import { useNetworkStatus } from '../../../hooks/useNetworkStatus'

export default function ParentShell() {
  const online = useNetworkStatus()

  return (
    <GuardianChildrenProvider>
      <div className="lhx pax">
        <div className="lhx-page">
          {online === false && <OfflineBanner />}
          <FamilyPlanBanner />
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </div>
        <ParentBottomNav />
      </div>
    </GuardianChildrenProvider>
  )
}
