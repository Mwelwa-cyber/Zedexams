/**
 * src/utils/classProgress.js
 *
 * Aggregate a class's marking records into a per-learner progress view:
 * each learner's percentage in every record, their average, and the class
 * average per record. Pure + dependency-free (reuses classRecordMath) so
 * scripts/test-class-progress.mjs can unit-test it with node.
 */

import { computeRecordRows } from '../../../utils/classRecordMath.js'
import { gradeLabelForPercent } from '../../../config/grading.js'

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** True when any learner has at least one mark entered in the record. */
function isMarked(record) {
  const marks = record?.marks || {}
  return Object.values(marks).some((m) => m && Object.values(m).some((v) => num(v) > 0))
}

/**
 * Build the progress matrix from a class's records (newest-first as returned
 * by listRecords). Only marked records are included — empty ones add noise.
 *
 * Returns:
 *   {
 *     records: [{ id, title, term, type, classAverage }],  // oldest → newest
 *     learners: [{ rosterId, fullName }],                  // sorted by name
 *     cells: { [rosterId]: { [recordId]: { percentage, gradeLabel } } },
 *     averages: { [rosterId]: number },                    // mean % across present records
 *   }
 */
export function buildClassProgress(allRecords) {
  const records = (allRecords || []).filter(isMarked)
  // Present oldest → newest so a row reads as a trend left-to-right.
  records.reverse()

  const learnerName = new Map() // rosterId → fullName (latest non-empty wins)
  const cells = {}
  const recordMeta = []

  for (const record of records) {
    const rows = computeRecordRows({
      snapshot: record.rosterSnapshot || [],
      columns: record.columns || [],
      marks: record.marks || {},
    })
    let sum = 0
    rows.forEach((r) => {
      if (r.fullName) learnerName.set(r.rosterId, r.fullName)
      if (!cells[r.rosterId]) cells[r.rosterId] = {}
      cells[r.rosterId][record.id] = { percentage: r.percentage, gradeLabel: r.gradeLabel }
      sum += num(r.percentage)
    })
    recordMeta.push({
      id: record.id,
      title: record.title || 'Untitled',
      term: record.term || '',
      type: record.type || 'mark_schedule',
      classAverage: rows.length ? Math.round(sum / rows.length) : 0,
    })
  }

  const learners = [...learnerName.entries()]
    .map(([rosterId, fullName]) => ({ rosterId, fullName }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName))

  const averages = {}
  for (const { rosterId } of learners) {
    const present = Object.values(cells[rosterId] || {})
    averages[rosterId] = present.length
      ? Math.round(present.reduce((s, c) => s + num(c.percentage), 0) / present.length)
      : 0
  }

  return { records: recordMeta, learners, cells, averages }
}

/** Convenience: a learner's overall grade label from their average. */
export function overallGrade(averagePercent) {
  return gradeLabelForPercent(averagePercent)
}
