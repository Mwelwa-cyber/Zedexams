import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import FullScreenLoader from '../ui/FullScreenLoader'

const ROLE_LEVEL = { superAdmin: 4, admin: 3, teacher: 2, learner: 1, student: 1 }

export default function ProtectedRoute({ children, requiredRole }) {
  const { currentUser, userProfile, loading, profileIssue } = useAuth()

  // Branded splash (not the thin bar) while the session + profile resolve on a
  // cold start / reload, so a returning user never sees a blank white page.
  if (loading) return <FullScreenLoader label="Signing you in…" />
  if (!currentUser) return <Navigate to="/login" replace />
  if (profileIssue) return <Navigate to="/" replace />
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
