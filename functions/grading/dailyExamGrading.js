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
 *                                totalMarks, totalQuestions, startedAtMs).
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
  const timeTakenSeconds = Math.max(0, Math.round((nowMs - startMs) / 1000));

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

module.exports = {gradeAttempt, stripAnswerKey, ANSWER_KEY_FIELDS, choiceEquals};
