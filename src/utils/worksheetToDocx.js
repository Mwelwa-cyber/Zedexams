/**
 * Converts a validated worksheet JSON object into a Word (.docx) file.
 *
 * Two output modes:
 *   - 'worksheet' (default): pupil-facing, no answers shown.
 *   - 'answer_key': teacher-facing, includes answers and marking notes after
 *     each question.
 *
 * Uses the `docx` package. Same pattern as lessonPlanToDocx.js.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '888888' },
}

function text(str, opts = {}) {
  return new TextRun({ text: str == null ? '' : String(str), ...opts })
}

function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 120 },
    ...opts,
  })
}

function h1(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 32 })],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  })
}

function h2(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 120 },
  })
}

function labelCell(label) {
  return new TableCell({
    children: [para(text(label, { bold: true, size: 20 }))],
    width: { size: 30, type: WidthType.PERCENTAGE },
    borders: CELL_BORDER,
    shading: { fill: 'f3f4f6' },
  })
}

function valueCell(value) {
  return new TableCell({
    children: [para(text(value, { size: 20 }))],
    width: { size: 70, type: WidthType.PERCENTAGE },
    borders: CELL_BORDER,
  })
}

function headerTable(header) {
  const rows = [
    ['Title', header.title],
    ['Subject', header.subject],
    ['Grade', header.grade],
    ['Topic', header.topic],
    ['Sub-topic', header.subtopic],
    ['Duration', header.duration],
    ['Total marks', `${header.totalMarks}`],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({
      children: [labelCell(k), valueCell(String(v))],
    })),
  })
}

function nameBlock() {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [para(text("Pupil's Name: ____________________________________________", { size: 20 }))],
            borders: CELL_BORDER,
          }),
          new TableCell({
            children: [para(text("Class: __________", { size: 20 }))],
            borders: CELL_BORDER,
          }),
          new TableCell({
            children: [para(text('Score: ______ / ______', { size: 20 }))],
            borders: CELL_BORDER,
          }),
        ],
      }),
    ],
  })
}

function renderQuestion(q, {includeAnswer}) {
  const blocks = []
  const marksTag = `  [${q.marks} mark${q.marks === 1 ? '' : 's'}]`

  blocks.push(new Paragraph({
    children: [
      text(`${q.number}. `, { bold: true, size: 22 }),
      text(q.prompt, { size: 22 }),
      text(marksTag, { size: 18, color: '6b7280', italics: true }),
    ],
    spacing: { before: 160, after: 80 },
  }))

  if (q.type === 'multiple_choice' || q.type === 'true_false') {
    const letters = ['A', 'B', 'C', 'D', 'E']
    ;(q.options || []).forEach((opt, i) => {
      blocks.push(new Paragraph({
        children: [
          text(`   ${letters[i] || '•'}. `, { bold: true, size: 20 }),
          text(opt, { size: 20 }),
        ],
        spacing: { after: 40 },
      }))
    })
  } else if (q.type === 'fill_in_blank' || q.type === 'short_answer') {
    blocks.push(para(text('Answer: ______________________________________________________', { size: 20 })))
  } else if (q.type === 'calculation') {
    blocks.push(para(text('Working:', { bold: true, size: 20 })))
    blocks.push(para(text(' ', { size: 20 })))
    blocks.push(para(text(' ', { size: 20 })))
    blocks.push(para(text('Answer: ______________________________________', { size: 20 })))
  } else if (q.type === 'essay') {
    for (let i = 0; i < 6; i++) {
      blocks.push(para(text('______________________________________________________________________________', { size: 20 })))
    }
  }

  if (includeAnswer && q.answer) {
    blocks.push(new Paragraph({
      children: [
        text('✓ Answer: ', { bold: true, size: 20, color: '059669' }),
        text(q.answer, { size: 20, color: '059669' }),
      ],
      spacing: { before: 80 },
    }))
    if (q.workingNotes) {
      blocks.push(new Paragraph({
        children: [
          text('   Notes: ', { bold: true, size: 18, color: '6b7280' }),
          text(q.workingNotes, { size: 18, color: '6b7280', italics: true }),
        ],
        spacing: { after: 80 },
      }))
    }
  }

  return blocks
}

/**
 * @param {object} worksheet  validated worksheet JSON
 * @param {'worksheet'|'answer_key'} mode
 */
export function buildWorksheetDocument(worksheet, {mode = 'worksheet'} = {}) {
  const includeAnswer = mode === 'answer_key'
  const children = []

  children.push(h1(includeAnswer ? 'WORKSHEET — ANSWER KEY' : 'WORKSHEET'))
  children.push(headerTable(worksheet.header || {}))
  if (!includeAnswer) {
    children.push(para([]))
    children.push(nameBlock())
  }

  if (worksheet.header?.instructions) {
    children.push(para([]))
    children.push(para(text(worksheet.header.instructions, { italics: true, size: 20 })))
  }

  for (const section of worksheet.sections || []) {
    children.push(h2(section.title))
    if (section.instructions) {
      children.push(para(text(section.instructions, { italics: true, size: 20 })))
    }
    for (const q of section.questions || []) {
      children.push(...renderQuestion(q, {includeAnswer}))
    }
  }

  if (includeAnswer && worksheet.answerKey?.markingNotes) {
    children.push(h2('Marking Guidance'))
    children.push(para(text(worksheet.answerKey.markingNotes, { size: 20 })))
    children.push(para([
      text('Total marks: ', { bold: true, size: 20 }),
      text(String(worksheet.answerKey.totalMarks || worksheet.header?.totalMarks || 0), { size: 20 }),
    ]))
  }

  return new Document({
    creator: 'zedexams.com',
    title: worksheet.header?.title || 'Worksheet',
    description: 'Generated by ZedExams Teacher Tools',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 20 } },
      },
    },
    sections: [{ children }],
  })
}

export async function downloadWorksheetDocx(worksheet, filename = 'worksheet.docx', opts = {}) {
  const doc = buildWorksheetDocument(worksheet, opts)
  const blob = await Packer.toBlob(doc)
  try {
    const { saveAs } = await import('file-saver')
    saveAs(blob, filename)
    return
  } catch { /* fall through */ }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
