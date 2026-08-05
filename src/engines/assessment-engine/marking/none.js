/**
 * Do not mark this attempt.
 *
 * The past-paper practice route (`/papers/:paperId/quiz`) shows a learner the
 * questions and persists nothing — no result, no score, no attempt record.
 * Today that is expressed as the ABSENCE of a call: `PublicQuizRunner` simply
 * never scores. An absence cannot be asked about, so the route arrives at every
 * shared code path as a special case, and the way that special case is usually
 * handled is an `if` in the session.
 *
 * Naming it makes it answerable. A session configured with `none` gets a
 * verdict object like any other, and every consumer can read one field —
 * `graded` — instead of knowing which route it is serving.
 *
 * ## Zeroes here are not marks
 *
 * `score: 0` and `percentage: 0` are what an unmarked attempt's numbers have to
 * be; they are not a claim the learner scored nothing. `graded: false` is the
 * field that says so, and `persist/` refuses to write a verdict carrying it —
 * which is the actual protection. Without that refusal this strategy would be a
 * way to file 0% for every past-paper learner, which is worse than the special
 * case it replaces.
 */

/**
 * @returns {import('./index.js').Verdict}
 */
export function markWithNothing() {
  return {
    graded: false,
    score: 0,
    total: 0,
    percentage: 0,
    topicScores: {},
    pending: 0,
    pendingIds: [],
  }
}
