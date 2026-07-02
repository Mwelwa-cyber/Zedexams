/**
 * Plain-node tests for the aiLessonCount pure helpers.
 * Run: node functions/teacherTools/lessonCount.test.js
 */

const assert = require("node:assert/strict");

const {
  sanitizeLessonCountInputs,
  validateLessonCountInputs,
  buildLessonCountPrompt,
  coerceLessonCountResult,
  LESSON_COUNT_TOOL_SCHEMA,
  MIN_LESSONS,
  MAX_LESSONS,
} = require("./lessonCountCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// ── sanitizeLessonCountInputs ────────────────────────────────────────────────

test("sanitize keeps well-formed inputs", () => {
  const inputs = sanitizeLessonCountInputs({
    grade: "g5",
    subject: "mathematics",
    topic: "WHOLE NUMBERS",
    subtopic: "Addition of whole numbers",
    expectedStandard: "Adds numbers up to 1000",
    learningActivities: ["Group work", "Drill"],
    avoidCounts: [3, 4],
  });
  assert.equal(inputs.grade, "G5");
  assert.equal(inputs.subject, "mathematics");
  assert.equal(inputs.topic, "WHOLE NUMBERS");
  assert.equal(inputs.subtopic, "Addition of whole numbers");
  assert.deepEqual(inputs.learningActivities, ["Group work", "Drill"]);
  assert.deepEqual(inputs.avoidCounts, [3, 4]);
});

test("sanitize tolerates missing / malformed fields", () => {
  const inputs = sanitizeLessonCountInputs({});
  assert.equal(inputs.topic, "");
  assert.deepEqual(inputs.learningActivities, []);
  assert.deepEqual(inputs.avoidCounts, []);

  const junk = sanitizeLessonCountInputs({
    learningActivities: "not-an-array",
    avoidCounts: ["x", 0, 99, 2.5, 3, 3],
  });
  assert.deepEqual(junk.learningActivities, []);
  // Only in-range integers survive, deduped.
  assert.deepEqual(junk.avoidCounts, [3]);
});

test("sanitize drops blank activities and caps the list at 12", () => {
  const inputs = sanitizeLessonCountInputs({
    topic: "T", subtopic: "S",
    learningActivities: ["", "  ", ...Array.from({length: 20}, (_, i) => `a${i}`)],
  });
  assert.equal(inputs.learningActivities.length, 12);
  assert.equal(inputs.learningActivities[0], "a0");
});

test("sanitize caps avoidCounts at 6 entries", () => {
  const inputs = sanitizeLessonCountInputs({
    avoidCounts: [1, 2, 3, 4, 5, 6, 7, 8],
  });
  assert.equal(inputs.avoidCounts.length, 6);
});

// ── validateLessonCountInputs ────────────────────────────────────────────────

test("validate requires topic and subtopic", () => {
  assert.equal(
    validateLessonCountInputs(sanitizeLessonCountInputs({})).length, 2);
  assert.equal(
    validateLessonCountInputs(sanitizeLessonCountInputs({topic: "T"})).length, 1);
  assert.equal(
    validateLessonCountInputs(
      sanitizeLessonCountInputs({topic: "T", subtopic: "S"})).length, 0);
});

// ── buildLessonCountPrompt ───────────────────────────────────────────────────

test("prompt includes context and syllabus activities", () => {
  const prompt = buildLessonCountPrompt(sanitizeLessonCountInputs({
    grade: "G5",
    subject: "mathematics",
    topic: "WHOLE NUMBERS",
    subtopic: "Addition of whole numbers",
    expectedStandard: "Adds up to 1000",
    learningActivities: ["Group work"],
  }));
  assert.match(prompt, /Grade: G5/);
  assert.match(prompt, /Subject: mathematics/);
  assert.match(prompt, /Topic: WHOLE NUMBERS/);
  assert.match(prompt, /Sub-topic: Addition of whole numbers/);
  assert.match(prompt, /Expected standard: Adds up to 1000/);
  assert.match(prompt, /- Group work/);
  assert.doesNotMatch(prompt, /already seen suggestions/);
});

test("prompt asks for a different pacing when avoidCounts is set", () => {
  const prompt = buildLessonCountPrompt(sanitizeLessonCountInputs({
    topic: "T", subtopic: "S", avoidCounts: [3, 4],
  }));
  assert.match(prompt, /already seen suggestions of 3, 4/);
  assert.match(prompt, /DIFFERENT lesson count/);
});

test("prompt omits optional lines when fields are empty", () => {
  const prompt = buildLessonCountPrompt(
    sanitizeLessonCountInputs({topic: "T", subtopic: "S"}));
  assert.doesNotMatch(prompt, /Grade:/);
  assert.doesNotMatch(prompt, /Expected standard:/);
  assert.doesNotMatch(prompt, /Learning activities/);
});

// ── coerceLessonCountResult ──────────────────────────────────────────────────

const INPUTS = sanitizeLessonCountInputs({
  topic: "WHOLE NUMBERS",
  subtopic: "Addition of whole numbers",
});

test("coerce passes through a well-formed result", () => {
  const result = coerceLessonCountResult({
    count: 3,
    reason: "Three concept steps.",
    breakdown: [
      {title: "Place value recap", focus: "Revise tens and units."},
      {title: "Adding without carrying", focus: "Column addition practice."},
      {title: "Adding with carrying", focus: "Apply carrying to sums."},
    ],
  }, INPUTS);
  assert.equal(result.count, 3);
  assert.equal(result.reason, "Three concept steps.");
  assert.equal(result.breakdown.length, 3);
  assert.deepEqual(result.breakdown.map((b) => b.lessonNumber), [1, 2, 3]);
  assert.equal(result.breakdown[0].title, "Place value recap");
  assert.equal(result.breakdown[1].focus, "Column addition practice.");
  assert.ok(result.breakdown.every((b) => b.status === "pending"));
});

test("coerce clamps the count into range", () => {
  assert.equal(coerceLessonCountResult({count: 0, reason: "r", breakdown: []},
    INPUTS).count, MIN_LESSONS);
  assert.equal(coerceLessonCountResult({count: 99, reason: "r", breakdown: []},
    INPUTS).count, MAX_LESSONS);
  assert.equal(coerceLessonCountResult({count: "x", reason: "r", breakdown: []},
    INPUTS).count, 2);
  assert.equal(coerceLessonCountResult(null, INPUTS).count, 2);
});

test("coerce pads a short breakdown to exactly `count` items", () => {
  const result = coerceLessonCountResult({
    count: 3,
    reason: "r",
    breakdown: [{title: "Only one", focus: "f"}],
  }, INPUTS);
  assert.equal(result.breakdown.length, 3);
  assert.equal(result.breakdown[0].title, "Only one");
  // Padded items fall back to the sub-topic title convention.
  assert.equal(result.breakdown[1].title, "Lesson 2: Addition of whole numbers");
  assert.equal(result.breakdown[2].lessonNumber, 3);
});

test("coerce truncates an over-long breakdown to `count` items", () => {
  const result = coerceLessonCountResult({
    count: 2,
    reason: "r",
    breakdown: Array.from({length: 6}, (_, i) => ({title: `T${i}`, focus: ""})),
  }, INPUTS);
  assert.equal(result.breakdown.length, 2);
});

test("coerce supplies a fallback reason when missing", () => {
  const result = coerceLessonCountResult({count: 2, breakdown: []}, INPUTS);
  assert.ok(result.reason.length > 0);
});

// ── schema sanity ────────────────────────────────────────────────────────────

test("tool schema requires count, reason and breakdown", () => {
  assert.deepEqual(
    [...LESSON_COUNT_TOOL_SCHEMA.required].sort(),
    ["breakdown", "count", "reason"]);
  assert.equal(LESSON_COUNT_TOOL_SCHEMA.properties.count.minimum, MIN_LESSONS);
  assert.equal(LESSON_COUNT_TOOL_SCHEMA.properties.count.maximum, MAX_LESSONS);
});

console.log(`\nlessonCount tests: ${passed} passed`);
