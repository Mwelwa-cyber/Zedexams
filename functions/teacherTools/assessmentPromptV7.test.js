/**
 * Node test for the v7 assessment prompt — the ACTIVE prompt wired into
 * generateAssessment. v7 makes the teacher's chosen question types a HARD rule
 * that overrides the <assessment_format_context> block, fixing the bug where a
 * "Multiple choice + Fill in the blank" paper still came back with short-answer
 * and structured questions. Everything else carries over from v6.
 * Run: node functions/teacherTools/assessmentPromptV7.test.js
 */

const assert = require("node:assert");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./assessmentPromptV7");
const {SHAPE_LIBRARY} = require("./assessmentShapes");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentPromptV7");

// ── Version ────────────────────────────────────────────────────────────────
ok("prompt version is assessment.v7", PROMPT_VERSION === "assessment.v7");

// ── Question-type whitelist (the v7 addition) ───────────────────────────────
ok("system prompt has a QUESTION TYPES hard rule",
  SYSTEM_PROMPT.includes("QUESTION TYPES:") &&
  SYSTEM_PROMPT.includes("use ONLY those types"));
ok("system prompt says the whitelist overrides the format block",
  SYSTEM_PROMPT.toLowerCase().includes("overrides the format"));
ok("system prompt's format bullet carries the override exception",
  SYSTEM_PROMPT.includes("EXCEPTION") &&
  SYSTEM_PROMPT.includes("whitelist OVERRIDES the format"));

{
  // With a restricted type list the user prompt names exactly those types and
  // tells the model to use no others.
  const prompt = buildUserPrompt({
    grade: "G4",
    subject: "mathematics",
    topic: "Fractions",
    totalMarks: 40,
    assessmentType: "end_of_term",
    questionTypes: ["multiple_choice", "short_answer"],
  });
  ok("user prompt lists the allowed question types",
    prompt.includes("ALLOWED QUESTION TYPES") &&
    prompt.includes("multiple choice") &&
    prompt.includes("short answer / fill-in-the-blank"));
  ok("user prompt does NOT mention disallowed types as allowed",
    !prompt.includes("structured (multi-part)") &&
    !prompt.includes("essay / composition"));
  ok("user prompt restates the hard rule in the Rules section",
    prompt.includes("Use ONLY the allowed question types listed above"));
}

{
  // Unknown / empty type lists are a no-op: no whitelist line, default flow.
  const prompt = buildUserPrompt({
    grade: "G4",
    subject: "mathematics",
    topic: "Fractions",
    totalMarks: 40,
    assessmentType: "end_of_term",
    questionTypes: [],
  });
  ok("no whitelist line when no types are restricted",
    !prompt.includes("ALLOWED QUESTION TYPES"));
}

// ── Carried-over v6 behaviour still present ─────────────────────────────────
ok("system prompt still has a MATHS NOTATION section",
  SYSTEM_PROMPT.includes("MATHS NOTATION") &&
  SYSTEM_PROMPT.includes("\\frac{a}{b}"));
ok("still describes the drawn-visual kinds",
  SYSTEM_PROMPT.includes("stem_figure") &&
  SYSTEM_PROMPT.includes("labelled_figure") &&
  SYSTEM_PROMPT.includes("option_images"));
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
    grade: "G7",
    subject: "mathematics",
    topic: "Fractions",
    totalMarks: 40,
    assessmentType: "end_of_term",
  });
  ok("user prompt JSON shape includes the visual object",
    prompt.includes("\"visual\":") &&
    prompt.includes("\"kind\": \"stem_figure\"|\"labelled_figure\"|\"option_images\""));
  ok("user prompt reminds the model to write \\frac fractions",
    prompt.includes("\\frac{a}{b}"));
  ok("user prompt names the assessment type",
    prompt.includes("- Assessment type: End-of-Term Test"));
}

console.log(`assessmentPromptV7: ${passed} checks passed`);
