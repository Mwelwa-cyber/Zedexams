/**
 * Node test for the v3 assessment prompt + the schema's diagram and
 * passage fields. Supersedes assessmentPromptV2.test.js (v3 is the
 * active prompt; the schema is shared, so one test owns both).
 * Run: node functions/teacherTools/assessmentPromptV3.test.js
 */

const assert = require("node:assert");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./assessmentPromptV3");
const {validateAssessment, SCHEMA_VERSION} = require("./assessmentSchema");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentPromptV3");

// ── Prompt ────────────────────────────────────────────────────────────────
{
  ok("prompt version is assessment.v3", PROMPT_VERSION === "assessment.v3");
  ok("system prompt makes the format block authoritative",
    SYSTEM_PROMPT.includes("<assessment_format_context>") &&
    SYSTEM_PROMPT.includes("AUTHORITATIVE"));
  ok("system prompt has the diagram rule",
    SYSTEM_PROMPT.includes("\"diagram\"") &&
    SYSTEM_PROMPT.includes("printed beside it"));
  ok("system prompt demands ORIGINAL comprehension passages",
    SYSTEM_PROMPT.includes("ORIGINAL short passage") &&
    SYSTEM_PROMPT.includes("NEVER copy"));

  const prompt = buildUserPrompt({
    grade: "G5",
    subject: "english",
    topic: "Comprehension",
    totalMarks: 40,
    assessmentType: "end_of_term",
  });
  ok("user prompt JSON shape includes the diagram key",
    prompt.includes("\"diagram\": string|null"));
  ok("user prompt JSON shape includes the passage object",
    prompt.includes("\"passage\": {\"title\": string, \"text\": string} | null"));
  ok("user prompt names the assessment type",
    prompt.includes("- Assessment type: End-of-Term Test"));
}

// ── Schema ────────────────────────────────────────────────────────────────
function goodAssessment(sectionExtra = {}, questionExtra = {}) {
  return {
    header: {
      title: "G5 English — Comprehension Test",
      grade: "G5",
      subject: "English",
      topic: "Comprehension",
      durationMinutes: 40,
      totalMarks: 4,
      instructions: "Answer ALL questions.",
    },
    sections: [{
      title: "SECTION B: COMPREHENSION",
      instructions: "Read the story and answer the questions.",
      ...sectionExtra,
      questions: [
        {
          number: 1,
          type: "short_answer",
          prompt: "Why did Mutinta wake up early?",
          marks: 2,
          answer: "To help at the market.",
          markingGuide: "2 marks for the reason from the story.",
          ...questionExtra,
        },
        {
          number: 2,
          type: "short_answer",
          prompt: "Name the part labelled X.",
          marks: 2,
          answer: "stem",
          markingGuide: "2 marks.",
          diagram: "A bean plant with the stem labelled X.",
        },
      ],
    }],
    markingScheme: {notes: "Accept close paraphrases."},
  };
}

{
  ok("schema version bumped to 1.2", SCHEMA_VERSION === "1.2");

  const withPassage = validateAssessment(goodAssessment({
    passage: {title: "Warthog and Lion", text: "A warthog went into a cave to keep warm. ".repeat(4)},
  }));
  ok("assessment with a passage validates", withPassage.ok === true);
  ok("passage text and title are kept",
    withPassage.value.sections[0].passage.text.includes("warthog") &&
    withPassage.value.sections[0].passage.title === "Warthog and Lion");

  const noPassage = validateAssessment(goodAssessment());
  ok("section without a passage gets null", noPassage.value.sections[0].passage === null);

  for (const junk of [{passage: "a string"}, {passage: {title: "t"}}, {passage: {text: "  "}}, {passage: 7}]) {
    const res = validateAssessment(goodAssessment(junk));
    assert.strictEqual(res.value.sections[0].passage, null,
      `passage ${JSON.stringify(junk.passage)} should coerce to null`);
  }
  ok("garbage passages coerce to null", true);

  const long = validateAssessment(goodAssessment({
    passage: {title: "t", text: "x".repeat(9000)},
  }));
  assert.ok(long.value.sections[0].passage.text.length <= 6000);
  ok("over-long passages clamp to 6,000 chars", true);
}

// ── Diagram field (unchanged from v1.1 — regression coverage) ────────────
{
  const res = validateAssessment(goodAssessment());
  ok("valid diagram string is kept",
    res.value.sections[0].questions[1].diagram ===
    "A bean plant with the stem labelled X.");
  ok("question without a diagram gets null",
    res.value.sections[0].questions[0].diagram === null);

  const legacy = goodAssessment();
  for (const q of legacy.sections[0].questions) delete q.diagram;
  ok("legacy payloads without diagram keys still validate",
    validateAssessment(legacy).ok === true);

  const clamp = validateAssessment(goodAssessment({}, {diagram: "x".repeat(9000)}));
  assert.ok(clamp.value.sections[0].questions[0].diagram.length <= 500);
  ok("over-long diagram briefs clamp to 500 chars", true);
}

console.log(`assessmentPromptV3: ${passed} checks passed`);
