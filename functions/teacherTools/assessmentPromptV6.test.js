/**
 * Node test for the v6 assessment prompt — the ACTIVE prompt wired into
 * generateAssessment. v6 adds the MATHS NOTATION section (fractions as
 * \frac{a}{b}, inline $…$, column arithmetic via [[vmath …]]) and surfaces the
 * clockface + protractor library figures. The shared schema (assessmentSchema
 * v1.4) keeps its dedicated coverage in assessmentPromptV5.test.js.
 * Run: node functions/teacherTools/assessmentPromptV6.test.js
 */

const assert = require("node:assert");
const {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt} =
  require("./assessmentPromptV6");
const {SHAPE_LIBRARY} = require("./assessmentShapes");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentPromptV6");

// ── Version ────────────────────────────────────────────────────────────────
ok("prompt version is assessment.v6", PROMPT_VERSION === "assessment.v6");

// ── Maths notation (the v6 addition) ────────────────────────────────────────
ok("system prompt has a MATHS NOTATION section",
  SYSTEM_PROMPT.includes("MATHS NOTATION"));
ok("system prompt pins fractions to \\frac{a}{b} and bans plain 1/3",
  SYSTEM_PROMPT.includes("\\frac{a}{b}") &&
  SYSTEM_PROMPT.includes("NEVER write a fraction as"));
ok("system prompt documents inline $…$ math",
  SYSTEM_PROMPT.includes("$\\sqrt{49}$") || SYSTEM_PROMPT.includes("$x^{2}$"));
ok("system prompt documents the column-arithmetic vmath token",
  SYSTEM_PROMPT.includes("[[vmath"));
ok("system prompt tells the model to use the notation inside options too",
  SYSTEM_PROMPT.includes("\\frac{3}{15}"));

// ── Carried-over v5 behaviour still present ─────────────────────────────────
ok("still describes the three drawn-visual kinds",
  SYSTEM_PROMPT.includes("stem_figure") &&
  SYSTEM_PROMPT.includes("labelled_figure") &&
  SYSTEM_PROMPT.includes("option_images"));
ok("still documents exact maths figures (shape / shape_options)",
  SYSTEM_PROMPT.includes("EXACT MATHS FIGURES") &&
  SYSTEM_PROMPT.includes("shape_options") &&
  SYSTEM_PROMPT.includes("parallelogramh"));
ok("still demands ORIGINAL comprehension passages",
  SYSTEM_PROMPT.includes("ORIGINAL short passage") &&
  SYSTEM_PROMPT.includes("NEVER copy"));
ok("still explains matching pairs",
  SYSTEM_PROMPT.includes("\"matching\"") && SYSTEM_PROMPT.includes("Column A"));

// ── New library figures are advertised + allowlisted ────────────────────────
ok("clockface + protractor are in the shape allowlist",
  Boolean(SHAPE_LIBRARY.clockface) && Boolean(SHAPE_LIBRARY.protractor));
ok("system prompt surfaces the clockface + protractor keys",
  SYSTEM_PROMPT.includes("clockface") && SYSTEM_PROMPT.includes("protractor"));

// ── User prompt ─────────────────────────────────────────────────────────────
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
    prompt.includes("- Assessment type: End of Term Test"));
}

console.log(`assessmentPromptV6: ${passed} checks passed`);
