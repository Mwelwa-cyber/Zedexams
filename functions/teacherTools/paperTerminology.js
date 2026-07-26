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

/** The curriculum key, defaulting to CBC — the current national curriculum. */
function normalizeCurriculum(curriculum) {
  const key = String(curriculum || "").toLowerCase();
  return CURRICULA.includes(key) ? key : "cbc";
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
  FORBIDDEN_ON_PAPER: FORBIDDEN,
  buildTerminologyDirective,
  findForbiddenTerms,
  instructionRegisterFor,
  normalizeCurriculum,
  termFor,
  termsForTopic,
};
