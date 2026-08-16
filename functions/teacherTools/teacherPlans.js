/**
 * functions/teacherTools/teacherPlans.js
 *
 * Canonical teacher-plan catalogue: plan ids, per-tool monthly limits and
 * legacy-id normalisation. Dependency-free (no firebase-admin /
 * firebase-functions imports) so the repo-root `npm run test:all` can unit
 * test it without installing functions/ deps — same pattern as
 * functions/cors.js and functions/aiPromptPolicy.js.
 *
 * Plan ids match the marketing tiers (src/engines/payment-engine/subscriptionConfig.js,
 * src/components/marketing/Plans.jsx):
 *   free → Free
 *   pro  → Pro  (K59/mo, "for the everyday teacher")    — stored as "individual" before 2026-06
 *   max  → Max  (K149/mo, "unlimited" with fair-use cap) — stored as "school" before 2026-06
 *
 * users/{uid}.teacherPlan values written before the rename may still carry
 * the legacy ids; normalizeTeacherPlan() maps those forever — do not remove
 * the aliases without migrating every users doc. The client widget
 * (src/hooks/useTeacherUsage.js PLAN_VIEW) accepts both legacy and canonical
 * ids in usageMeters docs, so the server can write canonical ids without a
 * meter-doc data migration.
 *
 * Keep limits in sync with TEACHER_TOOLS_ARCHITECTURE.md §10 and the
 * marketing copy in src/components/marketing/Plans.jsx.
 */

const PLAN_LIMITS = {
  // Free runs the weekly teaching loop in limited form (dashboard redesign
  // §12): lesson plans plus a small monthly allowance of worksheets, homework
  // and short tests, and a 2-week Scheme of Work preview — enough to
  // experience each studio's value before the paywall. The metering is
  // monthly (this catalogue) + the DAILY_LIMITS cap, so the spec's per-week
  // suggestions are expressed as ~4-weeks-worth per month. Preview shaping
  // (5-question tests, 2-week schemes) lives in FREE_PREVIEW_LIMITS below
  // and is enforced inside the generators. Studios not listed above stay
  // closed (0) and render as read-only samples (StudioGate); this catalogue
  // remains the authoritative server gate for direct calls.
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
    // Exercise + homework generated together from the Lesson Plan Studio.
    lesson_activities: 30,
    // Test Papers are an allowance-based entitlement, not a Max-only lock:
    // Free gets 2 five-question previews (FREE_PREVIEW_LIMITS), Pro gets 3
    // COMPLETE papers/month, Max keeps the heavy allowance below. exam_paper
    // stays the classic Max-anchor (single Pro taster → Max paywall).
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
};

// Human labels for quota error messages ("…on the Pro plan this month").
const PLAN_LABELS = {
  free: "Free",
  pro: "Pro",
  max: "Max",
};

// Total generations allowed per UTC day, across the studio tools below.
// These are the numbers sold on /pricing ("Daily cap of 2/10/30
// generations" — src/components/marketing/Plans.jsx) and shown by the
// dashboard UsageMeter widget ("Today: N of M").
const DAILY_LIMITS = {
  free: 2,
  pro: 10,
  max: 30,
};

// Tools that count as a "generation" for the daily cap. Micro actions
// (per-question answer suggestions / revisions) and sub-counters
// (slide_notes_images increments once per generated image) are excluded —
// their monthly allowances (e.g. pro suggest_answer: 500/month ≈ 16/day)
// could not coexist with a 10/day total cap.
const DAILY_COUNTED_TOOLS = [
  "lesson_plan",
  "worksheet",
  "flashcards",
  "quiz",
  "rubric",
  "scheme_of_work",
  "notes",
  "homework",
  "lesson_activities",
  "assessment",
  "sba_task",
  "exam_paper",
  "diagram",
  "slide_notes",
];

function isDailyCountedTool(tool) {
  return DAILY_COUNTED_TOOLS.includes(tool);
}

// Studios that stay Max-anchored: locked below Max to a single Pro taster,
// so the next attempt routes to the Max paywall rather than the generic
// monthly-limit copy. Only Exam Paper remains here — Test Papers
// (assessment) became an allowance-based entitlement (Free 2 previews /
// Pro 3 complete papers / Max heavy) once Pro started getting full papers,
// so it is deliberately NOT max-only. Keep this list in sync with the
// client mirror in src/engines/payment-engine/teacherPlans.js.
const MAX_ONLY_TOOLS = ["exam_paper"];

function isMaxOnlyTool(tool) {
  return MAX_ONLY_TOOLS.includes(tool);
}

// users.teacherPlan values written before the 2026-06 pro/max rename.
const LEGACY_PLAN_ALIASES = {
  individual: "pro",
  school: "max",
};

/**
 * Maps a raw users.teacherPlan value to a canonical plan id ("free" | "pro"
 * | "max"), or null when the value is unknown/absent. Callers treat null as
 * "free".
 */
function normalizeTeacherPlan(raw) {
  if (typeof raw !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(PLAN_LIMITS, raw)) return raw;
  if (Object.prototype.hasOwnProperty.call(LEGACY_PLAN_ALIASES, raw)) {
    return LEGACY_PLAN_ALIASES[raw];
  }
  return null;
}

// Free-preview shaping enforced inside the generators (not the meter): a
// free short test is truncated to maxShortTestQuestions with its marks
// budget clamped, and a free Scheme of Work covers only the first
// schemePreviewWeeks weeks of the term. Mirrored in src/engines/payment-engine/teacherPlans.js
// (guarded by scripts/test-teacher-plan-resolution.mjs) so the studios can
// explain the preview before the teacher generates.
// Bumped whenever plan allowances change, so a rollout can be traced from
// analytics/support reports back to the exact catalogue revision.
const PLAN_CATALOG_VERSION = "2026-07-14-free-preview";

const FREE_PREVIEW_LIMITS = {
  schemePreviewWeeks: 2,
  maxShortTestQuestions: 5,
  shortTestMarksCap: 10,
};

module.exports = {
  PLAN_LIMITS,
  FREE_PREVIEW_LIMITS,
  PLAN_CATALOG_VERSION,
  PLAN_LABELS,
  DAILY_LIMITS,
  DAILY_COUNTED_TOOLS,
  MAX_ONLY_TOOLS,
  LEGACY_PLAN_ALIASES,
  normalizeTeacherPlan,
  isDailyCountedTool,
  isMaxOnlyTool,
};
