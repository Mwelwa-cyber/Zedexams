/**
 * Export one ECZ School Based Assessment task as a Word document.
 *
 * The task sheet itself is rendered through the SAME paper-layout blocks the
 * Assessment Studio uses (buildSbaPaperBlocks → renderPaperBlocksToDocx), so a
 * downloaded SBA paper looks like the in-studio preview and a real exam paper —
 * marble-style banner, NAME/DATE/CLASS, instructions, numbered tasks with ruled
 * answer space, "END OF PAPER" and a footer code.
 *
 * The teacher copy (`includeAnswers`) appends the marking scheme on a new page:
 * model answers + per-step mark allocation, the rubric/criteria table, and the
 * teacher-only metadata (task type, Bloom levels, syllabus outcomes).
 */

import { saveBlob } from '../../utils/saveBlob.js'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { buildSbaPaperBlocks } from '../../shared/utils/sbaTaskToPaper.js'
import { renderPaperBlocksToDocx, paperSectionShell, sanitizeXmlText } from '../../utils/assessmentToDocx.js'
import { seedBandForLevel } from '../../utils/assessmentBandService.js'

const STYLE_LABELS = {
  answer_key: 'Answer key',
  oral_observation: 'Oral observation sheet',
  method_marks: 'Method & accuracy marks',
  experiment_rubric: 'Experiment rubric',
  project_rubric: 'Project rubric',
  competence_rubric: 'Competence rubric',
  criteria_rubric: 'Marking criteria',
}

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '888888' },
}

function text(str, opts = {}) {
  return new TextRun({ text: sanitizeXmlText(str == null ? '' : String(str)), ...opts })
}

function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 60 },
    ...opts,
  })
}

function sectionHeading(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 24, color: '0e2a32' })],
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'cccccc' } },
  })
}

function cell(content, { width, shading, bold, size = 18 } = {}) {
  // Accepts an array of Paragraphs, a single Paragraph, or a plain string.
  // The single-Paragraph case matters: `cell(para(text(...)))` used to fall
  // through to the string branch and render the cell as "[object Object]".
  const paras = Array.isArray(content) ? content
    : content instanceof Paragraph ? [content]
    : [para(text(content, { size, bold }))]
  return new TableCell({
    children: paras,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    borders: CELL_BORDER,
    ...(shading ? { shading: { fill: shading } } : {}),
  })
}

// Teacher-only metadata that doesn't belong on the learner's paper.
function teacherMetaTable(header = {}) {
  const rows = [
    ['Task type', header.taskType],
    ['CTS component', header.component],
    ['Language skill', header.skill],
    ['Bloom level(s)', (header.bloomLevels || []).join(', ')],
    ['Syllabus outcome(s)', (header.outcomeRefs || []).join(', ')],
  ].filter(([, v]) => v)
  if (!rows.length) return null
  return new Table({
    width: { size: 80, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({
      children: [
        cell(para(text(k, { bold: true, size: 18 })), { width: 34, shading: 'F3F4F6' }),
        cell(para(text(v, { size: 18 })), { width: 66 }),
      ],
    })),
  })
}

function questionMarkingBlocks(questions = []) {
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
    if (q.answer) {
      out.push(new Paragraph({
        spacing: { after: 40 },
        indent: { left: 360 },
        children: [
          text('Answer: ', { bold: true, size: 18, color: '047857' }),
          text(q.answer, { size: 18, color: '047857' }),
        ],
      }))
    }
    if (Array.isArray(q.markAllocation) && q.markAllocation.length) {
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

// The marking scheme (teacher copy) — appended on its own page after the paper.
function markingSchemeChildren(task) {
  const header = task.header || {}
  const ms = task.markingScheme || {}
  const questions = Array.isArray(task.questions) ? task.questions : []
  const hasAnswers = questions.some((q) => q.answer || (q.markAllocation || []).length > 0)
  const hasCriteria = Array.isArray(ms.criteria) && ms.criteria.length > 0
  // Teacher administration guidance — printed with the marking scheme, never on
  // the learner's paper.
  const administration = String(task.administration || '').trim()
  const meta = teacherMetaTable(header)
  if (!hasAnswers && !hasCriteria && !ms.notes && !administration && !meta) return []

  const out = [
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      children: [text(`Marking scheme — ${STYLE_LABELS[ms.style] || 'Marking'}`, { bold: true, size: 28, color: '0e2a32' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [text('Teacher copy — School Based Assessment (ECZ)', { italics: true, size: 16, color: '6b7280' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }),
  ]

  if (meta) out.push(meta)

  if (administration) {
    out.push(sectionHeading('How to administer this task'))
    administration.split(/\n\s*\n/).filter((p) => p.trim()).forEach((p) => {
      out.push(para(text(p.replace(/\n/g, ' '), { size: 18 })))
    })
  }

  if (hasAnswers) {
    out.push(sectionHeading('Model answers & mark allocation'))
    questionMarkingBlocks(questions).forEach((p) => out.push(p))
  }

  if (hasCriteria || ms.notes) {
    out.push(sectionHeading('How to award the marks'))
    if (ms.notes) out.push(para(text(ms.notes, { size: 18 })))
    if (hasCriteria) {
      out.push(para(text(' ', { size: 8 })))
      out.push(criteriaTable(ms.criteria))
    }
  }

  return out
}

/**
 * Build the full ordered list of docx children for an SBA task: the printable
 * paper (always) plus the marking scheme (teacher copy only).
 */
export async function buildSbaTaskChildren(task, { includeAnswers = true, schoolName, blocks } = {}) {
  const paperBlocks = blocks || buildSbaPaperBlocks(task, { schoolName: schoolName || task?.header?.schoolName || '' })
  // An SBA task's figures answer to the same minimum size as an exam paper's
  // (§4.2). Passing the band explicitly is what makes that true: the shared
  // renderer reads a module-scoped band, so before this the SBA export sized
  // its figures against whatever an earlier download happened to leave behind.
  const children = await renderPaperBlocksToDocx(paperBlocks, null, {
    band: seedBandForLevel(task?.header?.grade) || null,
  })
  if (includeAnswers) children.push(...markingSchemeChildren(task))
  return children
}

export async function buildSbaTaskDocument(task, opts = {}) {
  const { includeAnswers = true, schoolName } = opts
  const header = task.header || {}
  // Build the layout blocks once: the banner block feeds the real Word page
  // header (paperSectionShell) and the rest become the body children, exactly
  // like the Assessment Studio export.
  const blocks = buildSbaPaperBlocks(task, { schoolName: schoolName || task?.header?.schoolName || '' })
  const children = await buildSbaTaskChildren(task, { includeAnswers, schoolName, blocks })

  return new Document({
    creator: 'zedexams.com',
    title: sanitizeXmlText(header.title || 'SBA Task'),
    description: 'Generated by ZedExams Teacher Tools',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 22 } } } },
    sections: [{
      ...paperSectionShell(blocks, opts),
      children,
    }],
  })
}

export async function downloadSbaTaskDocx(task, filename = 'sba-task.docx', opts = {}) {
  const doc = await buildSbaTaskDocument(task, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}
