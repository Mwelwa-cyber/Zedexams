/**
 * The learner-notes validator.
 *
 * The load-bearing assertion is the first one: whatever the model returns, the
 * learner's exercise comes back structurally incapable of holding an answer.
 * Every renderer downstream — the preview, the PDF, the Word export, the share
 * page — trusts that rather than re-checking it, so if it is ever untrue it is
 * untrue in four places at once and visible in none of them until a class is
 * handed the answers.
 *
 * Run: node functions/teacherTools/learnerNotesSchema.test.js
 */

const assert = require("node:assert");
const {validateLearnerNotes, replaceLearnerSection} = require("./learnerNotesSchema");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `${name}${detail ? `\n      ${detail}` : ""}`);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const OPTIONS = {
  audience: "learner", format: "handout", detail: "detailed",
  length: "one", englishLevel: "standard", paperSize: "a4",
};

function input(overrides = {}) {
  return {
    header: {title: "Digestion", grade: "Grade 7", subject: "Integrated Science", topic: "Digestion"},
    learningOutcomes: ["You will be able to name the parts of your digestive system."],
    sections: [{
      heading: "Your mouth",
      body: ["Your teeth cut food into small pieces."],
      definitions: [{term: "saliva", meaning: "the water in your mouth"}],
      recap: "Digestion starts in your mouth.",
    }],
    workedExamples: [],
    dontMixThese: [],
    learnerQuestions: [{question: "Why does my stomach rumble?", answer: "Muscles squeezing air."}],
    rememberBox: ["Digestion starts in your mouth."],
    exercise: {
      instructions: "Answer in your book.",
      questions: [
        {prompt: "Name two parts.", marks: 2, type: "recall", answer: "mouth, stomach", markingNote: "One each."},
        {prompt: "Why chew?", marks: 2, type: "apply", answer: "So it is small enough to swallow."},
      ],
    },
    ...overrides,
  };
}

/* ── The answers ───────────────────────────────────────────────────────── */

{
  const {ok: valid, value} = validateLearnerNotes(input(), OPTIONS);
  ok("a complete document validates", valid);
  ok("the exercise carries NO answer field, at any depth",
      !JSON.stringify(value.exercise).includes("answer"),
      JSON.stringify(value.exercise));
  ok("the answers moved to the answer key", value.answerKey.answers.length === 2);
  ok("the marking note moved with them", value.answerKey.answers[0].note === "One each.");
  ok("question numbers are the printed order",
      value.exercise.questions.map((q) => q.number).join() === "1,2");
  ok("the key is numbered to match",
      value.answerKey.answers.map((a) => a.number).join() === "1,2");
}

{
  // The model is asked for `answer`; a model that instead puts the answer in a
  // field nobody named must not have it printed. Anything not on the question's
  // known shape is dropped rather than passed through.
  const {value} = validateLearnerNotes(input({
    exercise: {questions: [{prompt: "Name two parts.", answer: "mouth", solution: "mouth, stomach"}]},
  }), OPTIONS);
  ok("an unknown field on a question is dropped, not printed",
      !JSON.stringify(value.exercise).includes("stomach"));
}

{
  const {value} = validateLearnerNotes(input({exercise: {questions: [{prompt: "Name two parts."}]}}), OPTIONS);
  ok("a question with no answer still gets a key entry",
      value.answerKey.answers.length === 1 && value.answerKey.answers[0].answer === "—",
      "a missing answer must be visible to the teacher, not absent from the page");
}

/* ── Format ────────────────────────────────────────────────────────────── */

{
  const {value} = validateLearnerNotes(input(), {...OPTIONS, format: "board"});
  ok("board notes drop the FAQ even when the model returned one",
      value.learnerQuestions.length === 0);
  ok("board notes keep the Remember! box", value.rememberBox.length === 1);
  ok("board notes keep the exercise", value.exercise.questions.length === 2);
}

/* ── Required parts ────────────────────────────────────────────────────── */

for (const [name, patch] of [
  ["with no outcomes", {learningOutcomes: []}],
  ["with no notes body", {sections: []}],
  ["with no Remember! summary", {rememberBox: []}],
  ["with no exercise", {exercise: {questions: []}}],
]) {
  const result = validateLearnerNotes(input(patch), OPTIONS);
  ok(`a document ${name} is flagged`, result.ok === false);
  ok(`…and still returns a usable value`, Boolean(result.value),
      "a flagged document is one the teacher already paid for — it must come back");
}

/* ── Server-owned fields ───────────────────────────────────────────────── */

{
  const {value} = validateLearnerNotes(input(), OPTIONS, {
    grounding: {grounded: true, outcomes: ["describe the parts"], count: 1},
    diagrams: [{placement: "exercise", libraryKey: "digestivesystem"}],
    diagramLabels: [{number: 1, name: "oesophagus"}],
    diagramCaption: "Digestive system",
  });
  ok("grounding is carried on the document", value.grounding.grounded === true);
  ok("the diagram blocks are carried", value.diagrams.length === 1);
  ok("the diagram's labels are on the ANSWER key only",
      value.answerKey.diagramLabels.length === 1
      && !JSON.stringify(value.sections).includes("oesophagus")
      && !JSON.stringify(value.exercise).includes("oesophagus"),
      "a part name that reaches the learner's pages is the answer, printed");
}

{
  // A document with no grounding extras must still say something definite:
  // `grounded: false` is a state the studio renders, an absent field is not.
  const {value} = validateLearnerNotes(input(), OPTIONS);
  ok("grounding is never absent", value.grounding && value.grounding.grounded === false);
}

/* ── Section replacement ───────────────────────────────────────────────── */

{
  const {value} = validateLearnerNotes(input(), OPTIONS);
  const fresh = {sections: [{heading: "Rewritten", body: ["New."], definitions: [], recap: ""}]};
  const next = replaceLearnerSection(value, "sections", fresh);
  ok("the named section is replaced", next.sections[0].heading === "Rewritten");
  ok("every other part keeps its IDENTITY, not just its value",
      next.rememberBox === value.rememberBox && next.exercise === value.exercise,
      "a deep copy that happens to be equal is a different claim");
}

{
  const {value} = validateLearnerNotes(input(), OPTIONS);
  const next = replaceLearnerSection(value, "exercise", {
    exercise: {instructions: "Try these.", questions: [{number: 1, prompt: "New question?"}]},
    answerKey: {answers: [{number: 1, answer: "New answer."}]},
  });
  ok("replacing the exercise replaces its answer key too",
      next.answerKey.answers[0].answer === "New answer.",
      "a key answering questions nobody asked is worse than no key");
}

{
  const {value} = validateLearnerNotes(input(), OPTIONS);
  ok("an empty rewrite leaves the document alone",
      replaceLearnerSection(value, "sections", {sections: []}).sections === value.sections);
}

console.log(`\nAll learner-notes schema tests passed (${passed} assertions).`);
