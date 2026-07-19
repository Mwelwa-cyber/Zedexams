/**
 * Renderer tests — model shape + real DOCX/PDF buffer generation.
 * Run: node functions/assessmentExports/renderers.test.js
 */

const assert = require("node:assert");
// These renderers need functions-only deps (docx / pdfkit). The root CI "Tests"
// job installs only root deps, so skip cleanly there; the deploy-firebase
// workflow (and local runs with functions deps) exercise it fully.
try {
  require.resolve("docx");
  require.resolve("pdfkit");
} catch {
  console.log("renderers: skipped (functions deps not installed)");
  process.exit(0);
}
const {buildServerPaperModel, canonType, schemeAnswer} = require("./renderModel");
const {buildAssessmentDocxBuffer} = require("./renderDocx");
const {buildAssessmentPdfBuffer} = require("./renderPdf");

const assessment = {
  createdBy: "t1", title: "End of Term Test", grade: "4", subject: "Mathematics",
  assessmentType: "end_of_term", term: "1", year: 2026,
  schoolName: "Lusaka Primary", motto: "Learn and Grow",
  coverInstructions: "Answer ALL questions in the spaces provided.",
  showNameField: true, showMarksField: true, duration: "1 hour",
};
const questions = [
  {order: 1, type: "mcq", text: "What is 2 + 2?", marks: 1, options: ["3", "4", "5"], correctAnswer: 1},
  {order: 2, type: "true_false", text: "The sun is a star.", marks: 1, correctAnswer: true},
  {order: 3, type: "short_answer", text: "Name a 2D shape.", marks: 2, correctAnswer: "circle"},
  {order: 4, type: "essay", text: "Explain the water cycle.", marks: 6, correctAnswer: "Evaporation, condensation, precipitation."},
  {order: 5, type: "structured", text: "Label the diagram.", marks: 4, imageUrl: "https://example.com/x.png"},
];

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

(async () => {
  // ── model ──────────────────────────────────────────────────
  await test("model builds a title, header and questions", () => {
    const m = buildServerPaperModel(assessment, questions, "paper");
    assert.match(m.title, /GRADE FOUR END OF TERM 1 TEST - 2026/);
    assert.ok(m.headerLines.includes("Lusaka Primary"));
    assert.strictEqual(m.blocks.filter((b) => b.kind === "question").length, 5);
    assert.strictEqual(m.totalMarks, 14);
  });

  await test("model collects image refs for diagram questions", () => {
    const m = buildServerPaperModel(assessment, questions, "paper");
    assert.strictEqual(m.imageRefs.length, 1);
    assert.strictEqual(m.imageRefs[0].url, "https://example.com/x.png");
  });

  await test("paper mode hides answers; scheme mode reveals them", () => {
    const paper = buildServerPaperModel(assessment, questions, "paper");
    const scheme = buildServerPaperModel(assessment, questions, "scheme");
    assert.ok(paper.blocks.filter((b) => b.kind === "question").every((b) => !b.answer));
    const mcq = scheme.blocks.find((b) => b.kind === "question" && b.n === 1);
    assert.match(mcq.answer, /B\. 4/);
    assert.ok(scheme.blocks.some((b) => b.kind === "schemeBanner"));
  });

  await test("canonType folds aliases", () => {
    assert.strictEqual(canonType({type: "tf"}), "true_false");
    assert.strictEqual(canonType({type: "structured"}), "diagram");
    assert.strictEqual(canonType({type: "long_answer"}), "essay");
  });

  await test("schemeAnswer resolves mcq / true_false", () => {
    assert.match(schemeAnswer({correctAnswer: 1, options: ["a", "b"]}, "mcq"), /B\. b/);
    assert.strictEqual(schemeAnswer({correctAnswer: true}, "true_false"), "True");
  });

  // ── DOCX ───────────────────────────────────────────────────
  await test("DOCX buffer is a valid non-empty zip (PK header)", async () => {
    const buf = await buildAssessmentDocxBuffer(assessment, questions, {mode: "paper"});
    assert.ok(Buffer.isBuffer(buf) && buf.length > 1000);
    assert.strictEqual(buf.slice(0, 2).toString("ascii"), "PK");
  });

  await test("DOCX scheme mode renders without throwing", async () => {
    const buf = await buildAssessmentDocxBuffer(assessment, questions, {mode: "scheme", attribution: true});
    assert.ok(buf.length > 1000);
  });

  await test("DOCX handles a diagram-heavy paper with missing images (placeholder)", async () => {
    const many = Array.from({length: 40}, (_, i) => ({
      order: i + 1, type: "structured", text: `Q${i + 1}`, marks: 3, imageUrl: `https://x/${i}.png`,
    }));
    const buf = await buildAssessmentDocxBuffer(assessment, many, {mode: "paper", images: {}});
    assert.ok(buf.length > 1000);
  });

  await test("DOCX embeds a real PNG diagram (ImageRun) without throwing", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64");
    const q = [{order: 1, type: "structured", text: "See figure.", marks: 3, imageUrl: "https://x/fig.png"}];
    const buf = await buildAssessmentDocxBuffer(assessment, q, {mode: "paper", images: {"https://x/fig.png": {buffer: png}}});
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.slice(0, 2).toString("ascii"), "PK");
  });

  // ── PDF ────────────────────────────────────────────────────
  await test("PDF buffer is a valid non-empty PDF (%PDF header)", async () => {
    const buf = await buildAssessmentPdfBuffer(assessment, questions, {mode: "paper"});
    assert.ok(Buffer.isBuffer(buf) && buf.length > 500);
    assert.strictEqual(buf.slice(0, 4).toString("ascii"), "%PDF");
  });

  await test("PDF scheme mode + attribution renders without throwing", async () => {
    const buf = await buildAssessmentPdfBuffer(assessment, questions, {mode: "scheme", attribution: true});
    assert.ok(buf.length > 500);
  });

  console.log(`\nrenderers: ${passed} tests passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
