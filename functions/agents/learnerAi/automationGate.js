/**
 * Automation gate for the learner-AI pipeline.
 *
 * Single entry point for the dispatcher + runners to read the
 * admin-managed automation policy at `aiAutomationSettings/global`
 * and the per-day usage rollup at `aiUsageDaily/{YYYY-MM-DD}`.
 *
 * Exposes four helpers:
 *   loadAutomationSettings()
 *     → permissive defaults when doc missing
 *   assertAutomationAllowed({task})
 *     → throws on enabled:false, grade/subject not whitelisted
 *   assertDailyQuotas({estimatedQuestionCount, contentType})
 *     → throws when projected count would breach the cap
 *   recordGenerationUsage({contentType, questionCount})
 *     → fire-and-forget increment, never throws
 *
 * Plus a small utility `countQuestionsInContent(contentType, content)`
 * the stub-factory calls before `recordGenerationUsage` so the
 * per-content-type question count is computed in one place.
 *
 * The settings doc is cached in-process for 60s so the dispatcher
 * doesn't re-fetch it on every task. Misses (doc absent / network
 * error) fall back to permissive defaults — fail open so the
 * pipeline keeps working when an admin hasn't seeded the doc yet.
 */

const admin = require("firebase-admin");

const SETTINGS_DOC = "aiAutomationSettings/global";
const USAGE_COLLECTION = "aiUsageDaily";
const SETTINGS_TTL_MS = 60_000;

// Permissive defaults — the moment a fresh deployment runs without
// any admin-seeded settings doc, every existing queued flow keeps
// working. The admin opts INTO restrictions by creating the doc.
const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  maxQuestionsPerDay: 100,
  maxQuizzesPerDay: 20,
  autoPublishPracticeQuizzes: false,
  autoPublishNotes: false,
  requireAdminApprovalForExamQuizzes: true,
  requireAdminApprovalForCurriculumUpdates: true,
  curriculumUpdateCheckFrequency: "weekly",
  enabledGrades: [],
  enabledSubjects: [],
});

// In-process cache. Lifespan = a single Cloud Function instance,
// which is fine — settings changes propagate within 60s of the
// next dispatcher trigger.
const cache = {expiresAt: 0, settings: null};

function clearCache() {
  cache.expiresAt = 0;
  cache.settings = null;
}

async function loadAutomationSettings({force = false} = {}) {
  if (!force && cache.settings && Date.now() < cache.expiresAt) {
    return cache.settings;
  }
  let loaded = DEFAULT_SETTINGS;
  try {
    const snap = await admin.firestore().doc(SETTINGS_DOC).get();
    if (snap.exists) {
      const raw = snap.data() || {};
      // Hard-rule defence-in-depth: refuse to honour a doc where the
      // admin-approval pins have been tampered with. If either is not
      // literal true, fall back to defaults (which themselves pin
      // both to true).
      const hardRulesIntact =
        raw.requireAdminApprovalForExamQuizzes === true &&
        raw.requireAdminApprovalForCurriculumUpdates === true;
      if (hardRulesIntact) {
        loaded = {
          enabled: raw.enabled !== false,
          maxQuestionsPerDay: Number.isInteger(raw.maxQuestionsPerDay) ?
            Math.max(0, Math.min(10_000, raw.maxQuestionsPerDay)) :
            DEFAULT_SETTINGS.maxQuestionsPerDay,
          maxQuizzesPerDay: Number.isInteger(raw.maxQuizzesPerDay) ?
            Math.max(0, Math.min(1_000, raw.maxQuizzesPerDay)) :
            DEFAULT_SETTINGS.maxQuizzesPerDay,
          autoPublishPracticeQuizzes: !!raw.autoPublishPracticeQuizzes,
          autoPublishNotes: !!raw.autoPublishNotes,
          requireAdminApprovalForExamQuizzes: true,
          requireAdminApprovalForCurriculumUpdates: true,
          curriculumUpdateCheckFrequency:
            raw.curriculumUpdateCheckFrequency === "monthly" ? "monthly" : "weekly",
          enabledGrades: Array.isArray(raw.enabledGrades) ?
            raw.enabledGrades.filter((g) => typeof g === "string") : [],
          enabledSubjects: Array.isArray(raw.enabledSubjects) ?
            raw.enabledSubjects.filter((s) => typeof s === "string") : [],
        };
      }
    }
  } catch (err) {
    console.warn("[automationGate] settings load failed", err && err.message);
  }
  cache.settings = loaded;
  cache.expiresAt = Date.now() + SETTINGS_TTL_MS;
  return loaded;
}

/**
 * Throws a labelled error when the task is not allowed by current
 * automation policy. Error codes:
 *   - automation_disabled
 *   - grade_not_enabled
 *   - subject_not_enabled
 *
 * Returns the loaded settings on success so callers can chain.
 */
async function assertAutomationAllowed({task}) {
  const settings = await loadAutomationSettings();
  if (settings.enabled === false) {
    const err = new Error("AI automation is paused by admin");
    err.code = "automation_disabled";
    throw err;
  }
  // Empty whitelist = allow all (backwards-compatible default).
  if (settings.enabledGrades.length > 0) {
    const grade = task && task.grade != null ? String(task.grade) : "";
    if (!settings.enabledGrades.map(String).includes(grade)) {
      const err = new Error(`Grade ${grade || "(missing)"} is not enabled for automation`);
      err.code = "grade_not_enabled";
      throw err;
    }
  }
  if (settings.enabledSubjects.length > 0) {
    const subject = task && typeof task.subject === "string" ? task.subject : "";
    if (!settings.enabledSubjects.includes(subject)) {
      const err = new Error(`Subject "${subject || "(missing)"}" is not enabled for automation`);
      err.code = "subject_not_enabled";
      throw err;
    }
  }
  return settings;
}

/**
 * Throws when the day's projected question/quiz count would exceed
 * the configured caps. Error codes:
 *   - daily_question_quota_exceeded
 *   - daily_quiz_quota_exceeded
 *
 * Uses a single doc lookup at aiUsageDaily/{today}. Doc missing =
 * counts treated as zero.
 */
async function assertDailyQuotas({estimatedQuestionCount = 0, contentType = ""} = {}) {
  const settings = await loadAutomationSettings();
  const today = utcDateKey();
  let questions = 0;
  let quizzes = 0;
  try {
    const snap = await admin.firestore().collection(USAGE_COLLECTION).doc(today).get();
    if (snap.exists) {
      const data = snap.data() || {};
      questions = Number.isInteger(data.questionsGenerated) ? data.questionsGenerated : 0;
      quizzes = Number.isInteger(data.quizzesGenerated) ? data.quizzesGenerated : 0;
    }
  } catch (err) {
    console.warn("[automationGate] usage load failed", err && err.message);
  }

  const isQuiz = contentType === "practice_quiz" || contentType === "exam_quiz";
  const projectedQuestions = questions + Math.max(0, estimatedQuestionCount || 0);
  if (projectedQuestions > settings.maxQuestionsPerDay) {
    const err = new Error(
        `Projected ${projectedQuestions} questions would exceed daily cap of ` +
        `${settings.maxQuestionsPerDay} (already ${questions} today)`,
    );
    err.code = "daily_question_quota_exceeded";
    throw err;
  }
  if (isQuiz && (quizzes + 1) > settings.maxQuizzesPerDay) {
    const err = new Error(
        `Quiz cap of ${settings.maxQuizzesPerDay} reached for today (already ${quizzes})`,
    );
    err.code = "daily_quiz_quota_exceeded";
    throw err;
  }
  return {questionsToday: questions, quizzesToday: quizzes, settings};
}

/**
 * Fire-and-forget counter increment. NEVER throws. Called from
 * _stubFactory after a successful artifact write. Failures here are
 * logged but never propagate — a usage-metering write must never
 * undo a successful generation.
 */
async function recordGenerationUsage({contentType = "", questionCount = 0} = {}) {
  try {
    const today = utcDateKey();
    const isQuiz = contentType === "practice_quiz" || contentType === "exam_quiz";
    const ref = admin.firestore().collection(USAGE_COLLECTION).doc(today);
    await ref.set({
      date: today,
      questionsGenerated: admin.firestore.FieldValue.increment(
          Math.max(0, Number.isFinite(questionCount) ? questionCount : 0)),
      quizzesGenerated: admin.firestore.FieldValue.increment(isQuiz ? 1 : 0),
      artifactsGenerated: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  } catch (err) {
    console.warn("[automationGate] recordGenerationUsage failed", err && err.message);
  }
}

/**
 * Per-content-type question counter. Pure, no Firestore. Returns the
 * number of questions in a freshly-generated artifact so the caller
 * can pass it into recordGenerationUsage. Returns 0 for non-quiz
 * content types (notes / study_tips / learner_feedback) — those
 * count as 1 artifact but 0 questions.
 */
function countQuestionsInContent(contentType, content) {
  if (!content || typeof content !== "object") return 0;
  if (contentType === "practice_quiz") {
    return Array.isArray(content.questions) ? content.questions.length : 0;
  }
  if (contentType === "exam_quiz") {
    if (!Array.isArray(content.sections)) return 0;
    return content.sections.reduce((sum, sec) =>
      sum + (Array.isArray(sec && sec.questions) ? sec.questions.length : 0), 0);
  }
  return 0;
}

/**
 * Pure helper. Best-effort estimate from task.parameters for
 * quota pre-checks (the dispatcher calls this before the chain
 * runs — actual question count is metered post-write).
 */
function estimateQuestionCount(task) {
  if (!task || !task.taskType) return 0;
  const p = (task && task.parameters) || {};
  if (task.taskType === "practice_quiz") {
    return Number.isInteger(p.numQuestions) ? p.numQuestions : 10;
  }
  if (task.taskType === "exam_quiz") {
    const a = Number.isInteger(p.sectionASize) ? p.sectionASize : 20;
    const b = Number.isInteger(p.sectionBSize) ? p.sectionBSize : 8;
    const c = Number.isInteger(p.sectionCSize) ? p.sectionCSize : 3;
    return a + b + c;
  }
  return 0;
}

function utcDateKey() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = {
  loadAutomationSettings,
  assertAutomationAllowed,
  assertDailyQuotas,
  recordGenerationUsage,
  countQuestionsInContent,
  estimateQuestionCount,
  // Test seam — lets unit tests reset the in-process cache so
  // assertions don't bleed across cases.
  clearCache,
  DEFAULT_SETTINGS,
  SETTINGS_DOC,
  USAGE_COLLECTION,
  utcDateKey,
};
