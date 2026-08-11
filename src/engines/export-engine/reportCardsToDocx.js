/**
 * Export per-pupil report cards as a Word (.docx) file — one A4
 * portrait page per pupil, generated straight from the mark-schedule
 * artifact (buildReportCards in markSchedule.js does the data work).
 *
 * Card layout follows the Zambian school progress report: school head,
 * pupil/grade/position line, a SUBJECT | MARK | OUT OF | % table with
 * TOTAL and AVERAGE rows, the class teacher's comment (pre-filled from
 * the schedule), then blank head-teacher comment, next-term-opens and
 * signature lines for the parts schools fill in by hand.
 */

import { saveBlob } from '../../utils/saveBlob.js'
import { sanitizeXmlText } from '../../utils/xmlText.js'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { attributionSection } from '../../utils/docxAttribution.js'
import { buildReportCards, scheduleClassLabel } from '../../shared/utils/markSchedule.js'

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '000000' },
}

const BLANK = '______________________________'

const text = (str, opts = {}) => new TextRun({ text: sanitizeXmlText(str), size: 20, ...opts })
const para = (runs, opts = {}) => new Paragraph({
  children: Array.isArray(runs) ? runs : [runs],
  spacing: { after: 80 },
  ...opts,
})

function headCell(label, widthPct) {
  return new TableCell({
    children: [para(text(label, { bold: true }), { alignment: AlignmentType.CENTER, spacing: { after: 40 } })],
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    borders: CELL_BORDER,
  })
}

function cell(value, { bold = false, center = false, widthPct } = {}) {
  return new TableCell({
    children: [para(text(value, { bold }), center ? { alignment: AlignmentType.CENTER, spacing: { after: 40 } } : { spacing: { after: 40 } })],
    ...(widthPct ? { width: { size: widthPct, type: WidthType.PERCENTAGE } } : {}),
    borders: CELL_BORDER,
  })
}

function marksTable(card) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell('SUBJECT', 46),
      headCell('MARK', 18),
      headCell('OUT OF', 18),
      headCell('%', 18),
    ],
  })
  const rows = card.rows.map((r) => new TableRow({
    children: [
      cell(r.subject, { bold: true }),
      cell(r.mark, { center: true }),
      cell(r.max, { center: true }),
      cell(r.mark === '' ? '' : r.percent, { center: true }),
    ],
  }))
  const totalRow = new TableRow({
    children: [
      cell('TOTAL', { bold: true }),
      cell(card.total, { bold: true, center: true }),
      cell(card.maxTotal, { bold: true, center: true }),
      cell(`${card.averagePercent}`, { bold: true, center: true }),
    ],
  })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...rows, totalRow],
  })
}

function cardChildren(card, header, { first }) {
  const h = header || {}
  // The card prints its own "GRADE:" caption, so drop a redundant leading
  // "Grade " from the class label ("Grade 5" → "5", "Form 1" stays "Form 1").
  // Legacy artifacts without header.gradeLabel keep the historical G-strip
  // rendering ('G4' → "4", 'F1' → "F1").
  const gradeLabel = scheduleClassLabel(h).replace(/^Grade\s*/i, '')
  return [
    new Paragraph({
      children: [text(h.school || '', { bold: true, size: 30 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      ...(first ? {} : { pageBreakBefore: true }),
    }),
    new Paragraph({
      children: [text(`END OF TERM ${h.term ?? ''} PROGRESS REPORT — ${h.year ?? ''}`, { bold: true, size: 24 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    para([
      text('NAME: ', { bold: true }), text(card.name || BLANK),
      text('        GRADE: ', { bold: true }), text(gradeLabel),
    ]),
    para([
      text('POSITION IN CLASS: ', { bold: true }),
      text(`${card.position ?? ''} of ${card.classSize}`),
      text('        AVERAGE: ', { bold: true }),
      text(`${card.averagePercent}%`),
    ], { spacing: { after: 160 } }),
    marksTable(card),
    para(text(' ', { size: 10 }), { spacing: { after: 40 } }),
    para([text("CLASS TEACHER'S COMMENT:", { bold: true })], { spacing: { after: 60 } }),
    para(text(card.comment || BLANK)),
    para(text(BLANK + BLANK, { color: '999999' }), { spacing: { after: 160 } }),
    para([text("HEAD TEACHER'S COMMENT:", { bold: true })], { spacing: { after: 60 } }),
    para(text(BLANK + BLANK, { color: '999999' })),
    para(text(BLANK + BLANK, { color: '999999' }), { spacing: { after: 200 } }),
    para([
      text('NEXT TERM OPENS: ', { bold: true }),
      text(h.nextTermOpens || '____________________'),
    ], { spacing: { after: 160 } }),
    para([
      text("CLASS TEACHER'S SIGNATURE: ", { bold: true }), text('________________'),
      text("        HEAD TEACHER'S SIGNATURE: ", { bold: true }), text('________________'),
    ]),
  ]
}

export function buildReportCardsDocument(schedule, opts = {}) {
  const cards = buildReportCards(schedule)
  const children = cards.flatMap((card, i) =>
    cardChildren(card, schedule.header, { first: i === 0 }))
  return new Document({
    creator: 'zedexams.com',
    title: sanitizeXmlText(`Report Cards — Term ${schedule.header?.term || ''} ${schedule.header?.year || ''}`),
    description: 'Generated by ZedExams Teacher Tools',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 20 } },
      },
    },
    // Portrait A4 — one card (page) per pupil.
    sections: [{ ...attributionSection(opts), children }],
  })
}

export async function downloadReportCardsDocx(schedule, filename = 'report-cards.docx', opts = {}) {
  const doc = buildReportCardsDocument(schedule, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}
