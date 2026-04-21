/**
 * Shared CSV export helpers.
 *
 * Used by AdminLearners, AdminLearnerProfile, and TeacherLibrary. Each caller
 * provides a plain array of objects with uniform keys — the keys of the first
 * row become the column headers.
 */

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
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
