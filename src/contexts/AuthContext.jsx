import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { doc, setDoc, getDoc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore'
import app, { auth, db } from '../firebase/config'
import { ROLES, hasPremiumAccess } from '../utils/subscriptionConfig'
import { useIdleTimeout } from '../hooks/useIdleTimeout'

// Sign learners/teachers/admins out after this much idle time, with a short
// countdown beforehand so an active user can keep their session.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000
const IDLE_WARNING_MS = 60 * 1000

const AuthContext = createContext(null)
const functions = getFunctions(app, 'us-central1')
const bootstrapUserProfileCallable = httpsCallable(functions, 'bootstrapUserProfile')

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

function toUserProfile(uid, data) {
  return data ? { id: uid, ...data } : null
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading]         = useState(true)
  const [profileIssue, setProfileIssue] = useState(null)
  const [showIdleWarning, setShowIdleWarning] = useState(false)
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(Math.ceil(IDLE_WARNING_MS / 1000))
  const bootstrapInFlightRef = useRef(new Map())

  async function register(email, password, displayName, grade, school, role = ROLES.LEARNER) {
    const wantsTeacherAccess = role === ROLES.TEACHER
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName })
    const userRecord = {
      displayName,
      email,
      role: ROLES.LEARNER,
      grade: grade ?? null,
      school: school ?? '',
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
      createdAt: serverTimestamp(),
    }
    if (wantsTeacherAccess) {
      userRecord.teacherApplicationStatus = 'not_submitted'
    }
    await setDoc(doc(db, 'users', cred.user.uid), userRecord)
    return cred
  }

  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password)
  }

  function resetPassword(email) {
    return sendPasswordResetEmail(auth, email)
  }

  async function logout() {
    setUserProfile(null)
    setProfileIssue(null)
    setShowIdleWarning(false)
    return signOut(auth)
  }

  const { stayActive: resetIdle } = useIdleTimeout({
    enabled: !!currentUser,
    idleMs: IDLE_TIMEOUT_MS,
    warnMs: IDLE_WARNING_MS,
    onWarn: (secondsLeft) => {
      setIdleSecondsLeft(secondsLeft)
      setShowIdleWarning(true)
    },
    onTick: (secondsLeft) => setIdleSecondsLeft(secondsLeft),
    onResumeActivity: () => setShowIdleWarning(false),
    onTimeout: () => {
      setShowIdleWarning(false)
      logout().catch((e) => console.error('Idle logout failed:', e))
    },
  })

  const stayActive = useCallback(() => {
    setShowIdleWarning(false)
    resetIdle()
  }, [resetIdle])

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

  const isLearner  = userProfile?.role === ROLES.LEARNER
  const isTeacher  = userProfile?.role === ROLES.TEACHER || userProfile?.role === ROLES.ADMIN
  const isAdmin    = userProfile?.role === ROLES.ADMIN
  const isPremium  = hasPremiumAccess(userProfile)
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
      if (user) {
        setLoading(true)
        unsubProfile = onSnapshot(
          doc(db, 'users', user.uid),
          (snap) => {
            if (disposed) return
            if (snap.exists()) {
              setUserProfile(toUserProfile(user.uid, snap.data()))
              setProfileIssue(null)
              setLoading(false)
              return
            }

            void (async () => {
              const repairedProfile = await bootstrapMissingProfile(user)
              if (disposed) return
              if (repairedProfile) {
                setUserProfile(repairedProfile)
                setProfileIssue(null)
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
      login, register, logout, resetPassword,
      fetchUserProfile, ensureUserProfile, refreshProfile, updateProfileFields,
      isLearner, isTeacher, isAdmin, isPremium, isPaidTeacher, canAccessFullContent,
      showIdleWarning, idleSecondsLeft, stayActive,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}
