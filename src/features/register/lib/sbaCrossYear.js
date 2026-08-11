/**
 * src/utils/sbaCrossYear.js
 *
 * Cross-year SBA matching for the Final SBA (/30) record. Within ONE teacher's
 * own registers, find each learner's Grade 5 / 6 / 7 SBA mark out of 10 for a
 * subject and line them up, so the teacher doesn't re-enter prior-grade marks.
 *
 * Matching is by linked account first (snapshot.linkedUid), then by normalised
 * full name (rosterNameKey) — the same learner taught across years usually keeps
 * the same name and, if they have a ZedExams account, the same uid. Owner-scoped
 * (only the calling teacher's own registers), so no Firestore rules change.
 *
 * The pure core (buildCrossYearIndex + matchLearnerMarks) is node-testable; the
 * async gatherer wires in the Firestore reads.
 */

import { computeRecordRows, maxTotalOf } from '../../../utils/classRecordMath.js'
import { convertSbaMark } from '../../../config/sba.js'
import { rosterNameKey } from '../../../utils/rosterImport.js'

const GRADE_COL = { 5: 'g5', 6: 'g6', 7: 'g7' }

function matchKeys({ linkedUid, fullName }) {
  const keys = []
  if (linkedUid) keys.push(`uid:${linkedUid}`)
  const nk = rosterNameKey(fullName)
  if (nk) keys.push(`name:${nk}`)
  return keys
}

/**
 * Build an index of the best /10 mark per grade per learner-key for one subject.
 * `registers` = [{ grade, sbaRecords: [record…] }] (each record is a year-long
 * 'sba' record with columns/rosterSnapshot/marks). Returns { 5|6|7: Map(key→/10) }.
 */
export function buildCrossYearIndex(registers, subject) {
  const index = { 5: new Map(), 6: new Map(), 7: new Map() }
  for (const reg of registers || []) {
    const grade = Number(reg.grade)
    if (!index[grade]) continue
    for (const rec of reg.sbaRecords || []) {
      if (rec.type !== 'sba') continue
      if (subject && rec.subject !== subject) continue
      const max = maxTotalOf(rec.columns || [])
      const rows = computeRecordRows({ snapshot: rec.rosterSnapshot || [], columns: rec.columns || [], marks: rec.marks || {} })
      const rowById = new Map(rows.map((r) => [r.rosterId, r]))
      for (const snap of rec.rosterSnapshot || []) {
        const row = rowById.get(snap.rosterId)
        if (!row) continue
        const ten = convertSbaMark(row.total, max).rounded
        for (const k of matchKeys(snap)) {
          const prev = index[grade].get(k)
          if (prev == null || ten > prev) index[grade].set(k, ten) // keep the best
        }
      }
    }
  }
  return index
}

/**
 * For each current roster entry, look up its g5/g6/g7 /10 from the index.
 * Returns { [rosterEntryId]: { g5?, g6?, g7? } } — only learners with at least
 * one match are included.
 */
export function matchLearnerMarks(index, rosterEntries) {
  const out = {}
  for (const e of rosterEntries || []) {
    const keys = matchKeys({ linkedUid: e.linkedUid, fullName: e.fullName })
    const marks = {}
    for (const grade of [5, 6, 7]) {
      for (const k of keys) {
        const v = index[grade]?.get(k)
        if (v != null) { marks[GRADE_COL[grade]] = v; break }
      }
    }
    if (Object.keys(marks).length) out[e.id] = marks
  }
  return out
}

/**
 * Async: gather the cross-year G5/G6/G7 marks for the given active roster
 * entries and subject, across all of the teacher's registers. Returns marks
 * keyed by roster entry id, ready to seed a Final SBA record.
 *
 * `deps` ({ listTeacherRegisters, listRecords }) is required: the browser
 * caller (SbaTab) passes the real Firestore services, the node test passes
 * fakes. Injecting them keeps this module import-free of Firestore — it has
 * to load under plain `node` for scripts/test-sba-cross-year.mjs — without
 * the old dynamic-import fallback, which Rollup warned about (the services
 * are statically imported across the register tab, so a lazy import() here
 * could never split them into another chunk anyway).
 */
export async function gatherCrossYearSbaMarks(teacherUid, subject, rosterEntries, deps) {
  const { listTeacherRegisters, listRecords } = deps
  const registers = await listTeacherRegisters(teacherUid, { status: null, limit: 200 })
  const withRecords = []
  for (const reg of registers) {
    if (![5, 6, 7].includes(Number(reg.grade))) continue
    const sbaRecords = await listRecords(reg.id, { type: 'sba' })
    withRecords.push({ grade: reg.grade, sbaRecords })
  }
  const index = buildCrossYearIndex(withRecords, subject)
  return matchLearnerMarks(index, rosterEntries)
}
