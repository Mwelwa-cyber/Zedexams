/**
 * src/utils/numericGrading.js
 *
 * Pure grading helper for numeric-answer questions. Lives in its own
 * module so the unit tests in scripts/ can import it without dragging in
 * Firebase (which examService.js depends on, and which a plain Node
 * runner can't initialise).
 *
 * The grader is server-authoritative: it re-derives correctness from the
 * persisted `correctAnswer + tolerance` regardless of what the client
 * stored. A tampered client cannot grant itself marks; a buggy client
 * can't accidentally award them either.
 */

/**
 * Returns true iff the learner's answer parses to a finite number within
 * ±tolerance of the correct answer.
 *
 * Inputs:
 *   - given: number | string | { value } wrapper from the runner. Garbage
 *            inputs (NaN, non-numeric strings, undefined) return false —
 *            incorrect, but never throwing.
 *   - correctAnswer: the question's stored answer. Schema enforces it's a
 *                    finite number on write for numeric questions.
 *   - tolerance: the accepted ±range. Negative or non-finite → 0
 *                (exact match).
 *
 * Worked example:
 *   numericMatches('3.14', 3.14, 0)     === true   (exact)
 *   numericMatches(3.15,  3.14, 0.01)   === true   (within ±0.01)
 *   numericMatches('3.2', 3.14, 0.01)   === false  (outside range)
 *   numericMatches('hello', 3.14, 0)    === false  (garbage)
 *   numericMatches({ value: 3 }, 3, 0)  === true   (wrapper form)
 */
export function numericMatches(given, correctAnswer, tolerance) {
  const rawGiven = (given !== null && typeof given === 'object' && 'value' in given)
    ? given.value
    : given
  // An empty (or whitespace-only) string means "the learner didn't answer."
  // Without this guard Number('') === 0, so a blank submission would silently
  // grade correct on any question whose correctAnswer is 0.
  if (typeof rawGiven === 'string' && rawGiven.trim() === '') return false
  const a = typeof rawGiven === 'number' ? rawGiven : Number(rawGiven)
  const b = typeof correctAnswer === 'number' ? correctAnswer : Number(correctAnswer)
  const t = Number.isFinite(Number(tolerance)) ? Math.max(0, Number(tolerance)) : 0
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  // Floating-point slack: `3.15 - 3.14` evaluates to 0.010000000000000009
  // in IEEE 754, which would otherwise fail a literal-`0.01` tolerance
  // check and frustrate every teacher who sets up a tolerance with
  // decimals. The slack scales with the magnitudes involved so it never
  // becomes wide enough to materially change a teacher-set tolerance.
  const slack = Number.EPSILON * Math.max(Math.abs(a), Math.abs(b), 1)
  return Math.abs(a - b) <= t + slack
}
