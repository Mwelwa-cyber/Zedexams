/**
 * Tests for the pure reviseLessonSection input/prompt/output logic.
 *
 * Run: node functions/teacherTools/reviseLessonSection.test.js
 */

const assert = require("node:assert");
const {
  coerceCurrent,
  sanitizeInputs,
  validateInputs,
  buildUserPrompt,
  toolInputSchema,
  normalizeOutput,
  MAX_LIST_ITEMS,
} = require("./reviseLessonSectionLogic");

let passed = 0;
function ok(label, cond) {
  assert.ok(cond, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log("coerceCurrent — list vs text shaping");
{
  ok("list from array trims + drops empties",
    JSON.stringify(coerceCurrent([" a ", "", "b"], "list")) === JSON.stringify(["a", "b"]));
  ok("list from newline string splits",
    JSON.stringify(coerceCurrent("a\nb\n\nc", "list")) === JSON.stringify(["a", "b", "c"]));
  ok("list from semicolon string splits",
    JSON.stringify(coerceCurrent("a; b; c", "list")) === JSON.stringify(["a", "b", "c"]));
  ok("list capped at MAX_LIST_ITEMS",
    coerceCurrent(Array.from({length: 30}, (_, i) => `i${i}`), "list").length === MAX_LIST_ITEMS);
  ok("text from array joins on newline",
    coerceCurrent(["one", "two"], "text") === "one\ntwo");
  ok("text from string trims", coerceCurrent("  hello  ", "text") === "hello");
}

console.log("\nsanitizeInputs — field cleaning + defaults");
{
  const inp = sanitizeInputs({
    sectionLabel: "  Rationale  ",
    kind: "TEXT",
    curriculumMode: "PREVIOUS",
    current: "This lesson...",
    modifier: "Simpler",
    instruction: "  mention local markets ",
    context: {grade: "Grade 4", subject: "Science", topic: "Water", subtopic: "The water cycle"},
  });
  ok("sectionLabel trimmed", inp.sectionLabel === "Rationale");
  ok("kind lower-cased + validated", inp.kind === "text");
  ok("curriculumMode lower-cased + validated", inp.curriculumMode === "previous");
  ok("modifier lower-cased + validated", inp.modifier === "simpler");
  ok("instruction trimmed", inp.instruction === "mention local markets");
  ok("context carried through", inp.context.subtopic === "The water cycle");
}
{
  const inp = sanitizeInputs({sectionLabel: "x", kind: "bogus", curriculumMode: "nope", modifier: "lol"});
  ok("unknown kind falls back to text", inp.kind === "text");
  // No default: an unknown/missing mode becomes "" so the transformation gate
  // fails closed rather than silently treating a 2013 section as CBC.
  ok("unknown mode → '' (fail-closed downstream)", inp.curriculumMode === "");
  ok("unknown modifier becomes null", inp.modifier === null);
}

console.log("\nvalidateInputs — guards");
{
  ok("needs a modifier or instruction",
    validateInputs(sanitizeInputs({sectionLabel: "Goal", kind: "text", current: "hi"})).length > 0);
  ok("polish on empty content is rejected",
    validateInputs(sanitizeInputs({sectionLabel: "Goal", kind: "text", current: "", modifier: "polish"})).length > 0);
  ok("rewrite on empty content is allowed",
    validateInputs(sanitizeInputs({sectionLabel: "Goal", kind: "text", current: "", modifier: "rewrite"})).length === 0);
  ok("free-text instruction alone is allowed",
    validateInputs(sanitizeInputs({sectionLabel: "Goal", kind: "text", current: "hi", instruction: "make it about farming"})).length === 0);
  ok("missing section label rejected",
    validateInputs(sanitizeInputs({kind: "text", current: "hi", modifier: "polish"})).length > 0);
}

console.log("\nbuildUserPrompt — content + terminology");
{
  const prompt = buildUserPrompt(sanitizeInputs({
    sectionLabel: "INTRODUCTION — Teacher's Activities",
    kind: "list",
    curriculumMode: "cbc",
    current: ["Greet the class", "Ask a question"],
    modifier: "detailed",
    context: {grade: "Grade 5", subject: "Mathematics", topic: "Fractions"},
  }));
  ok("includes section label", prompt.includes("INTRODUCTION — Teacher's Activities"));
  ok("uses learners for CBC", prompt.includes("\"learners\""));
  ok("includes a LIST instruction", prompt.includes("This section is a LIST"));
  ok("includes current items numbered", prompt.includes("1. Greet the class"));
  ok("includes the modifier guidance", /more thorough/.test(prompt));
}
{
  const prompt = buildUserPrompt(sanitizeInputs({
    sectionLabel: "Conclusion — Pupils' Activities",
    kind: "list",
    curriculumMode: "previous",
    current: [],
    modifier: "rewrite",
  }));
  ok("uses pupils for previous curriculum", prompt.includes("\"pupils\""));
  ok("empty list prompts a draft-from-context note", prompt.includes("(empty"));
}

console.log("\ntoolInputSchema — shape by kind");
{
  ok("list schema requires items", toolInputSchema("list").required[0] === "items");
  ok("text schema requires text", toolInputSchema("text").required[0] === "text");
}

console.log("\nnormalizeOutput — tolerant shaping");
{
  const list = normalizeOutput({items: ["1. Do this", "- and that", ""]}, "list");
  ok("strips numbering/bullets from list items",
    JSON.stringify(list.items) === JSON.stringify(["Do this", "and that"]));
  const listFromText = normalizeOutput({text: "a\nb\nc"}, "list");
  ok("list tolerates prose reply", JSON.stringify(listFromText.items) === JSON.stringify(["a", "b", "c"]));
  const text = normalizeOutput({text: "  Hello world  "}, "text");
  ok("text trims", text.text === "Hello world");
  const textFromItems = normalizeOutput({items: ["one", "two"]}, "text");
  ok("text tolerates items reply", textFromItems.text === "one two");
  ok("list cap honoured in output",
    normalizeOutput({items: Array.from({length: 30}, (_, i) => `x${i}`)}, "list").items.length === MAX_LIST_ITEMS);
}

console.log(`\n✅ reviseLessonSection logic — ${passed} assertions passed`);
