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
 * The canonical subject keys that get SCIENCE notation (Phase 3).
 *
 * Mirrors SCIENCE_SUBJECT_KEYS in the shared contract; the test asserts the two
 * match. `numeracy` is in this list AND the mathematics one, which is correct:
 * CBC "Mathematics and Science" is one integrated learning area, so a Grade 2
 * paper owes both contracts.
 */
const SCIENCE_SUBJECT_KEYS = Object.freeze([
  "integrated_science",
  "environmental_science",
  "physics",
  "chemistry",
  "biology",
  "agricultural_science",
  MATHS_SCIENCE_SUBJECT_KEY,
]);

function isScienceSubjectKey(subject) {
  return SCIENCE_SUBJECT_KEYS.includes(String(subject || "").trim());
}

/** Any subject this module has something to enforce for. */
function isEnforcedSubject(subject) {
  return isMathsSubjectKey(subject) || isScienceSubjectKey(subject);
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
  // `path` is passed through so a caller can REPORT which field it found
  // something in, not only rewrite it — the science detector needs the name.
  let path = "";
  const apply = (holder, key) => {
    const value = holder[key];
    if (typeof value !== "string" || !value) return;
    const next = fn(value, path);
    if (next !== value) {
      holder[key] = next;
      changed += 1;
    }
  };

  for (const field of fields) {
    path = field.path;
    if (!path.includes("[") && !path.includes(".")) {
      // A direct string field: the path IS the property name. This is not a
      // wildcard over the question — only paths a tool EXPLICITLY lists in
      // its field subset (QUIZ_EDITOR_FIELDS, WORKSHEET_FIELDS, …) ever reach
      // here, so an unlisted field like a future `teacherComment` is never
      // touched. A new tool whose fields are all direct properties needs no
      // new branch; a NESTED field (metadata.title) would need one, exactly
      // as parts[]/statements[] did.
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

/* ── the other tools' field subsets (Phase 5) ──────────────────────────────
 *
 * Each tool applies the SAME contract to the fields its format actually has —
 * the spec's rule is that the contract application shrinks to fit the schema,
 * never that a tool gets a different contract.
 *
 * What is deliberately absent from each list is the machine-compared value:
 * the quiz editor's short_answer `answer`/`correctAnswer` is matched against
 * what a learner types, so markup there would mark every learner wrong. The
 * worksheet and homework `answer` IS listed — those are marked by a teacher
 * reading the printed answer key, so it is display, not comparison.
 */
const QUIZ_EDITOR_FIELDS = Object.freeze([
  Object.freeze({path: "text", kind: "block", what: "question text"}),
  Object.freeze({path: "options[]", kind: "inline", what: "multiple-choice options"}),
  Object.freeze({path: "explanation", kind: "block", what: "the explanation"}),
  Object.freeze({path: "statements[].text", kind: "inline", what: "a fill-in-the-blank statement"}),
  Object.freeze({path: "wordBank[]", kind: "inline", what: "a word-bank entry"}),
]);

const QUIZ_DOC_FIELDS = Object.freeze([
  Object.freeze({path: "question", kind: "block", what: "question text"}),
  Object.freeze({path: "options[]", kind: "inline", what: "multiple-choice options"}),
  Object.freeze({path: "explanation", kind: "block", what: "the explanation"}),
]);

const WORKSHEET_FIELDS = Object.freeze([
  Object.freeze({path: "prompt", kind: "block", what: "question text"}),
  Object.freeze({path: "options[]", kind: "inline", what: "multiple-choice options"}),
  Object.freeze({path: "answer", kind: "inline", what: "the answer-key answer"}),
  Object.freeze({path: "workingNotes", kind: "block", what: "the marking notes"}),
]);

const HOMEWORK_FIELDS = Object.freeze([
  Object.freeze({path: "prompt", kind: "block", what: "question text"}),
  Object.freeze({path: "answer", kind: "inline", what: "the answer-key answer"}),
  Object.freeze({path: "workingNotes", kind: "block", what: "the marking notes"}),
]);

/** Every question in an assessment, flattened, with its section.
 *
 * Accepts the three shapes the tools actually produce: sectioned
 * (assessment/worksheet), a flat `questions` array (homework, quiz document),
 * or a bare array (the quiz editor's parsed response). */
function eachQuestion(assessment) {
  if (Array.isArray(assessment)) {
    return eachQuestion({sections: [{questions: assessment}]});
  }
  if (assessment && !Array.isArray(assessment.sections) &&
      Array.isArray(assessment.questions)) {
    return eachQuestion({sections: [{questions: assessment.questions}]});
  }
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
async function enforceNotation(assessment, {subject, fields: fieldsIn} = {}) {
  if (!isEnforcedSubject(subject)) {
    return {applied: false, repaired: 0, violations: [], needsRetry: false};
  }
  let core;
  try {
    core = await import("../shared/assessment/mathsNotationCore.js");
  } catch (err) {
    console.error("[notationEnforcement] contract failed to load", err);
    return {applied: false, repaired: 0, violations: [], needsRetry: false};
  }

  const {
    NOTATION_FIELDS, repairNotation, checkQuestionNotation,
    detectNotationViolations, repairScienceNotation, detectScienceViolations,
  } = core;
  // A tool passes its own field subset (QUIZ_EDITOR_FIELDS, WORKSHEET_FIELDS,
  // …); the assessment default stays the full contract. The custom-fields
  // maths check maps the same detector over the tool's fields rather than
  // calling checkQuestionNotation, which is hard-wired to the assessment's.
  const fields = Array.isArray(fieldsIn) && fieldsIn.length ?
    fieldsIn : NOTATION_FIELDS;
  const customFields = fields !== NOTATION_FIELDS;
  const doMaths = isMathsSubjectKey(subject);
  const doScience = isScienceSubjectKey(subject);
  // A field is repaired by whichever contracts its subject owes — both, for the
  // integrated lower-primary learning area. Order does not matter: the maths
  // patterns and the science patterns do not overlap.
  const repairField = (value) => {
    let out = value;
    try {
      if (doMaths) out = repairNotation(out).text;
    } catch { /* keep what we have */ }
    try {
      if (doScience) out = repairScienceNotation(out).text;
    } catch { /* keep what we have */ }
    return out;
  };
  let repaired = 0;
  const violations = [];

  for (const {question, section, sIdx, qIdx} of eachQuestion(assessment)) {
    repaired += mapQuestionFields(question, fields, repairField);
    // A section's passage is shared by its questions, so it is repaired once
    // per section rather than once per question.
    if (qIdx === 0 && section) {
      // An assessment passage is {text}; a worksheet's is a bare string. Both
      // are display, so both are on the contract.
      if (section.passage && typeof section.passage.text === "string") {
        const before = section.passage.text;
        section.passage.text = repairField(before);
        if (section.passage.text !== before) repaired += 1;
      } else if (typeof section.passage === "string" && section.passage) {
        const before = section.passage;
        section.passage = repairField(before);
        if (section.passage !== before) repaired += 1;
      }
    }

    let report;
    try {
      if (doMaths && !customFields) {
        report = checkQuestionNotation(question);
      } else if (doMaths) {
        const found = [];
        mapQuestionFields(question, fields, (value, path) => {
          const {violations: hits} = detectNotationViolations(value);
          if (hits.length) found.push({path: path || "(field)", violations: hits});
          return value;
        });
        report = {ok: !found.length, fields: found};
      } else {
        report = {ok: true, fields: []};
      }
      if (doScience) {
        // The science check runs over the same fields, folded into one report
        // so the retry decision and the log line see a single list.
        const extra = [];
        mapQuestionFields(question, fields, (value, path) => {
          const found = detectScienceViolations(value).violations;
          if (found.length) extra.push({path: path || "(field)", violations: found});
          return value;
        });
        if (extra.length) report = {ok: false, fields: [...report.fields, ...extra]};
      }
    } catch {
      continue;
    }
    if (!report.ok) {
      violations.push({
        sectionIndex: sIdx,
        questionIndex: qIdx,
        prompt: String(question.prompt || question.text ||
          question.question || "").slice(0, 80),
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
async function applyPlainTextFloor(assessment, {subject, fields: fieldsIn} = {}) {
  if (!isEnforcedSubject(subject)) return {flattened: 0};
  let core;
  try {
    core = await import("../shared/assessment/mathsNotationCore.js");
  } catch {
    return {flattened: 0};
  }
  const {
    NOTATION_FIELDS, detectNotationViolations, toPlainMathsText,
    detectScienceViolations, scienceToPlainText,
  } = core;
  const fields = Array.isArray(fieldsIn) && fieldsIn.length ?
    fieldsIn : NOTATION_FIELDS;
  const doMaths = isMathsSubjectKey(subject);
  const doScience = isScienceSubjectKey(subject);

  let flattened = 0;
  const flatten = (value) => {
    let out = value;
    try {
      if (doMaths && !detectNotationViolations(out).ok) out = toPlainMathsText(out);
    } catch { /* keep what we have */ }
    try {
      if (doScience && !detectScienceViolations(out).ok) out = scienceToPlainText(out);
    } catch { /* keep what we have */ }
    return out;
  };

  for (const {question, section, qIdx} of eachQuestion(assessment)) {
    flattened += mapQuestionFields(question, fields, flatten);
    if (qIdx === 0 && section) {
      if (section.passage && typeof section.passage.text === "string") {
        const before = section.passage.text;
        section.passage.text = flatten(before);
        if (section.passage.text !== before) flattened += 1;
      } else if (typeof section.passage === "string" && section.passage) {
        const before = section.passage;
        section.passage = flatten(before);
        if (section.passage !== before) flattened += 1;
      }
    }
  }
  return {flattened};
}

/**
 * Convert ALL notation markup to readable plain text, valid or not.
 *
 * Different job from `applyPlainTextFloor`, and the difference bit during
 * Phase 5: the floor flattens VIOLATIONS — and valid markup is, by
 * definition, not a violation, so a compliant `$\sqrt{49}$` sails through it
 * untouched. That is correct for a destination that renders markup and
 * exactly wrong for one that prints strings verbatim (the quiz document's
 * library page). A plain-string destination calls THIS: every field is run
 * through the contract's own plain-text conversion, so the model may write
 * markup freely and the page never shows it.
 */
async function flattenMarkupToPlainText(assessment, {subject, fields: fieldsIn} = {}) {
  if (!isEnforcedSubject(subject)) return {flattened: 0};
  let core;
  try {
    core = await import("../shared/assessment/mathsNotationCore.js");
  } catch {
    return {flattened: 0};
  }
  const {NOTATION_FIELDS, toPlainMathsText, scienceToPlainText} = core;
  const fields = Array.isArray(fieldsIn) && fieldsIn.length ?
    fieldsIn : NOTATION_FIELDS;
  const doScience = isScienceSubjectKey(subject);
  let flattened = 0;
  const flatten = (value) => {
    let out = value;
    try {
      out = toPlainMathsText(out);
    } catch { /* keep what we have */ }
    try {
      if (doScience) out = scienceToPlainText(out);
    } catch { /* keep what we have */ }
    return out;
  };
  for (const {question, section, qIdx} of eachQuestion(assessment)) {
    flattened += mapQuestionFields(question, fields, flatten);
    if (qIdx === 0 && section) {
      if (section.passage && typeof section.passage.text === "string") {
        const before = section.passage.text;
        section.passage.text = flatten(before);
        if (section.passage.text !== before) flattened += 1;
      } else if (typeof section.passage === "string" && section.passage) {
        const before = section.passage;
        section.passage = flatten(before);
        if (section.passage !== before) flattened += 1;
      }
    }
  }
  return {flattened};
}

module.exports = {
  MATHS_SUBJECT_KEYS,
  SCIENCE_SUBJECT_KEYS,
  QUIZ_EDITOR_FIELDS,
  QUIZ_DOC_FIELDS,
  WORKSHEET_FIELDS,
  HOMEWORK_FIELDS,
  flattenMarkupToPlainText,
  isMathsSubjectKey,
  isScienceSubjectKey,
  isEnforcedSubject,
  enforceNotation,
  buildCorrectiveInstruction,
  applyPlainTextFloor,
};
