/**
 * Unit tests for the pure daily-exam picking rules
 * (functions/dailyExamPickerCore.js — the *Core.js split, so this loads
 * under root deps with no firebase-functions installed).
 *
 * Plain Node assertions, no test runner (repo convention):
 *   node functions/dailyExamPicker.test.js
 *
 * The load-bearing regression here: Daily Exams must draw ONLY from real
 * exam papers (questionCount >= 50, or examOnly=true). The picker
 * originally did the opposite — it promoted short practice quizzes and
 * excluded exam papers — so learners got a 10-question practice quiz as
 * the day's "exam".
 */

const assert = require("node:assert");
const {
  EXAM_QUESTION_THRESHOLD,
  DAILY_EXAM_GRADES,
  isExamPaper,
  isPastPaperPublicQuiz,
  isEligibleDailyExamCandidate,
  demotionPatch,
} = require("./dailyExamPickerCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

// ── isExamPaper ──────────────────────────────────────────────────────
test("threshold matches the client's classification rule (50)", () => {
  // Must stay in sync with src/utils/quizClassification.js
  assert.strictEqual(EXAM_QUESTION_THRESHOLD, 50);
});

test("the daily-exam rotation serves grades 4–7 (shared with Vigil's coverage check)", () => {
  assert.deepStrictEqual(DAILY_EXAM_GRADES, ["4", "5", "6", "7"]);
});

test("a 50+-question quiz is an exam paper (legacy doc, no flag)", () => {
  assert.strictEqual(isExamPaper({questionCount: 50}), true);
  assert.strictEqual(isExamPaper({questionCount: 72}), true);
});

test("a short quiz is NOT an exam paper", () => {
  assert.strictEqual(isExamPaper({questionCount: 10}), false);
  assert.strictEqual(isExamPaper({questionCount: 49}), false);
});

test("an explicit examOnly flag is authoritative in both directions", () => {
  // Admin classified a short quiz as exam material…
  assert.strictEqual(isExamPaper({examOnly: true, questionCount: 20}), true);
  // …or declassified a long one.
  assert.strictEqual(isExamPaper({examOnly: false, questionCount: 80}), false);
});

// ── isEligibleDailyExamCandidate ─────────────────────────────────────
test("exam papers are eligible for the daily slot", () => {
  assert.strictEqual(isEligibleDailyExamCandidate({questionCount: 55, quizType: null}), true);
  assert.strictEqual(isEligibleDailyExamCandidate({examOnly: true, questionCount: 60}), true);
});

test("short practice quizzes are NEVER auto-picked (the inversion regression)", () => {
  assert.strictEqual(isEligibleDailyExamCandidate({questionCount: 10, quizType: "practice"}), false);
  assert.strictEqual(isEligibleDailyExamCandidate({questionCount: 49, quizType: null}), false);
});

test("an already-pinned daily exam is not re-picked", () => {
  assert.strictEqual(isEligibleDailyExamCandidate({questionCount: 60, quizType: "daily_exam"}), false);
});

test("a visibly empty quiz is never promoted, even if flagged examOnly", () => {
  assert.strictEqual(isEligibleDailyExamCandidate({examOnly: true, questionCount: 0}), false);
});

test("nullish data is not eligible", () => {
  assert.strictEqual(isEligibleDailyExamCandidate(null), false);
  assert.strictEqual(isEligibleDailyExamCandidate(undefined), false);
});

// ── isPastPaperPublicQuiz ────────────────────────────────────────────
// The regression: autoPickDailyExams promoted a 60-question past-paper
// quiz (publicAccess + linkedPaperId) into the daily slot, and the
// daily_exam question-read block in firestore.rules then 403'd the
// paper's public /papers/:id/quiz page for the whole day.
test("a paper-linked or public-access quiz is recognised as a past-paper quiz", () => {
  assert.strictEqual(isPastPaperPublicQuiz({linkedPaperId: "abc"}), true);
  assert.strictEqual(isPastPaperPublicQuiz({sourcePastPaperId: "abc"}), true);
  assert.strictEqual(isPastPaperPublicQuiz({publicAccess: true}), true);
  assert.strictEqual(isPastPaperPublicQuiz({questionCount: 60}), false);
  assert.strictEqual(isPastPaperPublicQuiz({publicAccess: false, linkedPaperId: null}), false);
  assert.strictEqual(isPastPaperPublicQuiz(null), false);
});

test("a past paper's public quiz is NEVER auto-picked, even as a 50+-question exam paper", () => {
  assert.strictEqual(
      isEligibleDailyExamCandidate({questionCount: 60, publicAccess: true, linkedPaperId: "p1"}),
      false,
  );
  assert.strictEqual(
      isEligibleDailyExamCandidate({questionCount: 60, publicAccess: true}),
      false,
  );
  assert.strictEqual(
      isEligibleDailyExamCandidate({questionCount: 60, sourcePastPaperId: "p1"}),
      false,
  );
  // …while the same paper without the public linkage stays eligible.
  assert.strictEqual(isEligibleDailyExamCandidate({questionCount: 60}), true);
});

// ── demotionPatch ────────────────────────────────────────────────────
test("a demoted exam paper returns to the exam-only pool, not practice", () => {
  const patch = demotionPatch({questionCount: 60, quizType: "daily_exam"});
  // quizType "practice" here would leak a 50+-question paper into the
  // practice library (getQuizzes filters quizType == 'practice').
  assert.deepStrictEqual(patch, {quizType: null, isDailyExam: false, dailyExamDate: null});
});

test("a demoted hand-pinned short quiz returns to practice", () => {
  const patch = demotionPatch({questionCount: 12, quizType: "daily_exam"});
  assert.deepStrictEqual(patch, {quizType: "practice", isDailyExam: false, dailyExamDate: null});
});

console.log(`\n✓ dailyExamPicker.test.js — ${passed} checks passed`);
