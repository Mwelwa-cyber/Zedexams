/**
 * Unit tests for the scanned-paper OCR import engine. Plain `node` script
 * (no test runner) — throws on the first failed assertion, matching the
 * repo's other functions/*.test.js files. Model calls are injected so this
 * runs with no network and no API keys.
 *
 * Run: node functions/scannedQuizImport.test.js
 */

const assert = require("node:assert");
const {
  runScannedQuizImport,
  validatePages,
  normaliseScannedQuestion,
  normaliseScannedSections,
  countSectionQuestions,
  reconcileCounts,
  parseGeminiCount,
  buildClaudeMessages,
  buildGeminiImages,
  MAX_PAGES_PER_CALL,
} = require("./scannedQuizImport");

// A 1x1 px PNG, base64. Tiny but a real data URL so validatePages accepts it.
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const dataUrl = (mime = "image/png") => `data:${mime};base64,${TINY_PNG}`;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const mcq = (over = {}) => ({
  prompt: "Q",
  options: ["a", "b", "c", "d"],
  ...over,
});

console.log("scannedQuizImport");

// ── validatePages ──────────────────────────────────────────────────────────

test("validatePages decodes a good page batch", () => {
  const {pages, dropped} = validatePages([
    {pageNumber: 2, dataUrl: dataUrl("image/png")},
    {pageNumber: 3, dataUrl: dataUrl("image/jpeg")},
  ]);
  assert.equal(pages.length, 2);
  assert.equal(dropped, 0);
  assert.equal(pages[0].pageNumber, 2);
  assert.equal(pages[0].mediaType, "image/png");
  assert.ok(!pages[0].data.includes("data:"), "data must be raw base64, no prefix");
});

test("validatePages drops unreadable / non-image entries but keeps the rest", () => {
  const {pages, dropped} = validatePages([
    {pageNumber: 1, dataUrl: "not-a-data-url"},
    {pageNumber: 2, dataUrl: "data:application/pdf;base64,AAAA"},
    {pageNumber: 3, dataUrl: dataUrl("image/png")},
  ]);
  assert.equal(pages.length, 1);
  assert.equal(dropped, 2);
  assert.equal(pages[0].pageNumber, 3);
});

test("validatePages throws on an empty batch", () => {
  assert.throws(() => validatePages([]), /No pages/);
});

test("validatePages caps the batch at MAX_PAGES_PER_CALL", () => {
  const many = Array.from({length: MAX_PAGES_PER_CALL + 5}, (_, i) => ({
    pageNumber: i + 1,
    dataUrl: dataUrl(),
  }));
  const {pages} = validatePages(many);
  assert.equal(pages.length, MAX_PAGES_PER_CALL);
});

// ── normaliseScannedQuestion ─────────────────────────────────────────────────

test("normaliseScannedQuestion forces a blank answer + review flag", () => {
  const q = normaliseScannedQuestion(
    {sourceQuestionNumber: 5, prompt: "5 cubed is", options: ["a", "b", "c", "d"], correctAnswer: 2, sourcePageIndex: 0},
    [2],
  );
  assert.equal(q.correctAnswer, "", "answer must always be blank");
  assert.equal(q.requiresReview, true);
  assert.equal(q.type, "mcq");
  assert.equal(q.sourceQuestionNumber, 5);
  assert.equal(q.sourcePage, 2, "page index re-based onto real page number");
});

test("normaliseScannedQuestion returns null without a stem or enough options", () => {
  assert.equal(normaliseScannedQuestion({prompt: "", options: ["a", "b"]}, [1]), null);
  assert.equal(normaliseScannedQuestion({prompt: "x", options: ["a"]}, [1]), null);
});

test("normaliseScannedQuestion carries diagram + instruction hints", () => {
  const q = normaliseScannedQuestion(
    {prompt: "Study the figure.", options: ["a", "b", "c", "d"], hasDiagram: true, instruction: "Choose the best answer.", sourcePageIndex: 1},
    [4, 5],
  );
  assert.equal(q.hasDiagram, true);
  assert.equal(q.sharedInstruction, "Choose the best answer.");
  assert.equal(q.sourcePage, 5);
});

// ── normaliseScannedSections ─────────────────────────────────────────────────

test("normaliseScannedSections keeps a comprehension passage with its questions", () => {
  const sections = normaliseScannedSections(
    [
      {
        kind: "passage",
        passageKind: "comprehension",
        title: "The Lion",
        passageText: "Once upon a time...",
        sourcePageIndex: 0,
        questions: [mcq({prompt: "Who?"}), mcq({prompt: "Where?"})],
      },
    ],
    [3],
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, "passage");
  assert.equal(sections[0].passageKind, "comprehension");
  assert.equal(sections[0].passageText, "Once upon a time...");
  assert.equal(sections[0].questions.length, 2);
  assert.equal(sections[0].questions[0].correctAnswer, "");
});

test("normaliseScannedSections marks a map passage hasImage and re-bases the page", () => {
  const sections = normaliseScannedSections(
    [
      {
        kind: "passage",
        passageKind: "map",
        title: "Map of Zambia",
        hasImage: true,
        sourcePageIndex: 1,
        questions: [mcq()],
      },
    ],
    [6, 7],
  );
  assert.equal(sections[0].passageKind, "map");
  assert.equal(sections[0].hasImage, true);
  assert.equal(sections[0].sourcePage, 7);
});

test("normaliseScannedSections forces hasImage on any map passage", () => {
  const sections = normaliseScannedSections(
    [{kind: "passage", passageKind: "map", questions: [mcq()]}],
    [1],
  );
  assert.equal(sections[0].hasImage, true);
});

test("normaliseScannedSections wraps standalone questions", () => {
  const sections = normaliseScannedSections(
    [{kind: "standalone", question: mcq({prompt: "2+2?"})}],
    [1],
  );
  assert.equal(sections[0].kind, "standalone");
  assert.equal(sections[0].question.text, "2+2?");
});

test("normaliseScannedSections drops passages whose questions are all unusable", () => {
  const sections = normaliseScannedSections(
    [{kind: "passage", title: "Empty", questions: [{prompt: "", options: []}]}],
    [1],
  );
  assert.equal(sections.length, 0);
});

test("countSectionQuestions totals passage children + standalones", () => {
  const total = countSectionQuestions([
    {kind: "passage", questions: [{}, {}, {}]},
    {kind: "standalone", question: {}},
  ]);
  assert.equal(total, 4);
});

// ── reconcileCounts ──────────────────────────────────────────────────────────

test("reconcileCounts is silent when counts agree", () => {
  assert.equal(reconcileCounts(30, 30), null);
  assert.equal(reconcileCounts(30, 31), null, "1-question slack allowed");
  assert.equal(reconcileCounts(32, 30), null, "Claude over Gemini is fine");
});

test("reconcileCounts warns when Claude under-extracts", () => {
  const w = reconcileCounts(10, 30);
  assert.ok(w && /missing/i.test(w));
});

test("reconcileCounts is silent when there is no Gemini count", () => {
  assert.equal(reconcileCounts(10, 0), null);
  assert.equal(reconcileCounts(10, NaN), null);
});

// ── parseGeminiCount ─────────────────────────────────────────────────────────

test("parseGeminiCount reads questionNumbers array length", () => {
  assert.equal(parseGeminiCount('{"questionNumbers":[1,2,3,4]}'), 4);
  assert.equal(parseGeminiCount('noise {"questionNumbers":[1,2]} tail'), 2);
  assert.equal(parseGeminiCount('{"count":7}'), 7);
  assert.equal(parseGeminiCount("not json"), 0);
});

// ── prompt builders ──────────────────────────────────────────────────────────

test("buildClaudeMessages interleaves page labels + images and a tail", () => {
  const pages = [
    {pageNumber: 2, mediaType: "image/png", data: "AAA"},
    {pageNumber: 3, mediaType: "image/jpeg", data: "BBB"},
  ];
  const [msg] = buildClaudeMessages(pages, {subject: "Mathematics", grade: "7"}, "");
  assert.equal(msg.role, "user");
  const images = msg.content.filter((b) => b.type === "image");
  assert.equal(images.length, 2);
  assert.equal(images[0].source.data, "AAA");
  const tail = msg.content[msg.content.length - 1];
  assert.ok(/Mathematics/.test(tail.text));
  assert.ok(/always null/i.test(tail.text), "tail reminds the model not to guess");
});

test("buildGeminiImages maps to inline-image shape", () => {
  const imgs = buildGeminiImages([{pageNumber: 1, mediaType: "image/jpeg", data: "X"}]);
  assert.deepEqual(imgs, [{mimeType: "image/jpeg", data: "X"}]);
});

// ── runScannedQuizImport (orchestration, mocked models) ──────────────────────

test("runScannedQuizImport runs both models and returns blank-answer sections", async () => {
  const calls = {gemini: 0, claude: 0};
  const result = await runScannedQuizImport(
    {
      pages: [{pageNumber: 1, dataUrl: dataUrl()}, {pageNumber: 2, dataUrl: dataUrl()}],
      fileName: "math_g7.pdf",
      subjectHint: "Mathematics",
      gradeHint: "7",
      anthropicKey: "k",
      geminiKey: "g",
    },
    {
      callGemini: async (key, opts) => {
        calls.gemini += 1;
        assert.equal(key, "g");
        assert.ok(Array.isArray(opts.images) && opts.images.length === 2);
        return '{"questionNumbers":[1,2,3]}';
      },
      callClaude: async (key, opts) => {
        calls.claude += 1;
        assert.equal(opts.mode, "tool");
        assert.equal(opts.toolName, "return_sections");
        return {
          parsed: {
            sections: [
              {kind: "standalone", question: mcq({sourceQuestionNumber: 1, prompt: "Q1"})},
              {
                kind: "passage",
                passageKind: "comprehension",
                title: "Story",
                passageText: "text",
                questions: [mcq({sourceQuestionNumber: 2, prompt: "Q2"}), mcq({sourceQuestionNumber: 3, prompt: "Q3"})],
              },
            ],
          },
          model: "test-model",
        };
      },
    },
  );
  assert.equal(calls.gemini, 1);
  assert.equal(calls.claude, 1);
  assert.equal(result.sections.length, 2);
  assert.equal(result.extractedCount, 3);
  assert.equal(result.detectedCount, 3);
  assert.equal(result.warnings.length, 0);
});

test("runScannedQuizImport surfaces a count-mismatch warning", async () => {
  const result = await runScannedQuizImport(
    {pages: [{pageNumber: 1, dataUrl: dataUrl()}], anthropicKey: "k", geminiKey: "g"},
    {
      callGemini: async () => '{"questionNumbers":[1,2,3,4,5,6,7,8,9,10]}',
      callClaude: async () => ({parsed: {sections: [{kind: "standalone", question: mcq()}]}}),
    },
  );
  assert.equal(result.extractedCount, 1);
  assert.ok(result.warnings.some((w) => /missing/i.test(w)));
});

test("runScannedQuizImport survives a Gemini failure (assist is best-effort)", async () => {
  const result = await runScannedQuizImport(
    {pages: [{pageNumber: 1, dataUrl: dataUrl()}], anthropicKey: "k", geminiKey: "g"},
    {
      callGemini: async () => {
        throw new Error("gemini down");
      },
      callClaude: async () => ({parsed: {sections: [{kind: "standalone", question: mcq()}]}}),
    },
  );
  assert.equal(result.extractedCount, 1);
  assert.equal(result.detectedCount, 0);
  assert.ok(!result.warnings.some((w) => /missing/i.test(w)));
});

test("runScannedQuizImport works with no Gemini key (Claude-only)", async () => {
  let geminiCalled = false;
  const result = await runScannedQuizImport(
    {pages: [{pageNumber: 1, dataUrl: dataUrl()}], anthropicKey: "k", geminiKey: ""},
    {
      callGemini: async () => {
        geminiCalled = true;
        return "{}";
      },
      callClaude: async () => ({parsed: {sections: [{kind: "standalone", question: mcq()}]}}),
    },
  );
  assert.equal(geminiCalled, false, "Gemini must be skipped without a key");
  assert.equal(result.extractedCount, 1);
});

console.log(`\nscannedQuizImport: ${passed} passed`);
