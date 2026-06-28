/**
 * Unit tests for questionTyping.js — the scanned-import question-typing layer.
 * Plain `node` assertions, no network.
 *
 * Run: node functions/teacherTools/testPaperImport/questionTyping.test.js
 */

const assert = require("assert");
const {
  ALLOWED_TYPES,
  normaliseQuestionType,
  classifyQuestionType,
  looksTrueFalse,
  resolveQuestionType,
  extractMarks,
} = require("./questionTyping");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("questionTyping");

test("ALLOWED_TYPES is the small studio-mappable set", () => {
  assert.deepStrictEqual(ALLOWED_TYPES, [
    "mcq", "true_false", "fill_blank", "matching", "short_answer", "diagram_label",
  ]);
});

// ─── normaliseQuestionType ──────────────────────────────────────────────────
test("normaliseQuestionType folds aliases and rejects junk", () => {
  assert.strictEqual(normaliseQuestionType("multiple_choice"), "mcq");
  assert.strictEqual(normaliseQuestionType("True/False"), "true_false");
  assert.strictEqual(normaliseQuestionType("fill-in-the-blank"), "fill_blank");
  assert.strictEqual(normaliseQuestionType("structured"), "short_answer");
  assert.strictEqual(normaliseQuestionType("matching"), "matching");
  assert.strictEqual(normaliseQuestionType("label the diagram"), "diagram_label");
  assert.strictEqual(normaliseQuestionType("labelled-diagram"), "diagram_label");
  assert.strictEqual(normaliseQuestionType("nonsense"), "");
  assert.strictEqual(normaliseQuestionType(""), "");
});

// ─── classifyQuestionType ───────────────────────────────────────────────────
test("looksTrueFalse detects T/F option pairs", () => {
  assert.strictEqual(looksTrueFalse(["True", "False"]), true);
  assert.strictEqual(looksTrueFalse(["Yes", "No"]), true);
  assert.strictEqual(looksTrueFalse(["a", "b", "c"]), false);
});

test("classifyQuestionType: two+ options → mcq", () => {
  assert.strictEqual(classifyQuestionType({prompt: "Pick one", options: ["a", "b", "c", "d"]}), "mcq");
});

test("classifyQuestionType: true/false options → true_false", () => {
  assert.strictEqual(classifyQuestionType({prompt: "The sun is a star.", options: ["True", "False"]}), "true_false");
});

test("classifyQuestionType: pictorial options → mcq", () => {
  assert.strictEqual(classifyQuestionType({prompt: "Which net?", options: ["", ""], optionsAreImages: true}), "mcq");
});

test("classifyQuestionType: blanks in stem → fill_blank", () => {
  assert.strictEqual(classifyQuestionType({prompt: "Water boils at ____ degrees.", options: []}), "fill_blank");
  assert.strictEqual(classifyQuestionType({prompt: "The capital is ▭.", options: []}), "fill_blank");
});

test("classifyQuestionType: matching cue → matching", () => {
  assert.strictEqual(classifyQuestionType({prompt: "Match the following animals to their homes.", options: []}), "matching");
  assert.strictEqual(classifyQuestionType({prompt: "Column A and Column B", options: []}), "matching");
});

test("classifyQuestionType: label-the-diagram cue WITH a figure → diagram_label", () => {
  assert.strictEqual(
    classifyQuestionType({prompt: "Label the parts of the plant.", options: [], hasDiagram: true}),
    "diagram_label",
  );
  assert.strictEqual(
    classifyQuestionType({prompt: "Name the parts marked A, B and C.", options: [], hasDiagram: true}),
    "diagram_label",
  );
});

test("classifyQuestionType: label cue WITHOUT a figure stays short_answer", () => {
  assert.strictEqual(
    classifyQuestionType({prompt: "Label the parts of the plant.", options: [], hasDiagram: false}),
    "short_answer",
  );
});

test("classifyQuestionType: no options, no cue → short_answer", () => {
  assert.strictEqual(classifyQuestionType({prompt: "Explain photosynthesis.", options: []}), "short_answer");
});

// ─── resolveQuestionType ────────────────────────────────────────────────────
test("resolveQuestionType trusts an explicit model type", () => {
  assert.strictEqual(resolveQuestionType({questionType: "matching", prompt: "x", options: []}), "matching");
});

test("resolveQuestionType falls back to the classifier on junk/blank", () => {
  assert.strictEqual(resolveQuestionType({questionType: "???", prompt: "Boils at ____.", options: []}), "fill_blank");
  assert.strictEqual(resolveQuestionType({prompt: "Pick one", options: ["a", "b"]}), "mcq");
});

// ─── extractMarks ───────────────────────────────────────────────────────────
test("extractMarks reads + strips an explicit marks annotation", () => {
  assert.deepStrictEqual(extractMarks("Explain why plants need light. [3 marks]"), {
    marks: 3, text: "Explain why plants need light.",
  });
  assert.deepStrictEqual(extractMarks("Name two organs (5 marks)"), {
    marks: 5, text: "Name two organs",
  });
});

test("extractMarks keeps a bare trailing (n) in the text but reads it", () => {
  const r = extractMarks("What is 5 squared (2)");
  assert.strictEqual(r.marks, 2);
  assert.strictEqual(r.text, "What is 5 squared (2)");
});

test("extractMarks returns null marks when none present", () => {
  assert.deepStrictEqual(extractMarks("What is the capital of Zambia?"), {
    marks: null, text: "What is the capital of Zambia?",
  });
});

console.log(`\nquestionTyping: ${passed} passed\n`);
