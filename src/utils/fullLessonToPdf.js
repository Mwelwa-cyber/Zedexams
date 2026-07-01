/**
 * Export a Full Lesson as a real .pdf — portrait, school-printed style
 * mirroring fullLessonToDocx.js / FullLessonView: title, metadata table,
 * objectives, vocabulary, introduction, teaching content, worked examples,
 * guided practice, learner activities, formative checks (+ answer key),
 * summary, homework and references.
 */
import { makePdfExporter, escapeHtml as safe } from './htmlPdfExport.js'

const BRAND = '#059669'

const bullets = (items) => (items || []).length
  ? `<ul>${items.map((i) => `<li>${safe(i)}</li>`).join('')}</ul>`
  : ''

const numbered = (items) => (items || []).length
  ? `<ol>${items.map((i) => `<li>${safe(i)}</li>`).join('')}</ol>`
  : ''

function metadataRows(header) {
  return [
    ['Topic', header.topic],
    ['Sub-topic', header.subtopic],
    ['Grade', header.grade],
    ['Subject', header.subject],
    ['Term', header.term ? `Term ${header.term}` : ''],
    ['Duration', header.durationMinutes ? `${header.durationMinutes} min` : ''],
    ['Medium', header.language],
  ].filter(([, v]) => v)
}

// Exported for the plain-node export tests — pure string builder, no DOM.
export function buildFullLessonPrintableHtml(lesson) {
  const header = lesson.header || {}
  const intro = lesson.introduction || {}
  const a = lesson.assessment || {}
  const hw = lesson.homework || {}
  const sections = []

  if (lesson.objectives?.length) sections.push('<h2>Lesson Objectives</h2>' + bullets(lesson.objectives))

  if (lesson.keyVocabulary?.length) {
    sections.push('<h2>Key Vocabulary</h2>' + lesson.keyVocabulary.map((g) =>
      `<p class="vocab"><strong>${safe(g.term)}:</strong> ${safe(g.definition)}</p>`).join(''))
  }

  if (intro.hook || intro.priorKnowledge) {
    let s = '<h2>Introduction</h2>'
    if (intro.hook) s += `<h3>Hook</h3><p>${safe(intro.hook)}</p>`
    if (intro.priorKnowledge) s += `<h3>Prior knowledge</h3><p>${safe(intro.priorKnowledge)}</p>`
    sections.push(s)
  }

  if (lesson.teaching?.length) {
    sections.push('<h2>Lesson Content</h2>' + lesson.teaching.map((t) => `
      ${t.heading ? `<h3>${safe(t.heading)}</h3>` : ''}
      ${t.explanation ? `<p>${safe(t.explanation)}</p>` : ''}`).join(''))
  }

  if (lesson.workedExamples?.length) {
    sections.push('<h2>Worked Examples</h2>' + lesson.workedExamples.map((w, i) => `
      <div class="example">
        <h3>Example ${i + 1}</h3>
        ${w.problem ? `<p class="problem">${safe(w.problem)}</p>` : ''}
        ${numbered(w.steps)}
        ${w.answer ? `<p><strong>Answer:</strong> ${safe(w.answer)}</p>` : ''}
      </div>`).join(''))
  }

  if (lesson.guidedPractice?.length) sections.push('<h2>Guided Practice</h2>' + numbered(lesson.guidedPractice))
  if (lesson.learnerActivities?.length) sections.push('<h2>Learner Activities</h2>' + bullets(lesson.learnerActivities))

  if (a.checks?.length) {
    let s = '<h2>Formative Checks</h2>' + numbered(a.checks)
    if (a.answers?.length) s += '<h3>Answer Key</h3>' + numbered(a.answers)
    sections.push(s)
  }

  if (lesson.summary) sections.push(`<h2>Summary</h2><p>${safe(lesson.summary)}</p>`)

  if (hw.task) {
    let s = `<h2>Homework</h2><p>${safe(hw.task)}</p>`
    if (hw.answerGuide) s += `<h3>Answer guide</h3><p>${safe(hw.answerGuide)}</p>`
    sections.push(s)
  }

  if (lesson.references?.length) sections.push('<h2>References</h2>' + bullets(lesson.references))

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${safe(header.title || 'Lesson')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:"Times New Roman",Georgia,serif;color:#0f172a;background:#fff;font-size:11.5pt;line-height:1.5}
  body{padding:22px 30px;max-width:210mm;margin:0 auto}

  .masthead{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid ${BRAND};padding-bottom:8px;margin-bottom:14px}
  .brand{font-size:15pt;font-weight:800;color:${BRAND}}
  .brand-sub{font-size:8.5pt;color:#64748b;text-transform:uppercase;letter-spacing:.7px;margin-top:1px}
  .doc-type{font-size:9pt;color:#64748b;text-align:right}

  h1{font-size:17pt;font-weight:800;text-align:center;margin:0 0 12px}
  h2{font-size:11.5pt;font-weight:800;color:${BRAND};text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid ${BRAND};padding-bottom:3px;margin:16px 0 8px}
  h3{font-size:10.5pt;font-weight:700;color:#334155;margin:10px 0 4px}
  p{margin:4px 0}
  ul,ol{margin:4px 0 6px 22px}
  li{margin:2px 0}

  table{width:100%;border-collapse:collapse;margin:0 0 12px}
  th,td{border:1px solid #cbd5e1;padding:5px 9px;text-align:left;font-size:10.5pt;vertical-align:top}
  th{background:#f1f5f9;font-weight:700;width:28%}

  .vocab{margin:3px 0}
  .problem{font-weight:700}

  /* Keep these out of @media print: the PDF download rasterises in screen
     media and reads these computed styles to decide where NOT to cut a page. */
  .example{page-break-inside:avoid;break-inside:avoid;margin-bottom:8px}
  table{page-break-inside:avoid;break-inside:avoid}

  @media print{
    body{padding:14mm 16mm;max-width:none}
    h2{page-break-after:avoid}
  }
</style>
</head>
<body>
  <div class="masthead">
    <div>
      <div class="brand">ZedExams</div>
      <div class="brand-sub">Zambian CBC &middot; Teacher Tools</div>
    </div>
    <div class="doc-type">FULL LESSON</div>
  </div>

  <h1>${safe(header.title || 'Lesson')}</h1>

  <table><tbody>
    ${metadataRows(header).map(([k, v]) => `<tr><th>${safe(k)}</th><td>${safe(v)}</td></tr>`).join('')}
  </tbody></table>

  ${sections.join('\n')}
</body>
</html>`
}

const exporter = makePdfExporter(buildFullLessonPrintableHtml, { emptyMessage: 'No lesson to export.' })

/**
 * Download the full lesson as a real .pdf file. Falls back to the browser
 * print dialog if client-side rendering fails.
 */
export async function downloadFullLessonPdf(lesson, filename = 'lesson.pdf', { attribution = false } = {}) {
  return exporter.download(lesson, filename, { attribution })
}

export function printFullLessonPdf(lesson, { attribution = false } = {}) {
  return exporter.print(lesson, { attribution })
}
