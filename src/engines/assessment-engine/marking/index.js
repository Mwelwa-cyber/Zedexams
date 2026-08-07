/**
 * The marking seam — one verdict shape, two strategies today, more later.
 *
 * `docs/phase3-plan.md` §5.0 and the owner's decision C: the session asks one
 * function for a verdict and never scores inline, so a third strategy is an
 * ADDITION rather than a refactor of the session. The two that exist are the
 * two Phase 3 actually needs:
 *
 *   • `clientKey` — grade against the answer key the client already holds.
 *     This is what every current runner does, and it is what makes the engine's
 *     writes comparable to the old path's byte for byte.
 *   • `none` — do not grade. Not a stub: the past-paper practice route persists
 *     nothing and shows no mark, and a strategy that returns an honest "no
 *     verdict" is how that route stops being a special case threaded through
 *     the session with an `if`.
 *
 * The Daily Quiz rework wants per-question SERVER marking mid-session. That is
 * a third strategy behind this same seam (`server`), and the seam is shaped so
 * it can be asynchronous — `markAttempt` is declared to return a verdict, and a
 * caller that awaits it works for all three.
 *
 * ## What this deliberately does NOT do
 *
 * It does not grade. `computeQuizScore` already owns every type-specific rule,
 * has its own tests, and is the authority the old path uses — so a second
 * implementation here would be exactly the fork this phase exists to remove.
 * `clientKey` PROJECTS the canonical model back into the shape that scorer
 * grades and delegates. The projection is the only new logic, and the
 * comparison test is what proves it lossless.
 */
import { markWithClientKey } from './clientKey.js'
import { markWithNothing } from './none.js'

/** The strategies a session may be configured with. */
export const MARKING_STRATEGIES = Object.freeze(['clientKey', 'none'])

const IMPLEMENTATIONS = Object.freeze({
  clientKey: markWithClientKey,
  none: markWithNothing,
})

/**
 * The verdict every strategy returns.
 *
 * Deliberately the same shape `computeQuizScore` already produces, plus
 * `graded`. Inventing a new one would mean translating at both ends — into the
 * verdict from the scorer, and out of it into the `results` document — and each
 * translation is a place the numbers can quietly change.
 *
 * `graded: false` is the honest "nobody marked this", and it is not the same as
 * a zero. `persist/` refuses to write an ungraded verdict, which is what stops
 * the past-paper route from ever filing a 0% for a learner who was never
 * marked.
 *
 * @typedef {object} Verdict
 * @property {boolean} graded
 * @property {number} score            marks earned
 * @property {number} total            marks available (excludes pending items)
 * @property {number} percentage       round(score/total*100), 0 when total is 0
 * @property {Object<string,{correct:number,total:number}>} topicScores
 * @property {number} pending          items awaiting AI marking
 * @property {string[]} pendingIds
 */

/**
 * Mark an attempt.
 *
 * @param {object} args
 * @param {object} args.assessment  a canonical assessment (`schemas/index.js`)
 * @param {object} args.answers     questionId → the learner's answer
 * @param {'clientKey'|'none'} args.strategy
 * @returns {Verdict}
 */
export function markAttempt({ assessment, answers, strategy }) {
  const implementation = IMPLEMENTATIONS[strategy]
  // An unknown strategy is refused rather than defaulted. Defaulting to
  // `clientKey` would mark an attempt the caller asked not to have marked, and
  // defaulting to `none` would silently drop every learner's score — there is
  // no safe guess, so there is no guess.
  if (!implementation) {
    throw new Error(
      `unknown marking strategy "${strategy}" — expected one of ${MARKING_STRATEGIES.join(', ')}`,
    )
  }
  return implementation({ assessment, answers })
}

export { markWithClientKey, markWithNothing }
