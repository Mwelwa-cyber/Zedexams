/**
 * Shared CSV export helpers.
 *
 * Used by `features/adminLearners`' roster page and by
 * `utils/attendanceExportService.js` (the class register). Each caller
 * provides a plain array of objects with uniform keys — the keys of the first
 * row become the column headers.
 *
 * The previous list here — "AdminLearners, AdminLearnerProfile, and
 * TeacherLibrary" — was wrong on two of three: neither the learner profile nor
 * the teacher library imports this. Corrected during the `adminLearners`
 * migration, because a stale consumer list is exactly what a decision about
 * whether a module travels gets made on, and this one nearly sent it into a
 * feature the register still needs to reach.
 */

import { saveBlob } from './saveBlob.js'

export function toCSV(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = (v) => {
    const s = String(v ?? '')
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n')
}

export function downloadCSV(filename, rows) {
  const csv = toCSV(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  // saveBlob keeps `filename` on Android, where a bare blob-URL download saves
  // the file under the blob's random UUID instead.
  return saveBlob(blob, filename)
}
