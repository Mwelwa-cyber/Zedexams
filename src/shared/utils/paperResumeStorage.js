/**
 * paperResumeStorage — the localStorage contract for "where was I in this
 * paper", shared by the two features on opposite ends of it.
 *
 * **Papers writes, learnerHome reads.** `src/features/papers/` records the
 * page a learner reached (`paper-progress:{paperId}`) and the resume snapshot
 * (`PAPER_RESUME_KEY`); `src/features/learnerHome/` reads both to draw the
 * dashboard hero's Continue Reading block. Neither owns it, so neither can
 * hold it — a module here is what stops one feature importing the other's
 * internals (`docs/architecture.md` §3: features never import features).
 *
 * This is the seam that `learnerLocal.js` documented in prose and could not
 * enforce, back when it said these keys "complement (never replace) the
 * existing paper keys written by the papers surfaces". The papers migration
 * is what turned that comment into a boundary the layering check can see:
 * before it, `PastPaperViewer` reaching into `learnerHome/lib/` was recorded
 * legacy→feature debt; after it, the same import would have been a
 * cross-feature one, and that list only ever shrinks.
 *
 * Everything degrades to null/no-op in private mode or when storage is
 * unavailable — a reading position is never worth an exception.
 */

export const PAPER_RESUME_KEY = 'lhx:paper-resume'

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

/** Last visible page number for a paper, or null if never opened. */
export function readPaperPage(paperId) {
  try {
    const n = Number(window.localStorage.getItem(`paper-progress:${paperId}`))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}
