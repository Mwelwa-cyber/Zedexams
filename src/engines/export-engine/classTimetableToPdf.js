/**
 * Class timetable → PDF (A4 landscape).
 *
 * Renders from the SAME shared grid model as the on-screen preview
 * (src/utils/timetableGridModel.js) so the download always matches what the
 * teacher sees: both layouts, merged double periods, school-activity
 * styling, full time values and every teaching day — nothing clipped.
 *
 * Two templates (src/utils/timetablePrintTemplates.js), and the difference
 * is not decoration:
 *   government  the Ministry format a head of school signs — days down the
 *               left, no colour anywhere (schools print monochrome and
 *               photocopy the master), the official title, BREAK/LUNCH
 *               spelled one letter per day-row down their own column,
 *               signature lines and a clear space for the school stamp.
 *   modern      the same schedule with palette colour fills.
 *
 * Anti-clipping measures: `table-layout: fixed` with explicit column
 * widths that always sum inside the printable width, wrapped subject names
 * (never nowrap in data cells), and a font size stepped down as the column
 * count grows. Falls back to the browser print dialog if client-side
 * rendering fails.
 */
import { downloadHtmlAsPdf } from '../../utils/htmlToPdf.js'
import { injectHtmlWatermark, WATERMARK_TEXT } from '../../utils/exportWatermark.js'
import {
  buildTimetableGridModel,
  cellState,
  subjectTintMap,
  dayRowForSlot,
  resolveDayCell,
  cellTextFor,
} from '../../utils/timetableGridModel.js'
import {
  resolvePrintSettings,
  verticalBandLetters,
  officialTimetableTitle,
  MINISTRY_HEADER_TEXT,
} from '../../utils/timetablePrintTemplates.js'
import { buildAbbreviationLegend, legendLine } from '../../utils/subjectAbbreviations.js'

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
  { attribution = false, filename = 'class-timetable.pdf', paper = 'A4', template } = {},
) {
  if (!timetable) throw new Error('No timetable to export.')
  const html = withWatermark(buildPrintableHtml(timetable, attribution, paper, { template }), attribution)
  return downloadHtmlAsPdf(html, filename, {
    onFallback: () => printClassTimetableAsPdf(timetable, { attribution, paper, template }),
  })
}

export function printClassTimetableAsPdf(timetable, { attribution = false, paper = 'A4', template } = {}) {
  if (!timetable) throw new Error('No timetable to export.')
  // Must NOT pass `noopener`/`noreferrer` here — either one makes window.open
  // return `null` (blank white page bug). We need the handle to write the doc.
  const win = window.open('', '_blank', 'width=1100,height=850')
  if (!win) {
    throw new Error('Your browser blocked the print window. Please allow pop-ups and try again.')
  }
  const html = withWatermark(buildPrintableHtml(timetable, attribution, paper, { template }), attribution)
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

/** A cell's own-day time caption — only rendered when a day-specific school
 * structure (e.g. a half-day Friday) gives this cell's slot a different
 * clock time than the shared reference row shown in the header/gutter. */
function dayTimeCaptionHtml(model, day, slot) {
  const dayRow = dayRowForSlot(model, day, slot)
  const refRow = model.rows.find((r) => r.kind === 'lesson' && r.slot === slot)
  if (!dayRow || !refRow || (dayRow.start === refRow.start && dayRow.end === refRow.end)) return ''
  return `<div class="daytime">${escapeHtml(dayRow.start)}&ndash;${escapeHtml(dayRow.end)}</div>`
}

function lessonCellHtml(model, day, slot, cell, tints, layout, settings) {
  const block = cell.block
  const caption = dayTimeCaptionHtml(model, day, slot)
  if (!block) return `<td class="empty">&mdash;${caption}</td>`
  const span = block.length > 1
    ? (layout === 'days-as-columns' ? ` rowspan="${block.length}"` : ` colspan="${block.length}"`)
    : ''
  const label = escapeHtml(cellTextFor(model, block.label, settings.cellText))
  if (block.type === 'school-activity') {
    return `<td class="act"${span}>${label}${caption}</td>`
  }
  const dbl = block.length > 1 ? '<div class="dbl">Double period</div>' : ''
  const fill = settings.colour ? ` style="background:${tints[block.label] || '#fff'}"` : ''
  return `<td${fill}${span}>${label}${dbl}${caption}</td>`
}

const OFF_CELL = '<td class="off">&mdash;</td>'

/** A band cell for a day that has a non-teaching row where other days have
 * a lesson — the assembly occupying Period 1 on Monday only. */
const dayBandCell = (label) => `<td class="dayband">${escapeHtml(label)}</td>`

function daysAsColumnsTable(model, tints, settings) {
  const headCells = model.days.map((d) => `<th>${escapeHtml(d.toUpperCase())}</th>`).join('')
  const bodyRows = model.rows.map((p) => {
    if (p.kind === 'break') {
      return `<tr><td class="time">${escapeHtml(p.start)}&ndash;${escapeHtml(p.end)}</td>` +
        `<td class="brk" colspan="${model.days.length || 1}">${escapeHtml(p.label)}</td></tr>`
    }
    const cells = model.days.map((d) => {
      const cell = resolveDayCell(model, d, p)
      if (cell.state === 'covered') return ''
      if (cell.state === 'off') return OFF_CELL
      if (cell.state === 'band') return dayBandCell(cell.bandLabel)
      return lessonCellHtml(model, d, cell.row?.slot ?? p.slot, cell, tints, 'days-as-columns', settings)
    }).join('')
    return `<tr><td class="time">${timeCellLabel(model, p)}</td>${cells}</tr>`
  }).join('')
  const timeColPct = 13
  const dayPct = model.days.length ? (100 - timeColPct) / model.days.length : 87
  const cols = `<col style="width:${timeColPct}%">` +
    model.days.map(() => `<col style="width:${dayPct.toFixed(2)}%">`).join('')
  return `<table><colgroup>${cols}</colgroup><thead><tr><th>TIME</th>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`
}

function daysAsRowsTable(model, tints, settings) {
  const headCells = model.rows.map((p) =>
    `<th${p.kind === 'break' ? ' class="brkh"' : ''}>${headCellLabel(model, p)}</th>`).join('')
  // BREAK spelled one letter per day-row down its own column — the
  // convention both reference schools use. Precomputed per band column so
  // every day row draws the letter that belongs to it.
  const bandLetters = new Map()
  if (settings.spellBands) {
    for (const p of model.rows) {
      if (p.kind !== 'break') continue
      bandLetters.set(p.id, verticalBandLetters(p.label, model.days.length))
    }
  }
  const bodyRows = model.days.map((day, dayIndex) => {
    const cells = model.rows.map((p) => {
      if (p.kind === 'break') {
        const letters = bandLetters.get(p.id)
        if (letters) return `<td class="brkv spell">${escapeHtml(letters[dayIndex] || '')}</td>`
        return `<td class="brkv">${escapeHtml(p.label)}</td>`
      }
      const cell = resolveDayCell(model, day, p)
      if (cell.state === 'covered') return ''
      if (cell.state === 'off') return OFF_CELL
      if (cell.state === 'band') return dayBandCell(cell.bandLabel)
      return lessonCellHtml(model, day, cell.row?.slot ?? p.slot, cell, tints, 'days-as-rows', settings)
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

/** The abbreviation key printed under an abbreviated grid. */
function legendHtml(model) {
  const used = new Set(model.subjects)
  const entries = buildAbbreviationLegend(
    model.subjectAllocations?.length
      ? model.subjectAllocations
      : model.subjects.map((label) => ({ label })),
    used,
  )
  if (!entries.length) return ''
  return `<div class="legend"><b>KEY:</b> ${escapeHtml(legendLine(entries))}</div>`
}

/** Signature lines + a clear space for the school stamp — what makes the
 * government print an official document rather than a printout. */
function officialFooterHtml(h) {
  return `<div class="offsig">
    <div class="sigcol"><div class="sigline"></div><div class="siglabel">Class teacher${h.teacherName ? `: ${escapeHtml(h.teacherName)}` : ''}</div></div>
    <div class="sigcol"><div class="sigline"></div><div class="siglabel">Senior teacher / Head</div></div>
    <div class="stampbox">School stamp</div>
  </div>`
}

export function buildPrintableHtml(timetable, attribution, paper = 'A4', opts = {}) {
  const model = buildTimetableGridModel(timetable)
  if (!model) throw new Error('No timetable to export.')
  const settings = resolvePrintSettings(model, opts)
  const h = model.header || {}
  const tints = settings.colour ? subjectTintMap(model) : {}
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  const government = settings.template.id === 'government'

  const meta = [
    h.className && escapeHtml(h.className),
    gradeLabel && `Grade ${escapeHtml(gradeLabel)}`,
    h.term && `Term ${escapeHtml(h.term)}`,
    h.year && escapeHtml(h.year),
  ].filter(Boolean).join(' &middot; ')

  // Step the font down as the column count grows so wide grids still fit
  // the printable width instead of clipping the last day/period.
  const colCount = settings.columnCount
  const fontPx = colCount <= 7 ? 12 : colCount <= 10 ? 10.5 : colCount <= 13 ? 9.5 : 8.5
  const pad = colCount <= 10 ? '6px 5px' : '4px 3px'

  const table = settings.layout === 'days-as-rows'
    ? daysAsRowsTable(model, tints, settings)
    : daysAsColumnsTable(model, tints, settings)

  const signatures = [
    h.preparedBy && `Prepared by: ${escapeHtml(h.preparedBy)}`,
    h.approvedBy && `Approved by: ${escapeHtml(h.approvedBy)}`,
  ].filter(Boolean).join(' &nbsp;&middot;&nbsp; ')

  const pageSize = paper === 'A3' ? 'A3 landscape' : 'A4 landscape'

  const headHtml = government
    ? `<div class="head gov">
        ${settings.ministryHeader ? `<div class="ministry">${MINISTRY_HEADER_TEXT}</div>` : ''}
        ${h.school ? `<div class="school">${escapeHtml(h.school)}</div>` : ''}
        <div class="title">${escapeHtml(officialTimetableTitle({ grade: h.grade, className: h.className }))}</div>
        ${h.term || h.year ? `<div class="meta">${[h.term && `TERM ${escapeHtml(h.term)}`, h.year && escapeHtml(h.year)].filter(Boolean).join(' &middot; ')}</div>` : ''}
      </div>`
    : `<div class="head">
        ${h.school ? `<div class="school">${escapeHtml(h.school)}</div>` : ''}
        <div class="title">Class Timetable</div>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
        ${h.teacherName ? `<div class="teacher">Class teacher: ${escapeHtml(h.teacherName)}</div>` : ''}
      </div>`

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
  .head.gov .ministry, .head.gov .school, .head.gov .title {
    text-decoration: underline; text-underline-offset: 3px; }
  .ministry { font-size: 15px; font-weight: bold; text-transform: uppercase; letter-spacing: .1em; }
  .school { font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: .06em; margin-top: 3px; }
  .title { font-size: 20px; font-weight: bold; text-transform: uppercase; letter-spacing: .08em; margin-top: 4px; }
  .meta { font-size: 13px; font-weight: bold; margin-top: 4px; }
  .teacher { font-size: 12px; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #000; padding: ${pad}; text-align: center; font-size: ${fontPx}px;
           vertical-align: middle; overflow-wrap: break-word; word-wrap: break-word; }
  th { background: ${government ? '#fff' : '#e2e8f0'}; text-transform: uppercase; }
  td.time { font-weight: bold; }
  td.time .plabel { font-size: ${Math.max(7, fontPx - 3)}px; font-weight: normal; opacity: .7; }
  td.day { font-weight: bold; }
  .ptime, .bktime { font-size: ${Math.max(7, fontPx - 3)}px; font-weight: normal; opacity: .75; }
  .bklbl { font-size: ${Math.max(7, fontPx - 2)}px; letter-spacing: .06em; }
  td.brk { font-weight: bold; text-transform: uppercase; letter-spacing: .15em;
           background: ${government ? '#fff' : '#f1ece0'}; }
  th.brkh, td.brkv { background: ${government ? '#fff' : '#f1ece0'}; font-weight: bold; text-transform: uppercase;
                     font-size: ${Math.max(7, fontPx - 2)}px; letter-spacing: .04em; }
  td.brkv.spell { font-size: ${fontPx + 2}px; letter-spacing: 0; }
  td.dayband { font-weight: bold; text-transform: uppercase; letter-spacing: .08em;
               background: ${government ? '#fff' : '#f1ece0'}; font-size: ${Math.max(7, fontPx - 1)}px; }
  td.act { background: ${government ? '#fff' : '#f6f3ea'}; font-style: italic; color: ${government ? '#000' : '#5a523e'}; }
  td.off { background: ${government ? '#fff' : '#efece3'}; color: #888888; }
  td.empty { color: #888888; }
  .dbl { font-size: ${Math.max(6, fontPx - 4)}px; font-weight: bold; text-transform: uppercase;
         letter-spacing: .08em; opacity: .55; }
  .daytime { font-size: ${Math.max(6, fontPx - 4)}px; font-weight: normal; opacity: .6; }
  .legend { margin-top: 8px; font-size: 10px; line-height: 1.5; }
  .sig { margin-top: 14px; text-align: center; font-size: 11px; }
  .offsig { margin-top: 22px; display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
  .sigcol { flex: 1 1 0; }
  .sigline { border-bottom: 1px solid #000; height: 26px; }
  .siglabel { font-size: 11px; margin-top: 3px; }
  .stampbox { flex: 0 0 34%; border: 1px dashed #888888; height: 62px; font-size: 10px;
              color: #666; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 4px; }
  .foot { margin-top: 12px; text-align: center; font-size: 10px; color: #888; }
</style>
</head>
<body>
  ${headHtml}
  ${table}
  ${settings.showLegend ? legendHtml(model) : ''}
  ${settings.signatures ? officialFooterHtml(h) : (signatures ? `<div class="sig">${signatures}</div>` : '')}
  ${attribution ? `<div class="foot">${ATTRIBUTION_TEXT}</div>` : ''}
</body>
</html>`
}

export { cellState }
