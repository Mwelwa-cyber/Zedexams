/**
 * Export a teacher-private assessment to a Word (.docx) file.
 *
 * Two output modes:
 *   - 'paper'  (default): the printable assessment paper for pupils.
 *                         Cover page + numbered questions, no answers.
 *   - 'scheme': the marking scheme for the teacher.
 *                         Same cover (re-titled) + every question with its
 *                         correct answer and explanation/working notes.
 *
 * Mirrors the docx-library pattern used by `worksheetToDocx.js` so the two
 * exports look visually consistent. Question rich text comes from the
 * Quiz/Assessment editor as HTML — we run it through `richTextToPlainText`
 * before emitting (DOCX cells need plain text, not markup).
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
import { richTextToPlainText } from './quizRichText.js'

const ASSESSMENT_TYPE_LABELS = {
  weekly: 'Weekly Test',
  monthly: 'Monthly Test',
  mid_term: 'Mid-term Test',
  end_of_term: 'End-of-term Test',
  topic: 'Topic Test',
  mock: 'Mock Exam',
  diagnostic: 'Diagnostic / Baseline',
  pre_test: 'Pre-test',
  post_test: 'Post-test',
  revision: 'Revision Test',
  continuous: 'Continuous Assessment',
  summative: 'Summative Assessment',
  practical: 'Practical Assessment',
  oral: 'Oral Assessment',
  project: 'Project-based Assessment',
}

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
    children: [text(str, { bold: true, size: 26 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 140 },
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

function coverTable(assessment) {
  const rows = [
    ['School',          assessment.schoolName],
    ['Class',           assessment.className],
    ['Subject',         assessment.subject],
    ['Grade',           assessment.grade ? `Grade ${assessment.grade}` : ''],
    ['Term',            assessment.term ? `Term ${assessment.term}` : ''],
    ['Date',            assessment.assessmentDate],
    ['Duration',        assessment.duration ? `${assessment.duration} minutes` : ''],
    ['Total marks',     assessment.totalMarks != null ? String(assessment.totalMarks) : ''],
    ['Topic',           assessment.topic],
  ].filter(([, v]) => v != null && String(v).trim() !== '')

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
            children: [para(text("Score: ______ / ______", { size: 20 }))],
            borders: CELL_BORDER,
          }),
        ],
      }),
    ],
  })
}

/**
 * Group every question by its part/section so we can emit Section A / B / C
 * headers with the running mark total for that section.
 */
function groupByPart(questions, parts) {
  const partsById = new Map()
  for (const part of parts || []) {
    partsById.set(part.id, { ...part, questions: [] })
  }
  const standalone = { id: null, title: '', questions: [] }
  for (const q of questions || []) {
    const partId = q.partId || null
    if (partId && partsById.has(partId)) {
      partsById.get(partId).questions.push(q)
    } else {
      standalone.questions.push(q)
    }
  }
  const ordered = [...partsById.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return standalone.questions.length ? [standalone, ...ordered] : ordered
}

function partMarksTotal(part) {
  return (part.questions || []).reduce((s, q) => s + (q.marks || 1), 0)
}

function letterFor(index) {
  return String.fromCharCode(65 + index) // A, B, C…
}

function renderQuestion(q, number, { includeAnswer }) {
  const blocks = []
  const promptText = richTextToPlainText(q.text || '') || '(no question text)'
  const marksTag = `  [${q.marks ?? 1} mark${(q.marks ?? 1) === 1 ? '' : 's'}]`

  blocks.push(new Paragraph({
    children: [
      text(`${number}. `, { bold: true, size: 22 }),
      text(promptText, { size: 22 }),
      text(marksTag, { size: 18, color: '6b7280', italics: true }),
    ],
    spacing: { before: 160, after: 80 },
  }))

  const type = q.type || 'mcq'

  if (type === 'mcq' || type === 'tf') {
    const options = Array.isArray(q.options) ? q.options : []
    options.forEach((opt, i) => {
      const isCorrect = includeAnswer && Number(q.correctAnswer) === i
      blocks.push(new Paragraph({
        children: [
          text(`   ${letterFor(i)}. `, { bold: true, size: 20, color: isCorrect ? '059669' : undefined }),
          text(String(opt ?? ''), { size: 20, color: isCorrect ? '059669' : undefined, bold: isCorrect }),
          isCorrect ? text('  ✓', { size: 20, color: '059669', bold: true }) : text(''),
        ],
        spacing: { after: 40 },
      }))
    })
  } else if (type === 'short_answer' || type === 'short' || type === 'fill') {
    if (!includeAnswer) {
      blocks.push(para(text('Answer: ______________________________________________________', { size: 20 })))
      blocks.push(para(text('         ______________________________________________________', { size: 20 })))
    } else {
      blocks.push(new Paragraph({
        children: [
          text('✓ Answer: ', { bold: true, size: 20, color: '059669' }),
          text(String(q.correctAnswer ?? ''), { size: 20, color: '059669' }),
        ],
        spacing: { before: 60, after: 60 },
      }))
    }
  } else if (type === 'diagram') {
    if (!includeAnswer) {
      // Reserve space for pupil to draw / label
      for (let i = 0; i < 4; i++) {
        blocks.push(para(text(' ', { size: 20 })))
      }
    } else {
      blocks.push(new Paragraph({
        children: [
          text('✓ Expected answer: ', { bold: true, size: 20, color: '059669' }),
          text(String(q.correctAnswer ?? ''), { size: 20, color: '059669' }),
        ],
        spacing: { before: 60, after: 60 },
      }))
    }
  }

  if (includeAnswer) {
    const explanation = richTextToPlainText(q.explanation || '')
    if (explanation) {
      blocks.push(new Paragraph({
        children: [
          text('   Notes: ', { bold: true, size: 18, color: '6b7280' }),
          text(explanation, { size: 18, color: '6b7280', italics: true }),
        ],
        spacing: { after: 80 },
      }))
    }
  }

  return blocks
}

export function buildAssessmentDocument(assessment, questions, { mode = 'paper' } = {}) {
  const includeAnswer = mode === 'scheme'
  const children = []
  const typeLabel = ASSESSMENT_TYPE_LABELS[assessment.assessmentType] || 'Assessment'
  const titleLine = assessment.title || typeLabel

  // Cover page
  children.push(h1(includeAnswer ? `MARKING SCHEME — ${titleLine}` : titleLine))
  children.push(new Paragraph({
    children: [text(typeLabel.toUpperCase(), { bold: true, size: 22, color: '6b7280' })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }))
  children.push(coverTable(assessment))

  if (!includeAnswer) {
    children.push(para([]))
    children.push(nameBlock())
  }

  if (assessment.coverInstructions) {
    children.push(para([]))
    children.push(new Paragraph({
      children: [text('Instructions: ', { bold: true, size: 22 })],
      spacing: { after: 60 },
    }))
    children.push(para(text(assessment.coverInstructions, { size: 20, italics: true })))
  }

  // Questions, grouped by section/part
  const sortedQs = [...(questions || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const groups = groupByPart(sortedQs, assessment.parts || [])
  let runningNumber = 0

  if (groups.length === 0) {
    children.push(para([]))
    children.push(para(text('(This assessment has no questions yet.)', { size: 20, italics: true, color: '6b7280' })))
  }

  for (const group of groups) {
    const isUnsectioned = !group.id
    if (!isUnsectioned) {
      const total = partMarksTotal(group)
      const heading = group.title
        ? `${group.title} — ${total} mark${total === 1 ? '' : 's'}`
        : `Section — ${total} mark${total === 1 ? '' : 's'}`
      children.push(h2(heading))
    }
    for (const q of group.questions) {
      runningNumber += 1
      children.push(...renderQuestion(q, runningNumber, { includeAnswer }))
    }
  }

  if (includeAnswer) {
    children.push(h2('Total'))
    children.push(para([
      text('Total marks: ', { bold: true, size: 22 }),
      text(String(assessment.totalMarks || 0), { size: 22 }),
    ]))
  }

  return new Document({
    creator: 'zedexams.com',
    title: includeAnswer ? `${titleLine} — Marking Scheme` : titleLine,
    description: 'Generated by ZedExams Assessment Studio',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
    },
    sections: [{ children }],
  })
}

export async function downloadAssessmentDocx(assessment, questions, filename = 'assessment.docx', opts = {}) {
  const doc = buildAssessmentDocument(assessment, questions, opts)
  const blob = await Packer.toBlob(doc)
  try {
    const { saveAs } = await import('file-saver')
    saveAs(blob, filename)
    return
  } catch { /* fall through to manual download */ }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
