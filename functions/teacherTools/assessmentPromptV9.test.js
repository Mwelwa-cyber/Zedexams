/**
 * Node test for the v9 assessment prompt — the ACTIVE prompt wired into
 * generateAssessment. v9 makes the paper an authentic Zambian test rather than
 * a topic-by-topic worksheet: topic interleaving, a Bloom's cognitive mix,
 * grade-aware language, anti-repetition, subject conventions and a
 * deterministic per-topic coverage plan. The v8 numeracy-balance and
 * question-type-whitelist behaviour, and the v6/v7 carry-overs, are re-checked.
 * Run: node functions/teacherTools/assessmentPromptV9.test.js
 */

const assert = require("node:assert");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./assessmentPromptV9");
const {SHAPE_LIBRARY} = require("./assessmentShapes");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentPromptV9");

// ── Version ────────────────────────────────────────────────────────────────
ok("prompt version is assessment.v9", PROMPT_VERSION === "assessment.v9");

// ── v9: BALANCE / authentic-assessment system rules ─────────────────────────
ok("system prompt tells the model to build a REAL test, not a worksheet",
  SYSTEM_PROMPT.includes("not a topic-by-topic worksheet"));
ok("system prompt demands topic interleaving (rotate, not cluster)",
  SYSTEM_PROMPT.includes("MIX THE TOPICS") &&
  SYSTEM_PROMPT.includes("ROTATE") &&
  SYSTEM_PROMPT.includes("NEVER put all the questions from one topic together"));
ok("system prompt demands a Bloom's cognitive mix, not all recall",
  SYSTEM_PROMPT.includes("Bloom") &&
  SYSTEM_PROMPT.includes("NOT all recall"));
ok("system prompt forbids repeated questions",
  SYSTEM_PROMPT.includes("NO REPETITION") &&
  SYSTEM_PROMPT.includes("different command word"));
ok("system prompt gives per-subject conventions",
  SYSTEM_PROMPT.includes("SUBJECT CONVENTIONS") &&
  SYSTEM_PROMPT.includes("Mathematics") &&
  SYSTEM_PROMPT.includes("Social Studies"));

// ── v9: multi-topic coverage plan + interleave rules ────────────────────────
{
  const prompt = buildUserPrompt({
    grade: "G4",
    subject: "integrated_science",
    topic: "Human Body; Plants; Weather; Animals",
    totalMarks: 40,
    assessmentType: "end_of_term",
  });
  ok("multi-topic prompt prints a TOPIC COVERAGE PLAN",
    prompt.includes("TOPIC COVERAGE PLAN") &&
    prompt.includes("covers 4 topics"));
  ok("coverage plan names each topic",
    prompt.includes("Human Body") && prompt.includes("Weather") &&
    prompt.includes("Animals"));
  ok("coverage plan shows an interleaved rotation",
    prompt.includes("INTERLEAVE them like this"));
  ok("Rules section demands interleaving across topics",
    prompt.includes("INTERLEAVE the topics") &&
    prompt.includes("consecutive questions must come from"));
  ok("JSON contract asks for per-question topic + bloomLevel tags",
    prompt.includes("\"topic\": string") &&
    prompt.includes("\"bloomLevel\":"));
}

// A single topic → no coverage plan (nothing to interleave), but still tagged.
{
  const prompt = buildUserPrompt({
    grade: "G4",
    subject: "integrated_science",
    topic: "Human Body",
    totalMarks: 40,
    assessmentType: "topic_test",
  });
  ok("single-topic prompt omits the coverage plan",
    !prompt.includes("TOPIC COVERAGE PLAN"));
  ok("single-topic prompt still asks to tag the topic",
    prompt.includes("Tag every question with its \"topic\""));
}

// ── v9: grade-aware language ladder ─────────────────────────────────────────
{
  const g1 = buildUserPrompt({
    grade: "G1", subject: "integrated_science", topic: "The body",
    totalMarks: 20, assessmentType: "topic_test",
  });
  ok("Grade 1 prompt uses the lower-primary language rules",
    g1.includes("LANGUAGE LEVEL") && g1.includes("Lower Primary"));
  ok("Grade 1 prompt caps the Bloom ceiling at apply",
    g1.includes("do NOT go above \"apply\""));

  const g9 = buildUserPrompt({
    grade: "G9", subject: "integrated_science", topic: "The body",
    totalMarks: 40, assessmentType: "end_of_term",
  });
  ok("Grade 9 prompt uses the junior-secondary language rules",
    g9.includes("Junior Secondary"));
  ok("Grade 9 prompt raises the Bloom ceiling to evaluate",
    g9.includes("do NOT go above \"evaluate\""));
}

// ── v8 carry-over: integrated Numeracy balance ──────────────────────────────
{
  const prompt = buildUserPrompt({
    grade: "G1", subject: "numeracy", topic: "1.4 Exploring Materials",
    totalMarks: 40, assessmentType: "end_of_term",
  });
  ok("numeracy prompt still flags the INTEGRATED Maths & Science area",
    prompt.includes("INTEGRATED Maths & Science"));
  ok("numeracy prompt still requires both strands",
    /NUMBER & MATHS/.test(prompt) && /SCIENCE & ENVIRONMENT/.test(prompt));
}

// ── v7 carry-over: question-type whitelist ──────────────────────────────────
ok("system prompt keeps the QUESTION TYPES hard rule",
  SYSTEM_PROMPT.includes("QUESTION TYPES:") &&
  SYSTEM_PROMPT.includes("use ONLY those types"));
{
  const prompt = buildUserPrompt({
    grade: "G4", subject: "mathematics", topic: "Fractions",
    totalMarks: 40, assessmentType: "end_of_term",
    questionTypes: ["multiple_choice", "short_answer"],
  });
  ok("user prompt lists the allowed question types",
    prompt.includes("ALLOWED QUESTION TYPES") &&
    prompt.includes("multiple choice") &&
    prompt.includes("short answer"));
  ok("user prompt restates the hard rule in the Rules section",
    prompt.includes("Use ONLY the allowed question types listed above"));
}

// ── v6 carry-overs still present ────────────────────────────────────────────
ok("system prompt still has a MATHS NOTATION section",
  SYSTEM_PROMPT.includes("MATHS NOTATION") &&
  SYSTEM_PROMPT.includes("\\frac{a}{b}"));
ok("still documents exact maths figures (shape / shape_options)",
  SYSTEM_PROMPT.includes("EXACT MATHS FIGURES") &&
  SYSTEM_PROMPT.includes("parallelogramh"));
ok("still demands ORIGINAL comprehension passages",
  SYSTEM_PROMPT.includes("ORIGINAL short passage") &&
  SYSTEM_PROMPT.includes("NEVER copy"));
ok("clockface + protractor still advertised and allowlisted",
  Boolean(SHAPE_LIBRARY.clockface) && Boolean(SHAPE_LIBRARY.protractor) &&
  SYSTEM_PROMPT.includes("clockface") && SYSTEM_PROMPT.includes("protractor"));
{
  const prompt = buildUserPrompt({
    grade: "G7", subject: "mathematics", topic: "Fractions",
    totalMarks: 40, assessmentType: "end_of_term",
  });
  ok("user prompt JSON shape includes the visual object",
    prompt.includes("\"visual\":") &&
    prompt.includes("\"kind\": \"stem_figure\"|\"labelled_figure\"|\"option_images\""));
  ok("user prompt names the assessment type",
    prompt.includes("- Assessment type: End-of-Term Test"));
}

// ── v9: fill_blanks type support ────────────────────────────────────────────
ok("system prompt has fill-in-blanks authoring rules",
  SYSTEM_PROMPT.includes("Fill-in-blanks questions:") &&
  SYSTEM_PROMPT.includes("fill_blanks") &&
  SYSTEM_PROMPT.includes("____ (exactly four underscores)") &&
  SYSTEM_PROMPT.includes("1-2 extra distractor"));

ok("system prompt requires prose answer to survive degradation",
  SYSTEM_PROMPT.includes("prose \"answer\" field at the question level"));

// fill_blanks appears in the type union in the JSON schema contract.
{
  const prompt = buildUserPrompt({
    grade: "G4",
    subject: "english",
    topic: "Sentence structure",
    totalMarks: 20,
    assessmentType: "topic_test",
  });
  ok("JSON contract type union includes fill_blanks",
    prompt.includes("\"fill_blanks\""));
  ok("JSON contract lists statements and wordBank fields",
    prompt.includes("\"statements\"") && prompt.includes("\"wordBank\""));
}

// fill_blanks appears in the allowed-types user-prompt label.
{
  const prompt = buildUserPrompt({
    grade: "G4",
    subject: "english",
    topic: "Vocabulary",
    totalMarks: 20,
    assessmentType: "topic_test",
    questionTypes: ["fill_blanks"],
  });
  ok("fill_blanks label appears in the allowed-types list",
    prompt.includes("fill in the blanks"));
}

// short_answer no longer claims to cover fill-in-the-blank in QT_LABELS.
{
  const prompt = buildUserPrompt({
    grade: "G4",
    subject: "english",
    topic: "Grammar",
    totalMarks: 20,
    assessmentType: "topic_test",
    questionTypes: ["short_answer"],
  });
  ok("short_answer label no longer includes 'fill-in-the-blank'",
    !prompt.includes("fill-in-the-blank"));
}

console.log(`assessmentPromptV9: ${passed} checks passed`);
