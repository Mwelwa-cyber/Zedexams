/**
 * Export one ECZ School Based Assessment task as a real .pdf.
 *
 * The task sheet renders through the SAME paper-layout blocks the studio
 * preview and the DOCX export walk (`buildSbaPaperBlocks`), so the download
 * looks like a real exam paper: marble-style banner, NAME/DATE/CLASS,
 * instructions, numbered tasks with ruled answer space, "END OF PAPER" and a
 * footer code. Library diagrams (`imageDiagram`) render as the catalog's
 * inline SVG — the same source PaperBlocks.jsx draws.
 *
 * The teacher copy (`includeAnswers: true`) appends the marking scheme on a
 * new page: teacher-only metadata, administration guidance, model answers +
 * per-step mark allocation, and the rubric/criteria table — mirroring
 * sbaTaskToDocx.js / SbaTaskView.
 */
import { makePdfExporter, escapeHtml as safe } from '../../utils/htmlPdfExport.js'
import { buildSbaPaperBlocks } from '../../shared/utils/sbaTaskToPaper.js'
import { renderDiagramSvg } from '../../components/diagrams/diagramCatalog.js'

const STYLE_LABELS = {
  answer_key: 'Answer key',
  oral_observation: 'Oral observation sheet',
  method_marks: 'Method & accuracy marks',
  experiment_rubric: 'Experiment rubric',
  project_rubric: 'Project rubric',
  competence_rubric: 'Competence rubric',
  criteria_rubric: 'Marking criteria',
}

/* ── Paper blocks → HTML ─────────────────────────────────────────── */

function diagramHtml(imageDiagram) {
  if (!imageDiagram?.libraryKey) return ''
  const svg = renderDiagramSvg(imageDiagram.libraryKey, imageDiagram.params, '#1c1612')
  if (!svg) return ''
  return `<div class="q-diagram">${svg}</div>`
}

function answerLines(count) {
  const n = Math.max(1, Math.min(20, Number(count) || 2))
  return `<div class="answer-lines">${Array.from({ length: n }).map(() => '<div class="answer-line"></div>').join('')}</div>`
}

function renderHeaderBlock(b) {
  return `<div class="banner">
    <div class="school">${safe(b.schoolName || 'YOUR SCHOOL NAME').toUpperCase()}</div>
    <div class="paper-title">${safe(b.title)}</div>
    ${b.subject ? `<div class="subject">${safe(b.subject)}</div>` : ''}
    ${b.paperName ? `<div class="paper-name">${safe(b.paperName)}</div>` : ''}
  </div>`
}

function renderLearnerFields(b) {
  const parts = []
  if (b.name) parts.push('<span>NAME:</span><div class="line"></div>')
  if (b.date) parts.push('<span>DATE:</span><div class="line short"></div>')
  const row1 = parts.length ? `<div class="learner-row">${parts.join('')}</div>` : ''
  const row2 = b.classField ? '<div class="learner-row"><span>CLASS:</span><div class="line"></div></div>' : ''
  const marks = b.marks
    ? `<div class="total-marks">TOTAL MARKS: _____________ &nbsp; / &nbsp; ${safe(b.totalMarks ?? '____')}</div>` : ''
  return [row1, row2, marks].filter(Boolean).join('\n')
}

function renderInstructions(b) {
  if (!b.text) return ''
  const items = String(b.text).split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const content = items.length > 1
    ? `<ol>${items.map((i) => `<li>${safe(i)}</li>`).join('')}</ol>`
    : `<p>${safe(b.text)}</p>`
  return `<div class="instructions">${content}</div>`
}

function renderPassage(b) {
  return `<div class="passage">
    ${b.title ? `<strong class="h">${safe(b.title)}</strong>` : ''}
    ${b.text ? b.text.split(/\n\s*\n/).map((p) => `<p>${safe(p)}</p>`).join('') : ''}
    ${diagramHtml(b.imageDiagram)}
  </div>`
}

function renderQuestion(b) {
  const marks = Number(b.marks) || 0
  const qmark = marks > 0 ? `<em class="qmarks">(${marks}&nbsp;mark${marks === 1 ? '' : 's'})</em>` : ''
  return `<div class="question">
    <p class="qline"><strong>${safe(b.number)}.</strong> ${safe(b.text)} ${qmark}</p>
    ${diagramHtml(b.imageDiagram)}
    ${answerLines(b.answerLines)}
  </div>`
}

function renderBlock(block) {
  switch (block.kind) {
    case 'header': return renderHeaderBlock(block)
    case 'learnerFields': return renderLearnerFields(block)
    case 'instructions': return renderInstructions(block)
    case 'passage': return renderPassage(block)
    case 'question': return renderQuestion(block)
    case 'endOfPaper': return `<div class="end-of-paper">${safe(block.text)}</div>`
    case 'footerCode': return `<div class="footer-code">${safe(block.code)}</div>`
    default: return ''
  }
}

/* ── Marking scheme (teacher copy) ───────────────────────────────── */

function teacherMetaTable(header = {}) {
  const rows = [
    ['Task type', header.taskType],
    ['CTS component', header.component],
    ['Language skill', header.skill],
    ['Bloom level(s)', (header.bloomLevels || []).join(', ')],
    ['Syllabus outcome(s)', (header.outcomeRefs || []).join(', ')],
  ].filter(([, v]) => v)
  if (!rows.length) return ''
  return `<table class="meta"><tbody>
    ${rows.map(([k, v]) => `<tr><th>${safe(k)}</th><td>${safe(v)}</td></tr>`).join('')}
  </tbody></table>`
}

function modelAnswers(questions) {
  return questions.map((q) => `
    <div class="ms-question">
      <p><strong>${safe(q.number)}.</strong> ${safe(q.prompt)} ${q.marks ? `<span class="qmarks">[${safe(q.marks)}]</span>` : ''}</p>
      ${q.answer ? `<p class="ms-answer"><strong>Answer:</strong> ${safe(q.answer)}</p>` : ''}
      ${(q.markAllocation || []).length ? `<ul class="ms-alloc">
        ${q.markAllocation.map((m) => `<li>${safe(m.description)}${m.marks ? ` <strong>(${safe(m.marks)})</strong>` : ''}</li>`).join('')}
      </ul>` : ''}
    </div>`).join('')
}

function criteriaTable(criteria) {
  const total = criteria.reduce((s, c) => s + (Number(c.maxMarks) || 0), 0)
  return `<table class="criteria">
    <thead><tr>
      <th style="width:40%">Marking criterion</th>
      <th style="width:12%">Marks</th>
      <th style="width:48%">What earns the marks</th>
    </tr></thead>
    <tbody>
      ${criteria.map((c) => `<tr>
        <td><strong>${safe(c.name)}</strong></td>
        <td class="num">${safe(c.maxMarks)}</td>
        <td>${safe(c.descriptor || '—')}</td>
      </tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${total}</td><td></td></tr>
    </tbody>
  </table>`
}

function markingSchemeHtml(task) {
  const header = task.header || {}
  const ms = task.markingScheme || {}
  const questions = Array.isArray(task.questions) ? task.questions : []
  const hasAnswers = questions.some((q) => q.answer || (q.markAllocation || []).length > 0)
  const hasCriteria = Array.isArray(ms.criteria) && ms.criteria.length > 0
  const administration = String(task.administration || '').trim()
  const meta = teacherMetaTable(header)
  if (!hasAnswers && !hasCriteria && !ms.notes && !administration && !meta) return ''

  return `<div class="marking-scheme">
    <h2 class="ms-title">Marking scheme &mdash; ${safe(STYLE_LABELS[ms.style] || 'Marking')}</h2>
    <p class="ms-sub">Teacher copy &mdash; School Based Assessment (ECZ)</p>
    ${meta}
    ${administration ? `<h3>How to administer this task</h3>
      ${administration.split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${safe(p.replace(/\n/g, ' '))}</p>`).join('')}` : ''}
    ${hasAnswers ? `<h3>Model answers &amp; mark allocation</h3>${modelAnswers(questions)}` : ''}
    ${(hasCriteria || ms.notes) ? `<h3>How to award the marks</h3>
      ${ms.notes ? `<p>${safe(ms.notes)}</p>` : ''}
      ${hasCriteria ? criteriaTable(ms.criteria) : ''}` : ''}
  </div>`
}

/* ── Document ────────────────────────────────────────────────────── */

// Exported for the plain-node export tests — pure string builder, no DOM.
export function buildSbaTaskPrintableHtml(task, { includeAnswers = false, schoolName = '' } = {}) {
  const header = task.header || {}
  const blocks = buildSbaPaperBlocks(task, { schoolName: schoolName || header.schoolName || '' })
  const paper = blocks.map(renderBlock).join('\n')
  const scheme = includeAnswers ? markingSchemeHtml(task) : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${safe(header.title || 'SBA Task')}${includeAnswers ? ' — Teacher Copy' : ''}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:"Times New Roman","Liberation Serif",Georgia,serif;color:#111;background:#fff;font-size:11.5pt;line-height:1.45}
  body{padding:22px 30px;max-width:210mm;margin:0 auto}

  /* banner */
  .banner{text-align:center;border-bottom:1.5px solid #777;padding-bottom:8px;margin-bottom:10px}
  .banner .school{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:13.5pt;letter-spacing:.3pt;text-transform:uppercase}
  .banner .paper-title{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:10.5pt;margin-top:8px;letter-spacing:.2pt;text-transform:uppercase}
  .banner .subject{font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:21pt;margin-top:14px;line-height:1.1}
  .banner .paper-name{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:11pt;margin-top:5pt;text-transform:uppercase}

  /* learner fields */
  .learner-row{display:flex;justify-content:space-between;gap:18pt;font-size:11pt;margin:10pt 0 4pt;align-items:flex-end}
  .learner-row span{white-space:nowrap;font-weight:600}
  .learner-row .line{flex:1;border-bottom:1px solid #000;height:14pt}
  .learner-row .line.short{max-width:140pt}
  .total-marks{text-align:right;font-size:11pt;font-weight:600;margin:4pt 0 12pt}

  .instructions{margin:0 0 12pt;font-size:11pt;line-height:1.5}
  .instructions ol{margin:0;padding-left:18pt}
  .instructions li{margin:0 0 6pt}
  .instructions p{margin:0 0 6pt}

  .passage{background:#fafafa;border:1px solid #ccc;padding:10pt 14pt;margin:8pt 0 14pt;font-size:11pt;line-height:1.6}
  .passage .h{display:block;font-size:10pt;text-transform:uppercase;letter-spacing:.4pt;margin-bottom:6pt;font-weight:700}
  .passage p{margin:0 0 6pt}

  .question{margin:10pt 0 12pt}
  .qline{font-size:11.5pt;line-height:1.5}
  .qmarks{white-space:nowrap;font-style:italic;color:#555;font-size:10pt;margin-left:4pt}
  .q-diagram{text-align:center;margin:6pt 0}
  .q-diagram svg{max-width:70%;height:auto}
  .answer-lines{margin:6pt 0 8pt}
  .answer-line{border-bottom:1px solid #000;height:18pt;margin-bottom:4pt}

  .end-of-paper{text-align:center;margin-top:18pt;padding-top:8pt;border-top:1pt solid #000;font-style:italic;font-size:10pt;color:#555}
  .footer-code{text-align:right;margin-top:14pt;font-size:9.5pt;color:#333}

  /* marking scheme (teacher copy) — starts on its own page */
  .marking-scheme{page-break-before:always;break-before:page;padding-top:8pt}
  .ms-title{font-size:14pt;font-weight:800;color:#0e2a32;text-align:center;margin:0 0 2pt}
  .ms-sub{text-align:center;font-style:italic;font-size:9pt;color:#6b7280;margin-bottom:12pt}
  .marking-scheme h3{font-size:11.5pt;font-weight:700;color:#0e2a32;border-bottom:1px solid #ccc;padding-bottom:3pt;margin:14pt 0 6pt}
  .marking-scheme p{margin:4pt 0}
  table.meta{width:80%;border-collapse:collapse;margin:0 0 8pt}
  table.meta th,table.meta td{border:1px solid #94a3b8;padding:4pt 8pt;text-align:left;font-size:10pt;vertical-align:top}
  table.meta th{background:#f3f4f6;font-weight:700;width:34%}
  .ms-question{margin:8pt 0}
  .ms-answer{color:#047857;margin-left:14pt}
  .ms-alloc{margin:2pt 0 0 28pt;font-size:10pt;color:#555}
  table.criteria{width:100%;border-collapse:collapse;margin-top:6pt}
  table.criteria th,table.criteria td{border:1px solid #94a3b8;padding:4pt 8pt;text-align:left;font-size:10pt;vertical-align:top}
  table.criteria th{background:#e2e8f0;font-weight:700}
  table.criteria td.num{text-align:center;font-weight:700}
  table.criteria tr.total td{background:#f8fafc;font-weight:700}

  /* Keep these out of @media print: the PDF download rasterises in screen
     media and reads these computed styles to decide where NOT to cut a page. */
  .banner{page-break-inside:avoid;break-inside:avoid}
  .passage{page-break-inside:avoid;break-inside:avoid}
  .question{page-break-inside:avoid;break-inside:avoid}
  .ms-question{page-break-inside:avoid;break-inside:avoid}
  tr{page-break-inside:avoid;break-inside:avoid}
  thead{display:table-header-group}

  @media print{ body{padding:14mm 16mm;max-width:none} }
</style>
</head>
<body>
${paper}
${scheme}
</body>
</html>`
}

const exporter = makePdfExporter(buildSbaTaskPrintableHtml, { emptyMessage: 'No SBA task to export.' })

/**
 * Download the SBA task as a real .pdf file. `includeAnswers: true` appends
 * the teacher marking scheme on its own page. Falls back to the browser print
 * dialog if client-side rendering fails.
 */
export async function downloadSbaTaskPdf(
  task,
  filename = 'sba-task.pdf',
  { attribution = false, includeAnswers = false, schoolName = '' } = {},
) {
  return exporter.download(task, filename, { attribution, includeAnswers, schoolName })
}

export function printSbaTaskPdf(task, { attribution = false, includeAnswers = false, schoolName = '' } = {}) {
  return exporter.print(task, { attribution, includeAnswers, schoolName })
}
