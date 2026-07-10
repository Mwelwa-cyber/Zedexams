// Quiz review status — pure helpers for the pre-submit review screen.
//
// Derives one flat entry per question from the runner's state (sections,
// answers, flagged/bookmarked, revealed, aiResults) so the review screen can
// list, count, and filter questions without duplicating any grading logic.
//
// The correctness rule is deliberately conservative and privacy-preserving:
// an entry carries 'correct'/'incorrect' ONLY when the runner has already
// revealed that question's feedback to the learner (practice mode). In exam
// mode nothing is revealed before submission, so every entry stays
// correctness-null and the review screen never leaks answers. When a revealed
// question's type has no cheap deterministic check here, correctness stays
// null rather than guessing.
//
// No React, no DOM — unit-testable under plain `node`
// (quizReviewStatus.test.js).

function questionsOfSection(section) {
  if (!section) return []
  if (section.kind === 'passage') {
    return Array.isArray(section.questions)
      ? section.questions
      : Array.isArray(section.passage?.questions)
        ? section.passage.questions
        : []
  }
  return section.question ? [section.question] : []
}

function deriveCorrectness({ question, answer, revealed, aiResult }) {
  if (!revealed) return null
  // AI/deterministically-checked types record { correct: boolean }.
  if (aiResult && typeof aiResult.correct === 'boolean') {
    return aiResult.correct ? 'correct' : 'incorrect'
  }
  // Typed answers store { text, correct } on the answer itself.
  if (answer && typeof answer === 'object' && typeof answer.correct === 'boolean') {
    return answer.correct ? 'correct' : 'incorrect'
  }
  // MCQ: the picked option index against the answer key.
  const type = question?.type || 'mcq'
  if ((type === 'mcq' || type === 'truefalse') && Number.isInteger(answer)) {
    if (question.correctAnswer === undefined || question.correctAnswer === null) return null
    return answer === question.correctAnswer ? 'correct' : 'incorrect'
  }
  return null
}

/**
 * Flatten runner state into review entries.
 * @returns {Array<{ questionId, number, sectionIndex, answered, bookmarked,
 *                   correctness: 'correct'|'incorrect'|null }>}
 */
export function buildReviewEntries({ sections, answers = {}, flagged = {}, revealed = {}, aiResults = {} } = {}) {
  const entries = []
  if (!Array.isArray(sections)) return entries
  let number = 0

  sections.forEach((section, sectionIndex) => {
    questionsOfSection(section).forEach((question) => {
      if (!question || !question.id) return
      number += 1
      const answer = answers[question.id]
      entries.push({
        questionId: question.id,
        number,
        sectionIndex,
        answered: answer !== undefined,
        bookmarked: Boolean(flagged[question.id]),
        correctness: deriveCorrectness({
          question,
          answer,
          revealed: Boolean(revealed[question.id]),
          aiResult: aiResults[question.id],
        }),
      })
    })
  })

  return entries
}

export const REVIEW_FILTERS = ['all', 'unanswered', 'bookmarked', 'incorrect']

export function filterReviewEntries(entries, filter) {
  const list = Array.isArray(entries) ? entries : []
  switch (filter) {
    case 'unanswered':
      return list.filter((e) => !e.answered)
    case 'bookmarked':
      return list.filter((e) => e.bookmarked)
    case 'incorrect':
      return list.filter((e) => e.correctness === 'incorrect')
    case 'all':
    default:
      return list
  }
}

export function reviewCounts(entries) {
  const list = Array.isArray(entries) ? entries : []
  return {
    total: list.length,
    answered: list.filter((e) => e.answered).length,
    unanswered: list.filter((e) => !e.answered).length,
    bookmarked: list.filter((e) => e.bookmarked).length,
    correct: list.filter((e) => e.correctness === 'correct').length,
    incorrect: list.filter((e) => e.correctness === 'incorrect').length,
    // Whether ANY entry carries correctness — drives showing the Incorrect
    // filter + per-chip correctness marks (true only in practice mode).
    hasCorrectness: list.some((e) => e.correctness !== null),
  }
}
