/**
 * src/schemas/result.js
 *
 * Read-side normaliser for the `results` Firestore collection — quiz
 * completion records saved by QuizRunnerV2.handleSubmit via
 * useFirestore.saveResult.
 *
 * Why no write schema (yet)?
 *   - saveResult writes a stable, well-tested shape from a single caller.
 *     A strict write schema here would risk rejecting legitimate writes
 *     for marginal benefit. The high-value gain is on the READ side, where
 *     legacy docs can render "NaN%" or crash dashboards.
 *   - When a second writer appears, lift a write schema out of the
 *     reader-fields list below.
 *
 * Reader-fields catalogued from the codebase:
 *   - result.percentage      (QuizResultsV2: `${result.percentage}%`)
 *   - result.score           (QuizResultsV2: `${result.score}/${result.totalMarks}`)
 *   - result.totalMarks      (same)
 *   - result.subject         (QuizResultsV2, GradeHub, dashboards)
 *   - result.grade           (QuizResultsV2: `Grade ${result.grade}`)
 *   - result.quizId          (QuizResultsV2: navigate retry link)
 *   - result.quizTitle       (admin dashboards)
 *   - result.completedAt     (Timestamp, sort key + rendered date)
 *   - result.topicScores     (getWeaknessAnalysis: Object.entries → crashes on array)
 *   - result.userId          (AdminLearnerProfile filter, not rendered)
 *   - result.answers         (re-runner; consumers iterate)
 *
 * Sibling of coerceQuiz / coerceAttempt / coerceQuestion — same shape,
 * never throws, returns null for non-object input.
 */

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function safeFiniteNumber(v, fallback = 0) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function safeString(v, fallback = '') {
  if (v == null) return fallback
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

/**
 * Normalise a raw Firestore result document for safe consumption by the UI.
 *
 * Defensive guarantees on the returned object:
 *   - Returns null for null/undefined/non-object/array input.
 *   - `percentage` is a finite number clamped to [0, 100]. A legacy doc
 *     with `percentage: null` no longer renders "null%" on the share
 *     card; `percentage: NaN` no longer breaks every comparison in
 *     getWeaknessAnalysis.
 *   - `score` and `totalMarks` are finite ≥0 numbers (the results page
 *     renders `${score}/${totalMarks}` and the weakness analysis sums
 *     them — NaN propagation would silently corrupt both).
 *   - `topicScores` is always a plain object. A legacy `topicScores: []`
 *     would crash `Object.entries(r.topicScores)` in getWeaknessAnalysis.
 *   - `answers` is always a plain object (same risk shape as PR #379).
 *   - String fields (`subject`, `quizTitle`, `quizId`, `userId`) survive
 *     untouched or become '' so renderers never see undefined.
 *   - `grade` accepts either string or number (some docs store '5',
 *     others store 5).
 *
 * Every other field is preserved verbatim — readers that rely on
 * undocumented extras (mode, timeSpent, completedAt, …) keep working.
 */
export function coerceResult(raw) {
  if (!isPlainObject(raw)) return null

  // Percentage: clamp to [0, 100] and guard against NaN/null/undefined.
  const rawPct = safeFiniteNumber(raw.percentage, 0)
  const percentage = Math.max(0, Math.min(100, rawPct))

  const score = Math.max(0, safeFiniteNumber(raw.score, 0))
  const totalMarks = Math.max(0, safeFiniteNumber(raw.totalMarks, 0))

  const topicScores = isPlainObject(raw.topicScores) ? raw.topicScores : {}
  const answers = isPlainObject(raw.answers) ? raw.answers : {}

  // Grade may be a string or a number depending on the source quiz doc;
  // preserve both shapes rather than forcing a string.
  const grade = (typeof raw.grade === 'string' || typeof raw.grade === 'number')
    ? raw.grade
    : ''

  return {
    ...raw,
    percentage,
    score,
    totalMarks,
    topicScores,
    answers,
    subject: safeString(raw.subject),
    quizTitle: safeString(raw.quizTitle),
    quizId: safeString(raw.quizId),
    userId: safeString(raw.userId),
    grade,
  }
}
