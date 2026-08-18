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
 * unavailable — a reading position is never worth an exception. That guarantee
 * now comes from `safeStorage`, which this module wraps: what stays here is the
 * part that is genuinely this seam's, namely the KEYS. Re-exporting the two
 * generic helpers keeps the existing importers of this path working.
 */
import { readJson, writeJson, readPositiveInt } from './safeStorage'

export { readJson, writeJson }

export const PAPER_RESUME_KEY = 'lhx:paper-resume'

/** Last visible page number for a paper, or null if never opened. */
export function readPaperPage(paperId) {
  return readPositiveInt(`paper-progress:${paperId}`)
}
