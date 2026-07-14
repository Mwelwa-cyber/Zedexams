/**
 * StudioGate — route-level gate for the teacher generator studios.
 *
 * Free-plan teachers can only OPEN the Lesson Plan studio; every other
 * generator studio is wrapped in this gate in App.jsx. For a Free teacher it
 * renders <LockedStudio> (a read-only sample + upgrade CTA) in place of the
 * real studio, so the studio's own component (and its generation calls) never
 * mount. Pro/Max teachers — and super-admins, who resolve to 'max' — get the
 * studio unchanged.
 *
 * Gating at the route boundary (rather than inside each studio) keeps the
 * studios untouched and avoids conditional-hook pitfalls: the locked branch
 * simply renders a different element.
 */

import { lazy, Suspense } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { resolveTeacherPlan } from '../../utils/teacherPlans'
import PageLoader from '../ui/PageLoader'
import UsageReminderBanner from '../subscription/UsageReminderBanner'

const LockedStudio = lazy(() => import('./LockedStudio'))

export default function StudioGate({ tool, children }) {
  const { userProfile } = useAuth()

  if (resolveTeacherPlan(userProfile) === 'free') {
    return (
      <Suspense fallback={<PageLoader />}>
        <LockedStudio tool={tool} />
      </Suspense>
    )
  }
  return (
    <>
      {/* Soft usage reminder (~80% of this studio's allowance) — a slim
          dismissible strip, so a paying teacher approaching a cap is warned
          BEFORE the contextual paywall interrupts a generation. */}
      <UsageReminderBanner tool={tool} className="mt-3 px-1 sm:px-2" />
      {children}
    </>
  )
}
