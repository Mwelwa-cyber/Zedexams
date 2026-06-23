// src/utils/sequenceGrading.js
//
// Deterministic grading for `sequence` (put-in-order) questions. Each item in
// `sequenceItems[i]` should end up at the 1-based position `sequenceAnswer[i]`
// (a permutation of 1..n over the filled items — see quizValidation's
// sequenceIssue, which is the authoring gate that guarantees this shape).
//
// The learner's response is the working ORDER they arranged: a flat array of
// item indices, `order[p]` = the index (into sequenceItems) of the item the
// learner placed at position p (0-based). So item k's 1-based position is
// `order.indexOf(k) + 1`. This is the shape the quiz runner stores in
// `answers[questionId]` and feeds to computeQuizScore at submit time.

function normalizeItems(question) {
  return (Array.isArray(question?.sequenceItems) ? question.sequenceItems : [])
    .map(v => String(v ?? '').trim())
}

function normalizeKey(question) {
  return (Array.isArray(question?.sequenceAnswer) ? question.sequenceAnswer : [])
    .map(v => {
      const n = Number(v)
      return Number.isInteger(n) ? n : 0
    })
}

/**
 * Grade a sequence response deterministically.
 *
 * Only items with non-empty text count toward the total — blank padding rows
 * from the editor are ignored.
 *
 * @param {object} question  carries sequenceItems[] + sequenceAnswer[]
 * @param {Array<number>} order  order[p] = item index placed at position p
 * @returns {{ totalItems:number, correctItems:number, perItem:Array<boolean|null>, allCorrect:boolean }}
 *          perItem is aligned to sequenceItems; null marks an ignored blank row.
 */
export function gradeSequence(question, order) {
  const items = normalizeItems(question)
  const key = normalizeKey(question)
  const arrangement = Array.isArray(order) ? order : []

  let totalItems = 0
  let correctItems = 0
  const perItem = items.map((item, k) => {
    if (!item) return null
    totalItems += 1
    const learnerPos = arrangement.indexOf(k) + 1 // 0 when the item isn't placed
    const expected = key[k]
    const ok = learnerPos >= 1 && expected >= 1 && learnerPos === expected
    if (ok) correctItems += 1
    return ok
  })

  return {
    totalItems,
    correctItems,
    perItem,
    allCorrect: totalItems > 0 && correctItems === totalItems,
  }
}

/** Convenience boolean used by the quiz scorer. */
export function sequenceMatches(question, order) {
  return gradeSequence(question, order).allCorrect
}
