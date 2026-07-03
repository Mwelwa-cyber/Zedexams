/**
 * useOfflineQuiz — offline-resilient quiz progress + result submission
 * (Objective 3). Two jobs:
 *
 *   1. Persist progress after every answer to IndexedDB (survives reload, app
 *      kill, phone restart) and expose a `resume()` to restore it. This layers
 *      on the existing localStorage saveQuizSession without replacing it — the
 *      IndexedDB copy is the durable one for image-heavy attempts.
 *
 *   2. Queue the final result through the sync engine instead of writing
 *      Firestore directly. If the network is down at submit time the result is
 *      stored durably and uploaded automatically on reconnect — the learner
 *      never loses marks to a dropped connection.
 *
 * The actual Firestore write lives in a handler registered by the caller (or at
 * app start) via registerQuizResultHandler, keeping this hook I/O-light.
 */
import { useCallback } from 'react'
import { useOffline } from './OfflineContext.jsx'
import { putContent, getContent } from './offlineStore.js'
import { newEntry } from './contentCacheCore.js'
import { registerHandler } from './syncEngine.js'

/** Progress is cached as a `quiz` entry under a synthetic id so it dedupes per attempt. */
function progressId(quizId, uid) {
  return `progress:${quizId}:${uid}`
}

/**
 * Register the function that actually writes a completed quiz result to
 * Firestore. Call once at app start. `fn(payload)` runs inside the sync engine
 * with retry + dedup; throwing schedules a backoff retry.
 */
export function registerQuizResultHandler(fn) {
  return registerHandler('quiz-result', fn)
}

export function useOfflineQuiz(quizId, uid) {
  const { enqueue, online } = useOffline()

  /** Persist the current attempt state durably (call after each answer). */
  const saveProgress = useCallback(async (state) => {
    if (!quizId || !uid) return
    const entry = newEntry({ type: 'quiz', id: progressId(quizId, uid), tmp: true })
    await putContent(entry, { ...state, savedAt: Date.now() })
  }, [quizId, uid])

  /** Restore a previously-saved attempt, or null. */
  const resume = useCallback(async () => {
    if (!quizId || !uid) return null
    const rec = await getContent('quiz', progressId(quizId, uid))
    return rec?.payload || null
  }, [quizId, uid])

  /**
   * Submit the final result. Enqueues through the sync engine — uploaded now if
   * online, or automatically on reconnect if not. `attemptKey` makes the action
   * idempotent so a double-tap or a reconnect replay can't create two results.
   */
  const submitResult = useCallback(async (result, attemptKey) => {
    const naturalKey = attemptKey || `${quizId}:${uid}:${result?.startTime || result?.savedAt || Date.now()}`
    return enqueue({
      kind: 'quiz-result',
      naturalKey,
      payload: { quizId, uid, ...result },
      version: result?.savedAt || Date.now(),
    })
  }, [enqueue, quizId, uid])

  return { saveProgress, resume, submitResult, online }
}
