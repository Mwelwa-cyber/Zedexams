import { useAuth } from '../contexts/AuthContext'
import { useFirestore } from './useFirestore'
import { getActivePlan, ACCESS_LEVELS } from '../utils/subscriptionConfig'

export function useSubscription() {
  const { currentUser, userProfile, isPremium, isAdmin, isPaidTeacher } = useAuth()
  const { checkAndConsumeAttempt } = useFirestore()

  const plan = getActivePlan(userProfile)

  // Access level: admin and paid teachers get full content; everyone else is demo-only
  const canAccessFullContent = isAdmin || isPaidTeacher
  const isDemoOnly           = !canAccessFullContent
  const accessLevel          = canAccessFullContent ? ACCESS_LEVELS.FULL : ACCESS_LEVELS.DEMO_ONLY

  // Feature flags (still gated by premium subscription for learners)
  const canUseExamMode          = isPremium || plan.examMode
  const canUseWeaknessAnalysis  = isPremium || plan.weaknessAnalysis
  const paperLimit              = isAdmin || isPremium ? Infinity : (plan.paperLimit ?? 3)

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
    canUseExamMode,
    canUseWeaknessAnalysis,
    paperLimit,
    tryStartQuiz,
    // Legacy fields kept so existing components don't break
    attemptsLeft: Infinity,
    usedToday: 0,
    dailyLimit: Infinity,
    isAtLimit: false,
    checkAndConsumeAttempt,
  }
}
