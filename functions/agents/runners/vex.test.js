/**
 * Unit tests for Vex's deterministic pre-publish structural checks.
 *
 * Plain Node assertions, no test runner (repo convention). Covers the pure,
 * secret-free runStructuralChecks in functions/agents/runners/vex.js — the
 * blockers that gate publishing before the LLM runs.
 *
 *   node functions/agents/runners/vex.test.js
 */

const assert = require("node:assert");
const {runStructuralChecks} = require("./vex");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

const richText = (label) => ({
  type: "doc",
  content: [{type: "paragraph", content: [{type: "text", text: label}]}],
});

test("a well-formed plain-string MCQ produces no blockers", () => {
  const blockers = runStructuralChecks([
    {type: "mcq", text: "Capital of Zambia?", options: ["Lusaka", "Ndola", "Kitwe"], correctAnswer: 0},
  ]);
  assert.strictEqual(blockers.length, 0, JSON.stringify(blockers));
});

test("distinct rich-text (TipTap) options do NOT block publishing", () => {
  // Regression: options stored as TipTap doc objects were compared with
  // String(o) — every doc rendered as "[object Object]", so distinct options
  // were reported as duplicates and BLOCKED publishing. See the false positive
  // Vigil filed for quiz qP7RYG8v3loytqfyitf7.
  const blockers = runStructuralChecks([
    {
      type: "mcq",
      text: richText("Posters are usually decorated with bright colours to…"),
      options: [
        richText("make them look more attractive."),
        richText("make them look very expensive."),
        richText("prevent people from seeing them."),
        richText("prevent people from stealing them."),
      ],
      correctAnswer: 0,
    },
  ]);
  assert.strictEqual(blockers.length, 0, JSON.stringify(blockers));
});

test("genuinely duplicate rich-text options are still blocked", () => {
  const blockers = runStructuralChecks([
    {type: "mcq", text: richText("Q"), options: [richText("Lusaka"), richText("lusaka")], correctAnswer: 0},
  ]);
  assert.ok(blockers.some((b) => /duplicate/i.test(b.message)));
});

test("an empty rich-text option is still blocked", () => {
  const blockers = runStructuralChecks([
    {type: "mcq", text: richText("Q"), options: [richText("a"), richText("   ")], correctAnswer: 0},
  ]);
  assert.ok(blockers.some((b) => /empty option/i.test(b.message)));
});

console.log(`\n✓ vex.test.js — ${passed} checks passed`);
