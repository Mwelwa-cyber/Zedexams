/**
 * Export a weekly forecast as a Word (.docx) file in landscape: the
 * official per-day grid (WEEK | DAY | TOPIC | SUB-TOPIC | SPECIFIC
 * COMPETENCE | LEARNING ACTIVITY | EXPECTED STANDARD | T/L RESOURCES |
 * REMARKS) with the school / teacher / week-dates fill-in header —
 * mirroring src/components/teacher/views/WeeklyForecastView.jsx.
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
  VerticalMergeType,
  WidthType,
} from 'docx'
import { attributionSection } from '../../utils/docxAttribution.js'
import { forecastColumns, forecastCurriculum } from '../../shared/utils/schemeFormat.js'

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

export function buildWeeklyForecastDocument(forecast, opts = {}) {
  const h = forecast.header || {}
  const days = forecast.days || []
  const subject = String(h.subject || '').toUpperCase()

  // CBC (with Learning Activity + Expected Standard) vs OBC (without) — the
  // WEEK column merges down separately, so the shared spec covers DAY onward.
  const columns = forecastColumns(forecastCurriculum(forecast))

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell('WEEK', 5),
      ...columns.map((col) => headCell(col.label, col.width)),
    ],
  })

  const dayCellFor = (d, col) => {
    if (col.type === 'list') return cell(d[col.key], { bullets: true })
    if (col.key === 'day') return cell(d.day, { center: true })
    if (col.key === 'topic') return cell(d.topic, { bold: true })
    return cell(d[col.key] || '')
  }

  const dayRows = days.map((d, i) => new TableRow({
    children: [
      // WEEK number merges down the week's days, like the printed form.
      new TableCell({
        children: i === 0 ? [para(text(h.weekNumber, { bold: true }), { alignment: AlignmentType.CENTER })] : [para(text(''))],
        verticalMerge: i === 0 ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE,
        borders: CELL_BORDER,
      }),
      ...columns.map((col) => dayCellFor(d, col)),
    ],
  }))

  return new Document({
    sections: [{
      ...attributionSection(opts),
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

export async function downloadWeeklyForecastDocx(forecast, filename = 'weekly-forecast.docx', opts = {}) {
  const doc = buildWeeklyForecastDocument(forecast, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}
