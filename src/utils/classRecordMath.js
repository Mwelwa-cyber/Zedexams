/**
 * src/utils/classRecordMath.js
 *
 * Deterministic maths for a Class Register marking record: per-learner total,
 * percentage, CBC grade and dense-ranked position, plus class-level stats
 * (average, highest, lowest, pass rate). Pure + dependency-free (only the
 * grading bands) so scripts/test-class-record.mjs can unit-test it with node.
 *
 * Shapes
 *   columns : [{ key, label, max }]                 — the mark columns (subjects / components)
 *   marks   : { [rosterId]: { [colKey]: number } }  — entered marks per learner
 *   snapshot: [{ rosterId, learnerNumber, fullName, gender }]  — frozen at record creation
 */

import { gradeLabelForPercent, PASS_THRESHOLD } from '../config/grading.js'

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Sum the per-column maximums — the mark a perfect learner would score. */
export function maxTotalOf(columns) {
  return (columns || []).reduce((sum, c) => sum + num(c.max), 0)
}

/** Freeze the active roster into a record snapshot (order preserved). */
export function snapshotFromRoster(roster) {
  return (roster || [])
    .filter((r) => (r.status ?? 'active') === 'active')
    .map((r) => ({
      rosterId: r.id,
      learnerNumber: r.learnerNumber || '',
      fullName: r.fullName || '',
      gender: r.gender ?? null,
    }))
}

/**
 * Build fully-computed rows from a snapshot + columns + marks. Each row:
 *   { rosterId, learnerNumber, fullName, values, total, percentage,
 *     gradeLabel, position }
 * Position is dense-ranked by total descending (ties share a place; the next
 * distinct total takes the next number) — the school-schedule convention.
 */
export function computeRecordRows({ snapshot, columns, marks }) {
  const maxTotal = maxTotalOf(columns)
  const rows = (snapshot || []).map((s) => {
    const values = (marks && marks[s.rosterId]) || {}
    const total = (columns || []).reduce((sum, c) => sum + num(values[c.key]), 0)
    const percentage = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0
    return {
      rosterId: s.rosterId,
      learnerNumber: s.learnerNumber || '',
      fullName: s.fullName || '',
      values,
      total,
      percentage,
      gradeLabel: gradeLabelForPercent(percentage),
    }
  })

  // Dense rank by total (desc). Compute on a sorted copy, then map positions
  // back onto the original snapshot order so the table stays stable.
  const byTotalDesc = [...rows].sort((a, b) => b.total - a.total)
  const positionByRoster = new Map()
  let position = 0
  let prevTotal = null
  byTotalDesc.forEach((r) => {
    if (r.total !== prevTotal) { position += 1; prevTotal = r.total }
    positionByRoster.set(r.rosterId, position)
  })

  return rows.map((r) => ({ ...r, position: positionByRoster.get(r.rosterId) }))
}

/**
 * Class-level stats from computed rows.
 *   { count, classAverage (%), classAverageMark, highest (mark),
 *     lowest (mark), passRate (%) }
 * An empty record returns all-zero stats rather than NaN.
 */
export function computeRecordStats(rows) {
  const count = (rows || []).length
  if (count === 0) {
    return { count: 0, classAverage: 0, classAverageMark: 0, highest: 0, lowest: 0, passRate: 0 }
  }
  const totals = rows.map((r) => num(r.total))
  const percents = rows.map((r) => num(r.percentage))
  const sumTotal = totals.reduce((a, b) => a + b, 0)
  const sumPercent = percents.reduce((a, b) => a + b, 0)
  const passed = percents.filter((p) => p >= PASS_THRESHOLD).length
  return {
    count,
    classAverage: Math.round(sumPercent / count),
    classAverageMark: Math.round(sumTotal / count),
    highest: Math.max(...totals),
    lowest: Math.min(...totals),
    passRate: Math.round((passed / count) * 100),
  }
}

/** One call: snapshot + columns + marks → { rows, stats }. */
export function computeRecord({ snapshot, columns, marks }) {
  const rows = computeRecordRows({ snapshot, columns, marks })
  return { rows, stats: computeRecordStats(rows) }
}

/**
 * Add a learner (snapshot entry) to an existing record and recompute its stats.
 * Idempotent — if the learner is already in the snapshot, nothing changes.
 * Returns { rosterSnapshot, stats, changed }. The new learner starts with no
 * marks (counts as zero) until the teacher enters them.
 */
export function addLearnerToRecord(record, snapshotEntry) {
  const existing = record?.rosterSnapshot || []
  if (existing.some((s) => s.rosterId === snapshotEntry.rosterId)) {
    return { rosterSnapshot: existing, stats: record?.stats || {}, changed: false }
  }
  const rosterSnapshot = [...existing, snapshotEntry]
  const { stats } = computeRecord({
    snapshot: rosterSnapshot,
    columns: record?.columns || [],
    marks: record?.marks || {},
  })
  return { rosterSnapshot, stats, changed: true }
}
