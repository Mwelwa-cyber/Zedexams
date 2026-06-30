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
  sanitiseOptionBoxes,
  classifyDiagram,
  sanitiseDiagram,
  sanitiseDiagrams,
  reconcileCounts,
  parseGeminiCount,
  buildClaudeMessages,
  buildGeminiImages,
  CLAUDE_SYSTEM_PROMPT,
  SCANNED_TOOL_SCHEMA,
  MAX_PAGES_PER_CALL,
  SCANNED_IMPORT_ENGINE_VERSION,
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

// ── pictorial options (sanitiseOptionBoxes + normalise) ──────────────────────

test("sanitiseOptionBoxes validates, clamps overflow, and pads to length", () => {
  const boxes = sanitiseOptionBoxes(
    [
      {x: 0.1, y: 0.1, w: 0.2, h: 0.2}, // good
      {x: 0.9, y: 0.1, w: 0.5, h: 0.2}, // overflows right → w clamped to 0.1
      {x: 0, y: 0, w: 0.01, h: 0.2}, // too thin → null
      {x: 0, y: 0, w: 1, h: 1}, // whole page → null
    ],
    4,
  );
  assert.equal(boxes.length, 4);
  assert.deepEqual(boxes[0], {x: 0.1, y: 0.1, w: 0.2, h: 0.2});
  assert.ok(Math.abs(boxes[1].w - 0.1) < 1e-9, "right overflow clamped");
  assert.equal(boxes[2], null);
  assert.equal(boxes[3], null);
});

test("sanitiseOptionBoxes pads missing entries with null", () => {
  const boxes = sanitiseOptionBoxes([{x: 0, y: 0, w: 0.3, h: 0.3}], 4);
  assert.equal(boxes.length, 4);
  assert.ok(boxes[0]);
  assert.equal(boxes[3], null);
});

test("normaliseScannedQuestion keeps pictorial options with boxes + blank labels", () => {
  const q = normaliseScannedQuestion(
    {
      prompt: "Which net folds into a cube?",
      options: ["", "", "", ""],
      optionsAreImages: true,
      optionImageBoxes: [
        {x: 0.1, y: 0.5, w: 0.15, h: 0.15},
        {x: 0.3, y: 0.5, w: 0.15, h: 0.15},
        {x: 0.5, y: 0.5, w: 0.15, h: 0.15},
        {x: 0.7, y: 0.5, w: 0.15, h: 0.15},
      ],
      sourcePageIndex: 0,
    },
    [4],
  );
  assert.ok(q, "kept even though option text is blank");
  assert.equal(q.optionsAreImages, true);
  assert.equal(q.options.length, 4);
  assert.equal(q.optionImageBoxes.length, 4);
  assert.ok(q.optionImageBoxes.every(Boolean));
  assert.equal(q.correctAnswer, "");
});

test("normaliseScannedQuestion falls back to text when picture boxes are unusable", () => {
  // optionsAreImages claimed, but boxes are degenerate AND there is option text.
  const q = normaliseScannedQuestion(
    {
      prompt: "Pick one",
      options: ["red", "blue", "green", "yellow"],
      optionsAreImages: true,
      optionImageBoxes: [null, null, null, null],
    },
    [1],
  );
  assert.equal(q.optionsAreImages, false);
  assert.equal(q.optionImageBoxes, null);
  assert.deepEqual(q.options, ["red", "blue", "green", "yellow"]);
});

test("normaliseScannedQuestion drops a picture question with fewer than 2 boxes", () => {
  const q = normaliseScannedQuestion(
    {prompt: "x", options: ["", ""], optionsAreImages: true, optionImageBoxes: [{x: 0, y: 0, w: 0.3, h: 0.3}, null]},
    [1],
  );
  // Only one usable box and no option text → unusable.
  assert.equal(q, null);
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
  // Engine version stamp is always returned so a stale deploy is observable
  // in the editor (the client compares it against its own importer version).
  assert.equal(result.engineVersion, SCANNED_IMPORT_ENGINE_VERSION);
  assert.ok(result.engineVersion, "engine version must be a non-empty stamp");
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

// ── output-token truncation (regression for English ECZ paper import) ──────────
// When Claude hits max_tokens in tool mode the Anthropic API returns
// stop_reason:"max_tokens" with a partial (or empty) tool input. callClaude
// does NOT throw in this case — it returns the partial parsed object plus the
// stop reason. runScannedQuizImport MUST surface a user-visible warning so the
// teacher knows that tail questions may be missing; it must also return whatever
// sections DID arrive (not crash).

test("runScannedQuizImport surfaces a warning when callClaude returns stopReason='max_tokens'", async () => {
  // Simulate the partial-output scenario: Claude returned 3 sections before
  // being cut off (the remaining sections on the batch were lost).
  const result = await runScannedQuizImport(
    {pages: [{pageNumber: 1, dataUrl: dataUrl()}, {pageNumber: 2, dataUrl: dataUrl()}], anthropicKey: "k", geminiKey: ""},
    {
      callGemini: async () => "{}",
      callClaude: async () => ({
        parsed: {
          sections: [
            {kind: "standalone", question: mcq({prompt: "Q1"})},
            {
              kind: "passage",
              passageKind: "comprehension",
              title: "The Generous Farmer",
              passageText: "Once upon a time in Zambia...",
              questions: [mcq({prompt: "Q2"}), mcq({prompt: "Q3"})],
            },
            // Q4…Q20 were never emitted because the token budget ran out
          ],
        },
        stopReason: "max_tokens",
        model: "test-model",
        usage: {inputTokens: 2000, outputTokens: 8000},
      }),
    },
  );

  // The partial sections that arrived must still be returned.
  assert.equal(result.extractedCount, 3, "partial sections must be returned, not discarded");
  assert.equal(result.sections.length, 2);

  // A clear user-visible warning must be surfaced.
  assert.ok(
    result.warnings.some((w) => /token limit|output-token|token budget/i.test(w)),
    `expected a max_tokens warning, got: ${JSON.stringify(result.warnings)}`,
  );
});

test("runScannedQuizImport does NOT warn about max_tokens when stopReason is 'tool_use' (normal)", async () => {
  const result = await runScannedQuizImport(
    {pages: [{pageNumber: 1, dataUrl: dataUrl()}], anthropicKey: "k", geminiKey: ""},
    {
      callGemini: async () => "{}",
      callClaude: async () => ({
        parsed: {sections: [{kind: "standalone", question: mcq({prompt: "Q1"})}]},
        stopReason: "tool_use",
        model: "test-model",
      }),
    },
  );
  assert.equal(result.extractedCount, 1);
  assert.ok(
    !result.warnings.some((w) => /token limit|output-token|token budget/i.test(w)),
    "no max_tokens warning when stop was normal",
  );
});

test("runScannedQuizImport uses maxTokens 16000 in the callClaude call", async () => {
  let capturedMaxTokens;
  await runScannedQuizImport(
    {pages: [{pageNumber: 1, dataUrl: dataUrl()}], anthropicKey: "k", geminiKey: ""},
    {
      callGemini: async () => "{}",
      callClaude: async (_key, opts) => {
        capturedMaxTokens = opts.maxTokens;
        return {parsed: {sections: []}, stopReason: "tool_use", model: "test-model"};
      },
    },
  );
  assert.ok(
    capturedMaxTokens >= 16000,
    `maxTokens must be >= 16000 to avoid truncation on English batches (got ${capturedMaxTokens})`,
  );
});

// ── Diagram detection + classification ──────────────────────────────────────

const box = (over = {}) => ({x: 0.1, y: 0.1, w: 0.4, h: 0.4, ...over});

test("classifyDiagram preserves complex/realistic figures as images", () => {
  for (const kind of ["map", "labelled_science", "body_part", "plant", "animal", "tool", "food_chart", "circuit", "photo"]) {
    assert.equal(
      classifyDiagram({kind, complexity: "complex", confidence: 0.9}),
      "preserve",
      `${kind} should preserve`,
    );
  }
});

test("classifyDiagram recreates simple figures as editable diagrams", () => {
  for (const kind of ["number_line", "shape", "venn", "bar_chart", "line_graph", "pie_chart", "table", "measurement"]) {
    assert.equal(
      classifyDiagram({kind, complexity: "simple", confidence: 0.9}),
      "recreate",
      `${kind} should recreate`,
    );
  }
});

test("classifyDiagram routes low-confidence and unsure figures to review", () => {
  assert.equal(classifyDiagram({kind: "map", complexity: "complex", confidence: 0.2}), "review");
  assert.equal(classifyDiagram({kind: "shape", complexity: "unsure", confidence: 0.9}), "review");
  assert.equal(classifyDiagram({kind: "other", complexity: "complex", confidence: 0.9}), "review");
  assert.equal(classifyDiagram({kind: "", confidence: 0.9}), "review");
});

test("classifyDiagram cleans an unrecognised line drawing", () => {
  assert.equal(classifyDiagram({kind: "drawing", complexity: "simple", confidence: 0.8}), "recreate");
  assert.equal(classifyDiagram({kind: "drawing", confidence: 0.8}), "clean");
});

test("sanitiseDiagram drops a figure with no usable box", () => {
  assert.equal(sanitiseDiagram({kind: "map", confidence: 0.9}), null);
  assert.equal(sanitiseDiagram({box: {x: 0, y: 0, w: 0.001, h: 0.001}, kind: "map"}), null);
});

test("sanitiseDiagram normalises a valid figure with a classification", () => {
  const d = sanitiseDiagram({box: box(), caption: "Fig. 1", kind: "MAP", complexity: "complex", confidence: 0.91});
  assert.ok(d);
  assert.equal(d.kind, "map");
  assert.equal(d.caption, "Fig. 1");
  assert.equal(d.classification, "preserve");
  assert.equal(d.confidence, 0.91);
  assert.deepEqual(d.box, {x: 0.1, y: 0.1, w: 0.4, h: 0.4});
});

test("sanitiseDiagram defaults missing complexity/confidence safely", () => {
  const d = sanitiseDiagram({box: box(), kind: "number_line"});
  assert.equal(d.complexity, "unsure"); // unknown complexity → unsure
  assert.equal(d.confidence, 0.5);
  assert.equal(d.classification, "review"); // unsure wins → review
});

test("sanitiseDiagrams drops boxless entries and caps the count", () => {
  const raws = [
    {box: box(), kind: "map", complexity: "complex", confidence: 0.9},
    {kind: "map"}, // no box → dropped
    ...Array.from({length: 10}, () => ({box: box(), kind: "shape", complexity: "simple", confidence: 0.9})),
  ];
  const out = sanitiseDiagrams(raws);
  assert.ok(out.length <= 6, "capped at MAX_DIAGRAMS_PER_QUESTION");
  assert.ok(out.every((d) => d.box));
});

test("normaliseScannedQuestion attaches diagrams and forces hasDiagram", () => {
  const q = normaliseScannedQuestion(
    mcq({
      prompt: "Study the diagram and name part A",
      hasDiagram: false, // model forgot the flag …
      diagrams: [{box: box(), kind: "labelled_science", complexity: "complex", confidence: 0.88}],
    }),
    [3],
  );
  assert.equal(q.hasDiagram, true, "diagrams[] present must force hasDiagram");
  assert.equal(q.diagrams.length, 1);
  assert.equal(q.diagrams[0].classification, "preserve");
});

test("normaliseScannedQuestion leaves diagrams empty for a text-only question", () => {
  const q = normaliseScannedQuestion(mcq(), []);
  assert.deepEqual(q.diagrams, []);
  assert.equal(q.hasDiagram, false);
});

test("map passage carries its shared diagrams and hasImage", () => {
  const sections = normaliseScannedSections(
    [{
      kind: "passage",
      passageKind: "map",
      title: "Map of Zambia",
      diagrams: [{box: box(), kind: "map", complexity: "complex", confidence: 0.95}],
      questions: [mcq({prompt: "Which province is shaded?"})],
    }],
    [2],
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].hasImage, true);
  assert.equal(sections[0].diagrams.length, 1);
  assert.equal(sections[0].diagrams[0].classification, "preserve");
});

test("the OCR schema and prompt include diagram detection", () => {
  assert.ok(SCANNED_TOOL_SCHEMA.$defs.diagram, "schema defines a diagram shape");
  assert.ok(SCANNED_TOOL_SCHEMA.$defs.question.properties.diagrams, "questions carry diagrams[]");
  assert.match(CLAUDE_SYSTEM_PROMPT, /NEVER LEAVE THEM OUT/);
  assert.match(CLAUDE_SYSTEM_PROMPT, /complexity/);
});

// ── question typing + marks (beyond MCQ) ─────────────────────────────────────
test("schema + prompt ask for questionType and marks", () => {
  assert.ok(SCANNED_TOOL_SCHEMA.$defs.question.properties.questionType, "schema carries questionType");
  assert.ok(SCANNED_TOOL_SCHEMA.$defs.question.properties.marks, "schema carries marks");
  // options must allow an empty array now (non-MCQ items have none).
  assert.equal(SCANNED_TOOL_SCHEMA.$defs.question.properties.options.minItems, 0);
  assert.match(CLAUDE_SYSTEM_PROMPT, /questionType/);
  assert.match(CLAUDE_SYSTEM_PROMPT, /short_answer/);
});

test("keeps an explicit short_answer question with no options", () => {
  const q = normaliseScannedQuestion(
    {sourceQuestionNumber: 7, prompt: "Explain why plants need sunlight.", options: [], questionType: "short_answer"},
    [1],
  );
  assert.ok(q, "short-answer question is kept");
  assert.equal(q.type, "short_answer");
  assert.deepEqual(q.options, []);
  assert.equal(q.correctAnswer, "");
  assert.equal(q.requiresReview, true);
});

test("keeps a fill_blank question with no options", () => {
  const q = normaliseScannedQuestion(
    {prompt: "Water boils at ____ degrees Celsius.", options: [], questionType: "fill_blank"},
    [1],
  );
  assert.ok(q);
  assert.equal(q.type, "fill_blank");
});

test("synthesises True/False options for a typed true_false item", () => {
  const q = normaliseScannedQuestion(
    {prompt: "The sun is a star.", options: [], questionType: "true_false"},
    [1],
  );
  assert.ok(q);
  assert.equal(q.type, "true_false");
  assert.deepEqual(q.options, ["True", "False"]);
});

test("auto-types a True/False option pair without an explicit type", () => {
  const q = normaliseScannedQuestion(
    {prompt: "Ice is frozen water.", options: ["True", "False"]},
    [1],
  );
  assert.equal(q.type, "true_false");
});

test("still drops a 1-option fragment when no explicit non-MCQ type is given", () => {
  // The MCQ gate is unchanged for untyped items — a misread fragment is junk.
  assert.equal(normaliseScannedQuestion({prompt: "x", options: ["a"]}, [1]), null);
});

test("carries marks from the model and from a trailing annotation", () => {
  const fromModel = normaliseScannedQuestion(
    {prompt: "Name two organs.", options: [], questionType: "short_answer", marks: 4},
    [1],
  );
  assert.equal(fromModel.marks, 4);
  const fromStem = normaliseScannedQuestion(
    {prompt: "Describe the water cycle. [5 marks]", options: [], questionType: "short_answer"},
    [1],
  );
  assert.equal(fromStem.marks, 5);
  const dflt = normaliseScannedQuestion(
    {prompt: "What is 2 plus 2?", options: ["3", "4", "5", "6"]},
    [1],
  );
  assert.equal(dflt.marks, 1);
});

// ── matching columns + word bank ─────────────────────────────────────────────
test("schema carries matching columns + a word bank", () => {
  const props = SCANNED_TOOL_SCHEMA.$defs.question.properties;
  assert.ok(props.matchingLeft && props.matchingRight, "schema carries matching columns");
  assert.ok(props.wordBank, "schema carries a word bank");
  assert.match(CLAUDE_SYSTEM_PROMPT, /matchingLeft/);
  assert.match(CLAUDE_SYSTEM_PROMPT, /wordBank/);
});

test("carries matching columns for a matching question (no pairing guessed)", () => {
  const q = normaliseScannedQuestion(
    {
      prompt: "Match the animal to its home.",
      options: [],
      questionType: "matching",
      matchingLeft: ["Dog", "Bird", " "],
      matchingRight: ["Kennel", "Nest", ""],
    },
    [1],
  );
  assert.equal(q.type, "matching");
  assert.deepEqual(q.matchingLeft, ["Dog", "Bird"]); // blanks dropped
  assert.deepEqual(q.matchingRight, ["Kennel", "Nest"]);
  assert.equal(q.correctAnswer, ""); // never guessed
});

test("does not attach matching columns to a non-matching question", () => {
  const q = normaliseScannedQuestion(
    {prompt: "Pick one", options: ["a", "b"], matchingLeft: ["x"], matchingRight: ["y"]},
    [1],
  );
  assert.deepEqual(q.matchingLeft, []);
  assert.deepEqual(q.matchingRight, []);
});

test("carries a printed word bank on a fill_blank question", () => {
  const q = normaliseScannedQuestion(
    {prompt: "The capital of Zambia is ____.", options: [], questionType: "fill_blank", wordBank: ["Lusaka", "Ndola", ""]},
    [1],
  );
  assert.deepEqual(q.wordBank, ["Lusaka", "Ndola"]);
});

// ── label-the-diagram ────────────────────────────────────────────────────────
test("schema + prompt carry diagram_label + diagramLabels", () => {
  const props = SCANNED_TOOL_SCHEMA.$defs.question.properties;
  assert.ok(props.questionType.enum.includes("diagram_label"), "questionType enum includes diagram_label");
  assert.ok(props.diagramLabels, "schema carries diagramLabels");
  assert.match(CLAUDE_SYSTEM_PROMPT, /diagram_label/);
  assert.match(CLAUDE_SYSTEM_PROMPT, /diagramLabels/);
});

test("keeps a diagram_label question: optionless, hasDiagram, labels carried", () => {
  const q = normaliseScannedQuestion(
    {
      prompt: "Study the diagram and label the parts marked A, B and C.",
      options: [],
      questionType: "diagram_label",
      diagramLabels: ["A", "B", "C", " "],
      hasDiagram: true,
    },
    [1],
  );
  assert.ok(q);
  assert.equal(q.type, "diagram_label");
  assert.deepEqual(q.options, []);
  assert.equal(q.hasDiagram, true);
  assert.deepEqual(q.diagramLabels, ["A", "B", "C"]); // blank dropped
});

test("diagram_label implies hasDiagram even if the model forgot the flag", () => {
  const q = normaliseScannedQuestion(
    {prompt: "Label the parts of the flower.", options: [], questionType: "diagram_label", diagramLabels: ["petal"]},
    [1],
  );
  assert.equal(q.hasDiagram, true);
});

test("does not attach diagramLabels to a non-diagram-label question", () => {
  const q = normaliseScannedQuestion(
    {prompt: "Explain why.", options: [], questionType: "short_answer", diagramLabels: ["A", "B"]},
    [1],
  );
  assert.deepEqual(q.diagramLabels, []);
});

// ── answer spaces + section heading ──────────────────────────────────────────
test("schema + prompt carry answerLines + sectionTitle", () => {
  const props = SCANNED_TOOL_SCHEMA.$defs.question.properties;
  assert.ok(props.answerLines, "schema carries answerLines");
  assert.match(CLAUDE_SYSTEM_PROMPT, /answerLines/);
  assert.match(CLAUDE_SYSTEM_PROMPT, /sectionTitle/);
});

test("carries answerLines for a written-answer question, clamps, null elsewhere", () => {
  const written = normaliseScannedQuestion(
    {prompt: "Describe the water cycle.", options: [], questionType: "short_answer", answerLines: 6},
    [1],
  );
  assert.equal(written.answerLines, 6);
  // Clamp absurd counts.
  const clamped = normaliseScannedQuestion(
    {prompt: "Explain.", options: [], questionType: "short_answer", answerLines: 999},
    [1],
  );
  assert.equal(clamped.answerLines, 30);
  // MCQ never carries answer lines.
  const mcq = normaliseScannedQuestion(
    {prompt: "Pick one", options: ["a", "b", "c", "d"], answerLines: 4},
    [1],
  );
  assert.equal(mcq.answerLines, null);
});

test("carries the printed section heading", () => {
  const q = normaliseScannedQuestion(
    {prompt: "Pick one", options: ["a", "b"], sectionTitle: "Section B"},
    [1],
  );
  assert.equal(q.sectionTitle, "Section B");
});

console.log(`\nscannedQuizImport: ${passed} passed`);
