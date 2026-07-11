/**
 * functions/grading/dailyExamGrading.js
 *
 * Server-authoritative grader for Daily Exams. This is the single place a
 * daily-exam score is ever computed. It is a logic port of the old
 * client-side examService._doSubmit() grading block so existing attempts
 * grade identically — the only change is WHERE it runs (a trusted Cloud
 * Function with the answer key, instead of the learner's browser).
 *
 * Pure and dependency-light (only the two pure grading helpers) so it can
 * be unit-tested in plain Node without firebase-admin.
 */

const {numericMatches} = require("./numericGrading");
const {hotspotMatches} = require("./hotspotGrading");

function listify(arr) {
  if (arr.length === 0) return "";
  if (arr.length === 1) return arr[0];
  return arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
}

// MCQ / true-false answers are option indices. The stored key and the
// learner's submission can drift between number and numeric-string across
// historical data; compare numerically when both are clean numbers, else
// fall back to strict equality. This is INTENTIONALLY more lenient than
// strict `===`: it awards a mark when the values are numerically equal
// but differently typed (e.g. given "2" vs correct 2 — the same option),
// which strict equality would reject. Two genuinely different option
// indices still differ numerically, so no wrong answer is passed.
function choiceEquals(given, correct) {
  const gn = Number(given);
  const cn = Number(correct);
  const givenNumeric = given !== "" && given !== null && given !== undefined && Number.isFinite(gn);
  const correctNumeric = correct !== "" && correct !== null && correct !== undefined && Number.isFinite(cn);
  if (givenNumeric && correctNumeric) return gn === cn;
  return given === correct;
}

/**
 * Grade an attempt.
 *
 * @param {object} args
 * @param {object} args.attempt   The exam_attempts doc data (needs
 *                                totalMarks, totalQuestions, startedAtMs,
 *                                endTimeMs — the server-derived deadline,
 *                                startedAtMs + exam duration).
 * @param {object[]} args.questions  Raw question docs (with answer keys).
 * @param {object} args.answers   { [questionId]: value } from the learner.
 * @param {number} args.nowMs     Server time in ms (Date.now()).
 * @returns {object} The scoring payload (no Firestore sentinels) matching
 *                    src/schemas/attempt.js attemptSubmitSchema minus
 *                    `status`/`submittedAt`, which the caller adds.
 */
function gradeAttempt({attempt, questions, answers, nowMs}) {
  const safeQuestions = Array.isArray(questions) ? questions : [];
  const safeAnswers = (answers && typeof answers === "object" && !Array.isArray(answers))
    ? answers
    : {};
  let score = 0;
  let totalMarks = 0;
  const topicBreakdown = {};

  safeQuestions.forEach((q) => {
    const marks = q.marks ?? 1;
    const topic = (q.topic || "General").trim();
    totalMarks += marks;

    const isText = q.type === "short_answer" || q.type === "diagram";
    const isNumeric = q.type === "numeric";
    const isHotspot = q.type === "hotspot";
    const given = safeAnswers[q.id];
    const correct = isText ?
      given?.correct === true :
      isNumeric ?
        numericMatches(given, q.correctAnswer, q.tolerance) :
        isHotspot ?
          hotspotMatches(given, q.correctRegion) :
          choiceEquals(given, q.correctAnswer);
    if (correct) score += marks;

    if (!topicBreakdown[topic]) {
      topicBreakdown[topic] = {correct: 0, total: 0, marks: 0, totalMarks: 0};
    }
    topicBreakdown[topic].total += 1;
    topicBreakdown[topic].totalMarks += marks;
    if (correct) {
      topicBreakdown[topic].correct += 1;
      topicBreakdown[topic].marks += marks;
    }
  });

  Object.values(topicBreakdown).forEach((t) => {
    t.percentage = t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0;
  });

  if (totalMarks === 0) totalMarks = attempt.totalMarks || 0;

  const totalQuestions = safeQuestions.length || attempt.totalQuestions || 0;
  const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;
  const startMs = Number.isFinite(attempt.startedAtMs) ? attempt.startedAtMs : (nowMs - 60_000);
  // Cap the submission instant at the attempt deadline so an abandoned
  // exam auto-submitted hours later can't record an inflated duration.
  // endTimeMs must be server-derived (startedAt + quiz duration) — never
  // the client-written attempt.endTime, which follows the device clock.
  const submitMs = Number.isFinite(attempt.endTimeMs) ? Math.min(nowMs, attempt.endTimeMs) : nowMs;
  const timeTakenSeconds = Math.max(0, Math.round((submitMs - startMs) / 1000));

  const strengths = Object.entries(topicBreakdown)
    .filter(([, t]) => t.percentage >= 70).map(([k]) => k);
  const weaknesses = Object.entries(topicBreakdown)
    .filter(([, t]) => t.percentage < 50).map(([k]) => k);

  const performanceLevel =
    percentage >= 90 ? "Excellent" :
      percentage >= 75 ? "Very Good" :
        percentage >= 60 ? "Good" :
          percentage >= 50 ? "Developing" :
            "Needs Improvement";

  const feedbackCan = strengths.length > 0 ?
    `You can work confidently with ${listify(strengths)}.` :
    "You are building your skills across all topics in this exam.";
  const feedbackDeveloping = weaknesses.length > 0 ?
    `You are still developing your understanding of ${listify(weaknesses)}.` :
    "You showed a solid understanding across all the topics covered.";
  const feedbackPractice = weaknesses.length > 0 ?
    `Practise more questions on ${listify(weaknesses)} to strengthen these areas.` :
    "Keep up the excellent work — try another exam to maintain your performance!";

  return {
    score,
    totalMarks,
    totalQuestions,
    percentage,
    timeTakenSeconds,
    topicBreakdown,
    strengths,
    weaknesses,
    performanceLevel,
    feedback: {can: feedbackCan, developing: feedbackDeveloping, practice: feedbackPractice},
  };
}

// Fields stripped from question docs before they are sent to a learner who
// is TAKING the exam (no submitted attempt yet). After submission the full
// docs are returned so the corrections/review screen can show answers.
const ANSWER_KEY_FIELDS = ["correctAnswer", "tolerance", "correctRegion", "explanation"];

function stripAnswerKey(question) {
  const clean = {...question};
  ANSWER_KEY_FIELDS.forEach((f) => delete clean[f]);
  return clean;
}

/**
 * The answer-key gate: full question docs (keys included) go out ONLY when
 * the caller already has a SUBMITTED attempt on THIS exam. Everything else —
 * missing attempt, someone else's attempt, a different exam's attempt, an
 * attempt still in progress — stays stripped, or a mid-exam learner could
 * pull the day's answer key. Pure so getExamQuestions' security decision is
 * directly testable; every falsy/mismatched input fails closed.
 *
 * @param {object} p
 * @param {object|null|undefined} p.attempt — exam_attempts doc data (null when absent)
 * @param {string} p.uid — caller's auth uid
 * @param {string} p.examId — the exam being fetched
 * @returns {boolean}
 */
function shouldIncludeAnswerKey({attempt, uid, examId} = {}) {
  if (!attempt || !uid || !examId) return false;
  return attempt.userId === uid &&
    attempt.examId === examId &&
    attempt.status === "submitted";
}

/**
 * The exam-access decision behind assertExamAccess: admin, quiz owner, or a
 * PUBLISHED daily_exam — everything else (unpublished drafts, other
 * teachers' quizzes, published practice quizzes) is denied. Pure mirror of
 * the firestore.rules questions read policy so it tests under plain node;
 * the callable wraps it with the role lookup + HttpsError.
 *
 * @param {object} p
 * @param {string} p.role — resolved user role
 * @param {string} p.uid — caller's auth uid
 * @param {object|null|undefined} p.quizData — quiz doc data
 * @returns {boolean}
 */
function canAccessExam({role, uid, quizData} = {}) {
  if (!quizData) return false;
  if (role === "admin") return true;
  if (uid && quizData.createdBy === uid) return true;
  return quizData.isPublished === true && (quizData.quizType || "") === "daily_exam";
}

module.exports = {
  gradeAttempt,
  stripAnswerKey,
  ANSWER_KEY_FIELDS,
  choiceEquals,
  shouldIncludeAnswerKey,
  canAccessExam,
};
