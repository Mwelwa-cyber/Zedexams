/**
 * Unit tests for the Curriculum Module runtime validator.
 * Plain Node assertions, no test runner (repo convention). Pure module —
 * no Firebase, no network.
 *
 *   node functions/teacherTools/curriculumModuleSchema.test.js
 */

const assert = require("node:assert");
const {
  SCHEMA_VERSION,
  validateCurriculumModule,
  buildModuleId,
} = require("./curriculumModuleSchema");
const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

const VALID = {
  grade: "G4",
  subject: "mathematics",
  term: 2,
  topic: "Fractions",
  subtopic: "Equivalent fractions",
  outcomes: ["Identify equivalent fractions"],
};

// ── buildModuleId ────────────────────────────────────────────────────
test("buildModuleId slugs the sub-topic and appends the term", () => {
  assert.strictEqual(buildModuleId("Equivalent Fractions!", 2), "equivalent-fractions-t2");
});

test("buildModuleId defaults an out-of-range or missing term to 1", () => {
  assert.strictEqual(buildModuleId("Sets", 0), "sets-t1");
  assert.strictEqual(buildModuleId("Sets", 9), "sets-t1");
  assert.strictEqual(buildModuleId("Sets", "x"), "sets-t1");
});

test("buildModuleId returns null when the sub-topic slugs to nothing", () => {
  assert.strictEqual(buildModuleId("", 1), null);
  assert.strictEqual(buildModuleId("!!!", 1), null);
  assert.strictEqual(buildModuleId(null, 1), null);
});

test("buildModuleId caps the slug at 60 chars", () => {
  const id = buildModuleId("x".repeat(120), 3);
  assert.strictEqual(id, `${"x".repeat(60)}-t3`);
});

// ── validateCurriculumModule: happy path ─────────────────────────────
test("a minimal valid module normalises with defaults", () => {
  const res = validateCurriculumModule(VALID);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.value.schemaVersion, SCHEMA_VERSION);
  assert.strictEqual(res.value.grade, "G4");
  assert.strictEqual(res.value.subject, "mathematics");
  assert.strictEqual(res.value.term, 2);
  // No totalLessons given → one suggested lesson per outcome.
  assert.strictEqual(res.value.suggestedLessons, 1);
  assert.deepStrictEqual(res.value.competencies, []);
  assert.deepStrictEqual(res.value.learningEnvironmentOptions, []);
});

test("grade and subject are normalised, not just copied", () => {
  const res = validateCurriculumModule({...VALID, grade: " g 4 ", subject: "Social Studies"});
  assert.strictEqual(res.value.grade, "G4");
  assert.strictEqual(res.value.subject, "social_studies");
});

test("explicit totalLessons wins over the per-outcome fallback", () => {
  const res = validateCurriculumModule({...VALID, totalLessons: 5});
  assert.strictEqual(res.value.suggestedLessons, 5);
  const bad = validateCurriculumModule({...VALID, totalLessons: -2, outcomes: ["a", "b", "c"]});
  assert.strictEqual(bad.value.suggestedLessons, 3);
});

test("learning environments are filtered to the known vocabulary", () => {
  const known = LEARNING_ENVIRONMENT_VALUES[0];
  const res = validateCurriculumModule({
    ...VALID,
    learningEnvironmentOptions: [known.toUpperCase(), "made up place"],
  });
  assert.deepStrictEqual(res.value.learningEnvironmentOptions, [known]);
});

// ── validateCurriculumModule: every required-field error ─────────────
test("each missing required field is named in errors", () => {
  const res = validateCurriculumModule({});
  assert.strictEqual(res.ok, false);
  for (const needle of [
    "grade is required",
    "subject is required",
    "term must be 1, 2 or 3",
    "topic is required",
    "subtopic is required",
    "at least one specific learning outcome is required",
  ]) {
    assert.ok(res.errors.includes(needle), `expected error: ${needle}`);
  }
  // value still comes back normalised so callers never null-check.
  assert.strictEqual(res.value.term, 1);
});

test("non-object input fails without a value crash", () => {
  assert.strictEqual(validateCurriculumModule(null).ok, false);
  assert.strictEqual(validateCurriculumModule("x").ok, false);
});

test("outcomes are trimmed, capped and blank entries dropped", () => {
  const res = validateCurriculumModule({
    ...VALID,
    outcomes: ["  keep  ", "", "   ", 42, "x".repeat(600)],
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.value.outcomes[0], "keep");
  assert.strictEqual(res.value.outcomes.length, 2);
  assert.strictEqual(res.value.outcomes[1].length, 500);
});

test("string fields are length-capped", () => {
  const res = validateCurriculumModule({...VALID, contentSummary: "y".repeat(9000)});
  assert.strictEqual(res.value.contentSummary.length, 8000);
});

console.log(`\ncurriculumModuleSchema: all ${passed} tests passed`);
