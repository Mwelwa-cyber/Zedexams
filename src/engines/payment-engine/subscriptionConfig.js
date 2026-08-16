// Single source of truth for all plan limits and pricing.
// To change a limit, edit ONLY this file.

import { isSuperAdmin } from '../../utils/permissions'

export const ROLES = {
  LEARNER:     'learner',
  TEACHER:     'teacher',
  PARENT:      'parent',
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
  weekly: {
    id: 'weekly',
    name: 'Weekly',
    tagline: 'Try it — pay by the week',
    priceZMW: 15,
    durationDays: 7,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '⚡',
    features: ['Unlimited quizzes', 'Exam mode (timed)', 'Weakness analysis'],
    locked: [],
  },
  monthly: {
    id: 'monthly',
    name: 'Monthly',
    tagline: 'Best value — save vs weekly',
    priceZMW: 50,
    durationDays: 30,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '⭐',
    features: ['Unlimited quizzes', 'Exam mode (timed)', 'Weakness analysis', 'Priority support'],
    locked: [],
  },

  // ── Grade 7 ECZ Exam Pack ──────────────────────────────────────────────
  // First learner-facing product priced around the ECZ Grade 7 composite
  // exam. Monthly is the volume play; termly locks in the full exam run-up
  // (Aug–Oct) at a K25 discount.
  grade7_monthly: {
    id: 'grade7_monthly',
    name: 'Grade 7 ECZ Pack · Monthly',
    tagline: 'Full pack · 30 days',
    priceZMW: 75,
    durationDays: 30,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '📘',
    features: [
      'All Grade 7 ECZ subjects',
      'Revision notes per topic',
      'Past papers 2020–2025 with solutions',
      'Auto-marked practice quizzes',
      'Exam strategy guide',
    ],
    locked: [],
  },
  grade7_termly: {
    id: 'grade7_termly',
    name: 'Grade 7 ECZ Pack · Termly',
    tagline: 'Save K25 vs paying monthly',
    priceZMW: 200,
    durationDays: 90,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '🎯',
    features: [
      'Everything in Monthly',
      'Locks in the full 90-day exam run-up',
      'Save K25 vs paying every month',
      'Priority WhatsApp support',
    ],
    locked: [],
  },

  grade12_monthly: {
    id: 'grade12_monthly',
    name: 'Grade 12 ECZ Pack',
    tagline: 'School-leaver exam · 30 days',
    priceZMW: 150,
    durationDays: 30,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '📕',
    features: [
      'All Grade 12 ECZ subjects',
      'Past papers with full solutions',
      'Topic-by-topic revision notes',
      'Exam strategy + mark-scheme tips',
    ],
    locked: [],
  },
  full_platform_termly: {
    id: 'full_platform_termly',
    name: 'Full Platform',
    tagline: 'All grades · One term',
    priceZMW: 200,
    durationDays: 90,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '🌟',
    features: [
      'Every grade, every subject',
      'All past papers + solutions',
      'All practice quizzes',
      'Best for families & tutors',
    ],
    locked: [],
  },
  single_subject_monthly: {
    id: 'single_subject_monthly',
    name: 'Single Subject',
    tagline: 'One subject · 30 days',
    priceZMW: 30,
    durationDays: 30,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '📖',
    features: [
      'Pick one subject',
      'Notes + past papers + quizzes',
      'Perfect for targeting weak areas',
    ],
    locked: [],
  },

  // ── Pro / Max tiers (matches /pricing marketing page) ──────────────────
  // Teacher plans. Kept alongside the learner weekly/monthly plans so
  // existing subscribers keep their access; new subscriptions use these.
  pro_monthly: {
    id: 'pro_monthly',
    tier: 'pro',
    billing: 'monthly',
    name: 'Pro · Monthly',
    tagline: 'For the everyday teacher',
    priceZMW: 59,
    durationDays: 30,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '🦊',
    features: [
      '40 lesson plans / month',
      '25 worksheets & teacher notes',
      '2 schemes of work / month',
      '1 free assessment + exam paper to try',
      'Daily cap of 10 generations',
      'DOCX + PDF export',
      'Library kept forever',
      'Premium model quality',
    ],
    locked: ['Unlimited assessments & exam papers (Max)'],
  },
  pro_yearly: {
    id: 'pro_yearly',
    tier: 'pro',
    billing: 'yearly',
    name: 'Pro · Yearly',
    tagline: 'Two months free vs monthly',
    priceZMW: 590,
    monthlyEquivalentZMW: 50,
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
    tagline: 'For heavy users',
    priceZMW: 149,
    durationDays: 30,
    dailyQuizLimit: Infinity,
    weaknessAnalysis: true,
    examMode: true,
    badge: '🦅',
    features: [
      'Unlimited assessments & exam papers',
      'The Assessment & Exam Paper studios — Max only',
      'Unlimited plans, notes & worksheets*',
      'Daily cap of 30 generations',
      'Bulk export (whole term in one click)',
      'Priority queue + early access to new studios',
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
    priceZMW: 1490,
    monthlyEquivalentZMW: 125,
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
  // Phone that receives Mobile Money payments. Same number doubles as
  // the WhatsApp confirmation line. Keep both fields formatted with the
  // leading "+" so wa.me / tel: links stay portable.
  mobileMoney: {
    number: '+260968310746',
    displayNumber: '0968 310 746',
    providers: 'Airtel Money / MTN MoMo',
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

  // Fail closed: a premium access flag with no parseable expiry grants access
  // ONLY when it's an explicit lifetime/comp grant (subscriptionLifetime ===
  // true, set by grantPremium(uid, plan, 0)). Expiry is enforced solely at
  // read time — no server cron flips premium=false — so without this guard any
  // path that set a flag without a valid expiry would mint a never-expiring
  // account. Super-admins are the only other no-expiry premium path (above).
  const expiry = toDateValue(userProfile?.subscriptionExpiry)
  if (!expiry) return userProfile?.subscriptionLifetime === true
  return expiry > new Date()
}

// Whether the user can enter the learner-side dashboard / quizzes / lessons.
// - Admins: always.
// - Learners: their existing premium subscription IS their learner-portal
//   subscription, so we fall back to hasPremiumAccess().
// - Teachers: NEVER. The teacher and learner portals are fully separate — a
//   teacher account cannot access the learner side (and there is no learner-
//   portal subscription to buy from a teacher account).
export function hasLearnerPortalAccess(userProfile) {
  if (!userProfile) return false
  if (isSuperAdmin(userProfile)) return true
  if (userProfile.role === ROLES.TEACHER) return false
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

// Plain tier name for display: 'free' | 'pro' | 'max'.
// Premium learner plans (weekly/monthly, grade7_*, etc. — which have no
// `tier` field) count as 'max' per product naming.
export function getPlanTier(userProfile) {
  if (!hasPremiumAccess(userProfile)) return 'free'
  const plan = getActivePlan(userProfile)
  return plan?.tier === 'pro' ? 'pro' : 'max'
}

export function daysUntilExpiry(userProfile) {
  if (!hasPremiumAccess(userProfile) || !userProfile?.subscriptionExpiry) return null
  const expiry = toDateValue(userProfile.subscriptionExpiry)
  if (!expiry) return null
  const diff = Math.ceil((expiry - new Date()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : 0
}
