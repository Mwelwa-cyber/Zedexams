/**
 * Node test for the v5 assessment prompt + the schema's visual, diagram,
 * passage and matching fields. One suite owns the ACTIVE prompt and the
 * shared schema.
 * Run: node functions/teacherTools/assessmentPromptV5.test.js
 */

const assert = require("node:assert");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./assessmentPromptV5");
const {validateAssessment, SCHEMA_VERSION} = require("./assessmentSchema");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentPromptV5");

// ── Prompt ────────────────────────────────────────────────────────────────
{
  ok("prompt version is assessment.v5", PROMPT_VERSION === "assessment.v5");
  ok("system prompt explains matching pairs",
    SYSTEM_PROMPT.includes("\"matching\"") &&
    SYSTEM_PROMPT.includes("Column A"));
  ok("system prompt makes the format block authoritative",
    SYSTEM_PROMPT.includes("<assessment_format_context>") &&
    SYSTEM_PROMPT.includes("AUTHORITATIVE"));
  ok("system prompt describes the three visual kinds",
    SYSTEM_PROMPT.includes("stem_figure") &&
    SYSTEM_PROMPT.includes("labelled_figure") &&
    SYSTEM_PROMPT.includes("option_images"));
  ok("system prompt forbids text inside the image",
    SYSTEM_PROMPT.includes("NEVER CONTAINS TEXT"));
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
  ok("user prompt JSON shape includes the visual object",
    prompt.includes("\"visual\":") &&
    prompt.includes("\"kind\": \"stem_figure\"|\"labelled_figure\"|\"option_images\""));
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
  ok("schema version bumped to 1.4", SCHEMA_VERSION === "1.4");

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

// ── Visual field (v1.4) ───────────────────────────────────────────────────
{
  // Legacy bare `diagram` string is kept AND normalised into a stem visual.
  const legacy = validateAssessment(goodAssessment());
  const q2 = legacy.value.sections[0].questions[1];
  ok("legacy diagram string is kept",
    q2.diagram === "A bean plant with the stem labelled X.");
  ok("legacy diagram normalises into a stem_figure visual",
    q2.visual && q2.visual.kind === "stem_figure" &&
    q2.visual.prompt === "A bean plant with the stem labelled X.");
  ok("question without any figure gets visual null",
    legacy.value.sections[0].questions[0].visual === null);

  // labelled_figure with labels + mode
  const labelled = validateAssessment(goodAssessment({}, {
    visual: {
      kind: "labelled_figure",
      mode: "identify",
      prompt: "a plastic-bottle water filter",
      labels: ["Dirty water", "Small stones", "Fine sand", "Cloth", "Clean water"],
    },
  }));
  const lv = labelled.value.sections[0].questions[0].visual;
  ok("labelled_figure keeps kind, mode and labels",
    lv.kind === "labelled_figure" && lv.mode === "identify" && lv.labels.length === 5);

  // option_images with per-option briefs
  const picOpts = validateAssessment(goodAssessment({}, {
    type: "multiple_choice",
    options: ["A", "B", "C", "D"],
    answer: "B",
    visual: {
      kind: "option_images",
      options: [
        {prompt: "a plastic wash basin"},
        {prompt: "a dial kitchen weighing scale"},
        {prompt: "a serving spoon"},
        {prompt: "a cooking saucepan"},
      ],
    },
  }));
  const pv = picOpts.value.sections[0].questions[0].visual;
  ok("option_images keeps four option briefs",
    pv.kind === "option_images" && pv.options.length === 4 &&
    pv.options[1].prompt === "a dial kitchen weighing scale");

  // Degradation: unknown kind / too few option images / clamps.
  const unknown = validateAssessment(goodAssessment({}, {
    visual: {kind: "hologram", prompt: "spinning 3D model"},
  }));
  ok("unknown visual kind with a prompt degrades to a stem_figure",
    unknown.value.sections[0].questions[0].visual.kind === "stem_figure");

  const tooFew = validateAssessment(goodAssessment({}, {
    visual: {kind: "option_images", prompt: "fallback", options: [{prompt: "only one"}]},
  }));
  ok("option_images with <2 options falls back to a stem_figure",
    tooFew.value.sections[0].questions[0].visual.kind === "stem_figure");

  const empty = validateAssessment(goodAssessment({}, {visual: {kind: "stem_figure"}}));
  ok("a visual with no usable prompt coerces to null",
    empty.value.sections[0].questions[0].visual === null);

  const clampLabels = validateAssessment(goodAssessment({}, {
    visual: {
      kind: "labelled_figure", prompt: "x",
      labels: Array.from({length: 20}, (_, i) => `label ${i}`),
    },
  }));
  assert.ok(clampLabels.value.sections[0].questions[0].visual.labels.length <= 8);
  ok("labelled_figure clamps to 8 labels", true);
}

// ── Diagram field (unchanged — regression coverage) ───────────────────────
{
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

console.log(`assessmentPromptV5: ${passed} checks passed`);
