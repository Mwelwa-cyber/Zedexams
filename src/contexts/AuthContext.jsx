import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc, setDoc, getDoc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore'
import app, { auth, db, googleProvider } from '../firebase/config'
import { ROLES, hasPremiumAccess, hasLearnerPortalAccess } from '../utils/subscriptionConfig'
import { isSuperAdmin as isSuperAdminRole, resolvePermissionFlags } from '../utils/permissions'
import { setSentryUser, clearSentryUser } from '../utils/sentry'
import { capture, identifyUser, resetAnalytics } from '../utils/analytics'
import { refreshTokenIfGranted } from '../utils/fcm'
import { mintAndPersistReferralCode, readPendingReferral, clearPendingReferral } from '../utils/referrals'

const AuthContext = createContext(null)
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

// Defaults that satisfy the create-user firestore rule. Used by both the
// email/password register flow and the first-time Google sign-in flow.
function defaultUserRecord({ displayName, email, role = ROLES.LEARNER, grade = null, school = '', referralCode = null, referredBy = null }) {
  return {
    displayName: displayName ?? '',
    email: email ?? '',
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

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading]         = useState(true)
  const [profileIssue, setProfileIssue] = useState(null)
  const bootstrapInFlightRef = useRef(new Map())

  async function register(email, password, displayName, grade, school, role = ROLES.LEARNER, extras = {}) {
    const isTeacherSignup = role === ROLES.TEACHER
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
      role: isTeacherSignup ? ROLES.TEACHER : ROLES.LEARNER,
      grade: isTeacherSignup ? null : (grade ?? null),
      school: school ?? '',
      referralCode,
      referredBy,
    })
    if (isTeacherSignup) {
      userRecord.province = String(extras.province || '').trim()
      userRecord.subject  = String(extras.subject  || '').trim()
    }
    await setDoc(doc(db, 'users', cred.user.uid), userRecord)
    if (referredBy) clearPendingReferral()
    // Fire the verification email but don't fail signup if delivery hiccups
    // (e.g. rate-limited, transient Firebase Auth outage). The user lands on
    // their dashboard and the email arrives shortly after; if it doesn't, the
    // /auth/action handler can still resend on demand.
    try {
      await sendEmailVerification(cred.user)
    } catch (err) {
      console.warn('sendEmailVerification failed:', err)
    }
    // Audit B2 — capture signup. Role + grade only; no email / no
    // displayName / no school in the event payload.
    capture('signup_completed', {
      role: isTeacherSignup ? 'teacher' : 'learner',
      grade: isTeacherSignup ? null : (grade ?? null),
      provider: 'email',
    })
    return cred
  }

  async function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password)
  }

  // Google sign-in. New users get a default profile; the caller can pass
  // `role` (used only on first sign-in) so the Register page can honour the
  // selected Learner/Teacher tab. Existing users keep their saved role.
  async function loginWithGoogle({ role } = {}) {
    const targetRole = role === ROLES.TEACHER ? ROLES.TEACHER : ROLES.LEARNER
    const cred = await signInWithPopup(auth, googleProvider)
    const userRef = doc(db, 'users', cred.user.uid)
    const snap = await getDoc(userRef)
    if (!snap.exists()) {
      // Audit C7 — same referral mint + capture as the email path.
      let referralCode = null
      try {
        referralCode = await mintAndPersistReferralCode(cred.user.uid)
      } catch (err) {
        console.warn('[loginWithGoogle] referral code mint failed', err)
      }
      const referredBy = readPendingReferral()
      await setDoc(userRef, defaultUserRecord({
        displayName: cred.user.displayName ?? '',
        email: cred.user.email ?? '',
        role: targetRole,
        referralCode,
        referredBy,
      }))
      if (referredBy) clearPendingReferral()
      // Audit B2 — only emit on the first-time path so Google
      // sign-IN by an existing user doesn't get counted as a signup.
      capture('signup_completed', { role: targetRole, provider: 'google' })
    }
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

  async function updateProfileFields(fields) {
    if (!currentUser) return
    await updateDoc(doc(db, 'users', currentUser.uid), fields)
    setUserProfile(prev => ({ ...prev, ...fields }))
  }

  async function updateLearnerGrade(newGrade) {
    return updateProfileFields({ grade: Number(newGrade) })
  }

  // Admin & superAdmin are equivalent everywhere — both get full access.
  const isSuperAdmin = isSuperAdminRole(userProfile)
  const isLearner  = userProfile?.role === ROLES.LEARNER
  const isTeacher  = userProfile?.role === ROLES.TEACHER || isSuperAdmin
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

  useEffect(() => {
    let unsubProfile = null
    let disposed = false
    // Watchdog: if Firebase auth + Firestore profile snapshot don't resolve
    // within this window, drop the loading gate so the user sees *something*.
    // 5 s gives slower Zambian networks enough time to complete the round-trip
    // before we fall back to the generic "loading your workspace…" screen.
    const timeout = setTimeout(() => {
      if (!disposed) setLoading(false)
    }, 5000)
    const unsub = onAuthStateChanged(auth, (user) => {
      clearTimeout(timeout)
      if (unsubProfile) {
        unsubProfile()
        unsubProfile = null
      }
      setCurrentUser(user)
      setProfileIssue(null)
      // Tag Sentry with the signed-in UID so an error can be traced to a
      // specific learner/teacher for support triage. Only the UID is
      // sent — no email or displayName — to keep the PII surface tiny.
      // No-op if Sentry isn't configured (DSN unset).
      if (user) {
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
        clearSentryUser()
        // Audit B2 — clear analytics identity so the next user (e.g.
        // shared phone) doesn't inherit the previous distinct_id.
        resetAnalytics()
      }
      if (user) {
        setLoading(true)
        unsubProfile = onSnapshot(
          doc(db, 'users', user.uid),
          (snap) => {
            if (disposed) return
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
              // Audit B2 — identify with uid + role only (no email).
              // Safe to call repeatedly; PostHog dedupes on uid.
              identifyUser(user.uid, profile?.role)
              return
            }

            void (async () => {
              const repairedProfile = await bootstrapMissingProfile(user)
              if (disposed) return
              if (repairedProfile) {
                setUserProfile(repairedProfile)
                setProfileIssue(null)
                identifyUser(user.uid, repairedProfile?.role)
              } else {
                setUserProfile(null)
                setProfileIssue('missing')
              }
              setLoading(false)
            })()
          },
          (e) => {
            console.error('profile subscription:', e)
            if (disposed) return
            setUserProfile(null)
            setProfileIssue('unreadable')
            setLoading(false)
          },
        )
      } else {
        setUserProfile(null)
        setProfileIssue(null)
        setLoading(false)
      }
    })
    return () => {
      disposed = true
      clearTimeout(timeout)
      if (unsubProfile) unsubProfile()
      unsub()
    }
  }, [bootstrapMissingProfile])

  return (
    <AuthContext.Provider value={{
      currentUser, userProfile, loading, profileIssue,
      login, loginWithGoogle, register, logout, resetPassword,
      fetchUserProfile, ensureUserProfile, refreshProfile, updateProfileFields, updateLearnerGrade,
      isLearner, isTeacher, isAdmin, isAdminOnly, isSuperAdmin, isPremium, isPaidTeacher, canAccessFullContent, canAccessLearnerPortal,
      permissions,
      userStatus, isSuspended,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
