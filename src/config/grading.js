/**
 * src/config/grading.js
 *
 * The CBC performance bands used across ZedExams, as a pure client-side
 * module. Mirrors the server-side scale in functions/grading/dailyExamGrading.js
 * (Excellent ≥90, Very Good ≥75, Good ≥60, Developing ≥50, else Needs
 * Improvement). Keep the two in sync — there is a test that pins these values.
 *
 * Used by the Class Register's mark schedules / records to turn a percentage
 * into a grade label, and to decide pass/fail (pass = ≥50%).
 */

// Ordered high → low; first band whose `min` the percentage meets wins.
export const CBC_GRADE_BANDS = [
  { min: 90, label: 'Excellent' },
  { min: 75, label: 'Very Good' },
  { min: 60, label: 'Good' },
  { min: 50, label: 'Developing' },
  { min: 0, label: 'Needs Improvement' },
]

/** A learner passes a record at or above this percentage. */
export const PASS_THRESHOLD = 50

/** Map a 0–100 percentage to its CBC performance label. */
export function gradeLabelForPercent(percent) {
  const p = Number(percent)
  const pct = Number.isFinite(p) ? p : 0
  const band = CBC_GRADE_BANDS.find((b) => pct >= b.min)
  return band ? band.label : 'Needs Improvement'
}

/** True when a percentage is a pass (≥ PASS_THRESHOLD). */
export function isPass(percent) {
  return Number(percent) >= PASS_THRESHOLD
}
