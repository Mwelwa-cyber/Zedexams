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
import { markupFieldToDocx } from '../../utils/toolNotationDocx.js'

const CELL_BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '888888' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '888888' },
}

function text(str, opts = {}) {
  return new TextRun({ text: sanitizeXmlText(str), ...opts })
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

// Pick the working space for a question: explicit workingStyle wins, otherwise
// fall back to a sensible default derived from the question type.
function effectiveWorkingStyle(q) {
  if (q.workingStyle) return q.workingStyle
  if (q.type === 'calculation') return 'columns'
  if (q.type === 'essay') return 'lines'
  if (q.type === 'fill_in_blank' || q.type === 'short_answer') return 'box'
  return 'none'
}

function workingSpaceBlocks(q) {
  const style = effectiveWorkingStyle(q)
  const blocks = []
  if (style === 'none') return blocks
  if (style === 'columns') {
    // Tall vertical room for column ×/÷ working (long division, multi-digit ×).
    blocks.push(para(text('Working:', { bold: true, size: 20 })))
    for (let i = 0; i < 5; i++) blocks.push(para(text(' ', { size: 20 })))
    blocks.push(para(text('Answer: ______________________________________', { size: 20 })))
  } else if (style === 'box') {
    blocks.push(para(text('Answer: ______________________________________________________', { size: 20 })))
  } else if (style === 'lines') {
    // Essays want plenty of room (was 6 lines before working styles existed);
    // short-answer prompts only need a couple.
    const lineCount = q.type === 'essay' ? 6 : 4
    for (let i = 0; i < lineCount; i++) {
      blocks.push(para(text('______________________________________________________________________________', { size: 20 })))
    }
  }
  return blocks
}

function renderQuestion(q, {includeAnswer}) {
  const blocks = []
  const marksTag = `  [${q.marks} mark${q.marks === 1 ? '' : 's'}]`

  // The prompt may carry notation markup (stacked fractions, $...$, column
  // sums); a plain prompt takes exactly the old single-run path.
  const prompt = markupFieldToDocx(q.prompt, { size: 22 })
  blocks.push(new Paragraph({
    children: [
      text(`${q.number}. `, { bold: true, size: 22 }),
      ...prompt.runs,
      text(marksTag, { size: 18, color: '6b7280', italics: true }),
    ],
    spacing: { before: 160, after: 80 },
  }))
  blocks.push(...prompt.extraParagraphs)

  if (q.type === 'multiple_choice' || q.type === 'true_false') {
    const letters = ['A', 'B', 'C', 'D', 'E']
    ;(q.options || []).forEach((opt, i) => {
      blocks.push(new Paragraph({
        children: [
          text(`   ${letters[i] || '•'}. `, { bold: true, size: 20 }),
          ...markupFieldToDocx(opt, { size: 20 }).runs,
        ],
        spacing: { after: 40 },
      }))
    })
  } else if (!includeAnswer) {
    // Pupil copy: leave working room. The answer key skips this to stay compact.
    blocks.push(...workingSpaceBlocks(q))
  }

  if (includeAnswer && q.answer) {
    const answer = markupFieldToDocx(q.answer, { size: 20, color: '059669' })
    blocks.push(new Paragraph({
      children: [
        text('✓ Answer: ', { bold: true, size: 20, color: '059669' }),
        ...answer.runs,
      ],
      spacing: { before: 80 },
    }))
    // A [[vmath]] answer lives in extraParagraphs — dropping them loses the
    // whole calculation from the key.
    blocks.push(...answer.extraParagraphs)
    if (q.workingNotes) {
      blocks.push(new Paragraph({
        children: [
          text('   Notes: ', { bold: true, size: 18, color: '6b7280' }),
          ...markupFieldToDocx(q.workingNotes, { size: 18, color: '6b7280', italics: true }).runs,
        ],
        spacing: { after: 80 },
      }))
    }
  }

  return blocks
}

// A reading passage rendered in a single bordered cell above the questions.
function passageBlocks(section) {
  const blocks = []
  if (section.passageTitle) {
    blocks.push(new Paragraph({
      children: [text(section.passageTitle, { bold: true, size: 22 })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 80 },
    }))
  }
  // A maths passage may carry notation markup; the converter's first-line
  // runs plus its extra paragraphs cover multi-line and [[vmath]] content.
  const paragraphs = String(section.passage).split(/\n{2,}/).flatMap((chunk) => {
    const field = markupFieldToDocx(chunk, { size: 21 })
    return [para(field.runs), ...field.extraParagraphs]
  })
  blocks.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({ children: paragraphs, borders: CELL_BORDER })],
    })],
  }))
  blocks.push(para([]))
  return blocks
}

// A compact drill grid: questions packed into an N-column borderless table.
function gridSectionBlocks(section, {includeAnswer}) {
  const cols = Math.min(4, Math.max(2, Number(section.columns) || 3))
  const questions = section.questions || []
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'ffffff' }
  const borders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder }

  const rows = []
  for (let i = 0; i < questions.length; i += cols) {
    const slice = questions.slice(i, i + cols)
    const cells = []
    for (let c = 0; c < cols; c++) {
      const q = slice[c]
      // Drill items are the acid test: twelve structured fractions in a
      // 4-column grid. The markup runs keep each item inline in its cell.
      const runs = q ? [
        text(`${q.number}. `, { bold: true, size: 22 }),
        ...markupFieldToDocx(q.prompt, { size: 22 }).runs,
        text(' ______', { size: 22 }),
      ] : [text(' ', { size: 22 })]
      const children = [new Paragraph({ children: runs, spacing: { after: 40 } })]
      if (includeAnswer && q && q.answer) {
        children.push(new Paragraph({
          children: [
            text('✓ ', { size: 18, color: '059669' }),
            ...markupFieldToDocx(q.answer, { size: 18, color: '059669' }).runs,
          ],
          spacing: { after: 80 },
        }))
      }
      cells.push(new TableCell({
        children,
        width: { size: Math.round(100 / cols), type: WidthType.PERCENTAGE },
        borders,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
      }))
    }
    rows.push(new TableRow({ children: cells }))
  }
  return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })]
}

/**
 * @param {object} worksheet  validated worksheet JSON
 * @param {'worksheet'|'answer_key'} mode
 */
export function buildWorksheetDocument(worksheet, {mode = 'worksheet', attribution = false} = {}) {
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
    if (section.passage) {
      children.push(...passageBlocks(section))
    }
    if (section.layout === 'grid') {
      children.push(...gridSectionBlocks(section, {includeAnswer}))
    } else {
      for (const q of section.questions || []) {
        children.push(...renderQuestion(q, {includeAnswer}))
      }
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
    title: sanitizeXmlText(worksheet.header?.title || 'Worksheet'),
    description: 'Generated by ZedExams Teacher Tools',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 20 } },
      },
    },
    sections: [{ ...attributionSection({ attribution }), children }],
  })
}

export async function downloadWorksheetDocx(worksheet, filename = 'worksheet.docx', opts = {}) {
  const doc = buildWorksheetDocument(worksheet, opts)
  const blob = await Packer.toBlob(doc)
  await saveBlob(blob, filename)
}
