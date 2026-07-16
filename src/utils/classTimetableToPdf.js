/**
 * Class timetable → PDF (A4 landscape).
 *
 * Renders from the SAME shared grid model as the on-screen preview
 * (src/utils/timetableGridModel.js) so the download always matches what the
 * teacher sees: both layouts, merged double periods, school-activity
 * styling, full time values and every teaching day — nothing clipped.
 *
 * Anti-clipping measures: `table-layout: fixed` with explicit column
 * widths that always sum inside the printable width, wrapped subject names
 * (never nowrap in data cells), and a font size stepped down as the column
 * count grows. Falls back to the browser print dialog if client-side
 * rendering fails.
 */
import { downloadHtmlAsPdf } from './htmlToPdf.js'
import { injectHtmlWatermark, WATERMARK_TEXT } from './exportWatermark.js'
import {
  buildTimetableGridModel,
  cellState,
  subjectTintMap,
} from './timetableGridModel.js'

const ATTRIBUTION_TEXT =
  'Made with ZedExams — free CBC teacher tools at zedexams.com/teachers'

// Free-plan exports get the diagonal ZedExams watermark; paid/admin stay clean.
const withWatermark = (html, attribution) =>
  attribution ? injectHtmlWatermark(html, WATERMARK_TEXT) : html

const escapeHtml = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/**
 * Download the class timetable as a real .pdf file. Falls back to the browser
 * print dialog if client-side rendering fails.
 */
export async function downloadClassTimetablePdf(
  timetable,
  { attribution = false, filename = 'class-timetable.pdf', paper = 'A4' } = {},
) {
  if (!timetable) throw new Error('No timetable to export.')
  const html = withWatermark(buildPrintableHtml(timetable, attribution, paper), attribution)
  return downloadHtmlAsPdf(html, filename, {
    onFallback: () => printClassTimetableAsPdf(timetable, { attribution, paper }),
  })
}

export function printClassTimetableAsPdf(timetable, { attribution = false, paper = 'A4' } = {}) {
  if (!timetable) throw new Error('No timetable to export.')
  // Must NOT pass `noopener`/`noreferrer` here — either one makes window.open
  // return `null` (blank white page bug). We need the handle to write the doc.
  const win = window.open('', '_blank', 'width=1100,height=850')
  if (!win) {
    throw new Error('Your browser blocked the print window. Please allow pop-ups and try again.')
  }
  const html = withWatermark(buildPrintableHtml(timetable, attribution, paper), attribution)
  win.document.open()
  win.document.write(html)
  win.document.close()
  const ready = () => {
    try { win.focus(); win.print() } catch { /* user can Ctrl+P manually */ }
  }
  if (win.document.readyState === 'complete') setTimeout(ready, 120)
  else win.addEventListener('load', () => setTimeout(ready, 120))
}

function headCellLabel(model, p) {
  if (p.kind === 'break') {
    return `<div class="bklbl">${escapeHtml(p.label)}</div><div class="bktime">${escapeHtml(p.start)}&ndash;${escapeHtml(p.end)}</div>`
  }
  const bits = []
  if (model.labelMode !== 'time') bits.push(`<div>P${p.slot}</div>`)
  if (model.labelMode !== 'period') bits.push(`<div class="ptime">${escapeHtml(p.start)}&ndash;${escapeHtml(p.end)}</div>`)
  return bits.join('')
}

function timeCellLabel(model, p) {
  const bits = []
  if (model.labelMode !== 'period') bits.push(`<b>${escapeHtml(p.start)}&ndash;${escapeHtml(p.end)}</b>`)
  if (model.labelMode !== 'time') bits.push(`<div class="plabel">Period ${p.slot}</div>`)
  return bits.join('')
}

function lessonCellHtml(cell, tints, layout) {
  const block = cell.block
  if (!block) return '<td class="empty">&mdash;</td>'
  const span = block.length > 1
    ? (layout === 'days-as-columns' ? ` rowspan="${block.length}"` : ` colspan="${block.length}"`)
    : ''
  if (block.type === 'school-activity') {
    return `<td class="act"${span}>${escapeHtml(block.label)}</td>`
  }
  const dbl = block.length > 1 ? '<div class="dbl">Double period</div>' : ''
  return `<td style="background:${tints[block.label] || '#fff'}"${span}>${escapeHtml(block.label)}${dbl}</td>`
}

const OFF_CELL = '<td class="off">&mdash;</td>'

function daysAsColumnsTable(model, tints) {
  const headCells = model.days.map((d) => `<th>${escapeHtml(d.toUpperCase())}</th>`).join('')
  const bodyRows = model.rows.map((p) => {
    if (p.kind === 'break') {
      return `<tr><td class="time">${escapeHtml(p.start)}&ndash;${escapeHtml(p.end)}</td>` +
        `<td class="brk" colspan="${model.days.length || 1}">${escapeHtml(p.label)}</td></tr>`
    }
    const cells = model.days.map((d) => {
      const cell = cellState(model, d, p.slot)
      if (cell.state === 'covered') return ''
      if (cell.state === 'off') return OFF_CELL
      return lessonCellHtml(cell, tints, 'days-as-columns')
    }).join('')
    return `<tr><td class="time">${timeCellLabel(model, p)}</td>${cells}</tr>`
  }).join('')
  const timeColPct = 13
  const dayPct = model.days.length ? (100 - timeColPct) / model.days.length : 87
  const cols = `<col style="width:${timeColPct}%">` +
    model.days.map(() => `<col style="width:${dayPct.toFixed(2)}%">`).join('')
  return `<table><colgroup>${cols}</colgroup><thead><tr><th>TIME</th>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`
}

function daysAsRowsTable(model, tints) {
  const headCells = model.rows.map((p) =>
    `<th${p.kind === 'break' ? ' class="brkh"' : ''}>${headCellLabel(model, p)}</th>`).join('')
  const bodyRows = model.days.map((day) => {
    const cells = model.rows.map((p) => {
      if (p.kind === 'break') return `<td class="brkv">${escapeHtml(p.label)}</td>`
      const cell = cellState(model, day, p.slot)
      if (cell.state === 'covered') return ''
      if (cell.state === 'off') return OFF_CELL
      return lessonCellHtml(cell, tints, 'days-as-rows')
    }).join('')
    return `<tr><td class="day">${escapeHtml(day.toUpperCase())}</td>${cells}</tr>`
  }).join('')
  const dayColPct = 9
  const n = model.rows.length || 1
  const colPct = (100 - dayColPct) / n
  const cols = `<col style="width:${dayColPct}%">` +
    model.rows.map(() => `<col style="width:${colPct.toFixed(2)}%">`).join('')
  return `<table><colgroup>${cols}</colgroup><thead><tr><th>DAY</th>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`
}

export function buildPrintableHtml(timetable, attribution, paper = 'A4') {
  const model = buildTimetableGridModel(timetable)
  if (!model) throw new Error('No timetable to export.')
  const h = model.header || {}
  const tints = subjectTintMap(model)
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')

  const meta = [
    h.className && escapeHtml(h.className),
    gradeLabel && `Grade ${escapeHtml(gradeLabel)}`,
    h.term && `Term ${escapeHtml(h.term)}`,
    h.year && escapeHtml(h.year),
  ].filter(Boolean).join(' &middot; ')

  // Step the font down as the column count grows so wide grids still fit
  // the printable width instead of clipping the last day/period.
  const colCount = model.layout === 'days-as-rows' ? model.rows.length + 1 : model.days.length + 1
  const fontPx = colCount <= 7 ? 12 : colCount <= 10 ? 10.5 : colCount <= 13 ? 9.5 : 8.5
  const pad = colCount <= 10 ? '6px 5px' : '4px 3px'

  const table = model.layout === 'days-as-rows'
    ? daysAsRowsTable(model, tints)
    : daysAsColumnsTable(model, tints)

  const signatures = [
    h.preparedBy && `Prepared by: ${escapeHtml(h.preparedBy)}`,
    h.approvedBy && `Approved by: ${escapeHtml(h.approvedBy)}`,
  ].filter(Boolean).join(' &nbsp;&middot;&nbsp; ')

  const pageSize = paper === 'A3' ? 'A3 landscape' : 'A4 landscape'

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Class Timetable${h.className ? ` — ${escapeHtml(h.className)}` : ''}</title>
<style>
  @page { size: ${pageSize}; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #000; margin: 0; }
  .head { text-align: center; margin-bottom: 12px; }
  .school { font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: .06em; }
  .title { font-size: 20px; font-weight: bold; text-transform: uppercase; letter-spacing: .08em; margin-top: 4px; }
  .meta { font-size: 13px; font-weight: bold; margin-top: 4px; }
  .teacher { font-size: 12px; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #000; padding: ${pad}; text-align: center; font-size: ${fontPx}px;
           vertical-align: middle; overflow-wrap: break-word; word-wrap: break-word; }
  th { background: #e2e8f0; text-transform: uppercase; }
  td.time { font-weight: bold; }
  td.time .plabel { font-size: ${Math.max(7, fontPx - 3)}px; font-weight: normal; opacity: .7; }
  td.day { font-weight: bold; }
  .ptime, .bktime { font-size: ${Math.max(7, fontPx - 3)}px; font-weight: normal; opacity: .75; }
  .bklbl { font-size: ${Math.max(7, fontPx - 2)}px; letter-spacing: .06em; }
  td.brk { font-weight: bold; text-transform: uppercase; letter-spacing: .15em; background: #f1ece0; }
  th.brkh, td.brkv { background: #f1ece0; font-weight: bold; text-transform: uppercase;
                     font-size: ${Math.max(7, fontPx - 2)}px; letter-spacing: .04em; }
  td.act { background: #f6f3ea; font-style: italic; color: #5a523e; }
  td.off { background: #efece3; color: #a89e86; }
  td.empty { color: #999; }
  .dbl { font-size: ${Math.max(6, fontPx - 4)}px; font-weight: bold; text-transform: uppercase;
         letter-spacing: .08em; opacity: .55; }
  .sig { margin-top: 14px; text-align: center; font-size: 11px; }
  .foot { margin-top: 12px; text-align: center; font-size: 10px; color: #888; }
</style>
</head>
<body>
  <div class="head">
    ${h.school ? `<div class="school">${escapeHtml(h.school)}</div>` : ''}
    <div class="title">Class Timetable</div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    ${h.teacherName ? `<div class="teacher">Class teacher: ${escapeHtml(h.teacherName)}</div>` : ''}
  </div>
  ${table}
  ${signatures ? `<div class="sig">${signatures}</div>` : ''}
  ${attribution ? `<div class="foot">${ATTRIBUTION_TEXT}</div>` : ''}
</body>
</html>`
}
