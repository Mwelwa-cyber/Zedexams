/**
 * Source-curriculum preservation for TRANSFORMATION generators.
 *
 * ## The distinction this enforces
 *
 * The AI generators split into two operation classes (see the migration
 * contract):
 *   • GENERATION produces NEW curriculum content and must be pinned to an
 *     explicit curriculum (resolveCbcContext).
 *   • TRANSFORMATION revises / explains / suggests against an item that already
 *     exists. It must PRESERVE that item's curriculum + subject and must never
 *     introduce content from another curriculum or subject.
 *
 * Before this, the transformation callables (reviseQuestion, suggestAnswer)
 * hard-coded "Zambian CBC" in their system prompts — so a question from the
 * 2013 (previous / OBC) syllabus was silently revised or answered against CBC.
 * That is exactly the cross-curriculum drift a transformation must not cause.
 *
 * This module is the ONE fail-closed gate + prompt directive both callers share,
 * so the rule is stated once. Pure (no firebase-functions) so it unit-tests
 * under plain `node`; callers turn `errors` into an HttpsError, exactly like the
 * existing validateInputs functions do.
 */

// Every curriculum spelling already used across the repo. Anything else — or a
// missing value — normalises to null, which the gate below fails closed on.
function normalizeCurriculum(raw) {
  const v = String(raw == null ? "" : raw).trim().toLowerCase();
  if (v === "cbc" || v === "2023") return "cbc";
  if (v === "previous" || v === "obc" || v === "2013") return "previous";
  return null;
}

const CURRICULUM_LABEL = Object.freeze({
  cbc: "Zambian CBC (2023) syllabus",
  previous: "Zambian 2013 (previous / OBC) syllabus",
});

/**
 * Fail-closed check that a transformation carries the source item's curriculum
 * and subject. Returns `{ ok, curriculum, subject, errors }`; the caller throws
 * `invalid-argument` when `!ok`, BEFORE reserving an operation or charging
 * usage. A transformation that cannot name its source curriculum is refused —
 * it must never fall back to a default (that is the drift this prevents).
 */
function checkSourceCurriculum(inputs, {requireSubject = true} = {}) {
  const curriculum = normalizeCurriculum(inputs && inputs.curriculum);
  const subject = typeof (inputs && inputs.subject) === "string" ?
    inputs.subject.trim() : "";
  const errors = [];
  if (!curriculum) {
    // Curriculum is ALWAYS strictly required — it is the field that was
    // silently defaulting to CBC, i.e. the drift itself.
    errors.push(
      "The source item's curriculum is required so the result stays in the " +
      "same syllabus. Please reselect the curriculum and try again.");
  }
  if (requireSubject && !subject) {
    // Subject is core identity for a question (revise/suggest); for a lesson-
    // section edit it is contextual grounding that is preserved-if-present, so
    // that caller passes requireSubject:false.
    errors.push(
      "The source item's subject is required so the result stays on the " +
      "same subject.");
  }
  return {ok: errors.length === 0, curriculum, subject, errors};
}

/**
 * The prompt directive that pins the model to the source curriculum + subject.
 * Prepended to a transformation's user prompt so the model is told, in words,
 * to stay in the source syllabus rather than reach for another one.
 */
function curriculumDirective({curriculum, subject}) {
  const label = CURRICULUM_LABEL[curriculum] || CURRICULUM_LABEL.cbc;
  const subj = String(subject || "").replace(/_/g, " ").trim();
  return [
    `This item belongs to the ${label}${subj ? `, subject: ${subj}` : ""}.`,
    "Preserve that curriculum and subject exactly. Do NOT introduce content, " +
      "terminology, topics, or examples from any other curriculum or subject.",
  ].join(" ");
}

module.exports = {
  normalizeCurriculum,
  checkSourceCurriculum,
  curriculumDirective,
  CURRICULUM_LABEL,
};
