import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { resolveAdminRouteAccess, MFA_SETUP_PATH } from '../../utils/adminMfaAccess'

/**
 * AdminMfaGate — the mandatory-MFA layer of the admin route guard.
 *
 * Composes INSIDE <ProtectedRoute requiredRole="admin">, which already
 * guarantees: auth resolved, a Firebase user, admin role, email verified, and a
 * loaded profile. This gate adds the one remaining rule: an administrator who
 * has not enrolled MFA is sent to /admin/security/mfa-setup — with no skip, no
 * "remind me later", and no way to reach the dashboard first. The setup page
 * itself is exempt so it can never redirect onto itself.
 *
 * The client redirect is UX only; the real boundary is the requireAdminMfa
 * Cloud Function guard + Firestore rules. Enrolment state comes from Firebase
 * Auth (AuthContext.mfaEnrolled), never a client-written Firestore boolean.
 */
export default function AdminMfaGate({ children }) {
  const { mfaEnrolled } = useAuth()
  const location = useLocation()

  // ProtectedRoute has already established the other preconditions, so the only
  // decisions the shared helper can return here are 'allow' or a redirect to the
  // setup path. Using it keeps the policy in one tested place.
  const decision = resolveAdminRouteAccess({
    loading: false,
    hasUser: true,
    isAdmin: true,
    profileIssue: false,
    needsVerification: false,
    mfaEnrolled,
    isSetupRoute: location.pathname === MFA_SETUP_PATH,
  })

  if (decision.action === 'redirect' && decision.to === MFA_SETUP_PATH) {
    return <Navigate to={MFA_SETUP_PATH} replace />
  }
  return children
}
