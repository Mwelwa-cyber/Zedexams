/**
 * Export a record of work as a Word (.docx) file in landscape: the
 * official weekly log grid (WEEK | WEEK ENDING | TOPIC | SUB-TOPIC |
 * WORK DONE | REMARKS) with the school / teacher fill-in header and the
 * teacher + checked-by signature block — mirroring
 * src/components/teacher/views/RecordOfWorkView.jsx.
 */

import { saveBlob } from '../../utils/saveBlob.js'
import { sanitizeXmlText } from '../../utils/xmlText.js'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { printedRemark } from '../../shared/utils/recordOfWork.js'
import { attributionSection, attributionFooterParagraph } from '../../utils/docxAttribution.js'

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

export function buildRecordOfWorkDocument(record, opts = {}) {
  const h = record.header || {}
  const weeks = record.weeks || []
  const subject = String(h.subject || '').toUpperCase()

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell('WEEK', 5),
      headCell('WEEK ENDING', 10),
      headCell('TOPIC', 16),
      headCell('SUB-TOPIC', 16),
      headCell('WORK DONE', 33),
      headCell('REMARKS', 20),
    ],
  })

  const weekRows = weeks.map((w) => new TableRow({
    // A week's row is never cut across a page break — a multi-page term moves
    // the whole week to the next page (the header row repeats via tableHeader).
    cantSplit: true,
    children: [
      cell(w.week, { bold: true, center: true }),
      cell(w.weekEnding || ''),
      cell(w.topic, { bold: true }),
      cell(w.subtopic),
      cell(w.workDone, { bullets: true }),
      cell(printedRemark(w)),
    ],
  }))

  // Footer: "Page X of Y" so a multi-page record photocopies/collates safely.
  // Free-plan exports keep the attribution line in the same footer (the
  // watermark header still comes from attributionSection); statutory content
  // is untouched — this is page furniture only.
  const grey = { size: 14, color: '888888' }
  const footer = new Footer({
    children: [
      ...(opts?.attribution ? [attributionFooterParagraph()] : []),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Page ', ...grey }),
          new TextRun({ children: [PageNumber.CURRENT], ...grey }),
          new TextRun({ text: ' of ', ...grey }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], ...grey }),
        ],
      }),
    ],
  })

  const attr = attributionSection(opts) // watermark header (free plan) or {}
  return new Document({
    sections: [{
      ...(attr.headers ? { headers: attr.headers } : {}),
      footers: { default: footer },
      properties: {
        // Landscape — matches the scheme + forecast family and gives the
        // WORK DONE column the room a term's log actually needs.
        page: { size: { orientation: PageOrientation.LANDSCAPE } },
      },
      children: [
        new Paragraph({
          children: [text(`GRADE ${String(h.grade ?? '').replace(/^G/i, '')} ${subject} RECORD OF WORK`, { bold: true, size: 28 })],
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
        ], { spacing: { after: 160 } }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...weekRows] }),
        para([
          text('TEACHER’S SIGNATURE: ', { bold: true }), text('______________________'),
          text('    DATE: ', { bold: true }), text('____________'),
        ], { spacing: { before: 240, after: 80 } }),
        para([
          text('CHECKED BY (H.O.D / HEAD TEACHER): ', { bold: true }), text('______________________'),
          text('    DATE: ', { bold: true }), text('____________'),
        ]),
      ],
    }],
  })
}

export async function downloadRecordOfWorkDocx(record, filename = 'record-of-work.docx', opts = {}) {
  const doc = buildRecordOfWorkDocument(record, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}
