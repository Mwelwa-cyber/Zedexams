/**
 * §7 — the funnel this feature is judged on.
 *
 *   paper_opened → quiz_mode_selected → attempt_started → question_answered
 *   → attempt_submitted → result_action
 *
 * The names are declared once. Typed at each call site they drift by a
 * character — `exam_submited`, `practice_answered` — and a funnel with a
 * misspelt step does not report a gap, it reports a cliff, which reads
 * identically to the product failing.
 *
 * ── The two numbers to watch after launch ────────────────────────────────
 *
 *   1. the drop-off between `quiz_mode_selected` and `attempt_started`
 *      (is the cover doing its job)
 *   2. the `exam_abandoned` rate (is the exam too long, or the exit warning
 *      too weak)
 *
 * Nothing here carries a learner's answers, a stem, or anything identifying —
 * these are aggregate product events on a route children use.
 *
 * Pure: the events are data; `capture` is passed in or imported by the caller.
 */

export const QUIZ_EVENT = Object.freeze({
  MODE_SELECTED: 'quiz_mode_selected',
  EXAM_STARTED: 'exam_started',
  EXAM_ABANDONED: 'exam_abandoned',
  EXAM_SUBMITTED: 'exam_submitted',
  EXAM_TIMEUP: 'exam_timeup',
  PRACTICE_STARTED: 'practice_started',
  PRACTICE_ANSWER: 'practice_answer',
  COACHING_SHOWN: 'coaching_shown',
  FIXUP_STARTED: 'fixup_started',
  NOTE_OPENED: 'note_opened_from_result',
  GAME_OPENED: 'game_opened_from_result',
})

/** Every event name, so a test can assert the set has not silently grown. */
export const QUIZ_EVENTS = Object.freeze(Object.values(QUIZ_EVENT))

/**
 * The properties each event carries, as a declaration.
 *
 * `buildEventProps` filters an object down to these keys, which is what stops
 * a convenient extra field — a paper title, a question stem, a uid — riding
 * along into PostHog because it happened to be in scope at the call site.
 */
export const QUIZ_EVENT_PROPS = Object.freeze({
  [QUIZ_EVENT.MODE_SELECTED]: ['mode', 'paperId'],
  // `durationSource` is how many exams are running on an APPROXIMATION rather
  // than on the paper's own printed time — i.e. how much of the archive still
  // needs its cover read (functions/shared/paperQuiz/examSpec.js). It names a
  // rung, never a learner.
  [QUIZ_EVENT.EXAM_STARTED]: ['paperId', 'questions', 'durationMin', 'durationSource', 'strictForward'],
  [QUIZ_EVENT.EXAM_ABANDONED]: ['paperId', 'answered', 'secondsIn'],
  [QUIZ_EVENT.EXAM_SUBMITTED]: ['paperId', 'percent', 'blanks', 'timeUsedSec'],
  [QUIZ_EVENT.EXAM_TIMEUP]: ['paperId', 'answered'],
  [QUIZ_EVENT.PRACTICE_STARTED]: ['paperId', 'resumed'],
  [QUIZ_EVENT.PRACTICE_ANSWER]: ['paperId', 'correct'],
  [QUIZ_EVENT.COACHING_SHOWN]: ['paperId', 'hasDistractorCopy', 'approved'],
  [QUIZ_EVENT.FIXUP_STARTED]: ['paperId', 'count'],
  [QUIZ_EVENT.NOTE_OPENED]: ['paperId', 'topicId'],
  [QUIZ_EVENT.GAME_OPENED]: ['paperId', 'slug'],
})

/**
 * Narrow `props` to the keys declared for `event`.
 *
 * An undeclared event returns {} rather than passing everything through: an
 * event nobody wrote a contract for should not be the one that leaks a field.
 */
export function buildEventProps(event, props = {}) {
  const allowed = QUIZ_EVENT_PROPS[event]
  if (!Array.isArray(allowed)) return {}
  const out = {}
  allowed.forEach((key) => {
    const v = props?.[key]
    if (v !== undefined && v !== null) out[key] = v
  })
  return out
}
