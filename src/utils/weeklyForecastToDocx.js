/**
 * Export a weekly forecast as a Word (.docx) file in landscape: the
 * official per-day grid (WEEK | DAY | TOPIC | SUB-TOPIC | SPECIFIC
 * COMPETENCE | LEARNING ACTIVITY | EXPECTED STANDARD | T/L RESOURCES |
 * REMARKS) with the school / teacher / week-dates fill-in header —
 * mirroring src/components/teacher/views/WeeklyForecastView.jsx.
 */

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
  VerticalMergeType,
  WidthType,
} from 'docx'

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '000000' },
}

const text = (str, opts = {}) => new TextRun({ text: str == null ? '' : String(str), size: 18, ...opts })
const para = (runs, opts = {}) => new Paragraph({
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { after: 40 },
  ...opts,
})

function bulletParas(items = []) {
  if (!items.length) return [para(text('—'))]
  return items.map((line) => new Paragraph({
    children: [text(line)],
    bullet: { level: 0 },
    spacing: { after: 30 },
  }))
}

function headCell(label, widthPct) {
  return new TableCell({
    children: [para(text(label, { bold: true }), { alignment: AlignmentType.CENTER })],
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: CELL_BORDER,
  })
}

function cell(content, { bold = false, center = false, bullets = false } = {}) {
  const children = bullets
    ? bulletParas(content)
    : [para(text(content, { bold }), center ? { alignment: AlignmentType.CENTER } : {})]
  return new TableCell({ children, borders: CELL_BORDER })
}

export function buildWeeklyForecastDocument(forecast) {
  const h = forecast.header || {}
  const days = forecast.days || []
  const subject = String(h.subject || '').toUpperCase()

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell('WEEK', 5),
      headCell('DAY', 5),
      headCell('TOPIC', 10),
      headCell('SUB-TOPIC / TO BE DONE', 12),
      headCell('SPECIFIC COMPETENCE', 15),
      headCell('LEARNING ACTIVITY', 21),
      headCell('EXPECTED STANDARD', 12),
      headCell('T/L RESOURCES', 10),
      headCell('REMARKS / COMMENTS ON PROGRESS', 10),
    ],
  })

  const dayRows = days.map((d, i) => new TableRow({
    children: [
      // WEEK number merges down the week's days, like the printed form.
      new TableCell({
        children: i === 0 ? [para(text(h.weekNumber, { bold: true }), { alignment: AlignmentType.CENTER })] : [para(text(''))],
        verticalMerge: i === 0 ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE,
        borders: CELL_BORDER,
      }),
      cell(d.day, { center: true }),
      cell(d.topic, { bold: true }),
      cell(d.subtopic),
      cell(d.specificCompetence),
      cell(d.learningActivities, { bullets: true }),
      cell(d.expectedStandard),
      cell(d.resources, { bullets: true }),
      cell(d.remarks || ''),
    ],
  }))

  return new Document({
    sections: [{
      properties: {
        // Landscape — nine columns never fit portrait A4.
        page: { size: { orientation: PageOrientation.LANDSCAPE } },
      },
      children: [
        new Paragraph({
          children: [text(`GRADE ${String(h.grade ?? '').replace(/^G/i, '')} ${subject} WEEKLY FORECAST`, { bold: true, size: 28 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [text(`TERM ${h.term ?? ''} · YEAR: ${h.year ?? ''}`, { bold: true, size: 22 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
        }),
        para([
          text('NAME OF SCHOOL: ', { bold: true }), text(h.school || '____________________'),
          text('    TEACHER’S NAME: ', { bold: true }), text(h.teacherName || '____________________'),
          text('    WEEK BEG: ', { bold: true }), text(h.weekBeginning || '__________'),
          text('    WEEK END: ', { bold: true }), text(h.weekEnding || '__________'),
        ], { spacing: { after: 160 } }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dayRows] }),
      ],
    }],
  })
}

export async function downloadWeeklyForecastDocx(forecast, filename = 'weekly-forecast.docx') {
  const doc = buildWeeklyForecastDocument(forecast)
  const blob = await Packer.toBlob(doc)
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
