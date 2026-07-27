/**
 * The number printed beside a question on the paper.
 *
 * Part of the shared assessment package (see ./README.md). Environment-neutral.
 *
 * ## Why numbering is a shared rule rather than a UI detail
 *
 * Every blocking message a teacher reads names questions BY NUMBER — "Question 2
 * is not finished", "Question 5 requires a diagram". Those numbers are only
 * meaningful if they are the numbers on the printed page, and the printed page
 * is numbered by POSITION in the serialized question list. So numbering is part
 * of the rule, not part of the rendering: a server that refused an export using
 * its own numbering would tell the teacher to fix a question that is not the one
 * that is broken, which is worse than not naming a question at all.
 *
 * `unresolvedRequiredFigures` numbers figures the same way (`index + 1` over the
 * same list) for the same reason, and there is a test that the two agree.
 *
 * ## The identity key
 *
 * `localId` is an in-memory identifier the editor mints and Firestore never
 * stores; `_id`/`id` is the document id a saved question has and a new one does
 * not; `order` is the last resort for an imported question carrying neither.
 * All four name the same question at different points in its life, so the key is
 * whichever exists first — and callers on the saved path must hydrate BEFORE
 * building the map, or every key comes back empty and every issue keys onto the
 * same non-existent question.
 *
 * This is `getQuestionKey` from quizSections.js, moved rather than reimplemented:
 * that module is 1,400 lines of editor machinery the server has no business
 * loading, but this one function is a rule both sides need. quizSections.js now
 * re-exports it, so there is still exactly one implementation.
 */

/** The stable identity of a question, whichever part of its life it is in. */
export function getQuestionKey(question = {}) {
  return question?.localId || question?._id || question?.id || question?.order || ''
}

/**
 * identity → the number printed on the paper.
 *
 * Position, not a stored `order` field: `order` is editor bookkeeping that can
 * disagree with the array it annotates, and the renderers number by position.
 * A second source of numbering is a second answer to "which question is this".
 *
 * @param {Array} questions the serialized question list, in printed order
 * @returns {Object<string, number>}
 */
export function buildQuestionNumberMap(questions = []) {
  const out = {}
  const list = Array.isArray(questions) ? questions : []
  list.forEach((question, index) => {
    out[getQuestionKey(question)] = index + 1
  })
  return out
}
