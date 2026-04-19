import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { doc, setDoc, getDoc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { ROLES, hasPremiumAccess } from '../utils/subscriptionConfig'

const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading]         = useState(true)

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
    return signOut(auth)
  }

  const fetchUserProfile = useCallback(async (uid) => {
    try {
      const snap = await getDoc(doc(db, 'users', uid))
      if (snap.exists()) {
        const profile = { id: uid, ...snap.data() }
        setUserProfile(profile)
        return profile
      }
    } catch (e) { console.error('fetchUserProfile:', e) }
    return null
  }, [])

  async function refreshProfile() {
    if (currentUser) return fetchUserProfile(currentUser.uid)
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
    // Watchdog: if Firebase auth + Firestore profile snapshot don't resolve
    // within this window, drop the loading gate so the user sees *something*.
    // 5 s gives slower Zambian networks enough time to complete the round-trip
    // before we fall back to the generic "loading your workspace…" screen.
    const timeout = setTimeout(() => setLoading(false), 5000)
    const unsub = onAuthStateChanged(auth, (user) => {
      clearTimeout(timeout)
      if (unsubProfile) {
        unsubProfile()
        unsubProfile = null
      }
      setCurrentUser(user)
      if (user) {
        unsubProfile = onSnapshot(
          doc(db, 'users', user.uid),
          (snap) => {
            setUserProfile(snap.exists() ? { id: user.uid, ...snap.data() } : null)
            setLoading(false)
          },
          (e) => {
            console.error('profile subscription:', e)
            setUserProfile(null)
            setLoading(false)
          },
        )
      } else {
        setUserProfile(null)
        setLoading(false)
      }
    })
    return () => {
      clearTimeout(timeout)
      if (unsubProfile) unsubProfile()
      unsub()
    }
  }, [])

  return (
    <AuthContext.Provider value={{
      currentUser, userProfile, loading,
      login, register, logout, resetPassword,
      fetchUserProfile, refreshProfile, updateProfileFields,
      isLearner, isTeacher, isAdmin, isPremium, isPaidTeacher, canAccessFullContent,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}
