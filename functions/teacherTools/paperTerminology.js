/**
 * paperTerminology (server) — rendering the Zambian classroom vocabulary into a
 * generator prompt (§4.1).
 *
 * The DATA is generated from src/config/paperTerminology.js into
 * functions/data/paperTerminology.json (`npm run sync:paper-terminology`), the
 * same arrangement as assessmentBands: functions/ cannot import from src/, and a
 * hand-kept second copy of the wording would drift on the first correction.
 * scripts/test-paper-terminology.mjs fails CI if the copy is stale.
 *
 * The directive is rendered from that data AT CALL TIME, which is what makes a
 * wording correction a config edit rather than a prompt-version bump. No term is
 * written into a prompt string anywhere.
 */

const DATA = require("../data/paperTerminology.json");

const TERMS = DATA.terms || {};
const REGISTER = DATA.instructionRegister || {};
const FORBIDDEN = DATA.forbiddenOnPaper || [];
const CURRICULA = DATA.curricula || ["cbc"];
const FALLBACK_FORMALITY = "standard";

/**
 * The curriculum key, defaulting to CBC — the current national curriculum.
 *
 * Accepts every spelling in the repo, and it MATTERS here: generateAssessment
 * passes `inputs.framework`, which is the year '2023'/'2013'. Without the aliases
 * a '2013' paper fell through to the CBC default and was told to say "regroup"
 * when its teacher marks with "borrow".
 */
const CURRICULUM_ALIASES = DATA.curriculumAliases || {};

function normalizeCurriculum(curriculum) {
  const key = String(curriculum == null ? "" : curriculum).toLowerCase().trim();
  return CURRICULUM_ALIASES[key] || (CURRICULA.includes(key) ? key : "cbc");
}

/** The instruction register for a band's formality, never undefined. */
function instructionRegisterFor(formality) {
  return REGISTER[String(formality || "")] || REGISTER[FALLBACK_FORMALITY] || {};
}

/**
 * Resolve one term for a curriculum. '' for a term that does not exist — never
 * the key, because a key reaching the prompt is how `mixedNumber` reaches a page.
 */
function termFor(topic, key, curriculum = "cbc") {
  const entry = (TERMS[topic] || {})[key];
  if (!entry) return "";
  if (entry.byCurriculum) return entry.byCurriculum[normalizeCurriculum(curriculum)] || "";
  return entry.term || "";
}

/** Every term for a topic, resolved for one curriculum. */
function termsForTopic(topic, curriculum = "cbc") {
  const group = TERMS[topic];
  if (!group) return [];
  return Object.keys(group)
    .map((key) => termFor(topic, key, curriculum))
    .filter(Boolean);
}

/**
 * The terminology directive for a generator prompt: the words to use, and the
 * register to use them in.
 *
 * Graded twice over — the instruction verbs AND the vocabulary. Offering a term
 * to the model is how it reaches the page, so a level that should not use a word
 * is not told the word exists.
 */
function buildTerminologyDirective({ formality, curriculum = "cbc", subject = "" } = {}) {
  const register = instructionRegisterFor(formality);
  const curr = normalizeCurriculum(curriculum);
  const verbs = register.verbs || [];
  const phrases = register.phrases || [];
  const lines = [];

  if (verbs.length) {
    lines.push(
      `INSTRUCTION REGISTER: ${register.label || "ordinary classroom English"}. ` +
      `Open instructions with words like ${verbs.slice(0, 5).join(", ")}.`,
    );
  }
  if (phrases.length) {
    lines.push(
      `Instructions may be phrased like: ${phrases.map((p) => `"${p}"`).join("; ")}.`,
    );
  }

  // Only where the vocabulary applies: by subject, and by level.
  const mathsSubject = /math|numeracy/i.test(String(subject || ""));
  const topics = (register.topics || []).filter((t) => t !== "answering");
  if ((mathsSubject || !subject) && topics.length) {
    const groups = topics
      .map((topic) => termsForTopic(topic, curr).join(", "))
      .filter(Boolean);
    if (groups.length) {
      lines.push(
        `MATHEMATICAL VOCABULARY: use the words a Zambian classroom uses — ${groups.join("; ")}.`,
      );
    }
    if (topics.includes("columnArithmetic")) {
      const word = termFor("columnArithmetic", "regroup", curr);
      if (word) {
        lines.push(
          `When a column subtraction crosses a place value, call it "${word}" — ` +
          "that is the word this curriculum uses.",
        );
      }
    }
  }

  if (FORBIDDEN.length) {
    lines.push(
      `Never write any of our internal terms on the paper: ${FORBIDDEN.join(", ")}.`,
    );
  }
  return lines.join("\n");
}

/**
 * The technical terms a level is NOT allowed to use, resolved for a curriculum.
 *
 * A quoted syllabus outcome may legitimately contain advanced terminology, and
 * that outcome travels into the prompt as planning context — the application has
 * no business rewriting an approved curriculum statement. What must not happen is
 * the model copying that wording straight into a Nursery question. So the same
 * grading that decides what a level is TOLD becomes a check on what it PRODUCED.
 *
 * Only UNAMBIGUOUS technical terms count. "ones", "carry", "divide", "working"
 * and "answer" are ordinary English; a paper saying "Circle the red ones" is not
 * using place-value vocabulary, and a checker that said so would be ignored.
 */
function advancedTermsForLevel(formality, curriculum = "cbc") {
  const register = instructionRegisterFor(formality);
  const permitted = new Set(register.topics || []);
  const curr = normalizeCurriculum(curriculum);
  const out = [];
  for (const topic of Object.keys(TERMS)) {
    if (permitted.has(topic)) continue;
    for (const key of Object.keys(TERMS[topic])) {
      const entry = TERMS[topic][key];
      const technical = entry.technical === true || entry.technical === curr;
      if (!technical) continue;
      const term = termFor(topic, key, curr);
      if (term) out.push(term);
    }
  }
  return out;
}

/**
 * Advanced terminology found in text a LEARNER will read, for their level.
 * [] is the pass.
 *
 * Run against GENERATED question and instruction text, never against the prompt
 * — the prompt is allowed to carry a syllabus outcome verbatim. This is the
 * boundary between planning context and learner-facing wording.
 */
function findAdvancedTerms(text, formality, curriculum = "cbc") {
  const body = String(text == null ? "" : text);
  if (!body) return [];
  return advancedTermsForLevel(formality, curriculum).filter((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(body);
  });
}

/**
 * Any forbidden internal term found in generated text. [] is the pass.
 *
 * Used as a post-generation check as well as a prompt instruction: the model
 * being told not to do something is not the same as it not having done it.
 */
function findForbiddenTerms(rendered) {
  const text = String(rendered == null ? "" : rendered);
  if (!text) return [];
  return FORBIDDEN.filter((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  });
}

module.exports = {
  CURRICULA,
  advancedTermsForLevel,
  findAdvancedTerms,
  FORBIDDEN_ON_PAPER: FORBIDDEN,
  buildTerminologyDirective,
  findForbiddenTerms,
  instructionRegisterFor,
  normalizeCurriculum,
  termFor,
  termsForTopic,
};
