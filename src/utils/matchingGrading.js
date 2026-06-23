// src/utils/matchingGrading.js
//
// Deterministic grading for `matching` questions (no AI needed — the answer
// key is exact). A matching question pairs each prompt in `matchingLeft[i]`
// with the option in `matchingRight[matchingAnswer[i]]`.
//
// The learner's response is a flat array aligned to `matchingLeft`: response[i]
// is the index into `matchingRight` the learner chose for prompt i (or -1 /
// undefined when they haven't matched it yet). This is exactly the shape the
// quiz runner stores in `answers[questionId]` and what computeQuizScore feeds
// back here at submit time, so author → render → attempt → results all agree.

function normalizeLeft(question) {
  return (Array.isArray(question?.matchingLeft) ? question.matchingLeft : [])
    .map(v => String(v ?? '').trim())
}

function normalizeKey(question) {
  return (Array.isArray(question?.matchingAnswer) ? question.matchingAnswer : [])
    .map(v => {
      const n = Number(v)
      return Number.isInteger(n) ? n : -1
    })
}

/**
 * Grade a matching response deterministically.
 *
 * Only prompts with non-empty text count toward the total — a blank left-column
 * row (padding from the editor) is ignored so it can't drag the score down.
 *
 * @param {object} question  carries matchingLeft[] + matchingAnswer[]
 * @param {Array<number>} response  response[i] = chosen right-index for left[i]
 * @returns {{ totalPairs:number, correctPairs:number, perRow:Array<boolean|null>, allCorrect:boolean }}
 *          perRow[i] is true/false for a scored row, or null for an ignored
 *          (blank-prompt) row so the UI can grey it out.
 */
export function gradeMatching(question, response) {
  const left = normalizeLeft(question)
  const key = normalizeKey(question)
  const resp = Array.isArray(response) ? response : []

  let totalPairs = 0
  let correctPairs = 0
  const perRow = left.map((prompt, i) => {
    if (!prompt) return null
    totalPairs += 1
    const chosen = Number(resp[i])
    const expected = key[i]
    const ok = Number.isInteger(chosen) && chosen === expected && expected >= 0
    if (ok) correctPairs += 1
    return ok
  })

  return {
    totalPairs,
    correctPairs,
    perRow,
    allCorrect: totalPairs > 0 && correctPairs === totalPairs,
  }
}

/** Convenience boolean used by the quiz scorer. */
export function matchingMatches(question, response) {
  return gradeMatching(question, response).allCorrect
}
