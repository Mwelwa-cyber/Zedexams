/**
 * Node assertion tests for the server-side Past Paper Studio range reconciler.
 * Run: node functions/teacherTools/pastPaperImportReconcile.test.js
 */
const assert = require("node:assert");
const {
  parseDeclaredRanges,
  parseDeclaredCountFromText,
  collectDeclaredRanges,
  rangesOverlap,
  reconcilePastPaper,
} = require("./pastPaperImportReconcile");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const q = (over = {}) => ({
  type: "mcq",
  prompt: "Question",
  options: ["a", "b", "c", "d"],
  sourceNumber: 1,
  confidence: 0.9,
  ...over,
});

console.log("pastPaperImportReconcile");

// ── parse / collect ──────────────────────────────────────────────────────
test("parseDeclaredRanges reads the ECZ dash/bracket/to forms", () => {
  const r = parseDeclaredRanges([
    "Part 4: Questions 31 – 38",
    "PART 2: (Questions 46— 60)",
    "Now do questions 51 to 55.",
  ]);
  assert.deepStrictEqual(r.map((x) => [x.start, x.end]), [[31, 38], [46, 60], [51, 55]]);
});

test("collectDeclaredRanges merges parts + regex-scanned sectionLabel/prompt", () => {
  const parts = [
    {label: "Part 3", sectionLabel: "SECTION A", firstNumber: 26, lastNumber: 30, instruction: "Choose the sentence which is correctly punctuated."},
  ];
  const questions = [
    q({sourceNumber: 21, prompt: "", sectionLabel: "Part 2: Questions 21 – 25"}),
  ];
  const ranges = collectDeclaredRanges(parts, questions);
  assert.deepStrictEqual(ranges.map((x) => [x.start, x.end]), [[21, 25], [26, 30]]);
  assert.strictEqual(ranges[1].instruction, "Choose the sentence which is correctly punctuated.");
});

test("rangesOverlap detects restart-numbering (Section A 1-20 + Section B 1-15)", () => {
  assert.strictEqual(rangesOverlap([{start: 1, end: 20}, {start: 1, end: 15}]), true);
  assert.strictEqual(rangesOverlap([{start: 1, end: 20}, {start: 21, end: 25}]), false);
});

// ── number reconcile (continuous numbering) ───────────────────────────────
test("drops a phantom numbered outside every declared range", () => {
  const parts = [{firstNumber: 1, lastNumber: 5, sectionLabel: "SECTION A"}];
  const questions = [1, 2, 3, 4, 5, 61].map((n) => q({sourceNumber: n}));
  const res = reconcilePastPaper(questions, parts);
  assert.strictEqual(res.questions.length, 5, "phantom #61 dropped");
  assert.strictEqual(res.droppedOutOfRange, 1);
  assert.deepStrictEqual(res.questions.map((x) => x.sourceNumber), [1, 2, 3, 4, 5]);
});

test("dedupes a number read twice, keeping the more complete", () => {
  const parts = [{firstNumber: 1, lastNumber: 2, sectionLabel: "SECTION A"}, {firstNumber: 3, lastNumber: 3, sectionLabel: "SECTION A"}];
  const questions = [
    q({sourceNumber: 1}),
    q({sourceNumber: 2, confidence: 0.4, options: ["a", "b"]}),
    q({sourceNumber: 2, confidence: 0.95, options: ["a", "b", "c", "d"]}),
    q({sourceNumber: 3}),
  ];
  const res = reconcilePastPaper(questions, parts);
  assert.strictEqual(res.questions.length, 3);
  assert.strictEqual(res.droppedDuplicate, 1);
  const two = res.questions.find((x) => x.sourceNumber === 2);
  assert.strictEqual(two.options.length, 4, "kept the fuller read of #2");
});

test("snaps mis-read numbers to the declared sequence when counts match", () => {
  const parts = [{firstNumber: 1, lastNumber: 5, sectionLabel: "SECTION A"}];
  const questions = [1, 2, 4, 3, 5].map((n, i) => q({sourceNumber: n, prompt: `q${i}`}));
  const res = reconcilePastPaper(questions, parts);
  assert.strictEqual(res.snapped, true);
  assert.deepStrictEqual(res.questions.map((x) => x.sourceNumber), [1, 2, 3, 4, 5]);
});

test("does NOT snap on a partial extraction; reports the gap", () => {
  const parts = [{firstNumber: 1, lastNumber: 5, sectionLabel: "SECTION A"}];
  const questions = [1, 2, 4, 5].map((n) => q({sourceNumber: n}));
  const res = reconcilePastPaper(questions, parts);
  assert.strictEqual(res.snapped, false);
  assert.deepStrictEqual(res.missing, [3]);
});

// ── restart-numbering safety ───────────────────────────────────────────────
test("SKIPS the number reconcile when numbering restarts per section", () => {
  // Section A 1-2 and Section B 1-2 — a global reconcile would wrongly drop the
  // Section B duplicates. The guard must leave all four questions intact.
  const parts = [
    {firstNumber: 1, lastNumber: 2, sectionLabel: "SECTION A"},
    {firstNumber: 1, lastNumber: 2, sectionLabel: "SECTION B"},
  ];
  const questions = [
    q({sourceNumber: 1, sectionLabel: "SECTION A"}),
    q({sourceNumber: 2, sectionLabel: "SECTION A"}),
    q({sourceNumber: 1, sectionLabel: "SECTION B"}),
    q({sourceNumber: 2, sectionLabel: "SECTION B"}),
  ];
  const res = reconcilePastPaper(questions, parts);
  assert.strictEqual(res.skippedRestartNumbering, true);
  assert.strictEqual(res.questions.length, 4, "no questions dropped on a restart-numbering paper");
  assert.strictEqual(res.droppedDuplicate, 0);
});

// ── stem-fill (parts-as-question) ───────────────────────────────────────────
test("fills an empty spelling/punctuation stem with the Part instruction", () => {
  const parts = [
    {label: "Part 3", sectionLabel: "SECTION A", firstNumber: 26, lastNumber: 26, instruction: "Choose the sentence which is correctly punctuated."},
  ];
  const questions = [
    q({sourceNumber: 26, prompt: "", sectionLabel: "SECTION A", options: [
      "Cassava, maize potatoes and wheat are carbohydrate foods.",
      "Cassava; maize potatoes and wheat, are carbohydrate foods?",
      "Cassava, maize, potatoes and wheat are carbohydrate foods.",
      "Cassava. maize potatoes and wheat. are carbohydrate foods.",
    ]}),
  ];
  const res = reconcilePastPaper(questions, parts);
  assert.strictEqual(res.stemsFilled, 1);
  assert.strictEqual(res.questions[0].prompt, "Choose the sentence which is correctly punctuated.");
  assert.strictEqual(res.questions[0].options.length, 4, "the four sentences stay the options");
});

test("does not overwrite a question that already has a stem", () => {
  const parts = [{label: "Part 4", sectionLabel: "SECTION A", firstNumber: 31, lastNumber: 31, instruction: "Choose the correct meaning."}];
  const questions = [q({sourceNumber: 31, prompt: "Mwengwe is too young to start Grade One.", sectionLabel: "SECTION A"})];
  const res = reconcilePastPaper(questions, parts);
  assert.strictEqual(res.stemsFilled, 0);
  assert.strictEqual(res.questions[0].prompt, "Mwengwe is too young to start Grade One.");
});

// ── no-op safety ────────────────────────────────────────────────────────────
test("a paper with no declared ranges is returned untouched", () => {
  const questions = [q({sourceNumber: 1}), q({sourceNumber: 99})];
  const res = reconcilePastPaper(questions, []);
  assert.strictEqual(res.questions.length, 2);
  assert.strictEqual(res.snapped, false);
  assert.strictEqual(res.declaredTotal, 0);
});

// ── cover-page declared-count manifest (Phase 1/2 — no Part ranges at all) ──
test("parseDeclaredCountFromText reads common cover-page phrasings", () => {
  assert.strictEqual(parseDeclaredCountFromText(["There are 60 questions in this paper."]), 60);
  assert.strictEqual(parseDeclaredCountFromText(["This paper has 50 questions."]), 50);
  assert.strictEqual(parseDeclaredCountFromText(["This paper contains 45 questions and 2 sections."]), 45);
  assert.strictEqual(parseDeclaredCountFromText(["Total of 60 questions."]), 60);
  assert.strictEqual(parseDeclaredCountFromText(["No statement here."]), null);
  assert.strictEqual(parseDeclaredCountFromText([]), null);
});

test("a continuously-numbered paper with NO Part headings still reconciles against a cover-declared total", () => {
  // Social-Studies-style: bare cover declaration, no "Part N: Questions X–Y"
  // headings anywhere — the bug this fixes is that ranges.length was 0 so the
  // whole number reconcile used to no-op, letting phantom 61-63 through.
  const questions = [];
  for (let n = 1; n <= 60; n++) questions.push(q({sourceNumber: n, prompt: `Q${n}`}));
  questions.push(q({sourceNumber: 61, prompt: "phantom 1"}));
  questions.push(q({sourceNumber: 62, prompt: "phantom 2"}));
  questions.push(q({sourceNumber: 63, prompt: "phantom 3"}));
  const res = reconcilePastPaper(questions, [], 60);
  assert.strictEqual(res.questions.length, 60, "exactly 60 survive, not 63");
  assert.deepStrictEqual(res.questions.map((x) => x.sourceNumber), Array.from({length: 60}, (_, i) => i + 1));
  assert.strictEqual(res.droppedOutOfRange, 3);
  assert.deepStrictEqual(res.droppedNumbers.outOfRange, [61, 62, 63]);
  assert.deepStrictEqual(res.expectedNumbers, Array.from({length: 60}, (_, i) => i + 1));
  assert.strictEqual(res.declaredQuestionCount, 60);
});

test("declared count is also picked up from a regex-scanned cover sentence when not passed explicitly", () => {
  const questions = [
    q({sourceNumber: 1, prompt: "There are 5 questions in this paper."}),
    q({sourceNumber: 2, prompt: "Q2"}),
    q({sourceNumber: 3, prompt: "Q3"}),
    q({sourceNumber: 4, prompt: "Q4"}),
    q({sourceNumber: 5, prompt: "Q5"}),
    q({sourceNumber: 9, prompt: "phantom"}),
  ];
  const res = reconcilePastPaper(questions, []); // no explicit declaredCount param
  assert.strictEqual(res.questions.length, 5);
  assert.deepStrictEqual(res.droppedNumbers.outOfRange, [9]);
});

test("explicit Part ranges take precedence over a disagreeing cover count, with a warning", () => {
  const parts = [{firstNumber: 1, lastNumber: 5, sectionLabel: "SECTION A"}];
  const questions = [1, 2, 3, 4, 5].map((n) => q({sourceNumber: n}));
  const res = reconcilePastPaper(questions, parts, 6); // cover says 6, Parts say 5
  assert.strictEqual(res.declaredTotal, 5, "Part ranges (more granular) win");
  assert.ok(res.warnings.some((w) => /declares 6 question/.test(w)));
});

test("a missing tail past the observed max is caught by expectedNumbers (not just a mid-range gap)", () => {
  // The paper declares 60 but extraction stopped dead at 55 — no INTERNAL gap
  // exists in 1..55, so the old min..max gap check would see nothing wrong.
  const questions = Array.from({length: 55}, (_, i) => q({sourceNumber: i + 1}));
  const res = reconcilePastPaper(questions, [], 60);
  assert.strictEqual(res.expectedNumbers.length, 60);
  const present = new Set(res.questions.map((x) => x.sourceNumber));
  const missingTail = res.expectedNumbers.filter((n) => !present.has(n));
  assert.deepStrictEqual(missingTail, [56, 57, 58, 59, 60]);
});

test("does not mutate the input questions", () => {
  const parts = [{firstNumber: 1, lastNumber: 2, sectionLabel: "SECTION A"}];
  const questions = [q({sourceNumber: 2}), q({sourceNumber: 1})];
  const before = JSON.stringify(questions);
  reconcilePastPaper(questions, parts);
  assert.strictEqual(JSON.stringify(questions), before, "input untouched (pure)");
});

console.log(`\nAll ${passed} pastPaperImportReconcile tests passed.`);
