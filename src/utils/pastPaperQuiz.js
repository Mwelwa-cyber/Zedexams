/**
 * pastPaperQuiz — public-facing quiz attached to a past paper.
 *
 * Two responsibilities:
 *   1. Load a quiz + its questions that has been published with
 *      `publicAccess: true`. Firestore rules let this through for
 *      anonymous visitors so the marketing-page quiz works without
 *      forcing a sign-in first.
 *   2. Track the per-paper "free preview" quota in localStorage. Every
 *      visitor (anon or signed-in) gets the same gate: after answering
 *      30 questions on a given paper, the paywall fires. Pro learners
 *      bypass via `hasPremiumAccess()` at the call site.
 *
 * Counter scope: keyed by paperId + a stable visitor id. For signed-in
 * users the visitor id IS the uid (so the count survives sign-out /
 * sign-in on the same device). For anon visitors we mint a long-lived
 * browser id and store it under `zedexams:anonId`. That rule now lives in
 * `visitorId.js` because the engine's rollout buckets on the same id
 * (docs/phase3-plan.md §4.2); both names are re-exported here so existing
 * importers are unaffected.
 *
 * Counter storage: per choice, localStorage everywhere. This is per-
 * device by design — clearing cookies resets it, and a learner on two
 * devices gets two pools of 30. Acceptable trade-off for v1.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { QUIZ_LOAD, isPermissionDenied } from './pastPaperQuizLoad'

// The load-outcome vocabulary lives in the pure `pastPaperQuizLoad.js` (no
// Firebase import) so the plain-node tests can read it; re-exported here so
// callers keep importing the loader and its outcomes from one place.
export { QUIZ_LOAD, QUIZ_LOAD_TEXT, isPermissionDenied } from './pastPaperQuizLoad'

// The visitor-id rule lives in its own module — the engine's rollout flags
// bucket on the SAME id, and two derivations of it would drift silently.
import { resolveVisitorId } from './visitorId'

export { getOrCreateAnonId, resolveVisitorId } from './visitorId'

// One number, declared in the pure module that the free-set logic and the
// plain-node tests both read. Re-exported here under its historical name so
// every existing importer is unaffected.
export { DEFAULT_FREE_TO_QUESTION as FREE_QUESTION_LIMIT } from '../services/entitlements/freeSet.js'
import { DEFAULT_FREE_TO_QUESTION as FREE_QUESTION_LIMIT } from '../services/entitlements/freeSet.js'
const COUNTER_PREFIX = 'zedexams:pastPaperQuiz:'

function safeStorage() {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

function counterKey(paperId, visitorId) {
  return `${COUNTER_PREFIX}${paperId}:${visitorId}`
}

export function getAnsweredCount(paperId, uid) {
  const ls = safeStorage()
  if (!ls) return 0
  const raw = ls.getItem(counterKey(paperId, resolveVisitorId(uid)))
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Returns the new count after recording one more answered question. */
export function recordAnsweredQuestion(paperId, uid) {
  const ls = safeStorage()
  if (!ls) return 0
  const key = counterKey(paperId, resolveVisitorId(uid))
  const next = getAnsweredCount(paperId, uid) + 1
  try { ls.setItem(key, String(next)) } catch { /* ignore */ }
  return next
}

export function hasReachedFreeLimit(paperId, uid) {
  return getAnsweredCount(paperId, uid) >= FREE_QUESTION_LIMIT
}

export function resetCounter(paperId, uid) {
  const ls = safeStorage()
  if (!ls) return
  try { ls.removeItem(counterKey(paperId, resolveVisitorId(uid))) } catch { /* ignore */ }
}

// ── Quiz data ──────────────────────────────────────────────────

/**
 * Fetch a public-access quiz + its ordered questions.
 *
 * Always resolves to `{ outcome, quiz, questions, denied, error }` — it never
 * returns null and never rejects, so the caller decides what to say about a
 * failure instead of inheriting a silence. The Firestore read rule is the
 * security boundary: the read succeeds either because the quiz is
 * publicAccess + isPublished (anon / learner path) or because the visitor is
 * the admin / creator (preview-a-draft path).
 */
export async function loadPublicQuiz(quizId) {
  if (!quizId) {
    return { outcome: QUIZ_LOAD.UNAVAILABLE, quiz: null, questions: [], denied: false, error: null }
  }

  let quizSnap
  try {
    quizSnap = await getDoc(doc(db, 'quizzes', quizId))
  } catch (err) {
    return {
      outcome: isPermissionDenied(err) ? QUIZ_LOAD.UNAVAILABLE : QUIZ_LOAD.FAILED,
      quiz: null,
      questions: [],
      denied: isPermissionDenied(err),
      error: err,
    }
  }
  if (!quizSnap.exists()) {
    return { outcome: QUIZ_LOAD.UNAVAILABLE, quiz: null, questions: [], denied: false, error: null }
  }
  const quiz = { id: quizSnap.id, ...quizSnap.data() }

  let qs
  try {
    qs = await getDocs(query(
      collection(db, 'quizzes', quizId, 'questions'),
      orderBy('order', 'asc'),
    ))
  } catch (err) {
    // The quiz metadata is public but its questions are not. Reported as its
    // own outcome because the remedy is different from an unpublished quiz.
    return {
      outcome: isPermissionDenied(err) ? QUIZ_LOAD.QUESTIONS_BLOCKED : QUIZ_LOAD.FAILED,
      quiz,
      questions: [],
      denied: isPermissionDenied(err),
      error: err,
    }
  }
  const questions = qs.docs.map((d) => ({ id: d.id, ...d.data() }))
  return { outcome: QUIZ_LOAD.OK, quiz, questions, denied: false, error: null }
}
