/**
 * Record of Work derivation — the deterministic core of the Record of
 * Work studio. The record of work is the statutory weekly log of what
 * was ACTUALLY taught (head teachers check it against the scheme of
 * work), so the studio builds one FROM a saved scheme — no AI: every
 * scheme week becomes a record row whose "work done" starts as the
 * week's planned activities, which the teacher then edits to reflect
 * reality and annotates with coverage + remarks.
 *
 * Reuses the scheme normalisers from weeklyForecast.js (both saved
 * shapes: the app generator's schema and the official 9-column grid).
 * Dependency-free so scripts/test-record-of-work.mjs can unit-test it
 * with plain node, per repo convention.
 */

import { schemeWeeks, weekNumberOf, normalizeSchemeWeek } from '../shared/utils/weeklyForecast.js'

/** Coverage states a teacher can mark a week with (blank = not yet logged). */
export const COVERAGE_OPTIONS = [
  { value: '', label: 'Not logged yet' },
  { value: 'full', label: 'Fully covered' },
  { value: 'partial', label: 'Partially covered' },
  { value: 'none', label: 'Not covered' },
]

const COVERAGE_LABEL = Object.fromEntries(
  COVERAGE_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]),
)

export function coverageLabel(code) {
  return COVERAGE_LABEL[code] || ''
}

/** An empty record row the teacher fills in by hand. */
export function blankRecordWeek(n) {
  return {
    week: String(n ?? ''),
    weekEnding: '',
    topic: '',
    subtopic: '',
    workDone: [],
    coverage: '',
    remarks: '',
  }
}

/**
 * The "work done" prefill for a normalised scheme week: the planned
 * learning activities ARE the week's work, so they seed the log; weeks
 * without activities fall back to the specific-competence sentence.
 */
export function workDonePrefill(norm) {
  if (!norm) return []
  if (norm.learningActivities.length) return [...norm.learningActivities]
  return norm.specificCompetence ? [norm.specificCompetence] : []
}

/**
 * Build the term's record rows from a saved scheme (either shape): one
 * row per scheme week, coverage and remarks blank for the teacher to
 * fill in as the term progresses. Rows are independent copies — editing
 * one never leaks into another.
 */
export function buildRecordWeeks(schemeOutput) {
  return schemeWeeks(schemeOutput).map((week, i) => {
    const norm = normalizeSchemeWeek(week)
    const n = weekNumberOf(week)
    return {
      week: String(n ?? i + 1),
      weekEnding: '',
      topic: norm?.topic || '',
      subtopic: norm?.subtopic || '',
      workDone: workDonePrefill(norm),
      coverage: '',
      remarks: '',
    }
  })
}

/**
 * The REMARKS cell as printed: the coverage label leads, the teacher's
 * own remark follows (e.g. "Partially covered — re-teach carrying tens"),
 * and a recorded follow-up action closes the cell as "Follow-up: …" —
 * the one variance field approved for the statutory print (2026-07-15
 * sign-off: follow-up in REMARKS only; date taught, reason and initials
 * stay digital-only).
 */
export function printedRemark(row) {
  const label = coverageLabel(row?.coverage)
  const remark = String(row?.remarks || '').trim()
  const followUp = String(row?.variance?.followUp || '').trim()
  const base = label && remark ? `${label} — ${remark}` : label || remark
  if (!followUp) return base
  return base ? `${base} · Follow-up: ${followUp}` : `Follow-up: ${followUp}`
}

/** How much of the term is logged — drives the studio's coverage chip. */
export function coverageSummary(rows) {
  const list = Array.isArray(rows) ? rows : []
  const summary = { full: 0, partial: 0, none: 0, blank: 0, total: list.length }
  list.forEach((row) => {
    const code = row?.coverage
    if (code === 'full') summary.full += 1
    else if (code === 'partial') summary.partial += 1
    else if (code === 'none') summary.none += 1
    else summary.blank += 1
  })
  return summary
}
