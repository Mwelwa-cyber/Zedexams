/**
 * attendanceToDocx — Word export for the Class Register Studio (term
 * attendance summary + individual learner report), built on the same `docx`
 * library as the other exporters and the same export model as the HTML/PDF
 * paths, so totals always match the screen.
 */

import {
  AlignmentType,
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
import { saveBlob } from '../../utils/saveBlob.js'
import { formatPercent, computeLearnerTotals } from '../../utils/attendanceCalculator.js'
import { formatDateLong } from '../../utils/attendanceCalendarResolver.js'

function cell(text, { bold = false, align = AlignmentType.CENTER } = {}) {
  return new TableCell({
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text: String(text ?? ''), bold, size: 18 })],
    })],
  })
}

function headingBlock(model, title) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: model.school.name.toUpperCase(), bold: true, size: 30 })],
    }),
    ...(model.school.address ? [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: model.school.address, size: 20 })],
    })] : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: title, bold: true, size: 24 })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({
        text: `Academic year: ${model.academicYear}   ·   Term: ${model.termLabel}   ·   Class: ${model.className}   ·   Class teacher: ${model.teacherName || '—'}`,
        size: 20,
      })],
    }),
  ]
}

function signatureBlock(model) {
  return [
    new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: 'Class teacher signature: ____________________________', size: 20 })] }),
    new Paragraph({ children: [new TextRun({ text: 'Headteacher signature: ____________________________', size: 20 })] }),
    new Paragraph({ children: [new TextRun({ text: `Date printed: ${model.printedOn ? formatDateLong(model.printedOn) : '____________'}`, size: 20 })] }),
  ]
}

/** Term attendance summary — landscape, one learner per row. */
export async function downloadTermSummaryDocx(model, filename = 'attendance-summary.docx') {
  const header = new TableRow({
    tableHeader: true,
    children: ['No.', 'Adm No.', 'Learner name', 'Gender', 'Eligible', 'Present', 'Absent', 'Sick', 'Late', 'Excused', 'Unmarked', '%']
      .map((h) => cell(h, { bold: true })),
  })
  const rows = model.learners.map(({ learner, position, totals }) => new TableRow({
    children: [
      cell(position),
      cell(learner.learnerNumber || ''),
      cell(learner.fullName, { align: AlignmentType.LEFT }),
      cell(learner.gender || ''),
      cell(totals.eligibleDays),
      cell(totals.presentDays),
      cell(totals.absentDays),
      cell(totals.sickDays),
      cell(totals.lateDays),
      cell(totals.excusedDays),
      cell(totals.unmarkedDays),
      cell(formatPercent(totals.attendancePercentage), { bold: true }),
    ],
  }))
  const s = model.summary
  const totalsRow = new TableRow({
    children: [
      cell('', {}), cell('', {}),
      cell('CLASS TOTALS', { bold: true, align: AlignmentType.LEFT }),
      cell('', {}),
      cell(s.possibleAttendance, { bold: true }),
      cell(`Actual: ${s.actualAttendance}`, { bold: true }),
      cell(`Abs: ${s.totalAbsences}`, { bold: true }),
      cell(`Sick: ${s.totalSickDays}`, { bold: true }),
      cell('', {}), cell('', {}), cell('', {}),
      cell(formatPercent(s.averageAttendancePercentage), { bold: true }),
    ],
  })

  const doc = new Document({
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
      children: [
        ...headingBlock(model, 'TERM ATTENDANCE SUMMARY'),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...rows, totalsRow] }),
        ...signatureBlock(model),
      ],
    }],
  })
  const blob = await Packer.toBlob(doc)
  return saveBlob(blob, filename)
}

/** Individual learner report — portrait with a monthly breakdown. */
export async function downloadLearnerReportDocx(model, learnerId, filename, { comment = '' } = {}) {
  const row = model.learners.find((l) => l.learner.id === learnerId)
  if (!row) throw new Error('Learner not found in this register.')
  const { learner, totals } = row

  const header = new TableRow({
    tableHeader: true,
    children: ['Month', 'Eligible', 'Present', 'Absent', 'Sick', 'Late', 'Excused', '%'].map((h) => cell(h, { bold: true })),
  })
  const monthRows = model.months.map((month) => {
    const t = computeLearnerTotals({ learner, days: month.days, term: model.termWindow })
    return new TableRow({
      children: [
        cell(month.label, { align: AlignmentType.LEFT }),
        cell(t.eligibleDays), cell(t.presentDays), cell(t.absentDays),
        cell(t.sickDays), cell(t.lateDays), cell(t.excusedDays),
        cell(formatPercent(t.attendancePercentage)),
      ],
    })
  })
  const termRow = new TableRow({
    children: [
      cell('Term total', { bold: true, align: AlignmentType.LEFT }),
      cell(totals.eligibleDays, { bold: true }), cell(totals.presentDays, { bold: true }),
      cell(totals.absentDays, { bold: true }), cell(totals.sickDays, { bold: true }),
      cell(totals.lateDays, { bold: true }), cell(totals.excusedDays, { bold: true }),
      cell(formatPercent(totals.attendancePercentage), { bold: true }),
    ],
  })

  const doc = new Document({
    sections: [{
      children: [
        ...headingBlock(model, 'LEARNER ATTENDANCE REPORT'),
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun({
            text: `Learner: ${learner.fullName}   ·   Admission no.: ${learner.learnerNumber || '—'}   ·   Gender: ${learner.gender || '—'}`,
            size: 20,
          })],
        }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...monthRows, termRow] }),
        new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: 'Teacher comment:', bold: true, size: 20 })] }),
        new Paragraph({ children: [new TextRun({ text: comment || ' ', size: 20 })] }),
        ...signatureBlock(model),
      ],
    }],
  })
  const blob = await Packer.toBlob(doc)
  return saveBlob(blob, filename || `attendance-report-${learner.fullName.replace(/\s+/g, '-').toLowerCase()}.docx`)
}
