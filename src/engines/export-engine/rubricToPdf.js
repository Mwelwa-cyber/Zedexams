/**
 * Export a rubric as a real .pdf — the criterion × level matrix mirroring
 * rubricToDocx.js / RubricView. The criteria table is wide, so the print
 * fallback uses A4 landscape (the classTimetableToPdf precedent); the real-PDF
 * path renders it as a compact full-width table on the A4 canvas.
 */
import { makePdfExporter, escapeHtml as safe } from '../../utils/htmlPdfExport.js'

const BRAND = '#059669'

// Standard CBC level tints (match rubricToDocx LEVEL_FILL / RubricView colours).
const LEVEL_FILL = {
  'Excellent':         '#ecfdf5',
  'Good':              '#f0f9ff',
  'Satisfactory':      '#fffbeb',
  'Needs Improvement': '#fff1f2',
}
const STANDARD_LEVELS = ['Excellent', 'Good', 'Satisfactory', 'Needs Improvement']

// Some rubrics use the ECZ grade ladder (Distinction … Fail) instead of the
// four standard CBC levels — derive the columns from the data so both render.
function levelNames(criteria) {
  const first = (criteria[0]?.levels || []).map((l) => l.levelName).filter(Boolean)
  return first.length ? first : STANDARD_LEVELS
}

function metadataRows(header) {
  return [
    ['Task', header.taskDescription || header.taskType],
    ['Grade', header.grade],
    ['Subject', header.subject],
    ['Task type', header.taskType],
    ['Total marks', header.totalMarks],
    ['Assessment', header.assessmentType],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')
}

function criteriaTable(criteria, names) {
  const tint = (name) => LEVEL_FILL[name] ? ` style="background:${LEVEL_FILL[name]}"` : ''
  const head = `<tr>
    <th class="crit-col">Criterion</th>
    <th class="marks-col">Marks</th>
    ${names.map((n) => `<th${tint(n)}>${safe(n)}</th>`).join('')}
  </tr>`

  const rows = criteria.map((c) => {
    const comp = c.keyCompetencies?.length
      ? `<div class="competencies">${safe(c.keyCompetencies.join(' · '))}</div>` : ''
    const levelCell = (name) => {
      const lvl = (c.levels || []).find((l) => l.levelName === name) || {}
      const marks = lvl.marks ?? '&mdash;'
      return `<td${tint(name)}>
        <div class="lvl-marks">${typeof marks === 'number' ? safe(marks) : marks} marks</div>
        <div class="lvl-desc">${safe(lvl.descriptor || '—')}</div>
      </td>`
    }
    return `<tr>
      <td class="crit-col"><strong>${safe(c.name)}</strong>${comp}</td>
      <td class="marks-col"><strong>${safe(c.maxMarks)}</strong></td>
      ${names.map(levelCell).join('')}
    </tr>`
  }).join('')

  return `<table class="criteria"><thead>${head}</thead><tbody>${rows}</tbody></table>`
}

function gradeBandsTable(bands) {
  const head = bands.map((b) => `<th>${safe(b.symbol || b.name)}</th>`).join('')
  const body = bands.map((b) => `<td><strong>${safe(b.name)}</strong><div class="band-range">${safe(b.range)}</div></td>`).join('')
  return `<table class="bands"><thead><tr>${head}</tr></thead><tbody><tr>${body}</tr></tbody></table>`
}

// Exported for the plain-node export tests — pure string builder, no DOM.
export function buildRubricPrintableHtml(rubric) {
  const h = rubric.header || {}
  const criteria = rubric.criteria || []
  const names = levelNames(criteria)
  const bands = h.gradeBands || []

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${safe(h.title || 'Assessment Rubric')}</title>
<style>
  /* Landscape for the print fallback — the criteria matrix is wide. The
     real-PDF path renders the same table compactly on its A4 canvas. */
  @page { size: A4 landscape; margin: 12mm; }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:"Times New Roman",Georgia,serif;color:#0f172a;background:#fff;font-size:10.5pt;line-height:1.45}
  body{padding:22px 26px;margin:0 auto}

  .masthead{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid ${BRAND};padding-bottom:8px;margin-bottom:14px}
  .brand{font-size:15pt;font-weight:800;color:${BRAND}}
  .brand-sub{font-size:8.5pt;color:#64748b;text-transform:uppercase;letter-spacing:.7px;margin-top:1px}
  .doc-type{font-size:9pt;color:#64748b;text-align:right}

  h1{font-size:15pt;font-weight:800;text-align:center;margin:0 0 12px}
  h2{font-size:11pt;font-weight:800;color:${BRAND};text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid ${BRAND};padding-bottom:3px;margin:14px 0 8px}

  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #94a3b8;padding:5px 7px;text-align:left;vertical-align:top}

  table.meta{width:70%;margin:0 0 12px}
  table.meta th{background:#f1f5f9;width:26%;font-size:9.5pt}
  table.meta td{font-size:9.5pt}

  .marking-notes{background:#f8fafc;border-left:3px solid ${BRAND};padding:7px 12px;margin:0 0 12px;font-size:9.5pt}
  .marking-notes strong{font-weight:700}

  table.criteria th{background:#e2e8f0;font-size:9pt}
  table.criteria td{font-size:8.5pt}
  .crit-col{width:16%}
  .marks-col{width:6%;text-align:center}
  .competencies{font-size:7.5pt;font-style:italic;color:#6b7280;margin-top:3px}
  .lvl-marks{font-weight:700;margin-bottom:2px}

  table.bands{width:100%;margin-top:4px}
  table.bands th{background:#f3f4f6;text-align:center;font-size:11pt}
  table.bands td{text-align:center;font-size:9pt}
  .band-range{color:#6b7280}

  /* Keep these out of @media print: the PDF download rasterises in screen
     media and reads these computed styles to decide where NOT to cut a page. */
  table{page-break-inside:auto}
  tr{page-break-inside:avoid;break-inside:avoid}
  thead{display:table-header-group}
  table.meta{page-break-inside:avoid;break-inside:avoid}

  @media print{ body{padding:0} }
</style>
</head>
<body>
  <div class="masthead">
    <div>
      <div class="brand">ZedExams</div>
      <div class="brand-sub">Zambian CBC &middot; Teacher Tools</div>
    </div>
    <div class="doc-type">ASSESSMENT RUBRIC</div>
  </div>

  <h1>${safe(h.title || 'Assessment Rubric')}</h1>

  <table class="meta"><tbody>
    ${metadataRows(h).map(([k, v]) => `<tr><th>${safe(k)}</th><td>${safe(v)}</td></tr>`).join('')}
  </tbody></table>

  ${rubric.markingNotes ? `<div class="marking-notes"><strong>Marking Notes:</strong> ${safe(rubric.markingNotes)}</div>` : ''}

  <h2>Criteria</h2>
  ${criteriaTable(criteria, names)}

  ${bands.length ? `<h2>Overall Grade Bands</h2>${gradeBandsTable(bands)}` : ''}
</body>
</html>`
}

const exporter = makePdfExporter(buildRubricPrintableHtml, { emptyMessage: 'No rubric to export.' })

/**
 * Download the rubric as a real .pdf file. Falls back to the browser print
 * dialog (A4 landscape) if client-side rendering fails.
 */
export async function downloadRubricPdf(rubric, filename = 'rubric.pdf', { attribution = false } = {}) {
  return exporter.download(rubric, filename, { attribution })
}

export function printRubricPdf(rubric, { attribution = false } = {}) {
  return exporter.print(rubric, { attribution })
}
