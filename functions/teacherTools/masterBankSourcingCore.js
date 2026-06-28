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
function plainify(value) {
  return String(value == null ? "" : value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
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

/* --------------------------- selection + balance ------------------------- */

const DIFFICULTY_ORDER = ["easy", "medium", "hard"];

/**
 * Choose up to `count` questions from candidates, deduped by fingerprint,
 * ranked by AI quality then usage, and round-robin'd across difficulty buckets
 * so the selection isn't all-easy or all-hard.
 *
 * @param {Array<{fingerprint?:string, difficulty?:string, quality?:number, usage?:number, quiz:object}>} candidates
 * @param {{count:number}} opts
 * @returns {Array<object>} selected candidate objects (use .quiz for the question)
 */
function selectBankQuestions(candidates, {count} = {}) {
  const target = Math.max(0, Math.floor(Number(count) || 0));
  if (!target || !Array.isArray(candidates) || !candidates.length) return [];

  // Dedupe by fingerprint, keeping the highest-quality instance.
  const byFp = new Map();
  let noFpKey = 0;
  for (const c of candidates) {
    if (!c || !c.quiz) continue;
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
  let progressed = true;
  while (selected.length < target && progressed) {
    progressed = false;
    for (const d of order) {
      if (selected.length >= target) break;
      const arr = buckets.get(d);
      if (arr && arr.length) {
        selected.push(arr.shift());
        progressed = true;
      }
    }
  }
  return selected;
}

/* --------------------------- gap-fill prompt note ------------------------ */

/**
 * A short instruction block telling the model which stems are already in the
 * quiz, so the gap-fill generation doesn't duplicate them.
 */
function buildAvoidNote(quizQuestions) {
  const stems = (Array.isArray(quizQuestions) ? quizQuestions : [])
    .map((q) => plainify(q && q.question).slice(0, 140))
    .filter(Boolean)
    .slice(0, 40);
  if (!stems.length) return "";
  return [
    "",
    "ALREADY IN THE QUIZ — generate DIFFERENT questions. Do NOT repeat these " +
    "stems or test the same specific facts:",
    ...stems.map((s, i) => `${i + 1}. ${s}`),
  ].join("\n");
}

module.exports = {
  normalizeGrade,
  normalizeSubject,
  plainify,
  editorQuestionToQuiz,
  selectBankQuestions,
  buildAvoidNote,
};
