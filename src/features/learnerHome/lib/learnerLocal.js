/**
 * learnerLocal — safe localStorage access for learner-home resume state.
 * Everything degrades to null/[] in private mode or when storage is
 * unavailable. These keys complement (never replace) the existing paper
 * keys written by the papers surfaces:
 *   zx_recent_papers          — array of recently opened paper ids
 *   paper-progress:{paperId}  — last visible page number (string)
 */

export function readJson(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch { /* quota / private mode — ignore */ }
}

export const PAPER_RESUME_KEY = 'lhx:paper-resume'
export const preferredTermKey = (uid) => `lhx:preferred-term:${uid || 'anon'}`

/** Most recently opened paper id from the papers hub history. */
export function readRecentPaperIds() {
  const list = readJson('zx_recent_papers', [])
  return Array.isArray(list) ? list : []
}

export function readPaperPage(paperId) {
  try {
    const n = Number(window.localStorage.getItem(`paper-progress:${paperId}`))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
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
