/**
 * Estimate how long a paper takes to complete and compare it to the set
 * duration. Pure (no React) so it's unit-testable.
 *
 * The model is deliberately simple and transparent: each question costs a
 * base time plus a per-mark time that depends on its type (an essay-mark
 * costs far more thinking/writing time than an MCQ-mark). It's a planning aid,
 * not a stopwatch — teachers adjust from here.
 */

// minutes = base + perMark × marks, by question type.
const TIMING = {
  mcq: { base: 0.75, perMark: 0.25 },
  tf: { base: 0.5, perMark: 0.25 },
  short_answer: { base: 1, perMark: 1 },
  fill: { base: 0.5, perMark: 0.5 },
  numeric: { base: 1, perMark: 0.5 },
  matching: { base: 1.5, perMark: 0.5 },
  sequence: { base: 1.5, perMark: 0.5 },
  diagram: { base: 1, perMark: 1.5 },
  essay: { base: 3, perMark: 2 },
}
const DEFAULT_TIMING = { base: 1, perMark: 1 }

// Thresholds for the verdict. Over 25% past the allotted time → likely too
// long; under half → lots of spare time.
const OVER_RATIO = 1.25
const UNDER_RATIO = 0.5

/** Estimated minutes for one question. */
export function estimateQuestionMinutes(question) {
  const type = question?.type || 'mcq'
  const t = TIMING[type] || DEFAULT_TIMING
  const marks = Math.max(0, Math.min(50, Number(question?.marks) || 1))
  return t.base + t.perMark * marks
}

/** Estimated whole-paper minutes (rounded). */
export function estimatePaperMinutes(questions = []) {
  const total = questions.reduce((sum, q) => sum + estimateQuestionMinutes(q), 0)
  return Math.round(total)
}

/**
 * @returns {{ estimatedMinutes, duration, ratio, verdict }}
 *   verdict: 'no-duration' | 'over' | 'under' | 'ok'
 */
export function analyzeTiming(assessment = {}, questions = []) {
  const estimatedMinutes = estimatePaperMinutes(questions)
  const duration = Math.max(0, Math.round(Number(assessment.duration) || 0))
  let ratio = null
  let verdict = 'no-duration'
  if (duration > 0) {
    ratio = estimatedMinutes / duration
    if (ratio > OVER_RATIO) verdict = 'over'
    else if (estimatedMinutes > 0 && ratio < UNDER_RATIO) verdict = 'under'
    else verdict = 'ok'
  }
  return { estimatedMinutes, duration, ratio, verdict }
}
