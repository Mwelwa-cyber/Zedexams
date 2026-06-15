/**
 * Export one ECZ School Based Assessment task as a Word document: the metadata
 * block, the teacher's administration instructions, the stimulus (passage /
 * data / method), the numbered sub-tasks, and the marking scheme in whatever
 * shape the task's marking style requires (answer key, observation sheet,
 * method marks, or a rubric/criteria table).
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
import { attributionSection } from './docxAttribution.js'

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
    spacing: { after: 60 },
    ...opts,
  })
}

function h1(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 30 })],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
  })
}

function sectionHeading(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 22, color: '0e2a32' })],
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'cccccc' } },
  })
}

function cell(content, { width, shading, bold, size = 18 } = {}) {
  const paras = Array.isArray(content) ? content : [para(text(content, { size, bold }))]
  return new TableCell({
    children: paras,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    borders: CELL_BORDER,
    ...(shading ? { shading: { fill: shading } } : {}),
  })
}

function metadataTable(header = {}) {
  const rows = [
    ['Grade', header.grade],
    ['Subject', header.subject],
    ['Task type', header.taskType],
    ['CTS component', header.component],
    ['Language skill', header.skill],
    ['Term', header.term],
    ['Duration', header.duration],
    ['Bloom level(s)', (header.bloomLevels || []).join(', ')],
    ['Syllabus outcome(s)', (header.outcomeRefs || []).join(', ')],
    ['Total marks', header.totalMarks != null ? String(header.totalMarks) : ''],
  ].filter(([, v]) => v)
  return new Table({
    width: { size: 70, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({
      children: [
        cell(para(text(k, { bold: true, size: 18 })), { width: 32, shading: 'F3F4F6' }),
        cell(para(text(v, { size: 18 })), { width: 68 }),
      ],
    })),
  })
}

function questionBlocks(questions = [], { includeAnswers = true } = {}) {
  const out = []
  questions.forEach((q) => {
    out.push(new Paragraph({
      spacing: { before: 120, after: 40 },
      children: [
        text(`${q.number}. `, { bold: true, size: 20 }),
        text(q.prompt, { size: 20 }),
        text(q.marks ? `   [${q.marks}]` : '', { bold: true, size: 18, color: '6b7280' }),
      ],
    }))
    if (includeAnswers && q.answer) {
      out.push(new Paragraph({
        spacing: { after: 40 },
        indent: { left: 360 },
        children: [
          text('Answer: ', { bold: true, size: 18, color: '047857' }),
          text(q.answer, { size: 18, color: '047857' }),
        ],
      }))
    }
    if (includeAnswers && Array.isArray(q.markAllocation) && q.markAllocation.length) {
      q.markAllocation.forEach((m) => {
        out.push(new Paragraph({
          spacing: { after: 20 },
          indent: { left: 600 },
          bullet: { level: 0 },
          children: [
            text(m.description, { size: 16 }),
            text(m.marks ? `  (${m.marks})` : '', { bold: true, size: 16, color: '6b7280' }),
          ],
        }))
      })
    }
  })
  return out
}

function criteriaTable(criteria = []) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      cell(para(text('Marking criterion', { bold: true, size: 18 })), { width: 40, shading: 'E2E8F0' }),
      cell(para(text('Marks', { bold: true, size: 18 })), { width: 12, shading: 'E2E8F0' }),
      cell(para(text('What earns the marks', { bold: true, size: 18 })), { width: 48, shading: 'E2E8F0' }),
    ],
  })
  const rows = criteria.map((c) => new TableRow({
    children: [
      cell(para(text(c.name, { bold: true, size: 18 })), { width: 40 }),
      cell(para(text(String(c.maxMarks), { bold: true, size: 18 })), { width: 12 }),
      cell(para(text(c.descriptor || '—', { size: 18 })), { width: 48 }),
    ],
  }))
  const total = criteria.reduce((s, c) => s + (Number(c.maxMarks) || 0), 0)
  const totalRow = new TableRow({
    children: [
      cell(para(text('Total', { bold: true, size: 18 })), { width: 40, shading: 'F8FAFC' }),
      cell(para(text(String(total), { bold: true, size: 18 })), { width: 12, shading: 'F8FAFC' }),
      cell(para(text('', { size: 18 })), { width: 48, shading: 'F8FAFC' }),
    ],
  })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...rows, totalRow],
  })
}

export function buildSbaTaskDocument(task, opts = {}) {
  const { includeAnswers = true } = opts
  const header = task.header || {}
  const ms = task.markingScheme || {}
  const children = []

  children.push(h1(header.title || 'School Based Assessment Task'))
  children.push(para(text('School Based Assessment (SBA) — Examinations Council of Zambia', {
    italics: true, size: 16, color: '6b7280',
  }), { alignment: AlignmentType.CENTER, spacing: { after: 160 } }))
  children.push(metadataTable(header))

  if (task.instructions) {
    children.push(sectionHeading('Teacher’s instructions'))
    children.push(para(text(task.instructions, { size: 20 })))
  }

  if (task.stimulus) {
    children.push(sectionHeading('Stimulus'))
    task.stimulus.split(/\n+/).forEach((line) => {
      if (line.trim()) children.push(para(text(line.trim(), { size: 20 })))
    })
  }

  if (Array.isArray(task.questions) && task.questions.length) {
    children.push(sectionHeading(includeAnswers ? 'Tasks and marking' : 'Tasks'))
    questionBlocks(task.questions, { includeAnswers }).forEach((p) => children.push(p))
  }

  // The marking scheme: criteria table for rubric/observation styles, plus the
  // overall notes. (Method/answer-key marks already render under each task.)
  if (includeAnswers) {
    const hasCriteria = Array.isArray(ms.criteria) && ms.criteria.length
    if (hasCriteria || ms.notes) {
      children.push(sectionHeading('Marking scheme'))
      if (ms.notes) children.push(para(text(ms.notes, { size: 18 })))
      if (hasCriteria) {
        children.push(para(text(' ', { size: 8 })))
        children.push(criteriaTable(ms.criteria))
      }
    }
  }

  return new Document({
    creator: 'zedexams.com',
    title: header.title || 'SBA Task',
    description: 'Generated by ZedExams Teacher Tools',
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [{
      ...attributionSection(opts),
      children,
    }],
  })
}

export async function downloadSbaTaskDocx(task, filename = 'sba-task.docx', opts = {}) {
  const doc = buildSbaTaskDocument(task, opts)
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
