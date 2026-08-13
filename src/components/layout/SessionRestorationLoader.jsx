import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useSessionRestoration } from '../../hooks/useSessionRestoration'
import SessionRestorationScreen from './SessionRestorationScreen'

/**
 * SessionRestorationLoader — the container that connects the live auth/profile
 * flow to the purely-presentational <SessionRestorationScreen>. Rendered by
 * ProtectedRoute while the session + profile resolve on a cold start / reload.
 *
 * All Firebase state + navigation live here (and in useSessionRestoration);
 * the screen itself stays props-driven and easy to test.
 *
 * @param {string?}  forcedStage           Override the derived working stage
 *                                          (ProtectedRoute passes 'loading-dashboard'
 *                                          for the post-auth workspace wait).
 * @param {boolean} [showDashboardSkeleton] Show the faint teacher-dashboard skeleton.
 */
export default function SessionRestorationLoader({ forcedStage = null, showDashboardSkeleton = false }) {
  const { currentUser, userProfile, profileIssue, retrySession, logout } = useAuth()
  const navigate = useNavigate()

  const { stage, error, retrying, onRetry } = useSessionRestoration({
    currentUser,
    userProfile,
    profileIssue,
    retry: retrySession,
    forcedStage,
  })

  const onReturnToSignIn = useCallback(() => {
    // Clear ONLY the stuck/expired session — logout() signs out and clears the
    // cold-start hint but never touches saved drafts or other localStorage.
    // `replace` so the browser Back button can't return the user to this failed
    // loader. Best-effort: navigate regardless of signOut timing.
    Promise.resolve(logout?.()).catch(() => {})
    navigate('/login', { replace: true })
  }, [logout, navigate])

  return (
    <SessionRestorationScreen
      stage={stage}
      error={error}
      retrying={retrying}
      onRetry={onRetry}
      onReturnToSignIn={onReturnToSignIn}
      showDashboardSkeleton={showDashboardSkeleton}
    />
  )
}
