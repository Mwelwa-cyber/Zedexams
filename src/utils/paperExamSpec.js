/**
 * Re-export only. What a paper IS — its length and its question count — lives
 * in the shared past-paper quiz package.
 *
 * @see functions/shared/paperQuiz/examSpec.js
 *
 * DO NOT ADD A RULE HERE. `startAttempt` stamps the exam's `expiresAtMs` from
 * that module; a rung added only on this side is a cover that promises one
 * clock and a server that runs another.
 *
 * It sits in `src/utils/` rather than beside the `answerKey` shim in
 * `features/papers/quiz/lib/` because TWO features read it — `papers` (the
 * cover, the reader panel, timed practice) and `adminPastPapers` (the Studio,
 * and the archive worklist that shows which papers still have no exam time) —
 * and a module both read belongs below both.
 */
export {
  DEFAULT_DURATION_MIN,
  EXAM_SPEC_SOURCE,
  EXAM_SPEC_SOURCE_LABEL,
  MAX_DURATION_MIN,
  MIN_DURATION_MIN,
  clampDuration,
  estimateDurationMinutes,
  officialDurationMinutes,
  parsePrintedDuration,
  resolveDurationMinutes,
  resolveExamSpec,
} from '../../functions/shared/paperQuiz/examSpec.js'
