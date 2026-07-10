/**
 * Quiz session persistence — localStorage-backed save/load/clear.
 *
 * Key design decisions:
 *  - Exam sessions are keyed by endTime: if the timestamp has passed the
 *    session is treated as expired and silently discarded.
 *  - Practice sessions expire after PRACTICE_TTL (7 days) to avoid
 *    indefinite accumulation.
 *  - All storage errors are swallowed so a full localStorage quota never
 *    crashes the quiz.
 *
 * Firebase / Firestore migration path:
 *  Replace the localStorage calls below with Firestore reads/writes
 *  (e.g. setDoc / getDoc on a `quizSessions` collection keyed by userId+quizId).
 *  The shape of `state` is already Firestore-friendly (plain JSON).
 */

const PRACTICE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days in ms

function sessionKey(quizId, userId) {
  return `examprep:quiz:session:${quizId}:${userId}`
}

/**
 * Persist the current quiz state.
 * @param {string} quizId
 * @param {string} userId
 * @param {{
 *   mode: string,
 *   answers: object,
 *   flagged: object,
 *   revealed: object,
 *   shortText: object,
 *   aiResults: object,
 *   activeSectionIndex: number,
 *   endTime: number|null,   // Unix ms timestamp when exam ends
 *   startTime: number|null, // Unix ms when the quiz was started
 *   savedAt: number,        // Unix ms of this save (set by caller)
 * }} state
 */
export function saveQuizSession(quizId, userId, state) {
  try {
    localStorage.setItem(sessionKey(quizId, userId), JSON.stringify(state))
  } catch {
    // Quota exceeded or private-browsing restriction — ignore
  }
}

/**
 * Load a previously saved session.
 * Returns `null` if nothing is saved, the session has expired, or data is corrupt.
 *
 * @param {string} quizId
 * @param {string} userId
 * @param {{ includeExpired?: boolean }} [opts]
 *   When `includeExpired` is true, an exam whose `endTime` has already passed
 *   is returned with an `expired: true` marker instead of being dropped, so the
 *   caller can reconstruct the attempt and auto-submit it rather than losing
 *   every saved answer. A genuinely-expired practice session is still discarded.
 */
export function loadQuizSession(quizId, userId, opts = {}) {
  const { includeExpired = false } = opts
  try {
    const raw = localStorage.getItem(sessionKey(quizId, userId))
    if (!raw) return null

    const session = JSON.parse(raw)

    if (session.mode === 'exam') {
      // Exam sessions are only valid while endTime is still in the future.
      // A caller that opts into includeExpired gets the expired attempt back
      // (flagged) so it can submit the saved answers instead of discarding them.
      if (!session.endTime || session.endTime <= Date.now()) {
        return includeExpired ? { ...session, expired: true } : null
      }
    } else {
      // Practice sessions expire after 7 days
      if (!session.savedAt || Date.now() - session.savedAt > PRACTICE_TTL) return null
    }

    return session
  } catch {
    return null
  }
}

/**
 * Remove the saved session after submission or when starting fresh.
 */
export function clearQuizSession(quizId, userId) {
  try {
    localStorage.removeItem(sessionKey(quizId, userId))
  } catch {}
}
