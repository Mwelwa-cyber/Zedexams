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

  // fill_in_the_blank and its variants map to the dedicated fill_blanks type
  // (v1.6 — previously mapped to short_answer; each now has its own type).
  assert.deepStrictEqual(
    normalizeQuestionTypes(["multiple_choice", "fill_in_the_blank"]),
    ["multiple_choice", "fill_blanks"]);
  ok("fill_in_the_blank maps to fill_blanks", true);

  // short_answer + fill_in_the_blank are now DIFFERENT canonical types.
  assert.deepStrictEqual(
    normalizeQuestionTypes(["short_answer", "fill_in_the_blank"]),
    ["short_answer", "fill_blanks"]);
  ok("short_answer and fill_in_the_blank are distinct types (no dedup)", true);

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

// ── fill_blanks is now a first-class canonical type (v1.6) ─────────────────
{
  // fill_blanks passes through normalizeQuestionTypes unchanged.
  assert.deepStrictEqual(
    normalizeQuestionTypes(["fill_blanks"]), ["fill_blanks"]);
  ok("fill_blanks passes through as canonical", true);

  // A fill_blanks-only selection → a single fallback section (no seed section
  // declares fill_blanks) that carries exactly the allowed type.
  const fillOnly = filterProfileToTypes(DEFAULT_PROFILE, ["fill_blanks"]);
  ok("fill_blanks-only collapses to one allowed-only section",
    fillOnly.paperStructure.length === 1 &&
    fillOnly.paperStructure[0].marksShare === 100 &&
    fillOnly.paperStructure[0].questionTypes.length === 1 &&
    fillOnly.paperStructure[0].questionTypes[0] === "fill_blanks");

  // The rendered block names the fill_blanks label.
  const block = renderFormatContextBlock(DEFAULT_PROFILE,
    {grade: "G4", allowedTypes: ["fill_blanks"]});
  ok("rendered block names the fill_blanks label",
    block.includes("Fill in the Blanks"));
}

console.log(`assessmentQuestionTypes: ${passed} checks passed`);
