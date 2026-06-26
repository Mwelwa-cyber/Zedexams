/**
 * Unit tests for the weekly CBC audit scoping helper.
 *
 * Plain Node assertions, no test runner (repo convention).
 *
 *   node functions/agents/auditScope.test.js
 */

const assert = require("node:assert");
const {shouldAuditGeneration, NON_CURRICULAR_TOOLS} = require("./auditScope");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

// A topic-scoped generation (the normal case) is audited.
test("audits a topic-scoped generation", () => {
  assert.strictEqual(
      shouldAuditGeneration({
        tool: "assessment",
        inputs: {grade: "G4", subject: "integrated_science", topic: "Nutrition and Health"},
      }),
      true,
  );
});

// Subject-wide exam papers have no topic and must be skipped, not flagged
// as "Topic not found in verified CBC KB".
test("skips an exam paper with no topic", () => {
  assert.strictEqual(
      shouldAuditGeneration({tool: "exam_paper", inputs: {grade: "G7", subject: "mathematics"}}),
      false,
  );
});

test("skips when topic is blank or whitespace", () => {
  assert.strictEqual(shouldAuditGeneration({tool: "exam_paper", inputs: {topic: ""}}), false);
  assert.strictEqual(shouldAuditGeneration({tool: "exam_paper", inputs: {topic: "   "}}), false);
  assert.strictEqual(shouldAuditGeneration({tool: "exam_paper", inputs: {topic: null}}), false);
});

// Non-curricular tools carry a topic label but have no CBC outcomes; skip
// them even when inputs.topic is a non-empty string.
test("skips non-curricular tools even with a topic label", () => {
  assert.strictEqual(
      shouldAuditGeneration({tool: "class_timetable", inputs: {topic: "Grade 5 timetable"}}),
      false,
  );
  assert.strictEqual(
      shouldAuditGeneration({tool: "record_of_work", inputs: {topic: "Term 2 record of work"}}),
      false,
  );
  assert.ok(NON_CURRICULAR_TOOLS.has("class_timetable"));
  assert.ok(NON_CURRICULAR_TOOLS.has("record_of_work"));
});

// A topic-scoped task whose topic isn't in the KB is STILL audited — that
// is a real "topic not in KB" signal worth surfacing, not noise to hide.
test("audits a topic-scoped task with an unrecognised topic", () => {
  assert.strictEqual(
      shouldAuditGeneration({tool: "sba_task", inputs: {grade: "G5", subject: "integrated_science", topic: "5.1.1 The Heart"}}),
      true,
  );
});

// Defensive: missing/garbage shapes don't throw and don't get audited.
test("handles missing tool/inputs without throwing", () => {
  assert.strictEqual(shouldAuditGeneration({}), false);
  assert.strictEqual(shouldAuditGeneration(), false);
  assert.strictEqual(shouldAuditGeneration({tool: "notes"}), false);
});

console.log(`\n${passed} passed`);
