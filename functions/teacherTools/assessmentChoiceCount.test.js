/**
 * Making the generator produce exactly the configured number of choices.
 *
 * The case that decides the design: the model puts the correct answer LAST and
 * writes five options on a paper set to four. `options.slice(0, 4)` produces a
 * question that prints cleanly, looks finished, and cannot be answered
 * correctly.
 *
 * Plain `node` assertion script (see CLAUDE.md "Two test suites").
 */

const assert = require("node:assert/strict");
const {
  answerChoiceDirective, applyAnswerChoiceCount, correctOptionIndex,
  normalizeRequestedCount, trimQuestionOptions,
} = require("./assessmentChoiceCount");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  ✗   ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

const paper = (questions) => ({sections: [{title: "A", questions}]});
const mcq = (over) => ({number: 1, type: "multiple_choice", ...over});

console.log("\n— the requested count —");

test("only a usable count is accepted; anything else means 'as the model wrote it'", () => {
  assert.equal(normalizeRequestedCount(4), 4);
  assert.equal(normalizeRequestedCount("3"), 3);
  assert.equal(normalizeRequestedCount(5), 5);
  assert.equal(normalizeRequestedCount(9), null);
  assert.equal(normalizeRequestedCount(1), null);
  assert.equal(normalizeRequestedCount(undefined), null);
});

console.log("\n— finding the answer —");

test("the answer is matched by text, ignoring case, spacing and a full stop", () => {
  assert.equal(correctOptionIndex(["Heart", "Lung"], "heart"), 0);
  assert.equal(correctOptionIndex(["Heart", "Lung"], "  LUNG. "), 1);
});

test("a bare letter is accepted, because the picture-MCQ path documents it", () => {
  assert.equal(correctOptionIndex(["a", "b", "c"], "C"), 2);
  assert.equal(correctOptionIndex(["a", "b", "c"], "(B)"), 1);
});

test("an answer matching nothing is -1, never a guess at index 0", () => {
  assert.equal(correctOptionIndex(["Heart", "Lung"], "Kidney"), -1);
  assert.equal(correctOptionIndex(["Heart"], ""), -1);
  assert.equal(correctOptionIndex([], "Heart"), -1);
  assert.equal(correctOptionIndex(["a", "b"], "Z"), -1, "a letter beyond the list is not a match");
});

console.log("\n— trimming —");

test("the correct option is kept even when the model put it last", () => {
  const {options, changed, dropped} = trimQuestionOptions(
      {options: ["w", "x", "y", "z", "RIGHT"], answer: "RIGHT"}, 4);
  assert.equal(changed, true);
  assert.equal(dropped, 1);
  assert.ok(options.includes("RIGHT"));
  assert.equal(options.length, 4);
});

test("the surplus comes off the distractors, in the order the model wrote them", () => {
  const {options} = trimQuestionOptions(
      {options: ["RIGHT", "x", "y", "z", "extra"], answer: "RIGHT"}, 3);
  assert.deepEqual(options, ["RIGHT", "x", "y"]);
});

test("a question already at the count is untouched", () => {
  const q = {options: ["a", "b", "c", "d"], answer: "a"};
  const {options, changed} = trimQuestionOptions(q, 4);
  assert.equal(changed, false);
  assert.equal(options, q.options);
});

test("a question whose answer cannot be found is left alone rather than trimmed blind", () => {
  // Trimming here would be as likely to delete the answer as to keep it. The
  // untrimmed question is reported and blocked; a silently broken one is not.
  const {options, changed} = trimQuestionOptions(
      {options: ["a", "b", "c", "d", "e"], answer: "nothing like these"}, 4);
  assert.equal(changed, false);
  assert.equal(options.length, 5);
});

console.log("\n— across a paper —");

test("every multiple-choice question is brought to the count", () => {
  const {assessment, report} = applyAnswerChoiceCount(paper([
    mcq({number: 1, options: ["a", "b", "c", "d", "e"], answer: "a"}),
    mcq({number: 2, options: ["p", "q", "r", "s"], answer: "q"}),
  ]), 4);
  assert.deepEqual(assessment.sections[0].questions.map((q) => q.options.length), [4, 4]);
  assert.deepEqual(report.trimmed, [{number: 1, from: 5, to: 4}]);
});

test("a shortfall is reported, never padded", () => {
  const {assessment, report} = applyAnswerChoiceCount(paper([
    mcq({number: 3, options: ["a", "b", "c"], answer: "a"}),
  ]), 4);
  assert.deepEqual(assessment.sections[0].questions[0].options, ["a", "b", "c"]);
  assert.deepEqual(report.short, [{number: 3, got: 3}]);
});

test("a surplus whose answer could not be matched is reported as unmatched", () => {
  const {report} = applyAnswerChoiceCount(paper([
    mcq({number: 4, options: ["a", "b", "c", "d", "e"], answer: "??"}),
  ]), 4);
  assert.deepEqual(report.unmatched, [{number: 4, got: 5}]);
  assert.deepEqual(report.trimmed, []);
});

test("true/false is never touched — it is two choices by definition", () => {
  const {assessment} = applyAnswerChoiceCount(paper([
    {number: 1, type: "true_false", options: ["True", "False"], answer: "True"},
  ]), 4);
  assert.deepEqual(assessment.sections[0].questions[0].options, ["True", "False"]);
});

test("non-choice questions pass through untouched", () => {
  const {assessment} = applyAnswerChoiceCount(paper([
    {number: 1, type: "short_answer", prompt: "Explain."},
  ]), 4);
  assert.equal(assessment.sections[0].questions[0].type, "short_answer");
});

test("no requested count means the paper comes back exactly as the model wrote it", () => {
  const original = paper([mcq({options: ["a", "b", "c", "d", "e"], answer: "a"})]);
  const {assessment, report} = applyAnswerChoiceCount(original, null);
  assert.equal(assessment, original);
  assert.equal(report.requested, null);
});

test("a malformed payload does not throw", () => {
  assert.doesNotThrow(() => applyAnswerChoiceCount(null, 4));
  assert.doesNotThrow(() => applyAnswerChoiceCount({sections: null}, 4));
  assert.doesNotThrow(() => applyAnswerChoiceCount({sections: [{}]}, 4));
});

console.log("\n— the directive —");

test("the directive states the number AND the letters", () => {
  const text = answerChoiceDirective(3);
  assert.match(text, /EXACTLY 3 options/);
  assert.match(text, /A to C/);
  assert.match(text, /never two options that are the same/);
});

test("no requested count means no directive to concatenate", () => {
  assert.equal(answerChoiceDirective(null), "");
  assert.equal(answerChoiceDirective(99), "");
});

console.log(`\n✓ answer choice count — ${passed} tests passed`);
