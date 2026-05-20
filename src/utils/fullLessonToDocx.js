/**
 * Export a Full Lesson as a Word document. Portrait, school-printed style —
 * mirrors notesToDocx.js so the look is consistent across the studios.
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

function bodyPara(str) {
  return new Paragraph({
    children: [text(str, { size: 20 })],
    spacing: { after: 60 },
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

function cell(content, { width, shading } = {}) {
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
    ['Term', header.term ? `Term ${header.term}` : ''],
    ['Duration', header.durationMinutes ? `${header.durationMinutes} min` : ''],
    ['Medium', header.language],
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

export function buildFullLessonDocument(lesson) {
  const children = []
  const header = lesson.header || {}

  children.push(h1(header.title || 'Lesson'))
  children.push(metadataTable(header))
  children.push(para(text(' ', { size: 14 })))

  if (lesson.objectives?.length) {
    children.push(h2('Lesson Objectives'))
    lesson.objectives.forEach((o) => children.push(bullet(o)))
  }

  if (lesson.keyVocabulary?.length) {
    children.push(h2('Key Vocabulary'))
    lesson.keyVocabulary.forEach((g) => {
      children.push(new Paragraph({
        children: [
          text(`${g.term}: `, { bold: true, size: 20 }),
          text(g.definition, { size: 20 }),
        ],
        spacing: { after: 60 },
      }))
    })
  }

  const intro = lesson.introduction || {}
  if (intro.hook || intro.priorKnowledge) {
    children.push(h2('Introduction'))
    if (intro.hook) {
      children.push(h3('Hook'))
      children.push(bodyPara(intro.hook))
    }
    if (intro.priorKnowledge) {
      children.push(h3('Prior knowledge'))
      children.push(bodyPara(intro.priorKnowledge))
    }
  }

  if (lesson.teaching?.length) {
    children.push(h2('Lesson Content'))
    lesson.teaching.forEach((t) => {
      if (t.heading) children.push(h3(t.heading))
      if (t.explanation) children.push(bodyPara(t.explanation))
    })
  }

  if (lesson.workedExamples?.length) {
    children.push(h2('Worked Examples'))
    lesson.workedExamples.forEach((w, idx) => {
      children.push(h3(`Example ${idx + 1}`))
      if (w.problem) children.push(para(text(w.problem, { bold: true, size: 20 })))
      if (w.steps?.length) w.steps.forEach((s, i) => children.push(numbered(s, i)))
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

  if (lesson.guidedPractice?.length) {
    children.push(h2('Guided Practice'))
    lesson.guidedPractice.forEach((s, i) => children.push(numbered(s, i)))
  }

  if (lesson.learnerActivities?.length) {
    children.push(h2('Learner Activities'))
    lesson.learnerActivities.forEach((a) => children.push(bullet(a)))
  }

  const a = lesson.assessment || {}
  if (a.checks?.length) {
    children.push(h2('Formative Checks'))
    a.checks.forEach((c, i) => children.push(numbered(c, i)))
    if (a.answers?.length) {
      children.push(h3('Answer Key'))
      a.answers.forEach((ans, i) => children.push(numbered(ans, i)))
    }
  }

  if (lesson.summary) {
    children.push(h2('Summary'))
    children.push(bodyPara(lesson.summary))
  }

  const hw = lesson.homework || {}
  if (hw.task) {
    children.push(h2('Homework'))
    children.push(bodyPara(hw.task))
    if (hw.answerGuide) {
      children.push(h3('Answer guide'))
      children.push(bodyPara(hw.answerGuide))
    }
  }

  if (lesson.references?.length) {
    children.push(h2('References'))
    lesson.references.forEach((r) => children.push(bullet(r)))
  }

  return new Document({
    creator: 'zedexams.com',
    title: header.title || 'Lesson',
    description: 'Generated by ZedExams Teacher Tools',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 20 } } },
    },
    sections: [{ children }],
  })
}

export async function downloadFullLessonDocx(lesson, filename = 'lesson.docx') {
  const doc = buildFullLessonDocument(lesson)
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
