/**
 * Export an assessment as a Word (.docx) file.
 *
 * Walks the same shared paper-layout blocks as the PDF exporter, so the
 * Word output stays in lock-step with the in-studio preview and PDF
 * export. Word can't reproduce the marble banner, so we render the
 * header as a centered 3-line stack (SCHOOL / TITLE / SUBJECT / [PAPER]).
 *
 * Two modes:
 *   - 'paper'  (default): printable paper for pupils.
 *   - 'scheme': marking key for teachers (answers + explanations).
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { buildPaperLayout } from './assessmentPaperLayout.js'

const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function runText(str, opts = {}) {
  return new TextRun({ text: str == null ? '' : String(str), ...opts })
}

function para(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    spacing: { after: 120 },
    ...opts,
  })
}

function centeredPara(runs, opts = {}) {
  return new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    ...opts,
  })
}

const BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '888888' },
}

// Render instructions with inline-bold option letters: "(A)", "(B)" etc.
// We can't use HTML, so we split the text on those tags and emit a TextRun
// per fragment, toggling the bold attribute. One paragraph per source
// paragraph, with the option letters bold inline.
function instructionParagraphs(text) {
  if (!text) return []
  const sourceParas = String(text).split(/\n\s*\n/)
  return sourceParas.map(sourcePara => {
    const collapsed = sourcePara.replace(/\n/g, ' ')
    const runs = []
    const pattern = /\(([A-D])\)/g
    let cursor = 0
    let match
    while ((match = pattern.exec(collapsed)) !== null) {
      const start = match.index
      if (start > cursor) runs.push(runText(collapsed.slice(cursor, start), { size: 22 }))
      runs.push(runText(`(${match[1]})`, { size: 22, bold: true }))
      cursor = start + match[0].length
    }
    if (cursor < collapsed.length) runs.push(runText(collapsed.slice(cursor), { size: 22 }))
    if (!runs.length) runs.push(runText('', { size: 22 }))
    return new Paragraph({
      children: runs,
      spacing: { after: 80 },
    })
  })
}

async function fetchImageBytes(url) {
  try {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

async function logoParagraph(url) {
  if (!url) return null
  const bytes = await fetchImageBytes(url)
  if (!bytes) return null
  return centeredPara([
    new ImageRun({ data: bytes, transformation: { width: 80, height: 80 } }),
  ])
}

async function imageParagraph(url, opts = {}) {
  if (!url) return null
  const bytes = await fetchImageBytes(url)
  if (!bytes) return null
  return centeredPara([
    new ImageRun({
      data: bytes,
      transformation: { width: opts.width || 360, height: opts.height || 220 },
    }),
  ])
}

async function renderBlock(block) {
  switch (block.kind) {
    case 'header': return renderHeader(block)
    case 'learnerFields': return renderLearnerFields(block)
    case 'instructions': return renderInstructions(block)
    case 'sectionHeader': return renderSectionHeader(block)
    case 'passage': return renderPassage(block)
    case 'question': return renderQuestion(block)
    case 'endOfPaper': return [centeredPara(runText(block.text, { italics: true, size: 20, color: '555555' }))]
    case 'footerCode': return [new Paragraph({
      children: [runText(block.code, { size: 18, color: '555555' })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200 },
    })]
    default: return []
  }
}

async function renderHeader(b) {
  const out = []
  const logo = await logoParagraph(b.logoUrl)
  if (logo) out.push(logo)
  out.push(centeredPara(runText((b.schoolName || 'YOUR SCHOOL NAME').toUpperCase(), { bold: true, size: 32 })))
  out.push(centeredPara(runText(b.title, { bold: true, size: 22 })))
  if (b.subject) out.push(centeredPara(runText(b.subject, { bold: true, size: 24 })))
  if (b.paperName) out.push(centeredPara(runText(b.paperName, { bold: true, size: 22 })))
  out.push(new Paragraph({ children: [runText('')], spacing: { after: 100 } }))
  return out
}

function renderLearnerFields(b) {
  if (!b.name && !b.date && !b.classField && !b.marks) return []
  const row1Children = []
  if (b.name) {
    row1Children.push(new TableCell({
      children: [para(runText("Pupil's Name: __________________________________________", { size: 22 }))],
      borders: BORDER,
    }))
  }
  if (b.date) {
    row1Children.push(new TableCell({
      children: [para(runText('Date: ______________', { size: 22 }))],
      borders: BORDER,
      width: { size: 30, type: WidthType.PERCENTAGE },
    }))
  }
  const rows = []
  if (row1Children.length) rows.push(new TableRow({ children: row1Children }))
  if (b.classField) {
    rows.push(new TableRow({
      children: [new TableCell({
        children: [para(runText('Class: ____________________', { size: 22 }))],
        borders: BORDER,
      })],
    }))
  }
  const out = []
  if (rows.length) {
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))
  }
  if (b.marks) {
    out.push(new Paragraph({
      children: [runText(`TOTAL MARKS: _________ / ${b.totalMarks || '____'}`, { bold: true, size: 22 })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 100, after: 200 },
    }))
  }
  return out
}

function renderInstructions(b) {
  if (!b.text) return []
  return [
    para(runText('Instructions', { bold: true, size: 22 })),
    ...instructionParagraphs(b.text),
    new Paragraph({ children: [runText('')], spacing: { after: 100 } }),
  ]
}

function renderSectionHeader(b) {
  const title = b.title ? `Section ${b.letter} — ${b.title}` : `Section ${b.letter}`
  const out = [
    new Paragraph({
      children: [
        runText(title.toUpperCase(), { bold: true, size: 26 }),
        runText(`  (${b.marks} mark${b.marks === 1 ? '' : 's'})`, { size: 22, color: '6b7280', italics: true }),
      ],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 100 },
      border: {
        bottom: { color: '000000', size: 6, style: BorderStyle.SINGLE, space: 1 },
      },
    }),
  ]
  if (b.instructions) {
    out.push(para(runText(b.instructions, { italics: true, size: 22, color: '4b5563' })))
  }
  return out
}

async function renderPassage(b) {
  const out = []
  if (b.title) {
    out.push(para(runText(b.title.toUpperCase(), { bold: true, size: 22 })))
  }
  if (b.text) {
    b.text.split(/\n\s*\n/).forEach(p => {
      out.push(para(runText(p.replace(/\n/g, ' '), { size: 22, italics: true })))
    })
  }
  if (b.imageUrl) {
    const img = await imageParagraph(b.imageUrl, { width: 380, height: 220 })
    if (img) out.push(img)
  }
  out.push(new Paragraph({ children: [runText('')], spacing: { after: 100 } }))
  return out
}

async function renderQuestion(b) {
  const out = []
  const marks = b.marks ?? 1
  const marksTag = marks > 1 ? `  (${marks} marks)` : ''
  out.push(new Paragraph({
    children: [
      runText(`${b.number}. `, { bold: true, size: 22 }),
      runText(b.text || '(no question text)', { size: 22 }),
      runText(marksTag, { size: 20, color: '6b7280', italics: true }),
    ],
    spacing: { before: 160, after: 80 },
  }))

  if (b.imageUrl) {
    const img = await imageParagraph(b.imageUrl)
    if (img) out.push(img)
  }
  if (b.wordBank && b.wordBank.length) {
    out.push(para([
      runText('Word bank: ', { bold: true, size: 20 }),
      runText(b.wordBank.join(' · '), { size: 20 }),
    ]))
  }

  if (b.type === 'mcq') {
    if (b.optionsMode === 'image') {
      const opts = b.options || []
      for (let row = 0; row < Math.ceil(opts.length / 2); row += 1) {
        const cells = []
        for (let col = 0; col < 2; col += 1) {
          const i = row * 2 + col
          if (i >= opts.length) break
          const media = b.optionMedia?.[i]
          const cellChildren = []
          if (media?.imageUrl) {
            const bytes = await fetchImageBytes(media.imageUrl)
            if (bytes) {
              cellChildren.push(centeredPara([
                new ImageRun({ data: bytes, transformation: { width: 140, height: 140 } }),
              ]))
            }
          }
          const isCorrect = b.showAnswer && Number(b.correctAnswer) === i
          cellChildren.push(centeredPara([
            runText(`${SECTION_LETTERS[i]}.`, { bold: true, size: 20, color: isCorrect ? '047857' : undefined }),
            runText(opts[i] ? ` ${opts[i]}` : '', { size: 20, color: isCorrect ? '047857' : undefined, bold: isCorrect }),
            isCorrect ? runText(' ✓', { bold: true, color: '047857', size: 20 }) : runText(''),
          ]))
          cells.push(new TableCell({
            children: cellChildren,
            borders: BORDER,
            width: { size: 50, type: WidthType.PERCENTAGE },
          }))
        }
        if (cells.length) {
          out.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({ children: cells })],
          }))
        }
      }
    } else if (b.optionsMode === 'mixed') {
      for (let i = 0; i < (b.options || []).length; i += 1) {
        const media = b.optionMedia?.[i]
        const isCorrect = b.showAnswer && Number(b.correctAnswer) === i
        const runs = [runText(`   ${SECTION_LETTERS[i]}. `, { bold: true, size: 20, color: isCorrect ? '047857' : undefined })]
        if (media?.imageUrl) {
          const bytes = await fetchImageBytes(media.imageUrl)
          if (bytes) {
            runs.push(new ImageRun({ data: bytes, transformation: { width: 50, height: 50 } }))
            runs.push(runText('  ', { size: 20 }))
          }
        }
        runs.push(runText(String(b.options[i] ?? ''), { size: 20, color: isCorrect ? '047857' : undefined, bold: isCorrect }))
        if (isCorrect) runs.push(runText(' ✓', { bold: true, color: '047857', size: 20 }))
        out.push(para(runs))
      }
    } else {
      ;(b.options || []).forEach((opt, i) => {
        const isCorrect = b.showAnswer && Number(b.correctAnswer) === i
        out.push(new Paragraph({
          children: [
            runText(`   ${SECTION_LETTERS[i]}. `, { bold: true, size: 20, color: isCorrect ? '047857' : undefined }),
            runText(String(opt ?? ''), { size: 20, color: isCorrect ? '047857' : undefined, bold: isCorrect }),
            isCorrect ? runText('  ✓', { bold: true, color: '047857', size: 20 }) : runText(''),
          ],
          spacing: { after: 40 },
        }))
      })
    }
  } else if (b.type === 'short_answer' || b.type === 'fill') {
    const lines = b.answerLines || 2
    for (let i = 0; i < lines; i += 1) {
      out.push(para(runText('______________________________________________________', { size: 20 })))
    }
  } else if (b.type === 'numeric') {
    // One short blank line followed by the unit (if any). Fixed-width
    // underscore run roughly matches the 160pt line in the PDF.
    const unitSuffix = b.numericUnit ? ` ${b.numericUnit}` : ''
    out.push(para([
      runText('___________________', { size: 20 }),
      runText(unitSuffix, { size: 20 }),
    ]))
  } else if (b.type === 'diagram') {
    const lines = b.answerLines || 4
    for (let i = 0; i < lines; i += 1) {
      out.push(para(runText('______________________________________________________', { size: 20 })))
    }
  } else if (b.type === 'essay') {
    const lines = b.answerLines || 10
    for (let i = 0; i < lines; i += 1) {
      out.push(para(runText('______________________________________________________', { size: 20 })))
    }
  }

  if (b.showAnswer) {
    if (b.type === 'mcq') {
      const i = Number(b.correctAnswer)
      const letter = SECTION_LETTERS[i] || '?'
      const opt = b.options?.[i] ?? ''
      out.push(para([
        runText('Answer: ', { bold: true, size: 20, color: '047857' }),
        runText(`${letter}. ${opt}`, { size: 20, color: '047857' }),
      ]))
    } else if (b.type === 'numeric') {
      const value = String(b.correctAnswer ?? '')
      const unit = b.numericUnit ? ` ${b.numericUnit}` : ''
      const tol = Number(b.numericTolerance) > 0 ? ` (±${b.numericTolerance})` : ''
      out.push(para([
        runText('Expected answer: ', { bold: true, size: 20, color: '047857' }),
        runText(`${value}${unit}${tol}`, { size: 20, color: '047857' }),
      ]))
    } else {
      out.push(para([
        runText('Expected answer: ', { bold: true, size: 20, color: '047857' }),
        runText(String(b.correctAnswer ?? ''), { size: 20, color: '047857' }),
      ]))
    }
    if (b.explanation) {
      out.push(para([
        runText('Notes: ', { bold: true, size: 18, color: '6b7280' }),
        runText(b.explanation, { size: 18, color: '6b7280', italics: true }),
      ]))
    }
  }
  return out
}

export async function buildAssessmentDocument(assessment, questions, { mode = 'paper' } = {}) {
  const blocks = buildPaperLayout(assessment, questions, { mode })
  const children = []
  for (const block of blocks) {
    const rendered = await renderBlock(block)
    if (Array.isArray(rendered)) children.push(...rendered)
    else if (rendered) children.push(rendered)
  }

  const title = mode === 'scheme'
    ? `${assessment.title || 'Assessment'} — Marking Key`
    : (assessment.title || 'Assessment')

  return new Document({
    creator: 'zedexams.com',
    title,
    description: 'Generated by ZedExams Assessment Studio',
    styles: {
      default: {
        document: { run: { font: 'Times New Roman', size: 22 } },
      },
    },
    sections: [{ children }],
  })
}

export async function downloadAssessmentDocx(assessment, questions, filename = 'assessment.docx', opts = {}) {
  const doc = await buildAssessmentDocument(assessment, questions, opts)
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
