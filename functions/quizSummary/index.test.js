/**
 * Unit tests for buildQuizSummary — the quiz library mirror payload builder.
 * Plain `node` assertions (see CLAUDE.md test conventions). Run with:
 *   node functions/quizSummary/index.test.js
 */

const assert = require("assert");
const {buildQuizSummary, HEAVY_FIELDS} = require("./buildSummary");

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

ok("strips the heavy fields the library never renders", () => {
  const summary = buildQuizSummary({
    title: "Fractions",
    grade: "5",
    passages: [{id: "p1", passageText: "x".repeat(5000)}],
    parts: [{id: "a", instructions: "long"}],
    description: "a very long description",
  });
  assert.strictEqual(summary.title, "Fractions");
  assert.strictEqual(summary.grade, "5");
  for (const field of HEAVY_FIELDS) {
    assert.ok(!(field in summary), `expected ${field} to be stripped`);
  }
});

ok("keeps every metadata field the query + list depend on", () => {
  const full = {
    title: "Energy",
    subject: "Integrated Science",
    grade: "6",
    term: "2",
    topic: "Forms of energy",
    duration: 20,
    questionCount: 15,
    totalMarks: 15,
    passageCount: 0,
    isPublished: true,
    isDemo: false,
    quizType: "practice",
    createdBy: "uid123",
    createdAt: {seconds: 1, nanoseconds: 0},
  };
  const summary = buildQuizSummary(full);
  for (const key of Object.keys(full)) {
    assert.deepStrictEqual(summary[key], full[key], `field ${key} lost`);
  }
});

ok("handles null/undefined/empty input without throwing", () => {
  assert.deepStrictEqual(buildQuizSummary(null), {});
  assert.deepStrictEqual(buildQuizSummary(undefined), {});
  assert.deepStrictEqual(buildQuizSummary({}), {});
});

ok("does not mutate the input doc", () => {
  const input = {title: "T", passages: [{id: "p"}]};
  buildQuizSummary(input);
  assert.ok(Array.isArray(input.passages), "input.passages should survive");
});

console.log(`\n─── ${passed} tests · ${passed} passed · 0 failed ───`);
