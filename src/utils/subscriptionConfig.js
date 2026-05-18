// Single source of truth for all plan limits and pricing.
// To change a limit, edit ONLY this file.

import { isSuperAdmin } from './permissions'

export const ROLES = {
  LEARNER:     'learner',
  TEACHER:     'teacher',
  ADMIN:       'admin',
  SUPER_ADMIN: 'superAdmin',
}

// Access levels for content gating.
// - DEMO_ONLY: free learners + unpaid teachers (demo quizzes only)
// - FULL:      admin + paid teachers + premium learners (all quizzes)
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
    weaknessAnalysis: false,
    examMode: false,
    badge: null,
    features: ['Demo quizzes (one per subject)', 'Basic results', 'Practice mode only'],
    locked:   ['All quizzes', 'Exam mode (timed)', 'Weakness analysis'],
  },
  monthly: {
    id: 'monthly',
    name: 'Monthly',
    tagline: 'Flexible — cancel anytime',
    priceZMW: 50,
    durationDays: 30,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '⭐',
    features: ['Unlimited quizzes', 'Exam mode (timed)', 'Weakness analysis', 'Priority support'],
    locked: [],
  },
  termly: {
    id: 'termly',
    name: 'Termly',
    tagline: 'Best value per term',
    priceZMW: 120,
    durationDays: 91,
    dailyQuizLimit: Infinity,
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
    weaknessAnalysis: true,
    examMode: true,
    badge: '💎',
    features: ['Everything in Termly', 'Save 33% vs monthly', 'Valid for a full year'],
    locked: [],
  },

  // ── Pro / Max tiers (matches /pricing marketing page) ──────────────────
  // Kept alongside the legacy monthly/termly/yearly plans so existing
  // subscribers keep their access; new subscriptions use these.
  pro_monthly: {
    id: 'pro_monthly',
    tier: 'pro',
    billing: 'monthly',
    name: 'Pro · Monthly',
    tagline: 'For the everyday teacher',
    priceZMW: 79,
    durationDays: 30,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '🦊',
    features: [
      '40 lesson plans / month',
      '25 worksheets & teacher notes',
      '8 assessments / month',
      '2 schemes of work / term',
      'Daily cap of 10 generations',
      'DOCX + PDF export',
      'Library kept forever',
      'Premium model quality',
    ],
    locked: [],
  },
  pro_yearly: {
    id: 'pro_yearly',
    tier: 'pro',
    billing: 'yearly',
    name: 'Pro · Yearly',
    tagline: 'Two months free vs monthly',
    priceZMW: 790,
    monthlyEquivalentZMW: 65,
    durationDays: 365,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '🦊',
    features: [
      'Everything in Pro · Monthly',
      'Save ~17% vs paying monthly',
      'Valid for a full year',
    ],
    locked: [],
  },
  max_monthly: {
    id: 'max_monthly',
    tier: 'max',
    billing: 'monthly',
    name: 'Max · Monthly',
    tagline: 'For HoDs & heavy users',
    priceZMW: 199,
    durationDays: 30,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '🦅',
    features: [
      'Unlimited plans, notes & worksheets*',
      'Unlimited assessments & schemes',
      'Daily cap of 30 generations',
      'Bulk export (whole term in one click)',
      'Priority queue when servers are busy',
      'Early access to new studios',
      'Email support, 24h reply',
      '*Fair use ~200/month',
    ],
    locked: [],
  },
  max_yearly: {
    id: 'max_yearly',
    tier: 'max',
    billing: 'yearly',
    name: 'Max · Yearly',
    tagline: 'Two months free vs monthly',
    priceZMW: 1990,
    monthlyEquivalentZMW: 165,
    durationDays: 365,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '🦅',
    features: [
      'Everything in Max · Monthly',
      'Save ~17% vs paying monthly',
      'Valid for a full year',
    ],
    locked: [],
  },
}

export const PAYMENT_DETAILS = {
  MTN: {
    name: 'MTN Mobile Money',
  },
  contact: {
    whatsapp: '+260968310746',
    email: 'admin@zedexams.com',
  },
}

function toDateValue(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function hasPremiumAccess(userProfile) {
  // Admin / super-admin accounts are always premium — they must be able to
  // test every paid feature without a subscription or expiry check.
  if (isSuperAdmin(userProfile)) return true

  const hasAccessFlag =
    userProfile?.premium === true ||
    userProfile?.isPremium === true ||
    userProfile?.paymentStatus === 'active' ||
    userProfile?.subscriptionStatus === 'active' ||
    userProfile?.plan === 'premium'

  if (!hasAccessFlag) return false

  const expiry = toDateValue(userProfile?.subscriptionExpiry)
  if (!expiry) return true
  return expiry > new Date()
}

// Whether the user can enter the learner-side dashboard / quizzes / lessons.
// - Admins: always.
// - Learners: their existing premium subscription IS their learner-portal
//   subscription, so we fall back to hasPremiumAccess().
// - Teachers: must have a SEPARATE active learner-portal subscription. Their
//   teacher-portal premium does NOT grant learner access.
export function hasLearnerPortalAccess(userProfile) {
  if (!userProfile) return false
  if (isSuperAdmin(userProfile)) return true
  if (userProfile.role === ROLES.TEACHER) {
    if (userProfile.learnerPortalActive !== true) return false
    const expiry = toDateValue(userProfile.learnerPortalExpiry)
    if (!expiry) return true
    return expiry > new Date()
  }
  // Learners (and anyone unknown) use the legacy premium gate so existing
  // free-tier rules (demo-only) still apply for non-premium learners.
  return hasPremiumAccess(userProfile)
}

export function getActivePlan(userProfile) {
  // Super admins get the top plan so any plan-feature flag (examMode,
  // weaknessAnalysis, generation caps) resolves to its most generous value.
  if (isSuperAdmin(userProfile)) return PLANS.max_yearly
  if (!hasPremiumAccess(userProfile)) return PLANS.free
  return PLANS[userProfile.subscriptionPlan] ?? PLANS.monthly
}

export function daysUntilExpiry(userProfile) {
  if (!hasPremiumAccess(userProfile) || !userProfile?.subscriptionExpiry) return null
  const expiry = toDateValue(userProfile.subscriptionExpiry)
  if (!expiry) return null
  const diff = Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : 0
}
