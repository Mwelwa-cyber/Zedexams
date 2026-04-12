// Single source of truth for all plan limits and pricing.
// To change a limit, edit ONLY this file.

export const ROLES = {
  LEARNER: 'learner',
  TEACHER: 'teacher',
  ADMIN:   'admin',
}

// Access levels for content gating.
// - DEMO_ONLY: free learners + unpaid teachers (demo quizzes only)
// - FULL:      admin + paid teachers (all quizzes)
export const ACCESS_LEVELS = {
  DEMO_ONLY: 'demo_only',
  FULL:      'full',
}

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Get started at no cost',
    priceZMW: 0,
    dailyQuizLimit: Infinity,   // no longer enforced — demo-only access replaces daily limits
    paperLimit: 3,
    weaknessAnalysis: false,
    examMode: false,
    badge: null,
    features: ['Demo quizzes (one per subject)', '3 past papers', 'Basic results', 'Practice mode only'],
    locked:   ['All quizzes', 'All past papers', 'Exam mode (timed)', 'Weakness analysis'],
  },
  monthly: {
    id: 'monthly',
    name: 'Monthly',
    tagline: 'Flexible — cancel anytime',
    priceZMW: 50,
    durationDays: 30,
    dailyQuizLimit: Infinity,
    paperLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '⭐',
    features: ['Unlimited quizzes', 'All past papers', 'Exam mode (timed)', 'Weakness analysis', 'Priority support'],
    locked: [],
  },
  termly: {
    id: 'termly',
    name: 'Termly',
    tagline: 'Best value per term',
    priceZMW: 120,
    durationDays: 91,
    dailyQuizLimit: Infinity,
    paperLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '🏆',
    features: ['Everything in Monthly', 'Save 20% vs monthly', 'Valid for a full term'],
    locked: [],
  },
  yearly: {
    id: 'yearly',
    name: 'Yearly',
    tagline: 'Best deal — whole year',
    priceZMW: 400,
    durationDays: 365,
    dailyQuizLimit: Infinity,
    paperLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '💎',
    features: ['Everything in Termly', 'Save 33% vs monthly', 'Valid for a full year'],
    locked: [],
  },
}

// Edit with your real MTN/Airtel numbers before going live
export const PAYMENT_DETAILS = {
  MTN: {
    name: 'MTN Mobile Money',
    number: '0968 310 746',
    instructions: 'Dial *303# → Send Money → Enter number → Enter amount → Confirm',
  },
  Airtel: {
    name: 'Airtel Money',
    number: '0977 740 465',
    instructions: 'Dial *778# → Send Money → Enter number → Enter amount → Confirm',
  },
  contact: {
    whatsapp: '+260968310746',
    email: 'admin@examprep.zm',
  },
}

export function getActivePlan(userProfile) {
  if (!userProfile?.isPremium) return PLANS.free
  if (userProfile.subscriptionExpiry) {
    const expiry = userProfile.subscriptionExpiry?.toDate?.() ?? new Date(userProfile.subscriptionExpiry)
    if (expiry < new Date()) return PLANS.free
  }
  return PLANS[userProfile.subscriptionPlan] ?? PLANS.monthly
}

export function daysUntilExpiry(userProfile) {
  if (!userProfile?.isPremium || !userProfile?.subscriptionExpiry) return null
  const expiry = userProfile.subscriptionExpiry?.toDate?.() ?? new Date(userProfile.subscriptionExpiry)
  const diff = Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : 0
}
