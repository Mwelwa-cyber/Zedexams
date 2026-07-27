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
    {...paper,
      passages: [{
        id: "p1",
        title: "The Zambezi",
        // A complete passage, so the figure is the ONLY thing wrong with it —
        // an incomplete passage blocks first, as a paper-level problem, and
        // would mask the rule under test.
        passageText: "<p>The Zambezi rises in north-western Zambia.</p>",
        questions: [{text: "<p>Where does it rise?</p>"}],
        imageDiagram: {libraryKey: "nope"},
      }]},
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

/* ── question completeness, the rule the client had and the server did not ── */

test("an unfinished question is refused, and NAMED, with no localId anywhere", async () => {
  // This is the case the whole identity contract exists for. A stored question
  // has no localId; a collector that went looking for one keys every issue on
  // `undefined`, `incompleteQuestionNumbers` matches nothing, and the paper is
  // blocked under a message that names no question at all.
  const r = await assessExportReadiness(paper, [
    question({_id: "q1", order: 0}),
    question({_id: "q2", order: 1, text: ""}),
  ]);
  assert.equal(r.blocked, true);
  assert.equal(r.reason, "incomplete-questions");
  assert.deepEqual(r.numbers, [2]);
  assert.match(r.message, /^Question 2 is not finished yet/);
  assert.ok(!/undefined|null|NaN/.test(r.message), r.message);
});

test("a question with neither localId nor a document id is still named by its position", async () => {
  const r = await assessExportReadiness(paper, [
    {order: 0, type: "short_answer", text: "<p>Fine.</p>", marks: 1},
    {order: 1, type: "short_answer", text: "", marks: 1},
  ]);
  assert.equal(r.reason, "incomplete-questions");
  assert.deepEqual(r.numbers, [2], "position is a real identity — never an unnamed blocker");
});

test("a paragraph the editor left behind counts as empty", async () => {
  // <p><br></p> is what an editor leaves when a teacher selects a line and
  // deletes it. It is the single most common way a question is blank while
  // looking, in storage, like it has text.
  for (const blank of ["<p></p>", "<p><br></p>", "<p>&nbsp;</p>", "   "]) {
    const r = await assessExportReadiness(paper, [question({text: blank})]);
    assert.equal(r.blocked, true, `${blank} must not pass as question text`);
    assert.equal(r.reason, "incomplete-questions");
  }
});

test("an MCQ with no answer recorded is refused, not read as 'option A'", async () => {
  // Number(null) is 0 — a valid in-range index — so a stored MCQ with no answer
  // used to pass as "A is correct" and print a marking key saying so. The
  // editor's default of 0 means null never occurs in live state, which is why
  // this only surfaced once the rule started reading Firestore documents.
  for (const missing of [null, undefined, ""]) {
    const r = await assessExportReadiness(paper, [
      question({type: "mcq", options: ["Lusaka", "Ndola", "Kitwe", "Livingstone"], correctAnswer: missing}),
    ]);
    assert.equal(r.blocked, true, `correctAnswer: ${String(missing)} must be refused`);
    assert.match(r.message, /Question 1 is not finished/);
  }
  // Zero is still a real answer: option A, chosen.
  const chosen = await assessExportReadiness(paper, [
    question({type: "mcq", options: ["Lusaka", "Ndola"], correctAnswer: 0}),
  ]);
  assert.equal(chosen.blocked, false, "option A deliberately chosen still passes");
});

test("an invalid question structure is refused", async () => {
  const cases = [
    [{type: "mcq", text: "<p>Pick one.</p>", options: ["only one"]}, "one option"],
    [{type: "numeric", text: "<p>How many?</p>", correctAnswer: "not a number"}, "a non-numeric answer"],
    [{type: "wormhole", text: "<p>What?</p>"}, "an unrecognised type"],
    [{type: "matching", text: "<p>Match.</p>", matchingLeft: ["a"], matchingRight: ["b"]}, "one matching pair"],
    [{type: "hotspot", text: "<p>Point at it.</p>"}, "a hotspot with no image"],
  ];
  for (const [q, what] of cases) {
    const r = await assessExportReadiness(paper, [{_id: "q1", order: 0, marks: 1, ...q}]);
    assert.equal(r.blocked, true, `${what} must be refused`);
  }
});

test("paper details are checked, and rank below a named question", async () => {
  const noSubject = await assessExportReadiness({...paper, subject: ""}, [question()]);
  assert.equal(noSubject.blocked, true);
  assert.equal(noSubject.reason, "paper-details");

  // Both wrong: the teacher is sent to the question first, because a paper with
  // an unfinished question is a paper still being written.
  const both = await assessExportReadiness({...paper, subject: ""}, [question({text: ""})]);
  assert.equal(both.reason, "incomplete-questions");
});

test("a text-answer question with no expected answer is NOT blocked", async () => {
  // Deliberate: an empty expected answer tells the runner to have the AI judge
  // from the stem. Blocking it here would refuse papers the studio accepts.
  const r = await assessExportReadiness(paper, [
    question({type: "short_answer", text: "<p>Explain why.</p>", correctAnswer: ""}),
  ]);
  assert.equal(r.blocked, false);
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
