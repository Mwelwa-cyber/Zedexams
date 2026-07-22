/**
 * functions/dailyExamPickerCore.js
 *
 * Pure daily-exam picking rules — the `*Core.js` split (see
 * metaWhatsAppCore.js): no firebase-functions/firebase-admin dependency, so
 * plain-node tests can load these under root deps.
 *
 * Daily Exams are REAL EXAM PAPERS. This mirrors the client's single source
 * of truth, src/utils/quizClassification.js: a published quiz with
 * questionCount >= 50 (or an explicit examOnly=true flag) is exam material
 * that "waits to be pinned as a Daily Exam"; anything shorter lives in the
 * practice library and must never be promoted into the daily slot. The two
 * files have to stay in sync the same way curriculum.js/cbcKnowledge.js do.
 */

const EXAM_QUESTION_THRESHOLD = 50;

// The grades the daily-exam rotation serves. Shared with Vigil's hourly
// per-grade coverage check (monitor.js) so "every grade has a pick today"
// means the same thing in both places.
const DAILY_EXAM_GRADES = ["4", "5", "6", "7"];

/**
 * Whether a quiz doc is an exam paper. An explicit boolean `examOnly` flag
 * is authoritative (an admin can declassify a long quiz or classify a short
 * one); legacy docs without the flag fall back to the question-count rule.
 * Mirrors src/utils/quizClassification.js#isExamOnly.
 */
function isExamPaper(data) {
  if (typeof data?.examOnly === "boolean") return data.examOnly;
  return Number(data?.questionCount) >= EXAM_QUESTION_THRESHOLD;
}

/**
 * Whether a quiz is the public quiz of a past paper: linked to a
 * pastPapers doc, or opted into anonymous public access. Firestore rules
 * block ALL client reads of a daily exam's questions (the answer-key
 * leak closure), so promoting one of these into the daily slot kills its
 * public /papers/:id/quiz page with a permission error for the whole
 * day. They must never enter the daily-exam rotation.
 */
function isPastPaperPublicQuiz(data) {
  if (!data) return false;
  return Boolean(data.linkedPaperId || data.sourcePastPaperId) ||
    data.publicAccess === true;
}

/**
 * Whether a published quiz may be auto-promoted into today's Daily Exam
 * slot: an exam paper that isn't already pinned, isn't visibly empty,
 * and isn't serving a past paper's public quiz page.
 */
function isEligibleDailyExamCandidate(data) {
  if (!data) return false;
  if (data.quizType === "daily_exam") return false; // already pinned
  if (isPastPaperPublicQuiz(data)) return false;
  // Never promote a quiz that is known to have no questions, whatever its
  // flags say — learners would open an empty exam.
  const count = Number(data.questionCount);
  if (Number.isFinite(count) && count <= 0) return false;
  return isExamPaper(data);
}

/**
 * The patch that returns yesterday's pick to its resting classification,
 * mirroring classifyOnPublish: an exam paper goes back to the exam-only
 * pool (quizType null — NOT "practice", which would leak a 50+-question
 * paper into the practice library); a short quiz an admin once pinned by
 * hand goes back to practice.
 */
function demotionPatch(data) {
  return {
    quizType: isExamPaper(data) ? null : "practice",
    isDailyExam: false,
    dailyExamDate: null,
  };
}

module.exports = {
  EXAM_QUESTION_THRESHOLD,
  DAILY_EXAM_GRADES,
  isExamPaper,
  isPastPaperPublicQuiz,
  isEligibleDailyExamCandidate,
  demotionPatch,
};
