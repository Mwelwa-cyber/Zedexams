import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { ROLES } from '../utils/subscriptionConfig'

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
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName })
    await setDoc(doc(db, 'users', cred.user.uid), {
      displayName,
      email,
      role,
      grade: grade ?? null,
      school: school ?? '',
      isPremium: false,
      subscriptionPlan: 'free',
      subscriptionExpiry: null,
      subscriptionActivatedBy: null,
      dailyAttempts: 0,
      lastAttemptDate: '',
      createdAt: serverTimestamp(),
    })
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
  const isPremium  = (() => {
    if (!userProfile?.isPremium) return false
    if (!userProfile?.subscriptionExpiry) return true
    const expiry = userProfile.subscriptionExpiry?.toDate?.() ?? new Date(userProfile.subscriptionExpiry)
    return expiry > new Date()
  })()
  // Paid teacher: has teacher role AND active premium subscription
  const isPaidTeacher = (userProfile?.role === ROLES.TEACHER) && isPremium
  // Full content access: admin always, or paid teacher
  const canAccessFullContent = isAdmin || isPaidTeacher

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 2500)
    const unsub = onAuthStateChanged(auth, async (user) => {
      clearTimeout(timeout)
      setCurrentUser(user)
      if (user) await fetchUserProfile(user.uid)
      else setUserProfile(null)
      setLoading(false)
    })
    return () => { clearTimeout(timeout); unsub() }
  }, [fetchUserProfile])

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
