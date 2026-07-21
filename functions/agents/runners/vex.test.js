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
    {type: "mcq", text: richText("Q"), options: [richText("Lusaka"), richText("Lusaka")], correctAnswer: 0},
  ]);
  assert.ok(blockers.some((b) => /duplicate/i.test(b.message)));
});

test("options differing only in case do NOT block publishing", () => {
  // Regression for the Grade 7 English Language Mock (quiz q2WGapKWzsxvTklaw7mG):
  // capitalisation-question options ("My"/"my") are distinct answers but the old
  // lowercased key wrongly blocked them as duplicates before publish.
  const blockers = runStructuralChecks([
    {type: "mcq", text: richText("Choose the correctly capitalised sentence."), options: [
      richText("my name is john."),
      richText("My name is John."),
      richText("My Name Is John."),
      richText("my name is John."),
    ], correctAnswer: 1},
  ]);
  assert.ok(!blockers.some((b) => /duplicate/i.test(b.message)), JSON.stringify(blockers));
});

test("an empty rich-text option is still blocked", () => {
  const blockers = runStructuralChecks([
    {type: "mcq", text: richText("Q"), options: [richText("a"), richText("   ")], correctAnswer: 0},
  ]);
  assert.ok(blockers.some((b) => /empty option/i.test(b.message)));
});

test("maths options (fractions) do NOT block publishing", () => {
  // Regression: a fraction option (½) is a leaf node carrying its value in
  // `attrs`, with no child text node. The walker read only `node.text`, so it
  // flattened to "" and a valid maths quiz was BLOCKED with a false "empty
  // option" blocker. Mirrors src/editor/richPlainText.js.
  const frac = (num, den) =>
    `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mathFraction","attrs":{"num":"${num}","den":"${den}"}}]}]}`;
  const blockers = runStructuralChecks([
    {type: "mcq", text: "Which fraction is the largest?", options: [frac(1, 2), frac(1, 3), frac(1, 4), frac(3, 4)], correctAnswer: 3},
  ]);
  assert.strictEqual(blockers.length, 0, JSON.stringify(blockers));
});

test("number-base and inline-maths options do NOT block publishing", () => {
  const numberBase = (n, b) =>
    `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"numberBase","attrs":{"number":"${n}","base":"${b}"}}]}]}`;
  const blockers = runStructuralChecks([
    {type: "mcq", text: "Which equals 5 in base 10?", options: [numberBase(101, 2), numberBase(12, 3), numberBase(11, 2)], correctAnswer: 0},
  ]);
  assert.strictEqual(blockers.length, 0, JSON.stringify(blockers));
});

test("picture-answer options (blank text + optionMedia image) do NOT block", () => {
  // Regression: image-based MCQs carry the answer choice in a picture, so the
  // option text is intentionally blank. Before the fix every such option
  // tripped the "empty option" blocker, flagging the whole question for no
  // reason. With optionMedia images present they must pass.
  const blockers = runStructuralChecks([
    {
      type: "mcq",
      text: "Which picture shows a triangle?",
      options: ["", "", "", ""],
      optionMedia: [
        {imageUrl: "https://example.com/a.png", alt: "triangle"},
        {imageUrl: "https://example.com/b.png", alt: "square"},
        {imageUrl: "https://example.com/c.png", alt: "circle"},
        {imageUrl: "https://example.com/d.png", alt: "star"},
      ],
      correctAnswer: 0,
    },
  ]);
  assert.strictEqual(blockers.length, 0, JSON.stringify(blockers));
});

test("a blank option with no image is still blocked", () => {
  // The image exemption is per-slot: a blank text option whose optionMedia
  // slot has no image is still a genuine empty option.
  const blockers = runStructuralChecks([
    {
      type: "mcq",
      text: "Pick one",
      options: ["Lusaka", "", "Kitwe"],
      optionMedia: [{imageUrl: "https://example.com/a.png", alt: "x"}, null, null],
      correctAnswer: 0,
    },
  ]);
  assert.ok(blockers.some((b) => /empty option/i.test(b.message)), JSON.stringify(blockers));
});

console.log(`\n✓ vex.test.js — ${passed} checks passed`);
