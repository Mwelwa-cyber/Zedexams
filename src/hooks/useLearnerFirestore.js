/**
 * The learner read path as a hook — published content, the learner's own
 * results, their own payment history.
 *
 * ## Why this is a separate FILE and not an export of useFirestore.js
 *
 * It was one, briefly, and the bundle proved that wrong. `useFirestore.js`
 * statically imports all four data modules to compose its facade, so importing
 * ANY name from it — `useLearnerFirestore` included — pulls the authoring and
 * admin modules into the importer's chunk. The scoped hook only scopes
 * anything if the module it lives in is itself scoped.
 *
 * Measured on the 2026-08-18 production build: nine learner screens importing
 * the scoped hook from the facade path made no difference at all; moving it
 * here took the quiz write schema, the question schema and the admin payment
 * table off every one of them.
 *
 * So: import the hook from HERE. `useFirestore.js` does not re-export it, and
 * that is deliberate — a convenience re-export would be a working import that
 * silently costs what this module exists to avoid.
 */
import {
  getQuizzes, getQuizById, getLessons, getLessonById,
  saveResult, getResultById, getUserResults, getWeaknessAnalysis, getMyPayments,
} from './firestore/learnerData.js'

/**
 * Frozen at module scope: every member is a module-scope binding, so the object
 * never needs to be rebuilt and callers get a stable identity for free — which
 * is what lets it sit in a `useEffect` dependency list without re-running it.
 */
const LEARNER_API = Object.freeze({
  getQuizzes,
  getQuizById,
  getLessons,
  getLessonById,
  saveResult,
  getResultById,
  getUserResults,
  getWeaknessAnalysis,
  getMyPayments,
})

export function useLearnerFirestore() {
  return LEARNER_API
}

export default useLearnerFirestore
