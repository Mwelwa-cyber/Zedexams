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
  return children
}
