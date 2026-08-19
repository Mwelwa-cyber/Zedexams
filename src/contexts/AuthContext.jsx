import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
  multiFactor,
  sendPasswordResetEmail as sendPasswordResetEmailViaFirebase,
} from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc, setDoc, getDoc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore'
import app, { auth, db, googleProvider, authPersistenceReady } from '../firebase/config'
import { isNativePlatform } from '../utils/runtime'
import { retryOnNetworkError } from '../utils/authRetry'
import { ROLES, hasPremiumAccess, hasLearnerPortalAccess } from '../engines/payment-engine/subscriptionConfig'
import { isSuperAdmin as isSuperAdminRole, resolvePermissionFlags } from '../utils/permissions'
import { setSentryUser, clearSentryUser, setAuthStateTag, reportAuthInitFailure } from '../utils/sentry'
import { capture, identifyUser, resetAnalytics } from '../utils/analytics'
import { requiresGuardianConsent } from '../utils/guardianConsent'
import { isKnownDobSource } from '../utils/ageAnswerCore'
// (The guardian consent request is sent from the sign-up flow's guardian
// screen, which is the only place a guardian's address is collected.)
import { refreshTokenIfGranted, clearPushUser } from '../services/notifications/fcm'
import { mintAndPersistReferralCode, readPendingReferral, clearPendingReferral } from '../utils/referrals'
import { clearAllSearchCaches } from '../utils/cache/searchCache.js'
import { isAccountDeletionInFlight, onAccountDeletionStart } from '../utils/accountDeletionState'
import { useAuthRecovery } from '../hooks/useAuthRecovery'
import { shouldExpireSession, REFRESH_THROTTLE_MS } from '../hooks/authRecoveryPolicy'
import {
  decideAuthInitRecovery,
  readRecoveryAttempted,
  markRecoveryAttempted,
  clearRecoveryAttempted,
  planSessionRescue,
  readRescueAttempts,
  recordRescueAttempt,
  clearRescueAttempts,
  shouldFastRecover,
  RELOAD,
  DEFER,
} from '../hooks/authInitRecoveryPolicy'
import {
  planAuthInitAttempt,
  shouldClearStoredUser,
  AUTH_INIT_RETRY_DELAYS_MS,
  RETRY,
  CLEAR,
  WEDGED as WEDGED_PLAN,
} from '../hooks/authInitRetryPolicy'
import { markAuthReady } from '../utils/authReadyGate'
import { AUTH_HINT_KEY, hasAuthSessionHint, setAuthSessionHint } from '../firebase/authSessionHint'
import { disarmAuthSessionGuard } from '../firebase/authSessionGuard'
import {
  shouldTryFallback,
  isContinueUrlError,
  fallbackOutcome,
  resetContinueUrl,
  uniformResetReply,
} from '../utils/passwordResetFallback'

const AuthContext = createContext(null)

// One-shot breadcrumb so the Login page can explain *why* the user landed
// back on it after a session was force-expired (stale/revoked token on
// resume). Read-and-cleared by Login; survives the signOut → redirect hop
// because it lives in sessionStorage, not React state.
export const SESSION_EXPIRED_KEY = 'auth:sessionExpired'

// The "this device has a signed-in user" hint now lives in
// firebase/authSessionHint so the boot-session guard can read it without
// importing this module (which imports firebase/config — the other direction).
// Re-exported here because App, Login and their specs import it from here.
export { AUTH_HINT_KEY, hasAuthSessionHint }

// How long one rung of the auth-init retry ladder waits for `authStateReady()`
// before calling that rung a miss. Short relative to the backoff itself: the
// point of the rung is the WAIT between attempts, not the attempt, and a probe
// that outlasts its own backoff would stretch a 12 s ladder into a minute.
export const AUTH_INIT_PROBE_MS = 2000

// How long to wait before each re-drive of Firebase's initialisation after the
// guard rescued a session the SDK gave up on now lives with the budget that
// bounds it — see SESSION_RESCUE_DELAYS_MS in hooks/authInitRecoveryPolicy.

const functions = getFunctions(app, 'us-central1')
const bootstrapUserProfileCallable = httpsCallable(functions, 'bootstrapUserProfile')
const sendPasswordResetEmailCallable = httpsCallable(functions, 'sendPasswordResetEmail')

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

function toUserProfile(uid, data) {
  return data ? { id: uid, ...data } : null
}

// Multi-factor enrolment read straight from the Firebase Auth user — the
// tamper-proof source of truth for "does this admin have MFA" (never a
// Firestore boolean). Guarded so a user object without MFA support degrades to
// "not enrolled" rather than throwing.
function readMfaEnrolled(user) {
  if (!user) return false
  try {
    return (multiFactor(user).enrolledFactors || []).length > 0
  } catch {
    return false
  }
}

// Defaults that satisfy the create-user firestore rule. Used by both the
// email/password register flow and the first-time Google sign-in flow.
function defaultUserRecord({ displayName, email, role = ROLES.LEARNER, grade = null, school = '', referralCode = null, referredBy = null, emailVerified = false }) {
  return {
    displayName: displayName ?? '',
    email: email ?? '',
    // Display-only mirror of the Auth token's email_verified claim (the
    // claim, not this field, is what rules/functions enforce). The create
    // rule only accepts `true` here when the token claim really is true —
    // i.e. Google sign-ins; password signups always start false.
    emailVerified,
    role,
    grade,
    school,
    plan: 'free',
    premium: false,
    isPremium: false,
    paymentStatus: 'inactive',
    subscriptionStatus: 'inactive',
    subscriptionPlan: 'free',
    subscriptionExpiry: null,
    subscriptionActivatedBy: null,
    premiumActivatedAt: null,
    // Plain-language plan type surfaced by the subscription-reminder system
    // (Free / Trial / Pro / Expired is derived in engines/payment-engine/subscriptionStatus.js;
    // this stores the catalogue planType, 'free' on a fresh account).
    planType: 'free',
    // Reminder-system UX state. Both are self-writable (not on the Firestore
    // subscription blocklist) so the once-a-day popup snooze persists across
    // devices without a Cloud Function. lastPaymentReminderShownAt records the
    // most recent nudge; reminderDismissedUntil snoozes it for the day.
    lastPaymentReminderShownAt: null,
    reminderDismissedUntil: null,
    dailyAttempts: 0,
    lastAttemptDate: '',
    // Audit C7 — referrals foundation. referralCode is minted at
    // create-time (immutable thereafter); referredBy is captured from
    // ?ref=… and is also once-write. referralCount + referralCredits
    // are server-incremented by the redemption flow (PR 2) so they
    // start at zero here.
    referralCode,
    referredBy,
    referralCount: 0,
    referralCredits: 0,
    createdAt: serverTimestamp(),
  }
}

// Native Google sign-in via @capacitor-firebase/authentication. The plugin is
// looked up through Capacitor's runtime registry rather than a static
// `import('@capacitor-firebase/authentication')` so the web build never has to
// resolve the native specifier — the same package-agnostic pattern App Check
// uses in firebase/config.js. The plugin is configured with
// `skipNativeAuth: true` (capacitor.config.json), so it performs only the
// OAuth handshake and returns a credential; we complete sign-in on the JS SDK
// with signInWithCredential so the app's auth state matches the web flow.
async function signInWithGoogleNative() {
  const { Capacitor } = await import('@capacitor/core').catch(() => ({}))
  const FirebaseAuthentication = Capacitor?.Plugins?.FirebaseAuthentication || null
  if (!FirebaseAuthentication) {
    // Plugin not registered — the native build is missing
    // @capacitor-firebase/authentication or hasn't been `cap sync`-ed.
    const err = new Error('Google sign-in is not available in this app build.')
    err.code = 'auth/operation-not-supported-in-this-environment'
    throw err
  }
  let result
  try {
    result = await FirebaseAuthentication.signInWithGoogle()
  } catch (err) {
    // Normalise a user-cancelled native sheet (Google code 12501 / "canceled"
    // message) to the same code the popup flow uses, so Login/Register treat
    // it as a silent no-op rather than a "sign-in failed" error.
    const msg = String(err?.message || err || '')
    if (err?.code === '12501' || /cancel/i.test(msg)) {
      const cancelled = new Error('Google sign-in was cancelled.')
      cancelled.code = 'auth/cancelled-popup-request'
      throw cancelled
    }
    // Google Play Services code 10 (DEVELOPER_ERROR) / "developer error" means
    // the signing key's SHA-1/SHA-256 fingerprint isn't registered against the
    // Android OAuth client in Firebase, or google-services.json is stale.
    // Give it a dedicated code so the UI shows an actionable message instead of
    // a raw native string.
    if (err?.code === '10' || /developer error/i.test(msg)) {
      const devErr = new Error('Google sign-in is misconfigured for this build.')
      devErr.code = 'auth/google-developer-error'
      throw devErr
    }
    throw err
  }
  const idToken = result?.credential?.idToken
  if (!idToken) {
    // The native sheet completed but no Firebase ID token came back. On Android
    // the plugin can only mint an ID token when the Web OAuth client ID is
    // configured — `serverClientId` in capacitor.config.json, backed by a
    // type-3 ("web") OAuth client in google-services.json. Without it
    // signInWithGoogle returns an access token but no idToken, so
    // signInWithCredential below would fail anyway.
    //
    // Use a DEDICATED code, not auth/invalid-credential: the email/password
    // path maps auth/invalid-credential to "Wrong email or password", which
    // would mislead the user on a Google sign-in failure.
    const err = new Error('Google sign-in could not be completed on this device.')
    err.code = 'auth/google-no-id-token'
    throw err
  }
  const credential = GoogleAuthProvider.credential(idToken, result?.credential?.accessToken)
  return signInWithCredential(auth, credential)
}

// Shared first-time-profile bootstrap for both the popup (web) and native
// Google flows. New users get a default profile + referral mint; existing
// users keep their saved doc untouched.
//
// Returns whether an account was CREATED. That answer is the difference
// between signing up and signing in through the sign-up page, and the caller
// needs it: an existing user must not be walked through onboarding, and above
// all must not have a date of birth they gave us years ago overwritten by one
// typed on the way past a screen.
async function ensureGoogleUserProfile(cred, targetRole, onboarding = {}) {
  const userRef = doc(db, 'users', cred.user.uid)
  const snap = await getDoc(userRef)
  if (snap.exists()) return false
  // Audit C7 — same referral mint + capture as the email path.
  let referralCode = null
  try {
    referralCode = await mintAndPersistReferralCode(cred.user.uid)
  } catch (err) {
    console.warn('[loginWithGoogle] referral code mint failed', err)
  }
  const referredBy = readPendingReferral()
  const record = defaultUserRecord({
    displayName: cred.user.displayName ?? '',
    email: cred.user.email ?? '',
    role: targetRole,
    referralCode,
    referredBy,
    emailVerified: cred.user.emailVerified === true,
  })

  // The age answer, on the same terms as the email path — this is what closes
  // the bypass. The Google button used to sit above the age question, so a
  // learner who tapped it created an account with no declared age at all,
  // which reads as `unknown` and therefore as FULL access. Same derivation,
  // same server-side recomputation, same pending guardian record.
  if (targetRole === ROLES.LEARNER) {
    if (onboarding.dob) record.dob = String(onboarding.dob)
    // HOW the date was arrived at, recorded beside it. A date estimated from
    // a grade is weaker evidence than one the learner typed, and support
    // cannot tell them apart from the value alone. Nothing routes on it —
    // `isMinor` comes from the date, here and again on the server.
    if (isKnownDobSource(onboarding.dobSource)) record.dobSource = onboarding.dobSource
    const minor = requiresGuardianConsent(onboarding.dob)
    record.isMinor = minor
    if (minor) {
      record.guardian = {
        contact: '',
        method: 'email',
        consentStatus: 'pending',
        requestedAt: new Date().toISOString(),
      }
    }
  } else if (onboarding.ageConfirmed18Plus === true) {
    record.ageConfirmed18Plus = true
  }

  await setDoc(userRef, record)
  if (referredBy) clearPendingReferral()
  // Audit B2 — only emit on the first-time path so Google sign-IN by an
  // existing user doesn't get counted as a signup.
  capture('signup_completed', { role: targetRole, provider: 'google' })
  return true
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading]         = useState(true)
  // Has `onAuthStateChanged` actually fired? Distinct from `loading`, which the
  // restoration watchdog also clears — after 5 s with no session hint, 30 s
  // with one — so that a page renders rather than hanging on a slow cold start.
  // In that window `loading === false` while `currentUser` is still null for a
  // returning learner, which is fine for "show something" and wrong for
  // "commit to an answer". Anything that FREEZES a per-user decision must wait
  // for this one instead. Never set by the watchdog, by design.
  const [authSettled, setAuthSettled] = useState(false)
  // The public name for the same fact, and the one every route guard reads.
  //
  // `authSettled` and `authReady` are set together, from the one place Firebase
  // actually speaks. They are kept as two names rather than merged because they
  // answer questions with different blast radii: `authSettled` is consumed by
  // `useAssessmentEngineFlag` to freeze a per-attempt rollout decision, and
  // `authReady` is what stops a guard NAVIGATING. Renaming one into the other
  // would silently move a rollout decision onto a routing signal, or the other
  // way round, the first time either gained a second setter.
  //
  // NEVER set by the restoration watchdog. `loading` is a "stop waiting, render
  // something" signal and the watchdog drops it without knowing who the user
  // is; a guard that redirected on that pair (`loading === false &&
  // currentUser === null`) is exactly how a returning learner holding a valid
  // refresh token got bounced to /login on a cold load.
  const [authReady, setAuthReady] = useState(false)
  const [profileIssue, setProfileIssue] = useState(null)
  // Explicit React state, NOT derived from currentUser at render time:
  // user.reload() mutates the Firebase User in place, so a verification that
  // completes mid-session would never re-render the guards without this.
  // null = unknown (no user / still restoring).
  const [emailVerified, setEmailVerified] = useState(null)
  const bootstrapInFlightRef = useRef(new Map())
  // Tracks effect teardown so async recovery paths (forced token refresh,
  // bootstrap) can bail after unmount. A ref rather than a closure boolean
  // because expireSession + the recovery hook live outside the effect.
  const disposedRef = useRef(false)
  // Lets useAuthRecovery re-attach the profile snapshot after a resume — the
  // effect publishes a re-subscribe closure here so the hook can call it
  // without the subscription internals leaking out of the effect.
  const subscribeProfileRef = useRef(null)

  // ── Why the actions below are useCallback ────────────────────────────────
  //
  // Eight of the actions in this file were already memoised; these are the rest,
  // finishing that pattern rather than introducing a new one. The point is NOT
  // to stop consumers re-rendering — see the note on the context value at the
  // bottom of this component for why that is not achievable here. It is that
  // 219 files call useAuth(), and a function with a fresh identity on every
  // render is unusable in a consumer's own dependency array: an
  // `useEffect(…, [refreshProfile])` re-fires on every auth render, and a
  // React.memo child taking `logout` as a prop re-renders regardless.
  //
  // Dependency arrays here are exhaustive and verified by
  // react-hooks/exhaustive-deps. Most are genuinely empty because these actions
  // read `auth.currentUser` — the live Firebase object — rather than the
  // `currentUser` React state, which is the convention the existing memoised
  // actions in this file already follow. The three that DO close over React
  // state declare it, so none of them can capture a stale user.
  const register = useCallback(async (email, password, displayName, grade, school, role = ROLES.LEARNER, extras = {}) => {
    // Only learner / teacher / parent are self-selectable at signup; anything
    // else falls back to learner. Parents carry no grade and no teacher extras.
    const signupRole = (role === ROLES.TEACHER || role === ROLES.PARENT) ? role : ROLES.LEARNER
    const isTeacherSignup = signupRole === ROLES.TEACHER
    const isLearnerSignup = signupRole === ROLES.LEARNER
    // Never mint a session before the SDK knows where to store it — see
    // `authPersistenceReady` in firebase/config.js.
    await authPersistenceReady
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName })

    // Audit C7 — mint a fresh referral code + write the lookup doc.
    // Wrapped in try/catch so a Firestore hiccup here doesn't fail
    // signup; the Cloud Function backfill (future) can mint a code
    // for any user whose record was created without one.
    let referralCode = null
    try {
      referralCode = await mintAndPersistReferralCode(cred.user.uid)
    } catch (err) {
      console.warn('[register] referral code mint failed', err)
    }
    // Pull any pending referredBy stashed by /register?ref=… handler.
    const referredBy = readPendingReferral()

    const userRecord = defaultUserRecord({
      displayName,
      email,
      role: signupRole,
      grade: isLearnerSignup ? (grade ?? null) : null,
      school: school ?? '',
      referralCode,
      referredBy,
    })
    if (isTeacherSignup) {
      userRecord.province = String(extras.province || '').trim()
      userRecord.subject  = String(extras.subject  || '').trim()
    }

    // Age gate + guardian consent (Play Families policy / Zambia DPA).
    //
    // ONLY LEARNERS CARRY A DATE OF BIRTH. Teachers and parents used to be
    // asked for one too; it fed no feature and no obligation, so it is a data
    // type we would have to declare in the Privacy Policy and the Play Data
    // safety form and justify on request, for nothing. They attest instead:
    // `ageConfirmed18Plus`, a boolean, which is what a checkbox actually is.
    // The guard is on the ROLE rather than on the presence of `extras.dob`,
    // so a stale client that still sends one cannot reintroduce the field.
    if (isLearnerSignup) {
      // `isMinor` is DERIVED from the declared date of birth via the shared
      // consent core, never taken as a flag from the caller — the whole point
      // of the age screen is that the answer decides the routing, and a client
      // that could send `isMinor: false` alongside a 2016 birthday would make
      // the screen decorative. requiresGuardianConsent also treats an absent
      // or unreadable date as a child, so a tampered payload fails towards the
      // restricted experience rather than out of it. The value written here is
      // re-derived server-side by the users-create trigger regardless.
      if (extras.dob) userRecord.dob = String(extras.dob)
      // See the Google path above: provenance, not a routing flag.
      if (isKnownDobSource(extras.dobSource)) userRecord.dobSource = extras.dobSource
      const minor = requiresGuardianConsent(extras.dob)
      userRecord.isMinor = minor
      if (minor) {
        // A pending guardian record is written even though no contact has been
        // collected yet — the guardian screen comes AFTER the account exists,
        // and it can be skipped. This is load-bearing: with no guardian object
        // at all the consent status reads as `unknown`, which is the migration
        // state that grants FULL capabilities. A minor created without this
        // would land in full mode, which is the opposite of the intent.
        userRecord.guardian = {
          contact: '',
          method: 'email',
          // Always 'pending' at creation. A client cannot self-approve: the
          // only writer of 'granted' is the confirmGuardianConsent server
          // path, and firestore.rules pins this field against client updates.
          consentStatus: 'pending',
          requestedAt: new Date().toISOString(),
        }
      }
    } else if (extras.ageConfirmed18Plus === true) {
      userRecord.ageConfirmed18Plus = true
    }

    await setDoc(doc(db, 'users', cred.user.uid), userRecord)

    if (referredBy) clearPendingReferral()
    // Fire the verification email but don't fail signup if delivery hiccups
    // (e.g. rate-limited, transient Firebase Auth outage). The user lands on
    // /verify-email, which has its own Resend button for the retry.
    try {
      await sendEmailVerification(cred.user)
    } catch (err) {
      console.warn('sendEmailVerification failed:', err)
    }
    // Audit B2 — capture signup. Role + grade only; no email / no
    // displayName / no school in the event payload.
    capture('signup_completed', {
      role: signupRole,
      grade: isLearnerSignup ? (grade ?? null) : null,
      provider: 'email',
    })
    return cred
  }, [])

  const login = useCallback(async (email, password) => {
    // Auto-retry a transient `auth/network-request-failed` (a dropped/timed-out
    // fetch to Google's auth server — common on flaky Zambian mobile links)
    // before surfacing the error. Wrong-password / rate-limit / etc. are not
    // retried (see utils/authRetry.js).
    // Persistence first: a session written before setPersistence settles
    // lands in the SDK's in-memory default and does not survive the reload.
    await authPersistenceReady
    return retryOnNetworkError(() => signInWithEmailAndPassword(auth, email, password))
  }, [])

  // Google sign-in. Web uses an OAuth popup; the native Android shell can't
  // open one — and Google blocks its sign-in pages inside embedded WebViews
  // ("this browser or app may not be secure"), so even a redirect fails. The
  // native path goes through @capacitor-firebase/authentication, which drives
  // Android's native Google Sign-In and hands the resulting credential back to
  // the Firebase JS SDK via signInWithCredential so the rest of the app sees
  // the same auth state it does on web.
  //
  // New users get a default profile; the caller can pass `role` (used only on
  // first sign-in) so the Register page can honour the selected
  // Learner/Teacher tab. Existing users keep their saved role.
  //
  // `onboarding` carries the sign-up flow's answers (a learner's date of
  // birth, a teacher/parent's 18+ confirmation) and is applied ONLY when this
  // sign-in mints a new account.
  //
  // The returned credential is tagged with `isNewAccount`. Tagging the SDK
  // object rather than changing the return shape keeps the other caller
  // (Login.jsx, which only wants the credential) working unchanged — this is
  // a sign-up concern and should not ripple into sign-in.
  const loginWithGoogle = useCallback(async ({ role, onboarding } = {}) => {
    const targetRole = (role === ROLES.TEACHER || role === ROLES.PARENT) ? role : ROLES.LEARNER
    await authPersistenceReady
    const cred = isNativePlatform()
      ? await signInWithGoogleNative()
      : await signInWithPopup(auth, googleProvider)
    const created = await ensureGoogleUserProfile(cred, targetRole, onboarding || {})
    try { cred.isNewAccount = created } catch { /* frozen credential — caller falls back */ }
    return cred
  }, [])

  // Two delivery paths, tried in order, because one of them depends on
  // things we do not control.
  //
  // The callable is preferred: it sends the branded email, enforces the
  // daily per-email/per-IP caps, and answers identically whether or not the
  // account exists. But it mints that email through our own SMTP host with
  // our own credentials, and when either is unavailable EVERY attempt fails
  // with the same opaque message — a locked-out user has no way through, on
  // the one screen whose entire job is to give them one.
  //
  // So a delivery failure falls through to Firebase Auth's own mailer: a
  // separate sender on separate infrastructure, needing no secret of ours.
  // The email is plainer than the branded one; that is a straightforward
  // trade against sending nothing at all.
  //
  // What the fallback must NOT do is answer a question the callable refuses
  // to: `auth/user-not-found` and the throttling codes resolve as success
  // (see passwordResetFallback.js), so the second path cannot be used to
  // mine the user base behind the first path's back.
  const resetPassword = useCallback(async (email) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://zedexams.com'
    try {
      return await sendPasswordResetEmailCallable({ email, continueUrl: origin })
    } catch (primaryError) {
      if (!shouldTryFallback(primaryError)) throw primaryError

      try {
        try {
          await sendPasswordResetEmailViaFirebase(auth, email, {
            url: resetContinueUrl(origin),
            handleCodeInApp: false,
          })
        } catch (err) {
          // The landing page is a nicety; the reset is not. If the continue
          // URL is what Firebase objected to, send without one rather than
          // let the styling of the return trip block the password change.
          if (!isContinueUrlError(err)) throw err
          await sendPasswordResetEmailViaFirebase(auth, email)
        }
        return uniformResetReply('firebase-auth')
      } catch (fallbackError) {
        const outcome = fallbackOutcome(fallbackError)
        if (outcome === 'ok') return uniformResetReply('suppressed')
        if (outcome === 'bad-email') throw fallbackError
        // Both paths are down. Surface the PRIMARY failure: it is the one
        // carrying our own error code, and the one an operator can act on.
        throw primaryError
      }
    }
  }, [])

  const logout = useCallback(async () => {
    setUserProfile(null)
    setProfileIssue(null)
    return signOut(auth)
  }, [])

  // Re-check verification against the Auth server. On success, force a token
  // refresh so Firestore rules + Cloud Functions see email_verified=true NOW
  // (the ID token otherwise carries the stale claim for up to an hour), then
  // best-effort mirror onto the users doc (display-only; rules only accept
  // the mirror write when the token claim is genuinely true).
  const refreshEmailVerification = useCallback(async () => {
    const user = auth.currentUser
    if (!user) return false
    await user.reload()
    const verified = auth.currentUser?.emailVerified === true
    if (verified) {
      try {
        await auth.currentUser.getIdToken(true)
      } catch (err) {
        console.warn('[verify-email] token refresh failed:', err)
      }
      updateDoc(doc(db, 'users', user.uid), {
        emailVerified: true,
        emailVerifiedAt: serverTimestamp(),
      }).catch(() => null)
    }
    setEmailVerified(verified)
    return verified
  }, [])

  const resendVerificationEmail = useCallback(async () => {
    const user = auth.currentUser
    if (!user) throw new Error('No signed-in user.')
    return sendEmailVerification(user)
  }, [])

  const fetchUserProfile = useCallback(async (uid, { updateState = true } = {}) => {
    try {
      const snap = await getDoc(doc(db, 'users', uid))
      if (snap.exists()) {
        const profile = toUserProfile(uid, snap.data())
        if (updateState) {
          setUserProfile(profile)
          setProfileIssue(null)
        }
        return profile
      }
    } catch (e) {
      console.error('fetchUserProfile:', e)
      if (updateState) setProfileIssue('unreadable')
    }
    return null
  }, [])

  const bootstrapMissingProfile = useCallback(async (user) => {
    const uid = user?.uid
    if (!uid) return null
    // A profile missing because the user asked us to delete it is not damage.
    // Guarded here rather than only at the snapshot call site so every caller
    // (resume recovery, ensureUserProfile, refreshProfile) is covered.
    if (isAccountDeletionInFlight()) return null

    const inFlight = bootstrapInFlightRef.current.get(uid)
    if (inFlight) return inFlight

    const request = (async () => {
      try {
        const result = await bootstrapUserProfileCallable()
        const profileData = result?.data?.profile
        if (profileData) {
          const profile = toUserProfile(uid, profileData)
          setUserProfile(profile)
          setProfileIssue(null)
          return profile
        }
        return await fetchUserProfile(uid)
      } catch (e) {
        console.error('bootstrapUserProfile:', e)
        return null
      } finally {
        bootstrapInFlightRef.current.delete(uid)
      }
    })()

    bootstrapInFlightRef.current.set(uid, request)
    return request
  }, [fetchUserProfile])

  const ensureUserProfile = useCallback(async (user = auth.currentUser, options = {}) => {
    const targetUser = user?.uid ? user : auth.currentUser
    if (!targetUser?.uid) return null

    const profile = await fetchUserProfile(targetUser.uid)
    if (profile || options.allowBootstrap === false) return profile

    const repairedProfile = await bootstrapMissingProfile(targetUser)
    if (!repairedProfile) setProfileIssue('missing')
    return repairedProfile
  }, [bootstrapMissingProfile, fetchUserProfile])

  // Closes over the `currentUser` STATE (not auth.currentUser), so it declares
  // it: a stale capture here would refresh the profile of the previously
  // signed-in account.
  const refreshProfile = useCallback(async () => {
    if (currentUser) return ensureUserProfile(currentUser)
  }, [currentUser, ensureUserProfile])

  // Re-run session restoration on demand — the "Try again" action on the
  // <SessionRestorationScreen>. Forces a fresh ID token (a stale one is the
  // usual reason a resumed tab's profile snapshot fails) and re-attaches the
  // profile listener. Never signs the user out: a throw here (offline / flaky
  // link) propagates to the caller, which surfaces a recoverable state rather
  // than a logout. If auth hasn't resolved yet, waits for Firebase's first
  // emission instead of forcing anything.
  const retrySession = useCallback(async () => {
    const user = auth.currentUser
    if (!user) {
      // authStateReady() resolves once the initial onAuthStateChanged fires —
      // give a hung cold-start init another window rather than a hard reload.
      try { await auth.authStateReady?.() } catch { /* older SDK — no-op */ }
      return
    }
    if (!disposedRef.current) {
      setLoading(true)
      setProfileIssue(null)
    }
    await user.getIdToken(true)
    if (disposedRef.current) return
    subscribeProfileRef.current?.()
  }, [])

  // Same reasoning as refreshProfile, and the consequence of getting it wrong is
  // sharper: this WRITES to users/{uid}, so a stale `currentUser` would write
  // one account's fields onto another's document.
  const updateProfileFields = useCallback(async (fields) => {
    if (!currentUser) return
    await updateDoc(doc(db, 'users', currentUser.uid), fields)
    setUserProfile(prev => ({ ...prev, ...fields }))
  }, [currentUser])

  const updateLearnerGrade = useCallback(async (newGrade) => {
    return updateProfileFields({ grade: Number(newGrade) })
  }, [updateProfileFields])

  // Whether this account has enrolled MFA (from Firebase Auth, not Firestore).
  // Drives the mandatory-admin-MFA route guard. Derived from currentUser so it
  // recomputes on every sign-in/out without a second listener.
  const mfaEnrolled = readMfaEnrolled(currentUser)

  // Admin & superAdmin are equivalent everywhere — both get full access.
  const isSuperAdmin = isSuperAdminRole(userProfile)
  const isLearner  = userProfile?.role === ROLES.LEARNER
  const isTeacher  = userProfile?.role === ROLES.TEACHER || isSuperAdmin
  const isParent   = userProfile?.role === ROLES.PARENT
  const isAdmin    = isSuperAdmin
  // True for admin / superAdmin only. Use this for admin-only UI (settings,
  // audit log, user suspension) so a teacher acting through the legacy
  // `isTeacher` overlap above can't sneak past.
  const isAdminOnly = isSuperAdmin
  // Effective per-feature permission flags. Super admins always get the
  // full set regardless of what the Firestore profile stores.
  const permissions = resolvePermissionFlags(userProfile)
  // Account lifecycle status. Defaults to 'active' for legacy records that
  // pre-date the soft-suspend field so existing users keep their access.
  const userStatus = userProfile?.status || 'active'
  const isSuspended = userStatus === 'suspended' || userStatus === 'deleted'
  const isPremium  = hasPremiumAccess(userProfile)
  const canAccessLearnerPortal = hasLearnerPortalAccess(userProfile)
  // Paid teacher: has teacher role AND active premium subscription
  const isPaidTeacher = (userProfile?.role === ROLES.TEACHER) && isPremium
  // Full content access: admin always, paid teachers, or premium learners.
  const canAccessFullContent = isAdmin || isPaidTeacher || isPremium

  // Force-end the session. Used by terminal token-refresh failures on resume
  // and by snapshot auth errors that survive a refresh attempt. Drops a
  // breadcrumb for the Login page, tears down state, and signs out — which
  // flips currentUser to null so ProtectedRoute redirects to /login. No
  // separate router bridge needed.
  const expireSession = useCallback((reason) => {
    if (disposedRef.current) return
    console.warn('[auth] session expired:', reason)
    try { sessionStorage.setItem(SESSION_EXPIRED_KEY, '1') } catch { /* private mode / quota */ }
    setUserProfile(null)
    setProfileIssue(null)
    signOut(auth).catch((e) => console.error('signOut after expiry failed:', e))
  }, [])

  useEffect(() => {
    let unsubProfile = null
    // Timestamp of the last forced token refresh triggered by a profile-snapshot
    // auth error. Throttled with the same window as useAuthRecovery so a
    // persistent permission-denied can't spin getIdToken()/Firestore in a tight
    // error → refresh → re-subscribe → error loop.
    let lastProfileRefreshAt = 0
    disposedRef.current = false
    // Watchdog: if Firebase auth doesn't emit its first event within this
    // window, drop the loading gate so the user sees *something*. The window
    // is hint-aware: when this device is KNOWN to have a signed-in session
    // (AUTH_HINT_KEY), dropping the gate early is catastrophic — every route
    // guard reads `loading === false && currentUser === null` as "signed
    // out" and bounces the user to /login, which is exactly the "refreshing
    // logs me out" bug. Firebase's first emission can legitimately exceed 5 s
    // on a cold start whose persisted token has expired (app reopened after
    // hours away): the SDK blocks initialization on a network token reload,
    // and slow links stretch that well past 5 s. So a hinted device waits far
    // longer before giving up, while a device with no session still falls
    // through to the public pages after 5 s (for those visitors auth resolves
    // near-instantly anyway — this is just a belt-and-braces ceiling).
    const watchdogMs = hasAuthSessionHint() ? 30_000 : 5000
    // When the watchdog fires on a HINTED device, Firebase did not resolve this
    // session to "signed out" — it failed to initialise at all, and is wedged
    // for the life of the page (see authInitRecoveryPolicy for the mechanism).
    // Dropping the gate here would leave `loading === false && currentUser ===
    // null`, which ProtectedRoute reads as signed-out and bounces to /login.
    // So a hinted device reloads once instead, which is the only way to re-drive
    // Firebase's initialisation.
    let recoveryVisibilityListener = null
    // Did the page hide while initialisation was still in flight? That is the
    // one precondition for the wedge, and it is what lets an unhandled
    // rejection be read as evidence without matching Firebase's wording.
    let hidDuringInit = false
    // Auth is unresolved until `onAuthStateChanged` fires. Tagged onto every
    // Sentry event so an error raised in this window is not silently filed
    // against nobody (PYTHON-K read as "Users impacted: 0" for eight days
    // precisely because the user tag is set from the callback that never ran).
    setAuthStateTag('unresolved')
    // Reported at most once PER TERMINAL VERDICT, however many paths reach the
    // same conclusion. Retry reports are separate and deliberately not capped
    // by this — each rung is its own event.
    let failureReported = false
    // Which rung of the backoff ladder we are on, and the timer holding the
    // next one. Both are torn down by the first auth event.
    let retryAttempt = 0
    let retryTimer = null
    const revealAsSignedOut = () => {
      if (disposedRef.current) return
      setLoading(false)
    }
    const reloadToRecover = () => {
      if (disposedRef.current) return
      console.warn('[auth] auth never initialised — reloading once to recover the session')
      window.location.reload()
    }
    // One rung of the ladder: ask Firebase again, and report back whatever it
    // said. Never throws — the CALLER decides what an error means, because the
    // classification (keep the session vs clear it) is the whole point and
    // belongs in one tested place, not in a catch block here.
    const probeAuthInit = async () => {
      try {
        const user = auth.currentUser
        if (user) {
          // Auth resolved between the timer being armed and it firing. Force a
          // fresh ID token: that is the call that surfaces a revoked or
          // disabled credential as a code we can classify, and the one whose
          // failure the ladder exists to absorb.
          await user.getIdToken(true)
          return {}
        }
        // Still nothing. `authStateReady()` settles the moment initialisation
        // completes, so a slow-but-alive cold start finishes here and the
        // onAuthStateChanged listener tears the ladder down. A genuinely wedged
        // SDK never settles it, which is what the race bounds.
        await Promise.race([
          auth.authStateReady?.() ?? Promise.resolve(),
          new Promise((resolve) => { setTimeout(resolve, AUTH_INIT_PROBE_MS) }),
        ])
        return {}
      } catch (e) {
        return { errorCode: e?.code }
      }
    }

    // The stored session is genuinely no good — the server said so. This is the
    // ONLY path in the watchdog that ends a session; every other outcome keeps
    // the stored user, because "we could not confirm it" is not "it is dead".
    const clearStoredUser = (errorCode) => {
      if (disposedRef.current) return
      console.warn('[auth] stored session rejected by the server:', errorCode)
      setAuthSessionHint(false)
      expireSession(`init-${errorCode}`)
      // signOut() is built on the same initialisation promise that may be
      // wedged, so it can never be relied on to produce the auth event that
      // would end the loader. Reveal directly.
      revealAsSignedOut()
    }

    const runWatchdogDecision = ({ viaFastPath = false, errorCode } = {}) => {
      if (disposedRef.current) return
      const storage = typeof window !== 'undefined' ? window.sessionStorage : null
      const hasHint = hasAuthSessionHint()
      const recoveryAttempted = readRecoveryAttempted(storage)
      const documentHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'

      // ── The backoff ladder ────────────────────────────────────────────────
      // Before concluding anything, ask again. A device holding a live refresh
      // token whose reload failed on a dropped mobile request has a perfectly
      // good session, and 12 s of patience recovers it; treating that first
      // failure as a verdict is what logged learners out of working accounts.
      //
      // NOT on the fast path, and the distinction is the point. The watchdog
      // fires on a TIMEOUT — ambiguous between "wedged" and "slow", which is
      // exactly the ambiguity the ladder resolves. The fast path fires on an
      // observed rejection while hidden with a hint, which is positive evidence
      // that `_initializationPromise` has already rejected; from there the SDK
      // is wedged for the life of the page and no amount of asking again can
      // change that (`authStateReady()` is built on the same promise and never
      // settles). Running the ladder there would spend 12 s to re-learn what we
      // already know, and spending it is the opposite of what the fast path is
      // for. A terminal error code is still honoured on both paths.
      const plan = (viaFastPath && !shouldClearStoredUser(errorCode))
        ? { action: WEDGED_PLAN, delayMs: 0, attempt: retryAttempt, keepsUser: true }
        : planAuthInitAttempt({ attempt: retryAttempt, hasHint, errorCode })
      if (plan.action === CLEAR) {
        setAuthStateTag('wedged')
        reportAuthInitFailure({
          action: CLEAR, viaFastPath, documentHidden, hidDuringInit, recoveryAttempted,
          attempt: retryAttempt, errorCode,
        })
        clearStoredUser(errorCode)
        return
      }
      if (plan.action === RETRY) {
        retryAttempt = plan.attempt
        // Reported at `warning`, not `error`: a retry is the system working.
        // Reporting it anyway is what makes the ladder visible in triage — the
        // alternative files only the cases where it failed, which reads as if
        // it never helps.
        reportAuthInitFailure({
          action: RETRY, viaFastPath, documentHidden, hidDuringInit, recoveryAttempted,
          attempt: plan.attempt, errorCode,
        })
        console.warn(`[auth] auth init unresolved — retry ${plan.attempt}/${AUTH_INIT_RETRY_DELAYS_MS.length} in ${plan.delayMs}ms`)
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => {
          if (disposedRef.current) return
          void probeAuthInit().then((result) => {
            if (disposedRef.current) return
            runWatchdogDecision({ viaFastPath, errorCode: result.errorCode })
          })
        }, plan.delayMs)
        return
      }

      // Out of rungs. The session is KEPT — falling through here means we could
      // not confirm it, not that it is dead — and recovery moves to the reload.
      const action = decideAuthInitRecovery({ hasHint, recoveryAttempted, documentHidden })
      // Only a HINTED device is a failure worth reporting — a slow cold start
      // on a signed-out visitor is ordinary and must not page anyone.
      if (hasHint && !failureReported) {
        failureReported = true
        setAuthStateTag('wedged')
        reportAuthInitFailure({
          action, viaFastPath, documentHidden, hidDuringInit, recoveryAttempted,
          attempt: retryAttempt, errorCode,
        })
      }
      if (action === DEFER) {
        // Hold the loader and re-decide when the user comes back to the tab.
        if (recoveryVisibilityListener) return
        recoveryVisibilityListener = () => {
          if (document.visibilityState !== 'visible') return
          document.removeEventListener('visibilitychange', recoveryVisibilityListener)
          recoveryVisibilityListener = null
          runWatchdogDecision({ viaFastPath })
        }
        document.addEventListener('visibilitychange', recoveryVisibilityListener)
        return
      }
      if (action === RELOAD) {
        // Record the attempt BEFORE reloading. If it cannot be stored we have no
        // way to stop a second identical failure reloading again, so we reveal
        // instead — /login is a bad outcome, a reload loop is a worse one.
        if (markRecoveryAttempted(storage)) {
          reloadToRecover()
          return
        }
      }
      revealAsSignedOut()
    }
    const timeout = setTimeout(() => {
      if (disposedRef.current) return
      console.warn(`[auth] restoration watchdog fired after ${watchdogMs}ms without an auth event`)
      runWatchdogDecision()
    }, watchdogMs)

    // ── The fast path ────────────────────────────────────────────────────────
    // Both listeners are armed only while auth is unresolved, and are torn down
    // by the first auth event. Together they turn "wait 30 s and infer" into
    // "notice the failure when it happens".
    const noteHide = () => {
      if (document.visibilityState === 'hidden') hidDuringInit = true
    }
    // A rejection is only meaningful once the preconditions hold — see
    // shouldFastRecover. The rejection fires while the tab is still hidden, so
    // this normally resolves to DEFER and the reload lands the instant the user
    // comes back, instead of at the 30 s timeout.
    const onUnhandledRejection = () => {
      if (disposedRef.current) return
      if (!shouldFastRecover({
        hasHint: hasAuthSessionHint(),
        authUnresolved: true, // torn down on the first auth event, so still true here
        hidDuringInit,
      })) return
      clearTimeout(timeout)
      console.warn('[auth] auth init failed while the tab was hidden — recovering early')
      runWatchdogDecision({ viaFastPath: true })
    }
    document.addEventListener('visibilitychange', noteHide)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    // The page may already be hidden on arrival (a background tab restore), in
    // which case no visibilitychange will ever fire to tell us.
    noteHide()
    const disarmFastPath = () => {
      document.removeEventListener('visibilitychange', noteHide)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
    if (import.meta.env.DEV) console.info('[auth] waiting for Firebase to restore the session…')

    // (Re-)attach the profile snapshot for `user`. Factored out of the
    // onAuthStateChanged callback so useAuthRecovery can call it again after a
    // resume, replacing a listener that may have gone silent while the tab
    // slept. Always tears down the previous listener first.
    const subscribeProfile = (user) => {
      if (unsubProfile) {
        try { unsubProfile() } catch { /* listener already torn down */ }
        unsubProfile = null
      }
      unsubProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (snap) => {
          if (disposedRef.current) return
          if (snap.exists()) {
            const profile = toUserProfile(user.uid, snap.data())
            // Soft-suspend: if an admin has flipped status to
            // 'suspended' or 'deleted', sign the user out immediately
            // and surface a clear message via window.alert. The
            // ProtectedRoute layer would otherwise let them keep
            // navigating until the session expires.
            const status = profile?.status || 'active'
            if (status === 'suspended' || status === 'deleted') {
              setUserProfile(null)
              setProfileIssue(null)
              setLoading(false)
              signOut(auth).catch(() => null)
              if (typeof window !== 'undefined') {
                setTimeout(() => {
                  window.alert(
                    status === 'suspended'
                      ? 'Your account has been suspended. Please contact support.'
                      : 'This account is no longer active.',
                  )
                }, 50)
              }
              return
            }
            setUserProfile(profile)
            setProfileIssue(null)
            setLoading(false)
            if (import.meta.env.DEV) console.info('[auth] profile loaded, role:', profile?.role)
            // Audit B2 — identify with uid + role only (no email).
            // Safe to call repeatedly; PostHog dedupes on uid.
            identifyUser(user.uid, profile?.role)
            // The role is only known here, not at the onAuthStateChanged
            // call below, and it is what decides whether either replay
            // system may record this session (Privacy Policy §4).
            setSentryUser(user.uid, profile?.role)
            return
          }

          // The document is gone because the user is deleting their account.
          // Repairing it here is what recreated three production profiles
          // mid-purge — the listener saw the delete, called
          // bootstrapUserProfile, and the server (whose Auth user was still
          // alive at the time) wrote a fresh `learner` profile back over it.
          // Drop to the signed-out shape and let the deletion finish.
          if (isAccountDeletionInFlight()) {
            setUserProfile(null)
            setProfileIssue(null)
            setLoading(false)
            return
          }

          void (async () => {
            const repairedProfile = await bootstrapMissingProfile(user)
            if (disposedRef.current) return
            if (repairedProfile) {
              setUserProfile(repairedProfile)
              setProfileIssue(null)
              identifyUser(user.uid, repairedProfile?.role)
              setSentryUser(user.uid, repairedProfile?.role)
            } else {
              setUserProfile(null)
              setProfileIssue('missing')
            }
            setLoading(false)
          })()
        },
        async (e) => {
          if (disposedRef.current) return
          console.error('profile subscription:', e)
          // Stale-token recovery: a tab idle for hours can wake with an
          // expired ID token, which Firestore surfaces as permission-denied
          // / unauthenticated even though the account is fine. Try ONE forced
          // refresh + re-subscribe before giving up.
          if (e?.code === 'permission-denied' || e?.code === 'unauthenticated') {
            const now = Date.now()
            // Throttle so a persistent denial can't loop getIdToken/Firestore.
            if (now - lastProfileRefreshAt >= REFRESH_THROTTLE_MS) {
              lastProfileRefreshAt = now
              try {
                await user.getIdToken(true)
                if (disposedRef.current) return
                subscribeProfile(user)
                return
              } catch (refreshErr) {
                if (disposedRef.current) return
                // Only a genuinely terminal auth failure ends the session. A
                // flaky/offline network, a rate-limit, or an unclassifiable
                // throw must NOT sign the user out — doing so was the spurious
                // "logged out on reload" bug on Zambian mobile links. Defer to
                // the same policy useAuthRecovery uses; on a non-terminal
                // failure fall through to a recoverable 'unreadable' state and
                // let the recovery hook retry on the next resume/online event.
                const online = typeof navigator !== 'undefined' ? navigator.onLine : true
                if (shouldExpireSession(refreshErr?.code, online)) {
                  expireSession(`snapshot-${e.code}:${refreshErr?.code || 'unknown'}`)
                  return
                }
              }
            }
            // Already refreshed within the throttle window, or the refresh
            // failed transiently: keep the session and surface a recoverable
            // state instead of a logout.
            if (disposedRef.current) return
            setUserProfile(null)
            setProfileIssue('unreadable')
            setLoading(false)
            return
          }
          // Transient / network errors: surface a recoverable state rather
          // than nuking the session. The recovery hook retries on resume.
          setUserProfile(null)
          setProfileIssue('unreadable')
          setLoading(false)
        },
      )
    }

    subscribeProfileRef.current = () => {
      if (auth.currentUser) subscribeProfile(auth.currentUser)
    }

    // Deleting an account tears this listener down BEFORE the callable runs,
    // so the delete of users/{uid} never reaches the snapshot handler at all.
    // The in-flight flag above is the backstop for a listener re-attached by
    // the resume path while the purge is still running.
    const unsubDeletionStart = onAccountDeletionStart(() => {
      if (unsubProfile) {
        try { unsubProfile() } catch { /* listener already torn down */ }
        unsubProfile = null
      }
    })

    const unsub = onAuthStateChanged(auth, (user) => {
      clearTimeout(timeout)
      // Firebase spoke — abandon any rung still waiting to fire, and reset the
      // ladder so a later failure episode gets its own full three attempts.
      clearTimeout(retryTimer)
      retryTimer = null
      retryAttempt = 0
      // Firebase initialised, so this failure episode is over. Give the tab its
      // recovery reload back — a session that hits the hide-during-init race
      // again later deserves the same rescue, and cannot loop because every
      // cycle requires a successful initialisation in between.
      if (recoveryVisibilityListener) {
        document.removeEventListener('visibilitychange', recoveryVisibilityListener)
        recoveryVisibilityListener = null
      }
      disarmFastPath()
      setAuthStateTag('resolved')

      // ── The rescued session ──────────────────────────────────────────────
      // Firebase's initialisation re-verifies the persisted user over the
      // network and, on ANY failure that is not a rejected fetch, deletes it
      // — a rate limit, a 5xx, an attestation refusal, an unmapped server
      // string. That deletion happens inside the SDK, before this callback,
      // so it arrives here as an ordinary `user === null`: indistinguishable
      // from a real sign-out, and the reason a working account was signed out
      // on reload. `firebase/authSessionGuard` refuses that deletion unless
      // the server actually rejected the credential, and says so here.
      //
      // Read-once: disarming returns the outcome AND clears it, so a later
      // deliberate sign-out on this same listener can never be mistaken for a
      // rescue (see disarmAuthSessionGuard).
      const { preserved: sessionRescued, verdict: rescueVerdict } = disarmAuthSessionGuard()
      const recoveryStorage = typeof window !== 'undefined' ? window.sessionStorage : null
      if (!user && sessionRescued && hasAuthSessionHint()) {
        // A BUDGET OF ITS OWN — see AUTH_SESSION_RESCUE_KEY. This used to spend
        // the wedge recovery's single flag, and the two answer different
        // failures: the wedge reloads without `onAuthStateChanged` ever firing,
        // so the flag it set survived into the next load (sessionStorage does)
        // and was read here as an attempt this failure had already spent. The
        // rescue was then refused, execution fell through, and `authReady` was
        // set with `currentUser === null` — which every route guard correctly
        // reads as signed out. That is a logout of an account whose session is
        // still on disk and was never rejected by anyone.
        //
        // The stored session is still on disk, and re-driving initialisation is
        // the only way to make the SDK read it again — but a condition that
        // outlives the whole ladder must not reload forever, and /login is a
        // better outcome than a loop.
        const plan = planSessionRescue({ attempts: readRescueAttempts(recoveryStorage) })
        const rescueContext = {
          viaFastPath: false,
          documentHidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
          hidDuringInit,
          errorCode: `boot-verdict-${rescueVerdict ?? 'not-observed'}`,
        }
        if (plan.action === RELOAD && recordRescueAttempt(recoveryStorage, plan.attempt)) {
          setAuthStateTag('wedged')
          reportAuthInitFailure({
            ...rescueContext,
            action: 'session-rescued',
            recoveryAttempted: plan.attempt > 1,
            attempt: plan.attempt,
          })
          console.warn(
            '[auth] the stored session survived a failed boot check — re-driving initialisation',
            { verdict: rescueVerdict ?? 'not-observed', attempt: plan.attempt, delayMs: plan.delayMs },
          )
          // `loading` and `authReady` are deliberately left as they are, so the
          // guards keep showing the branded restoration screen rather than
          // flashing /login while we wait.
          setTimeout(() => {
            if (disposedRef.current) return
            try {
              window.location.reload()
            } catch (err) {
              // A reload we cannot perform would leave the user on the
              // restoration loader indefinitely. Falling back to the normal
              // signed-out reveal is the worse outcome of the two, not the
              // worst one.
              console.error('[auth] session-rescue reload failed:', err)
              revealAsSignedOut()
            }
          }, plan.delayMs)
          return
        }
        // Out of budget (or storage we cannot write, which is the same answer
        // for termination). This is the moment a valid-looking session becomes
        // a trip to /login, and it used to be a bare console.warn — the one
        // outcome in this whole path with no telemetry at all, which is why it
        // never appeared in triage beside the rescues that succeeded.
        setAuthStateTag('wedged')
        reportAuthInitFailure({
          ...rescueContext,
          action: 'session-rescue-exhausted',
          recoveryAttempted: true,
          attempt: plan.attempt,
        })
        console.warn('[auth] boot check kept failing after every rescue — revealing as signed out')
      }

      // Both budgets are returned to the tab by an auth event that actually
      // settled. Each is cleared only here, and never by the other's failure.
      clearRecoveryAttempted(recoveryStorage)
      clearRescueAttempts(recoveryStorage)
      // Firebase has actually spoken. Set HERE and nowhere else — in particular
      // NOT by the watchdog above, which drops `loading` without knowing who
      // the user is. `loading === false` therefore means "stop waiting", which
      // is the right signal for rendering something; `authSettled` means "this
      // is the answer", which is the only safe signal for a decision that gets
      // frozen for the rest of a session. Conflating them lets a slow cold
      // start latch a returning learner as anonymous. See
      // `useAssessmentEngineFlag`, which is the first consumer to need the
      // distinction.
      setAuthSettled(true)
      setAuthReady(true)
      // The module-level mirror the Firestore read path waits on. Same single
      // setter, same single moment — see utils/authReadyGate.js.
      markAuthReady()
      if (import.meta.env.DEV) {
        console.info('[auth] auth state resolved:', user ? `uid=${user.uid}` : 'no user (signed out)')
      }
      if (unsubProfile) {
        try { unsubProfile() } catch { /* listener already torn down */ }
        unsubProfile = null
      }
      setCurrentUser(user)
      setEmailVerified(user ? user.emailVerified : null)
      setProfileIssue(null)
      // Tag Sentry with the signed-in UID so an error can be traced to a
      // specific learner/teacher for support triage. Only the UID is
      // sent — no email or displayName — to keep the PII surface tiny.
      // No-op if Sentry isn't configured (DSN unset).
      if (user) {
        // Remember that this device has a live session so the next cold
        // start routes straight to the loader → dashboard instead of
        // flashing the marketing page (see AUTH_HINT_KEY).
        setAuthSessionHint(true)
        // No role yet — the profile read hasn't returned. Deliberately
        // called without one so error-replay stays off until the profile
        // listener above re-calls this with the role it resolved.
        setSentryUser(user.uid)
        // Audit A5.1 — opportunistically refresh the FCM token if the
        // user has previously granted permission. Silent no-op on
        // first-ever sign-in (permission still 'default'), on iOS
        // Safari < 16.4, and inside the Capacitor wrapper. The
        // explicit opt-in card lives in <PushPermissionPrompt /> on
        // the dashboard.
        refreshTokenIfGranted(user.uid).catch((err) => {
          console.warn('[push] refresh on sign-in failed:', err)
        })
      } else {
        // No live session — clear the cold-start hint so a signed-out
        // visitor gets Marketing immediately on the next open, no spinner.
        setAuthSessionHint(false)
        clearSentryUser()
        // Audit B2 — clear analytics identity so the next user (e.g.
        // shared phone) doesn't inherit the previous distinct_id.
        resetAnalytics()
        // Forget the uid the native FCM token-rotation listener persists
        // against, so a token that rotates while signed out on a shared
        // device isn't re-attributed to the user who just left.
        clearPushUser()
        // Safe caching layer (CLAUDE.md #13.1/#13.9) — drop every cached
        // search/query result so a shared device never serves the previous
        // user's cached data to whoever signs in next. Covers every
        // sign-out path (explicit logout, forced session expiry, another
        // tab signing out), not just the logout() call below.
        clearAllSearchCaches()
      }
      if (user) {
        setLoading(true)
        subscribeProfile(user)
      } else {
        setUserProfile(null)
        setProfileIssue(null)
        setLoading(false)
      }
    })
    return () => {
      disposedRef.current = true
      clearTimeout(timeout)
      clearTimeout(retryTimer)
      if (recoveryVisibilityListener) {
        document.removeEventListener('visibilitychange', recoveryVisibilityListener)
        recoveryVisibilityListener = null
      }
      disarmFastPath()
      subscribeProfileRef.current = null
      unsubDeletionStart()
      if (unsubProfile) {
        try { unsubProfile() } catch { /* already torn down */ }
      }
      unsub()
    }
  }, [bootstrapMissingProfile, expireSession])

  // On tab/app resume, force an ID-token refresh and re-establish the profile
  // snapshot if it was dropped. If the session is genuinely dead, expire it
  // (→ signOut → ProtectedRoute redirects to /login with a notice). Disables
  // itself automatically once there's no signed-in user.
  useAuthRecovery({
    currentUser,
    enabled: !!currentUser,
    onResubscribe: () => {
      subscribeProfileRef.current?.()
      // The resume-path token refresh may have picked up a verification done
      // on another device — sync the explicit state so guards re-evaluate.
      if (auth.currentUser) setEmailVerified(auth.currentUser.emailVerified)
    },
    onSessionExpired: (reason) => expireSession(`resume-${reason}`),
  })

  /**
   * Memoised — but read this before assuming it buys what the equivalent memo
   * in DataSaverContext / PlatformSettingsContext buys, because it does not.
   *
   * Those two providers sit INSIDE AuthProvider in main.jsx, so they re-render
   * whenever an ancestor does while their own state is unchanged; memoising
   * their value stops a token refresh re-rendering every consumer of theirs.
   *
   * AuthProvider has no such ancestor. Its only re-render triggers are its own
   * seven useState values — currentUser, userProfile, loading, authSettled,
   * authReady, profileIssue, emailVerified — and every one of them is a dependency of this
   * object (useAuthRecovery holds refs and effects only, no state). So this memo
   * is invalidated on essentially every render that actually occurs, and it does
   * NOT meaningfully reduce consumer re-renders. Do not cite it as if it did.
   *
   * What it is worth: it holds the object's identity stable if the component
   * ever re-renders for a reason that is not one of these values (a future hook
   * with state, a parent that starts re-rendering), and it makes the set of
   * things that can change the value explicit and lint-checked. The real win for
   * the 219 useAuth() consumers is the stable action identities above.
   *
   * The change that WOULD cut consumer re-renders is splitting this into a state
   * context and a stable actions context, so a component that only needs
   * `logout` stops re-rendering on every auth state change. That is an API
   * change across all 219 consumers and belongs in its own PR.
   */
  const value = useMemo(() => ({
    currentUser, userProfile, loading, authSettled, authReady, profileIssue,
    emailVerified,
    needsEmailVerification: !!currentUser && emailVerified === false,
    refreshEmailVerification, resendVerificationEmail,
    login, loginWithGoogle, register, logout, resetPassword,
    fetchUserProfile, ensureUserProfile, refreshProfile, retrySession, updateProfileFields, updateLearnerGrade,
    isLearner, isTeacher, isParent, isAdmin, isAdminOnly, isSuperAdmin, isPremium, isPaidTeacher, canAccessFullContent, canAccessLearnerPortal,
    permissions,
    userStatus, isSuspended,
    mfaEnrolled,
  }), [
    currentUser, userProfile, loading, authSettled, authReady, profileIssue, emailVerified,
    refreshEmailVerification, resendVerificationEmail,
    login, loginWithGoogle, register, logout, resetPassword,
    fetchUserProfile, ensureUserProfile, refreshProfile, retrySession, updateProfileFields, updateLearnerGrade,
    isLearner, isTeacher, isParent, isAdmin, isAdminOnly, isSuperAdmin, isPremium, isPaidTeacher, canAccessFullContent, canAccessLearnerPortal,
    permissions, userStatus, isSuspended, mfaEnrolled,
  ])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
