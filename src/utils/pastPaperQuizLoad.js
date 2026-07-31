/**
 * src/utils/pastPaperQuizLoad.js
 *
 * The vocabulary for "what happened when we tried to open a past paper's
 * quiz" — outcomes, the permission-denied test, and the words a visitor
 * reads. Pure: no Firebase, no React, no DOM, so the plain-node tests import
 * it directly (see scripts/test-past-paper-quiz-access.mjs). The Firestore
 * read itself lives in `pastPaperQuiz.js`, which re-exports everything here.
 *
 * Why this exists: `loadPublicQuiz` used to answer with the payload or
 * `null`, and its quiz read swallowed every thrown error into that same
 * `null` — no console line, no report, no distinction. A quiz whose
 * `publicAccess`/`isPublished` flags were off (a Firestore permission-denied),
 * a quiz an admin had deleted, and a dropped connection all produced one
 * indistinguishable value. So a broken link on a paper that ADVERTISES a quiz
 * looked exactly like a paper without one, and nobody upstream ever heard
 * about it. These outcomes exist so the caller can say which failure happened,
 * report it, and offer the right next step.
 */

export const QUIZ_LOAD = {
  /** The quiz and its questions were read. */
  OK: 'ok',
  /**
   * The quiz document could not be read. Two causes, deliberately folded into
   * ONE outcome because an anonymous caller cannot tell them apart: the rule
   * (`publicAccess && isPublished`) refused the read, or the doc is gone.
   * Firestore denies rather than 404s when a rule reads `resource.data` on a
   * document that does not exist, so both arrive as permission-denied.
   */
  UNAVAILABLE: 'unavailable',
  /**
   * The quiz doc read fine but its questions were refused. The questions rule
   * additionally requires `quizType != 'daily_exam'`, so this is the shape of
   * the regression where the daily-exam picker pins a past-paper quiz and
   * blocks the public page for the rest of the day.
   */
  QUESTIONS_BLOCKED: 'questions-blocked',
  /** Transport / unknown failure. Retryable — the visitor should try again. */
  FAILED: 'failed',
}

/** True for a Firestore rules refusal, whatever wrapper it arrives in. */
export function isPermissionDenied(err) {
  const code = String(err?.code ?? '').toLowerCase()
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return true
  return /missing or insufficient permissions|permission[-_ ]denied/i.test(String(err?.message ?? ''))
}

/**
 * Learner-facing copy per outcome. Declared here rather than typed at the call
 * site so the words a visitor reads are pinned by the tests: none of them may
 * claim the paper has no quiz, because the visitor only reached this route
 * BECAUSE the paper advertises one — and none of these outcomes establishes
 * that it doesn't.
 */
export const QUIZ_LOAD_TEXT = {
  [QUIZ_LOAD.UNAVAILABLE]:
    'This paper\'s quiz has been taken offline while we check it. The paper itself is still here — try another paper\'s quiz in the meantime.',
  [QUIZ_LOAD.QUESTIONS_BLOCKED]:
    'This paper\'s questions are not open for practice right now. Try another paper\'s quiz in the meantime.',
  [QUIZ_LOAD.FAILED]:
    'We could not load this quiz. Check your connection and try again.',
}
