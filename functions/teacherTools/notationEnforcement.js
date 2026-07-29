/**
 * Server-side enforcement of the mathematics notation contract (Phase 2 §3).
 *
 * The prompt asks the model to write mathematics as printable markup. A prompt
 * is a request, not a guarantee: over thousands of generations the model writes
 * "3/5" and "x^2" anyway, and before this module nothing noticed. The bad text
 * flowed through validation into the paper and the teacher met it in the Studio.
 *
 * Four stages, in order, and the ORDER is the design:
 *
 *   1. DETECT   every contract-bearing field of every question.
 *   2. REPAIR   mechanically, where the text has exactly one reading.
 *   3. RETRY    once, and only once, for what repair could not fix.
 *   4. FLOOR    degrade what is still broken to clean readable plain text.
 *
 * Stage 4 is the one that must never be skipped. A teacher may be shown
 * UNFORMATTED mathematics — "3/5" is merely plain — but never raw markup:
 * `\frac{3}{5}` or a half-open `[[vmath` on the page is a defect they have to
 * repair by hand, and it looks like the software is broken because it is.
 *
 * Cost (§8): stages 1, 2 and 4 are string work and add NO model calls. Stage 3
 * is the only one that spends, it is capped at one call per generation, and the
 * caller passes the corrective call in — this module never reaches a provider
 * itself, so it cannot become an unbounded loop.
 *
 * CommonJS, because the generation pipeline is. The contract itself lives in
 * the ESM shared package, reached with `await import()` inside the async
 * function — the pattern this repo uses at every CJS/ESM boundary, never a
 * top-level require.
 */

const {MATHS_SCIENCE_SUBJECT_KEY} = require("./subjectNaming");

/**
 * The canonical subject keys that turn notation enforcement on.
 *
 * Mirrors Phase 1's MATHS_SUBJECT_KEYS (src/components/teacher/mathsSubjects.js)
 * — a paper the studio gives mathematics TOOLS to is a paper the server owes
 * mathematics NOTATION. `notationEnforcement.test.js` asserts the two lists
 * match, so they cannot drift into a state where a Grade 2 teacher gets the
 * fraction button and unenforced "3/5" from the generator.
 *
 * `numeracy` is the load-bearing one again: it is what CBC "Mathematics and
 * Science" (Grades 1-3) and "Pre-Mathematics and Science" (Nursery/Reception)
 * store, so leaving it out would make this a Grade-4-and-up feature while
 * appearing to cover everything.
 */
const MATHS_SUBJECT_KEYS = Object.freeze([
  "mathematics",
  "mathematics_ii",
  MATHS_SCIENCE_SUBJECT_KEY,
]);

/** Does this paper's subject get notation enforcement? */
function isMathsSubjectKey(subject) {
  return MATHS_SUBJECT_KEYS.includes(String(subject || "").trim());
}

/**
 * Walk every string a question keeps at a contract field path, applying `fn`.
 *
 * Returns the number of values changed. Mutates in place: the caller owns a
 * parsed model response it is already rewriting (renumbering, reordering,
 * trimming options), so copying here would buy nothing but a second object to
 * keep in step.
 */
function mapQuestionFields(question, fields, fn) {
  let changed = 0;
  const apply = (holder, key) => {
    const value = holder[key];
    if (typeof value !== "string" || !value) return;
    const next = fn(value);
    if (next !== value) {
      holder[key] = next;
      changed += 1;
    }
  };

  for (const field of fields) {
    const path = field.path;
    if (path === "prompt" || path === "answer" ||
        path === "markingGuide" || path === "solution") {
      apply(question, path);
    } else if (path === "options[]") {
      if (Array.isArray(question.options)) {
        question.options.forEach((_, i) => apply(question.options, i));
      }
    } else if (path === "wordBank[]") {
      if (Array.isArray(question.wordBank)) {
        question.wordBank.forEach((_, i) => apply(question.wordBank, i));
      }
    } else if (path === "parts[].text" || path === "parts[].answer") {
      const key = path.endsWith("text") ? "text" : "answer";
      if (Array.isArray(question.parts)) {
        for (const part of question.parts) {
          if (part && typeof part === "object") apply(part, key);
        }
      }
    } else if (path === "statements[].text") {
      if (Array.isArray(question.statements)) {
        for (const st of question.statements) {
          if (st && typeof st === "object") apply(st, "text");
        }
      }
    } else if (path === "statements[].answers[]") {
      if (Array.isArray(question.statements)) {
        for (const st of question.statements) {
          if (!st || typeof st !== "object") continue;
          // The schema normalises to `answers[]`, but a raw model response can
          // still carry the singular `answer`, and that is exactly the shape
          // this runs against — before normalisation.
          if (Array.isArray(st.answers)) {
            st.answers.forEach((_, i) => apply(st.answers, i));
          }
          apply(st, "answer");
        }
      }
    }
    // `passage.text` is a SECTION field, handled by the section walk below.
  }
  return changed;
}

/** Every question in an assessment, flattened, with its section. */
function eachQuestion(assessment) {
  const out = [];
  const sections = Array.isArray(assessment && assessment.sections) ?
    assessment.sections : [];
  sections.forEach((section, sIdx) => {
    const questions = Array.isArray(section && section.questions) ?
      section.questions : [];
    questions.forEach((question, qIdx) => {
      if (question && typeof question === "object") {
        out.push({question, section, sIdx, qIdx});
      }
    });
  });
  return out;
}

/**
 * Detect and mechanically repair notation across a whole generated paper.
 *
 * Returns a report the caller uses to decide whether the single corrective
 * model call is worth making:
 *
 *   {
 *     applied,     did enforcement run at all (false for non-maths subjects)
 *     repaired,    how many values were rewritten mechanically
 *     violations,  what is STILL wrong, per question
 *     needsRetry,  is any of that worth a corrective call
 *   }
 *
 * Never throws: a paper is a teacher's already-billed result, and a crash in a
 * notation check is not a reason to lose it.
 */
async function enforceNotation(assessment, {subject} = {}) {
  if (!isMathsSubjectKey(subject)) {
    return {applied: false, repaired: 0, violations: [], needsRetry: false};
  }
  let core;
  try {
    core = await import("../shared/assessment/mathsNotationCore.js");
  } catch (err) {
    console.error("[notationEnforcement] contract failed to load", err);
    return {applied: false, repaired: 0, violations: [], needsRetry: false};
  }

  const {NOTATION_FIELDS, repairNotation, checkQuestionNotation} = core;
  let repaired = 0;
  const violations = [];

  for (const {question, section, sIdx, qIdx} of eachQuestion(assessment)) {
    repaired += mapQuestionFields(question, NOTATION_FIELDS, (value) => {
      try {
        return repairNotation(value).text;
      } catch {
        return value;
      }
    });
    // A section's passage is shared by its questions, so it is repaired once
    // per section rather than once per question.
    if (qIdx === 0 && section && section.passage &&
        typeof section.passage.text === "string") {
      const before = section.passage.text;
      try {
        section.passage.text = repairNotation(before).text;
      } catch { /* leave it */ }
      if (section.passage.text !== before) repaired += 1;
    }

    let report;
    try {
      report = checkQuestionNotation(question);
    } catch {
      continue;
    }
    if (!report.ok) {
      violations.push({
        sectionIndex: sIdx,
        questionIndex: qIdx,
        prompt: String(question.prompt || "").slice(0, 80),
        fields: report.fields,
      });
    }
  }

  // A corrective call is worth making only for what repair REFUSED — an
  // ambiguous bare fraction, a malformed token, a column sum drawn in ASCII.
  // Anything still marked repairable after a repair pass would come back the
  // same way, so retrying on it would spend a call to learn nothing.
  const needsRetry = violations.some((v) =>
    v.fields.some((f) => f.violations.some((x) => !x.repairable)));

  return {applied: true, repaired, violations, needsRetry};
}

/**
 * The corrective instruction for the ONE retry, naming what to fix.
 *
 * Specific rather than a re-statement of the rules: the model has already seen
 * the rules and produced this, so repeating them is the least likely thing to
 * change the outcome. Quoting its own offending text back is what moves it.
 */
function buildCorrectiveInstruction(violations) {
  const lines = [];
  for (const v of violations.slice(0, 12)) {
    const samples = v.fields
        .flatMap((f) => f.violations.map((x) => `${f.path}: "${x.sample}"`))
        .slice(0, 4);
    if (samples.length) {
      lines.push(`- Question ${v.questionIndex + 1} ("${v.prompt}…"): ${samples.join("; ")}`);
    }
  }
  return [
    "Your previous paper broke the MATHS NOTATION rules in these places:",
    ...lines,
    "",
    "Re-emit the COMPLETE paper as valid JSON with those fixed:",
    "- every fraction as \\frac{a}{b} (mixed numbers c\\frac{a}{b}), never a/b;",
    "- every other piece of maths wrapped in $…$;",
    "- every column calculation as a [[vmath op=… lines=… answer=…]] token on " +
      "its own line, never drawn with spaces and dashes;",
    "- and keep every answer, mark and question EXACTLY as it was — this is a " +
      "notation fix, not a rewrite. Do not change what any question asks.",
  ].join("\n");
}

/**
 * Stage 4 — the floor. Degrade whatever is still non-compliant to clean plain
 * text, so a failure reaches the teacher as unformatted mathematics rather
 * than as markup.
 *
 * Returns the number of values flattened, for the log line that lets notation
 * compliance be monitored over time.
 */
async function applyPlainTextFloor(assessment, {subject} = {}) {
  if (!isMathsSubjectKey(subject)) return {flattened: 0};
  let core;
  try {
    core = await import("../shared/assessment/mathsNotationCore.js");
  } catch {
    return {flattened: 0};
  }
  const {NOTATION_FIELDS, detectNotationViolations, toPlainMathsText} = core;

  let flattened = 0;
  const flatten = (value) => {
    let bad;
    try {
      bad = !detectNotationViolations(value).ok;
    } catch {
      return value;
    }
    if (!bad) return value;
    try {
      return toPlainMathsText(value);
    } catch {
      return value;
    }
  };

  for (const {question, section, qIdx} of eachQuestion(assessment)) {
    flattened += mapQuestionFields(question, NOTATION_FIELDS, flatten);
    if (qIdx === 0 && section && section.passage &&
        typeof section.passage.text === "string") {
      const before = section.passage.text;
      section.passage.text = flatten(before);
      if (section.passage.text !== before) flattened += 1;
    }
  }
  return {flattened};
}

module.exports = {
  MATHS_SUBJECT_KEYS,
  isMathsSubjectKey,
  enforceNotation,
  buildCorrectiveInstruction,
  applyPlainTextFloor,
};
