/**
 * Learner-notes output validator (§3).
 *
 * Same shape of contract as `notesSchema.js` — fill in what can be filled in,
 * return `{ok, value, errors}` and let the caller decide whether to flag — but
 * a different document, because a learner handout is not a teacher's delivery
 * note with the pronouns changed.
 *
 * Two rules are enforced here rather than only asked for in the prompt:
 *
 *   - **The exercise's answers never live on the learner's pages.** Whatever
 *     the model returns, `exercise.questions[].answer` is stripped and moved to
 *     `answerKey`. A prompt instruction is a request; this is the guarantee,
 *     and every renderer downstream can trust it without re-checking.
 *   - **Board notes carry no FAQ.** The budget asks for none, and any that
 *     arrive anyway are dropped here — the format's definition is one place,
 *     not two hopeful ones.
 *
 * ## Why this file knows nothing about the option vocabulary
 *
 * `options` arrives ALREADY normalised, from `functions/shared/notes/
 * notesOptionsCore.js` — the one declaration both runtimes read. Cloud
 * Functions is CommonJS and that package is ESM, so it is reached with
 * `await import(...)` inside the async runner; a validator that re-derived its
 * own defaults here would be the second copy of the vocabulary, which is the
 * fork the shared package exists to prevent. The only option this file reads
 * at all is `format`, and only to answer one question: board or not.
 */

const SCHEMA_VERSION = "2.0";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
const str = (v) => (isNonEmptyString(v) ? v.trim() : "");
function stringArray(v, max) {
  return Array.isArray(v) ?
    v.map((s) => str(s)).filter(Boolean).slice(0, max) :
    [];
}

/**
 * Validate and normalise a learner-notes document.
 *
 * @param {object} input       the model's output
 * @param {object} options     the teacher's choices (audience/format/…)
 * @param {object} extras      server-owned fields: grounding, diagrams
 */
function validateLearnerNotes(input, options = {}, extras = {}) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  const format = options.format || "handout";
  const board = format === "board";

  // ── header ───────────────────────────────────────────────────────────────
  const h = input.header || {};
  const header = {
    title: str(h.title),
    grade: str(h.grade),
    subject: str(h.subject),
    topic: str(h.topic),
    subtopic: str(h.subtopic),
    date: str(h.date),
    language: str(h.language) || "english",
    school: str(h.school),
    teacherName: str(h.teacherName),
    lessonPlanId: str(h.lessonPlanId),
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.topic) errors.push("header.topic is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");

  // ── "What you will learn" ────────────────────────────────────────────────
  const learningOutcomes = stringArray(input.learningOutcomes, 4);
  if (learningOutcomes.length === 0) {
    errors.push("Learner notes need at least one 'what you will learn' line.");
  }

  // ── the notes body ───────────────────────────────────────────────────────
  const sections = (Array.isArray(input.sections) ? input.sections : [])
      .filter((s) => s && typeof s === "object")
      .map((s) => ({
        heading: str(s.heading),
        body: stringArray(s.body, 8),
        definitions: (Array.isArray(s.definitions) ? s.definitions : [])
            .filter((d) => d && typeof d === "object")
            .map((d) => ({term: str(d.term), meaning: str(d.meaning)}))
            .filter((d) => d.term && d.meaning)
            .slice(0, 4),
        recap: str(s.recap),
      }))
      .filter((s) => s.heading && (s.body.length > 0 || s.definitions.length > 0))
      .slice(0, 8);
  if (sections.length === 0) {
    errors.push("Learner notes need at least one section of notes.");
  }

  // ── worked examples ──────────────────────────────────────────────────────
  const workedExamples = (Array.isArray(input.workedExamples) ? input.workedExamples : [])
      .filter((w) => w && typeof w === "object")
      .map((w) => ({
        title: str(w.title),
        problem: str(w.problem),
        steps: stringArray(w.steps, 10),
        answer: str(w.answer),
      }))
      .filter((w) => w.problem)
      .slice(0, 4);

  // ── "Don't mix these up!" ────────────────────────────────────────────────
  const dontMixThese = (Array.isArray(input.dontMixThese) ? input.dontMixThese : [])
      .filter((m) => m && typeof m === "object")
      .map((m) => ({
        confusedPair: str(m.confusedPair),
        warning: str(m.warning),
        clarification: str(m.clarification),
      }))
      .filter((m) => m.warning)
      .slice(0, 4);

  // ── "Questions learners ask" ─────────────────────────────────────────────
  // Board notes have no FAQ. The budget asked for none; anything that came back
  // anyway is dropped here so the format means one thing.
  const learnerQuestions = board ? [] :
    (Array.isArray(input.learnerQuestions) ? input.learnerQuestions : [])
        .filter((q) => q && typeof q === "object")
        .map((q) => ({question: str(q.question), answer: str(q.answer)}))
        .filter((q) => q.question && q.answer)
        .slice(0, 6);

  // ── "Remember!" ──────────────────────────────────────────────────────────
  const rememberBox = stringArray(input.rememberBox, 8);
  if (rememberBox.length === 0) {
    errors.push("Learner notes need a 'Remember!' summary — it is what a learner revises from.");
  }

  // ── exercise + the answer page ───────────────────────────────────────────
  //
  // The split happens HERE, not in a renderer. `exercise.questions` is what
  // prints on the learner's sheet, and it is structurally incapable of holding
  // an answer: the field is removed rather than merely unused.
  const rawExercise = (input.exercise && typeof input.exercise === "object") ? input.exercise : {};
  const rawQuestions = (Array.isArray(rawExercise.questions) ? rawExercise.questions : [])
      .filter((q) => q && typeof q === "object")
      .slice(0, 10);

  const questions = [];
  const answers = [];
  rawQuestions.forEach((q, i) => {
    const prompt = str(q.prompt || q.question);
    if (!prompt) return;
    const number = questions.length + 1;
    questions.push({
      number,
      prompt,
      marks: Number.isFinite(Number(q.marks)) ? Math.max(1, Math.round(Number(q.marks))) : 1,
      type: str(q.type) || (i === rawQuestions.length - 1 ? "apply" : "recall"),
    });
    answers.push({
      number,
      answer: str(q.answer) || "—",
      note: str(q.markingNote || q.note),
    });
  });

  const exercise = {
    instructions: str(rawExercise.instructions) || "Answer all the questions in your exercise book.",
    questions,
  };
  if (questions.length === 0) {
    errors.push("Learner notes need an exercise.");
  }

  const answerKey = {
    answers,
    // The diagram's labels, when a label-it figure is on the sheet. Filled by
    // the runner from the library asset, never by the model — the model does
    // not know which figure was attached.
    diagramLabels: Array.isArray(extras.diagramLabels) ? extras.diagramLabels : [],
    diagramCaption: str(extras.diagramCaption),
  };

  const value = {
    schemaVersion: SCHEMA_VERSION,
    audience: options.audience || "learner",
    format,
    detail: options.detail || "detailed",
    length: options.length || "one",
    englishLevel: options.englishLevel || "standard",
    paperSize: options.paperSize || "a4",
    header,
    learningOutcomes,
    sections,
    workedExamples,
    dontMixThese,
    learnerQuestions,
    rememberBox,
    exercise,
    answerKey,
    // Server-owned. `grounded: false` is a real state the studio renders as an
    // amber notice — never an absent field the UI can read as "fine".
    grounding: extras.grounding || {grounded: false, outcomes: [], source: "none"},
    diagrams: Array.isArray(extras.diagrams) ? extras.diagrams : [],
    coveredContent: stringArray(input.coveredContent, 40),
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

/**
 * Splice one regenerated section into a validated document.
 *
 * Every other section keeps its identity — the tests assert reference equality,
 * because "the rest of the document is unchanged" is a claim about identity and
 * a deep copy that happens to be equal is not the same claim.
 */
function replaceLearnerSection(notes, sectionId, fresh) {
  if (!notes || !sectionId || !fresh || typeof fresh !== "object") return notes;
  const next = {...notes};
  switch (sectionId) {
    case "sections":
      if (Array.isArray(fresh.sections) && fresh.sections.length) next.sections = fresh.sections;
      break;
    case "outcomes":
      if (Array.isArray(fresh.learningOutcomes) && fresh.learningOutcomes.length) {
        next.learningOutcomes = fresh.learningOutcomes;
      }
      break;
    case "exercise":
      if (fresh.exercise) {
        next.exercise = fresh.exercise;
        if (fresh.answerKey) {
          // The answer page belongs to the questions it marks: replacing one
          // without the other leaves a key answering questions nobody asked.
          next.answerKey = {...notes.answerKey, ...fresh.answerKey};
        }
      }
      break;
    default:
      if (Array.isArray(fresh[sectionId]) && fresh[sectionId].length) {
        next[sectionId] = fresh[sectionId];
      }
  }
  return next;
}

module.exports = {SCHEMA_VERSION, validateLearnerNotes, replaceLearnerSection};
