/**
 * Notes as a real .pdf — one entry point, two documents behind it.
 *
 * A LEARNER note prints through `learnerNotesPrintable`, the same builder the
 * paged preview renders and the page measurement measures, so the PDF is the
 * preview and the preview is the PDF. A TEACHING note prints through the
 * builder below, unchanged since before the audience split: portrait,
 * school-printed handout style mirroring notesToDocx.js / NotesView — school
 * heading, ruled "<SUBJECT> TEACHING NOTES" title, borderless metadata strip,
 * then the teaching sections.
 *
 * The audience is read from the DOCUMENT, never from a caller's argument. A
 * saved note carries what it is; asking the call site to remember is how a
 * learner handout ends up printed with a teacher's section headings.
 */
import { makePdfExporter, escapeHtml as safe } from '../../utils/htmlPdfExport.js'
import { readAudience } from '../../utils/notesOptions.js'
import {
  buildAnswerPageHtml,
  buildLearnerNotesHtml,
} from '../../utils/learnerNotesPrintable.js'

const INK = '#0e2a32' // brand ink, matches the DOCX title rules

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const bullets = (items) => (items || []).length
  ? `<ul>${items.map((i) => `<li>${safe(i)}</li>`).join('')}</ul>`
  : ''

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
  if (!rows.length) return ''
  return `<table class="meta"><tbody>
    ${rows.map(([k, v]) => `<tr><td class="k">${safe(k)}:</td><td>${safe(v)}</td></tr>`).join('')}
  </tbody></table>`
}

// Exported for the plain-node export tests — pure string builder, no DOM.
export function buildNotesPrintableHtml(notes) {
  const header = notes.header || {}
  const subjectLabel = formatSubject(header.subject)
  const docTitle = subjectLabel ? `${subjectLabel} Teaching Notes` : 'Teaching Notes'
  const intro = notes.introduction || {}
  const sections = []

  if (intro.hook || intro.whyItMatters || intro.priorKnowledge) {
    let s = '<h2>Lesson Opener</h2>'
    if (intro.hook) s += `<h3>Hook</h3><p>${safe(intro.hook)}</p>`
    if (intro.whyItMatters) s += `<h3>Why it matters</h3><p>${safe(intro.whyItMatters)}</p>`
    if (intro.priorKnowledge) s += `<h3>Prior knowledge</h3><p>${safe(intro.priorKnowledge)}</p>`
    sections.push(s)
  }

  if (notes.keyConcepts?.length) {
    sections.push('<h2>Key Concepts</h2>' + notes.keyConcepts.map((c, i) => `
      <div class="concept">
        <p class="concept-name">${i + 1}. ${safe(c.name)}</p>
        ${c.explanation ? `<p>${safe(c.explanation)}</p>` : ''}
      </div>`).join(''))
  }

  if (notes.workedExamples?.length) {
    sections.push('<h2>Worked Examples</h2>' + notes.workedExamples.map((w, i) => `
      <div class="example">
        <h3>Example ${i + 1}</h3>
        <p class="problem">${safe(w.problem)}</p>
        ${(w.steps || []).length ? `<ol>${w.steps.map((s) => `<li>${safe(s)}</li>`).join('')}</ol>` : ''}
        ${w.answer ? `<p><strong>Answer:</strong> ${safe(w.answer)}</p>` : ''}
      </div>`).join(''))
  }

  if (notes.studentQuestions?.length) {
    sections.push('<h2>Common Student Questions</h2>' + notes.studentQuestions.map((q) => `
      <div class="qa">
        <p><strong>Q: ${safe(q.question)}</strong></p>
        <p>A: ${safe(q.answer)}</p>
      </div>`).join(''))
  }

  if (notes.misconceptions?.length) {
    sections.push('<h2>Misconceptions to Watch For</h2>' + notes.misconceptions.map((m) => `
      <div class="qa">
        <p>&#9888;&#65039; <strong>${safe(m.misconception)}</strong></p>
        <p><strong>Correction:</strong> ${safe(m.correction)}</p>
      </div>`).join(''))
  }

  if (notes.discussionPrompts?.length) sections.push('<h2>Discussion Prompts</h2>' + bullets(notes.discussionPrompts))
  if (notes.quickChecks?.length) sections.push('<h2>Quick Checks</h2>' + bullets(notes.quickChecks))

  if (notes.glossary?.length) {
    sections.push('<h2>Glossary</h2>' + notes.glossary.map((g) =>
      `<p class="gloss"><strong>${safe(g.term)}:</strong> ${safe(g.definition)}</p>`).join(''))
  }

  if (notes.references?.length) sections.push('<h2>References</h2>' + bullets(notes.references))

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${safe(docTitle)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:"Times New Roman",Georgia,serif;color:#0f172a;background:#fff;font-size:11.5pt;line-height:1.5}
  body{padding:22px 30px;max-width:210mm;margin:0 auto}

  .school{text-align:center;font-weight:800;font-size:15pt;margin-bottom:4px}
  h1{font-size:13pt;font-weight:800;color:${INK};text-align:center;letter-spacing:.1em;text-transform:uppercase;border-top:2px solid ${INK};border-bottom:2px solid ${INK};display:table;margin:0 auto 12px;padding:4px 18px}

  /* borderless "Label: value" strip ruled top and bottom, like the DOCX */
  table.meta{width:100%;border-collapse:collapse;border-top:2px solid ${INK};border-bottom:2px solid ${INK};margin:0 0 14px}
  table.meta td{border:0;padding:3px 0;font-size:10.5pt;vertical-align:top}
  table.meta td.k{width:26%;font-weight:700}

  h2{font-size:12pt;font-weight:800;color:${INK};border-bottom:1px solid #cbd5e1;padding-bottom:3px;margin:16px 0 8px}
  h3{font-size:10.5pt;font-weight:700;color:#334155;margin:10px 0 4px}
  p{margin:4px 0}
  ul,ol{margin:4px 0 6px 22px}
  li{margin:2px 0}

  .concept{margin-bottom:10px}
  .concept-name{font-weight:700;font-size:11.5pt;margin-bottom:3px}
  .problem{font-weight:700}
  .gloss{margin:3px 0}

  /* Keep these out of @media print: the PDF download rasterises in screen
     media and reads these computed styles to decide where NOT to cut a page. */
  .concept{page-break-inside:avoid;break-inside:avoid}
  .example{page-break-inside:avoid;break-inside:avoid}
  .qa{page-break-inside:avoid;break-inside:avoid;margin-bottom:8px}
  table.meta{page-break-inside:avoid;break-inside:avoid}

  @media print{
    body{padding:14mm 16mm;max-width:none}
    h2{page-break-after:avoid}
  }
</style>
</head>
<body>
  ${header.school ? `<p class="school">${safe(header.school)}</p>` : ''}
  <h1>${safe(docTitle)}</h1>
  ${metaStrip(header)}
  ${sections.join('\n')}
</body>
</html>`
}

/**
 * The printable HTML for whichever kind of notes this is.
 *
 * Exported for the plain-node tests — pure string building, no DOM.
 */
export function buildAnyNotesPrintableHtml(notes) {
  return readAudience(notes) === 'learner'
    ? buildLearnerNotesHtml(notes)
    : buildNotesPrintableHtml(notes)
}

const exporter = makePdfExporter(buildAnyNotesPrintableHtml, { emptyMessage: 'No notes to export.' })

// The answer page is its own exporter because it is its own FILE. Routing it
// through the exporter above with a flag would put one keystroke between a
// teacher and forty photocopies of the answers.
const answerExporter = makePdfExporter(buildAnswerPageHtml, { emptyMessage: 'No answer page to export.' })

/**
 * Download the teaching notes as a real .pdf file. Falls back to the browser
 * print dialog if client-side rendering fails.
 */
export async function downloadNotesPdf(notes, filename = 'teacher-notes.pdf', { attribution = false } = {}) {
  return exporter.download(notes, filename, { attribution })
}

export function printNotesPdf(notes, { attribution = false } = {}) {
  return exporter.print(notes, { attribution })
}

/** The teacher's answer page as its own .pdf — never appended to the learner's. */
export async function downloadAnswerPagePdf(notes, filename = 'answers.pdf', { attribution = false } = {}) {
  return answerExporter.download(notes, filename, { attribution })
}
