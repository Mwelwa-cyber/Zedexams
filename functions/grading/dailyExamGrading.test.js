/**
 * Node test for the server-authoritative daily-exam grader.
 * Run: node functions/grading/dailyExamGrading.test.js
 */

const assert = require("node:assert");
const {gradeAttempt, stripAnswerKey, choiceEquals} = require("./dailyExamGrading");

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

console.log(`\n─── ${passed} assertions · all passed ───`);
