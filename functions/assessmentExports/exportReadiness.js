/**
 * The export gate, on the server.
 *
 * Until now `requestAssessmentExport` checked one thing about a paper's
 * content: that it had at least one question. Every other blocking rule — an
 * unfinished question, a diagram the catalogue cannot draw — lived only in the
 * browser. So the rules were enforced on every button a teacher can press and
 * on no entry point at all, and the studio's own library autosave files
 * incomplete papers to Firestore regardless of their error count, so papers
 * that fail those rules demonstrably exist to be exported.
 *
 * This module runs the SAME rules, from `functions/shared/assessment`. Not a
 * server port of them — the identical modules, imported. A port would be a
 * second implementation, and a second implementation of "is this paper
 * finished" is a fork with a review process standing in for a test.
 *
 * ## Why the import is dynamic
 *
 * `functions/` is CommonJS and the shared package is ESM (its own package.json
 * declares `"type": "module"`). `await import()` is how CommonJS reaches ESM on
 * any Node, so the modules load inside the async handler rather than at
 * require-time. They are cached after the first call, so this costs one cold
 * start, once.
 *
 * ## What the client is not allowed to tell us
 *
 * Nothing. `ready`, `allowUnresolvedFigures`, a precomputed verdict — none of it
 * is read. The whole point of a server gate is that it does not take the
 * caller's word about the thing the caller wants; a bypass that only needs
 * `{ready: true}` in the payload is not a gate, it is a suggestion. The paper
 * this module reasons about is the one loaded from Firestore.
 */

let cached = null;

/** Load the shared rules once per instance. */
async function rules() {
  if (cached) return cached;
  const [figures, gate, catalog, validation, integrity] = await Promise.all([
    import("../shared/assessment/unresolvedFiguresCore.js"),
    import("../shared/assessment/exportReadinessCore.js"),
    import("../shared/assessment/diagramCatalogCore.js"),
    import("../shared/assessment/assessmentValidationCore.js"),
    import("../shared/assessment/paperIntegrityCore.js"),
  ]);
  cached = {figures, gate, catalog, validation, integrity};
  return cached;
}

/**
 * Canonicalise the stored question structure into the shape the shared rules
 * read.
 *
 * The studio's rules run over questions in PRINTED ORDER, because that is what
 * the numbers in every blocking message refer to. `loadQuestions` already
 * orders by `order`, but a paper whose questions carry duplicate or missing
 * `order` values would arrive in an order Firestore chose — so the order is
 * settled here, once, and everything downstream reads the same list.
 *
 * `_id` is the document id `loadQuestions` attaches. `getQuestionKey` prefers
 * `localId` then `_id`, so a stored question keys on its document id and the
 * issue ids the gate reads are stable — which is the server's version of the
 * hydration the client does for exactly the same reason.
 */
function canonicalizeQuestions(questions) {
  const list = Array.isArray(questions) ? questions.filter(Boolean) : [];
  return list
    .map((q, index) => ({...q, __position: index}))
    .sort((a, b) => {
      const ao = Number(a.order);
      const bo = Number(b.order);
      const aValid = Number.isFinite(ao);
      const bValid = Number.isFinite(bo);
      if (aValid && bValid && ao !== bo) return ao - bo;
      if (aValid !== bValid) return aValid ? -1 : 1;
      // Ties keep the order Firestore returned rather than becoming arbitrary:
      // an unstable sort here would renumber the paper between two calls, and
      // "Question 4 is not finished" would name a different question each time.
      return a.__position - b.__position;
    })
    .map(({__position, ...q}) => q);
}

/** The passages the paper declares, in the shape the figure check reads. */
function canonicalizePassages(assessment) {
  const list = Array.isArray(assessment?.passages) ? assessment.passages : [];
  return list.filter(Boolean);
}

/**
 * Is this paper allowed to be exported?
 *
 * @param {object} assessment the stored assessment document
 * @param {Array} questions the stored questions subcollection
 * @returns {Promise<{blocked, reason, message, numbers, unresolvedFigures, questions}>}
 */
async function assessExportReadiness(assessment, questions) {
  const {figures, gate, catalog, validation, integrity} = await rules();
  const canonical = canonicalizeQuestions(questions);
  const paper = {questions: canonical, passages: canonicalizePassages(assessment)};

  // The SAME resolver the renderers draw from — a check against a different
  // drawing function would be a check of nothing.
  const unresolvedFigures = figures.unresolvedRequiredFigures(
    paper,
    (key, params) => catalog.renderDiagramSvg(key, params),
  );

  // Identity comes from the adapter, not from the question: a stored question
  // has no `localId`, and a collector that went looking for one would key every
  // issue on `undefined` and produce a blocked paper naming no question at all.
  const entries = validation.entriesFromStoredQuestions(canonical);
  const {issues} = validation.collectAssessmentIssues({
    paper: {title: assessment?.title, subject: assessment?.subject, grade: assessment?.grade},
    entries,
    passages: paper.passages,
  });
  const questionNumbers = Object.fromEntries(entries.map((e) => [e.identity, e.number]));

  // The paper's own arithmetic and structure: numbering continuity, the
  // answer-choice count, duplicate and mathematically-equivalent distractors,
  // a correct answer that is no longer printed, and totals that contradict the
  // cover. All of it prints cleanly and is only discovered in a classroom, so
  // the server checks it rather than trusting that the studio did.
  const paperIntegrity = integrity.collectPaperIntegrityIssues({
    assessment: assessment || {},
    questions: canonical,
  });

  const verdict = gate.describeExportBlock({
    issues,
    integrityBlockers: paperIntegrity.blockers,
    questionNumbers,
    questionCount: canonical.length,
    // Server-side there is no "untouched starter block": that is live editor
    // state. A saved paper with zero questions reaches `questionCount === 0` on
    // its own, and a saved paper carrying one blank question is one broken
    // question, not an empty page.
    emptyStarter: false,
    unresolvedFigures,
  });

  return {
    ...verdict,
    issues,
    unresolvedFigures,
    integrity: paperIntegrity,
    questions: canonical,
  };
}

module.exports = {
  assessExportReadiness,
  canonicalizeQuestions,
};
