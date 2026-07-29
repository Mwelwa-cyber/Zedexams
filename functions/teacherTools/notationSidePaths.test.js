/**
 * §4 — the paths that create or move question content into a paper.
 *
 * A contract only holds if every door obeys it. Full generation is the front
 * door; single-question regeneration, master-bank sourcing and the free-preview
 * clamp are the others, and each is capable of putting plain-text mathematics
 * into a paper that was clean.
 *
 * The master-bank finding is the reason this file exists: sourcing did not
 * flatten a structured fraction, it DELETED it, and dropped the question
 * outright when the answer was one.
 *
 * Run: node functions/teacherTools/notationSidePaths.test.js
 */

const assert = require("node:assert/strict");
const {
  withNotationMarkup, editorQuestionToAssessment, editorQuestionToQuiz,
} = require("./masterBankSourcingCore");
const {clampAssessmentPreview} = require("./freePreview");

let passed = 0;
const pending = [];
function check(name, fn) {
  pending.push(async () => {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}
function section(title) {
  pending.push(async () => console.log(`\n${title}`));
}

const frac = (num, den, whole = "") =>
  `<span class="math-frac" data-math-fraction="1" data-whole="${whole}"` +
  ` data-num="${num}" data-den="${den}"></span>`;

/** A bank question saved by a teacher after Phase 1 — real structured nodes. */
function bankQuestion(overrides = {}) {
  return {
    type: "short_answer",
    text: `Calculate ${frac(3, 5)} + ${frac(1, 4)}.`,
    correctAnswer: frac(17, 20),
    explanation: `The common denominator is 20, giving ${frac(17, 20)}.`,
    marks: 3,
    ...overrides,
  };
}

section("master bank — the path that was deleting mathematics");

check("WITHOUT the converter, a fraction question is dropped entirely", async () => {
  // The bug, pinned so the fix cannot be quietly removed. plainify strips
  // tags, and a stacked fraction keeps its digits in ATTRIBUTES — so the
  // answer became "" and the mapper reads an empty answer as unusable.
  assert.equal(editorQuestionToAssessment(bankQuestion()), null);
});

check("WITH it, the question survives and its maths becomes contract markup", async () => {
  const {nodeHtmlToNotationMarkup} = await import("../shared/assessment/mathsNotationCore.js");
  const mapped = editorQuestionToAssessment(
      withNotationMarkup(bankQuestion(), nodeHtmlToNotationMarkup));
  assert.ok(mapped, "the question was still dropped");
  assert.equal(mapped.prompt, "Calculate \\frac{3}{5} + \\frac{1}{4}.");
  assert.equal(mapped.answer, "\\frac{17}{20}");
  assert.match(mapped.markingGuide, /\\frac\{17\}\{20\}/);
});

check("a bank question round-trips back into the SAME structured nodes", async () => {
  // The loop that matters: a teacher's saved fraction, sourced into a new
  // paper, must arrive as a fraction again rather than degrading a little on
  // every pass through the bank.
  const {nodeHtmlToNotationMarkup} = await import("../shared/assessment/mathsNotationCore.js");
  const {mapAiQuestion} = await import("../../src/utils/aiPaperToSections.js");

  const sourced = editorQuestionToAssessment(
      withNotationMarkup(bankQuestion(), nodeHtmlToNotationMarkup));
  const {overrides} = mapAiQuestion(sourced);

  assert.match(String(overrides.text), /math-frac/);
  assert.match(String(overrides.text), /data-num="3"/);
  assert.match(String(overrides.text), /data-den="5"/);
  assert.match(String(overrides.correctAnswer), /data-num="17"/);
  assert.ok(!String(overrides.text).includes("\\frac"), "markup leaked through");
});

check("MCQ options and a column calculation round-trip too", async () => {
  const {nodeHtmlToNotationMarkup} = await import("../shared/assessment/mathsNotationCore.js");
  const mapped = editorQuestionToAssessment(withNotationMarkup({
    type: "mcq",
    text: `Which is largest? <div class="vert-arith" data-operator="×" data-lines="234|6" data-answer="1404"></div>`,
    options: [frac(1, 2), frac(2, 3), frac(3, 4), frac(5, 8)],
    correctAnswer: 2,
    marks: 1,
  }, nodeHtmlToNotationMarkup));
  assert.ok(mapped);
  assert.deepEqual(mapped.options,
      ["\\frac{1}{2}", "\\frac{2}{3}", "\\frac{3}{4}", "\\frac{5}{8}"]);
  // The INDEX is resolved to the option's text by the mapper; it must be the
  // third option, not a default.
  assert.equal(mapped.answer, "\\frac{3}{4}");
  assert.match(mapped.prompt, /\[\[vmath op=× lines=234,6 answer=1404\]\]/);
});

check("the quiz mapper gets the same treatment", async () => {
  const {nodeHtmlToNotationMarkup} = await import("../shared/assessment/mathsNotationCore.js");
  const mapped = editorQuestionToQuiz(withNotationMarkup({
    type: "mcq",
    text: `Which equals ${frac(1, 2)}?`,
    options: [frac(2, 4), frac(1, 3), frac(3, 4), frac(2, 3)],
    correctAnswer: 0,
    marks: 1,
  }, nodeHtmlToNotationMarkup));
  assert.ok(mapped);
  assert.match(mapped.question, /\\frac\{1\}\{2\}/);
});

check("a plain-prose bank question is completely unaffected", async () => {
  const {nodeHtmlToNotationMarkup} = await import("../shared/assessment/mathsNotationCore.js");
  const plain = {
    type: "short_answer",
    text: "Name two animals that live on a farm.",
    correctAnswer: "cow, goat",
    explanation: "One mark each.",
    marks: 2,
  };
  const before = editorQuestionToAssessment(plain);
  const after = editorQuestionToAssessment(withNotationMarkup(plain, nodeHtmlToNotationMarkup));
  assert.deepEqual(after, before);
});

section("single-question regeneration");

check("a regenerated question converts through the SAME converter, sub-parts included", async () => {
  // The studio splices a rewrite in via mapAiQuestion — the full-paper
  // converter — so every leak closed in Stage 2 is closed here by
  // construction. This asserts that rather than assuming it.
  const {mapAiQuestion} = await import("../../src/utils/aiPaperToSections.js");
  const regenerated = {
    type: "structured",
    prompt: "Work out the following.",
    // Two parts, because the mapper only builds subParts for a genuinely
    // multi-part question — one part stays a plain single-answer question.
    parts: [
      {text: "Calculate \\frac{3}{5} + \\frac{1}{4}.", answer: "\\frac{17}{20}", marks: 3},
      {text: "Convert 2\\frac{3}{7} to an improper fraction.", answer: "\\frac{17}{7}", marks: 2},
    ],
    answer: "",
    markingGuide: "Common denominator 20.",
  };
  const {overrides} = mapAiQuestion(regenerated);
  assert.match(String(overrides.subParts[0].text), /math-frac/);
  assert.match(String(overrides.subParts[0].answer), /math-frac/);
});

section("the free-preview clamp");

check("clamping keeps every surviving question's mathematics byte-identical", async () => {
  // The clamp slices arrays and spreads objects; it never reaches into a
  // question's strings. Pinned because "it happens not to touch them" is one
  // refactor away from "it flattens them".
  const paper = {
    header: {totalMarks: 9},
    sections: [{
      title: "Section A",
      passage: {text: "Mary sold \\frac{3}{4} of her tomatoes."},
      questions: [
        {prompt: "Calculate \\frac{3}{5} + \\frac{1}{4}.", answer: "\\frac{17}{20}", marks: 3,
          parts: [{text: "Convert 2\\frac{3}{7}.", answer: "\\frac{17}{7}"}]},
        {prompt: "Work out [[vmath op=+ lines=24,13 answer=37]].", answer: "37", marks: 3},
        {prompt: "Simplify $x^{2}$.", answer: "9", marks: 3},
      ],
    }],
  };
  const {assessment, truncated} = clampAssessmentPreview(paper, 2);
  assert.equal(truncated, true);
  const kept = assessment.sections[0].questions;
  assert.equal(kept.length, 2);
  assert.equal(kept[0].prompt, "Calculate \\frac{3}{5} + \\frac{1}{4}.");
  assert.equal(kept[0].answer, "\\frac{17}{20}");
  assert.equal(kept[0].parts[0].text, "Convert 2\\frac{3}{7}.");
  assert.equal(kept[1].prompt, "Work out [[vmath op=+ lines=24,13 answer=37]].");
  assert.equal(assessment.sections[0].passage.text, "Mary sold \\frac{3}{4} of her tomatoes.");
});

check("a clamped preview still converts into structured nodes", async () => {
  const {aiAssessmentToStudioBlocks} = await import("../../src/utils/aiPaperToSections.js");
  const {assessment} = clampAssessmentPreview({
    sections: [{title: "A", questions: [
      {type: "short_answer", prompt: "Calculate \\frac{3}{5}.", answer: "\\frac{3}{5}", marks: 1},
      {type: "short_answer", prompt: "And another.", answer: "x", marks: 1},
    ]}],
  }, 1);
  const blocks = aiAssessmentToStudioBlocks(assessment);
  assert.equal(blocks.questionCount, 1);
  assert.match(String(blocks.sections[0].question.text), /math-frac/);
});

(async () => {
  for (const t of pending) await t();
  console.log(`\n${passed} side-path checks passed\n`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
