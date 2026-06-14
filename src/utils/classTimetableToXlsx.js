/**
 * Export a class timetable as a real Excel (.xlsx) workbook — a single
 * "Timetable" sheet holding the TIME × days grid, with break/lunch rows
 * merged across the day columns. Hand-built OOXML zipped with jszip
 * (already in the tree via `docx`), so this adds no bundle weight.
 *
 * buildClassTimetableWorkbookFiles() is pure and DOM-free so plain node can
 * unit-test the XML (see scripts/test-class-timetable.mjs).
 */

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
}

function stylesXml() {
  return XML_HEAD +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="4">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF1ECE0"/></patternFill></fill>' +
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
    '<cellXfs count="7">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
}

function sheetXml({ cols, rows, merges, freezeAfterRow }) {
  const colsXml = cols.length
    ? '<cols>' + cols.map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>'
    : ''
  const view = freezeAfterRow
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeAfterRow}" topLeftCell="A${freezeAfterRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  const data = '<sheetData>' + rows.map(({ r, cells }) =>
    `<row r="${r}">${cells.join('')}</row>`).join('') + '</sheetData>'
  const mergesXml = merges.length
    ? `<mergeCells count="${merges.length}">` + merges.map((m) => `<mergeCell ref="${m}"/>`).join('') + '</mergeCells>'
    : ''
  return XML_HEAD +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    view + colsXml + data + mergesXml +
    '</worksheet>'
}

function timetableSheet(timetable) {
  const h = timetable.header || {}
  const days = Array.isArray(timetable.days) ? timetable.days : []
  const periods = Array.isArray(timetable.periods) ? timetable.periods : []
  const slots = timetable.slots || {}
  const ncols = 1 + days.length
  const lastCol = colLetter(ncols - 1)

  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  const metaLine = [
    h.school, h.className, gradeLabel && `Grade ${gradeLabel}`,
    h.term && `Term ${h.term}`, h.year, h.teacherName && `Teacher: ${h.teacherName}`,
  ].filter(Boolean).join('  ·  ')

  const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`]
  const rows = []

  // Row 1 — title; row 2 — meta line.
  rows.push({ r: 1, cells: [strCell('A1', 'CLASS TIMETABLE', S.TITLE)] })
  rows.push({ r: 2, cells: [strCell('A2', metaLine, S.META)] })

  // Row 3 — header (TIME + days).
  rows.push({
    r: 3,
    cells: [
      strCell('A3', 'TIME', S.HEAD),
      ...days.map((d, i) => strCell(`${colLetter(i + 1)}3`, d.toUpperCase(), S.HEAD)),
    ],
  })

  // Rows 4+ — periods.
  periods.forEach((p, pi) => {
    const r = 4 + pi
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
    rows.push({
      r,
      cells: [
        strCell(`A${r}`, `${p.start}–${p.end}\n${p.label}`, S.TIME),
        ...days.map((d, i) => strCell(`${colLetter(i + 1)}${r}`, slots?.[p.id]?.[d] || '', S.CELL)),
      ],
    })
  })

  const cols = [14, ...days.map(() => 16)]
  return sheetXml({ cols, rows, merges, freezeAfterRow: 3 })
}

const SHEET1 = 'Timetable'

/** The full workbook as { path → XML string } — pure, so node can test it. */
export function buildClassTimetableWorkbookFiles(timetable) {
  const contentTypes = XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>'

  const rootRels = XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'

  const workbook = XML_HEAD +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${esc(SHEET1)}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>'

  const workbookRels = XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>'

  return {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': workbookRels,
    'xl/styles.xml': stylesXml(),
    'xl/worksheets/sheet1.xml': timetableSheet(timetable),
  }
}

/** Zip the workbook parts into .xlsx bytes (uint8array). */
export async function buildClassTimetableXlsxBytes(timetable) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const files = buildClassTimetableWorkbookFiles(timetable)
  for (const [path, xml] of Object.entries(files)) zip.file(path, xml)
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export async function downloadClassTimetableXlsx(timetable, filename = 'class-timetable.xlsx') {
  const bytes = await buildClassTimetableXlsxBytes(timetable)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  try {
    const { saveAs } = await import('file-saver')
    saveAs(blob, filename)
    return
  } catch { /* fall through to the manual anchor */ }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
