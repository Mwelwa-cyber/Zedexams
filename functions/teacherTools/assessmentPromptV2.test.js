/**
 * Node test for the v2 assessment prompt + the schema's new diagram field.
 * Run: node functions/teacherTools/assessmentPromptV2.test.js
 */

const assert = require("node:assert");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./assessmentPromptV2");
const {validateAssessment, SCHEMA_VERSION} = require("./assessmentSchema");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentPromptV2");

// ── Prompt ────────────────────────────────────────────────────────────────
{
  ok("prompt version is assessment.v2", PROMPT_VERSION === "assessment.v2");
  ok("system prompt makes the format block authoritative",
    SYSTEM_PROMPT.includes("<assessment_format_context>") &&
    SYSTEM_PROMPT.includes("AUTHORITATIVE"));
  ok("system prompt has the diagram rule",
    SYSTEM_PROMPT.includes("\"diagram\"") &&
    SYSTEM_PROMPT.includes("printed beside it"));

  const prompt = buildUserPrompt({
    grade: "G5",
    subject: "mathematics",
    topic: "Fractions",
    totalMarks: 40,
    assessmentType: "end_of_term",
  });
  ok("user prompt JSON shape includes the diagram key",
    prompt.includes("\"diagram\": string|null"));
  ok("user prompt names the assessment type",
    prompt.includes("- Assessment type: End of Term Test"));

  const fallback = buildUserPrompt({
    grade: "G5", subject: "mathematics", topic: "Fractions",
    assessmentType: "nonsense",
  });
  ok("unknown assessmentType labels as Topic Test",
    fallback.includes("- Assessment type: Topic Test"));
}

// ── Schema: diagram field ─────────────────────────────────────────────────
function goodAssessment(extra = {}) {
  return {
    header: {
      title: "G5 Mathematics — Fractions Test",
      grade: "G5",
      subject: "Mathematics",
      topic: "Fractions",
      durationMinutes: 40,
      totalMarks: 4,
      instructions: "Answer ALL questions.",
    },
    sections: [{
      title: "SECTION A",
      instructions: "Answer all questions.",
      questions: [
        {
          number: 1,
          type: "calculation",
          prompt: "Work out 1/2 + 1/4.",
          marks: 2,
          answer: "3/4",
          markingGuide: "1 mark method, 1 mark answer.",
          ...extra,
        },
        {
          number: 2,
          type: "short_answer",
          prompt: "Name the fraction shaded in the diagram.",
          marks: 2,
          answer: "2/5",
          markingGuide: "2 marks for the correct fraction.",
          diagram: "A rectangle split into 5 equal parts with 2 shaded.",
        },
      ],
    }],
    markingScheme: {notes: "Accept equivalent fractions."},
  };
}

{
  ok("schema version bumped to 1.1", SCHEMA_VERSION === "1.1");

  const res = validateAssessment(goodAssessment());
  ok("assessment with a diagram validates", res.ok === true);
  ok("valid diagram string is kept",
    res.value.sections[0].questions[1].diagram ===
    "A rectangle split into 5 equal parts with 2 shaded.");
  ok("question without a diagram gets null",
    res.value.sections[0].questions[0].diagram === null);
}

{
  // v1-era payloads (no diagram key anywhere) still validate.
  const legacy = goodAssessment();
  for (const q of legacy.sections[0].questions) delete q.diagram;
  const res = validateAssessment(legacy);
  ok("legacy payload without diagram keys still validates", res.ok === true);
  ok("legacy questions coerce diagram to null",
    res.value.sections[0].questions.every((q) => q.diagram === null));
}

{
  // Garbage diagram values coerce to null / clamp, never throw.
  const cases = [
    {diagram: {sneaky: "object"}},
    {diagram: 42},
    {diagram: ""},
    {diagram: "   "},
  ];
  for (const extra of cases) {
    const res = validateAssessment(goodAssessment(extra));
    assert.strictEqual(res.value.sections[0].questions[0].diagram, null,
      `diagram ${JSON.stringify(extra.diagram)} should coerce to null`);
  }
  ok("non-string diagram values coerce to null", true);

  const long = validateAssessment(goodAssessment({diagram: "x".repeat(9000)}));
  assert.ok(long.value.sections[0].questions[0].diagram.length <= 500);
  ok("over-long diagram briefs clamp to 500 chars", true);
}

console.log(`assessmentPromptV2: ${passed} checks passed`);
