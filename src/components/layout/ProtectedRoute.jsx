import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import FullScreenLoader from '../ui/FullScreenLoader'
import MissingProfileRecovery from '../auth/MissingProfileRecovery'

const ROLE_LEVEL = { superAdmin: 4, admin: 3, teacher: 2, learner: 1, student: 1 }

export default function ProtectedRoute({ children, requiredRole }) {
  const { currentUser, userProfile, loading, profileIssue } = useAuth()
  const location = useLocation()

  // Branded splash (not the thin bar) while the session + profile resolve on a
  // cold start / reload, so a returning user never sees a blank white page.
  // Firebase restores the persisted session asynchronously — currentUser is
  // null on the first frames even for a signed-in user — so we must never
  // redirect to /login while `loading` is still true.
  if (loading) return <FullScreenLoader label="Restoring your session…" />
  // Genuinely signed out. Carry the requested URL so Login can send the user
  // back to the page they were on instead of the generic role landing page.
  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  // Signed in but the profile is unreadable (transient network failure) or
  // missing. Render the recovery screen IN PLACE — no redirect — so the URL
  // survives: when the background onSnapshot retry or the Repair button
  // restores the profile, this guard re-renders and the user continues on the
  // exact page they refreshed. Never sign the user out here.
  if (profileIssue) return <MissingProfileRecovery />
  if (requiredRole && !userProfile) return <FullScreenLoader label="Loading your workspace…" />

  if (requiredRole && userProfile) {
    const userLevel     = ROLE_LEVEL[userProfile.role]   ?? 1
    const requiredLevel = ROLE_LEVEL[requiredRole]       ?? 1
    if (userLevel < requiredLevel) {
      return (
        <Navigate
          to={getRoleLandingPath(userProfile)}
          replace
          state={{ accessDenied: true }}
        />
      )
    }
  }

  return children
}
