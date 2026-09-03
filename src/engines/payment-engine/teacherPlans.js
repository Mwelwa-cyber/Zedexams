// Client mirror of functions/teacherTools/teacherPlans.js + the plan
// resolution in functions/teacherTools/usageMeter.js (getUserPlanContext).
//
// The server is the authoritative gate for teacher-studio quotas: it reads
// users/{uid}.teacherPlan (normalising the pre-2026-06 legacy ids) and writes
// the resolved plan + per-tool limits into usageMeters/{uid}/periods/{period}
// when a generation happens. That meter doc is therefore only a SNAPSHOT from
// the last generation — a teacher who upgrades mid-month sees a stale "Free"
// plan in the dashboard until they next generate.
//
// To keep the dashboard honest, the client resolves the LIVE teacher plan
// straight from userProfile here (same logic the server uses), so the "Current
// plan" stat and the UsageMeter widget reflect what the teacher actually pays
// for — not the frozen snapshot. Keep PLAN_LIMITS / DAILY_LIMITS / the legacy
// aliases in sync with the server catalogue.
//
// Dependency-free on purpose (the super-admin role check is inlined rather
// than imported from ./permissions) so the repo-root node test suite can
// import it without Vite's extensionless resolution — same pattern the server
// uses in functions/teacherTools/usageMeter.js.

// Per-tool monthly limits. Mirror of functions/teacherTools/teacherPlans.js
// PLAN_LIMITS. A 0 means the tool is not available on that plan (the widget
// renders it as a locked "Not on <plan> · unlock" row).
export const PLAN_LIMITS = {
  // Free runs the weekly teaching loop in limited form (dashboard redesign
  // §12): lesson plans plus a small monthly allowance of worksheets, homework
  // and short tests, and a 2-week Scheme of Work preview. Preview shaping
  // (5-question tests, 2-week schemes) is FREE_PREVIEW_LIMITS below, enforced
  // server-side inside the generators. Studios still at 0 render as read-only
  // samples (StudioGate / LockedStudio).
  free: {
    lesson_plan: 8,
    worksheet: 4,
    flashcards: 0,
    quiz: 0,
    rubric: 0,
    scheme_of_work: 2,
    notes: 0,
    homework: 4,
    lesson_activities: 0,
    assessment: 2,
    sba_task: 0,
    exam_paper: 0,
    diagram: 3,
    slide_notes: 0,
    slide_notes_images: 0,
    suggest_answer: 30,
    revise_question: 30,
    revise_lesson_section: 40,
  },
  pro: {
    lesson_plan: 40,
    worksheet: 25,
    flashcards: 200,
    quiz: 8,
    rubric: 8,
    scheme_of_work: 2,
    notes: 25,
    homework: 30,
    lesson_activities: 30,
    // Test Papers are an allowance-based entitlement, not a Max-only lock:
    // Pro gets 3 COMPLETE papers/month (Free gets 2 five-question previews,
    // Max the heavy allowance). exam_paper stays the Max-anchor with a
    // single Pro taster.
    assessment: 3,
    sba_task: 15,
    exam_paper: 1,
    diagram: 30,
    slide_notes: 5,
    slide_notes_images: 60,
    suggest_answer: 500,
    revise_question: 300,
    revise_lesson_section: 400,
  },
  max: {
    lesson_plan: 200,
    worksheet: 200,
    flashcards: 200,
    quiz: 200,
    rubric: 200,
    scheme_of_work: 200,
    notes: 200,
    homework: 200,
    lesson_activities: 200,
    assessment: 200,
    sba_task: 200,
    exam_paper: 200,
    diagram: 200,
    slide_notes: 100,
    slide_notes_images: 1200,
    suggest_answer: 2000,
    revise_question: 1500,
    revise_lesson_section: 2000,
  },
}

// The free teacher trial (see functions/teacherTrial/) grants the Pro tier for
// TEACHER_TRIAL_DAYS — an alias of the same object, never a duplicated copy,
// mirroring the server's PLAN_LIMITS.trial = PLAN_LIMITS.pro exactly (the
// deep-equal check in scripts/test-teacher-plan-resolution.mjs pins it).
PLAN_LIMITS.trial = PLAN_LIMITS.pro

// Free-preview shaping enforced server-side inside the generators — mirror
// of functions/teacherTools/teacherPlans.js FREE_PREVIEW_LIMITS (guarded by
// scripts/test-teacher-plan-resolution.mjs). The studios read this to
// explain the preview before the teacher generates.
// Bumped whenever plan allowances change — mirror of the server constant so
// client analytics can stamp which catalogue revision a teacher saw.
export const PLAN_CATALOG_VERSION = '2026-07-14-free-preview'

export const FREE_PREVIEW_LIMITS = {
  schemePreviewWeeks: 2,
  maxShortTestQuestions: 5,
  shortTestMarksCap: 10,
};

// Human labels shown on the dashboard chip / "Current plan" stat.
export const PLAN_LABELS = {
  free: 'Free',
  trial: 'Trial',
  pro: 'Pro',
  max: 'Max',
}

// Total generations allowed per UTC day, across the studio tools.
export const DAILY_LIMITS = {
  free: 2,
  pro: 10,
  max: 30,
}
DAILY_LIMITS.trial = DAILY_LIMITS.pro

// Length of the free teacher trial granted on signup. Canonical value lives
// server-side (functions/teacherTools/teacherPlans.js TEACHER_TRIAL_DAYS);
// mirrored here so UI copy ("Your 7-day trial ends in…") never hand-types
// the number. Guarded by scripts/test-teacher-plan-resolution.mjs.
export const TEACHER_TRIAL_DAYS = 7

// Studios that stay Max-anchored: locked below Max to a single Pro taster,
// so the next attempt routes to the "Upgrade to Max" paywall. Only Exam
// Paper remains — Test Papers (assessment) became an allowance-based
// entitlement (Free 2 previews / Pro 3 complete / Max heavy). Mirror of
// functions/teacherTools/teacherPlans.js MAX_ONLY_TOOLS — keep in sync.
export const MAX_ONLY_TOOLS = ['exam_paper']

export function isMaxOnlyTool(tool) {
  return MAX_ONLY_TOOLS.includes(tool)
}

// users.teacherPlan values written before the 2026-06 pro/max rename.
const LEGACY_PLAN_ALIASES = {
  individual: 'pro',
  school: 'max',
}

/**
 * Maps a raw users.teacherPlan value to a canonical plan id ('free' | 'trial'
 * | 'pro' | 'max'), or null when the value is unknown/absent. Callers treat
 * null as 'free'. Mirror of functions/teacherTools/teacherPlans.js
 * normalizeTeacherPlan. 'trial' is returned as-is — resolveTeacherPlan below
 * is where its own expiry (teacherTrialEndsAt) is checked, exactly like
 * 'pro'/'max' check teacherPlanExpiresAt separately.
 */
export function normalizeTeacherPlan(raw) {
  if (typeof raw !== 'string') return null
  if (Object.prototype.hasOwnProperty.call(PLAN_LIMITS, raw)) return raw
  if (Object.prototype.hasOwnProperty.call(LEGACY_PLAN_ALIASES, raw)) {
    return LEGACY_PLAN_ALIASES[raw]
  }
  return null
}

// Mirrors src/utils/permissions.js isSuperAdmin() — inlined to keep this
// module dependency-free (see header). Both the legacy 'admin' role and the
// newer 'superAdmin' role get the top tier.
function isSuperAdmin(userProfile) {
  const role = userProfile?.role
  return role === 'admin' || role === 'superAdmin'
}

function toDateValue(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Resolves the teacher's LIVE studio plan id ('free' | 'trial' | 'pro' |
 * 'max') from their profile — the same entitlement the server's
 * usageMeter.getUserPlanContext gates on. Super admins always resolve to the
 * top tier; an expired teacherPlanExpiresAt (pro/max) or teacherTrialEndsAt
 * (trial) falls back to free.
 *
 * A trial is its OWN branch rather than being folded into the pro/max one:
 * it has its own expiry field (teacherTrialEndsAt, stamped once by the grant
 * trigger — see functions/teacherTrial/) so it can never be confused with a
 * teacherPlanExpiresAt a real payment set, which is what lets the
 * subscription-status resolver tell "trial ended" apart from "Pro lapsed".
 *
 * `now` is injectable so callers with their own clock (e.g. the
 * subscription-status resolver's test harness) get deterministic results
 * instead of racing the real calendar — without it, a fixture expiry that the
 * test treats as "in the future" silently becomes past once the wall clock
 * crosses it (the 2026-07-01 time-bomb that reddened every PR). Defaults to the
 * real clock, so existing single-arg callers are unaffected.
 */
export function resolveTeacherPlan(userProfile, now = new Date()) {
  if (isSuperAdmin(userProfile)) return 'max'
  const plan = normalizeTeacherPlan(userProfile?.teacherPlan)
  if (plan === 'trial') {
    const trialExpiry = toDateValue(userProfile?.teacherTrialEndsAt)
    if (trialExpiry && trialExpiry > now) return 'trial'
    return 'free'
  }
  if (plan === 'pro' || plan === 'max') {
    const exp = toDateValue(userProfile?.teacherPlanExpiresAt)
    if (exp && exp < now) return 'free'
    return plan
  }
  return 'free'
}
