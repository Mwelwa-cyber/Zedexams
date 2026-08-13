/**
 * Master Bank sourcing — pure, firebase-free brains for Smart Paper Generation.
 *
 * Given approved questions pulled from the Central Question Bank (stored in the
 * editor/quiz namespace), this module maps them into a target generator's
 * schema, dedupes, and balances the selection. The Firestore read + admin SDK
 * live in masterBankSourcing.js; keeping the logic here means it unit-tests
 * under plain `node` (the *Core.js split, like questionDedupCore.js).
 *
 * Quiz target only for now (3 types). Assessment/Exam mappers are follow-ups.
 */

/* ----------------------------- normalisation ----------------------------- */

/**
 * Canonicalise a grade so a bank value ("7", "Grade 7", "G7") matches the
 * generator's form ("G7"). Returns an uppercased token, e.g. "G7", "ECE", "F1".
 */
function normalizeGrade(value) {
  let s = String(value == null ? "" : value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("GRADE")) s = "G" + s.slice(5);
  if (/^\d+$/.test(s)) s = "G" + s;
  return s;
}

/**
 * Canonicalise a subject so "Integrated Science" matches "integrated_science"
 * and "Creative & Technology Studies" matches "creative_and_technology_studies".
 */
function normalizeSubject(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Strip HTML tags/entities to a collapsed plain string. */
/**
 * Rewrite a bank question's maths NODES into contract markup before anything
 * strips its tags.
 *
 * `toMarkup` is injected rather than imported because this module is CommonJS
 * and synchronous while the contract is ESM — the alternative is a second copy
 * of the node vocabulary here, which is the fork the contract exists to
 * prevent. `masterBankSourcing.js` is async and loads it once per scan.
 *
 * Without this, `plainify` deleted the mathematics outright: a stacked
 * fraction keeps its digits in ATTRIBUTES, so stripping tags did not flatten
 * "3/5" — it removed it. "Calculate 3/5 + 1/4" came back as "Calculate  + ",
 * and a bank question whose ANSWER was a fraction was dropped from sourcing
 * entirely, because the mapper reads an empty answer as unusable.
 */
function withNotationMarkup(editorQ, toMarkup) {
  if (!editorQ || typeof editorQ !== "object" || typeof toMarkup !== "function") {
    return editorQ;
  }
  const convert = (v) => (typeof v === "string" ? toMarkup(v) : v);
  const out = {...editorQ};
  for (const key of ["text", "explanation", "correctAnswer", "answer"]) {
    if (typeof out[key] === "string") out[key] = convert(out[key]);
  }
  if (Array.isArray(out.options)) out.options = out.options.map(convert);
  return out;
}

function plainify(value) {
  // Entities are decoded in one pass ("&amp;" handled together with the rest)
  // so a double-encoded "&amp;lt;" can never decode all the way to "<".
  const entities = {"nbsp": " ", "amp": "&", "lt": "<", "gt": ">"};
  return String(value == null ? "" : value)
      .replace(/<[^>]*>/g, " ")
      .replace(/&(nbsp|amp|lt|gt);/gi, (m, name) => entities[name.toLowerCase()])
      .replace(/\s+/g, " ")
      .trim();
}

/* --------------------------- editor → quiz mapper ------------------------- */

// The quiz schema (quizSchema.js) supports exactly these three types.
const EDITOR_TO_QUIZ_TYPE = {
  mcq: "multiple_choice",
  multiple_choice: "multiple_choice",
  tf: "true_false",
  truefalse: "true_false",
  true_false: "true_false",
  short_answer: "short_answer",
  short: "short_answer",
};

/**
 * Map one Master Bank question (editor namespace) to the quiz schema shape
 * `{type, question, options, correctAnswer, explanation}`. Returns null when it
 * can't produce a valid, auto-checkable quiz question — better to drop a
 * question than to seed the quiz with a broken/keyless one.
 */
function editorQuestionToQuiz(editorQ) {
  if (!editorQ || typeof editorQ !== "object") return null;
  const type = EDITOR_TO_QUIZ_TYPE[String(editorQ.type || "").toLowerCase()];
  if (!type) return null;

  const question = plainify(editorQ.text);
  if (!question) return null;
  const explanation = plainify(editorQ.explanation);

  if (type === "multiple_choice") {
    const options = (Array.isArray(editorQ.options) ? editorQ.options : [])
      .map((o) => plainify(o))
      .filter(Boolean);
    if (options.length < 2) return null;
    const ca = editorQ.correctAnswer;
    let correctAnswer = "";
    if (typeof ca === "number" && Number.isInteger(ca) && options[ca] != null) {
      correctAnswer = options[ca]; // editor stores the option INDEX
    } else if (typeof ca === "string" && options.includes(plainify(ca))) {
      correctAnswer = plainify(ca);
    } else {
      return null; // untrustworthy key → drop
    }
    return {type, question, options, correctAnswer, explanation};
  }

  if (type === "true_false") {
    const ca = editorQ.correctAnswer;
    let correctAnswer = "";
    if (typeof ca === "number") correctAnswer = ca === 0 ? "True" : "False";
    else {
      const t = plainify(ca).toLowerCase();
      if (t === "true" || t === "t") correctAnswer = "True";
      else if (t === "false" || t === "f") correctAnswer = "False";
      else return null;
    }
    return {type, question, options: ["True", "False"], correctAnswer, explanation};
  }

  // short_answer
  const correctAnswer = plainify(editorQ.correctAnswer != null ? editorQ.correctAnswer : editorQ.answer);
  if (!correctAnswer) return null;
  return {type, question, options: [], correctAnswer, explanation};
}

/* ------------------------- editor → assessment mapper -------------------- */

// The assessment schema supports more types, but only these three have a
// Master Bank (editor namespace) equivalent. structured/calculation/essay/
// matching stay AI-only.
const EDITOR_TO_ASSESSMENT_TYPE = {
  mcq: "multiple_choice",
  multiple_choice: "multiple_choice",
  tf: "true_false",
  truefalse: "true_false",
  true_false: "true_false",
  short_answer: "short_answer",
  short: "short_answer",
};

/**
 * Map one Master Bank question (editor namespace) to the assessment schema
 * question shape: `{type, prompt, options, answer, markingGuide, marks}`. The
 * stem is `prompt`, the key lives in `answer`, and bank marks are carried over
 * (clamped 1-99). Returns null when it can't produce a valid, keyed question.
 */
function editorQuestionToAssessment(editorQ) {
  if (!editorQ || typeof editorQ !== "object") return null;
  const type = EDITOR_TO_ASSESSMENT_TYPE[String(editorQ.type || "").toLowerCase()];
  if (!type) return null;

  const prompt = plainify(editorQ.text);
  if (!prompt) return null;
  const markingGuide = plainify(editorQ.explanation);
  const marks = Math.max(1, Math.min(99, Math.round(Number(editorQ.marks) || 1)));

  if (type === "multiple_choice") {
    const options = (Array.isArray(editorQ.options) ? editorQ.options : [])
      .map((o) => plainify(o))
      .filter(Boolean);
    if (options.length < 2) return null;
    const ca = editorQ.correctAnswer;
    let answer = "";
    if (typeof ca === "number" && Number.isInteger(ca) && options[ca] != null) {
      answer = options[ca]; // editor stores the option INDEX
    } else if (typeof ca === "string" && options.includes(plainify(ca))) {
      answer = plainify(ca);
    } else {
      return null;
    }
    return {type, prompt, options, answer, markingGuide, marks};
  }

  if (type === "true_false") {
    const ca = editorQ.correctAnswer;
    let answer = "";
    if (typeof ca === "number") answer = ca === 0 ? "True" : "False";
    else {
      const t = plainify(ca).toLowerCase();
      if (t === "true" || t === "t") answer = "True";
      else if (t === "false" || t === "f") answer = "False";
      else return null;
    }
    return {type, prompt, options: ["True", "False"], answer, markingGuide, marks};
  }

  // short_answer
  const answer = plainify(editorQ.correctAnswer != null ? editorQ.correctAnswer : editorQ.answer);
  if (!answer) return null;
  return {type, prompt, options: null, answer, markingGuide, marks};
}

/* --------------------------- selection + balance ------------------------- */

const DIFFICULTY_ORDER = ["easy", "medium", "hard"];

/**
 * Choose questions from candidates, deduped by fingerprint, ranked by AI
 * quality then usage, and round-robin'd across difficulty buckets so the
 * selection isn't all-easy or all-hard.
 *
 * Two stopping modes:
 *   - {count}        — stop after `count` questions (quiz path).
 *   - {marksBudget}  — stop once the accumulated `candidate.marks` reaches the
 *                      budget (assessment path; may overshoot by one question).
 *
 * @param {Array<{fingerprint?:string, difficulty?:string, quality?:number, usage?:number, marks?:number}>} candidates
 * @param {{count?:number, marksBudget?:number}} opts
 * @returns {Array<object>} selected candidate objects
 */
function selectBankQuestions(candidates, {count, marksBudget} = {}) {
  const byMarks = Number(marksBudget) > 0;
  const target = byMarks ?
    Number(marksBudget) :
    Math.max(0, Math.floor(Number(count) || 0));
  if (!target || !Array.isArray(candidates) || !candidates.length) return [];

  // Dedupe by fingerprint, keeping the highest-quality instance.
  const byFp = new Map();
  let noFpKey = 0;
  for (const c of candidates) {
    if (!c) continue;
    const key = c.fingerprint || `__nofp_${noFpKey++}`;
    const prev = byFp.get(key);
    if (!prev || (Number(c.quality) || 0) > (Number(prev.quality) || 0)) byFp.set(key, c);
  }

  // Bucket by difficulty, each bucket ranked by quality then usage.
  const buckets = new Map();
  for (const c of byFp.values()) {
    const d = DIFFICULTY_ORDER.includes(c.difficulty) ? c.difficulty : "unknown";
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d).push(c);
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) =>
      (Number(b.quality) || 0) - (Number(a.quality) || 0) ||
      (Number(b.usage) || 0) - (Number(a.usage) || 0));
  }

  // Round-robin across difficulty buckets (easy, medium, hard, then unknown).
  const order = [...DIFFICULTY_ORDER, "unknown"].filter((d) => buckets.has(d));
  const selected = [];
  let accMarks = 0;
  const reached = () => byMarks ? accMarks >= target : selected.length >= target;
  let progressed = true;
  while (!reached() && progressed) {
    progressed = false;
    for (const d of order) {
      if (reached()) break;
      const arr = buckets.get(d);
      if (arr && arr.length) {
        const c = arr.shift();
        selected.push(c);
        accMarks += Math.max(0, Number(c.marks) || 0);
        progressed = true;
      }
    }
  }
  return selected;
}

/* --------------------------- gap-fill prompt note ------------------------ */

/**
 * A short instruction block telling the model which stems are already in the
 * paper, so the gap-fill generation doesn't duplicate them. Reads `question`
 * (quiz shape) or `prompt` (assessment shape).
 */
function buildAvoidNote(questions) {
  const stems = (Array.isArray(questions) ? questions : [])
    .map((q) => plainify(q && (q.question || q.prompt)).slice(0, 140))
    .filter(Boolean)
    .slice(0, 40);
  if (!stems.length) return "";
  return [
    "",
    "ALREADY IN THE PAPER — generate DIFFERENT questions. Do NOT repeat these " +
    "stems or test the same specific facts:",
    ...stems.map((s, i) => `${i + 1}. ${s}`),
  ].join("\n");
}

/* ----------------------- merge sourced into sections --------------------- */

/**
 * Inject sourced assessment-questions into the model's generated sections.
 * Each sourced question is prepended to the first section that already holds a
 * question of the same `type`; failing that, the first section; failing that
 * (no sections at all), a new "Section A". Existing questions are never
 * reordered or dropped. Returns a new sections array (inputs untouched).
 *
 * Numbering + marks totals are NOT set here — re-run validateAssessment on the
 * result, which renumbers globally and recomputes the paper total.
 */
function mergeSourcedIntoSections(sections, sourcedQuestions) {
  const out = (Array.isArray(sections) ? sections : []).map((s) => ({
    ...s,
    questions: Array.isArray(s && s.questions) ? [...s.questions] : [],
  }));
  const sourced = Array.isArray(sourcedQuestions) ? sourcedQuestions : [];
  if (!sourced.length) return out;
  if (!out.length) {
    out.push({title: "Section A", instructions: "Answer all questions.", questions: []});
  }

  for (const q of sourced) {
    if (!q || typeof q !== "object") continue;
    let target = out.find((s) => s.questions.some((existing) => existing && existing.type === q.type));
    if (!target) target = out[0];
    target.questions.unshift(q);
  }
  return out;
}

module.exports = {
  withNotationMarkup,
  normalizeGrade,
  normalizeSubject,
  plainify,
  editorQuestionToQuiz,
  editorQuestionToAssessment,
  selectBankQuestions,
  buildAvoidNote,
  mergeSourcedIntoSections,
};
