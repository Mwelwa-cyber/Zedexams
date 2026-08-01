import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
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
} from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc, setDoc, getDoc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore'
import app, { auth, db, googleProvider } from '../firebase/config'
import { isNativePlatform } from '../utils/runtime'
import { retryOnNetworkError } from '../utils/authRetry'
import { ROLES, hasPremiumAccess, hasLearnerPortalAccess } from '../utils/subscriptionConfig'
import { isSuperAdmin as isSuperAdminRole, resolvePermissionFlags } from '../utils/permissions'
import { setSentryUser, clearSentryUser } from '../utils/sentry'
import { capture, identifyUser, resetAnalytics } from '../utils/analytics'
import { requiresGuardianConsent } from '../utils/guardianConsent'
// (The guardian consent request is sent from the sign-up flow's guardian
// screen, which is the only place a guardian's address is collected.)
import { refreshTokenIfGranted, clearPushUser } from '../utils/fcm'
import { mintAndPersistReferralCode, readPendingReferral, clearPendingReferral } from '../utils/referrals'
import { clearAllSearchCaches } from '../utils/cache/searchCache.js'
import { useAuthRecovery } from '../hooks/useAuthRecovery'
import { shouldExpireSession, REFRESH_THROTTLE_MS } from '../hooks/authRecoveryPolicy'

const AuthContext = createContext(null)

// One-shot breadcrumb so the Login page can explain *why* the user landed
// back on it after a session was force-expired (stale/revoked token on
// resume). Read-and-cleared by Login; survives the signOut → redirect hop
// because it lives in sessionStorage, not React state.
export const SESSION_EXPIRED_KEY = 'auth:sessionExpired'

// Persisted "this device has a signed-in user" hint. Firebase restores the
// auth session from IndexedDB asynchronously on cold start, so for the first
// frames `auth.currentUser` is null even for a returning logged-in user. We
// drop this flag on sign-in and clear it on sign-out so the router can tell
// the two cases apart *synchronously* on the very first render: a returning
// user sees a loader (then their dashboard) instead of a flash of the public
// marketing page, while a genuinely signed-out visitor still gets Marketing
// immediately with no spinner. localStorage (not sessionStorage) so it
// survives the app being fully closed and reopened.
export const AUTH_HINT_KEY = 'auth:hasSession'
export function hasAuthSessionHint() {
  try { return localStorage.getItem(AUTH_HINT_KEY) === '1' } catch { return false }
}
function setAuthSessionHint(present) {
  try {
    if (present) localStorage.setItem(AUTH_HINT_KEY, '1')
    else localStorage.removeItem(AUTH_HINT_KEY)
  } catch { /* private mode / quota — fall back to the no-hint behaviour */ }
}

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
    // (Free / Trial / Pro / Expired is derived in utils/subscriptionStatus.js;
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

  async function register(email, password, displayName, grade, school, role = ROLES.LEARNER, extras = {}) {
    // Only learner / teacher / parent are self-selectable at signup; anything
    // else falls back to learner. Parents carry no grade and no teacher extras.
    const signupRole = (role === ROLES.TEACHER || role === ROLES.PARENT) ? role : ROLES.LEARNER
    const isTeacherSignup = signupRole === ROLES.TEACHER
    const isLearnerSignup = signupRole === ROLES.LEARNER
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
  }

  async function login(email, password) {
    // Auto-retry a transient `auth/network-request-failed` (a dropped/timed-out
    // fetch to Google's auth server — common on flaky Zambian mobile links)
    // before surfacing the error. Wrong-password / rate-limit / etc. are not
    // retried (see utils/authRetry.js).
    return retryOnNetworkError(() => signInWithEmailAndPassword(auth, email, password))
  }

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
  async function loginWithGoogle({ role, onboarding } = {}) {
    const targetRole = (role === ROLES.TEACHER || role === ROLES.PARENT) ? role : ROLES.LEARNER
    const cred = isNativePlatform()
      ? await signInWithGoogleNative()
      : await signInWithPopup(auth, googleProvider)
    const created = await ensureGoogleUserProfile(cred, targetRole, onboarding || {})
    try { cred.isNewAccount = created } catch { /* frozen credential — caller falls back */ }
    return cred
  }

  function resetPassword(email) {
    return sendPasswordResetEmailCallable({
      email,
      continueUrl: typeof window !== 'undefined' ? window.location.origin : 'https://zedexams.com',
    })
  }

  async function logout() {
    setUserProfile(null)
    setProfileIssue(null)
    return signOut(auth)
  }

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

  async function refreshProfile() {
    if (currentUser) return ensureUserProfile(currentUser)
  }

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

  async function updateProfileFields(fields) {
    if (!currentUser) return
    await updateDoc(doc(db, 'users', currentUser.uid), fields)
    setUserProfile(prev => ({ ...prev, ...fields }))
  }

  async function updateLearnerGrade(newGrade) {
    return updateProfileFields({ grade: Number(newGrade) })
  }

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
    const timeout = setTimeout(() => {
      if (disposedRef.current) return
      console.warn(`[auth] restoration watchdog fired after ${watchdogMs}ms without an auth event`)
      setLoading(false)
    }, watchdogMs)
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

    const unsub = onAuthStateChanged(auth, (user) => {
      clearTimeout(timeout)
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
      subscribeProfileRef.current = null
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

  return (
    <AuthContext.Provider value={{
      currentUser, userProfile, loading, profileIssue,
      emailVerified,
      needsEmailVerification: !!currentUser && emailVerified === false,
      refreshEmailVerification, resendVerificationEmail,
      login, loginWithGoogle, register, logout, resetPassword,
      fetchUserProfile, ensureUserProfile, refreshProfile, retrySession, updateProfileFields, updateLearnerGrade,
      isLearner, isTeacher, isParent, isAdmin, isAdminOnly, isSuperAdmin, isPremium, isPaidTeacher, canAccessFullContent, canAccessLearnerPortal,
      permissions,
      userStatus, isSuspended,
      mfaEnrolled,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
