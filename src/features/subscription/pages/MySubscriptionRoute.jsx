import { Navigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
// Deep import, not the barrel: `services/entitlements/index.js` re-exports
// guardianRequest, which pulls firebase/config — a Firebase edge on a
// four-line router that only needs one pure predicate.
import { mayShowPrice } from '../../../services/entitlements/planState'
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
 */
export default function MySubscriptionRoute() {
  const { isAdmin, isTeacher, userProfile } = useAuth()
  // Admins first: isTeacher includes superAdmins (AuthContext), so checking
  // isTeacher alone would redirect every admin into the teacher shell.
  if (!isAdmin && isTeacher) return <Navigate to="/teacher/subscription" replace />
  // A learner who is not positively an adult never reaches the plan
  // ladder or the checkout — the commitment on /child-safety and Play's
  // Families policy. This is the ARRIVAL guard rather than the offer
  // guard: the banners and cards already route the tap elsewhere, but an
  // old notification action, a bookmark or a shared link all land here,
  // and each of those would otherwise open a price list. `mayShowPrice`
  // treats a missing profile as an anonymous visitor, not as a child —
  // this route is behind ProtectedRoute, so there is always one.
  if (!isAdmin && !mayShowPrice(userProfile)) {
    return <Navigate to="/ask-a-grown-up" replace />
  }
  return <MySubscriptionPage />
}
