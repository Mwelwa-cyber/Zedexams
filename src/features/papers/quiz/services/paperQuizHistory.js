/**
 * The learner's own past attempts at one paper — what the cover's best-score
 * card is built from.
 *
 * A direct Firestore read rather than a callable: `paperQuizAttempts` is
 * owner-readable by rule, the query is indexed, and a callable would add a
 * cold start to the cover, which is the screen a learner is deciding on.
 * Writes are a different matter and go nowhere near here — every one of them
 * is server-side (see the rules block: client writes are denied outright).
 */

import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../../../firebase/config'

const ATTEMPTS = 'paperQuizAttempts'

/**
 * Submitted exam attempts for one learner on one paper, newest first.
 *
 * Bounded at 20. The card shows a personal best and a count; a learner with
 * more than twenty attempts at one paper has a best inside the last twenty
 * with near-certainty, and reading a hundred documents to render one number on
 * a cover screen is not a trade worth making on a Zambian connection.
 *
 * Ordered by `startedAtMs` so it rides the same composite index the server's
 * live-attempt lookup needs — one index rather than two.
 */
export async function listPaperAttempts(uid, paperId, { max = 20 } = {}) {
  if (!uid || !paperId) return []
  try {
    const snap = await getDocs(query(
      collection(db, ATTEMPTS),
      where('learnerId', '==', uid),
      where('paperId', '==', paperId),
      where('status', '==', 'submitted'),
      orderBy('startedAtMs', 'desc'),
      limit(max),
    ))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    // A failed read hides the card. It must never block the cover: the whole
    // screen exists to get a learner into a paper, and "we could not load your
    // history" is not a reason to stop them.
    console.warn('[paperQuiz] attempt history unavailable', err?.message || err)
    return []
  }
}

/**
 * The card's three facts (§1b.4): personal best, how many times they have sat
 * it, and their weakest part.
 *
 * Returns null on a FIRST attempt — "hidden entirely on a first attempt — do
 * not show an empty ring". A ring at 0/60 above the words "best score" is a
 * discouraging thing to put in front of a child who has not started.
 */
export function summarizeAttempts(attempts = []) {
  const list = (Array.isArray(attempts) ? attempts : []).filter((a) => a?.score)
  if (list.length === 0) return null
  let best = list[0]
  list.forEach((a) => {
    if ((a.score?.percent ?? -1) > (best.score?.percent ?? -1)) best = a
  })
  // The weakest PART, not the weakest topic: the card says "spelling is your
  // weakest part", and a section is the unit a learner recognises from the
  // printed paper. Read from the best attempt rather than pooled across all of
  // them, so the number beside it and the weakness describe one sitting.
  const sections = Array.isArray(best.bySection) ? best.bySection : []
  let weakest = null
  sections.forEach((s) => {
    if (!s?.total) return
    const pct = s.right / s.total
    if (weakest === null || pct < weakest.pct) weakest = { name: s.name, pct }
  })
  return {
    attempts: list.length,
    best: { right: best.score.right ?? 0, total: best.score.total ?? 0, percent: best.score.percent ?? 0 },
    // Only worth naming when it is actually a weakness. A learner who scored
    // 19/20 on their worst section does not have a weakest part, and telling
    // them they do is inventing a problem.
    weakestPart: weakest && weakest.pct < 0.75 ? weakest.name : '',
    lastAttemptId: list[0]?.id || null,
  }
}
