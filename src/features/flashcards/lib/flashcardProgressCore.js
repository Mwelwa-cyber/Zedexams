// Pure decisions behind flashcard mastery progress — the status a mastery
// count implies, and the document id a user+deck pair maps to.
//
// Split out of services/flashcardProgress.js (the Firestore half) per the
// *Core.js convention in AI_DEVELOPMENT_GUIDE.md §4.4: these three rules could
// not be tested without mocking Firebase while they lived beside `getDoc`,
// which is exactly the case the guide says to restructure. The logic is
// verbatim — this file decides nothing the repository did not already decide.
//
// Tested by flashcardProgressCore.test.js under plain node.

export const FLASHCARD_PROGRESS_STATUS = {
  NOT_STARTED: 'not-started',
  IN_PROGRESS:  'in-progress',
  COMPLETED:    'completed',
}

/**
 * The `flashcardProgress` document id for a user + deck.
 * One document per pair, so a re-study overwrites rather than accumulates.
 */
export const flashcardProgressId = (uid, deckId) => `${uid}_${deckId}`

/**
 * The status a mastery count implies.
 *
 * `>=` rather than `===` on the completed branch is load-bearing: a deck that
 * shrinks after a teacher regenerates it leaves a learner holding more mastered
 * indices than the deck now has, and that reads as finished rather than as
 * stuck one card short of a card that no longer exists.
 *
 * @param {number} masteredCount
 * @param {number} totalCards
 * @returns {string} one of FLASHCARD_PROGRESS_STATUS
 */
export function deriveFlashcardStatus(masteredCount, totalCards) {
  if (masteredCount === 0) return FLASHCARD_PROGRESS_STATUS.NOT_STARTED
  if (masteredCount >= totalCards) return FLASHCARD_PROGRESS_STATUS.COMPLETED
  return FLASHCARD_PROGRESS_STATUS.IN_PROGRESS
}
