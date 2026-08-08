/**
 * The learner handout as Word (§6).
 *
 * TWO documents, and that is the design rather than a limitation: the learner's
 * pages and the teacher's answer page leave the studio as separate files. Not
 * one file with the answers at the end, not one with a section break — separate
 * files, because the failure this prevents is a teacher photocopying forty
 * copies of a sheet whose last page holds the answers, and every version of
 * "the answers are further down" ends the same way at the machine.
 *
 * `validateLearnerNotes` already moved the answers off the questions, so the
 * learner builder here has nothing to filter: it cannot print an answer,
 * because the object it walks does not contain one.
 *
 * Word gets the same figures the print route does — SVG, drawn by the ONE
 * diagram catalogue, embedded with a high-DPI raster fallback (`svgImageRun`,
 * the mechanism §4.2 established for assessment papers), so a library diagram
 * is vector all the way down in Word too.
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
  TextRun,
} from 'docx'
import { attributionSection } from './docxAttribution.js'
import { getDiagram, renderDiagramSvg } from './curriculumDiagrams.js'
import { svgImageRun } from './assessmentToDocx.js'
import { svgToPngBytes } from './svgRasterizer.js'

const INK = '111111'
const RULE = { style: BorderStyle.SINGLE, size: 8, color: INK }

/**
 * Strip the generator's `**term**` bolding into real Word runs.
 *
 * A learner finds a term again by its weight on the page, so the emphasis has
 * to survive the export — printing the asterisks would be worse than dropping
 * them, and dropping them loses the one piece of formatting the notes contract
 * asks for.
 */
function runs(text, base = {}) {
  const out = []
  const source = String(text ?? '')
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let match
  while ((match = re.exec(source)) !== null) {
    if (match.index > last) {
      out.push(new TextRun({ text: sanitizeXmlText(source.slice(last, match.index)), ...base }))
    }
    out.push(new TextRun({ text: sanitizeXmlText(match[1]), ...base, bold: true }))
    last = re.lastIndex
  }
  if (last < source.length) {
    out.push(new TextRun({ text: sanitizeXmlText(source.slice(last)), ...base }))
  }
  return out.length ? out : [new TextRun({ text: '', ...base })]
}

const para = (text, opts = {}) => new Paragraph({
  children: runs(text, opts.run || { size: 21 }),
  spacing: { after: 70, ...(opts.spacing || {}) },
  ...(opts.paragraph || {}),
})

const heading = (text, level = HeadingLevel.HEADING_2) => new Paragraph({
  children: [new TextRun({ text: sanitizeXmlText(text), bold: true, size: 24, color: INK })],
  heading: level,
  spacing: { before: 200, after: 90 },
  // A heading that lands at the foot of a page with its section overleaf is the
  // classic Word defect; `keepNext` is the fix, applied to headings only.
  keepNext: true,
})

const bullet = (text) => new Paragraph({
  children: runs(text, { size: 21 }),
  bullet: { level: 0 },
  spacing: { after: 40 },
})

const numbered = (text, index) => new Paragraph({
  children: [new TextRun({ text: `${index}. `, bold: true, size: 21 }), ...runs(text, { size: 21 })],
  indent: { left: 340 },
  spacing: { after: 50 },
})

function boxed(lines, title) {
  const children = []
  if (title) {
    children.push(new Paragraph({
      children: [new TextRun({ text: sanitizeXmlText(title), bold: true, size: 22, allCaps: true })],
      spacing: { after: 50 },
      border: { top: { ...RULE, space: 6 } },
      keepNext: true,
    }))
  }
  for (const line of lines) children.push(bullet(line))
  children.push(new Paragraph({
    children: [new TextRun({ text: '', size: 4 })],
    border: { bottom: { ...RULE, space: 6 } },
    spacing: { after: 140 },
  }))
  return children
}

/** The figure's height ÷ width, read off the catalogue entry's own viewBox. */
function figureAspect(diagram) {
  const entry = getDiagram(diagram.libraryKey)
  const vb = entry && entry.viewBox
  if (!vb || !vb.width || !vb.height) return 0.75
  return vb.height / vb.width
}

/**
 * A library figure, as vector with a raster fallback.
 *
 * A figure that cannot be drawn produces a visible placeholder rather than a
 * gap: a silently missing diagram is the "it looked fine in the preview" bug
 * the assessment exporters already learned to refuse.
 */
async function figureParagraphs(diagram, { answerCopy = false } = {}) {
  if (!diagram) return []
  const params = answerCopy ? { ...(diagram.params || {}), labels: 'answer' } : (diagram.params || {})
  const svg = renderDiagramSvg(diagram.libraryKey, params)
  const out = []
  if (svg) {
    try {
      // The raster is the FALLBACK, not the figure: Word 2016+ draws the SVG,
      // older builds draw the PNG, so the worst case is the bitmap we would
      // have embedded anyway. Rasterised at 3× so that worst case still prints
      // cleanly on a school photocopier.
      const width = 300
      const height = Math.round(width * figureAspect(diagram))
      const png = await svgToPngBytes(svg, width * 3, height * 3)
      out.push(new Paragraph({
        children: [svgImageRun(svg, png, { width, height }, diagram.caption)],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        keepNext: true,
      }))
    } catch (err) {
      console.error('[learnerNotesToDocx] figure embed failed', err)
    }
  }
  if (out.length === 0) {
    out.push(new Paragraph({
      children: [new TextRun({
        text: sanitizeXmlText(`[Figure could not be embedded: ${diagram.caption}]`),
        size: 20, italics: true,
      })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    }))
  }
  if (diagram.caption) {
    out.push(new Paragraph({
      children: [new TextRun({ text: sanitizeXmlText(diagram.caption), size: 18 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 90 },
    }))
  }
  if (!answerCopy && Array.isArray(diagram.wordBank) && diagram.wordBank.length) {
    out.push(new Paragraph({
      children: [
        new TextRun({ text: 'Word bank: ', bold: true, size: 20 }),
        new TextRun({ text: sanitizeXmlText(diagram.wordBank.join('  ·  ')), size: 20 }),
      ],
      border: { top: { ...RULE, space: 4 }, bottom: { ...RULE, space: 4 } },
      spacing: { after: 120 },
    }))
  }
  return out
}

/** The learner's pages. Contains no answers, by construction. */
export async function buildLearnerNotesDocument(notes, opts = {}) {
  const children = []
  const h = notes.header || {}
  const diagrams = notes.diagrams || []
  const bodyFigure = diagrams.find((d) => d.placement === 'body')
  const exerciseFigure = diagrams.find((d) => d.placement === 'exercise')

  if (h.school) {
    children.push(new Paragraph({
      children: [new TextRun({ text: sanitizeXmlText(h.school), bold: true, size: 28 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }))
  }
  children.push(new Paragraph({
    children: [new TextRun({ text: sanitizeXmlText(h.title || h.topic || 'Study notes'), bold: true, size: 30 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    border: { bottom: { ...RULE, space: 4 } },
  }))
  const meta = [h.grade, String(h.subject || '').replace(/_/g, ' '), h.date].filter(Boolean)
  if (meta.length) {
    children.push(new Paragraph({
      children: [new TextRun({ text: sanitizeXmlText(meta.join('  ·  ')), size: 19 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 90 },
    }))
  }
  children.push(new Paragraph({
    children: [new TextRun({ text: 'Name: ______________________________________', size: 21 })],
    spacing: { after: 160 },
  }))

  if ((notes.learningOutcomes || []).length) {
    children.push(...boxed(notes.learningOutcomes, 'What you will learn'))
  }

  ;(notes.sections || []).forEach((section, index) => {
    children.push(heading(`${index + 1}. ${section.heading}`))
    for (const p of section.body || []) children.push(para(p))
    for (const d of section.definitions || []) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${sanitizeXmlText(d.term)} — `, bold: true, size: 21 }),
          ...runs(d.meaning, { size: 21 }),
        ],
        spacing: { after: 60 },
        border: { left: { ...RULE, space: 8 } },
        indent: { left: 200 },
      }))
    }
    if (section.recap) children.push(para(section.recap, { run: { size: 20, italics: true } }))
  })

  if (bodyFigure) children.push(...(await figureParagraphs(bodyFigure)))

  if ((notes.workedExamples || []).length) {
    children.push(heading("Let's work one out together"))
    for (const w of notes.workedExamples) {
      if (w.title) children.push(para(w.title, { run: { size: 21, bold: true } }))
      children.push(para(w.problem, { run: { size: 21, bold: true } }))
      ;(w.steps || []).forEach((s, i) => children.push(numbered(s, i + 1)))
      if (w.answer) {
        children.push(new Paragraph({
          children: [new TextRun({ text: 'Answer: ', bold: true, size: 21 }), ...runs(w.answer, { size: 21 })],
          spacing: { after: 120 },
        }))
      }
    }
  }

  for (const m of notes.dontMixThese || []) {
    children.push(...boxed(
      [m.warning, m.clarification].filter(Boolean),
      `Don't mix these up!${m.confusedPair ? ` ${m.confusedPair}` : ''}`,
    ))
  }

  if ((notes.learnerQuestions || []).length) {
    children.push(heading('Questions learners ask'))
    for (const q of notes.learnerQuestions) {
      children.push(para(q.question, { run: { size: 21, bold: true } }))
      children.push(para(q.answer))
    }
  }

  if ((notes.rememberBox || []).length) children.push(...boxed(notes.rememberBox, 'Remember!'))

  const questions = (notes.exercise && notes.exercise.questions) || []
  if (questions.length) {
    children.push(heading('Exercise'))
    if (notes.exercise.instructions) {
      children.push(para(notes.exercise.instructions, { run: { size: 20, italics: true } }))
    }
    if (exerciseFigure) children.push(...(await figureParagraphs(exerciseFigure)))
    for (const q of questions) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${q.number}. `, bold: true, size: 21 }),
          ...runs(q.prompt, { size: 21 }),
          ...(q.marks ? [new TextRun({ text: `  [${q.marks}]`, bold: true, size: 20 })] : []),
        ],
        spacing: { after: 40 },
      }))
      children.push(new Paragraph({
        children: [new TextRun({ text: '', size: 21 })],
        border: { bottom: { ...RULE, space: 10 } },
        spacing: { after: 140 },
      }))
    }
  }

  return new Document({
    creator: 'zedexams.com',
    title: sanitizeXmlText(h.title || 'Study notes'),
    description: 'Learner study notes generated by ZedExams Teacher Tools',
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{ ...attributionSection(opts), children }],
  })
}

/** The teacher's answer page. Its own file, always. */
export async function buildAnswerPageDocument(notes, opts = {}) {
  const children = []
  const h = notes.header || {}
  const key = notes.answerKey || {}

  children.push(new Paragraph({
    children: [new TextRun({
      text: "TEACHER'S COPY — DO NOT PHOTOCOPY FOR LEARNERS",
      bold: true, size: 20,
    })],
    spacing: { after: 100 },
    border: { top: { ...RULE, space: 4 }, bottom: { ...RULE, space: 4 } },
  }))
  children.push(new Paragraph({
    children: [new TextRun({
      text: sanitizeXmlText(`${h.title || h.topic || 'Study notes'} — Answers`),
      bold: true, size: 28,
    })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 140 },
  }))

  if ((key.answers || []).length) {
    children.push(heading('Exercise'))
    for (const a of key.answers) {
      children.push(new Paragraph({
        children: [new TextRun({ text: `${a.number}. `, bold: true, size: 21 }), ...runs(a.answer, { size: 21 })],
        spacing: { after: a.note ? 20 : 90 },
      }))
      if (a.note) {
        children.push(para(a.note, { run: { size: 19, italics: true }, spacing: { after: 90 } }))
      }
    }
  }

  if ((key.diagramLabels || []).length) {
    children.push(heading(`${key.diagramCaption || 'Diagram'} — labels`))
    const figure = (notes.diagrams || []).find((d) => d.placement === 'exercise')
    if (figure) children.push(...(await figureParagraphs(figure, { answerCopy: true })))
    for (const label of key.diagramLabels) children.push(numbered(label.name, label.number))
  }

  return new Document({
    creator: 'zedexams.com',
    title: sanitizeXmlText(`${h.title || 'Study notes'} — Answers`),
    description: 'Answer page generated by ZedExams Teacher Tools',
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{ ...attributionSection(opts), children }],
  })
}

export async function downloadLearnerNotesDocx(notes, filename = 'learner-notes.docx', opts = {}) {
  const doc = await buildLearnerNotesDocument(notes, opts)
  await saveBlob(await Packer.toBlob(doc), filename)
}

export async function downloadAnswerPageDocx(notes, filename = 'answers.docx', opts = {}) {
  const doc = await buildAnswerPageDocument(notes, opts)
  await saveBlob(await Packer.toBlob(doc), filename)
}
