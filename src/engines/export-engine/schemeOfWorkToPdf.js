/**
 * Export a scheme of work as a real .pdf. Mirrors schemeOfWorkToDocx.js:
 * two builders — the official CDC 9-column grid (v2 generator + sample
 * shape) and the legacy v1 layout (outcomes/materials/assessment) — chosen
 * with the same `isOfficialScheme` sniff, so schemes already saved in
 * teachers' libraries keep exporting.
 *
 * The tables are wide, so the print fallback uses A4 landscape (the
 * classTimetableToPdf precedent); the real-PDF path renders the same tables
 * compactly on its A4 canvas.
 */
import { makePdfExporter, escapeHtml as safe } from '../../utils/htmlPdfExport.js'
import { isOfficialScheme } from '../../utils/weeklyForecast.js'
import { schemeColumns, schemeCurriculum, cleanCellText, cleanCellList } from '../../utils/schemeFormat.js'

const cellBullets = (items) => {
  const list = cleanCellList(items)
  if (!list.length) return '<span class="empty">&mdash;</span>'
  return `<ul>${list.map((i) => `<li>${safe(i)}</li>`).join('')}</ul>`
}

/* ── Official 9-column CDC format ──────────────────────────────────── */

function officialBody(scheme) {
  const h = scheme.header || {}
  const subject = String(h.subject || '').toUpperCase()
  const gradeLabel = String(h.grade || '').replace(/^G/i, '')
  const metaLine = `GRADE: ${safe(gradeLabel)} &middot; TERM ${safe(h.term ?? '')} ${safe(h.year ?? '')}` +
    (h.periodsPerWeek ? ` &middot; PERIODS PER WEEK: ${safe(h.periodsPerWeek)}` : '')

  // Shared CBC (9-col) / OBC (7-col) column spec — same as view + DOCX export.
  const columns = schemeColumns(schemeCurriculum(scheme))

  const cellFor = (w, col) => {
    if (col.type === 'week') return `<td class="wk"><strong>${safe(w.week ?? '')}</strong></td>`
    if (col.key === 'topic') return `<td><strong>${safe(cleanCellText(w.topic) || '—')}</strong></td>`
    if (col.type === 'list') return `<td>${cellBullets(w[col.key])}</td>`
    if (col.key === 'references') return `<td class="ref">${safe(cleanCellText(w.references) || '—')}</td>`
    return `<td>${safe(cleanCellText(w[col.key]) || '—')}</td>`
  }

  const rows = (scheme.weeks || []).map((w) =>
    `<tr>${columns.map((col) => cellFor(w, col)).join('')}</tr>`).join('')
  const head = columns.map((col) =>
    `<th style="width:${col.width}%">${safe(col.label)}</th>`).join('')

  return `
  <h1>${subject ? `${safe(subject)} ` : ''}SCHEMES OF WORK</h1>
  <p class="meta-line">${metaLine}</p>
  ${(h.school || h.teacherName) ? `<p class="school-line">
    <strong>NAME OF SCHOOL:</strong> ${safe(h.school || '____________________')}
    &nbsp;&nbsp; <strong>TEACHER&rsquo;S NAME:</strong> ${safe(h.teacherName || '____________________')}
  </p>` : ''}
  <table class="grid official">
    <thead>
      <tr>${head}</tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
}

/* ── Legacy v1 format ──────────────────────────────────────────────── */

function legacyBody(scheme) {
  const h = scheme.header || {}
  const overview = scheme.overview || {}
  const metaRows = [
    ['School', h.school],
    ['Teacher', h.teacherName],
    ['Class', h.class],
    ['Subject', h.subject],
    ['Term', h.term],
    ['Number of Weeks', h.numberOfWeeks],
    ['Academic Year', h.academicYear],
    ['Medium', h.mediumOfInstruction],
  ].filter(([, v]) => v)

  const rows = (scheme.weeks || []).map((w) => {
    let topicCell = `<strong>${safe(w.topic || '—')}</strong>${cellBullets(w.subtopics)}`
    if (w.references) topicCell += `<p class="cell-note">${safe(w.references)}</p>`
    let outcomesCell = cellBullets(w.specificOutcomes)
    if (w.keyCompetencies?.length) outcomesCell += `<p class="cell-note"><strong>Competencies:</strong> ${safe(w.keyCompetencies.join(' · '))}</p>`
    if (w.values?.length) outcomesCell += `<p class="cell-note"><strong>Values:</strong> ${safe(w.values.join(' · '))}</p>`
    return `<tr>
      <td class="wk"><strong>${safe(w.weekNumber ?? '')}</strong></td>
      <td>${topicCell}</td>
      <td>${outcomesCell}</td>
      <td>${cellBullets(w.teachingLearningActivities)}</td>
      <td>${cellBullets(w.materials)}</td>
      <td>${safe(w.assessment || '—')}</td>
    </tr>`
  }).join('')

  return `
  <h1>SCHEME OF WORK</h1>
  <table class="meta"><tbody>
    ${metaRows.map(([k, v]) => `<tr><th>${safe(k)}</th><td>${safe(v)}</td></tr>`).join('')}
  </tbody></table>
  ${overview.termTheme ? `<p class="overview"><strong>Term Theme:</strong> ${safe(overview.termTheme)}</p>` : ''}
  ${overview.overallCompetencies?.length ? `<p class="overview"><strong>Overall Key Competencies:</strong> ${safe(overview.overallCompetencies.join(' · '))}</p>` : ''}
  ${overview.overallValues?.length ? `<p class="overview"><strong>Overall Values:</strong> ${safe(overview.overallValues.join(' · '))}</p>` : ''}
  <table class="grid">
    <thead>
      <tr>
        <th style="width:6%">Week</th>
        <th style="width:22%">Topic &amp; Sub-topics</th>
        <th style="width:22%">Specific Outcomes</th>
        <th style="width:20%">Teaching/Learning Activities</th>
        <th style="width:15%">Materials</th>
        <th style="width:15%">Assessment</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
}

// Exported for the plain-node export tests — pure string builder, no DOM.
// Handles both the official CDC 9-column shape and the legacy v1 shape.
export function buildSchemeOfWorkPrintableHtml(scheme) {
  const official = isOfficialScheme(scheme)
  const h = scheme.header || {}
  const title = `Scheme of Work — ${h.subject || ''} Term ${h.term || ''}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${safe(title)}</title>
<style>
  /* Landscape for the print fallback — the CDC grid never fits portrait.
     The real-PDF path renders the same table compactly on its A4 canvas. */
  @page { size: A4 landscape; margin: 10mm; }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:"Times New Roman",Georgia,serif;color:#0f172a;background:#fff;font-size:10pt;line-height:1.4}
  body{padding:20px 24px;margin:0 auto}

  h1{font-size:14pt;font-weight:800;text-align:center;margin:0 0 4px}
  .meta-line{text-align:center;font-weight:700;font-size:10.5pt;margin-bottom:8px}
  .school-line{font-size:10pt;margin-bottom:10px}
  .overview{font-size:9.5pt;margin:3px 0}

  table{width:100%;border-collapse:collapse}
  table.meta{width:60%;margin:0 0 10px}
  table.meta th,table.meta td{border:1px solid #94a3b8;padding:4px 8px;text-align:left;font-size:9.5pt;vertical-align:top}
  table.meta th{background:#f3f4f6;font-weight:700;width:35%}

  table.grid{margin-top:8px}
  table.grid th,table.grid td{border:1px solid #64748b;padding:4px 6px;text-align:left;vertical-align:top;font-size:8.5pt}
  table.grid th{background:#e2e8f0;font-weight:700;text-align:center}
  table.grid.official th,table.grid.official td{border-color:#000}
  td.wk{text-align:center}
  td.ref{font-size:7.5pt}
  ul{margin:0 0 0 14px}
  li{margin:1px 0}
  .cell-note{font-size:7.5pt;font-style:italic;color:#475569;margin-top:3px}
  .empty{color:#9ca3af}

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
  ${official ? officialBody(scheme) : legacyBody(scheme)}
</body>
</html>`
}

const exporter = makePdfExporter(buildSchemeOfWorkPrintableHtml, { emptyMessage: 'No scheme of work to export.' })

/**
 * Download the scheme of work as a real .pdf file. Falls back to the browser
 * print dialog (A4 landscape) if client-side rendering fails.
 */
export async function downloadSchemeOfWorkPdf(scheme, filename = 'scheme-of-work.pdf', { attribution = false } = {}) {
  return exporter.download(scheme, filename, { attribution })
}

export function printSchemeOfWorkPdf(scheme, { attribution = false } = {}) {
  return exporter.print(scheme, { attribution })
}
