/**
 * Node test for the v4 assessment prompt + the schema's diagram, passage
 * and matching fields. One suite owns the active prompt and the shared
 * schema.
 * Run: node functions/teacherTools/assessmentPromptV4.test.js
 */

const assert = require("node:assert");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./assessmentPromptV4");
const {validateAssessment, SCHEMA_VERSION} = require("./assessmentSchema");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentPromptV4");

// ── Prompt ────────────────────────────────────────────────────────────────
{
  ok("prompt version is assessment.v4", PROMPT_VERSION === "assessment.v4");
  ok("system prompt explains matching pairs",
    SYSTEM_PROMPT.includes("\"matching\"") &&
    SYSTEM_PROMPT.includes("Column A"));
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
  ok("user prompt JSON shape includes the matching fields",
    prompt.includes("\"left\": [string, ...]") &&
    prompt.includes("\"pairs\": [number, ...]"));
  ok("user prompt names the assessment type",
    prompt.includes("- Assessment type: End of Term Test"));
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
  ok("schema version bumped to 1.3", SCHEMA_VERSION === "1.3");

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

// ── Matching questions (v1.3) ─────────────────────────────────────────────
{
  const good = validateAssessment(goodAssessment({}, {
    type: "matching",
    left: ["cow", "dog", "hen"],
    right: ["calf", "puppy", "chick", "kid"],
    pairs: [0, 1, 2],
  }));
  const q = good.value.sections[0].questions[0];
  ok("valid matching question keeps its columns and pairs",
    q.type === "matching" &&
    q.matching.left.length === 3 &&
    q.matching.right.length === 4 &&
    q.matching.pairs.join(",") === "0,1,2");

  const badPairs = validateAssessment(goodAssessment({}, {
    type: "matching",
    left: ["a", "b"],
    right: ["x", "y"],
    pairs: [0, 9], // out of range
  }));
  const q2 = badPairs.value.sections[0].questions[0];
  ok("broken matching degrades to short_answer",
    q2.type === "short_answer" && q2.matching === null);

  const nonMatching = validateAssessment(goodAssessment());
  ok("non-matching questions carry matching: null",
    nonMatching.value.sections[0].questions[0].matching === null);
}

console.log(`assessmentPromptV4: ${passed} checks passed`);
