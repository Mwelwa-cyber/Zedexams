/**
 * Shared internals for the Firestore data modules.
 *
 * Query caps, the swallowed-read reporter and the two process-cached lookups
 * that more than one module needs. Everything here was module scope inside the
 * old single-file `useFirestore`; splitting the callers meant the shared parts
 * needed a home that all of them may import without importing each other.
 *
 * This module deliberately depends on nothing above `src/config/` — it is
 * imported by the learner read path, which must stay free of the authoring
 * schemas (see `attemptLimiter.js` for the measurement behind that rule).
 */
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { reportClientError } from '../../utils/clientErrorReporting.js'

// Safety cap on every "get all X" admin query — keeps a single mistaken
// dashboard reload from reading the entire collection. Admin pages that
// need more should paginate or use count aggregations instead.
//
// Tuned down from 500 → 200 after observing that the Admin Learners page
// reads users + results on every mount; at 500/500 a single admin reload
// burned ~1k document reads, which was a noticeable chunk of the overload
// signal. 200 is enough to show "recent activity" for any realistic class
// load; admins who need a longer view should use the dedicated reports.
export const ADMIN_QUERY_LIMIT = 200

// Safety cap on the learner-facing quiz library query. Without it, getQuizzes
// reads *every* published practice quiz for a grade on each load — and each
// quiz doc carries its full embedded `passages[]` (comprehension text + image
// URLs) that the list view never renders, so the payload (and the time-to-show
// on a slow mobile connection) grows unbounded with the catalogue. 400 is far
// above any realistic per-grade practice count, so it never trims the visible
// library; it only stops a runaway full-collection read. Ordered newest-first.
export const LEARNER_QUIZ_LIMIT = 400

// Same safety cap for the learner lesson library: getLessons reads every
// published lesson for a grade/subject on each filter change, and a lesson doc
// carries its full slide/content payload. 400 is well above any realistic
// per-(grade, subject) lesson count, so it never trims the library — it only
// stops an unbounded read as the catalogue grows. Newest-first.
export const LEARNER_LESSON_LIMIT = 400

// Safety cap on the teacher-owned content lists (own quizzes / lessons /
// assessments). These `where('createdBy','==',uid) + orderBy` queries feed
// library + header lists and had no bound, so a prolific author read their
// entire back-catalogue on every mount. 300 is far above any realistic
// per-teacher count, so it never trims a visible library — it only stops an
// unbounded read as the account ages. Newest-first.
export const TEACHER_QUERY_LIMIT = 300

// How far back the admin "recent activity" queries reach. 90 days is the
// rolling window the dashboards visualise; reading the entire history on
// every admin reload was a major Firestore read-amplifier.
export const ADMIN_RECENT_WINDOW_DAYS = 90

// Log a swallowed Firestore read failure to the console (dev) AND forward it to
// the client error reporter (prod analytics). Every getter below degrades to
// []/null on error, which keeps the UI alive but made read failures —
// permission-denied, a missing composite index, an offline round-trip —
// completely invisible in production. reportClientError dedups + rate-limits
// (5/session) and stamps network status, so routing every read through this is
// safe and never throws. `label` is the getter name → context `firestore.<fn>`.
export function reportRead(label, e) {
  console.error(`${label}:`, e)
  reportClientError(e, `firestore.${label}`)
}

// One-shot, process-cached read of the quiz-library cutover flag. getQuizzes
// reads the lightweight `quizSummaries` mirror (quiz docs minus the heavy
// passages[]/parts[]/description — maintained by the onQuizWritten Cloud
// Function) only once an operator flips `settings/quizLibrary.useSummaries` to
// true. The backfill script (scripts/backfill-quiz-summaries.mjs) sets it after
// it populates existing docs, so the cutover is atomic and operator-controlled:
// until then — and on any mirror read error — the library keeps reading the
// full `quizzes` collection, so the migration can never blank the catalogue.
// Cached for the session because the flag only flips once, at cutover.
let _useQuizSummariesPromise
export function shouldUseQuizSummaries() {
  if (!_useQuizSummariesPromise) {
    _useQuizSummariesPromise = getDoc(doc(db, 'settings', 'quizLibrary'))
      .then(s => (s.exists() ? s.data()?.useSummaries === true : false))
      .catch(() => false)
  }
  return _useQuizSummariesPromise
}
