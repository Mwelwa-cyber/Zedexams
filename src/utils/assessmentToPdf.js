/**
 * Print a teacher-private assessment as a PDF using the browser's native
 * print dialog. Mirrors `lessonPlanToPdf.js`: open a new window, write
 * print-friendly HTML, trigger window.print(), let the user pick
 * "Save as PDF" in the system dialog. No external PDF library — keeps
 * the bundle small.
 *
 * Two modes:
 *   - 'paper'  (default): printable paper for pupils.
 *   - 'scheme': marking scheme with answers/explanations.
 */

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

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function letterFor(index) {
  return String.fromCharCode(65 + index)
}

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

export function printAssessmentAsPdf(assessment, questions, { mode = 'paper' } = {}) {
  if (!assessment) throw new Error('No assessment to export.')

  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100')
  if (!win) {
    throw new Error('Your browser blocked the print window. Please allow pop-ups and try again.')
  }

  const html = buildPrintableHtml(assessment, questions || [], mode)
  win.document.open()
  win.document.write(html)
  win.document.close()

  const ready = () => {
    try {
      win.focus()
      win.print()
    } catch {
      // Fall through; user can hit Ctrl+P manually.
    }
  }
  if (win.document.readyState === 'complete') setTimeout(ready, 120)
  else win.addEventListener('load', () => setTimeout(ready, 120))
}

function buildPrintableHtml(assessment, questions, mode) {
  const includeAnswer = mode === 'scheme'
  const typeLabel = ASSESSMENT_TYPE_LABELS[assessment.assessmentType] || 'Assessment'
  const title = assessment.title || typeLabel
  const docTitle = includeAnswer ? `${title} — Marking Scheme` : title

  const coverRows = [
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

  const sortedQs = [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const groups = groupByPart(sortedQs, assessment.parts || [])

  let runningNumber = 0
  const groupsHtml = groups.length === 0
    ? `<p class="muted">(This assessment has no questions yet.)</p>`
    : groups.map(group => {
      const isUnsectioned = !group.id
      const total = partMarksTotal(group)
      const heading = isUnsectioned
        ? ''
        : `<h2>${escapeHtml(group.title || 'Section')} <span class="mins">— ${total} mark${total === 1 ? '' : 's'}</span></h2>`
      const qHtml = group.questions.map(q => {
        runningNumber += 1
        return renderQuestion(q, runningNumber, includeAnswer)
      }).join('')
      return heading + qHtml
    }).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(docTitle)}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      color: #111;
      margin: 0;
      font-size: 12pt;
      line-height: 1.45;
    }
    h1 {
      font-size: 22pt;
      text-align: center;
      margin: 0 0 6pt;
      letter-spacing: 0.3pt;
    }
    .subtitle {
      text-align: center;
      text-transform: uppercase;
      font-weight: bold;
      font-size: 11pt;
      color: #6b7280;
      letter-spacing: 1pt;
      margin-bottom: 16pt;
    }
    h2 {
      font-size: 14pt;
      margin: 22pt 0 8pt;
      padding-bottom: 3pt;
      border-bottom: 1pt solid #888;
    }
    h2 .mins {
      font-weight: normal;
      font-size: 11pt;
      color: #6b7280;
      font-style: italic;
    }
    table.cover {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 12pt;
    }
    table.cover td {
      border: 0.5pt solid #888;
      padding: 5pt 8pt;
      font-size: 11pt;
      vertical-align: top;
    }
    table.cover td.label {
      width: 30%;
      background: #f3f4f6;
      font-weight: bold;
    }
    .name-block {
      width: 100%;
      border-collapse: collapse;
      margin: 8pt 0 14pt;
    }
    .name-block td {
      border: 0.5pt solid #888;
      padding: 8pt;
      font-size: 11pt;
    }
    .instructions {
      margin: 6pt 0 18pt;
      padding: 8pt 10pt;
      border-left: 3pt solid #6b7280;
      font-style: italic;
      font-size: 11pt;
      background: #fafafa;
    }
    .instructions strong {
      font-style: normal;
      display: block;
      margin-bottom: 3pt;
    }
    .question {
      margin: 14pt 0 6pt;
      page-break-inside: avoid;
    }
    .question .q-num {
      font-weight: bold;
    }
    .question .marks {
      color: #6b7280;
      font-style: italic;
      font-size: 10pt;
      margin-left: 6pt;
    }
    .options {
      margin: 4pt 0 0 22pt;
      padding: 0;
      list-style: none;
    }
    .options li {
      margin: 2pt 0;
    }
    .options li.correct {
      color: #059669;
      font-weight: bold;
    }
    .answer-line {
      border-bottom: 0.5pt solid #aaa;
      height: 14pt;
      margin: 4pt 0;
    }
    .answer-block {
      margin: 4pt 0 4pt 14pt;
    }
    .answer-block .ans {
      color: #059669;
      font-weight: bold;
    }
    .answer-block .notes {
      color: #6b7280;
      font-style: italic;
      font-size: 10pt;
      margin-top: 2pt;
    }
    .muted { color: #6b7280; font-style: italic; }
    .total {
      margin-top: 22pt;
      padding-top: 8pt;
      border-top: 1pt solid #444;
      font-weight: bold;
      font-size: 13pt;
    }
    @media print {
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h1>${includeAnswer ? `Marking Scheme — ${escapeHtml(title)}` : escapeHtml(title)}</h1>
  <div class="subtitle">${escapeHtml(typeLabel)}</div>

  ${coverRows.length ? `
  <table class="cover">
    <tbody>
      ${coverRows.map(([k, v]) => `<tr><td class="label">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}
    </tbody>
  </table>` : ''}

  ${!includeAnswer ? `
  <table class="name-block">
    <tr>
      <td>Pupil's Name: __________________________________________</td>
      <td style="width: 30%;">Score: ______ / ______</td>
    </tr>
  </table>` : ''}

  ${assessment.coverInstructions ? `
  <div class="instructions"><strong>Instructions</strong>${escapeHtml(assessment.coverInstructions)}</div>` : ''}

  ${groupsHtml}

  ${includeAnswer ? `
  <div class="total">Total marks: ${escapeHtml(String(assessment.totalMarks || 0))}</div>` : ''}
</body>
</html>`
}

function renderQuestion(q, number, includeAnswer) {
  const promptText = richTextToPlainText(q.text || '') || '(no question text)'
  const marks = q.marks ?? 1
  const type = q.type || 'mcq'

  let body = ''

  if (type === 'mcq' || type === 'tf') {
    const options = Array.isArray(q.options) ? q.options : []
    body = `<ul class="options">${options.map((opt, i) => {
      const isCorrect = includeAnswer && Number(q.correctAnswer) === i
      return `<li class="${isCorrect ? 'correct' : ''}">${letterFor(i)}. ${escapeHtml(String(opt ?? ''))}${isCorrect ? '  ✓' : ''}</li>`
    }).join('')}</ul>`
  } else if (type === 'short_answer' || type === 'short' || type === 'fill') {
    if (includeAnswer) {
      body = `<div class="answer-block"><span class="ans">✓ Answer:</span> ${escapeHtml(String(q.correctAnswer ?? ''))}</div>`
    } else {
      body = `<div class="answer-line"></div><div class="answer-line"></div>`
    }
  } else if (type === 'diagram') {
    if (includeAnswer) {
      body = `<div class="answer-block"><span class="ans">✓ Expected answer:</span> ${escapeHtml(String(q.correctAnswer ?? ''))}</div>`
    } else {
      body = `<div style="height: 50pt;"></div>`
    }
  }

  const explanation = includeAnswer ? richTextToPlainText(q.explanation || '') : ''
  const explanationHtml = explanation
    ? `<div class="answer-block"><div class="notes">Notes: ${escapeHtml(explanation)}</div></div>`
    : ''

  return `<div class="question">
    <div><span class="q-num">${number}.</span> ${escapeHtml(promptText)}<span class="marks">[${marks} mark${marks === 1 ? '' : 's'}]</span></div>
    ${body}
    ${explanationHtml}
  </div>`
}
