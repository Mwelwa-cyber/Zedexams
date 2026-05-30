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
  normaliseScannedQuestions,
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
  assert.ok(pages[0].data.length > 0);
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

test("validatePages throws when every page is unusable", () => {
  assert.throws(
    () => validatePages([{pageNumber: 1, dataUrl: "junk"}]),
    /unreadable/,
  );
});

test("validatePages caps the batch at MAX_PAGES_PER_CALL", () => {
  const many = Array.from({length: MAX_PAGES_PER_CALL + 5}, (_, i) => ({
    pageNumber: i + 1,
    dataUrl: dataUrl(),
  }));
  const {pages} = validatePages(many);
  assert.equal(pages.length, MAX_PAGES_PER_CALL);
});

// ── normaliseScannedQuestions ────────────────────────────────────────────────

test("normaliseScannedQuestions forces a blank answer + review flag", () => {
  const out = normaliseScannedQuestions(
    [
      {
        sourceQuestionNumber: 5,
        prompt: "In expanded form, 5 cubed is",
        options: ["3 x 5", "5 x 3", "5 x 5 x 5", "3 x 3 x 3 x 3 x 3"],
        // Even if the model hallucinated an answer, the scanned policy blanks it.
        correctAnswer: 2,
        hasDiagram: false,
        sourcePageIndex: 0,
      },
    ],
    [2],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].correctAnswer, "", "answer must always be blank");
  assert.equal(out[0].requiresReview, true);
  assert.equal(out[0].type, "mcq");
  assert.equal(out[0].sourceQuestionNumber, 5);
  assert.equal(out[0].sourcePage, 2, "page index re-based onto real page number");
  assert.equal(out[0].options.length, 4);
});

test("normaliseScannedQuestions drops items without a stem or enough options", () => {
  const out = normaliseScannedQuestions(
    [
      {prompt: "", options: ["a", "b"]},
      {prompt: "Only one option", options: ["a"]},
      {prompt: "Good one", options: ["a", "b", "c", "d"]},
    ],
    [1],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "Good one");
});

test("normaliseScannedQuestions carries diagram + section hints", () => {
  const out = normaliseScannedQuestions(
    [
      {
        prompt: "Study the diagram below.",
        options: ["a", "b", "c", "d"],
        hasDiagram: true,
        sectionTitle: "Section A",
        instruction: "Choose the best answer.",
        sourcePageIndex: 1,
      },
    ],
    [4, 5],
  );
  assert.equal(out[0].hasDiagram, true);
  assert.equal(out[0].sectionTitle, "Section A");
  assert.equal(out[0].sharedInstruction, "Choose the best answer.");
  assert.equal(out[0].sourcePage, 5);
});

test("normaliseScannedQuestions falls back to first page when index is bad", () => {
  const out = normaliseScannedQuestions(
    [{prompt: "Q", options: ["a", "b"], sourcePageIndex: 99}],
    [7, 8],
  );
  assert.equal(out[0].sourcePage, 7);
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
  assert.equal(images[0].source.media_type, "image/png");
  assert.equal(images[0].source.data, "AAA");
  const tail = msg.content[msg.content.length - 1];
  assert.equal(tail.type, "text");
  assert.ok(/Mathematics/.test(tail.text));
  assert.ok(/always null/i.test(tail.text), "tail reminds the model not to guess");
});

test("buildGeminiImages maps to inline-image shape", () => {
  const imgs = buildGeminiImages([
    {pageNumber: 1, mediaType: "image/jpeg", data: "X"},
  ]);
  assert.deepEqual(imgs, [{mimeType: "image/jpeg", data: "X"}]);
});

// ── runScannedQuizImport (orchestration, mocked models) ──────────────────────

test("runScannedQuizImport runs both models and returns blank-answer MCQs", async () => {
  const calls = {gemini: 0, claude: 0};
  const result = await runScannedQuizImport(
    {
      pages: [
        {pageNumber: 1, dataUrl: dataUrl()},
        {pageNumber: 2, dataUrl: dataUrl()},
      ],
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
        return '{"questionNumbers":[1,2]}';
      },
      callClaude: async (key, opts) => {
        calls.claude += 1;
        assert.equal(key, "k");
        assert.equal(opts.mode, "tool");
        return {
          parsed: {
            questions: [
              {sourceQuestionNumber: 1, prompt: "Q1", options: ["a", "b", "c", "d"], correctAnswer: 1, sourcePageIndex: 0},
              {sourceQuestionNumber: 2, prompt: "Q2", options: ["a", "b", "c", "d"], sourcePageIndex: 1},
            ],
          },
          model: "test-model",
          usage: {inputTokens: 10, outputTokens: 5},
        };
      },
    },
  );
  assert.equal(calls.gemini, 1);
  assert.equal(calls.claude, 1);
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].correctAnswer, "");
  assert.equal(result.questions[1].sourcePage, 2);
  assert.equal(result.extractedCount, 2);
  assert.equal(result.detectedCount, 2);
  assert.equal(result.warnings.length, 0);
});

test("runScannedQuizImport surfaces a count-mismatch warning", async () => {
  const result = await runScannedQuizImport(
    {
      pages: [{pageNumber: 1, dataUrl: dataUrl()}],
      anthropicKey: "k",
      geminiKey: "g",
    },
    {
      callGemini: async () => '{"questionNumbers":[1,2,3,4,5,6,7,8,9,10]}',
      callClaude: async () => ({
        parsed: {questions: [{prompt: "only one", options: ["a", "b"]}]},
      }),
    },
  );
  assert.equal(result.questions.length, 1);
  assert.ok(result.warnings.some((w) => /missing/i.test(w)));
});

test("runScannedQuizImport survives a Gemini failure (assist is best-effort)", async () => {
  const result = await runScannedQuizImport(
    {
      pages: [{pageNumber: 1, dataUrl: dataUrl()}],
      anthropicKey: "k",
      geminiKey: "g",
    },
    {
      callGemini: async () => {
        throw new Error("gemini down");
      },
      callClaude: async () => ({
        parsed: {questions: [{prompt: "Q1", options: ["a", "b", "c", "d"]}]},
      }),
    },
  );
  assert.equal(result.questions.length, 1);
  assert.equal(result.detectedCount, 0);
  // No count cross-check possible, so no mismatch warning.
  assert.ok(!result.warnings.some((w) => /missing/i.test(w)));
});

test("runScannedQuizImport works with no Gemini key (Claude-only)", async () => {
  let geminiCalled = false;
  const result = await runScannedQuizImport(
    {
      pages: [{pageNumber: 1, dataUrl: dataUrl()}],
      anthropicKey: "k",
      geminiKey: "",
    },
    {
      callGemini: async () => {
        geminiCalled = true;
        return "{}";
      },
      callClaude: async () => ({
        parsed: {questions: [{prompt: "Q1", options: ["a", "b", "c", "d"]}]},
      }),
    },
  );
  assert.equal(geminiCalled, false, "Gemini must be skipped without a key");
  assert.equal(result.questions.length, 1);
});

console.log(`\nscannedQuizImport: ${passed} passed`);
