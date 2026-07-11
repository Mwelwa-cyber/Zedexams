/**
 * Node test for the v10 assessment prompt — the ACTIVE prompt wired into
 * generateAssessment. v10 folds the "Zambian Test Studio Intelligence Engine"
 * authoring spec into the v9 prompt: an internal planning blueprint before
 * writing, multiple-choice quality rules, marks-reflect-the-work allocation,
 * expanded per-subject behaviour (Maths recompute, English parts + formatting,
 * Science practicals, Social Studies sources, practical subjects never
 * MCQ-only), natural (not forced) Zambian context, and a validate-before-emit
 * self-check. The v9 interleaving/Bloom/language-ladder behaviour and the
 * v6-v8 carry-overs are re-checked.
 * Run: node functions/teacherTools/assessmentPromptV10.test.js
 */

const assert = require("node:assert");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./assessmentPromptV10");
const {SHAPE_LIBRARY} = require("./assessmentShapes");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentPromptV10");

// ── Version ────────────────────────────────────────────────────────────────
ok("prompt version is assessment.v10", PROMPT_VERSION === "assessment.v10");

// ── v10: planning blueprint before writing ──────────────────────────────────
ok("system prompt demands an internal blueprint before writing questions",
  SYSTEM_PROMPT.includes("PLAN BEFORE YOU WRITE") &&
  SYSTEM_PROMPT.includes("do not immediately write questions"));
ok("blueprint reconciles marks to the target before writing",
  SYSTEM_PROMPT.includes("sum EXACTLY to the requested total"));
ok("blueprint is internal working, never emitted",
  SYSTEM_PROMPT.includes("do NOT emit it"));

// ── v10: multiple-choice quality rules ──────────────────────────────────────
ok("system prompt has an MCQ quality section",
  SYSTEM_PROMPT.includes("MULTIPLE-CHOICE QUALITY"));
ok("MCQ rules demand one defensible key + plausible distractors",
  SYSTEM_PROMPT.includes("ONE clearly defensible correct answer") &&
  SYSTEM_PROMPT.includes("PLAUSIBLE distractors"));
ok("MCQ rules spread the key across the letters",
  SYSTEM_PROMPT.includes("SPREAD the correct answers across the option letters"));
ok("MCQ rules ration all/none-of-the-above and ban clue giveaways",
  SYSTEM_PROMPT.includes("all of the above") &&
  SYSTEM_PROMPT.includes("grammatical or length clues"));
ok("MCQ option count tracks the grade",
  SYSTEM_PROMPT.includes("grade-appropriate number of options"));

// ── v10: mark allocation reflects the work ──────────────────────────────────
ok("system prompt has a MARK ALLOCATION section",
  SYSTEM_PROMPT.includes("MARK ALLOCATION") &&
  SYSTEM_PROMPT.includes("marks must reflect the work required"));
ok("n asked points carry at least n marks",
  SYSTEM_PROMPT.includes("AT LEAST n marks") &&
  SYSTEM_PROMPT.includes("never ask for four items and award one mark"));
ok("calculations may split method/working, units and answer",
  SYSTEM_PROMPT.includes("method/working, units and the final answer"));

// ── v10: subject-specific behaviour ─────────────────────────────────────────
ok("system prompt expands SUBJECT-SPECIFIC BEHAVIOUR per subject",
  SYSTEM_PROMPT.includes("SUBJECT-SPECIFIC BEHAVIOUR") &&
  SYSTEM_PROMPT.includes("MATHEMATICS:") &&
  SYSTEM_PROMPT.includes("ENGLISH LANGUAGE:") &&
  SYSTEM_PROMPT.includes("SCIENCE:") &&
  SYSTEM_PROMPT.includes("SOCIAL STUDIES:"));
ok("maths answers are recomputed independently",
  SYSTEM_PROMPT.includes("CHECK EVERY CALCULATION"));
ok("English forbids all-bold text and answer-revealing formatting",
  SYSTEM_PROMPT.includes("Do NOT set the entire question text in bold") &&
  SYSTEM_PROMPT.includes("never let formatting accidentally reveal an answer"));
ok("English organises the paper into parts with their own instructions",
  SYSTEM_PROMPT.includes("each part with its OWN clear instruction"));
ok("comprehension must be answerable from the passage alone",
  SYSTEM_PROMPT.includes("answerable from the passage alone"));
ok("practical/creative subjects are never MCQ-only and get rubrics",
  SYSTEM_PROMPT.includes("PRACTICAL & CREATIVE SUBJECTS") &&
  SYSTEM_PROMPT.includes("never assess these with multiple-choice questions only") &&
  SYSTEM_PROMPT.includes("criterion-based marking guide"));

// ── v10: natural Zambian context ────────────────────────────────────────────
ok("Zambian context is used where natural, not on every question",
  SYSTEM_PROMPT.includes("ZAMBIAN CONTEXT") &&
  SYSTEM_PROMPT.includes("Do NOT make every question explicitly about Zambia"));

// ── v10: validate-before-emit self-check ────────────────────────────────────
ok("system prompt ends with a VALIDATE BEFORE YOU EMIT checklist",
  SYSTEM_PROMPT.includes("VALIDATE BEFORE YOU EMIT") &&
  SYSTEM_PROMPT.includes("FIX any failure before emitting"));
ok("self-check recalculates numerical answers",
  SYSTEM_PROMPT.includes("RECALCULATE every Mathematics and numerical Science answer"));
ok("self-check reconciles totals + numbering and blocks leaked answers",
  SYSTEM_PROMPT.includes("numbering is continuous") &&
  SYSTEM_PROMPT.includes("no answer leaks onto the question paper"));

// ── v10: marking guide covers alternatives + working ────────────────────────
ok("system prompt asks the marking scheme for acceptable alternatives",
  SYSTEM_PROMPT.includes("acceptable alternative answers"));
{
  const prompt = buildUserPrompt({
    grade: "G7", subject: "mathematics", topic: "Fractions",
    totalMarks: 40, assessmentType: "end_of_term",
  });
  ok("user prompt asks for an internal blueprint first",
    prompt.includes("Plan an internal blueprint first") &&
    prompt.includes("Do not output the blueprint."));
  ok("user prompt rules demand alternatives + expected working in the guide",
    prompt.includes("acceptable alternative answers") &&
    prompt.includes("expected working"));
  ok("user prompt rules demand marks reflect the work",
    prompt.includes("asking for n points"));
  ok("user prompt rules restate the MCQ quality bar",
    prompt.includes("one defensible key, plausible distractors") &&
    prompt.includes("spread the correct letters"));
}

// ── v9 carry-over: BALANCE / authentic-assessment system rules ──────────────
ok("system prompt tells the model to build a REAL test, not a worksheet",
  SYSTEM_PROMPT.includes("not a topic-by-topic worksheet"));
ok("system prompt demands topic interleaving (rotate, not cluster)",
  SYSTEM_PROMPT.includes("MIX THE TOPICS") &&
  SYSTEM_PROMPT.includes("ROTATE") &&
  SYSTEM_PROMPT.includes("NEVER put all the questions from one topic together"));
ok("interleaving exception: English-style papers group by named part",
  SYSTEM_PROMPT.includes("recognised paper format groups questions into named parts"));
ok("system prompt demands a Bloom's cognitive mix, not all recall",
  SYSTEM_PROMPT.includes("Bloom") &&
  SYSTEM_PROMPT.includes("NOT all recall"));
ok("system prompt forbids repeated questions",
  SYSTEM_PROMPT.includes("NO REPETITION") &&
  SYSTEM_PROMPT.includes("different command word"));

// ── v9 carry-over: multi-topic coverage plan + interleave rules ─────────────
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

// ── v9 carry-over: grade-aware language ladder ──────────────────────────────
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
ok("uploaded/format papers are style references, never copied",
  SYSTEM_PROMPT.includes("never a source of questions to reproduce"));
ok("clockface + protractor still advertised and allowlisted",
  Boolean(SHAPE_LIBRARY.clockface) && Boolean(SHAPE_LIBRARY.protractor) &&
  SYSTEM_PROMPT.includes("clockface") && SYSTEM_PROMPT.includes("protractor"));
ok("visuals must exist for every referenced figure (no empty placeholders)",
  SYSTEM_PROMPT.includes("no empty placeholders"));
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

// ── v9 carry-over: fill_blanks type support ─────────────────────────────────
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

console.log(`assessmentPromptV10: ${passed} checks passed`);
