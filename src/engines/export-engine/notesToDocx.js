/**
 * Export teacher delivery notes as a Word document. Portrait format,
 * matching the school-printed handout style head teachers expect.
 */

import { saveBlob } from '../../utils/saveBlob.js'
import { sanitizeXmlText } from '../../utils/xmlText.js'
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
import { attributionSection } from '../../utils/docxAttribution.js'

// Brand ink for the title rules + a fully-borderless cell, so the metadata
// strip reads as plain "Label: value" lines (like a lesson plan header) rather
// than a boxed grid.
const RULE = { style: BorderStyle.SINGLE, size: 8, color: '0E2A32' }
const NONE = { style: BorderStyle.NONE, size: 0, color: 'auto' }
const NO_CELL_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE }

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function text(str, opts = {}) {
  return new TextRun({ text: sanitizeXmlText(str), ...opts })
}

function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 80 },
    ...opts,
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

// School name, centred and large — the top line of the document, like a
// lesson plan.
function schoolHeading(name) {
  return new Paragraph({
    children: [text(name, { bold: true, size: 34 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
  })
}

// "<Subject> Teaching Notes" — centred, spaced caps, ruled top and bottom, so
// it mirrors the lesson plan's title block.
function docTitle(str) {
  return new Paragraph({
    children: [text(String(str).toUpperCase(), { bold: true, size: 26, color: '0E2A32' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 40, after: 160 },
    border: { top: { ...RULE, space: 4 }, bottom: { ...RULE, space: 4 } },
  })
}

// Borderless "Label: value" strip ruled top and bottom — the lesson date and
// the rest of the lesson metadata, laid out to the left. Subject lives in the
// title above, so it's left out here.
function metaStrip(header) {
  const rows = [
    ['Teacher', header.teacherName],
    ['Date', header.date],
    ['Class', header.grade],
    ['Topic', header.topic],
    ['Sub-topic', header.subtopic],
    ['Duration', header.durationMinutes ? `${header.durationMinutes} min` : ''],
    ['Medium', header.language],
  ].filter(([, v]) => v)
  if (rows.length === 0) return null
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: RULE, bottom: RULE, left: NONE, right: NONE,
      insideHorizontal: NONE, insideVertical: NONE,
    },
    rows: rows.map(([k, v]) => new TableRow({
      children: [
        new TableCell({
          width: { size: 26, type: WidthType.PERCENTAGE },
          borders: NO_CELL_BORDERS,
          children: [para(text(`${k}:`, { bold: true, size: 18 }))],
        }),
        new TableCell({
          width: { size: 74, type: WidthType.PERCENTAGE },
          borders: NO_CELL_BORDERS,
          children: [para(text(String(v), { size: 18 }))],
        }),
      ],
    })),
  })
}

export function buildNotesDocument(notes, opts = {}) {
  const children = []
  const header = notes.header || {}
  const subjectLabel = formatSubject(header.subject)
  const docTitleText = subjectLabel ? `${subjectLabel} Teaching Notes` : 'Teaching Notes'

  if (header.school) children.push(schoolHeading(header.school))
  children.push(docTitle(docTitleText))
  const strip = metaStrip(header)
  if (strip) children.push(strip)
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
    title: sanitizeXmlText(docTitleText),
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
  await saveBlob(blob, filename)
}
