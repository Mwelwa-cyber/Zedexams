import { Navigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
// Deep import, not the barrel: `services/entitlements/index.js` re-exports
// guardianRequest, which pulls firebase/config — a Firebase edge on a
// four-line router that only needs one pure predicate.
import MySubscriptionPage from './MySubscriptionPage'

/**
 * What /my-subscription serves.
 *
 * The subscription page moved into the teacher area (/teacher/subscription)
 * so it renders inside the shared shell like every other teacher
 * destination. It could not simply BE moved: /my-subscription is shared with
 * learners, and links to it are already out in the world — notification
 * actions written by subscriptionActivation and reminderCrons, upgrade
 * banners, past emails. So the old path stays and forwards teachers only,
 * which keeps every one of those links resolving to the in-shell page.
 *
 * NOTE on who actually decides. `PortalRouteGuard` sits above the route
 * table and carries the same teacher rule (`TEACHER_ROUTE_REDIRECTS` in
 * `src/utils/portalRedirects.js`), so it answers first and this component's
 * teacher branch does not run in the app. It is kept rather than deleted
 * because the two are not the same statement: the table says "a teacher
 * never renders a learner screen" as a property of the ROUTE, and the line
 * below is this page's own contract with its callers — it is what makes
 * `MySubscriptionRoute` correct when rendered directly, which is how every
 * one of its tests renders it. If the two ever disagree, the table wins,
 * and `test:portal-redirects` pins its half.
 */
export default function MySubscriptionRoute() {
  const { isAdmin, isTeacher, userProfile } = useAuth()
  // Admins first: isTeacher includes superAdmins (AuthContext), so checking
  // isTeacher alone would redirect every admin into the teacher shell.
  if (!isAdmin && isTeacher) return <Navigate to="/teacher/subscription" replace />
  // A legacy parent account (the portal is retired) must never reach this
  // checkout: it sends no beneficiary, so the plan would be stamped on the
  // PARENT's own document and charged for nothing usable. /family is the
  // closed page, which carries the sign-out button.
  if (!isAdmin && userProfile?.role === 'parent') return <Navigate to="/family" replace />
  return <MySubscriptionPage />
}
