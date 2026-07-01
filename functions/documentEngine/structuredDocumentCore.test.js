/**
 * Unit tests for the canonical StructuredDocument core. Plain `node` script.
 *
 * Run: node functions/documentEngine/structuredDocumentCore.test.js
 */

const assert = require("node:assert");
const {
  STRUCTURED_DOCUMENT_FIELDS,
  CANONICAL_QUESTION_FIELDS,
  stampQuestion,
  buildStructuredDocument,
  emptyStructuredDocument,
} = require("./structuredDocumentCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("structuredDocumentCore");

test("field lists are stable, non-empty arrays", () => {
  assert.ok(Array.isArray(STRUCTURED_DOCUMENT_FIELDS) && STRUCTURED_DOCUMENT_FIELDS.length);
  assert.ok(Array.isArray(CANONICAL_QUESTION_FIELDS) && CANONICAL_QUESTION_FIELDS.length);
  assert.ok(STRUCTURED_DOCUMENT_FIELDS.includes("validation"));
  assert.ok(CANONICAL_QUESTION_FIELDS.includes("validationStatus"));
});

test("stampQuestion adds validationStatus + aiConfidence without dropping fields", () => {
  const q = stampQuestion({
    type: "mcq",
    prompt: "Capital of Zambia?",
    options: ["Lusaka", "Ndola", "Kitwe", "Livingstone"],
    answerKnown: true,
    confidence: 0.9,
    sourceNumber: 1,
  });
  assert.strictEqual(q.validationStatus, "ok");
  assert.strictEqual(q.aiConfidence, 0.9);
  assert.strictEqual(q.prompt, "Capital of Zambia?");
  assert.strictEqual(q.sourceNumber, 1);
});

test("aiConfidence clamps and defaults to null", () => {
  assert.strictEqual(stampQuestion({ prompt: "x", confidence: 5 }).aiConfidence, 1);
  assert.strictEqual(stampQuestion({ prompt: "x", confidence: -2 }).aiConfidence, 0);
  assert.strictEqual(stampQuestion({ prompt: "x" }).aiConfidence, null);
  assert.strictEqual(stampQuestion({ prompt: "x", confidence: "nope" }).aiConfidence, null);
});

test("stamps an incomplete labelled MCQ as error", () => {
  const q = stampQuestion({
    type: "mcq",
    prompt: "Pick one",
    options: ["A. x", "B. y", "D. z"],
    answerKnown: true,
  });
  assert.strictEqual(q.validationStatus, "error");
});

test("buildStructuredDocument assembles a full canonical shape", () => {
  const doc = buildStructuredDocument({
    questions: [
      { type: "mcq", prompt: "Q1", options: ["a", "b", "c", "d"], answerKnown: true, sourceNumber: 1, order: 0 },
      { type: "mcq", prompt: "Q2", options: ["a", "b", "c", "d"], answerKnown: true, sourceNumber: 2, order: 1 },
    ],
    meta: { sourceType: "pdf", fileName: "paper.pdf", pageCount: 3, engineVersion: "test" },
  });
  for (const f of STRUCTURED_DOCUMENT_FIELDS) {
    assert.ok(f in doc, `missing field ${f}`);
  }
  assert.strictEqual(doc.questions.length, 2);
  assert.strictEqual(doc.validation.ok, true);
  assert.strictEqual(doc.meta.fileName, "paper.pdf");
  assert.strictEqual(doc.meta.pageCount, 3);
  assert.ok(doc.report);
  assert.strictEqual(doc.report.questionsImported, 2);
});

test("folds shared-passage refs into passages[] + passageId", () => {
  const doc = buildStructuredDocument({
    questions: [
      {
        type: "mcq",
        prompt: "According to the passage, what happened first?",
        options: ["a", "b", "c", "d"],
        answerKnown: true,
        sourceNumber: 1,
        order: 0,
        passage: { ref: "p1", title: "The Flood", text: "Once upon a time the river rose and the village...", kind: "comprehension" },
      },
      {
        type: "mcq",
        prompt: "Why did the villagers move?",
        options: ["a", "b", "c", "d"],
        answerKnown: true,
        sourceNumber: 2,
        order: 1,
        passage: { ref: "p1", title: "The Flood", text: "Once upon a time the river rose and the village...", kind: "comprehension" },
      },
    ],
  });
  assert.strictEqual(doc.passages.length, 1);
  assert.ok(doc.questions.every((q) => q.passageId === doc.passages[0].id));
  // The transient passage ref is stripped from questions.
  assert.ok(doc.questions.every((q) => !("passage" in q)));
});

test("gated import (missing number) is reflected in doc.validation", () => {
  const doc = buildStructuredDocument({
    questions: [
      { type: "mcq", prompt: "Q1", options: ["a", "b", "c", "d"], answerKnown: true, sourceNumber: 1, order: 0 },
      { type: "mcq", prompt: "Q2", options: ["a", "b", "c", "d"], answerKnown: true, sourceNumber: 2, order: 1 },
      { type: "mcq", prompt: "Q4", options: ["a", "b", "c", "d"], answerKnown: true, sourceNumber: 4, order: 2 },
    ],
  });
  assert.strictEqual(doc.validation.ok, false);
  assert.ok(doc.validation.blockers.some((b) => /Missing questions: 3/.test(b)));
});

test("emptyStructuredDocument is a valid, blocked shell", () => {
  const doc = emptyStructuredDocument({ fileName: "x.pdf" });
  assert.strictEqual(doc.questions.length, 0);
  assert.strictEqual(doc.validation.ok, false);
  assert.strictEqual(doc.meta.fileName, "x.pdf");
});

console.log(`\n${passed} tests passed`);
