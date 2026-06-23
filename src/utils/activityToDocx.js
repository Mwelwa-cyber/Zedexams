/**
 * Export a Lesson Activity (class exercise or homework) as a Word document.
 * Mirrors homeworkToDocx.js so the look is consistent across the studios.
 *
 * One document per activity: pupil questions (type-aware: MCQ options,
 * matching columns, structured sub-parts, fill-in lines) then, unless
 * `includeAnswers: false`, a teacher answer key with model answers + a
 * marking note.
 */

import { saveBlob } from './saveBlob.js'
import { sanitizeXmlText } from './xmlText.js'
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
import { attributionSection } from './docxAttribution.js'

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '888888' },
}
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function text(str, opts = {}) {
  return new TextRun({ text: sanitizeXmlText(str), ...opts })
}
function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 80 }, ...opts,
  })
}
function h1(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 32 })],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
  })
}
function h2(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 },
  })
}
function bodyPara(str, opts = {}) {
  return new Paragraph({
    children: [text(str, { size: 20, ...opts })], spacing: { after: 60 },
  })
}
function indented(str, opts = {}) {
  return new Paragraph({
    children: [text(str, { size: 20 })],
    indent: { left: 540 }, spacing: { after: 40 }, ...opts,
  })
}
function cell(content, { width, shading } = {}) {
  return new TableCell({
    children: Array.isArray(content) ? content : [content],
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    borders: CELL_BORDER,
    ...(shading ? { shading: { fill: shading } } : {}),
  })
}

function titleCase(s) {
  return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function metadataTable(header) {
  const rows = [
    ['Topic', header.topic],
    ['Sub-topic', header.subtopic],
    ['Grade', header.grade],
    ['Subject', titleCase(header.subject)],
    ['Term', header.term ? `Term ${header.term}` : ''],
    ['Difficulty', titleCase(header.difficulty)],
    ['Time', header.estimatedMinutes ? `${header.estimatedMinutes} min` : ''],
    ['Total marks', header.totalMarks ? String(header.totalMarks) : ''],
  ].filter(([, v]) => v)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({
      children: [
        cell(para(text(k, { bold: true, size: 18 })), { width: 30, shading: 'F3F4F6' }),
        cell(para(text(String(v), { size: 18 })), { width: 70 }),
      ],
    })),
  })
}

// Pupil-facing rendering of one question, type-aware.
function pupilQuestion(q, idx) {
  const children = []
  const n = q.number || idx + 1
  const markLabel = q.marks ? `  [${q.marks}]` : ''
  children.push(new Paragraph({
    children: [text(`${n}. ${q.prompt}${markLabel}`, { size: 20 })],
    spacing: { after: 40 },
  }))

  if (q.type === 'multiple_choice' && Array.isArray(q.options)) {
    q.options.forEach((opt, i) => {
      children.push(indented(`${LETTERS[i] || i + 1}) ${opt}`))
    })
  } else if (q.type === 'true_false') {
    children.push(indented('True   /   False'))
  } else if (q.type === 'matching' && Array.isArray(q.matchPairs)) {
    // Print the right-hand column rotated so the pairs don't line up trivially.
    const lefts = q.matchPairs.map(p => p.left)
    const rights = q.matchPairs.map(p => p.right)
    const shuffled = rights.slice(1).concat(rights.slice(0, 1))
    const rows = lefts.map((l, i) => new TableRow({
      children: [
        cell(para(text(`${i + 1}. ${l}`, { size: 18 })), { width: 50 }),
        cell(para(text(`${LETTERS[i] || i + 1}) ${shuffled[i] || ''}`, { size: 18 })), { width: 50 }),
      ],
    }))
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))
  } else if (q.type === 'structured' && Array.isArray(q.parts) && q.parts.length) {
    q.parts.forEach((p) => {
      const pm = p.marks ? `  [${p.marks}]` : ''
      children.push(indented(`${p.label} ${p.prompt}${pm}`))
    })
  } else {
    // short_answer / fill_in_blank / calculation / essay — leave a blank line.
    children.push(new Paragraph({ children: [text('', { size: 20 })], spacing: { after: 120 } }))
  }
  return children
}

// Teacher answer-key rendering of one question.
function answerKeyQuestion(q, idx, includeModel) {
  const children = []
  const n = q.number || idx + 1

  let answerText = q.answer || '—'
  if (q.type === 'multiple_choice') {
    answerText = q.answer || '—'
  } else if (q.type === 'matching' && Array.isArray(q.matchPairs)) {
    answerText = q.matchPairs.map(p => `${p.left} → ${p.right}`).join('; ')
  } else if (q.type === 'structured' && Array.isArray(q.parts) && q.parts.length) {
    children.push(new Paragraph({
      children: [text(`${n}.`, { bold: true, size: 20 })], spacing: { after: 20 },
    }))
    q.parts.forEach((p) => {
      children.push(indented(`${p.label} ${p.answer || '—'}`, {
        children: [text(`${p.label} ${p.answer || '—'}`, { size: 20 })],
      }))
    })
    if (includeModel && q.modelAnswer) children.push(indented(q.modelAnswer))
    if (q.workingNotes) children.push(indented(q.workingNotes))
    return children
  }

  children.push(new Paragraph({
    children: [
      text(`${n}. `, { bold: true, size: 20 }),
      text(answerText, { size: 20 }),
    ],
    spacing: { after: (q.workingNotes || (includeModel && q.modelAnswer)) ? 20 : 60 },
  }))
  if (includeModel && q.modelAnswer) children.push(indented(q.modelAnswer))
  if (q.workingNotes) {
    children.push(new Paragraph({
      children: [text(q.workingNotes, { italics: true, size: 18 })],
      indent: { left: 540 }, spacing: { after: 60 },
    }))
  }
  return children
}

// Build the document body (children) for one activity. Shared by the
// single-activity document and the combined exercise+homework document.
function activityChildren(activity, opts = {}) {
  const children = []
  const header = activity.header || {}
  const includeModel = opts.includeModelAnswers !== false
  children.push(h1(header.title || (activity.kind === 'homework' ? 'Homework' : 'Class Exercise')))
  children.push(metadataTable(header))
  children.push(para(text(' ', { size: 14 })))

  if (activity.instructions) {
    children.push(bodyPara(activity.instructions, { italics: true }))
  }

  children.push(h2('Questions'))
  ;(activity.questions || []).forEach((q, i) => {
    pupilQuestion(q, i).forEach(node => children.push(node))
  })

  if (activity.kind === 'homework' && activity.parentNote) {
    children.push(h2('Note for Parent / Guardian'))
    children.push(bodyPara(activity.parentNote))
  }

  if (opts.includeAnswers !== false) {
    children.push(h2('Answer Key (teacher)'))
    ;(activity.questions || []).forEach((q, i) => {
      answerKeyQuestion(q, i, includeModel).forEach(node => children.push(node))
    })
    if (activity.answerKey?.markingNotes) {
      children.push(h2('Marking Guide'))
      children.push(bodyPara(activity.answerKey.markingNotes))
    }
  }
  return children
}

export function buildActivityDocument(activity, opts = {}) {
  const header = activity.header || {}
  return new Document({
    creator: 'zedexams.com',
    title: sanitizeXmlText(header.title || 'Lesson activity'),
    description: 'Generated by ZedExams Teacher Tools',
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [{ ...attributionSection(opts), children: activityChildren(activity, opts) }],
  })
}

export async function downloadActivityDocx(activity, filename = 'activity.docx', opts = {}) {
  const doc = buildActivityDocument(activity, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}

/**
 * Build a single Word document containing whichever of the exercise / homework
 * are present in a `{ exercise, homework }` lesson-activities output. Each
 * activity starts on its own page.
 */
export function buildLessonActivitiesDocument(output, opts = {}) {
  const activities = [output?.exercise, output?.homework].filter(Boolean)
  const sections = activities.map((activity, i) => ({
    ...attributionSection(opts),
    // Page break before every activity after the first.
    ...(i > 0 ? { properties: { type: 'nextPage' } } : {}),
    children: activityChildren(activity, opts),
  }))
  return new Document({
    creator: 'zedexams.com',
    title: 'Lesson activities',
    description: 'Generated by ZedExams Teacher Tools',
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: sections.length ? sections : [{ ...attributionSection(opts), children: [] }],
  })
}

export async function downloadLessonActivitiesDocx(output, filename = 'lesson-activities.docx', opts = {}) {
  const doc = buildLessonActivitiesDocument(output, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}
