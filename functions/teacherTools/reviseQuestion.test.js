/**
 * Tests for the pure reviseQuestion input/prompt logic — including the new
 * "polish" modifier (grammar/clarity, same grade & difficulty) and the
 * regression that question text must NOT be stripped of its spaces.
 *
 * Run: node functions/teacherTools/reviseQuestion.test.js
 */

const assert = require("node:assert");
const {
  sanitizeInputs,
  validateInputs,
  buildUserPrompt,
  stripPreamble,
  ALLOWED_MODIFIERS,
} = require("./reviseQuestionLogic");

let passed = 0;
function ok(label, cond) {
  assert.ok(cond, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log("sanitizeInputs — text keeps its spaces (regression)");
{
  const inp = sanitizeInputs({text: "Define the term photosynthesis."});
  ok("internal spaces preserved", inp.text === "Define the term photosynthesis.");
}

console.log("\nsanitizeInputs — field cleaning");
{
  const inp = sanitizeInputs({
    text: "What is 2 + 2?",
    fromGrade: "g7", toGrade: "G 4",
    subject: "Integrated Science",
    modifier: "polish",
  });
  ok("fromGrade upper-cased + validated", inp.fromGrade === "G7");
  ok("toGrade strips its own spaces", inp.toGrade === "G4");
  ok("subject → snake_case keyword", inp.subject === "integrated_science");
  ok("polish modifier accepted", inp.modifier === "polish");
  ok("language defaults to english", inp.language === "english");
}

console.log("\nsanitizeInputs — modifier whitelist");
{
  ok("polish is allowed", ALLOWED_MODIFIERS.has("polish"));
  ok("easier/harder/simpler still allowed", ["easier", "harder", "simpler"].every((m) => ALLOWED_MODIFIERS.has(m)));
  ok("unknown modifier rejected → null", sanitizeInputs({text: "x", modifier: "spicy"}).modifier === null);
}

console.log("\nvalidateInputs");
{
  ok("polish-only (no grade) is valid", validateInputs(sanitizeInputs({text: "x", modifier: "polish"})).length === 0);
  ok("no grade + no modifier is invalid", validateInputs(sanitizeInputs({text: "x"})).length > 0);
  ok("empty text is invalid", validateInputs(sanitizeInputs({text: "", modifier: "polish"})).length > 0);
}

console.log("\nbuildUserPrompt — polish instruction");
{
  const prompt = buildUserPrompt(sanitizeInputs({text: "Wat is teh capitol of Zambia", modifier: "polish"}));
  ok("includes the POLISH ONLY directive", /POLISH ONLY/.test(prompt));
  ok("tells the model not to change difficulty", /Do NOT make it easier or/.test(prompt));
  ok("carries the original text verbatim", prompt.includes("Wat is teh capitol of Zambia"));
}

console.log("\nsanitizeInputs — carries the source curriculum (transformation preserves it)");
{
  const inp = sanitizeInputs({text: "x", modifier: "polish", curriculum: "Previous", subject: "history"});
  ok("curriculum lower-cased + carried", inp.curriculum === "previous");
  ok("subject carried", inp.subject === "history");
}

console.log("\nstripPreamble");
{
  ok("strips a 'Rewritten question:' preamble", stripPreamble("Rewritten question: What is 5 + 3?") === "What is 5 + 3?");
  ok("strips wrapping quotes", stripPreamble("\"Name two organs.\"") === "Name two organs.");
  ok("leaves a clean answer untouched", stripPreamble("Name two organs.") === "Name two organs.");
}

console.log(`\nAll reviseQuestion logic tests passed (${passed} assertions).`);
