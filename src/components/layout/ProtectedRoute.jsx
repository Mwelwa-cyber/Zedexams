import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import PageLoader from '../ui/PageLoader'

const ROLE_LEVEL = { admin: 3, teacher: 2, learner: 1, student: 1 }

export default function ProtectedRoute({ children, requiredRole }) {
  const { currentUser, userProfile, loading, profileIssue } = useAuth()

  if (loading) return <PageLoader />
  if (!currentUser) return <Navigate to="/login" replace />
  if (profileIssue) return <Navigate to="/" replace />
  if (requiredRole && !userProfile) return <PageLoader />

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
