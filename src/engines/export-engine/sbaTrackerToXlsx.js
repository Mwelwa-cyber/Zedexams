/**
 * Export an SBA Mark Tracker as a real Excel (.xlsx) workbook with LIVE
 * formulas: each pupil's TOTAL is =SUM(task marks) and the SBA mark is
 * =ROUND(total / grade-maximum × 10) — the exact ECZ conversion. Edit a mark
 * in Excel and the total and the converted 10%-per-grade mark recalculate, so
 * the teacher can keep working in the spreadsheet schools already retain.
 *
 * Hand-built OOXML (inline strings + a small styles part) zipped with jszip —
 * already in the tree via `docx`, so no extra bundle weight. The same approach
 * as markScheduleToXlsx; buildSbaTrackerWorkbookFiles() is pure and DOM-free
 * so plain node can unit-test the XML.
 */

import { saveBlob } from '../../utils/saveBlob.js'

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

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

const numCell = (ref, v, s) => (v === '' || v == null
  ? `<c r="${ref}" s="${s}"/>`
  : `<c r="${ref}" s="${s}"><v>${Number(v)}</v></c>`)
const strCell = (ref, v, s) =>
  `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escText(v)}</t></is></c>`
const formulaCell = (ref, f, s) => `<c r="${ref}" s="${s}"><f>${escText(f)}</f></c>`

const S = {
  DEFAULT: 0, TITLE: 1, SUBTITLE: 2, HEAD: 3,
  CELL: 4, CELL_C: 5, CELL_BC: 6, NAME: 7,
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
    '<cellXfs count="8">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0"/>' +
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

function headingOf(artifact) {
  const h = artifact.header || {}
  return `${(h.subjectLabel || '').toUpperCase()} · ${(h.gradeLabel || '').toUpperCase()} SBA MARK SCHEDULE — ${h.year ?? ''}`
}

/** The single SBA schedule sheet with live TOTAL + SBA-mark formulas. */
function scheduleSheet(artifact) {
  const h = artifact.header || {}
  const columns = artifact.columns || []
  const pupils = artifact.pupils || []
  const total = Number(artifact.total) || 0
  const n = columns.length
  const firstTaskIdx = 2 // A=SN, B=NAME, tasks start at C
  const totalCol = colLetter(firstTaskIdx + n)
  const sbaCol = colLetter(firstTaskIdx + n + 1)
  const lastCol = sbaCol
  const firstTaskCol = colLetter(firstTaskIdx)
  const lastTaskCol = colLetter(firstTaskIdx + n - 1)
  const firstDataRow = 5

  const rows = [
    { r: 1, cells: [strCell('A1', h.school || '', S.TITLE)] },
    { r: 2, cells: [strCell('A2', headingOf(artifact), S.SUBTITLE)] },
    {
      r: 3,
      cells: [
        strCell('A3', 'SN', S.HEAD),
        strCell('B3', "PUPIL'S NAME", S.HEAD),
        ...columns.map((c, i) => strCell(`${colLetter(firstTaskIdx + i)}3`, c.label, S.HEAD)),
        strCell(`${totalCol}3`, `TOTAL /${total}`, S.HEAD),
        strCell(`${sbaCol}3`, 'SBA /10', S.HEAD),
      ],
    },
    {
      r: 4,
      cells: [
        strCell('A4', '', S.CELL),
        strCell('B4', 'Out of', S.CELL),
        ...columns.map((c, i) => numCell(`${colLetter(firstTaskIdx + i)}4`, Number(c.max) || 0, S.CELL_C)),
        numCell(`${totalCol}4`, total, S.CELL_BC),
        strCell(`${sbaCol}4`, '10', S.CELL_BC),
      ],
    },
    ...pupils.map((p, pi) => {
      const r = firstDataRow + pi
      const totalRef = `${totalCol}${r}`
      return {
        r,
        cells: [
          numCell(`A${r}`, pi + 1, S.CELL_C),
          strCell(`B${r}`, p.name || '', S.NAME),
          ...columns.map((c, i) => {
            const mark = p.marks?.[c.key]
            return numCell(`${colLetter(firstTaskIdx + i)}${r}`,
              mark == null || mark === '' ? '' : Number(mark), S.CELL_C)
          }),
          // Live total — edit a mark and the row re-totals.
          formulaCell(totalRef, `SUM(${firstTaskCol}${r}:${lastTaskCol}${r})`, S.CELL_BC),
          // ECZ conversion: round(total / grade-max × 10), clamped to 10.
          // Excel ROUND is half-away-from-zero = half-up for positives, matching
          // the guidelines' conversion table.
          formulaCell(`${sbaCol}${r}`,
            total > 0
              ? `IFERROR(MIN(10,ROUND(${totalRef}/${total}*10,0)),0)`
              : '0',
            S.CELL_BC),
        ],
      }
    }),
  ]

  return sheetXml({
    cols: [5, 26, ...columns.map(() => 8), 10, 9],
    rows,
    merges: [`A1:${lastCol}1`, `A2:${lastCol}2`],
    freezeAfterRow: 4,
  })
}

const SHEET1 = 'SBA Mark Schedule'

/** The full workbook as { path → XML string } — pure, node-testable. */
export function buildSbaTrackerWorkbookFiles(artifact) {
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
    '<calcPr fullCalcOnLoad="1"/>' +
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
    'xl/worksheets/sheet1.xml': scheduleSheet(artifact),
  }
}

export async function buildSbaTrackerXlsxBytes(artifact) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const files = buildSbaTrackerWorkbookFiles(artifact)
  for (const [path, xml] of Object.entries(files)) zip.file(path, xml)
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export async function downloadSbaTrackerXlsx(artifact, filename = 'sba-mark-schedule.xlsx') {
  const bytes = await buildSbaTrackerXlsxBytes(artifact)
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  await saveBlob(blob, filename)
}
