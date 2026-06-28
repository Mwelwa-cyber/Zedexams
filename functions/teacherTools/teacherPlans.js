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
  // Free can only use the Lesson Plan studio — every other generator studio is
  // closed (0) and shown as a read-only sample until the teacher upgrades (the
  // client gates the route in StudioGate; this is the authoritative server gate
  // for direct calls). Keep lesson_plan + the quiz-editor micro-helpers
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
    lesson_activities: 0,
    assessment: 0,
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
    full_lesson: 20,
    homework: 30,
    // Exercise + homework generated together from the Lesson Plan Studio.
    lesson_activities: 30,
    // assessment + exam_paper are Max-only studios (see MAX_ONLY_TOOLS): the
    // most expensive generations on the platform. Pro (and Free) get a single
    // taster per month so teachers can feel the quality before upgrading to
    // Max for unlimited use — the 2nd generation hits the Max paywall.
    assessment: 1,
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
    full_lesson: 200,
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
  "full_lesson",
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

// Studios reserved for the Max plan. These are the two most compute-heavy
// generations (Assessment ~250s/60+ items, Exam Paper ~185s), so they anchor
// the Max tier rather than being sold purely on volume. Free and Pro keep a
// single monthly taster (PLAN_LIMITS.{free,pro}.{assessment,exam_paper} = 1)
// so a teacher can try the studio once; the next attempt routes to the Max
// paywall instead of the generic monthly-limit copy. Keep this list in sync
// with the client mirror in src/utils/teacherPlans.js.
const MAX_ONLY_TOOLS = ["assessment", "exam_paper"];

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

module.exports = {
  PLAN_LIMITS,
  PLAN_LABELS,
  DAILY_LIMITS,
  DAILY_COUNTED_TOOLS,
  MAX_ONLY_TOOLS,
  LEGACY_PLAN_ALIASES,
  normalizeTeacherPlan,
  isDailyCountedTool,
  isMaxOnlyTool,
};
