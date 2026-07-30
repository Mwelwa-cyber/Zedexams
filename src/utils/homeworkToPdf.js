/**
 * Export Homework as a real .pdf — mirrors homeworkToDocx.js: title, metadata
 * table, instructions, numbered questions, parent note, and (teacher copy
 * only, `includeAnswers: true`) the answer key with working/marking notes.
 * The pupil sheet (`includeAnswers: false`, the default) omits the answers so
 * a take-home copy doesn't ship the key.
 */
import { makePdfExporter, escapeHtml as safe } from './htmlPdfExport.js'
import { markupToHtml, TOOL_NOTATION_CSS } from './toolNotationRender.js'

const BRAND = '#059669'

function metadataRows(header) {
  return [
    ['Topic', header.topic],
    ['Sub-topic', header.subtopic],
    ['Grade', header.grade],
    ['Subject', header.subject],
    ['Term', header.term ? `Term ${header.term}` : ''],
    ['Time', header.estimatedMinutes ? `${header.estimatedMinutes} min` : ''],
  ].filter(([, v]) => v)
}

// Exported for the plain-node export tests — pure string builder, no DOM.
export function buildHomeworkPrintableHtml(hw, { includeAnswers = false } = {}) {
  const header = hw.header || {}
  const questions = hw.questions || []

  const questionList = questions.map((q, i) => `
    <div class="question">
      <p><strong>${safe(q.number || i + 1)}.</strong> ${markupToHtml(q.prompt)}</p>
    </div>`).join('')

  const answerKey = includeAnswers ? `
    <h2>Answer Key (teacher)</h2>
    ${questions.map((q, i) => `
      <div class="answer">
        <p><strong>${safe(q.number || i + 1)}.</strong> <span class="answer-text">${markupToHtml(q.answer || '—')}</span></p>
        ${q.workingNotes ? `<p class="working">${markupToHtml(q.workingNotes)}</p>` : ''}
      </div>`).join('')}
    ${hw.answerKey?.markingNotes ? `<div class="marking-notes"><strong>Marking notes:</strong> ${safe(hw.answerKey.markingNotes)}</div>` : ''}
  ` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${safe(header.title || 'Homework')}${includeAnswers ? ' — Teacher Copy' : ''}</title>
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

  table{width:100%;border-collapse:collapse;margin:0 0 12px}
  th,td{border:1px solid #cbd5e1;padding:5px 9px;text-align:left;font-size:10.5pt;vertical-align:top}
  th{background:#f1f5f9;font-weight:700;width:28%}

  .name-block{display:flex;justify-content:space-between;gap:16px;border:1px solid #94a3b8;padding:6px 10px;font-size:10pt;margin-bottom:14px}
  .instructions{background:#f8fafc;border-left:3px solid ${BRAND};padding:7px 12px;margin-bottom:14px;font-size:10.5pt;font-style:italic}

  .question{margin-bottom:12px}
  .parent-note{background:#fffbeb;border:1px solid #fcd34d;padding:8px 12px;font-size:10.5pt}

  .ak-banner{background:#f0fdf4;border:1.5px solid #86efac;border-radius:4px;padding:6px 12px;margin-bottom:14px;color:#15803d;font-weight:700;font-size:10pt}
  .answer{margin-bottom:8px}
  .answer-text{color:${BRAND};font-weight:700}
  .working{font-size:9.5pt;color:#6b7280;font-style:italic;margin-left:18px}
  .marking-notes{background:#f8fafc;border:1px solid #cbd5e1;padding:8px 12px;margin-top:12px;font-size:10.5pt}

  /* Keep these out of @media print: the PDF download rasterises in screen
     media and reads these computed styles to decide where NOT to cut a page. */
  .question{page-break-inside:avoid;break-inside:avoid}
  .answer{page-break-inside:avoid;break-inside:avoid}
  .parent-note{page-break-inside:avoid;break-inside:avoid}
  table{page-break-inside:avoid;break-inside:avoid}

  ${TOOL_NOTATION_CSS}

  @media print{
    body{padding:12mm 16mm;max-width:none}
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
    <div class="doc-type">${includeAnswers ? 'HOMEWORK — Teacher Copy' : 'HOMEWORK — Pupil Copy'}</div>
  </div>

  <h1>${safe(header.title || 'Homework')}</h1>

  <table><tbody>
    ${metadataRows(header).map(([k, v]) => `<tr><th>${safe(k)}</th><td>${safe(v)}</td></tr>`).join('')}
  </tbody></table>

  ${!includeAnswers ? `
  <div class="name-block">
    <div>Name: __________________________________________</div>
    <div>Class: ___________</div>
    <div>Date: ___________</div>
  </div>` : `
  <div class="ak-banner">&#128273; Teacher copy — includes the answer key</div>`}

  ${hw.instructions ? `<div class="instructions">${safe(hw.instructions)}</div>` : ''}

  <h2>Questions</h2>
  ${questionList}

  ${hw.parentNote ? `
  <h2>Note for Parent / Guardian</h2>
  <div class="parent-note">${safe(hw.parentNote)}</div>` : ''}

  ${answerKey}
</body>
</html>`
}

const exporter = makePdfExporter(buildHomeworkPrintableHtml, { emptyMessage: 'No homework to export.' })

/**
 * Download the homework as a real .pdf file. `includeAnswers: true` appends
 * the teacher answer key (answers + working + marking notes). Falls back to
 * the browser print dialog if client-side rendering fails.
 */
export async function downloadHomeworkPdf(hw, filename = 'homework.pdf', { attribution = false, includeAnswers = false } = {}) {
  return exporter.download(hw, filename, { attribution, includeAnswers })
}

export function printHomeworkPdf(hw, { attribution = false, includeAnswers = false } = {}) {
  return exporter.print(hw, { attribution, includeAnswers })
}
