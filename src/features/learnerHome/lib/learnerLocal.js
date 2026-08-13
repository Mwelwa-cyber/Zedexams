/**
 * learnerLocal — safe localStorage access for learner-home resume state.
 * Everything degrades to null/[] in private mode or when storage is
 * unavailable.
 *
 * The paper keys this file used to define live in
 * `src/shared/utils/paperResumeStorage.js` now, because `src/features/papers/`
 * is what WRITES them and this feature only reads them — see that module's
 * header. They are re-exported here so learner-home's own callers keep one
 * import, and so the read side stays described in one place.
 *
 * Keys read here that the papers surfaces write:
 *   zx_recent_papers          — array of recently opened paper ids
 *   paper-progress:{paperId}  — last visible page number (string)
 */

export {
  readJson,
  writeJson,
  readPaperPage,
  PAPER_RESUME_KEY,
} from '../../../shared/utils/paperResumeStorage'

import { readJson } from '../../../shared/utils/paperResumeStorage'

export const preferredTermKey = (uid) => `lhx:preferred-term:${uid || 'anon'}`

/** Most recently opened paper id from the papers hub history. */
export function readRecentPaperIds() {
  const list = readJson('zx_recent_papers', [])
  return Array.isArray(list) ? list : []
}

/**
 * In-progress practice quiz sessions saved by useQuizPersistence
 * (`examprep:quiz:session:{quizId}:{userId}`). Returns
 * [{ quizId, savedAt, answeredCount }] newest first. Exam-mode sessions
 * are excluded — daily-exam resume is driven by server locks instead.
 */
export function readQuizSessions(userId) {
  const out = []
  if (!userId) return out
  try {
    const prefix = 'examprep:quiz:session:'
    const suffix = `:${userId}`
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key || !key.startsWith(prefix) || !key.endsWith(suffix)) continue
      const quizId = key.slice(prefix.length, key.length - suffix.length)
      if (!quizId) continue
      const session = readJson(key)
      if (!session || session.mode === 'exam') continue
      out.push({
        quizId,
        savedAt: Number(session.savedAt) || 0,
        answeredCount: session.answers ? Object.keys(session.answers).length : 0,
      })
    }
  } catch { /* storage unavailable */ }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}
