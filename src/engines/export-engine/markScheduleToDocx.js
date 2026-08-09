/**
 * Export a mark schedule as a Word (.docx) file: page 1 is the official
 * schedule grid (raw marks or percentages), page 2 the Report Comments
 * Sheet — mirroring src/components/teacher/views/MarkScheduleView.jsx.
 */

import { saveBlob } from '../../utils/saveBlob.js'
import { sanitizeXmlText } from '../../utils/xmlText.js'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { attributionSection } from '../../utils/docxAttribution.js'
import { percentFor, averagePercent, scheduleClassLabel } from '../../shared/utils/markSchedule.js'

// Solid black grid — the schedule is a formal school record.
const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '000000' },
}

const text = (str, opts = {}) => new TextRun({ text: sanitizeXmlText(str), size: 18, ...opts })
const para = (runs, opts = {}) => new Paragraph({
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { after: 40 },
  ...opts,
})

function headCell(label, widthPct) {
  return new TableCell({
    children: [para(text(label, { bold: true }), { alignment: AlignmentType.CENTER })],
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: CELL_BORDER,
  })
}

function cell(value, { bold = false, center = false, widthPct } = {}) {
  return new TableCell({
    children: [para(text(value, { bold }), center ? { alignment: AlignmentType.CENTER } : {})],
    ...(widthPct ? { width: { size: widthPct, type: WidthType.PERCENTAGE } } : {}),
    borders: CELL_BORDER,
  })
}

function titleBlock(lines) {
  return lines.map(([str, size], i) => new Paragraph({
    children: [text(str, { bold: true, size })],
    alignment: AlignmentType.CENTER,
    spacing: { after: i === lines.length - 1 ? 200 : 60 },
  }))
}

function scheduleTable(schedule, mode) {
  const subjects = schedule.subjects || []
  const pupils = schedule.pupils || []
  const isPercent = mode === 'percent'
  const maxTotal = subjects.reduce((sum, s) => sum + (s.max || 0), 0)
  const nameW = 22
  const snW = 5
  const posW = 8
  const totalW = 9
  const subjW = Math.max(6, Math.floor((100 - nameW - snW - posW - totalW) / (subjects.length || 1)))

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell('SN', snW),
      headCell("PUPIL'S NAME", nameW),
      ...subjects.map((s) => headCell(isPercent ? `${s.label} %` : s.label, subjW)),
      headCell(isPercent ? 'AVERAGE %' : 'TOTAL', totalW),
      headCell('POSITION', posW),
    ],
  })

  const outOfRow = new TableRow({
    children: [
      cell(''),
      cell('Out of', { center: false }),
      ...subjects.map((s) => cell(isPercent ? 100 : s.max, { center: true })),
      cell(isPercent ? 100 : maxTotal, { bold: true, center: true }),
      cell(''),
    ],
  })

  const pupilRows = pupils.map((p) => new TableRow({
    children: [
      cell(p.sn, { center: true }),
      cell(p.name, { bold: true }),
      ...subjects.map((s) => cell(
        isPercent ? percentFor(p.marks?.[s.key], s.max) : (p.marks?.[s.key] ?? ''),
        { center: true },
      )),
      cell(isPercent ? averagePercent(p.marks, subjects) : p.total, { bold: true, center: true }),
      cell(p.position, { bold: true, center: true }),
    ],
  }))

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, outOfRow, ...pupilRows],
  })
}

function commentsTable(schedule) {
  const pupils = schedule.pupils || []
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell('SN', 5),
      headCell("PUPIL'S NAME", 24),
      headCell('POSITION', 10),
      headCell('SUGGESTED COMMENT', 61),
    ],
  })
  const rows = pupils.map((p) => new TableRow({
    children: [
      cell(p.sn, { center: true }),
      cell(p.name, { bold: true }),
      cell(p.position, { bold: true, center: true }),
      cell(p.comment || ''),
    ],
  }))
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] })
}

export function buildMarkScheduleDocument(schedule, { mode = 'marks', attribution = false } = {}) {
  const h = schedule.header || {}
  // scheduleClassLabel prefers the saved human label ("Form 1"); legacy
  // artifacts without one keep the historical G-strip ('G4' → "GRADE 4").
  const heading = `${scheduleClassLabel(h).toUpperCase()} · TERM ${h.term ?? ''} MARK SCHEDULE — ${h.year ?? ''}`

  return new Document({
    sections: [
      {
        ...attributionSection({ attribution }),
        properties: {
          // Landscape: with five-plus subject columns the grid is wide,
          // exactly like the printed schedules schools keep.
          page: { size: { orientation: PageOrientation.LANDSCAPE } },
        },
        children: [
          ...titleBlock([[h.school || '', 28], [heading, 24]]),
          scheduleTable(schedule, mode),
        ],
      },
      {
        ...attributionSection({ attribution }),
        properties: {
          page: { size: { orientation: PageOrientation.LANDSCAPE } },
        },
        children: [
          ...titleBlock([[h.school || '', 28], ['REPORT COMMENTS SHEET', 24]]),
          commentsTable(schedule),
        ],
      },
    ],
  })
}

export async function downloadMarkScheduleDocx(schedule, filename = 'mark-schedule.docx', opts = {}) {
  const doc = buildMarkScheduleDocument(schedule, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}
