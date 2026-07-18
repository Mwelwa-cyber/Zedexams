/**
 * Export a class timetable as a Word (.docx) file in landscape — the grid
 * teachers print and pin to the classroom wall. Renders from the SAME
 * shared grid model as the on-screen preview (timetableGridModel.js):
 * both layouts, merged double periods (vertical merge in "Days across the
 * top", horizontal span in "Days down the left"), full time values and
 * wrapped subject names inside the printable margins.
 */

import { saveBlob } from './saveBlob.js'
import { sanitizeXmlText } from './xmlText.js'
import {
  AlignmentType,
  BorderStyle,
  Document,
  PageOrientation,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalMergeType,
  WidthType,
} from 'docx'
import { attributionSection } from './docxAttribution.js'
import { buildTimetableGridModel, cellState, dayRowForSlot } from './timetableGridModel.js'

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '000000' },
}

const text = (str, opts = {}) => new TextRun({ text: sanitizeXmlText(str), size: 18, ...opts })
const centred = (runs) => new Paragraph({
  children: Array.isArray(runs) ? runs : [runs],
  alignment: AlignmentType.CENTER,
  spacing: { after: 20 },
})

function cell(content, { bold = false, italics = false, shade, colSpan, verticalMerge, widthPct } = {}) {
  const runs = Array.isArray(content) ? content : [text(content, { bold, italics })]
  return new TableCell({
    children: [centred(runs)],
    borders: CELL_BORDER,
    ...(shade ? { shading: { fill: shade } } : {}),
    ...(colSpan ? { columnSpan: colSpan } : {}),
    ...(verticalMerge ? { verticalMerge } : {}),
    ...(widthPct ? { width: { size: widthPct, type: WidthType.PERCENTAGE } } : {}),
    verticalAlign: 'center',
  })
}

function titleBlock(h) {
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  const lines = []
  if (h.school) {
    lines.push(new Paragraph({
      children: [text(h.school, { bold: true, size: 24 })],
      alignment: AlignmentType.CENTER, spacing: { after: 40 },
    }))
  }
  lines.push(new Paragraph({
    children: [text('CLASS TIMETABLE', { bold: true, size: 28 })],
    alignment: AlignmentType.CENTER, spacing: { after: 40 },
  }))
  const meta = [
    h.className && String(h.className).trim(),
    gradeLabel && `Grade ${gradeLabel}`,
    h.term && `Term ${h.term}`,
    h.year && String(h.year),
  ].filter(Boolean).join('   ·   ')
  if (meta) {
    lines.push(new Paragraph({
      children: [text(meta, { bold: true, size: 20 })],
      alignment: AlignmentType.CENTER, spacing: { after: 40 },
    }))
  }
  if (h.teacherName) {
    lines.push(new Paragraph({
      children: [text(`Class teacher: ${h.teacherName}`, { size: 18 })],
      alignment: AlignmentType.CENTER, spacing: { after: 160 },
    }))
  } else {
    lines.push(new Paragraph({ children: [text(' ', { size: 8 })], spacing: { after: 120 } }))
  }
  return lines
}

function signatureBlock(h) {
  const bits = [
    h.preparedBy && `Prepared by: ${h.preparedBy}`,
    h.approvedBy && `Approved by: ${h.approvedBy}`,
  ].filter(Boolean)
  if (!bits.length) return []
  return [new Paragraph({
    children: [text(bits.join('   ·   '), { size: 18 })],
    alignment: AlignmentType.CENTER, spacing: { before: 240 },
  })]
}

/** A cell's own-day time caption — only rendered when a day-specific school
 * structure (e.g. a half-day Friday) gives this cell's slot a different
 * clock time than the shared reference row shown in the header. */
function dayTimeCaption(model, day, slot) {
  const dayRow = dayRowForSlot(model, day, slot)
  const refRow = model.rows.find((r) => r.kind === 'lesson' && r.slot === slot)
  if (!dayRow || !refRow || (dayRow.start === refRow.start && dayRow.end === refRow.end)) return null
  return `${dayRow.start}–${dayRow.end}`
}

/** Content runs for a placed block cell. */
function blockCellOpts(block, span, layout, caption) {
  const isActivity = block.type === 'school-activity'
  const runs = [text(block.label, { bold: !isActivity, italics: isActivity })]
  if (span > 1) {
    runs.push(new TextRun({ break: 1 }))
    runs.push(text('DOUBLE PERIOD', { size: 12, color: '666666' }))
  }
  if (caption) {
    runs.push(new TextRun({ break: 1 }))
    runs.push(text(caption, { size: 12, color: '888888' }))
  }
  return {
    runs,
    opts: {
      ...(isActivity ? { shade: 'F6F3EA' } : {}),
      ...(span > 1 && layout === 'days-as-rows' ? { colSpan: span } : {}),
    },
  }
}

function timeLabelRuns(model, p) {
  const runs = []
  if (model.labelMode !== 'period') runs.push(text(`${p.start}–${p.end}`, { bold: true }))
  if (model.labelMode !== 'time') {
    if (runs.length) runs.push(new TextRun({ break: 1 }))
    runs.push(text(`Period ${p.slot}`, { size: 14, color: '555555' }))
  }
  return runs
}

function daysAsColumnsRows(model) {
  const dayWidth = model.days.length ? Math.floor(86 / model.days.length) : 86
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell('TIME', { bold: true, shade: 'E2E8F0', widthPct: 14 }),
      ...model.days.map((d) => cell(d.toUpperCase(), { bold: true, shade: 'E2E8F0', widthPct: dayWidth })),
    ],
  })

  const bodyRows = model.rows.map((p) => {
    if (p.kind === 'break') {
      return new TableRow({
        children: [
          cell(`${p.start}–${p.end}`, { bold: true }),
          cell(p.label, { bold: true, shade: 'F1ECE0', colSpan: model.days.length || 1 }),
        ],
      })
    }
    return new TableRow({
      children: [
        cell(timeLabelRuns(model, p), {}),
        ...model.days.map((d) => {
          const c = cellState(model, d, p.slot)
          if (c.state === 'covered') {
            // Word merges vertically: continuation cells carry CONTINUE.
            return cell('', { verticalMerge: VerticalMergeType.CONTINUE })
          }
          if (c.state === 'off') return cell('—', { shade: 'EFECE3' })
          if (!c.block) return cell('', {})
          const { runs, opts } = blockCellOpts(c.block, c.block.length, 'days-as-columns', dayTimeCaption(model, d, p.slot))
          return cell(runs, {
            ...opts,
            ...(c.block.length > 1 ? { verticalMerge: VerticalMergeType.RESTART } : {}),
          })
        }),
      ],
    })
  })
  return [headerRow, ...bodyRows]
}

function daysAsRowsRows(model) {
  const n = model.rows.length || 1
  const colWidth = Math.floor(91 / n)
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell('DAY', { bold: true, shade: 'E2E8F0', widthPct: 9 }),
      ...model.rows.map((p) => {
        if (p.kind === 'break') {
          return cell([
            text(p.label, { bold: true, size: 12 }),
            new TextRun({ break: 1 }),
            text(`${p.start}–${p.end}`, { size: 11, color: '555555' }),
          ], { shade: 'F1ECE0', widthPct: colWidth })
        }
        const runs = []
        if (model.labelMode !== 'time') runs.push(text(`P${p.slot}`, { bold: true, size: 14 }))
        if (model.labelMode !== 'period') {
          if (runs.length) runs.push(new TextRun({ break: 1 }))
          runs.push(text(`${p.start}–${p.end}`, { size: 11, color: '555555' }))
        }
        return cell(runs, { shade: 'E2E8F0', widthPct: colWidth })
      }),
    ],
  })

  const bodyRows = model.days.map((day) => new TableRow({
    children: [
      cell(day.toUpperCase(), { bold: true }),
      ...model.rows.map((p) => {
        if (p.kind === 'break') return cell(p.label, { bold: true, shade: 'F1ECE0' })
        const c = cellState(model, day, p.slot)
        if (c.state === 'covered') return null // consumed by the colSpan
        if (c.state === 'off') return cell('—', { shade: 'EFECE3' })
        if (!c.block) return cell('', {})
        const { runs, opts } = blockCellOpts(c.block, c.block.length, 'days-as-rows', dayTimeCaption(model, day, p.slot))
        return cell(runs, opts)
      }).filter(Boolean),
    ],
  }))
  return [headerRow, ...bodyRows]
}

export function buildClassTimetableDocument(timetable, opts = {}) {
  const model = buildTimetableGridModel(timetable, opts.layout ? { layout: opts.layout } : {})
  const h = model?.header || {}

  const rows = model.layout === 'days-as-rows' ? daysAsRowsRows(model) : daysAsColumnsRows(model)
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  })

  return new Document({
    creator: 'zedexams.com',
    title: sanitizeXmlText(`Class Timetable — ${h.className || h.grade || ''}`.trim()),
    description: 'Generated by ZedExams Teacher Tools',
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [{
      ...attributionSection(opts),
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
      children: [...titleBlock(h), table, ...signatureBlock(h)],
    }],
  })
}

export async function downloadClassTimetableDocx(timetable, filename = 'class-timetable.docx', opts = {}) {
  const doc = buildClassTimetableDocument(timetable, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}
