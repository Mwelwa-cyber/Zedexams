/**
 * §6 — the drafter's validation and the review state machine.
 *
 * The rule this exists to keep true: **a bad draft costs a reviewer's time,
 * never a child taught something false.** Two halves —
 *
 *   • the GATE (tested in paperQuizCore.test.js): only `approved` prose is
 *     shown, and the server strips the rest before it reaches the wire.
 *   • the VALIDATOR (here): a draft that a reviewer would have to reject is
 *     never stored as a draft at all, so their attention goes to the one thing
 *     only a person can judge — whether the explanation is TRUE.
 *
 * The case worth the most care is the model's own refusal. The prompt asks it
 * to set `confident: false` rather than guess when the marking scheme does not
 * support an explanation, or when working the question through makes it doubt
 * the answer key. Treating that as an ERROR would train the next prompt
 * revision to stop using it, and a model that stops refusing starts inventing.
 *
 * Run: node functions/paperQuiz/explanationCore.test.js  (test:paper-explanations)
 */
const assert = require("node:assert/strict");

const core = require("./explanationCore");
const {buildUserPrompt, SYSTEM_PROMPT, EXPLANATION_TOOL_SCHEMA} = require("./explanationPrompt");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const QUESTION = {options: ["a", "an", "the", "some"], correctIndex: 1};
const GOOD = {
  why: "Umbrella begins with a vowel sound, so it takes an.",
  distractors: {
    A: "A goes before a consonant sound — a book, a chair.",
    C: "The points to one particular umbrella we already know about.",
    D: "Some is for uncountable things or more than one.",
  },
  example: "an apple · an hour (the h is silent) · a university",
  confident: true,
};

console.log("\nthe validator");

test("a good draft is stored as ai_draft, never as approved", () => {
  // The drafter cannot publish. That is the whole reason the pipeline is safe
  // to run over a 60-question paper unattended.
  const v = core.validateDraft({draft: GOOD, question: QUESTION});
  assert.equal(v.ok, true);
  assert.equal(v.draft.explanationStatus, core.EXPLANATION_STATUS.AI_DRAFT);
  assert.notEqual(v.draft.explanationStatus, core.EXPLANATION_STATUS.APPROVED);
  assert.equal("approvedBy" in v.draft, false, "the drafter stamps no approver");
});

test("the model's own refusal is honoured, and is not an error", () => {
  // Treating it as a failure would train the next prompt revision to stop
  // using it, and a model that stops refusing starts inventing.
  const v = core.validateDraft({
    draft: {confident: false, concern: "the marking scheme gives a different answer"},
    question: QUESTION,
  });
  assert.equal(v.ok, false);
  assert.equal(v.refused, true);
  assert.equal(v.draft, null, "nothing is stored");
  assert.match(v.problems[0], /different answer/, "the reason survives for the reviewer");
});

test("§6's word limits are enforced, not requested", () => {
  const longWhy = {...GOOD, why: Array(45).fill("word").join(" ")};
  assert.match(core.validateDraft({draft: longWhy, question: QUESTION}).problems[0], /45 words \(max 40\)/);
  const longD = {...GOOD, distractors: {...GOOD.distractors, A: Array(35).fill("w").join(" ")}};
  assert.match(core.validateDraft({draft: longD, question: QUESTION}).problems[0], /35 words \(max 30\)/);
  assert.equal(core.WHY_MAX_WORDS, 40);
  assert.equal(core.DISTRACTOR_MAX_WORDS, 30);
});

test('"this is incorrect" is caught by machine, not by a tired reviewer', () => {
  // A reviewer skimming sixty rows approves these: they read as filled-in
  // rather than empty, which is exactly what makes them worth catching here.
  [
    "This is incorrect.", "this is not correct", "That does not fit.",
    "It is not the right answer", "Wrong.", "incorrect", "not the answer",
  ].forEach((phrase) => {
    assert.equal(core.isEmptyPhrase(phrase), true, `"${phrase}" says nothing`);
    const v = core.validateDraft({
      draft: {...GOOD, distractors: {...GOOD.distractors, A: phrase}},
      question: QUESTION,
    });
    assert.equal(v.ok, false, `"${phrase}" is refused`);
    assert.match(v.problems[0], /does not name a mistake/);
  });
  // A real explanation that happens to contain the word "incorrect" is fine.
  assert.equal(core.isEmptyPhrase("A is incorrect because umbrella starts with a vowel sound."), false);
});

test("every wrong option needs a distractor, and the right one must not have one", () => {
  const missing = {...GOOD, distractors: {A: GOOD.distractors.A}};
  const v = core.validateDraft({draft: missing, question: QUESTION});
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /no distractor for C/.test(p)));
  assert.ok(v.problems.some((p) => /no distractor for D/.test(p)));

  // A distractor written against the CORRECT answer means the model marked a
  // different option right — the failure the refusal path exists for.
  const wrongTarget = {...GOOD, distractors: {...GOOD.distractors, B: "B is wrong because…"}};
  const v2 = core.validateDraft({draft: wrongTarget, question: QUESTION});
  assert.equal(v2.ok, false);
  assert.match(v2.problems[0], /distractor was written for B, which is the correct answer/);
});

test("only the wrong options' entries are stored", () => {
  const noisy = {...GOOD, distractors: {...GOOD.distractors, Z: "junk", B: undefined}};
  const v = core.validateDraft({draft: noisy, question: QUESTION});
  assert.deepEqual(Object.keys(v.draft.distractors).sort(), ["A", "C", "D"]);
});

test("an unusable response is refused rather than half-stored", () => {
  assert.equal(core.validateDraft({draft: null, question: QUESTION}).ok, false);
  assert.equal(core.validateDraft({draft: "prose", question: QUESTION}).ok, false);
  assert.equal(core.validateDraft({draft: {}, question: QUESTION}).ok, false);
  assert.equal(core.validateDraft({draft: {...GOOD, example: ""}, question: QUESTION}).ok, false);
});

console.log("\nthe review state machine");

test("approve is the ONLY thing that sets approved, and it stamps who", () => {
  const w = core.buildReviewWrite({action: "approve", reviewerUid: "u1", now: "TS"});
  assert.equal(w.explanationStatus, core.EXPLANATION_STATUS.APPROVED);
  assert.equal(w.approvedBy, "u1");
  assert.equal(w.approvedAt, "TS");
  // Approving does not rewrite the prose — the draft is what was read.
  assert.equal("why" in w, false);
});

test("an edit is approved by definition — there is no stuck middle state", () => {
  const w = core.buildReviewWrite({
    action: "edit",
    edited: {why: " Because. ", distractors: {a: " A is… ", Z: "junk", C: ""}, example: "eg"},
    reviewerUid: "u1",
    now: "TS",
  });
  assert.equal(w.explanationStatus, core.EXPLANATION_STATUS.APPROVED);
  assert.equal(w.why, "Because.", "trimmed");
  assert.deepEqual(w.distractors, {A: "A is…"}, "lowercase keys normalise, junk keys and empties drop");
  assert.equal(w.approvedBy, "u1");
});

test("reject CLEARS the prose rather than leaving it a draft", () => {
  // A rejected explanation that stays on the document is one accidental
  // bulk-approve away from a child reading the thing a reviewer refused.
  const w = core.buildReviewWrite({action: "reject", reviewerUid: "u1", now: "TS"});
  assert.equal(w.explanationStatus, core.EXPLANATION_STATUS.MISSING);
  assert.equal(w.why, "");
  assert.deepEqual(w.distractors, {});
  assert.equal(w.example, "");
  assert.equal(w.approvedBy, "");
  assert.equal(w.approvedAt, null);
});

test("bulk approve touches only what the reviewer was SHOWN and still a draft", () => {
  // A question that arrived between the screen rendering and the button being
  // pressed is not approved — the reviewer did not read it, and that is the
  // entire safeguard on an action whose purpose is not reading one at a time.
  const questions = [
    {id: "q1", explanationStatus: "ai_draft"},
    {id: "q2", explanationStatus: "approved"},
    {id: "q3", explanationStatus: "missing"},
    {id: "q4", explanationStatus: "ai_draft"},   // arrived after the render
  ];
  const picked = core.selectBulkApprovable({questions, requestedIds: ["q1", "q2", "q3"]});
  assert.deepEqual(picked, ["q1"]);
  assert.equal(picked.includes("q4"), false, "an unshown question is never swept up");
  assert.deepEqual(core.selectBulkApprovable({questions, requestedIds: []}), []);
});

console.log("\nthe prompt");

test("the prompt states the marking scheme is the authority", () => {
  // §6: "AI drafts from the paper's marking scheme and the prescribed textbook
  // — NEVER from general knowledge."
  assert.match(SYSTEM_PROMPT, /marking scheme and the syllabus material you are given are the authority/i);
  assert.match(SYSTEM_PROMPT, /Do not work the question out independently/i);
  assert.match(SYSTEM_PROMPT, /confident.*false/is);
});

test("the prompt carries §6's writing rules, including the Zambian one", () => {
  assert.match(SYSTEM_PROMPT, /Grade-7 reading level/);
  assert.match(SYSTEM_PROMPT, /at most 40 words/);
  assert.match(SYSTEM_PROMPT, /at most 30 words/);
  assert.match(SYSTEM_PROMPT, /SPECIFIC mistake/);
  assert.match(SYSTEM_PROMPT, /Mutinta|Chanda|kwacha|maize/);
  assert.match(SYSTEM_PROMPT, /memory hook/);
  // The reader is a child meeting a teacher's voice, not a system.
  assert.match(SYSTEM_PROMPT, /Never mention this system, an AI, a model/i);
});

test("the user turn states the key as GIVEN and lists the options as letters", () => {
  const prompt = buildUserPrompt({
    question: {n: 3, text: "I ..... my homework yesterday.", options: ["do", "did"], correctIndex: 1, topic: "Tenses"},
    paper: {title: "Grade 7 English", subject: "english", grade: 7, year: 2026},
    markingScheme: "B — did. Past simple.",
  });
  assert.match(prompt, /A\. do/);
  assert.match(prompt, /B\. did/);
  assert.match(prompt, /THE CORRECT ANSWER IS B\. This is the paper's own key\. Treat it as given\./);
  assert.match(prompt, /B — did\. Past simple\./, "the marking scheme travels as the source");
  assert.match(prompt, /TOPIC: Tenses/);
});

test("a question with no marking scheme is told to refuse more readily", () => {
  const prompt = buildUserPrompt({
    question: {n: 1, text: "stem", options: ["a", "b"], correctIndex: 0},
    paper: {title: "P"},
    markingScheme: "",
  });
  assert.match(prompt, /No marking scheme is available/);
  assert.match(prompt, /set confident to false rather than reaching for outside/);
});

test("the tool schema requires the refusal flag", () => {
  // Optional, the model omits it, and every draft reads as confident.
  assert.ok(EXPLANATION_TOOL_SCHEMA.required.includes("confident"));
  assert.ok(EXPLANATION_TOOL_SCHEMA.required.includes("why"));
  assert.ok(EXPLANATION_TOOL_SCHEMA.required.includes("distractors"));
  assert.equal(EXPLANATION_TOOL_SCHEMA.additionalProperties, false);
});

if (process.exitCode) console.error("\n✗ paper explanations FAILED");
else console.log(`\n${passed} assertions passed\n`);
