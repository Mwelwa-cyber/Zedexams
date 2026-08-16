/**
 * paperAttemptDraft — the learner's answers, saved before the results render.
 *
 * Hitting the free-set boundary must never lose work. Twenty questions of real
 * effort followed by a lost session is the single most expensive thing this
 * whole design is trying to prevent, and it is the failure a learner never
 * gives you a second chance to fix.
 *
 * ── Why localStorage and not `attempts/{attemptId}` in Firestore ────────
 *
 * `PublicQuizRunner` has a load-bearing ZERO-WRITE property, pinned by
 * `test:paper-quiz-zero-write`: the route serves anonymous visitors on a
 * public, crawled URL, and it is the Assessment Engine's designated first flag
 * flip precisely because a defect there cannot corrupt persisted data. Adding
 * a Firestore write would retire that guarantee for every visitor in order to
 * serve the subset who are signed in — and would write nothing at all for the
 * anonymous majority, who have no uid to write under.
 *
 * So the draft is per-device, keyed by the same stable visitor id the
 * free-preview counter and the rollout buckets already use. The guarantee it
 * makes is the one the design asks for — kill the app after the last free
 * question, reload, and the answers are intact and the app resumes on the
 * results screen — and it makes it for signed-in and anonymous learners alike.
 *
 * If a future signed-in runner needs cross-device attempt history, that is a
 * Firestore write on THAT runner, not a retreat from this route's property.
 */

import { resolveVisitorId } from '../../../utils/visitorId'

const PREFIX = 'zedexams:paperAttempt:'
/** Drafts older than this are stale rather than resumable. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function storage() {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

function key(paperId, uid) {
  return `${PREFIX}${paperId}:${resolveVisitorId(uid)}`
}

/**
 * @typedef {object} PaperAttemptDraft
 * @property {string}  paperId
 * @property {Array<{questionId:string, order:number, selectedIndex:number, correctIndex:number|null, correct:boolean}>} answers
 * @property {number}  score
 * @property {number}  outOf
 * @property {boolean} complete      the run reached its end (free-set or paper)
 * @property {boolean} freeSetEnded  it ended at the free-set boundary
 * @property {string}  savedAt       ISO
 */

/**
 * Write the draft. Called BEFORE the results screen is allowed to render, and
 * synchronously, so a crash between "last answer" and "results" cannot land in
 * the window where the work exists only in React state.
 *
 * @returns {boolean} whether it was actually written — a caller may want to
 *   know that storage refused (private mode) rather than assume it worked.
 */
export function saveAttemptDraft(paperId, uid, draft) {
  const ls = storage()
  if (!ls || !paperId) return false
  try {
    ls.setItem(key(paperId, uid), JSON.stringify({
      ...draft,
      paperId,
      savedAt: new Date().toISOString(),
    }))
    return true
  } catch {
    return false
  }
}

/**
 * Read the draft, or null.
 *
 * A draft whose shape does not parse, or which is older than `MAX_AGE_MS`,
 * reads as absent rather than being repaired — resuming a learner onto a
 * half-understood results screen is worse than starting them fresh.
 */
export function readAttemptDraft(paperId, uid) {
  const ls = storage()
  if (!ls || !paperId) return null
  try {
    const raw = ls.getItem(key(paperId, uid))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.answers)) return null
    const savedAt = Date.parse(parsed.savedAt || '')
    if (Number.isFinite(savedAt) && Date.now() - savedAt > MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function clearAttemptDraft(paperId, uid) {
  const ls = storage()
  if (!ls || !paperId) return
  try { ls.removeItem(key(paperId, uid)) } catch { /* ignore */ }
}

/**
 * The weakest topic in an attempt, from the questions actually got wrong.
 *
 * Returns null rather than a guess when nothing is attributable — a topic the
 * learner is told to work on has to be one the data supports, or the next
 * piece of advice is not believed either. Requires at least two misses in a
 * topic before naming it: one wrong answer is not a weakness.
 */
export function weakestTopic(answers, questions) {
  const misses = new Map()
  for (const a of answers || []) {
    if (a.correct) continue
    const q = (questions || []).find((x) => x.id === a.questionId)
    const topic = q?.topic || q?.subTopic || q?.category
    if (!topic) continue
    misses.set(topic, (misses.get(topic) || 0) + 1)
  }
  let best = null
  for (const [topic, count] of misses) {
    if (count >= 2 && (!best || count > best.count)) best = { topic, count }
  }
  if (!best) return null
  const totalWrong = (answers || []).filter((a) => !a.correct).length
  return {
    topic: best.topic,
    count: best.count,
    detail: `${best.count} of your ${totalWrong} misses were in this topic.`,
  }
}
