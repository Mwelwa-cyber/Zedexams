/**
 * Unit tests for the shared validation engine core. Plain `node` script (throws
 * on assertion failure) per the repo's two-suite convention.
 *
 * Run: node functions/documentEngine/validationEngineCore.test.js
 */

const assert = require("node:assert");
const {
  UNCLEAR_TOKEN,
  analyzeNumbering,
  analyzeMcqCompleteness,
  detectUnclear,
  detectAnswerKeyBlock,
  mergeContinuations,
  computeValidationStatus,
  gateImport,
} = require("./validationEngineCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Build a numbered question list from an array of source numbers (or objects).
function qs(nums) {
  return nums.map((n, i) =>
    typeof n === "object"
      ? { order: i, type: "mcq", options: ["a", "b", "c", "d"], answerKnown: true, ...n }
      : {
          order: i,
          type: "mcq",
          options: ["a", "b", "c", "d"],
          answerKnown: true,
          sourceNumber: n,
          prompt: `Q${n}`,
        },
  );
}

console.log("validationEngineCore");

// ── analyzeNumbering ──────────────────────────────────────────────
test("clean sequence reports no problems", () => {
  const r = analyzeNumbering(qs([1, 2, 3, 4, 5]));
  assert.ok(r.reliable);
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.duplicates, []);
  assert.deepStrictEqual(r.outOfOrder, []);
  assert.deepStrictEqual(r.restarts, []);
});

test("detects missing numbers (the 'Missing questions: 4' case)", () => {
  const r = analyzeNumbering(qs([1, 2, 3, 5, 6, 7]));
  assert.deepStrictEqual(r.missing, [4]);
});

test("detects a duplicate within a run (OCR re-read drift)", () => {
  const r = analyzeNumbering(qs([1, 2, 2, 3, 4]));
  assert.deepStrictEqual(r.duplicates, [2]);
  // A same-number repeat is NOT a restart.
  assert.deepStrictEqual(r.restarts, []);
});

test("detects an out-of-order slip (1,2,4,3,5)", () => {
  const r = analyzeNumbering(qs([1, 2, 4, 3, 5]));
  assert.deepStrictEqual(r.outOfOrder, [3]);
  assert.deepStrictEqual(r.restarts, []);
});

test("a section restart is a restart, not 20 duplicates", () => {
  // Section A 1..4 then Section B restarts at 1..3.
  const r = analyzeNumbering(qs([1, 2, 3, 4, 1, 2, 3]));
  assert.strictEqual(r.restarts.length, 1);
  assert.strictEqual(r.restarts[0].value, 1);
  assert.deepStrictEqual(r.duplicates, []);
  assert.deepStrictEqual(r.outOfOrder, []);
  // Union of numbers 1..4 has no gap, so nothing "missing".
  assert.deepStrictEqual(r.missing, []);
});

test("unreliable (too few / too sparse numbers) yields empty analysis", () => {
  const r = analyzeNumbering([
    { order: 0, prompt: "no number" },
    { order: 1, prompt: "still none" },
    { order: 2, sourceNumber: 7, prompt: "Q7" },
  ]);
  assert.strictEqual(r.reliable, false);
  assert.deepStrictEqual(r.missing, []);
});

// ── analyzeMcqCompleteness ────────────────────────────────────────
test("a complete 4-option MCQ passes", () => {
  assert.strictEqual(
    analyzeMcqCompleteness({ type: "mcq", options: ["a", "b", "c", "d"] }),
    null,
  );
});

test("labelled options detect an internal gap precisely (Missing Option C)", () => {
  const r = analyzeMcqCompleteness(
    { type: "mcq", options: ["A. red", "B. blue", "D. green"] },
    "Question 18",
  );
  assert.ok(r);
  assert.strictEqual(r.severity, "error");
  assert.deepStrictEqual(r.missingLetters, ["C"]);
  assert.match(r.message, /Question 18 — Missing Option C/);
});

test("unlabelled 3-option MCQ is a soft warning (not every 3-opt is broken)", () => {
  const r = analyzeMcqCompleteness(
    { type: "mcq", options: ["red", "blue", "green"] },
    "Question 5",
  );
  assert.ok(r);
  assert.strictEqual(r.severity, "warning");
  assert.deepStrictEqual(r.missingLetters, ["D"]);
});

test("fewer than 2 options is an error", () => {
  const r = analyzeMcqCompleteness({ type: "mcq", options: ["only one"] }, "Q1");
  assert.strictEqual(r.severity, "error");
});

test("non-MCQ types are ignored", () => {
  assert.strictEqual(analyzeMcqCompleteness({ type: "essay", options: [] }), null);
  assert.strictEqual(
    analyzeMcqCompleteness({ type: "short_answer", options: [] }),
    null,
  );
});

// ── detectUnclear ─────────────────────────────────────────────────
test("finds [UNCLEAR] tokens across fields", () => {
  const hits = detectUnclear({
    prompt: `What is the ${UNCLEAR_TOKEN} of water?`,
    options: ["a", `${UNCLEAR_TOKEN}`, "c"],
    explanation: "",
  });
  assert.strictEqual(hits.length, 2);
  assert.ok(hits.some((h) => h.field === "prompt"));
  assert.ok(hits.some((h) => h.field === "option[1]"));
});

test("no token → no hits", () => {
  assert.deepStrictEqual(detectUnclear({ prompt: "all clear" }), []);
});

// ── detectAnswerKeyBlock ──────────────────────────────────────────
test("flags a heading-led answer key", () => {
  assert.ok(detectAnswerKeyBlock("MARKING SCHEME\n1. A 2. B 3. C"));
  assert.ok(detectAnswerKeyBlock({ prompt: "Answer Key" }));
  assert.ok(detectAnswerKeyBlock("Memorandum for Paper 1"));
});

test("flags a dense answer-pair block with no heading", () => {
  assert.ok(
    detectAnswerKeyBlock("1. A 2. B 3. C 4. D 5. A 6. B 7. C 8. D"),
  );
});

test("a normal question is NOT an answer key", () => {
  assert.strictEqual(
    detectAnswerKeyBlock({
      prompt: "Which gas do plants absorb during photosynthesis?",
    }),
    false,
  );
});

// ── mergeContinuations ────────────────────────────────────────────
test("merges an unnumbered lowercase tail into the previous question", () => {
  const { questions, merged } = mergeContinuations([
    { order: 0, sourceNumber: 5, prompt: "Explain why the river floods", options: [] },
    { order: 1, sourceNumber: null, prompt: "during the rainy season.", options: [] },
  ]);
  assert.strictEqual(merged, 1);
  assert.strictEqual(questions.length, 1);
  assert.match(questions[0].prompt, /river floods during the rainy season\./);
});

test("does NOT merge a numbered question (real next question)", () => {
  const { questions, merged } = mergeContinuations([
    { order: 0, sourceNumber: 5, prompt: "Explain the water cycle", options: [] },
    { order: 1, sourceNumber: 6, prompt: "define evaporation.", options: [] },
  ]);
  assert.strictEqual(merged, 0);
  assert.strictEqual(questions.length, 2);
});

test("does NOT merge when the previous prompt ended in a full stop", () => {
  const { merged } = mergeContinuations([
    { order: 0, sourceNumber: 5, prompt: "State Newton's first law.", options: [] },
    { order: 1, sourceNumber: null, prompt: "and give an example.", options: [] },
  ]);
  // Previous ended with '.', so the tail is treated as its own item.
  assert.strictEqual(merged, 0);
});

// ── computeValidationStatus ───────────────────────────────────────
test("clean MCQ → ok", () => {
  assert.strictEqual(
    computeValidationStatus({
      type: "mcq",
      prompt: "Capital of Zambia?",
      options: ["Lusaka", "Ndola", "Kitwe", "Livingstone"],
      answerKnown: true,
    }),
    "ok",
  );
});

test("MCQ with a labelled option gap → error", () => {
  assert.strictEqual(
    computeValidationStatus({
      type: "mcq",
      prompt: "Pick one",
      options: ["A. x", "B. y", "D. z"],
      answerKnown: true,
    }),
    "error",
  );
});

test("no answer set → warning", () => {
  assert.strictEqual(
    computeValidationStatus({
      type: "mcq",
      prompt: "Pick one",
      options: ["a", "b", "c", "d"],
      answerKnown: false,
    }),
    "warning",
  );
});

test("[UNCLEAR] token → warning", () => {
  assert.strictEqual(
    computeValidationStatus({
      type: "essay",
      prompt: `Discuss the ${UNCLEAR_TOKEN} of trade.`,
      answerKnown: false,
    }),
    "warning",
  );
});

test("empty prompt → error", () => {
  assert.strictEqual(computeValidationStatus({ type: "mcq", prompt: "" }), "error");
});

// ── gateImport ────────────────────────────────────────────────────
test("clean import passes the gate", () => {
  const r = gateImport({ questions: qs([1, 2, 3, 4, 5]) });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.blockers, []);
});

test("missing numbers BLOCK the import with a readable message", () => {
  const r = gateImport({ questions: qs([1, 2, 3, 5, 6]) });
  assert.strictEqual(r.ok, false);
  assert.ok(r.blockers.some((b) => /Missing questions: 4/.test(b)));
});

test("an answer key among the questions BLOCKS the import", () => {
  const list = qs([1, 2, 3]);
  list.push({
    order: 3,
    sourceNumber: 4,
    type: "short_answer",
    options: [],
    prompt: "MARKING SCHEME 1. A 2. B 3. C 4. D 5. A",
    answerKnown: false,
  });
  const r = gateImport({ questions: list });
  assert.strictEqual(r.ok, false);
  assert.ok(r.blockers.some((b) => /answer key|marking scheme/i.test(b)));
});

test("empty extraction BLOCKS", () => {
  const r = gateImport({ questions: [] });
  assert.strictEqual(r.ok, false);
  assert.ok(r.blockers.some((b) => /No questions/.test(b)));
});

test("thin MCQ + no-answer surface as WARNINGS, not blockers", () => {
  const r = gateImport({
    questions: [
      { order: 0, sourceNumber: 1, type: "mcq", options: ["a", "b", "c", "d"], answerKnown: false, prompt: "Q1" },
      { order: 1, sourceNumber: 2, type: "mcq", options: ["x", "y", "z"], answerKnown: true, prompt: "Q2" },
      { order: 2, sourceNumber: 3, type: "mcq", options: ["a", "b", "c", "d"], answerKnown: true, prompt: "Q3" },
    ],
  });
  assert.strictEqual(r.ok, true);
  assert.ok(r.warnings.some((w) => /no answer set/i.test(w)));
  assert.ok(r.warnings.some((w) => /only 3 options/i.test(w)));
});

test("an un-numbered paper does not falsely block on 'missing'", () => {
  const r = gateImport({
    questions: [
      { order: 0, type: "essay", options: [], prompt: "Discuss trade.", answerKnown: false },
      { order: 1, type: "essay", options: [], prompt: "Explain rainfall.", answerKnown: false },
    ],
  });
  // No reliable numbering → no missing-number blocker (no-answer on essays is
  // fine because essays are excluded).
  assert.strictEqual(r.ok, true);
});

console.log(`\n${passed} tests passed`);
