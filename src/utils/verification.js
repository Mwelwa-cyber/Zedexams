// Email-verification predicates shared by the route guards, the /verify-email
// page, and the VerifyEmailBanner. The SECURITY source of truth is the Firebase
// Auth token claim (user.emailVerified client-side, request.auth.token
// .email_verified in rules/functions) — never the Firestore mirror field,
// which exists only for admin display/queries.

// True only for a signed-in user whose email is explicitly unverified.
// Google sign-ins (web popup + Capacitor native) always come back
// emailVerified: true, and admin-provisioned accounts are created verified,
// so this is exactly "email/password signup that hasn't clicked the link".
export function needsEmailVerification(user) {
  return !!user && user.emailVerified === false
}

// Migration-granted grace window for accounts that predate enforcement.
// `verificationGraceUntil` is written only by the backfill script /
// Cloud Functions (client writes are blocked by firestore.rules), so a
// tampered client can't grant itself grace — and the backend honours the
// same field, so grace users genuinely keep access, not just UI access.
export function isWithinVerificationGrace(profile) {
  const until = profile?.verificationGraceUntil
  if (!until) return false
  const millis =
    typeof until.toMillis === 'function' ? until.toMillis() :
    until instanceof Date ? until.getTime() :
    typeof until === 'number' ? until :
    NaN
  return Number.isFinite(millis) && millis > Date.now()
}

// Friendly copy for resend/reload failures. Firebase rate-limits repeated
// sendEmailVerification calls server-side (auth/too-many-requests) on top of
// the 60s client cooldown.
export function friendlyVerificationError(err) {
  switch (err?.code) {
    case 'auth/too-many-requests':
      return 'Too many attempts — please wait a few minutes and try again.'
    case 'auth/network-request-failed':
      return 'Network problem — check your connection and try again.'
    case 'auth/user-token-expired':
    case 'auth/user-disabled':
      return 'Your session has ended. Please sign in again.'
    default:
      return "Couldn't complete that right now. Please try again shortly."
  }
}
