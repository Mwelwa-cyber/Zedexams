/**
 * The server export gate.
 *
 * The property under test is not "the server has a check" — it is that the
 * server reaches the SAME verdict, with the SAME sentence, as the studio, for
 * the same paper. A server gate that refuses for its own reasons is a second
 * rule set, and the teacher would be told two different things about one paper
 * depending on which entry point they used.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

const assert = require("node:assert/strict");

const {assessExportReadiness, canonicalizeQuestions} = require("./exportReadiness");

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push([name, fn]);
}

const question = (over = {}) => ({
  _id: over._id || "q1",
  order: over.order ?? 0,
  type: "short_answer",
  text: "<p>Name the largest river in Zambia.</p>",
  marks: 2,
  ...over,
});

const paper = {id: "a1", title: "Topic Test", subject: "Geography", grade: "7", passages: []};

/* ── canonicalisation ──────────────────────────────────────────────────── */

test("questions are ordered by `order`, and ties keep the order they arrived in", () => {
  const out = canonicalizeQuestions([
    question({_id: "c", order: 2}),
    question({_id: "a", order: 0}),
    question({_id: "b", order: 1}),
  ]);
  assert.deepEqual(out.map((q) => q._id), ["a", "b", "c"]);

  // Duplicate `order` is the case that decides whether numbering is stable.
  // An unstable sort here renumbers the paper between two calls, and
  // "Question 2 is not finished" names a different question each time.
  const tied = [question({_id: "x", order: 1}), question({_id: "y", order: 1})];
  assert.deepEqual(canonicalizeQuestions(tied).map((q) => q._id), ["x", "y"]);
  assert.deepEqual(canonicalizeQuestions(tied).map((q) => q._id), ["x", "y"]);
});

test("a question with no `order` sorts after the ones that have it, not to the front", () => {
  const out = canonicalizeQuestions([
    question({_id: "none", order: undefined}),
    question({_id: "first", order: 0}),
  ]);
  // Number(undefined) is NaN, and NaN comparisons are all false — left to a
  // naive comparator this question wanders to wherever the sort happens to
  // leave it.
  assert.deepEqual(out.map((q) => q._id), ["first", "none"]);
});

test("canonicalisation drops its own bookkeeping", () => {
  const [only] = canonicalizeQuestions([question()]);
  assert.ok(!("__position" in only), "the position marker must not reach the renderers");
});

/* ── the verdicts ──────────────────────────────────────────────────────── */

test("a paper with no questions is refused, in the studio’s words", async () => {
  const r = await assessExportReadiness(paper, []);
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "empty");
  assert.equal(r.message, "Add at least one question before you download or print this paper.");
});

test("a required diagram the catalogue cannot draw is refused, naming the question", async () => {
  const r = await assessExportReadiness(paper, [
    question({_id: "q1", order: 0}),
    question({_id: "q2", order: 1, imageDiagram: {libraryKey: "not-in-the-catalog"}}),
  ]);
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "unresolved-figure");
  // Verbatim, because this is the sentence the client shows for the same paper.
  assert.equal(
    r.message,
    "Question 2 requires a diagram, but the figure could not be rendered. "
    + "Replace, regenerate or repair the diagram before exporting.",
  );
  assert.deepEqual(r.numbers, [2]);
});

test("the figure check reads the real catalogue, not a stub that says yes", async () => {
  // A resolver that always succeeded would make every paper pass and every test
  // above still go green. This pins that a REAL catalogue key resolves and a
  // made-up one does not, through the same call the renderers make.
  const {renderDiagramSvg} = await import("../shared/assessment/diagramCatalogCore.js");
  const {DIAGRAM_CATALOG} = await import("../shared/assessment/diagramCatalogCore.js");
  const realKey = Object.keys(DIAGRAM_CATALOG)[0];
  assert.ok(realKey, "the catalogue has shapes");
  assert.ok(renderDiagramSvg(realKey, {}), `the catalogue draws ${realKey}`);
  assert.ok(!renderDiagramSvg("not-in-the-catalog", {}), "and refuses a key it does not have");

  const r = await assessExportReadiness(paper, [
    question({imageDiagram: {libraryKey: realKey}}),
  ]);
  assert.equal(r.blocked, false, "a paper whose diagram the catalogue CAN draw is not blocked");
});

test("a passage diagram is checked too, and falls back to the generic sentence", async () => {
  const r = await assessExportReadiness(
    {...paper, passages: [{id: "p1", title: "The Zambezi", imageDiagram: {libraryKey: "nope"}}]},
    [question()],
  );
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "unresolved-figure");
  assert.match(r.message, /A question on this paper requires a diagram/);
});

test("an option diagram is checked at optionMedia, where the exporter reads it", async () => {
  const r = await assessExportReadiness(paper, [
    question({type: "mcq", options: ["a", "b"], correctAnswer: 0,
      optionMedia: [null, {diagram: {libraryKey: "nope"}}]}),
  ]);
  assert.equal(r.blocked, true, "an unrenderable option diagram blocks the export");
});

test("a finished paper is allowed through", async () => {
  const r = await assessExportReadiness(paper, [question({_id: "q1"}), question({_id: "q2", order: 1})]);
  assert.equal(r.blocked, false);
  assert.equal(r.reason, "ready");
  assert.equal(r.message, "");
});

test("the numbers in the message are the numbers on the page", async () => {
  // `order` and array position disagree here. The message must follow the
  // printed order, which is what canonicalisation settles.
  const r = await assessExportReadiness(paper, [
    question({_id: "second", order: 5, imageDiagram: {libraryKey: "nope"}}),
    question({_id: "first", order: 1}),
  ]);
  assert.deepEqual(r.numbers, [2], "the broken question prints second, so it is question 2");
});

/* ── what the caller is not allowed to claim ───────────────────────────── */

test("nothing the client sends can unblock a paper", async () => {
  // These are the fields a bypass would try. They are not parameters of
  // assessExportReadiness at all — it takes the stored paper and nothing else —
  // so this asserts the SHAPE of the contract, which is the thing that would
  // have to change for a bypass to become possible.
  assert.equal(assessExportReadiness.length, 2, "readiness takes (assessment, questions) — no options bag");
  const r = await assessExportReadiness(
    {...paper, ready: true, allowUnresolvedFigures: true},
    [question({imageDiagram: {libraryKey: "nope"}, ready: true, allowUnresolvedFigures: true})],
  );
  assert.equal(r.blocked, true, "a claim carried on the documents themselves changes nothing either");
});

(async () => {
  for (const [name, fn] of pending) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok  ${name}`);
    } catch (err) {
      console.error(`  ✗   ${name}\n      ${err.message}`);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) console.log(`\n✓ server export readiness — ${passed} tests passed`);
})();
