/**
 * regenerateQuestionCore tests — one question, in a fixed slot.
 *
 * The risk with single-question regeneration is not that it fails loudly; it is
 * that it succeeds quietly with a question worth different marks, or on a
 * different topic, and silently unbalances a paper the teacher already approved.
 * So these tests are mostly about what the slot overrides.
 *
 * Run: node functions/teacherTools/regenerateQuestionCore.test.js
 */

const assert = require("node:assert");
const {
  sanitizeSlot, sanitizeRegenerateInputs, validateRegenerateInputs,
  buildRegeneratePrompt, extractSingleQuestion, QUESTION_TOOL_SCHEMA,
} = require("./regenerateQuestionCore");
const {validateAssessment} = require("./assessmentSchema");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

function slot(over = {}) {
  return {
    number: 4, marks: 3, renderType: "multiple_choice",
    activityType: "multiple_choice", activityLabel: "Multiple choice",
    topic: "Photosynthesis", subtopic: "Chlorophyll",
    learningOutcome: "Explain how plants make food",
    bloomLevel: "understand", difficulty: "understanding",
    figureRequired: false, ...over,
  };
}

/* ── the slot is re-checked, not trusted ────────────────────────────────── */

console.log("\n— the slot —");
ok("a real slot survives sanitising", sanitizeSlot(slot()).marks === 3);
ok("a slot with no marks is unusable", sanitizeSlot(slot({marks: 0})) === null);
ok("a fractional marks value is rounded to a whole mark, not refused",
    sanitizeSlot(slot({marks: 1.4})).marks === 1);
ok("marks that are not a number at all are unusable",
    sanitizeSlot(slot({marks: "three"})) === null);
ok("an absurd marks value is refused, not clamped",
    sanitizeSlot(slot({marks: 5000})) === null);
ok("a slot whose structure nothing can render is unusable",
    sanitizeSlot(slot({renderType: "interpretive_dance"})) === null);
ok("no slot at all is unusable",
    sanitizeSlot(null) === null && sanitizeSlot("q4") === null);
ok("an unknown activity falls back to the render type rather than failing",
    sanitizeSlot(slot({activityType: "nonsense"})).activityType === "multiple_choice");
ok("an unknown thinking level falls back to a safe default",
    sanitizeSlot(slot({bloomLevel: "telepathy"})).bloomLevel === "understand");
ok("an unknown difficulty falls back to a safe default",
    sanitizeSlot(slot({difficulty: "impossible"})).difficulty === "understanding");
ok("the British spelling of analyse is accepted as written",
    sanitizeSlot(slot({bloomLevel: "analyse"})).bloomLevel === "analyse");
ok("a limited-support activity keeps its own identity",
    sanitizeSlot(slot({activityType: "tracing", renderType: "structured"}))
        .activityType === "tracing");

/* ── the request ────────────────────────────────────────────────────────── */

console.log("\n— the request —");
{
  const inputs = sanitizeRegenerateInputs({
    grade: " g4 ", subject: "Integrated Science", framework: "2013",
    slot: slot(), currentText: "  What is a leaf?  ",
    avoid: ["Q1 stem", "", null, "Q2 stem"], guidance: "make it about maize",
  });
  ok("the grade is normalised", inputs.grade === "G4");
  ok("the subject is normalised to a key",
      inputs.subject === "integrated_science");
  ok("the chosen curriculum is honoured", inputs.framework === "2013");
  ok("CBC is the default curriculum",
      sanitizeRegenerateInputs({grade: "G4"}).framework === "2023");
  ok("the current question text is trimmed",
      inputs.currentText === "What is a leaf?");
  ok("blank avoid entries are dropped", inputs.avoid.length === 2);
  ok("the teacher's steer survives", inputs.guidance === "make it about maize");
}
ok("the avoid list is capped so it cannot become the whole paper",
    sanitizeRegenerateInputs({
      grade: "G4", subject: "english", slot: slot(),
      avoid: Array.from({length: 100}, (_, i) => `stem ${i}`),
    }).avoid.length === 20);

console.log("\n— what stops the request —");
ok("a request with no slot is refused before any model call",
    validateRegenerateInputs(sanitizeRegenerateInputs({grade: "G4", subject: "english"}))
        .length > 0);
ok("…and the refusal explains it in plain language",
    /cannot be rewritten on its own/.test(
        validateRegenerateInputs(
            sanitizeRegenerateInputs({grade: "G4", subject: "english"}),
        ).join(" ")));
ok("a request with no grade is refused",
    validateRegenerateInputs(sanitizeRegenerateInputs({subject: "english", slot: slot()}))
        .some((e) => /grade/i.test(e)));
ok("a complete request passes",
    validateRegenerateInputs(sanitizeRegenerateInputs({
      grade: "G4", subject: "english", slot: slot(),
    })).length === 0);

/* ── the prompt ─────────────────────────────────────────────────────────── */

console.log("\n— the prompt —");
{
  const inputs = sanitizeRegenerateInputs({
    grade: "G4", subject: "integrated_science", slot: slot(),
    currentText: "What is a leaf?",
    avoid: ["Name three plants."], guidance: "use a maize field",
  });
  const prompt = buildRegeneratePrompt(inputs, {
    gradeLabel: "Grade 4", subjectLabel: "Integrated Science",
  });
  ok("the prompt states the exact marks", /exactly 3 marks/.test(prompt));
  ok("…and the topic and sub-topic",
      /Photosynthesis/.test(prompt) && /Chlorophyll/.test(prompt));
  ok("…and the syllabus outcome",
      /Explain how plants make food/.test(prompt));
  ok("…and the thinking level and difficulty",
      /understand/.test(prompt) && /understanding/.test(prompt));
  ok("…and asks for something different from what is there now",
      /genuinely different/.test(prompt) && /What is a leaf\?/.test(prompt));
  ok("…and lists what is already on the paper, to avoid a near-duplicate",
      /Name three plants\./.test(prompt));
  ok("…and carries the teacher's steer",
      /use a maize field/.test(prompt));
  ok("…and none of it is negotiable",
      /none of this is yours to change/.test(prompt));
  ok("a choice question is told its wrong options must be real misconceptions",
      /misconception/.test(prompt) && /never a filler value/.test(prompt));
  ok("…and to explain each wrong option",
      /distractorRationale/.test(prompt));
  ok("the marks are asked to be divided into marking points",
      /markingPoints/.test(prompt));
}
{
  const essay = sanitizeRegenerateInputs({
    grade: "G11", subject: "english",
    slot: slot({renderType: "essay", activityType: "essay", marks: 20}),
  });
  const prompt = buildRegeneratePrompt(essay, {});
  ok("an essay slot is not asked for answer choices",
      !/distractorRationale/.test(prompt));
  ok("…and is still told its exact marks", /exactly 20 marks/.test(prompt));
}
{
  const figure = sanitizeRegenerateInputs({
    grade: "ECE_N", subject: "mathematics",
    slot: slot({figureRequired: true, marks: 1}),
  });
  ok("a slot that needs a picture says so",
      /needs a figure/.test(buildRegeneratePrompt(figure, {})));
  ok("one mark is not \"1 marks\"",
      /exactly 1 mark\./.test(buildRegeneratePrompt(figure, {})));
}

/* ── the tool schema ────────────────────────────────────────────────────── */

console.log("\n— the tool contract —");
ok("the schema is strict — the model cannot invent fields",
    QUESTION_TOOL_SCHEMA.additionalProperties === false);
ok("a stem, an answer and a marking guide are all required",
    ["prompt", "answer", "markingGuide"]
        .every((k) => QUESTION_TOOL_SCHEMA.required.includes(k)));
ok("marks are NOT a field the model may set",
    !("marks" in QUESTION_TOOL_SCHEMA.properties));
ok("neither is the topic, the thinking level or the difficulty",
    !("topic" in QUESTION_TOOL_SCHEMA.properties) &&
    !("bloomLevel" in QUESTION_TOOL_SCHEMA.properties) &&
    !("difficulty" in QUESTION_TOOL_SCHEMA.properties));
ok("distractor rationale is part of the contract, not an afterthought",
    Boolean(QUESTION_TOOL_SCHEMA.properties.distractorRationale));

/* ── extracting the one question ────────────────────────────────────────── */

console.log("\n— the replacement —");
{
  const {ok: fine, question} = extractSingleQuestion(validateAssessment, {
    prompt: "Which part of the plant makes food?",
    options: ["Leaf", "Root", "Stem", "Flower"],
    answer: "Leaf",
    markingGuide: "1 mark for Leaf.",
    markingPoints: ["Leaf", "because it has chlorophyll", "and receives light"],
    distractorRationale: [
      "", "learners confuse water uptake with food making",
      "learners think the stem stores food", "learners associate flowers with growth",
    ],
  }, slot());
  ok("a good replacement validates", fine && question);
  ok("it takes the SLOT's marks, never the model's", question.marks === 3);
  ok("it takes the slot's topic", question.topic === "Photosynthesis");
  ok("it takes the slot's number", question.number === 4);
  ok("it takes the slot's structure", question.type === "multiple_choice");
  ok("the options survive", question.options.length === 4);
  ok("the answer and marking guide survive",
      question.answer === "Leaf" && /1 mark for Leaf/.test(question.markingGuide));
}
{
  // The model trying to be helpful about marks is the exact failure this guards.
  const {question} = extractSingleQuestion(validateAssessment, {
    prompt: "A question.", answer: "An answer.", markingGuide: "A guide.",
    marks: 99, topic: "Something else", number: 1,
  }, slot());
  ok("a model that supplies its own marks is overruled", question.marks === 3);
  ok("…and its own topic", question.topic === "Photosynthesis");
  ok("…and its own number", question.number === 4);
}
{
  const bad = extractSingleQuestion(validateAssessment, null, slot());
  ok("nothing back is a failure, not an empty question", !bad.ok);
  ok("…and says so in plain language",
      /returned nothing usable/.test(bad.errors.join(" ")));
}
{
  const blank = extractSingleQuestion(validateAssessment,
      {prompt: "", answer: "x", markingGuide: "y"}, slot());
  ok("an empty stem is refused rather than blanking the teacher's question",
      !blank.ok && /empty question/.test(blank.errors.join(" ")));
}
{
  // Sub-parts make the validator recompute marks from the parts. The slot's
  // total must still win, or the paper's header stops adding up.
  const {question} = extractSingleQuestion(validateAssessment, {
    prompt: "Answer both parts.", answer: "…", markingGuide: "…",
    parts: [
      {label: "a", prompt: "First part", marks: 1, answer: "x"},
      {label: "b", prompt: "Second part", marks: 1, answer: "y"},
    ],
  }, slot({renderType: "structured", activityType: "structured", marks: 3}));
  ok("a replacement with sub-parts still carries the slot's total marks",
      question.marks === 3);
}

console.log(`\n${passed} passed`);
