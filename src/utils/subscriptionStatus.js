// Subscription-status resolver for the reminder system.
//
// Normalises a user profile into ONE of four plain-language states —
// Free · Trial · Pro · Expired — for BOTH audiences (learner / teacher),
// whose Pro benefits differ. Every reminder surface (dashboard card, top
// banner, once-a-day popup, locked-feature modal, My Subscription page)
// reads its truth from here so the wording and the gating never drift.
//
// Dependency-light on purpose (inlines the super-admin role check, imports
// only the dependency-free teacherPlans mirror) so the repo-root node test
// suite can `import` it directly — same pattern as src/utils/teacherPlans.js.

import { resolveTeacherPlan, normalizeTeacherPlan, PLAN_LABELS } from './teacherPlans.js'

export const SUB_STATUS = {
  FREE:    'free',
  TRIAL:   'trial',
  PRO:     'pro',
  EXPIRED: 'expired',
}

export const AUDIENCE = {
  LEARNER: 'learner',
  TEACHER: 'teacher',
}

// What each audience unlocks on Pro. Phrased as benefits, never as "you must
// pay". Surfaces read these so learner vs teacher copy stays distinct.
export const PRO_BENEFITS = {
  learner: [
    'Full quizzes and timed tests',
    'Every past paper with worked solutions',
    'Results history and progress tracking',
    'All notes and interactive lessons',
    'Weakness analysis and exam mode',
  ],
  teacher: [
    'AI lesson plans and schemes of work',
    'Assessment and exam paper creation',
    'DOCX and PDF downloads',
    'Premium library content',
    'Every teacher studio tool',
  ],
}

// One-line summary of what's locked, used in compact banners / modals.
export const LOCKED_TAGLINE = {
  learner: 'Full quizzes, past papers, results, notes and lessons',
  teacher: 'AI lesson plans, schemes, assessments, downloads and more',
}

function isSuperAdmin(profile) {
  const role = profile?.role
  return role === 'admin' || role === 'superAdmin'
}

function toDateValue(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// Picks the audience a reminder should speak to. Teachers (and super-admins
// acting in the teacher portal) get teacher copy; everyone else gets learner
// copy. Callers on a known surface pass an explicit audience.
export function audienceForProfile(profile) {
  return profile?.role === AUDIENCE.TEACHER ? AUDIENCE.TEACHER : AUDIENCE.LEARNER
}

// ── Learner state ───────────────────────────────────────────────────────────
function resolveLearnerState(profile, now) {
  if (isSuperAdmin(profile)) {
    return { status: SUB_STATUS.PRO, planType: 'admin', expiry: null }
  }

  const expiry = toDateValue(profile?.subscriptionExpiry)
  const expired = !!expiry && expiry <= now

  const hasActiveFlag =
    profile?.premium === true ||
    profile?.isPremium === true ||
    profile?.paymentStatus === 'active' ||
    profile?.subscriptionStatus === 'active' ||
    profile?.plan === 'premium'

  const planType = profile?.subscriptionPlan && profile.subscriptionPlan !== 'free'
    ? profile.subscriptionPlan
    : 'free'

  // Trial: only fires if a trial mechanism actually stamped the profile.
  const trialExpiry = toDateValue(profile?.trialEndsAt ?? profile?.trialExpiry)
  const onTrial =
    profile?.subscriptionStatus === 'trial' ||
    profile?.subscriptionStatus === 'trialing' ||
    profile?.planType === 'trial' ||
    (!!trialExpiry && trialExpiry > now)

  if (onTrial && !expired) {
    return { status: SUB_STATUS.TRIAL, planType: 'trial', expiry: trialExpiry || expiry }
  }
  if (hasActiveFlag && !expired) {
    return { status: SUB_STATUS.PRO, planType, expiry }
  }
  // Lapsed: an expiry in the past, or a paid plan/payment on file with the
  // access flags now cleared.
  const everSubscribed =
    expired ||
    !!profile?.subscriptionPaymentId ||
    (planType !== 'free' && !hasActiveFlag)
  if (everSubscribed) {
    return { status: SUB_STATUS.EXPIRED, planType, expiry }
  }
  return { status: SUB_STATUS.FREE, planType: 'free', expiry: null }
}

// ── Teacher state ───────────────────────────────────────────────────────────
function resolveTeacherState(profile, now) {
  // resolveTeacherPlan already returns 'max' for super-admins and falls back
  // to 'free' for an expired teacherPlanExpiresAt.
  const livePlan = resolveTeacherPlan(profile, now) // 'free' | 'pro' | 'max'
  const teacherExpiry = toDateValue(profile?.teacherPlanExpiresAt)

  const trialExpiry = toDateValue(profile?.teacherTrialEndsAt ?? profile?.trialEndsAt)
  const onTrial =
    profile?.teacherPlan === 'trial' ||
    (!!trialExpiry && trialExpiry > now)

  if (livePlan === 'pro' || livePlan === 'max') {
    return { status: SUB_STATUS.PRO, planType: livePlan, expiry: teacherExpiry }
  }
  if (onTrial) {
    return { status: SUB_STATUS.TRIAL, planType: 'trial', expiry: trialExpiry }
  }
  // Free now — was it ever a paid teacher plan that lapsed?
  const normalized = normalizeTeacherPlan(profile?.teacherPlan) // 'pro'|'max'|null
  const lapsed = (normalized === 'pro' || normalized === 'max') &&
    !!teacherExpiry && teacherExpiry <= now
  if (lapsed) {
    return { status: SUB_STATUS.EXPIRED, planType: normalized, expiry: teacherExpiry }
  }
  return { status: SUB_STATUS.FREE, planType: 'free', expiry: null }
}

function daysBetween(future, now) {
  if (!future) return null
  const diff = Math.ceil((future.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : 0
}

/**
 * Resolve the full subscription-reminder view for a user.
 *
 * @param {object|null} profile  userProfile from AuthContext
 * @param {object} [opts]
 * @param {'learner'|'teacher'} [opts.audience] force an audience (defaults to role)
 * @param {Date} [opts.now] injectable clock for tests
 * @returns full status descriptor consumed by every reminder surface.
 */
export function resolveSubscriptionStatus(profile, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date()
  const audience = opts.audience || audienceForProfile(profile)

  const base = audience === AUDIENCE.TEACHER
    ? resolveTeacherState(profile, now)
    : resolveLearnerState(profile, now)

  const { status, planType, expiry } = base
  const isPro = status === SUB_STATUS.PRO
  const isTrial = status === SUB_STATUS.TRIAL
  const isFree = status === SUB_STATUS.FREE
  const isExpired = status === SUB_STATUS.EXPIRED

  // Pro and Trial both have live access → no upgrade/renew nagging. Free and
  // Expired are the only states that get reminders (req: "Once the user pays
  // and becomes Pro, remove all reminders automatically").
  const shouldRemind = isFree || isExpired

  const planLabel = isPro
    ? (audience === AUDIENCE.TEACHER ? (PLAN_LABELS[planType] || 'Pro') : 'Pro')
    : isTrial ? 'Trial'
    : isExpired ? 'Expired'
    : 'Free'

  return {
    audience,
    status,
    planType,
    planLabel,
    isPro,
    isTrial,
    isFree,
    isExpired,
    shouldRemind,
    expiry,
    daysLeft: daysBetween(expiry, now),
    benefits: PRO_BENEFITS[audience] || PRO_BENEFITS.learner,
    lockedTagline: LOCKED_TAGLINE[audience] || LOCKED_TAGLINE.learner,
  }
}

// Friendly copy for the Free vs Expired reminder surfaces. Never "you must
// pay" — always benefit-led ("Upgrade to continue").
export function reminderCopy(status, audience) {
  const isTeacher = audience === AUDIENCE.TEACHER
  if (status === SUB_STATUS.EXPIRED) {
    return {
      tone: 'expired',
      badge: 'Expired Subscription',
      emoji: '⏳',
      title: 'Your ZedExams Pro has ended',
      body: isTeacher
        ? 'Renew to keep your AI lesson plans, schemes of work, assessments and downloads.'
        : 'Renew to keep full quizzes, past papers, results tracking, notes and lessons.',
      cta: 'Renew Pro',
    }
  }
  return {
    tone: 'free',
    badge: 'Free Plan',
    emoji: '✨',
    title: isTeacher ? 'Unlock the full teacher toolkit' : 'Unlock everything with Pro',
    body: isTeacher
      ? 'This is part of ZedExams Pro — AI lesson plans, schemes, assessments, downloads and premium library content.'
      : 'This is part of ZedExams Pro — full quizzes, past papers, results, progress tracking, notes and lessons.',
    cta: 'Upgrade to Pro',
  }
}

// Which UpgradeModal portal + plan list an audience should open.
export function upgradePortal(audience) {
  if (audience === AUDIENCE.TEACHER) {
    // Offer both tiers so a teacher can choose Pro or step straight up to Max.
    return {
      portal: 'teacher',
      planIds: ['pro_monthly', 'pro_yearly', 'max_monthly', 'max_yearly'],
      defaultPlanId: 'pro_monthly',
    }
  }
  return { portal: 'learner', planIds: ['weekly', 'monthly'], defaultPlanId: 'monthly' }
}
