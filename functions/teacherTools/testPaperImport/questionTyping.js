/**
 * questionTyping — classify a scanned-paper question beyond "it's an MCQ".
 *
 * The original scanned importer treated every extracted item as a 4-option MCQ
 * (ECZ papers are mostly multiple choice). A real test paper mixes true/false,
 * fill-in-the-blank, matching and short-answer questions, each carrying marks.
 * This module gives the importer a small, pure typing layer:
 *
 *   - normaliseQuestionType — coerce a model-supplied type onto the set the
 *     studio can render (mcq, true_false, fill_blank, matching, short_answer).
 *   - classifyQuestionType — infer the type from the stem + options when the
 *     model didn't say (blanks → fill_blank, two T/F options → true_false, a
 *     "match the following" cue → matching, no options → short_answer).
 *   - extractMarks — pull a trailing "[3 marks]" / "(2)" off a stem.
 *   - resolveQuestionType — model value first, classifier as the fallback.
 *
 * Pure + dependency-free so it unit-tests under plain `node` and can be required
 * from the (CommonJS) functions importer. The frontend maps the chosen type onto
 * its editor vocabulary via canonicalizeQuestionType().
 */

// The types the importer is allowed to emit. Deliberately a small set that maps
// cleanly onto the quiz editor's vocabulary (true_false→tf, fill_blank→
// fill_blanks via canonicalizeQuestionType on the client).
const ALLOWED_TYPES = ["mcq", "true_false", "fill_blank", "matching", "short_answer"];
const ALLOWED_SET = new Set(ALLOWED_TYPES);

// Common model/alias spellings folded onto our set.
const TYPE_ALIASES = {
  multiple_choice: "mcq",
  multiplechoice: "mcq",
  choice: "mcq",
  tf: "true_false",
  truefalse: "true_false",
  "true/false": "true_false",
  boolean: "true_false",
  fill: "fill_blank",
  fill_blanks: "fill_blank",
  fill_in_blank: "fill_blank",
  fill_in_the_blank: "fill_blank",
  cloze: "fill_blank",
  gap_fill: "fill_blank",
  match: "matching",
  matchup: "matching",
  short: "short_answer",
  short_answer: "short_answer",
  shortanswer: "short_answer",
  structured: "short_answer",
  open: "short_answer",
  written: "short_answer",
};

function clean(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * Coerce a raw model type string onto the allowed set, or "" when unrecognised.
 */
function normaliseQuestionType(raw) {
  const key = clean(raw).toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return "";
  if (ALLOWED_SET.has(key)) return key;
  return TYPE_ALIASES[key] || "";
}

// Stems whose options are exactly a true/false pair.
function looksTrueFalse(options) {
  const opts = (Array.isArray(options) ? options : [])
    .map((o) => clean(o).toLowerCase())
    .filter(Boolean);
  if (opts.length !== 2) return false;
  const set = new Set(opts);
  return (
    (set.has("true") && set.has("false")) ||
    (set.has("t") && set.has("f")) ||
    (set.has("yes") && set.has("no"))
  );
}

// A run of underscores, a ▭ answer box, or a "fill in the blank" cue.
const BLANK_RE = /_{2,}|▭|\.{4,}|\bfill in\b|\bfill the blank|complete the (?:sentence|blank)/i;
const MATCH_RE = /\bmatch(?:ing)?\b|\bcolumn a\b|\bcolumn b\b|\bjoin (?:the|each)\b|draw a line to (?:match|join)/i;

/**
 * Infer the question type from the stem + options when the model didn't classify.
 */
function classifyQuestionType({prompt, options, optionsAreImages} = {}) {
  const stem = clean(prompt);
  const opts = (Array.isArray(options) ? options : []).map(clean).filter(Boolean);

  if (looksTrueFalse(options)) return "true_false";
  // Pictorial options or two-plus real choices read as multiple choice.
  if (optionsAreImages || opts.length >= 2) return "mcq";
  // No usable options → look at the stem.
  if (MATCH_RE.test(stem)) return "matching";
  if (BLANK_RE.test(stem)) return "fill_blank";
  return "short_answer";
}

/**
 * The importer's decision: trust an explicit, recognised model type; otherwise
 * classify from the content.
 */
function resolveQuestionType(raw = {}) {
  const fromModel = normaliseQuestionType(raw.questionType ?? raw.type);
  if (fromModel) return fromModel;
  return classifyQuestionType(raw);
}

// Trailing marks annotations: "[3 marks]", "(2)", "(5 marks)", "— 4 marks".
const MARKS_RE = /[[(–—-]\s*(\d{1,2})\s*(?:marks?|mks?|m)?\s*[\])]?\s*$/i;

/**
 * Pull a trailing marks annotation off a stem. Returns { marks, text } where
 * marks is null when none was found and text is the stem with the annotation
 * removed (only when a marks word made it unambiguous — a bare trailing "(2)"
 * is treated as marks but kept in text to avoid eating real content like an
 * exponent).
 */
function extractMarks(rawText) {
  const text = clean(rawText);
  const m = text.match(MARKS_RE);
  if (!m) return {marks: null, text};
  const value = Number.parseInt(m[1], 10);
  if (!Number.isFinite(value) || value < 1 || value > 50) return {marks: null, text};
  // Only strip the annotation when it explicitly said "marks"/"mks" — a bare
  // "(2)" might be a sub-part label or maths, so keep it in the stem.
  const explicit = /marks?|mks?/i.test(m[0]);
  const stripped = explicit ? text.slice(0, m.index).trim() : text;
  return {marks: value, text: stripped || text};
}

module.exports = {
  ALLOWED_TYPES,
  normaliseQuestionType,
  classifyQuestionType,
  looksTrueFalse,
  resolveQuestionType,
  extractMarks,
};
