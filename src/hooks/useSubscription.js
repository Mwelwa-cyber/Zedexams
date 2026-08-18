import { useAuth } from '../contexts/AuthContext'
// The attempt limiter is imported DIRECTLY, not through `useFirestore`.
// `useSubscription` is reached eagerly from the app shell (App.jsx → the
// subscription front door, and Navbar), so importing the whole Firestore
// surface here put the quiz write schema and the question schema into every
// learner's first paint for the sake of one 12-line counter. See
// ./firestore/attemptLimiter.js. Do not route this back through useFirestore.
import { checkAndConsumeAttempt } from './firestore/attemptLimiter'
import { getActivePlan, getPlanTier, ACCESS_LEVELS } from '../engines/payment-engine/subscriptionConfig'

export function useSubscription() {
  const { currentUser, userProfile, isPremium, isAdmin, isPaidTeacher } = useAuth()

  const plan = getActivePlan(userProfile)

  // Plain tier name for display on the profile: 'Free' | 'Pro' | 'Max'.
  // Premium learner plans map to 'Max' (see getPlanTier).
  const planTier = getPlanTier(userProfile)
  const tierLabel = planTier === 'pro' ? 'Pro' : planTier === 'max' ? 'Max' : 'Free'

  // Access level: admins, paid teachers, and premium learners get full content.
  const canAccessFullContent = isAdmin || isPaidTeacher || isPremium
  const isDemoOnly           = !canAccessFullContent
  const accessLevel          = canAccessFullContent ? ACCESS_LEVELS.FULL : ACCESS_LEVELS.DEMO_ONLY

  // Feature flags (still gated by premium subscription for learners)
  const canUseExamMode          = isPremium || plan.examMode
  const canUseWeaknessAnalysis  = isPremium || plan.weaknessAnalysis

  // Access badge info for display
  const accessBadge = isAdmin
    ? { label: 'Admin Access',   color: 'green',  icon: '🛡️' }
    : isPaidTeacher
    ? { label: 'Teacher Plan',   color: 'blue',   icon: '🎓' }
    : isPremium
    ? { label: 'Premium',        color: 'yellow', icon: '⭐' }
    : { label: 'Demo Access',    color: 'gray',   icon: '🔓' }

  // Legacy: tryStartQuiz kept for backwards compat but no longer enforces daily limit
  async function tryStartQuiz() {
    if (!currentUser) return { allowed: false, reason: 'not_authenticated' }
    return { allowed: true, reason: null }
  }

  return {
    isPremium,
    isAdmin,
    isPaidTeacher,
    canAccessFullContent,
    isDemoOnly,
    accessLevel,
    accessBadge,
    plan,
    planId: plan.id,
    planName: plan.name,
    planTier,
    tierLabel,
    canUseExamMode,
    canUseWeaknessAnalysis,
    tryStartQuiz,
    // Legacy fields kept so existing components don't break
    attemptsLeft: Infinity,
    usedToday: 0,
    dailyLimit: Infinity,
    isAtLimit: false,
    checkAndConsumeAttempt,
  }
}
