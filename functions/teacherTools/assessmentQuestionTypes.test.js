/**
 * Node test for the question-type restriction that fixes the "I picked
 * Multiple choice + Fill in the blank but got short-answer and structured
 * questions too" bug in the Create-paper-with-AI / Test Paper Studio flow.
 *
 * Two units under test:
 *   1. generateAssessment.normalizeQuestionTypes — maps the studio's chips to
 *      canonical schema types (fill-in-the-blank → short_answer, dedupe, drop
 *      junk).
 *   2. assessmentFormats.filterProfileToTypes / renderFormatContextBlock — the
 *      resolved paper format is narrowed to ONLY the chosen types, so the
 *      format block the model treats as authoritative can never reintroduce a
 *      type the teacher didn't ask for.
 *
 * Run: node functions/teacherTools/assessmentQuestionTypes.test.js
 */

const assert = require("node:assert");
const {
  normalizeQuestionTypes,
  filterProfileToTypes,
  renderFormatContextBlock,
  DEFAULT_PROFILE,
} = require("./assessmentFormats");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentQuestionTypes");

// ── normalizeQuestionTypes ──────────────────────────────────────────────────
{
  assert.deepStrictEqual(
    normalizeQuestionTypes(["multiple_choice", "short_answer"]),
    ["multiple_choice", "short_answer"]);
  ok("passes through canonical types unchanged", true);

  // Fill-in-the-blank maps to short_answer; the chip "short answer" + the chip
  // "fill-in-the-blank" both arrive canonicalised, so they dedupe to one.
  assert.deepStrictEqual(
    normalizeQuestionTypes(["multiple_choice", "fill_in_the_blank"]),
    ["multiple_choice", "short_answer"]);
  ok("fill_in_the_blank maps to short_answer", true);

  assert.deepStrictEqual(
    normalizeQuestionTypes(["short_answer", "short_answer", "fill_in_the_blank"]),
    ["short_answer"]);
  ok("duplicates (incl. fill-in-the-blank) collapse to one", true);

  // Loose/free-text shapes still resolve.
  assert.deepStrictEqual(
    normalizeQuestionTypes(["True/False", "multiple choice"]),
    ["true_false", "multiple_choice"]);
  ok("loose human strings normalise to canonical keys", true);

  // Junk is dropped; empty/non-array yields [] (= no restriction).
  assert.deepStrictEqual(
    normalizeQuestionTypes(["banana", "", null, "essay"]), ["essay"]);
  assert.deepStrictEqual(normalizeQuestionTypes([]), []);
  assert.deepStrictEqual(normalizeQuestionTypes("nope"), []);
  assert.deepStrictEqual(normalizeQuestionTypes(undefined), []);
  ok("junk dropped; empty / non-array → []", true);
}

// ── filterProfileToTypes ────────────────────────────────────────────────────
{
  // DEFAULT_PROFILE has two sections: A (multiple_choice, short_answer) and
  // B (short_answer, calculation, structured).
  const filtered = filterProfileToTypes(DEFAULT_PROFILE,
    ["multiple_choice", "short_answer"]);
  const allTypes = filtered.paperStructure
    .flatMap((s) => s.questionTypes);
  ok("no disallowed type survives in any section",
    allTypes.every((t) => t === "multiple_choice" || t === "short_answer"));
  ok("calculation + structured are stripped out",
    !allTypes.includes("calculation") && !allTypes.includes("structured"));
  ok("surviving marks shares re-normalise to 100",
    filtered.paperStructure.reduce((sum, s) => sum + s.marksShare, 0) === 100);

  // Multiple-choice only: section B (no MCQ) drops, section A keeps only MCQ.
  const mcqOnly = filterProfileToTypes(DEFAULT_PROFILE, ["multiple_choice"]);
  ok("MCQ-only keeps a single MCQ section at 100%",
    mcqOnly.paperStructure.length === 1 &&
    mcqOnly.paperStructure[0].marksShare === 100 &&
    mcqOnly.paperStructure[0].questionTypes.length === 1 &&
    mcqOnly.paperStructure[0].questionTypes[0] === "multiple_choice");

  // A type no format section uses (matching) → single fallback section that
  // carries exactly the allowed type, never anything else.
  const matchOnly = filterProfileToTypes(DEFAULT_PROFILE, ["matching"]);
  ok("a type absent from every section collapses to one allowed-only section",
    matchOnly.paperStructure.length === 1 &&
    matchOnly.paperStructure[0].marksShare === 100 &&
    matchOnly.paperStructure[0].questionTypes.length === 1 &&
    matchOnly.paperStructure[0].questionTypes[0] === "matching");

  // Exemplars are filtered too (DEFAULT_PROFILE exemplars are short_answer +
  // calculation; restricting to MCQ leaves none).
  ok("exemplar questions outside the whitelist are dropped",
    filterProfileToTypes(DEFAULT_PROFILE, ["multiple_choice"])
      .exemplarQuestions.length === 0);

  // No restriction = no-op.
  assert.strictEqual(filterProfileToTypes(DEFAULT_PROFILE, []), DEFAULT_PROFILE);
  assert.strictEqual(
    filterProfileToTypes(DEFAULT_PROFILE, undefined), DEFAULT_PROFILE);
  ok("empty / missing allowedTypes is a no-op", true);
}

// ── renderFormatContextBlock surfaces the restriction ───────────────────────
{
  const block = renderFormatContextBlock(DEFAULT_PROFILE,
    {grade: "G4", allowedTypes: ["multiple_choice", "short_answer"]});
  ok("rendered block announces the question-type restriction",
    block.includes("QUESTION-TYPE RESTRICTION") &&
    block.includes("overrides everything below"));
  ok("rendered block lists the allowed type labels",
    block.includes("Multiple choice") &&
    block.includes("Short answer / fill-in-the-blank"));
  ok("rendered block does not name a stripped type in the structure",
    !/Question types:.*calculation/.test(block) &&
    !/Question types:.*structured/.test(block));

  // Unrestricted render is unchanged (no restriction banner).
  const plain = renderFormatContextBlock(DEFAULT_PROFILE, {grade: "G4"});
  ok("unrestricted render has no restriction banner",
    !plain.includes("QUESTION-TYPE RESTRICTION"));
}

console.log(`assessmentQuestionTypes: ${passed} checks passed`);
