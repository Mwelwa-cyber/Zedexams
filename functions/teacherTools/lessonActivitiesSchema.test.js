/**
 * Unit tests for the Lesson Activities schema validator.
 *
 * Plain Node assertions, no test runner (repo convention):
 *   node functions/teacherTools/lessonActivitiesSchema.test.js
 */

const assert = require("node:assert");
const {
  validateLessonActivities,
  normalizeType,
  normalizeDifficulty,
} = require("./lessonActivitiesSchema");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

console.log("lessonActivitiesSchema");

test("normalizeType folds aliases onto the canonical set", () => {
  assert.strictEqual(normalizeType("MCQ"), "multiple_choice");
  assert.strictEqual(normalizeType("multiple-choice"), "multiple_choice");
  assert.strictEqual(normalizeType("fill in the blank"), "fill_in_blank");
  assert.strictEqual(normalizeType("Fill_Blanks"), "fill_in_blank");
  assert.strictEqual(normalizeType("True/False"), "true_false");
  assert.strictEqual(normalizeType("structured_questions"), "structured");
  // Unknown → safe default rather than throwing.
  assert.strictEqual(normalizeType("gibberish"), "short_answer");
});

test("normalizeDifficulty maps synonyms and clamps to the allowed set", () => {
  assert.strictEqual(normalizeDifficulty("Easy"), "easy");
  assert.strictEqual(normalizeDifficulty("hard"), "challenging");
  assert.strictEqual(normalizeDifficulty("moderate"), "medium");
  assert.strictEqual(normalizeDifficulty("???"), "medium");
});

test("a non-object payload fails cleanly", () => {
  const r = validateLessonActivities(null, {exercise: true});
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.value, {exercise: null, homework: null});
});

test("a requested-but-missing activity is an error", () => {
  const r = validateLessonActivities({exercise: {header: {}, questions: []}}, {
    exercise: true,
    homework: true,
  });
  assert.strictEqual(r.ok, false);
  // homework was requested but absent
  assert.ok(r.errors.some((e) => /homework/i.test(e)));
});

test("only the requested activities are returned", () => {
  const r = validateLessonActivities({
    exercise: {
      header: {grade: "G5", subject: "mathematics", topic: "Fractions"},
      questions: [{type: "mcq", prompt: "2/4 = ?", options: ["1/2", "2/3"], answer: "A", marks: 1}],
    },
    homework: {header: {}, questions: [{prompt: "ignored"}]},
  }, {exercise: true, homework: false});
  assert.strictEqual(r.ok, true);
  assert.ok(r.value.exercise);
  assert.strictEqual(r.value.homework, null);
});

test("a valid exercise normalises types and auto-sums total marks", () => {
  const r = validateLessonActivities({
    exercise: {
      header: {grade: "G5", subject: "mathematics", topic: "Fractions"},
      questions: [
        {type: "mcq", prompt: "Q1", options: ["a", "b", "c"], answer: "B", marks: 2},
        {type: "structured", prompt: "Q2", parts: [
          {label: "(a)", prompt: "x", answer: "1", marks: 3},
          {label: "(b)", prompt: "y", answer: "2", marks: 1},
        ]},
      ],
    },
  }, {exercise: true});
  assert.strictEqual(r.ok, true);
  const ex = r.value.exercise;
  assert.strictEqual(ex.kind, "exercise");
  assert.strictEqual(ex.questions[0].type, "multiple_choice");
  assert.strictEqual(ex.questions[1].parts.length, 2);
  // 2 (mcq) + 3 + 1 (structured parts) = 6
  assert.strictEqual(ex.header.totalMarks, 6);
});

test("matching questions keep their pairs", () => {
  const r = validateLessonActivities({
    homework: {
      header: {grade: "G6", subject: "english", topic: "Nouns"},
      questions: [{
        type: "matching",
        prompt: "Match the words",
        matchPairs: [
          {left: "cat", right: "animal"},
          {left: "Lusaka", right: "city"},
        ],
      }],
    },
  }, {homework: true});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.homework.questions[0].matchPairs.length, 2);
});

test("missing required header fields are reported", () => {
  const r = validateLessonActivities({
    exercise: {header: {grade: "G5"}, questions: [{prompt: "Q"}]},
  }, {exercise: true});
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /subject/.test(e)));
  assert.ok(r.errors.some((e) => /topic/.test(e)));
});

console.log(`\nlessonActivitiesSchema: ${passed} tests passed`);
