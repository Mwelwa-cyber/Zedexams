/**
 * Export teacher delivery notes as a Word document. Portrait format,
 * matching the school-printed handout style head teachers expect.
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
    spacing: { after: 80 },
    ...opts,
  })
}

function h1(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 32 })],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  })
}

function h2(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
  })
}

function h3(str) {
  return new Paragraph({
    children: [text(str, { bold: true, size: 20 })],
    spacing: { before: 120, after: 60 },
  })
}

function bullet(str) {
  return new Paragraph({
    children: [text(str, { size: 20 })],
    bullet: { level: 0 },
    spacing: { after: 40 },
  })
}

function numbered(str, idx) {
  return new Paragraph({
    children: [text(`${idx + 1}. ${str}`, { size: 20 })],
    indent: { left: 360 },
    spacing: { after: 40 },
  })
}

function cell(content, {width, shading} = {}) {
  const paras = Array.isArray(content) ? content : [content]
  return new TableCell({
    children: paras,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    borders: CELL_BORDER,
    ...(shading ? { shading: { fill: shading } } : {}),
  })
}

function metadataTable(header) {
  const rows = [
    ['Topic', header.topic],
    ['Sub-topic', header.subtopic],
    ['Grade', header.grade],
    ['Subject', header.subject],
    ['Duration', header.durationMinutes ? `${header.durationMinutes} min` : ''],
    ['Medium', header.language],
    ['School', header.school],
    ['Teacher', header.teacherName],
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

export function buildNotesDocument(notes, opts = {}) {
  const children = []
  const header = notes.header || {}

  children.push(h1(header.title || 'Teacher Notes'))
  children.push(metadataTable(header))
  children.push(para(text(' ', { size: 14 })))

  // Lesson Opener
  const intro = notes.introduction || {}
  if (intro.hook || intro.whyItMatters || intro.priorKnowledge) {
    children.push(h2('Lesson Opener'))
    if (intro.hook) {
      children.push(h3('Hook'))
      children.push(para(text(intro.hook, { size: 20 })))
    }
    if (intro.whyItMatters) {
      children.push(h3('Why it matters'))
      children.push(para(text(intro.whyItMatters, { size: 20 })))
    }
    if (intro.priorKnowledge) {
      children.push(h3('Prior knowledge'))
      children.push(para(text(intro.priorKnowledge, { size: 20 })))
    }
  }

  // Key Concepts
  if (notes.keyConcepts?.length) {
    children.push(h2('Key Concepts'))
    notes.keyConcepts.forEach((c, idx) => {
      children.push(new Paragraph({
        children: [text(`${idx + 1}. ${c.name}`, { bold: true, size: 22 })],
        spacing: { before: 120, after: 60 },
      }))
      if (c.explanation) {
        children.push(para(text(c.explanation, { size: 20 })))
      }
    })
  }

  // Worked Examples
  if (notes.workedExamples?.length) {
    children.push(h2('Worked Examples'))
    notes.workedExamples.forEach((w, idx) => {
      children.push(h3(`Example ${idx + 1}`))
      children.push(para(text(w.problem, { bold: true, size: 20 })))
      if (w.steps?.length) {
        w.steps.forEach((s, i) => children.push(numbered(s, i)))
      }
      if (w.answer) {
        children.push(new Paragraph({
          children: [
            text('Answer: ', { bold: true, size: 20 }),
            text(w.answer, { size: 20 }),
          ],
          spacing: { after: 120 },
        }))
      }
    })
  }

  // Common Student Questions
  if (notes.studentQuestions?.length) {
    children.push(h2('Common Student Questions'))
    notes.studentQuestions.forEach((q) => {
      children.push(new Paragraph({
        children: [text(`Q: ${q.question}`, { bold: true, size: 20 })],
        spacing: { before: 80, after: 40 },
      }))
      children.push(new Paragraph({
        children: [text(`A: ${q.answer}`, { size: 20 })],
        spacing: { after: 80 },
      }))
    })
  }

  // Misconceptions
  if (notes.misconceptions?.length) {
    children.push(h2('Misconceptions to Watch For'))
    notes.misconceptions.forEach((m) => {
      children.push(new Paragraph({
        children: [
          text('⚠️ ', { size: 20 }),
          text(m.misconception, { bold: true, size: 20 }),
        ],
        spacing: { after: 40 },
      }))
      children.push(new Paragraph({
        children: [
          text('Correction: ', { bold: true, size: 20 }),
          text(m.correction, { size: 20 }),
        ],
        spacing: { after: 80 },
      }))
    })
  }

  // Discussion Prompts
  if (notes.discussionPrompts?.length) {
    children.push(h2('Discussion Prompts'))
    notes.discussionPrompts.forEach((p) => children.push(bullet(p)))
  }

  // Quick Checks
  if (notes.quickChecks?.length) {
    children.push(h2('Quick Checks'))
    notes.quickChecks.forEach((p) => children.push(bullet(p)))
  }

  // Glossary
  if (notes.glossary?.length) {
    children.push(h2('Glossary'))
    notes.glossary.forEach((g) => {
      children.push(new Paragraph({
        children: [
          text(`${g.term}: `, { bold: true, size: 20 }),
          text(g.definition, { size: 20 }),
        ],
        spacing: { after: 60 },
      }))
    })
  }

  // References
  if (notes.references?.length) {
    children.push(h2('References'))
    notes.references.forEach((r) => children.push(bullet(r)))
  }

  return new Document({
    creator: 'zedexams.com',
    title: header.title || 'Teacher Notes',
    description: 'Generated by ZedExams Teacher Tools',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 20 } } },
    },
    sections: [{ ...attributionSection(opts), children }],
  })
}

export async function downloadNotesDocx(notes, filename = 'teacher-notes.docx', opts = {}) {
  const doc = buildNotesDocument(notes, opts)
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
