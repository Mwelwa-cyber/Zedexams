/**
 * Node test for the server-authoritative daily-exam grader.
 * Run: node functions/grading/dailyExamGrading.test.js
 */

const assert = require("node:assert");
const {
  gradeAttempt,
  stripAnswerKey,
  choiceEquals,
  shouldIncludeAnswerKey,
  canAccessExam,
} = require("./dailyExamGrading");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("dailyExamGrading");

// ── choiceEquals: number / numeric-string drift ──────────────────────────
ok("choiceEquals number==number", choiceEquals(2, 2) === true);
ok("choiceEquals '2'==2 (drift)", choiceEquals("2", 2) === true);
ok("choiceEquals 1!=2", choiceEquals(1, 2) === false);
ok("choiceEquals string fallback", choiceEquals("True", "True") === true);
ok("choiceEquals non-numeric string != number", choiceEquals("True", 2) === false);
ok("choiceEquals empty != 0", choiceEquals("", 0) === false);

// ── Mixed-type quiz grading ──────────────────────────────────────────────
const attempt = {totalMarks: 0, totalQuestions: 0, startedAtMs: 1_000_000};
const questions = [
  {id: "q1", type: "mcq", marks: 2, topic: "Algebra", correctAnswer: 1},
  {id: "q2", type: "numeric", marks: 1, topic: "Algebra", correctAnswer: 3.14, tolerance: 0.01},
  {id: "q3", type: "hotspot", marks: 1, topic: "Maps", correctRegion: {x: 0.5, y: 0.5, radius: 0.1}},
  {id: "q4", type: "short_answer", marks: 1, topic: "Maps", correctAnswer: "Lusaka"},
  {id: "q5", type: "truefalse", marks: 1, topic: "Logic", correctAnswer: 0},
];
const answers = {
  q1: 1, // correct (2)
  q2: "3.15", // within tolerance (1)
  q3: {x: 0.52, y: 0.48}, // inside region (1)
  q4: {given: "lusaka", correct: true}, // AI-marked correct (1)
  q5: 1, // wrong (0)
};
const r = gradeAttempt({attempt, questions, answers, nowMs: 1_060_000});

ok("score sums correct marks (5/6)", r.score === 5);
ok("totalMarks = sum of all marks (6)", r.totalMarks === 6);
ok("totalQuestions = 5", r.totalQuestions === 5);
ok("percentage = round(5/6*100)=83", r.percentage === 83);
ok("timeTakenSeconds from startedAtMs", r.timeTakenSeconds === 60);
ok("Algebra topic 100% (both right)", r.topicBreakdown.Algebra.percentage === 100);
ok("Maps topic 100% (both right)", r.topicBreakdown.Maps.percentage === 100);
ok("Logic topic 0% (wrong)", r.topicBreakdown.Logic.percentage === 0);
ok("Algebra+Maps in strengths", r.strengths.includes("Algebra") && r.strengths.includes("Maps"));
ok("Logic in weaknesses", r.weaknesses.includes("Logic"));
ok("performanceLevel Very Good (83)", r.performanceLevel === "Very Good");
ok("feedback shape present", typeof r.feedback.can === "string" && typeof r.feedback.practice === "string");

// ── All-wrong / empty answers ────────────────────────────────────────────
const empty = gradeAttempt({attempt, questions, answers: {}, nowMs: 1_060_000});
ok("empty answers → score 0", empty.score === 0);
ok("empty answers → percentage 0", empty.percentage === 0);
ok("empty answers → Needs Improvement", empty.performanceLevel === "Needs Improvement");

// ── timeTakenSeconds clamps to the attempt deadline ──────────────────────
// An abandoned attempt is auto-submitted hours later (restoreExam expiry
// path); "time taken" must cap at the exam window, not wall-clock.
const late = gradeAttempt({
  attempt: {totalMarks: 0, totalQuestions: 0, startedAtMs: 1_000_000, endTimeMs: 1_000_000 + 40 * 60_000},
  questions,
  answers: {},
  nowMs: 1_000_000 + 387 * 60_000, // submitted 387 minutes after start
});
ok("late auto-submit caps timeTaken at endTimeMs", late.timeTakenSeconds === 40 * 60);
const onTime = gradeAttempt({
  attempt: {totalMarks: 0, totalQuestions: 0, startedAtMs: 1_000_000, endTimeMs: 1_000_000 + 40 * 60_000},
  questions,
  answers,
  nowMs: 1_060_000,
});
ok("in-window submit unaffected by endTimeMs", onTime.timeTakenSeconds === 60);
const noEnd = gradeAttempt({attempt, questions, answers, nowMs: 1_060_000});
ok("missing endTimeMs falls back to nowMs", noEnd.timeTakenSeconds === 60);

// ── Fallback to attempt totals when questions missing ────────────────────
const fb = gradeAttempt({
  attempt: {totalMarks: 20, totalQuestions: 10, startedAtMs: 1_000_000},
  questions: [],
  answers: {},
  nowMs: 1_030_000,
});
ok("no questions → totalMarks from attempt", fb.totalMarks === 20);
ok("no questions → totalQuestions from attempt", fb.totalQuestions === 10);
ok("no questions → percentage 0", fb.percentage === 0);

// ── stripAnswerKey ───────────────────────────────────────────────────────
const stripped = stripAnswerKey({
  id: "q1", type: "mcq", text: "2+2?", options: ["3", "4"],
  correctAnswer: 1, explanation: "because", tolerance: 0, correctRegion: {x: 0},
});
ok("stripped removes correctAnswer", !("correctAnswer" in stripped));
ok("stripped removes explanation", !("explanation" in stripped));
ok("stripped removes tolerance", !("tolerance" in stripped));
ok("stripped removes correctRegion", !("correctRegion" in stripped));
ok("stripped keeps text/options", stripped.text === "2+2?" && stripped.options.length === 2);

// ── shouldIncludeAnswerKey: the mid-exam answer-key-leak gate ────────────
// Full keys go out ONLY for the caller's own SUBMITTED attempt on THIS exam.
const submittedAttempt = {userId: "u1", examId: "e1", status: "submitted"};
ok("own submitted attempt on this exam → keys included",
  shouldIncludeAnswerKey({attempt: submittedAttempt, uid: "u1", examId: "e1"}) === true);
ok("someone else's submitted attempt → stripped (leak vector)",
  shouldIncludeAnswerKey({attempt: submittedAttempt, uid: "u2", examId: "e1"}) === false);
ok("own submitted attempt but for a DIFFERENT exam → stripped",
  shouldIncludeAnswerKey({attempt: submittedAttempt, uid: "u1", examId: "e2"}) === false);
ok("own attempt still in_progress → stripped (mid-exam)",
  shouldIncludeAnswerKey({
    attempt: {userId: "u1", examId: "e1", status: "in_progress"}, uid: "u1", examId: "e1",
  }) === false);
ok("missing attempt doc → stripped (fail closed)",
  shouldIncludeAnswerKey({attempt: null, uid: "u1", examId: "e1"}) === false);
ok("no args at all → stripped (fail closed)", shouldIncludeAnswerKey() === false);
ok("empty uid → stripped even if attempt matches shape",
  shouldIncludeAnswerKey({
    attempt: {userId: "", examId: "e1", status: "submitted"}, uid: "", examId: "e1",
  }) === false);

// ── canAccessExam: the questions read policy (mirrors firestore.rules) ───
const publishedDaily = {createdBy: "t1", isPublished: true, quizType: "daily_exam"};
ok("any learner can access a PUBLISHED daily_exam",
  canAccessExam({role: "learner", uid: "u1", quizData: publishedDaily}) === true);
ok("admin can access an unpublished draft (moderation)",
  canAccessExam({role: "admin", uid: "u1", quizData: {createdBy: "t1", isPublished: false}}) === true);
ok("owner can access their own unpublished draft (preview)",
  canAccessExam({role: "teacher", uid: "t1", quizData: {createdBy: "t1", isPublished: false}}) === true);
ok("non-owner learner cannot access an unpublished daily_exam",
  canAccessExam({
    role: "learner", uid: "u1",
    quizData: {createdBy: "t1", isPublished: false, quizType: "daily_exam"},
  }) === false);
ok("published PRACTICE quiz is not served from this path",
  canAccessExam({
    role: "learner", uid: "u1",
    quizData: {createdBy: "t1", isPublished: true, quizType: "practice"},
  }) === false);
ok("missing quiz doc → denied (fail closed)",
  canAccessExam({role: "admin", uid: "u1", quizData: null}) === false);

console.log(`\n─── ${passed} assertions · all passed ───`);
