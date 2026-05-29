import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import PageLoader from '../ui/PageLoader'
import ErrorBoundary from '../ui/ErrorBoundary'

const ROLE_LEVEL = { admin: 3, teacher: 2, learner: 1, student: 1 }

export default function ProtectedRoute({ children, requiredRole }) {
  const { currentUser, userProfile, loading, profileIssue, sessionExpired } = useAuth()
  const location = useLocation()

  // Session was killed mid-navigation (token revoked, account disabled, etc.).
  // Send the user to /login with a reason so the page can show the
  // "Your session expired" notice instead of the generic snag card.
  if (sessionExpired) {
    return <Navigate to="/login" replace state={{ reason: 'session-expired' }} />
  }

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

  // Per-route boundary: a render throw inside one page (stale Firestore
  // payload, broken lazy chunk, etc.) shows the inline recovery card here
  // instead of bubbling up to the global boundary and blanking the whole
  // shell. Resets when the user navigates so a one-off failure doesn't
  // stick.
  return (
    <ErrorBoundary inline resetKey={location.pathname}>
      {children}
    </ErrorBoundary>
  )
}
