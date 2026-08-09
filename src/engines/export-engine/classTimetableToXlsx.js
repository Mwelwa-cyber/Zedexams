/**
 * Export a class timetable as a real Excel (.xlsx) workbook. Renders from
 * the SAME shared grid model as the preview + other exporters
 * (timetableGridModel.js): both layouts, double periods merged (vertically
 * in "Days across the top", horizontally in "Days down the left"), the
 * header row + first column frozen, a printable landscape page setup, and
 * a second "Details" worksheet carrying the curriculum, official vs actual
 * allocations, the optional-subject selection and validation results.
 *
 * Hand-built OOXML zipped with jszip (already in the tree via `docx`), so
 * this adds no bundle weight. Times are written as inline text so Excel
 * can't corrupt them into date serials.
 *
 * buildClassTimetableWorkbookFiles() is pure and DOM-free so plain node can
 * unit-test the XML (see scripts/test-class-timetable.mjs).
 */

import { saveBlob } from '../../utils/saveBlob.js'
import {
  buildTimetableGridModel,
  dayRowForSlot,
  resolveDayCell,
  cellTextFor,
  displayLabelFor,
} from '../../utils/timetableGridModel.js'
import { resolvePrintSettings } from '../../utils/timetablePrintTemplates.js'
import { buildAbbreviationLegend } from '../../utils/subjectAbbreviations.js'

const XML_HEAD ='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const escText = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 0-based column index → Excel letters (0→A, 25→Z, 26→AA). */
export function colLetter(i) {
  let n = Math.floor(i)
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

const strCell = (ref, v, s) =>
  `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escText(v)}</t></is></c>`

/* Style indices (cellXfs order in stylesXml below). */
const S = {
  DEFAULT: 0,
  TITLE: 1,   // bold 14, centered
  META: 2,    // centered
  HEAD: 3,    // bold, grey fill, border, centered, wrapped
  CELL: 4,    // border, centered, wrapped
  TIME: 5,    // border, bold, centered
  BREAK: 6,   // border, bold, centered, light fill
  ACT: 7,     // border, italic, centered, cream fill (school activity)
  OFF: 8,     // border, centered, muted fill (day ends earlier)
  LEFT: 9,    // plain left-aligned (details sheet)
  LEFTB: 10,  // bold left-aligned (details sheet)
}

function stylesXml() {
  return XML_HEAD +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="5">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
      '<font><i/><sz val="11"/><color rgb="FF5A523E"/><name val="Calibri"/></font>' +
      '<font><sz val="11"/><color rgb="FFA89E86"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="6">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF1ECE0"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF6F3EA"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEFECE3"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border>' +
        '<left style="thin"><color rgb="FF000000"/></left>' +
        '<right style="thin"><color rgb="FF000000"/></right>' +
        '<top style="thin"><color rgb="FF000000"/></top>' +
        '<bottom style="thin"><color rgb="FF000000"/></bottom>' +
        '<diagonal/>' +
      '</border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="11">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
}

function sheetXml({ cols, rows, merges, freeze }) {
  const colsXml = cols.length
    ? '<cols>' + cols.map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>'
    : ''
  // Freeze the header rows AND the first column so scrolling keeps context.
  const view = freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${freeze.x}" ySplit="${freeze.y}" topLeftCell="${colLetter(freeze.x)}${freeze.y + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  const data = '<sheetData>' + rows.map(({ r, cells }) =>
    `<row r="${r}">${cells.join('')}</row>`).join('') + '</sheetData>'
  const mergesXml = merges.length
    ? `<mergeCells count="${merges.length}">` + merges.map((m) => `<mergeCell ref="${m}"/>`).join('') + '</mergeCells>'
    : ''
  // Printable landscape setup, fit to one page wide.
  const print = '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>'
  const fit = '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
  return XML_HEAD +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    fit + view + colsXml + data + mergesXml + print +
    '</worksheet>'
}

function blockStyle(block) {
  return block.type === 'school-activity' ? S.ACT : S.CELL
}

function timeLabel(model, p) {
  const time = `${p.start}–${p.end}`
  if (model.labelMode === 'time') return time
  if (model.labelMode === 'period') return `Period ${p.slot}`
  return `${time}\nPeriod ${p.slot}`
}

/** A cell's own-day time suffix — only non-empty when a day-specific school
 * structure (e.g. a half-day Friday) gives this cell's slot a different
 * clock time than the shared reference row shown in the header. */
function dayTimeSuffix(model, day, slot) {
  const dayRow = dayRowForSlot(model, day, slot)
  const refRow = model.rows.find((r) => r.kind === 'lesson' && r.slot === slot)
  if (!dayRow || !refRow || (dayRow.start === refRow.start && dayRow.end === refRow.end)) return ''
  return `\n${dayRow.start}–${dayRow.end}`
}

/** "Days across the top": TIME rows down, day columns across, doubles merge
 * vertically across the covered rows. */
function daysAsColumnsSheet(model, metaLine, settings) {
  const days = model.days
  const ncols = 1 + days.length
  const lastCol = colLetter(ncols - 1)
  const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`]
  const rows = []

  rows.push({ r: 1, cells: [strCell('A1', 'CLASS TIMETABLE', S.TITLE)] })
  rows.push({ r: 2, cells: [strCell('A2', metaLine, S.META)] })
  rows.push({
    r: 3,
    cells: [
      strCell('A3', 'TIME', S.HEAD),
      ...days.map((d, i) => strCell(`${colLetter(i + 1)}3`, d.toUpperCase(), S.HEAD)),
    ],
  })

  // Sheet row number for each period row (period index → r).
  const rowNum = (pi) => 4 + pi

  model.rows.forEach((p, pi) => {
    const r = rowNum(pi)
    if (p.kind === 'break') {
      merges.push(`${colLetter(1)}${r}:${lastCol}${r}`)
      rows.push({
        r,
        cells: [
          strCell(`A${r}`, `${p.start}–${p.end}`, S.TIME),
          strCell(`${colLetter(1)}${r}`, p.label, S.BREAK),
        ],
      })
      return
    }
    const cells = [strCell(`A${r}`, timeLabel(model, p), S.TIME)]
    days.forEach((d, i) => {
      const ref = `${colLetter(i + 1)}${r}`
      const c = resolveDayCell(model, d, p)
      if (c.state === 'covered') { cells.push(strCell(ref, '', blockStyle(c.block))); return }
      if (c.state === 'off') { cells.push(strCell(ref, '—', S.OFF)); return }
      // This day has a band (the assembly occupying Period 1) where the
      // other days have a lesson.
      if (c.state === 'band') { cells.push(strCell(ref, c.bandLabel, S.BREAK)); return }
      if (!c.block) { cells.push(strCell(ref, '', S.CELL)); return }
      const slot = c.row?.slot ?? p.slot
      if (c.block.length > 1) {
        // The covered lesson rows are consecutive sheet rows (a double never
        // crosses a break), so a straight vertical merge is safe.
        merges.push(`${ref}:${colLetter(i + 1)}${r + c.block.length - 1}`)
      }
      cells.push(strCell(ref, `${cellTextFor(model, c.block.label, settings.cellText)}${dayTimeSuffix(model, d, slot)}`, blockStyle(c.block)))
    })
    rows.push({ r, cells })
  })

  const cols = [16, ...days.map(() => 16)]
  return sheetXml({ cols, rows, merges, freeze: { x: 1, y: 3 } })
}

/** "Days down the left": day rows down, period columns across, doubles merge
 * horizontally. */
function daysAsRowsSheet(model, metaLine, settings) {
  const ncols = 1 + model.rows.length
  const lastCol = colLetter(ncols - 1)
  const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`]
  const rows = []

  rows.push({ r: 1, cells: [strCell('A1', 'CLASS TIMETABLE', S.TITLE)] })
  rows.push({ r: 2, cells: [strCell('A2', metaLine, S.META)] })
  rows.push({
    r: 3,
    cells: [
      strCell('A3', 'DAY', S.HEAD),
      ...model.rows.map((p, i) => strCell(
        `${colLetter(i + 1)}3`,
        p.kind === 'break' ? `${p.label}\n${p.start}–${p.end}` : timeLabel(model, p),
        p.kind === 'break' ? S.BREAK : S.HEAD,
      )),
    ],
  })

  model.days.forEach((day, di) => {
    const r = 4 + di
    const cells = [strCell(`A${r}`, day.toUpperCase(), S.TIME)]
    model.rows.forEach((p, i) => {
      const ref = `${colLetter(i + 1)}${r}`
      if (p.kind === 'break') { cells.push(strCell(ref, p.label, S.BREAK)); return }
      const c = resolveDayCell(model, day, p)
      if (c.state === 'covered') { cells.push(strCell(ref, '', blockStyle(c.block))); return }
      if (c.state === 'off') { cells.push(strCell(ref, '—', S.OFF)); return }
      if (c.state === 'band') { cells.push(strCell(ref, c.bandLabel, S.BREAK)); return }
      if (!c.block) { cells.push(strCell(ref, '', S.CELL)); return }
      const slot = c.row?.slot ?? p.slot
      if (c.block.length > 1) {
        merges.push(`${ref}:${colLetter(i + c.block.length)}${r}`)
      }
      cells.push(strCell(ref, `${cellTextFor(model, c.block.label, settings.cellText)}${dayTimeSuffix(model, day, slot)}`, blockStyle(c.block)))
    })
    rows.push({ r, cells })
  })

  const cols = [12, ...model.rows.map((p) => (p.kind === 'break' ? 9 : 14))]
  return sheetXml({ cols, rows, merges, freeze: { x: 1, y: 3 } })
}

/** Second worksheet: curriculum, official vs actual allocations, options,
 * activities and validation results — the audit trail beside the grid. */
function detailsSheet(model, timetable, validation, settings = { cellText: 'full' }) {
  const rows = []
  let r = 0
  const line = (label, value, style = S.LEFT) => {
    r += 1
    rows.push({
      r,
      cells: [
        strCell(`A${r}`, label, S.LEFTB),
        strCell(`B${r}`, value == null ? '' : String(value), style),
      ],
    })
  }
  const section = (title) => {
    r += 1 // spacer
    rows.push({ r, cells: [] })
    r += 1
    rows.push({ r, cells: [strCell(`A${r}`, title, S.LEFTB)] })
  }

  const h = model.header || {}
  line('Curriculum', timetable?.curriculumName || timetable?.curriculumId || '—')
  line('Grade', h.grade || '—')
  line('Class', h.className || '—')
  line('Term / Year', [h.term && `Term ${h.term}`, h.year].filter(Boolean).join(' · ') || '—')
  const first = model.rows.find((p) => p.kind === 'lesson')
  if (first) {
    const mins = (Number(first.end.slice(0, 2)) * 60 + Number(first.end.slice(3))) -
      (Number(first.start.slice(0, 2)) * 60 + Number(first.start.slice(3)))
    line('Period duration', `${mins} minutes`)
  }
  line('Timetable layout', model.layout === 'days-as-rows' ? 'Days down the left' : 'Days across the top')

  const allocations = Array.isArray(timetable?.subjectAllocations) ? timetable.subjectAllocations : []
  if (allocations.length) {
    section('Official weekly allocations')
    for (const s of allocations.filter((x) => !x.schoolSubject)) {
      line(displayLabelFor(model, s.label), s.selected === false ? 'Not selected (option group)' : `${s.periodsPerWeek} periods/week`)
    }
    // School subjects are taught and printed, and are deliberately listed
    // apart — they are never part of the curriculum totals above.
    const schoolSubjects = allocations.filter((x) => x.schoolSubject)
    if (schoolSubjects.length) {
      section('School subjects (outside the curriculum)')
      for (const s of schoolSubjects) line(s.label, `${s.periodsPerWeek} lessons/week`)
    }
  }

  if (settings.cellText === 'abbrev') {
    const legend = buildAbbreviationLegend(allocations.length ? allocations : model.subjects.map((label) => ({ label })), new Set(model.subjects))
    if (legend.length) {
      section('Key')
      for (const e of legend) line(e.abbr, e.label)
    }
  }

  // Actual placed counts from the blocks (a double counts as 2).
  const placed = new Map()
  let activityCount = 0
  for (const b of timetable?.blocks || []) {
    if (b.type === 'school-activity') { activityCount += b.length; continue }
    placed.set(b.label, (placed.get(b.label) || 0) + b.length)
  }
  section('Actual placed periods')
  for (const [label, n] of placed) line(label, `${n} periods`)
  line('School-activity periods', String(activityCount))

  const selected = timetable?.selectedOptions
  if (selected && typeof selected === 'object' && Object.keys(selected).length) {
    section('Optional subject selection')
    for (const [group, choice] of Object.entries(selected)) line(group, choice)
  }

  if (validation) {
    section('Validation')
    line('Status', validation.status || (validation.ok ? 'passed' : 'check'))
    if (validation.customised) line('Note', 'Customised from curriculum baseline')
    for (const e of validation.errors || []) line('Error', e)
    for (const w of validation.warnings || []) line('Warning', w)
    for (const s of validation.bySubject || []) {
      line(s.label, `${s.placed} of ${s.target} periods`)
    }
  }

  return sheetXml({ cols: [34, 52], rows: rows.filter((x) => x.cells.length), merges: [], freeze: null })
}

const SHEET1 = 'Timetable'
const SHEET2 = 'Details'

/** The full workbook as { path → XML string } — pure, so node can test it. */
export function buildClassTimetableWorkbookFiles(timetable, opts = {}) {
  const model = buildTimetableGridModel(timetable)
  const settings = resolvePrintSettings(model, opts)
  // The workbook follows the same print orientation and cell text as the
  // PDF and Word downloads — one resolution, four renderers.
  model.layout = opts.layout || settings.layout
  const h = model.header || {}
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  const metaLine = [
    h.school, h.className, gradeLabel && `Grade ${gradeLabel}`,
    h.term && `Term ${h.term}`, h.year, h.teacherName && `Teacher: ${h.teacherName}`,
  ].filter(Boolean).join('  ·  ')

  const sheet1 = model.layout === 'days-as-rows'
    ? daysAsRowsSheet(model, metaLine, settings)
    : daysAsColumnsSheet(model, metaLine, settings)
  const sheet2 = detailsSheet(model, timetable, opts.validation, settings)

  const contentTypes = XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>'

  const rootRels = XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'

  const workbook = XML_HEAD +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${esc(SHEET1)}" sheetId="1" r:id="rId1"/><sheet name="${esc(SHEET2)}" sheetId="2" r:id="rId3"/></sheets>` +
    '</workbook>'

  const workbookRels = XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
    '</Relationships>'

  return {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': workbookRels,
    'xl/styles.xml': stylesXml(),
    'xl/worksheets/sheet1.xml': sheet1,
    'xl/worksheets/sheet2.xml': sheet2,
  }
}

/** Zip the workbook parts into .xlsx bytes (uint8array). */
export async function buildClassTimetableXlsxBytes(timetable, opts = {}) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const files = buildClassTimetableWorkbookFiles(timetable, opts)
  for (const [path, xml] of Object.entries(files)) zip.file(path, xml)
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export async function downloadClassTimetableXlsx(timetable, filename = 'class-timetable.xlsx', opts = {}) {
  const bytes = await buildClassTimetableXlsxBytes(timetable, opts)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  await saveBlob(blob, filename)
}
