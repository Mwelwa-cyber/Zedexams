/**
 * assessmentToolSchema tests — the contract, not the prose (§3.2).
 *
 * The bug this schema exists to prevent: the generator ASKED for each item's topic,
 * thinking level, difficulty and outcome in prose, got a paper without them, and
 * saved it. The analysis panel then reported "no cognitive levels tagged yet" —
 * about a paper the studio had itself just generated.
 *
 * So what is worth testing is exactly which fields are REQUIRED, and that the
 * vocabularies match the validator's. A schema whose enums disagreed with
 * assessmentSchema.js would force the model to emit values the paper then rejects.
 *
 * Run: node functions/teacherTools/assessmentToolSchema.test.js
 */

const assert = require("node:assert");
const {
  ASSESSMENT_TOOL_SCHEMA, QUESTION_SCHEMA, SECTION_SCHEMA, HEADER_SCHEMA,
  RENDER_TYPES, BLOOM_LEVELS, DIFFICULTY_TIERS,
} = require("./assessmentToolSchema");
const {validateAssessment} = require("./assessmentSchema");
const {DIFFICULTY_TIERS: BAND_TIERS} = require("./assessmentBandsCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

/* ── the paper is a paper, not an open object ────────────────────────────── */

console.log("\n— the shape of a paper —");
ok("a header and at least one section are required",
    ASSESSMENT_TOOL_SCHEMA.required.includes("header") &&
    ASSESSMENT_TOOL_SCHEMA.required.includes("sections"));
ok("a paper with no sections cannot be emitted",
    ASSESSMENT_TOOL_SCHEMA.properties.sections.minItems === 1);
ok("a section with no questions cannot be emitted",
    SECTION_SCHEMA.required.includes("questions") &&
    SECTION_SCHEMA.properties.questions.minItems === 1);
ok("the header must state the total the questions add up to",
    HEADER_SCHEMA.required.includes("totalMarks") &&
    /questions must agree/.test(HEADER_SCHEMA.properties.totalMarks.description));

/* ── the metadata is required, not requested ─────────────────────────────── */

console.log("\n— every item says what it assesses —");
for (const field of [
  "type", "prompt", "marks", "answer", "markingGuide",
  "topic", "bloomLevel", "difficulty", "activityType", "learningOutcome",
]) {
  ok(`"${field}" is required on every question`,
      QUESTION_SCHEMA.required.includes(field));
}
ok("marks must be a whole number of at least 1 — a 0-mark question is not a question",
    QUESTION_SCHEMA.properties.marks.type === "integer" &&
    QUESTION_SCHEMA.properties.marks.minimum === 1);
ok("distractor rationale is NOT required — only choice questions have distractors",
    !QUESTION_SCHEMA.required.includes("distractorRationale") &&
    Boolean(QUESTION_SCHEMA.properties.distractorRationale));
ok("marking points are offered but not forced",
    !QUESTION_SCHEMA.required.includes("markingPoints") &&
    Boolean(QUESTION_SCHEMA.properties.markingPoints));

/* ── the vocabularies match the validator's ──────────────────────────────── */

console.log("\n— the model is asked for values the paper accepts —");
{
  // Every render type the schema offers must survive validateAssessment as
  // itself. If one did not, the model would be told to emit a type the paper
  // silently rewrites.
  for (const type of RENDER_TYPES) {
    const question = {
      number: 1, type, prompt: "A question.", marks: 2,
      answer: "An answer.", markingGuide: "A guide.",
      topic: "Fractions", bloomLevel: "understand", difficulty: "understanding",
      activityType: type, learningOutcome: "",
      // The two types with structural requirements of their own; a malformed one
      // degrades to short_answer, which is exactly what we are checking against.
      ...(type === "multiple_choice" || type === "true_false" ?
        {options: ["A", "B", "C", "D"]} : {}),
      ...(type === "matching" ? {
        left: ["a", "b"], right: ["1", "2"], pairs: [0, 1],
      } : {}),
      ...(type === "fill_blanks" ? {
        statements: [{text: "The capital is ____."}], wordBank: ["Lusaka"],
      } : {}),
    };
    const result = validateAssessment({
      header: {title: "T", totalMarks: 2},
      sections: [{title: "A", questions: [question]}],
    });
    const emitted = result.value.sections[0].questions[0];
    ok(`"${type}" survives validation as itself`, emitted.type === type);
  }
}
ok("the difficulty tiers are the band registry's own four, not a second list",
    DIFFICULTY_TIERS.length === BAND_TIERS.length &&
    DIFFICULTY_TIERS.every((t) => BAND_TIERS.includes(t)));
ok("the Bloom levels use the generator's British spelling",
    BLOOM_LEVELS.includes("analyse") && !BLOOM_LEVELS.includes("analyze"));
{
  // …and that spelling must reach the paper intact, or the drift panel compares
  // "analyse" against "analyze" and reports every question as untagged.
  const result = validateAssessment({
    header: {title: "T", totalMarks: 2},
    sections: [{title: "A", questions: [{
      number: 1, type: "short_answer", prompt: "Q", marks: 2,
      answer: "A", markingGuide: "G", topic: "T",
      bloomLevel: "analyse", difficulty: "analysis",
      activityType: "short_answer", learningOutcome: "",
    }]}],
  });
  ok("…and a question tagged \"analyse\" keeps a recognised Bloom level",
      Boolean(result.value.sections[0].questions[0].bloomLevel));
}

/* ── what is deliberately left open ──────────────────────────────────────── */

console.log("\n— what the schema deliberately does not police —");
ok("a question may carry the extra fields its own type needs",
    QUESTION_SCHEMA.additionalProperties === true);
ok("…so a matching question's columns are not rejected at the boundary",
    (() => {
      const r = validateAssessment({
        header: {title: "T", totalMarks: 2},
        sections: [{title: "A", questions: [{
          number: 1, type: "matching", prompt: "Match them.", marks: 2,
          answer: "a-1", markingGuide: "G", topic: "T",
          bloomLevel: "understand", difficulty: "understanding",
          activityType: "matching", learningOutcome: "",
          left: ["a", "b"], right: ["1", "2"], pairs: [0, 1],
        }]}],
      });
      return r.value.sections[0].questions[0].matching !== null;
    })());
ok("every field carries a description, so the contract explains itself",
    Object.values(QUESTION_SCHEMA.properties)
        .every((p) => typeof p.description === "string" && p.description.length > 0));

console.log(`\n${passed} passed`);
