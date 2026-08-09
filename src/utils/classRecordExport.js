/**
 * src/utils/classRecordExport.js
 *
 * Adapt a Class Register marking record into the `schedule` artifact the
 * document exporters (markScheduleToXlsx / markScheduleToDocx /
 * reportCardsToDocx) expect. Pure + dependency-free so it's node-testable.
 *
 * SBA records export as a clean ECZ results sheet: a single "SBA Mark" column
 * holding each learner's converted mark out of 10 (their 10% for the grade) —
 * the figure submitted to OMES — rather than the raw per-task marks. Other
 * record types export their raw mark columns as-is.
 */

import { buildSchedule } from '../shared/utils/markSchedule.js'
import { computeRecordRows, maxTotalOf } from './classRecordMath.js'
import { convertSbaMark } from '../config/sba.js'
import { classGradeShortLabel, formatClassGrade } from '../schemas/classRegister.js'

function header(record, register) {
  return {
    school: register.school || '',
    grade: register.grade ? classGradeShortLabel(register.grade) : '',
    // Full human label ("Form 1", "Baby Class") — the exporters' headings
    // prefer this over `grade`, so non-"Grade N" classes don't print as
    // "GRADE Form 1" / "GRADE Baby Class".
    gradeLabel: register.grade ? formatClassGrade(register.grade) : '',
    term: record.term || register.term || '',
    year: record.year || register.year || '',
  }
}

/**
 * Build the exporter `schedule` for a record. Returns { header, subjects, pupils }
 * where pupils carry total, dense-ranked position and a teacher-voice comment
 * (via buildSchedule).
 */
export function recordToSchedule(record, register) {
  if (record.type === 'sba') {
    // Convert each learner's task total to the ECZ /10 and present that as the
    // single mark column.
    const rawMax = maxTotalOf(record.columns || [])
    const rows = computeRecordRows({
      snapshot: record.rosterSnapshot || [],
      columns: record.columns || [],
      marks: record.marks || {},
    })
    const subjects = [{ key: 'sba10', label: 'SBA Mark', max: 10 }]
    const pupils = buildSchedule(
      rows.map((r, i) => ({
        sn: i + 1,
        name: r.fullName || '',
        marks: { sba10: convertSbaMark(r.total, rawMax).rounded },
      })),
      subjects,
    )
    return { header: header(record, register), subjects, pupils }
  }

  const subjects = (record.columns || []).map((c) => ({ key: c.key, label: c.label, max: Number(c.max) || 0 }))
  const pupils = buildSchedule(
    (record.rosterSnapshot || []).map((s, i) => ({
      sn: i + 1,
      name: s.fullName || '',
      marks: (record.marks && record.marks[s.rosterId]) || {},
    })),
    subjects,
  )
  return { header: header(record, register), subjects, pupils }
}
