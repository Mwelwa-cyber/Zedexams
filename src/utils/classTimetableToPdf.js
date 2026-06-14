/**
 * Print a class timetable as a PDF using the browser's native print dialog.
 *
 * Same approach as src/utils/lessonPlanToPdf.js — no jsPDF/html2canvas in
 * the bundle. We open a popup, write print-friendly landscape HTML, and
 * call window.print(); the user picks "Save as PDF". Must be invoked
 * directly from a click handler so the popup isn't blocked.
 */

const ATTRIBUTION_TEXT =
  'Made with ZedExams — free CBC teacher tools at zedexams.com/teachers'

const escapeHtml = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const SUBJECT_TINTS = [
  '#fbe7c8', '#dfeadd', '#e3dcf5', '#dbe7f4', '#fde2c4',
  '#e1e8ee', '#f4d6e2', '#f9d8c8', '#d8ecd0', '#fde9b8',
]

function buildTints(timetable) {
  const { slots = {}, periods = [], days = [] } = timetable
  const map = {}
  let i = 0
  for (const p of periods) {
    if (p.kind !== 'lesson') continue
    for (const day of days) {
      const subj = slots?.[p.id]?.[day]
      if (subj && !(subj in map)) { map[subj] = SUBJECT_TINTS[i % SUBJECT_TINTS.length]; i += 1 }
    }
  }
  return map
}

export function printClassTimetableAsPdf(timetable, { attribution = false } = {}) {
  if (!timetable) throw new Error('No timetable to export.')
  const win = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=850')
  if (!win) {
    throw new Error('Your browser blocked the print window. Please allow pop-ups and try again.')
  }
  const html = buildPrintableHtml(timetable, attribution)
  win.document.open()
  win.document.write(html)
  win.document.close()
  const ready = () => {
    try { win.focus(); win.print() } catch { /* user can Ctrl+P manually */ }
  }
  if (win.document.readyState === 'complete') setTimeout(ready, 120)
  else win.addEventListener('load', () => setTimeout(ready, 120))
}

function buildPrintableHtml(timetable, attribution) {
  const h = timetable.header || {}
  const days = Array.isArray(timetable.days) ? timetable.days : []
  const periods = Array.isArray(timetable.periods) ? timetable.periods : []
  const slots = timetable.slots || {}
  const tints = buildTints(timetable)
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')

  const meta = [
    h.className && escapeHtml(h.className),
    gradeLabel && `Grade ${escapeHtml(gradeLabel)}`,
    h.term && `Term ${escapeHtml(h.term)}`,
    h.year && escapeHtml(h.year),
  ].filter(Boolean).join(' &middot; ')

  const headCells = days.map((d) => `<th>${escapeHtml(d.toUpperCase())}</th>`).join('')

  const bodyRows = periods.map((p) => {
    if (p.kind === 'break') {
      return `<tr><td class="time">${escapeHtml(p.start)}&ndash;${escapeHtml(p.end)}</td>` +
        `<td class="brk" colspan="${days.length || 1}">${escapeHtml(p.label)}</td></tr>`
    }
    const cells = days.map((d) => {
      const subj = slots?.[p.id]?.[d] || ''
      const bg = subj ? ` style="background:${tints[subj]}"` : ''
      return `<td${bg}>${subj ? escapeHtml(subj) : '&mdash;'}</td>`
    }).join('')
    return `<tr><td class="time"><b>${escapeHtml(p.start)}&ndash;${escapeHtml(p.end)}</b>` +
      `<div class="plabel">${escapeHtml(p.label)}</div></td>${cells}</tr>`
  }).join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Class Timetable${h.className ? ` — ${escapeHtml(h.className)}` : ''}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #000; margin: 0; }
  .head { text-align: center; margin-bottom: 14px; }
  .school { font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: .06em; }
  .title { font-size: 20px; font-weight: bold; text-transform: uppercase; letter-spacing: .08em; margin-top: 4px; }
  .meta { font-size: 13px; font-weight: bold; margin-top: 4px; }
  .teacher { font-size: 12px; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 6px 5px; text-align: center; font-size: 12px; vertical-align: middle; }
  th { background: #e2e8f0; text-transform: uppercase; }
  td.time { font-weight: bold; white-space: nowrap; width: 14%; }
  td.time .plabel { font-size: 9px; font-weight: normal; opacity: .7; }
  td.brk { font-weight: bold; text-transform: uppercase; letter-spacing: .15em; background: #f1ece0; }
  .foot { margin-top: 16px; text-align: center; font-size: 10px; color: #888; }
</style>
</head>
<body>
  <div class="head">
    ${h.school ? `<div class="school">${escapeHtml(h.school)}</div>` : ''}
    <div class="title">Class Timetable</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    ${h.teacherName ? `<div class="teacher">Class teacher: ${escapeHtml(h.teacherName)}</div>` : ''}
  </div>
  <table>
    <thead><tr><th style="width:14%">TIME</th>${headCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  ${attribution ? `<div class="foot">${ATTRIBUTION_TEXT}</div>` : ''}
</body>
</html>`
}
