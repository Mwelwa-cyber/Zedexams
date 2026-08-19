import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import { isWithinVerificationGrace } from '../../utils/verification'
import FullScreenLoader from '../../shared/components/FullScreenLoader'
import SessionRestorationLoader from './SessionRestorationLoader'
import MissingProfileRecovery from './MissingProfileRecovery'
import VerifyEmailBanner from '../../components/ui/VerifyEmailBanner'

const ROLE_LEVEL = { superAdmin: 4, admin: 3, teacher: 2, learner: 1, student: 1 }

export default function ProtectedRoute({ children, requiredRole }) {
  const { currentUser, userProfile, loading, authReady, profileIssue, needsEmailVerification } = useAuth()
  const location = useLocation()

  // Branded session-restoration screen (progressive stages + offline/timeout/
  // retry/error recovery) while the session + profile resolve on a cold start /
  // reload, so a returning user never sees a blank white page and is never
  // stuck without an action. Firebase restores the persisted session
  // asynchronously — currentUser is null on the first frames even for a
  // signed-in user — so we must never redirect to /login while `loading` is
  // still true. The skeleton is shown only for the teacher workspace and only
  // once auth has resolved (handled inside the screen), so a signed-out visitor
  // can't glimpse an authenticated layout.
  //
  // `authReady` is the gate, and `loading` alone is NOT: the restoration
  // watchdog drops `loading` after its window WITHOUT knowing who the user is,
  // so `loading === false && currentUser === null` is not "signed out" — it is
  // "we stopped waiting". Redirecting on that pair is precisely how a cold load
  // of /dashboard bounced a learner holding a valid refresh token to /login and
  // left them there. Until Firebase has actually emitted, this guard decides
  // nothing and navigates nowhere.
  if (!authReady || loading) {
    return <SessionRestorationLoader showDashboardSkeleton={requiredRole === 'teacher'} />
  }
  // Genuinely signed out — Firebase said so, rather than a timer having given
  // up. Carry the requested URL so Login can send the user back to the page
  // they were on instead of the generic role landing page.
  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  // Unverified email/password account. Backend (Firestore/Storage rules +
  // Cloud Functions) enforces the same token claim, so this redirect is UX,
  // not the security boundary. Accounts inside the migration-granted grace
  // window keep access but see a persistent (per-session dismissible)
  // reminder banner — grace is honoured by the backend too. The user doc
  // must wait to load before the grace check: while userProfile is null a
  // grace-holder would otherwise be bounced on a slow profile read.
  const inGrace = needsEmailVerification && isWithinVerificationGrace(userProfile)
  if (needsEmailVerification && !inGrace) {
    if (!userProfile && !profileIssue) {
      return <FullScreenLoader label="Restoring your session…" />
    }
    return <Navigate to="/verify-email" replace state={{ from: location }} />
  }
  // Signed in but the profile is unreadable (transient network failure) or
  // missing. Render the recovery screen IN PLACE — no redirect — so the URL
  // survives: when the background onSnapshot retry or the Repair button
  // restores the profile, this guard re-renders and the user continues on the
  // exact page they refreshed. Never sign the user out here.
  if (profileIssue) return <MissingProfileRecovery />
  if (requiredRole && !userProfile) {
    return (
      <SessionRestorationLoader
        forcedStage="loading-dashboard"
        showDashboardSkeleton={requiredRole === 'teacher'}
      />
    )
  }

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

  if (inGrace) {
    return (
      <>
        <VerifyEmailBanner />
        {children}
      </>
    )
  }
  return children
}
