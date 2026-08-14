import { Navigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
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
  const { isAdmin, isTeacher } = useAuth()
  // Admins first: isTeacher includes superAdmins (AuthContext), so checking
  // isTeacher alone would redirect every admin into the teacher shell.
  if (!isAdmin && isTeacher) return <Navigate to="/teacher/subscription" replace />
  return <MySubscriptionPage />
}
