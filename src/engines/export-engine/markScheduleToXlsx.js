/**
 * Export a mark schedule as a real Excel (.xlsx) workbook — the format
 * schools actually keep their schedules in (the reference document is an
 * XLSX). Three sheets:
 *
 *   1. "Mark Schedule"   — the official grid with LIVE formulas: TOTAL is
 *                          =SUM(...) and POSITION is a dense-rank
 *                          SUMPRODUCT, so editing a mark in Excel
 *                          re-totals and re-ranks the whole class (ties
 *                          share a place — the thing teachers get wrong
 *                          when ranking by hand).
 *   2. "Percentages"     — each subject as % of its maximum + AVERAGE %,
 *                          derived by formula from sheet 1; positions
 *                          stay anchored to the raw totals.
 *   3. "Report Comments" — SN | NAME | POSITION | COMMENT, positions
 *                          referenced live from sheet 1.
 *
 * The workbook is hand-built OOXML (inline strings, one small styles
 * part) zipped with jszip — already in the dependency tree via `docx`,
 * so this adds no bundle weight. buildMarkScheduleWorkbookFiles() is
 * pure and DOM-free so plain node can unit-test the XML.
 */

import { saveBlob } from '../../utils/saveBlob.js'
import { scheduleClassLabel } from '../../shared/utils/markSchedule.js'

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

// Element content only needs & < > escaped — formulas keep their
// 'Sheet Name'! quoting readable, the way Excel itself writes them.
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

/* Cell builders — s = style index into cellXfs below. */
const numCell = (ref, v, s) => (v === '' || v == null
  ? `<c r="${ref}" s="${s}"/>`
  : `<c r="${ref}" s="${s}"><v>${Number(v)}</v></c>`)
const strCell = (ref, v, s) =>
  `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escText(v)}</t></is></c>`
const formulaCell = (ref, f, s) => `<c r="${ref}" s="${s}"><f>${escText(f)}</f></c>`

/* Style indices (cellXfs order in stylesXml below). */
const S = {
  DEFAULT: 0,
  TITLE: 1,      // bold 14, centered (school name)
  SUBTITLE: 2,   // bold, centered (document heading)
  HEAD: 3,       // bold, grey fill, border, centered, wrapped
  CELL: 4,       // border
  CELL_C: 5,     // border, centered
  CELL_BC: 6,    // border, bold, centered (totals / positions)
  NAME: 7,       // border, bold (pupil name)
  WRAP: 8,       // border, wrapped, top-aligned (comments)
}

function stylesXml() {
  return XML_HEAD +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill>' +
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
    '<cellXfs count="9">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
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

const SHEET1 = 'Mark Schedule'
const sheet1Ref = (cellRef) => `'${SHEET1}'!${cellRef}`

// Prefer the saved human label ("Form 1"); legacy artifacts without one keep
// the historical "GRADE " + G-strip rendering ('G4' → "GRADE 4").
const classLabelOf = (header) => scheduleClassLabel(header).toUpperCase()

function headingOf(schedule) {
  const h = schedule.header || {}
  return `${classLabelOf(h)} · TERM ${h.term ?? ''} MARK SCHEDULE — ${h.year ?? ''}`
}

/** Sheet 1 — the official grid with live total + dense-rank formulas. */
function scheduleSheet(schedule) {
  const h = schedule.header || {}
  const subjects = schedule.subjects || []
  const pupils = schedule.pupils || []
  const totalCol = colLetter(2 + subjects.length)
  const posCol = colLetter(3 + subjects.length)
  const lastCol = posCol
  const firstDataRow = 5
  const lastDataRow = 4 + pupils.length
  const totalsRange = `${totalCol}$${firstDataRow}:${totalCol}$${lastDataRow}`
  const maxTotal = subjects.reduce((sum, s) => sum + (Number(s.max) || 0), 0)

  const rows = [
    { r: 1, cells: [strCell('A1', h.school || '', S.TITLE)] },
    { r: 2, cells: [strCell('A2', headingOf(schedule), S.SUBTITLE)] },
    {
      r: 3,
      cells: [
        strCell('A3', 'SN', S.HEAD),
        strCell('B3', "PUPIL'S NAME", S.HEAD),
        ...subjects.map((s, i) => strCell(`${colLetter(2 + i)}3`, s.label, S.HEAD)),
        strCell(`${totalCol}3`, 'TOTAL', S.HEAD),
        strCell(`${posCol}3`, 'POSITION', S.HEAD),
      ],
    },
    {
      r: 4,
      cells: [
        strCell('A4', '', S.CELL),
        strCell('B4', 'Out of', S.CELL),
        ...subjects.map((s, i) => numCell(`${colLetter(2 + i)}4`, Number(s.max) || 0, S.CELL_C)),
        numCell(`${totalCol}4`, maxTotal, S.CELL_BC),
        strCell(`${posCol}4`, '', S.CELL),
      ],
    },
    ...pupils.map((p, pi) => {
      const r = firstDataRow + pi
      return {
        r,
        cells: [
          numCell(`A${r}`, p.sn ?? pi + 1, S.CELL_C),
          strCell(`B${r}`, p.name || '', S.NAME),
          ...subjects.map((s, i) => {
            const mark = p.marks?.[s.key]
            return numCell(`${colLetter(2 + i)}${r}`, mark == null || mark === '' ? '' : Number(mark), S.CELL_C)
          }),
          // Live total — edit a mark in Excel and the row re-totals.
          formulaCell(`${totalCol}${r}`, `SUM(${colLetter(2)}${r}:${colLetter(1 + subjects.length)}${r})`, S.CELL_BC),
          // Dense rank: distinct totals above mine + 1, so ties share a
          // position and the next distinct total takes the next number.
          formulaCell(`${posCol}${r}`, `SUMPRODUCT((${totalsRange}>${totalCol}${r})/COUNTIF(${totalsRange},${totalsRange}))+1`, S.CELL_BC),
        ],
      }
    }),
  ]

  return sheetXml({
    cols: [5, 26, ...subjects.map(() => 10), 9, 10],
    rows,
    merges: [`A1:${lastCol}1`, `A2:${lastCol}2`],
    freezeAfterRow: 4,
  })
}

/** Sheet 2 — percentages derived by formula from sheet 1; positions stay raw-anchored. */
function percentSheet(schedule) {
  const h = schedule.header || {}
  const subjects = schedule.subjects || []
  const pupils = schedule.pupils || []
  const totalCol = colLetter(2 + subjects.length) // AVERAGE % col here
  const posCol = colLetter(3 + subjects.length)
  const lastCol = posCol
  const s1PosCol = posCol // same geometry as sheet 1
  const firstDataRow = 5

  const rows = [
    { r: 1, cells: [strCell('A1', h.school || '', S.TITLE)] },
    { r: 2, cells: [strCell('A2', `${headingOf(schedule)} (PERCENTAGES)`, S.SUBTITLE)] },
    {
      r: 3,
      cells: [
        strCell('A3', 'SN', S.HEAD),
        strCell('B3', "PUPIL'S NAME", S.HEAD),
        ...subjects.map((s, i) => strCell(`${colLetter(2 + i)}3`, `${s.label} %`, S.HEAD)),
        strCell(`${totalCol}3`, 'AVERAGE %', S.HEAD),
        strCell(`${posCol}3`, 'POSITION', S.HEAD),
      ],
    },
    {
      r: 4,
      cells: [
        strCell('A4', '', S.CELL),
        strCell('B4', 'Out of', S.CELL),
        ...subjects.map((_, i) => numCell(`${colLetter(2 + i)}4`, 100, S.CELL_C)),
        numCell(`${totalCol}4`, 100, S.CELL_BC),
        strCell(`${posCol}4`, '', S.CELL),
      ],
    },
    ...pupils.map((p, pi) => {
      const r = firstDataRow + pi
      return {
        r,
        cells: [
          numCell(`A${r}`, p.sn ?? pi + 1, S.CELL_C),
          strCell(`B${r}`, p.name || '', S.NAME),
          ...subjects.map((s, i) => {
            const c = colLetter(2 + i)
            // % of the subject max on sheet 1; IFERROR guards a 0 max.
            return formulaCell(`${c}${r}`,
              `IFERROR(ROUND(${sheet1Ref(`${c}${r}`)}/${sheet1Ref(`${c}$4`)}*100,0),0)`, S.CELL_C)
          }),
          formulaCell(`${totalCol}${r}`,
            `IFERROR(ROUND(AVERAGE(${colLetter(2)}${r}:${colLetter(1 + subjects.length)}${r}),0),0)`, S.CELL_BC),
          // Positions are always anchored to the raw totals on sheet 1.
          formulaCell(`${posCol}${r}`, sheet1Ref(`${s1PosCol}${r}`), S.CELL_BC),
        ],
      }
    }),
  ]

  return sheetXml({
    cols: [5, 26, ...subjects.map(() => 10), 11, 10],
    rows,
    merges: [`A1:${lastCol}1`, `A2:${lastCol}2`],
    freezeAfterRow: 4,
  })
}

/** Sheet 3 — the Report Comments Sheet (separate from the A4 schedule). */
function commentsSheet(schedule) {
  const h = schedule.header || {}
  const subjects = schedule.subjects || []
  const pupils = schedule.pupils || []
  const s1PosCol = colLetter(3 + subjects.length)
  const firstDataRow = 4

  const rows = [
    { r: 1, cells: [strCell('A1', h.school || '', S.TITLE)] },
    { r: 2, cells: [strCell('A2', `REPORT COMMENTS SHEET — ${classLabelOf(h)} TERM ${h.term ?? ''} ${h.year ?? ''}`, S.SUBTITLE)] },
    {
      r: 3,
      cells: [
        strCell('A3', 'SN', S.HEAD),
        strCell('B3', "PUPIL'S NAME", S.HEAD),
        strCell('C3', 'POSITION', S.HEAD),
        strCell('D3', 'SUGGESTED COMMENT', S.HEAD),
      ],
    },
    ...pupils.map((p, pi) => {
      const r = firstDataRow + pi
      return {
        r,
        cells: [
          numCell(`A${r}`, p.sn ?? pi + 1, S.CELL_C),
          strCell(`B${r}`, p.name || '', S.NAME),
          formulaCell(`C${r}`, sheet1Ref(`${s1PosCol}${4 + pi + 1}`), S.CELL_BC),
          strCell(`D${r}`, p.comment || '', S.WRAP),
        ],
      }
    }),
  ]

  return sheetXml({
    cols: [5, 26, 10, 80],
    rows,
    merges: ['A1:D1', 'A2:D2'],
    freezeAfterRow: 3,
  })
}

const SHEETS = [
  { name: SHEET1, build: scheduleSheet },
  { name: 'Percentages', build: percentSheet },
  { name: 'Report Comments', build: commentsSheet },
]

/**
 * The full workbook as { path → XML string } — pure, so plain node can
 * unit-test the parts without zipping.
 */
export function buildMarkScheduleWorkbookFiles(schedule) {
  const contentTypes = XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    SHEETS.map((_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>'

  const rootRels = XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'

  const workbook = XML_HEAD +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    SHEETS.map((s, i) =>
      `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets>' +
    // Formulas carry no cached values — make Excel/LibreOffice compute
    // everything the moment the file opens.
    '<calcPr fullCalcOnLoad="1"/>' +
    '</workbook>'

  const workbookRels = XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    SHEETS.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${SHEETS.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>'

  const files = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': workbookRels,
    'xl/styles.xml': stylesXml(),
  }
  SHEETS.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = s.build(schedule)
  })
  return files
}

/** Zip the workbook parts into .xlsx bytes (uint8array). */
export async function buildMarkScheduleXlsxBytes(schedule) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const files = buildMarkScheduleWorkbookFiles(schedule)
  for (const [path, xml] of Object.entries(files)) zip.file(path, xml)
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export async function downloadMarkScheduleXlsx(schedule, filename = 'mark-schedule.xlsx') {
  const bytes = await buildMarkScheduleXlsxBytes(schedule)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  await saveBlob(blob, filename)
}
