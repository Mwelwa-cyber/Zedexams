/**
 * Export a worksheet as a real .pdf file (not a browser print dialog).
 *
 * Two modes — same as worksheetToDocx.js:
 *   'worksheet'  — pupil-facing copy with working space, no answers.
 *   'answer_key' — teacher copy with answers highlighted in green.
 *
 * Uses htmlToPdf.js (lazy-loads html2canvas + jsPDF) so nothing extra hits
 * the main bundle. Falls back to window.print() if the real-PDF path fails.
 */
import { downloadHtmlAsPdf } from '../../utils/htmlToPdf.js'
import { injectHtmlWatermark, WATERMARK_TEXT } from '../../utils/exportWatermark.js'
import { markupToHtml, TOOL_NOTATION_CSS } from '../../utils/toolNotationRender.js'

const BRAND = '#059669' // emerald-600

const safe = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const withWatermark = (html, attribution) =>
  attribution ? injectHtmlWatermark(html, WATERMARK_TEXT) : html

/* ── Question rendering ──────────────────────────────────────────── */

const LETTERS = ['A', 'B', 'C', 'D', 'E']

function workingSpace(q) {
  const style = q.workingStyle ||
    (q.type === 'calculation' ? 'columns' :
      q.type === 'essay' ? 'lines' :
        (q.type === 'fill_in_blank' || q.type === 'short_answer') ? 'box' : 'none')

  if (style === 'columns') {
    return `
      <p class="ws-label">Working:</p>
      <div class="ws-grid"></div>
      <p>Answer: <span class="blank-long"></span></p>`
  }
  if (style === 'box') {
    return `<p>Answer: <span class="blank-long"></span></p>`
  }
  if (style === 'lines') {
    const n = q.type === 'essay' ? 5 : 3
    return Array(n).fill('<div class="ws-line"></div>').join('')
  }
  return ''
}

function renderQuestion(q, includeAnswer) {
  const marks = `<span class="marks">[${q.marks} mark${q.marks === 1 ? '' : 's'}]</span>`
  let html = `<div class="question" style="page-break-inside:avoid">
    <p class="q-prompt"><strong>${safe(q.number)}.</strong> ${markupToHtml(q.prompt)} ${marks}</p>`

  if (q.type === 'multiple_choice' || q.type === 'true_false') {
    html += '<ul class="options">'
    ;(q.options || []).forEach((opt, i) => {
      html += `<li><strong>${LETTERS[i] || '•'}.</strong> ${markupToHtml(opt)}</li>`
    })
    html += '</ul>'
  } else if (!includeAnswer) {
    html += workingSpace(q)
  }

  if (includeAnswer && q.answer) {
    html += `<p class="answer">&#10003; Answer: ${markupToHtml(q.answer)}</p>`
    if (q.workingNotes) {
      html += `<p class="notes">Notes: ${markupToHtml(q.workingNotes)}</p>`
    }
  }

  html += '</div>'
  return html
}

function renderSection(section, includeAnswer) {
  let html = `<div class="section">`
  if (section.title) html += `<h2>${safe(section.title)}</h2>`
  if (section.instructions) html += `<p class="section-instructions">${markupToHtml(section.instructions)}</p>`

  if (section.passage) {
    if (section.passageTitle) html += `<p class="passage-title"><strong>${safe(section.passageTitle)}</strong></p>`
    html += `<div class="passage">${markupToHtml(section.passage)}</div>`
  }

  if (section.layout === 'grid') {
    const cols = Math.min(4, Math.max(2, Number(section.columns) || 3))
    html += `<div class="grid-${cols}">`
    ;(section.questions || []).forEach((q) => {
      const ans = includeAnswer && q.answer
        ? `<p class="answer">&#10003; ${markupToHtml(q.answer)}</p>` : ''
      html += `<div><p><strong>${safe(q.number)}.</strong> ${markupToHtml(q.prompt)} <span class="blank"></span></p>${ans}</div>`
    })
    html += '</div>'
  } else {
    ;(section.questions || []).forEach((q) => {
      html += renderQuestion(q, includeAnswer)
    })
  }

  html += '</div>'
  return html
}

/* ── HTML template ───────────────────────────────────────────────── */

// Exported for the golden test — the same HTML both download paths use.
export function buildWorksheetPrintableHtml(worksheet, mode) {
  return buildHtml(worksheet, mode)
}

function buildHtml(worksheet, mode) {
  const includeAnswer = mode === 'answer_key'
  const h = worksheet.header || {}
  const sections = worksheet.sections || []

  const headerRows = [
    ['Subject', h.subject],
    ['Grade', h.grade],
    ['Topic', h.topic],
    h.subtopic && ['Sub-topic', h.subtopic],
    h.duration && ['Duration', h.duration],
    h.totalMarks && ['Total marks', String(h.totalMarks)],
  ].filter(Boolean).filter(([, v]) => v)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${safe(h.title || 'Worksheet')}${includeAnswer ? ' — Answer Key' : ''}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:"Times New Roman",Georgia,serif;color:#0f172a;background:#fff;font-size:11.5pt;line-height:1.5}
  body{padding:22px 30px;max-width:210mm;margin:0 auto}

  /* masthead */
  .masthead{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid ${BRAND};padding-bottom:8px;margin-bottom:14px}
  .brand{font-size:15pt;font-weight:800;color:${BRAND}}
  .brand-sub{font-size:8.5pt;color:#64748b;text-transform:uppercase;letter-spacing:.7px;margin-top:1px}
  .doc-type{font-size:9pt;color:#64748b;text-align:right}

  /* header table */
  h1{font-size:17pt;font-weight:800;color:#0f172a;margin:0 0 10px}
  table{width:100%;border-collapse:collapse;margin:0 0 12px}
  th,td{border:1px solid #cbd5e1;padding:5px 9px;text-align:left;font-size:10.5pt;vertical-align:top}
  th{background:#f1f5f9;font-weight:700;width:28%}

  /* name/score block */
  .name-block{display:grid;grid-template-columns:1fr auto auto;gap:0;border:1px solid #94a3b8;margin-bottom:14px}
  .name-block div{padding:6px 10px;font-size:10pt}
  .name-block div:not(:last-child){border-right:1px solid #94a3b8}

  /* instructions */
  .instructions{background:#f8fafc;border-left:3px solid ${BRAND};padding:7px 12px;margin-bottom:14px;font-size:10.5pt;font-style:italic}

  /* sections */
  .section{margin-bottom:16px}
  h2{font-size:11.5pt;font-weight:800;color:${BRAND};text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid ${BRAND};padding-bottom:3px;margin:12px 0 8px}

  /* passage */
  .passage-title{font-weight:700;text-align:center;margin-bottom:6px}
  .passage{border:1px solid #cbd5e1;padding:8px 12px;margin-bottom:10px;font-size:10.5pt;line-height:1.6;background:#fafafa}

  /* questions */
  .question{margin-bottom:14px;page-break-inside:avoid}
  .q-prompt{margin-bottom:5px}
  .marks{font-size:9.5pt;color:#6b7280;font-style:italic}
  .options{list-style:none;padding-left:22px;margin:4px 0}
  .options li{margin:3px 0}

  /* working space */
  .ws-label{font-size:9.5pt;color:#475569;margin:4px 0 2px}
  .ws-grid{height:52px;border:1px dashed #cbd5e1;margin:3px 0 6px;background:repeating-linear-gradient(to bottom,transparent,transparent 19px,#e2e8f0 20px)}
  .ws-line{border-bottom:1px solid #94a3b8;height:24px;margin:0 0 2px}
  .blank{display:inline-block;border-bottom:1px solid #0f172a;min-width:60px}
  .blank-long{display:inline-block;border-bottom:1px solid #0f172a;width:280px}

  /* answers (answer key mode) */
  .answer{color:#059669;font-weight:700;margin-top:5px}
  .notes{font-size:9.5pt;color:#6b7280;font-style:italic;margin-top:2px}

  /* grid layout */
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px}
  .grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px 16px}
  .grid-4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px 12px}

  /* answer key banner */
  .ak-banner{background:#f0fdf4;border:1.5px solid #86efac;border-radius:4px;padding:6px 12px;margin-bottom:14px;color:#15803d;font-weight:700;font-size:10pt}

  /* marking notes */
  .marking-notes{background:#f8fafc;border:1px solid #cbd5e1;padding:8px 12px;margin-top:16px;font-size:10.5pt}
  .marking-notes h3{font-size:10.5pt;font-weight:700;color:#334155;margin-bottom:4px}

  /* structured maths (stacked fractions, column sums) — shared stylesheet */
  ${TOOL_NOTATION_CSS}

  @media print{
    body{padding:12mm 16mm;max-width:none}
    .question{page-break-inside:avoid}
    .section{page-break-inside:auto}
    h2{page-break-after:avoid}
  }
</style>
</head>
<body>
  <div class="masthead">
    <div>
      <div class="brand">ZedExams</div>
      <div class="brand-sub">Zambian CBC · Teacher Tools</div>
    </div>
    <div class="doc-type">${includeAnswer ? 'ANSWER KEY — Teacher Copy' : 'WORKSHEET — Pupil Copy'}</div>
  </div>

  <h1>${safe(h.title || 'Worksheet')}</h1>

  ${headerRows.length ? `
  <table>
    <tbody>
      ${headerRows.map(([k, v]) => `<tr><th>${safe(k)}</th><td>${safe(v)}</td></tr>`).join('')}
    </tbody>
  </table>` : ''}

  ${!includeAnswer ? `
  <div class="name-block">
    <div>Name: __________________________________________</div>
    <div>Class: ___________</div>
    <div>Score: _______ / ${safe(h.totalMarks || '___')}</div>
  </div>` : `
  <div class="ak-banner">&#128273; Answer Key — do not distribute to pupils</div>`}

  ${h.instructions ? `<div class="instructions">${markupToHtml(h.instructions)}</div>` : ''}

  ${sections.map((s) => renderSection(s, includeAnswer)).join('')}

  ${includeAnswer && worksheet.answerKey?.markingNotes ? `
  <div class="marking-notes">
    <h3>Marking Guidance</h3>
    <p>${markupToHtml(worksheet.answerKey.markingNotes)}</p>
  </div>` : ''}
</body>
</html>`
}

/* ── Public API ──────────────────────────────────────────────────── */

export async function downloadWorksheetPdf(
  worksheet,
  filename = 'worksheet.pdf',
  { mode = 'worksheet', attribution = false } = {},
) {
  if (!worksheet) throw new Error('No worksheet to export.')
  const html = withWatermark(buildHtml(worksheet, mode), attribution)
  return downloadHtmlAsPdf(html, filename, {
    onFallback: () => printWorksheetAsPdf(worksheet, { mode, attribution }),
  })
}

export function printWorksheetAsPdf(worksheet, { mode = 'worksheet', attribution = false } = {}) {
  if (!worksheet) throw new Error('No worksheet to export.')
  const win = window.open('', '_blank', 'width=900,height=1100')
  if (!win) throw new Error('Your browser blocked the print window. Please allow pop-ups and try again.')
  const html = withWatermark(buildHtml(worksheet, mode), attribution)
  win.document.open()
  win.document.write(html)
  win.document.close()
  const ready = () => { try { win.focus(); win.print() } catch { /* leave for manual print */ } }
  if (win.document.readyState === 'complete') setTimeout(ready, 120)
  else win.addEventListener('load', () => setTimeout(ready, 120))
}
