/**
 * Unit tests for Vigil's deterministic monitoring logic.
 *
 * Plain Node assertions, no test runner (repo convention). Covers the pure,
 * secret-free parts of functions/agents/runners/monitor.js: the structural
 * quiz checks, the TipTap text flattener, and the de-dup failure key.
 *
 *   node functions/agents/runners/monitor.test.js
 */

const assert = require("node:assert");
const {runStructuralChecks, extractPlainText, failureKey} = require("./monitor");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

// ── extractPlainText ─────────────────────────────────────────────────
test("extractPlainText handles a plain string", () => {
  assert.strictEqual(extractPlainText("Hello"), "Hello");
});

test("extractPlainText flattens a TipTap doc", () => {
  const doc = {
    type: "doc",
    content: [
      {type: "paragraph", content: [{type: "text", text: "What is"}, {type: "text", text: " 2+2?"}]},
    ],
  };
  assert.ok(extractPlainText(doc).includes("What is"));
  assert.ok(extractPlainText(doc).includes("2+2?"));
});

test("extractPlainText returns empty for nullish", () => {
  assert.strictEqual(extractPlainText(null).trim(), "");
  assert.strictEqual(extractPlainText(undefined).trim(), "");
});

// ── runStructuralChecks ──────────────────────────────────────────────
test("a well-formed MCQ produces no problems", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Capital of Zambia?", options: ["Lusaka", "Ndola", "Kitwe"], correctAnswer: 0},
  ]);
  assert.strictEqual(problems.length, 0);
});

test("missing question text is flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "", options: ["a", "b"], correctAnswer: 0},
  ]);
  assert.ok(problems.some((p) => p.field === "text"));
});

test("fewer than two options is flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["only one"], correctAnswer: 0},
  ]);
  assert.ok(problems.some((p) => p.field === "options"));
});

test("empty option is flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["a", "  "], correctAnswer: 0},
  ]);
  assert.ok(problems.some((p) => p.field === "options" && /empty option/i.test(p.message)));
});

test("duplicate options are flagged (case-insensitive)", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["Lusaka", "lusaka", "Ndola"], correctAnswer: 0},
  ]);
  assert.ok(problems.some((p) => /duplicate/i.test(p.message)));
});

test("out-of-range correctAnswer is flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["a", "b"], correctAnswer: 5},
  ]);
  assert.ok(problems.some((p) => p.field === "correctAnswer"));
});

test("missing correctAnswer is flagged", () => {
  const problems = runStructuralChecks([
    {type: "mcq", text: "Q", options: ["a", "b"]},
  ]);
  assert.ok(problems.some((p) => p.field === "correctAnswer"));
});

test("non-mcq questions skip option checks", () => {
  const problems = runStructuralChecks([
    {type: "short_answer", text: "Explain photosynthesis."},
  ]);
  assert.strictEqual(problems.length, 0);
});

// ── failureKey ───────────────────────────────────────────────────────
test("failureKey is stable for the same failure", () => {
  const f = {check: "quizzes", id: "abc:0:options", severity: "warning", message: "x"};
  assert.strictEqual(failureKey(f), "quizzes:abc:0:options");
  assert.strictEqual(failureKey(f), failureKey({...f, message: "different message"}));
});

test("failureKey differs across checks", () => {
  assert.notStrictEqual(
      failureKey({check: "pages", id: "/"}),
      failureKey({check: "images", id: "/"}),
  );
});

console.log(`\n✓ monitor.test.js — ${passed} checks passed`);
