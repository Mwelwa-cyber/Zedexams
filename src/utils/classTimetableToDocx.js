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
import {
  buildTimetableGridModel,
  dayRowForSlot,
  resolveDayCell,
  cellTextFor,
  subjectTintMap,
} from './timetableGridModel.js'
import {
  resolvePrintSettings,
  verticalBandLetters,
  officialTimetableTitle,
  MINISTRY_HEADER_TEXT,
} from './timetablePrintTemplates.js'
import { buildAbbreviationLegend, legendLine } from './subjectAbbreviations.js'

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

function titleBlock(h, settings) {
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  const lines = []
  const official = settings.template.id === 'government'
  const centre = (runs, spacing) => new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    alignment: AlignmentType.CENTER,
    spacing,
  })

  if (official) {
    // The Ministry format: underlined header lines, plain, no colour, and
    // the title written the official way — grade in words AND numeral.
    if (settings.ministryHeader) {
      lines.push(centre(text(MINISTRY_HEADER_TEXT, { bold: true, size: 26, underline: {} }), { after: 40 }))
    }
    if (h.school) {
      lines.push(centre(text(h.school, { bold: true, size: 24, underline: {} }), { after: 40 }))
    }
    lines.push(centre(
      text(officialTimetableTitle({ grade: h.grade, className: h.className }), { bold: true, size: 28, underline: {} }),
      { after: 40 },
    ))
    const meta = [h.term && `TERM ${h.term}`, h.year && String(h.year)].filter(Boolean).join('   ·   ')
    lines.push(meta
      ? centre(text(meta, { bold: true, size: 20 }), { after: 160 })
      : centre(text(' ', { size: 8 }), { after: 120 }))
    return lines
  }

  if (h.school) lines.push(centre(text(h.school, { bold: true, size: 24 }), { after: 40 }))
  lines.push(centre(text('CLASS TIMETABLE', { bold: true, size: 28 }), { after: 40 }))
  const meta = [
    h.className && String(h.className).trim(),
    gradeLabel && `Grade ${gradeLabel}`,
    h.term && `Term ${h.term}`,
    h.year && String(h.year),
  ].filter(Boolean).join('   ·   ')
  if (meta) lines.push(centre(text(meta, { bold: true, size: 20 }), { after: 40 }))
  lines.push(h.teacherName
    ? centre(text(`Class teacher: ${h.teacherName}`, { size: 18 }), { after: 160 })
    : centre(text(' ', { size: 8 }), { after: 120 }))
  return lines
}

/** The abbreviation key printed under an abbreviated grid. */
function legendBlock(model, settings) {
  if (!settings.showLegend) return []
  const entries = buildAbbreviationLegend(
    model.subjectAllocations?.length ? model.subjectAllocations : model.subjects.map((label) => ({ label })),
    new Set(model.subjects),
  )
  if (!entries.length) return []
  return [new Paragraph({
    children: [text('KEY: ', { bold: true, size: 16 }), text(legendLine(entries), { size: 16 })],
    spacing: { before: 160 },
  })]
}

function signatureBlock(h, settings) {
  if (settings.signatures) {
    // Signature lines and a clear space for the school stamp — what makes
    // this an official document rather than a printout. The rules are drawn
    // as a bordered table so Word keeps them on the page.
    const line = (label) => new TableCell({
      children: [
        new Paragraph({ children: [text(' ', { size: 18 })], spacing: { before: 320 } }),
        new Paragraph({ children: [text(label, { size: 16 })] }),
      ],
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
      width: { size: 33, type: WidthType.PERCENTAGE },
    })
    const underlined = (label) => new TableCell({
      children: [
        new Paragraph({ children: [text(' ', { size: 18 })], spacing: { before: 320 } }),
        new Paragraph({ children: [text(label, { size: 16 })] }),
      ],
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
      width: { size: 33, type: WidthType.PERCENTAGE },
    })
    return [
      new Paragraph({ children: [text(' ', { size: 12 })], spacing: { before: 240 } }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({
          children: [
            underlined(h.teacherName ? `Class teacher: ${h.teacherName}` : 'Class teacher'),
            underlined('Senior teacher / Head'),
            line('School stamp'),
          ],
        })],
      }),
    ]
  }
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
function blockCellOpts(model, block, span, layout, caption, settings, tints) {
  const isActivity = block.type === 'school-activity'
  const runs = [text(cellTextFor(model, block.label, settings.cellText), { bold: !isActivity, italics: isActivity })]
  if (span > 1) {
    runs.push(new TextRun({ break: 1 }))
    runs.push(text('DOUBLE PERIOD', { size: 12, color: '666666' }))
  }
  if (caption) {
    runs.push(new TextRun({ break: 1 }))
    runs.push(text(caption, { size: 12, color: '888888' }))
  }
  const shade = settings.colour
    ? (isActivity ? 'F6F3EA' : (tints[block.label] || '').replace('#', '').toUpperCase() || null)
    : null
  return {
    runs,
    opts: {
      ...(shade ? { shade } : {}),
      ...(span > 1 && layout === 'days-as-rows' ? { colSpan: span } : {}),
    },
  }
}

/** A day that has a non-teaching row where the other days have a lesson —
 * the assembly occupying Period 1 on Monday only. */
function dayBandCell(label, settings) {
  return cell(label, { bold: true, ...(settings.colour ? { shade: 'F1ECE0' } : {}) })
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

function daysAsColumnsRows(model, settings, tints) {
  const dayWidth = model.days.length ? Math.floor(86 / model.days.length) : 86
  const headShade = settings.colour ? 'E2E8F0' : undefined
  const bandShade = settings.colour ? 'F1ECE0' : undefined
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell('TIME', { bold: true, shade: headShade, widthPct: 14 }),
      ...model.days.map((d) => cell(d.toUpperCase(), { bold: true, shade: headShade, widthPct: dayWidth })),
    ],
  })

  const bodyRows = model.rows.map((p) => {
    if (p.kind === 'break') {
      return new TableRow({
        children: [
          cell(`${p.start}–${p.end}`, { bold: true }),
          cell(p.label, { bold: true, shade: bandShade, colSpan: model.days.length || 1 }),
        ],
      })
    }
    return new TableRow({
      children: [
        cell(timeLabelRuns(model, p), {}),
        ...model.days.map((d) => {
          const c = resolveDayCell(model, d, p)
          if (c.state === 'covered') {
            // Word merges vertically: continuation cells carry CONTINUE.
            return cell('', { verticalMerge: VerticalMergeType.CONTINUE })
          }
          if (c.state === 'off') return cell('—', { shade: settings.colour ? 'EFECE3' : undefined })
          if (c.state === 'band') return dayBandCell(c.bandLabel, settings)
          if (!c.block) return cell('', {})
          const slot = c.row?.slot ?? p.slot
          const { runs, opts } = blockCellOpts(
            model, c.block, c.block.length, 'days-as-columns', dayTimeCaption(model, d, slot), settings, tints,
          )
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

function daysAsRowsRows(model, settings, tints) {
  const n = model.rows.length || 1
  const colWidth = Math.floor(91 / n)
  const headShade = settings.colour ? 'E2E8F0' : undefined
  const bandShade = settings.colour ? 'F1ECE0' : undefined
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell('DAY', { bold: true, shade: headShade, widthPct: 9 }),
      ...model.rows.map((p) => {
        if (p.kind === 'break') {
          return cell([
            text(p.label, { bold: true, size: 12 }),
            new TextRun({ break: 1 }),
            text(`${p.start}–${p.end}`, { size: 11, color: '555555' }),
          ], { shade: bandShade, widthPct: colWidth })
        }
        const runs = []
        if (model.labelMode !== 'time') runs.push(text(`P${p.slot}`, { bold: true, size: 14 }))
        if (model.labelMode !== 'period') {
          if (runs.length) runs.push(new TextRun({ break: 1 }))
          runs.push(text(`${p.start}–${p.end}`, { size: 11, color: '555555' }))
        }
        return cell(runs, { shade: headShade, widthPct: colWidth })
      }),
    ],
  })

  // BREAK spelled one letter per day-row down its own column.
  const bandLetters = new Map()
  if (settings.spellBands) {
    for (const p of model.rows) {
      if (p.kind === 'break') bandLetters.set(p.id, verticalBandLetters(p.label, model.days.length))
    }
  }

  const bodyRows = model.days.map((day, dayIndex) => new TableRow({
    children: [
      cell(day.toUpperCase(), { bold: true }),
      ...model.rows.map((p) => {
        if (p.kind === 'break') {
          const letters = bandLetters.get(p.id)
          if (letters) return cell(letters[dayIndex] || '', { bold: true, shade: bandShade })
          return cell(p.label, { bold: true, shade: bandShade })
        }
        const c = resolveDayCell(model, day, p)
        if (c.state === 'covered') return null // consumed by the colSpan
        if (c.state === 'off') return cell('—', { shade: settings.colour ? 'EFECE3' : undefined })
        if (c.state === 'band') return dayBandCell(c.bandLabel, settings)
        if (!c.block) return cell('', {})
        const slot = c.row?.slot ?? p.slot
        const { runs, opts } = blockCellOpts(
          model, c.block, c.block.length, 'days-as-rows', dayTimeCaption(model, day, slot), settings, tints,
        )
        return cell(runs, opts)
      }).filter(Boolean),
    ],
  }))
  return [headerRow, ...bodyRows]
}

export function buildClassTimetableDocument(timetable, opts = {}) {
  const model = buildTimetableGridModel(timetable)
  const settings = resolvePrintSettings(model, opts)
  // `opts.layout` is the explicit caller override (the library view's own
  // toggle); otherwise the print template + preference decide.
  model.layout = opts.layout || settings.layout
  const h = model?.header || {}
  const tints = settings.colour ? subjectTintMap(model) : {}

  const rows = model.layout === 'days-as-rows'
    ? daysAsRowsRows(model, settings, tints)
    : daysAsColumnsRows(model, settings, tints)
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
      children: [
        ...titleBlock(h, settings),
        table,
        ...legendBlock(model, settings),
        ...signatureBlock(h, settings),
      ],
    }],
  })
}

export async function downloadClassTimetableDocx(timetable, filename = 'class-timetable.docx', opts = {}) {
  const doc = buildClassTimetableDocument(timetable, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}
