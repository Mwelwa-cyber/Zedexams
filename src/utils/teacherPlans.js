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
  // Free can only use the Lesson Plan studio — every other generator studio is
  // closed (0) and shown as a read-only sample until the teacher upgrades (see
  // StudioGate / LockedStudio). Keep lesson_plan + the quiz-editor micro-helpers
  // (suggest_answer / revise_question) and the in-studio diagram tool funded.
  free: {
    lesson_plan: 2,
    worksheet: 0,
    flashcards: 0,
    quiz: 0,
    rubric: 0,
    scheme_of_work: 0,
    notes: 0,
    full_lesson: 0,
    homework: 0,
    assessment: 0,
    sba_task: 0,
    exam_paper: 0,
    diagram: 3,
    slide_notes: 0,
    slide_notes_images: 0,
    suggest_answer: 30,
    revise_question: 30,
  },
  pro: {
    lesson_plan: 40,
    worksheet: 25,
    flashcards: 200,
    quiz: 8,
    rubric: 8,
    scheme_of_work: 2,
    notes: 25,
    full_lesson: 20,
    homework: 30,
    // assessment + exam_paper are Max-only studios (see MAX_ONLY_TOOLS): Pro
    // and Free get a single monthly taster, then the Max paywall.
    assessment: 1,
    sba_task: 15,
    exam_paper: 1,
    diagram: 30,
    slide_notes: 5,
    slide_notes_images: 60,
    suggest_answer: 500,
    revise_question: 300,
  },
  max: {
    lesson_plan: 200,
    worksheet: 200,
    flashcards: 200,
    quiz: 200,
    rubric: 200,
    scheme_of_work: 200,
    notes: 200,
    full_lesson: 200,
    homework: 200,
    assessment: 200,
    sba_task: 200,
    exam_paper: 200,
    diagram: 200,
    slide_notes: 100,
    slide_notes_images: 1200,
    suggest_answer: 2000,
    revise_question: 1500,
  },
}

// Human labels shown on the dashboard chip / "Current plan" stat.
export const PLAN_LABELS = {
  free: 'Free',
  pro: 'Pro',
  max: 'Max',
}

// Total generations allowed per UTC day, across the studio tools.
export const DAILY_LIMITS = {
  free: 2,
  pro: 10,
  max: 30,
}

// Studios reserved for the Max plan — the two most compute-heavy generations.
// Free and Pro get a single monthly taster (PLAN_LIMITS.{free,pro}.{...} = 1);
// the next attempt routes to the "Upgrade to Max" paywall. Mirror of
// functions/teacherTools/teacherPlans.js MAX_ONLY_TOOLS — keep in sync.
export const MAX_ONLY_TOOLS = ['assessment', 'exam_paper']

export function isMaxOnlyTool(tool) {
  return MAX_ONLY_TOOLS.includes(tool)
}

// users.teacherPlan values written before the 2026-06 pro/max rename.
const LEGACY_PLAN_ALIASES = {
  individual: 'pro',
  school: 'max',
}

/**
 * Maps a raw users.teacherPlan value to a canonical plan id ('free' | 'pro' |
 * 'max'), or null when the value is unknown/absent. Callers treat null as
 * 'free'. Mirror of functions/teacherTools/teacherPlans.js normalizeTeacherPlan.
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
 * Resolves the teacher's LIVE studio plan id ('free' | 'pro' | 'max') from
 * their profile — the same entitlement the server's usageMeter.getUserPlanContext
 * gates on. Super admins always resolve to the top tier; an expired
 * teacherPlanExpiresAt falls back to free.
 */
export function resolveTeacherPlan(userProfile) {
  if (isSuperAdmin(userProfile)) return 'max'
  const plan = normalizeTeacherPlan(userProfile?.teacherPlan)
  if (plan === 'pro' || plan === 'max') {
    const exp = toDateValue(userProfile?.teacherPlanExpiresAt)
    if (exp && exp < new Date()) return 'free'
    return plan
  }
  return 'free'
}
