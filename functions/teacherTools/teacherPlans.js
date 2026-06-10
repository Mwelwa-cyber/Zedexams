/**
 * functions/teacherTools/teacherPlans.js
 *
 * Canonical teacher-plan catalogue: plan ids, per-tool monthly limits and
 * legacy-id normalisation. Dependency-free (no firebase-admin /
 * firebase-functions imports) so the repo-root `npm run test:all` can unit
 * test it without installing functions/ deps — same pattern as
 * functions/cors.js and functions/aiPromptPolicy.js.
 *
 * Plan ids match the marketing tiers (src/utils/subscriptionConfig.js,
 * src/components/marketing/Plans.jsx):
 *   free → Free
 *   pro  → Pro  (K79/mo, "for the everyday teacher")    — stored as "individual" before 2026-06
 *   max  → Max  (K199/mo, "unlimited" with fair-use cap) — stored as "school" before 2026-06
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
  free: {
    lesson_plan: 5,
    worksheet: 3,
    flashcards: 20,
    quiz: 0,
    rubric: 0,
    scheme_of_work: 0,
    notes: 3,
    full_lesson: 2,
    homework: 3,
    assessment: 1,
    exam_paper: 1,
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
    assessment: 15,
    exam_paper: 10,
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
    exam_paper: 200,
    diagram: 200,
    slide_notes: 100,
    slide_notes_images: 1200,
    suggest_answer: 2000,
    revise_question: 1500,
  },
};

// Human labels for quota error messages ("…on the Pro plan this month").
const PLAN_LABELS = {
  free: "Free",
  pro: "Pro",
  max: "Max",
};

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

module.exports = {
  PLAN_LIMITS,
  PLAN_LABELS,
  LEGACY_PLAN_ALIASES,
  normalizeTeacherPlan,
};
