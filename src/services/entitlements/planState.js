/**
 * planState — the pure half of the entitlements service.
 *
 * Takes a user profile and a usage reading, returns the one object every gate
 * in the app reasons about. No React, no Firebase, no clock of its own — the
 * `now` is injected, which is what lets the grace window, the quota reset and
 * the expiry fade all be tested as arithmetic rather than as timing.
 *
 * ── Grace is derived, never stored ─────────────────────────────────────
 *
 * `status: 'grace'` is `expired && now < expiresAt + 3 days`. Nothing writes a
 * grace flag, and nothing may: a stored flag needs a cron to clear it, and a
 * cron that misses a night leaves a lapsed account unlocked indefinitely.
 * Derived from the expiry, the window closes itself.
 *
 * During grace EVERYTHING stays unlocked. That is the point of the fade — the
 * user is still inside the value while being asked to renew, which converts
 * better than a wall and, more importantly, does not punish somebody whose
 * mobile money failed on a Tuesday.
 *
 * ── ageBand fails closed, and the failure is a refusal to show a price ──
 *
 * A learner is `under18` unless the profile says otherwise. `isMinor === false`
 * is the only thing that makes a learner an adult, because that field is set
 * once at signup from a declared date of birth (see guardianConsentCore) and
 * its absence means we do not know. Not knowing must resolve to the guardian
 * route: showing K50 to a twelve-year-old is a Play Families violation, while
 * routing an adult through a guardian ask is an inconvenience. Those are not
 * symmetric mistakes, so the default is the survivable one.
 *
 * Teachers, parents and admins are `adult` — they are the account holder by
 * definition, and there is no guardian to route to.
 */

import { FREE_PAPERS_PER_WEEK } from './gates.js'

export const PLAN_STATUS = Object.freeze({
  ACTIVE: 'active',
  GRACE: 'grace',
  EXPIRED: 'expired',
})

export const AGE_BAND = Object.freeze({
  UNDER_18: 'under18',
  ADULT: 'adult',
})

/** Days of full access after a subscription expires. */
export const GRACE_DAYS = 3

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Checkout plan id → ladder rung id. The ladder is what a surface names when
 * it talks about "your plan"; the checkout ids are what the payment system
 * charged. Anything unmapped but paid resolves to `month`, the middle rung —
 * an unrecognised paid plan is still a paid plan, and reporting it as `free`
 * would lock a paying account.
 */
const CHECKOUT_TO_RUNG = Object.freeze({
  day_pass: 'day',
  weekly: 'week',
  monthly: 'month',
  term_pass: 'term',
  exam_pass: 'exam',
  grade7_monthly: 'month',
  grade7_termly: 'term',
  grade12_monthly: 'month',
  full_platform_termly: 'term',
  single_subject_monthly: 'month',
  pro_monthly: 'month',
  pro_yearly: 'term',
  max_monthly: 'month',
  max_yearly: 'term',
})

const NON_LEARNER_ROLES = Object.freeze(['teacher', 'parent', 'admin', 'superAdmin'])

export function toDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') {
    const d = value.toDate()
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * `under18` unless we positively know otherwise. See the docblock — the
 * asymmetry is deliberate.
 */
export function resolveAgeBand(profile) {
  const role = profile?.role
  if (NON_LEARNER_ROLES.includes(role)) return AGE_BAND.ADULT
  return profile?.isMinor === false ? AGE_BAND.ADULT : AGE_BAND.UNDER_18
}

/**
 * May this session be shown a price, or a route to a checkout?
 *
 * The rule on /child-safety, and Play's Families policy, is that an
 * under-18 learner never sees one. `resolveAgeBand` already answers "is
 * this an adult", and it fails closed — but it cannot be used on its own
 * here, because a profile that is ABSENT is not a child: it is a
 * signed-out visitor reading the public marketing site, and failing
 * closed on them would take the price list off /pricing for everybody who
 * has not signed in. Those are different unknowns and they take different
 * defaults, which is why this is a function and not an inline comparison.
 *
 * So: no profile → yes (a public page for an anonymous reader). A profile
 * → only when it positively says adult.
 *
 * What a `false` means in practice is NOT "hide the offer". It means
 * route it to the guardian: the child still asks, the parent still pays.
 * See useUnlockFlow — a twelve-year-old with no mobile money account
 * cannot accept an offer of K50 whether or not we show it to them.
 */
export function mayShowPrice(profile) {
  if (!profile) return true
  return resolveAgeBand(profile) === AGE_BAND.ADULT
}

function hasPaidFlag(profile) {
  return (
    profile?.premium === true ||
    profile?.isPremium === true ||
    profile?.paymentStatus === 'active' ||
    profile?.subscriptionStatus === 'active' ||
    profile?.plan === 'premium' ||
    profile?.teacherPlan === 'pro' ||
    profile?.teacherPlan === 'max'
  )
}

function everSubscribed(profile) {
  return (
    !!profile?.subscriptionPaymentId ||
    !!toDate(profile?.subscriptionExpiry) ||
    !!toDate(profile?.teacherPlanExpiresAt) ||
    (!!profile?.subscriptionPlan && profile.subscriptionPlan !== 'free')
  )
}

/**
 * Monday 00:00 local, strictly after `now`. Local rather than UTC because the
 * learner reads "unlocks on Monday" and checks it against their own calendar;
 * a Zambian learner told "Monday" and given a UTC boundary would find the
 * papers still locked at 01:00 on Monday morning.
 */
export function nextWeeklyReset(now = new Date()) {
  const at = toDate(now) || new Date()
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate())
  const dow = start.getDay() // 0 Sun … 1 Mon
  const daysUntilMonday = ((1 - dow + 7) % 7) || 7
  return new Date(start.getTime() + daysUntilMonday * MS_PER_DAY)
}

/** First of next month, 00:00 local — when a monthly generation quota resets. */
export function nextMonthlyReset(now = new Date()) {
  const at = toDate(now) || new Date()
  return new Date(at.getFullYear(), at.getMonth() + 1, 1)
}

/**
 * Resolve the plan state.
 *
 * @param {object|null} profile           userProfile from AuthContext
 * @param {object} [opts]
 * @param {Date}   [opts.now]
 * @param {object} [opts.used]            observed usage, e.g. { papersThisWeek: 3 }
 * @param {object} [opts.quotas]          quota overrides (teacher caps are plan-derived)
 * @returns {object} plan state — see the module docblock and the spec's shape.
 */
export function resolvePlanState(profile, opts = {}) {
  const now = toDate(opts.now) || new Date()
  const role = profile?.role === 'teacher' ? 'teacher'
    : (profile?.role === 'admin' || profile?.role === 'superAdmin') ? 'admin'
    : 'learner'
  const isStaff = role === 'admin'

  const expiresAt = toDate(profile?.subscriptionExpiry) || toDate(profile?.teacherPlanExpiresAt)
  const paid = hasPaidFlag(profile)
  const lifetime = profile?.subscriptionLifetime === true

  // Staff and lifetime grants are permanently active with no expiry to fade
  // from. Everyone else: paid + unexpired is active; paid-but-lapsed enters
  // the derived grace window; a never-subscribed account is on the free plan
  // and its free plan is *active* — "expired" describes a lapse, and calling a
  // brand-new learner expired would put a grace ribbon on their first session.
  let status
  let plan
  if (isStaff || lifetime) {
    status = PLAN_STATUS.ACTIVE
    plan = 'term'
  } else if (paid && (!expiresAt || expiresAt > now)) {
    status = PLAN_STATUS.ACTIVE
    plan = CHECKOUT_TO_RUNG[profile?.subscriptionPlan] || 'month'
  } else if (everSubscribed(profile)) {
    const graceEnds = expiresAt ? new Date(expiresAt.getTime() + GRACE_DAYS * MS_PER_DAY) : null
    status = graceEnds && now < graceEnds ? PLAN_STATUS.GRACE : PLAN_STATUS.EXPIRED
    plan = status === PLAN_STATUS.GRACE
      ? (CHECKOUT_TO_RUNG[profile?.subscriptionPlan] || 'month')
      : 'free'
  } else {
    status = PLAN_STATUS.ACTIVE
    plan = 'free'
  }

  const graceEndsAt = !isStaff && !lifetime && expiresAt && !paid
    ? new Date(expiresAt.getTime() + GRACE_DAYS * MS_PER_DAY)
    : null

  // Unlocked === "no gate applies". Grace is unlocked by design; so is any
  // active paid plan and any staff account.
  const unlocked = isStaff || lifetime || status === PLAN_STATUS.GRACE ||
    (status === PLAN_STATUS.ACTIVE && plan !== 'free')

  const used = {
    papersThisWeek: Math.max(0, Number(opts.used?.papersThisWeek || 0)),
    aiGenerationsThisMonth: Math.max(0, Number(opts.used?.aiGenerationsThisMonth || 0)),
  }

  // Every quota states its reset date. A lock with no stated reset reads as
  // extortion; "unlocks Monday" reads as a rule — so `resetsAt` is not
  // optional and a surface that cannot find one is a bug, not a bare lock.
  const quotas = {
    papersThisWeek: Number.isFinite(opts.quotas?.papersThisWeek)
      ? opts.quotas.papersThisWeek
      : FREE_PAPERS_PER_WEEK,
    aiGenerationsThisMonth: Number.isFinite(opts.quotas?.aiGenerationsThisMonth)
      ? opts.quotas.aiGenerationsThisMonth
      : 0,
  }

  return {
    plan,
    status,
    expiresAt,
    graceEndsAt,
    role,
    ageBand: resolveAgeBand(profile),
    unlocked,
    quotas,
    used,
    resetsAt: {
      papersThisWeek: nextWeeklyReset(now),
      aiGenerationsThisMonth: nextMonthlyReset(now),
    },
  }
}

/**
 * How many of a quota remain. `Infinity` for an unlocked account so callers
 * can compare without special-casing, and never negative — a learner who
 * somehow used four of three papers is at zero, not at minus one.
 */
export function quotaLeft(planState, quotaKey) {
  if (!planState || !quotaKey) return 0
  if (planState.unlocked) return Infinity
  const cap = Number(planState.quotas?.[quotaKey])
  if (!Number.isFinite(cap)) return Infinity
  const spent = Number(planState.used?.[quotaKey] || 0)
  return Math.max(0, cap - spent)
}

/**
 * Whether a gate is locked for this plan state.
 *
 * A quota gate is locked when the quota is spent. A plan-only gate is locked
 * whenever the account is not unlocked. Grace short-circuits both, which is
 * the single line that makes "everything stays unlocked during grace" true
 * everywhere rather than at each call site.
 */
export function isGateLocked(planState, gateId, gateRegistry) {
  if (!planState || !gateId) return false
  if (planState.unlocked) return false
  const gate = gateRegistry?.[gateId]
  if (!gate) return false
  if (gate.quota) return quotaLeft(planState, gate.quota) <= 0
  return true
}

/** Chip text: `Free · 2 left` / `0 left` / `Grace` / `Premium`. */
export function planChipLabel(planState) {
  if (!planState) return ''
  if (planState.status === PLAN_STATUS.GRACE) return 'Grace'
  if (planState.unlocked) return 'Premium'
  const key = planState.role === 'teacher' ? 'aiGenerationsThisMonth' : 'papersThisWeek'
  const left = quotaLeft(planState, key)
  if (!Number.isFinite(left)) return 'Free'
  return left > 0 ? `Free · ${left} left` : '0 left'
}

/** Chip tone, so the header does not re-derive "is this the amber one". */
export function planChipTone(planState) {
  if (!planState) return 'neutral'
  if (planState.status === PLAN_STATUS.GRACE) return 'warn'
  if (planState.unlocked) return 'premium'
  const key = planState.role === 'teacher' ? 'aiGenerationsThisMonth' : 'papersThisWeek'
  return quotaLeft(planState, key) > 0 ? 'free' : 'warn'
}

/**
 * "Monday" / "1 September" — the reset date in the words a lock card uses.
 * Returns '' when there is no date, and every caller of this treats '' as a
 * failure to render the lock rather than as a lock without a reset.
 */
export function formatResetDate(date, now = new Date()) {
  const at = toDate(date)
  if (!at) return ''
  const from = toDate(now) || new Date()
  const days = Math.ceil((at.getTime() - from.getTime()) / MS_PER_DAY)
  if (days <= 7 && days > 0) {
    return at.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}
