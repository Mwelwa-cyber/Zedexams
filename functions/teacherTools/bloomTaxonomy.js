/**
 * bloomTaxonomy — pure, dependency-free helper for grade-aware cognitive
 * demand + language level. Shared by the assessment prompt (V9) and the
 * deterministic quality checker (assessmentQualityCheck.js).
 *
 * A real Zambian test is NOT all recall: it deliberately mixes cognitive
 * levels, and the ceiling of that mix rises with the grade. This module is
 * the single source of truth for:
 *   - the canonical Bloom levels (Revised Taxonomy, lower → higher),
 *   - which levels are appropriate for a grade band (bloomProfileForGrade),
 *   - the concrete grade-band language ladder (gradeLanguageLadder) the prompt
 *     injects so wording matches the learner's grade.
 *
 * Grade → band uses the same gradeToBand as the format resolver so the two
 * stay in lock-step. Everything here is pure so the functions test suite can
 * exercise it under plain `node` with no firebase-functions dependency.
 */

const {gradeToBand} = require("./assessmentFormats");

// Bloom's Revised Taxonomy, ordered lowest → highest cognitive demand. The
// prompt tags every question with one of these; the checker verifies variety.
const BLOOM_LEVELS = [
  "remember", "understand", "apply", "analyse", "evaluate", "create",
];

const BLOOM_RANK = BLOOM_LEVELS.reduce((acc, key, i) => {
  acc[key] = i;
  return acc;
}, {});

// Human labels for prompt/report display.
const BLOOM_LABELS = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyse: "Analyse",
  evaluate: "Evaluate",
  create: "Create",
};

// British/American spellings and the older (noun) Bloom names all fold to the
// canonical key, so a model that emits "Analysis"/"analyze"/"Knowledge" is
// still understood.
const BLOOM_ALIASES = {
  remember: "remember", remembering: "remember", knowledge: "remember",
  recall: "remember", know: "remember",
  understand: "understand", understanding: "understand",
  comprehension: "understand", comprehend: "understand",
  apply: "apply", applying: "apply", application: "apply",
  analyse: "analyse", analyze: "analyse", analysing: "analyse",
  analyzing: "analyse", analysis: "analyse",
  evaluate: "evaluate", evaluating: "evaluate", evaluation: "evaluate",
  create: "create", creating: "create", creation: "create",
  synthesis: "create", synthesise: "create", synthesize: "create",
};

/**
 * Fold any spelling of a Bloom level to its canonical key, or null.
 * @param {*} value
 * @returns {string|null}
 */
function normalizeBloom(value) {
  const key = String(value == null ? "" : value).trim().toLowerCase();
  return BLOOM_ALIASES[key] || (BLOOM_RANK[key] !== undefined ? key : null);
}

// Per grade band: the highest level a paper should reach and the set of levels
// that belong on it. `minDistinct` is how many DIFFERENT levels a balanced
// paper of a few questions should show (the checker warns below this). Command
// verbs seed the prompt so wording lands at the right cognitive level.
const BAND_PROFILES = {
  lower_primary: {
    ceiling: "apply",
    levels: ["remember", "understand", "apply"],
    minDistinct: 2,
    verbs: ["name", "list", "match", "point to", "colour", "count", "say"],
  },
  upper_primary: {
    ceiling: "analyse",
    levels: ["remember", "understand", "apply", "analyse"],
    minDistinct: 3,
    verbs: ["state", "explain", "describe", "work out", "compare", "give reasons"],
  },
  junior_secondary: {
    ceiling: "evaluate",
    levels: ["remember", "understand", "apply", "analyse", "evaluate"],
    minDistinct: 3,
    verbs: ["describe", "explain", "calculate", "analyse", "distinguish", "justify"],
  },
  senior_secondary: {
    ceiling: "create",
    levels: ["remember", "understand", "apply", "analyse", "evaluate", "create"],
    minDistinct: 4,
    verbs: ["explain", "analyse", "evaluate", "discuss", "assess", "design"],
  },
};

const DEFAULT_BAND = "upper_primary";

/**
 * The Bloom mix profile appropriate for a grade.
 * @param {string} grade e.g. "G1", "G7", "G9", "ECE"
 * @returns {{band:string, ceiling:string, levels:string[], minDistinct:number,
 *   verbs:string[]}}
 */
function bloomProfileForGrade(grade) {
  const band = gradeToBand(grade) || DEFAULT_BAND;
  const profile = BAND_PROFILES[band] || BAND_PROFILES[DEFAULT_BAND];
  return {band, ...profile};
}

/**
 * Is this level within the ceiling for the grade? Unknown levels return true
 * so the checker never punishes a paper for an untagged question.
 */
function bloomWithinCeiling(level, grade) {
  const norm = normalizeBloom(level);
  if (norm === null) return true;
  const {ceiling} = bloomProfileForGrade(grade);
  return BLOOM_RANK[norm] <= BLOOM_RANK[ceiling];
}

// Concrete language rules per band — sentence length, vocabulary, the command
// words that fit, and a worked exemplar. Injected verbatim into the V9 prompt
// so the model's wording tracks the grade rather than defaulting to one register.
const LANGUAGE_LADDER = {
  lower_primary: {
    label: "Lower Primary (ECE–Grade 3)",
    rules:
      "Use very short, simple sentences (roughly 5–10 words). Only everyday " +
      "words a 6–8 year old knows. One idea per question. Prefer picture, " +
      "naming, matching and single-number answers. Command words: name, list, " +
      "match, count, colour, point to.",
    example: "Name two parts of the body.",
  },
  upper_primary: {
    label: "Upper Primary (Grade 4–7)",
    rules:
      "Use clear, short sentences. Familiar vocabulary with a few subject " +
      "terms explained in context. Ask learners to explain, describe, compare " +
      "and work things out — not only recall. Command words: state, explain, " +
      "describe, work out, give reasons.",
    example: "Explain why washing hands is important before eating.",
  },
  junior_secondary: {
    label: "Junior Secondary (Grade 8–9)",
    rules:
      "Use full sentences with correct subject terminology. Expect reasoning, " +
      "calculation and analysis, not just facts. Multi-step and structured " +
      "questions are appropriate. Command words: describe, explain, calculate, " +
      "analyse, distinguish, justify.",
    example: "Analyse how the circulatory and respiratory systems work together.",
  },
  senior_secondary: {
    label: "Senior Secondary (Grade 10–12)",
    rules:
      "Use precise academic language and correct terminology throughout. " +
      "Expect analysis, evaluation and extended reasoning; discussion and " +
      "essay-style items belong here. Command words: analyse, evaluate, " +
      "discuss, assess, justify, design.",
    example: "Evaluate the impact of deforestation on Zambia's water cycle.",
  },
};

/**
 * The grade-band language rules block for the prompt.
 * @param {string} grade
 * @returns {{band:string, label:string, rules:string, example:string}}
 */
function gradeLanguageLadder(grade) {
  const band = gradeToBand(grade) || DEFAULT_BAND;
  const ladder = LANGUAGE_LADDER[band] || LANGUAGE_LADDER[DEFAULT_BAND];
  return {band, ...ladder};
}

module.exports = {
  BLOOM_LEVELS,
  BLOOM_RANK,
  BLOOM_LABELS,
  normalizeBloom,
  bloomProfileForGrade,
  bloomWithinCeiling,
  gradeLanguageLadder,
};
