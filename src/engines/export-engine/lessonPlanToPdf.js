/**
 * Print a lesson plan as a PDF using the browser's native print dialog.
 *
 * Why this approach
 *   Shipping jsPDF / html2canvas / pdf-lib would add 100-300 kB to the
 *   learner bundle for a feature teachers use occasionally. The browser's
 *   own print engine already renders PDF natively — we just need to hand
 *   it nicely-formatted HTML.
 *
 * How it works
 *   1. Open a new window (blocked-popup safe — must be called from a
 *      click handler directly).
 *   2. Write a standalone HTML document with print-friendly CSS.
 *   3. Poll until the window loads, then call `window.print()`.
 *   4. User picks "Save as PDF" in the system print dialog.
 *
 * Tested on: Chrome/Edge (desktop + Android), Safari (desktop + iOS),
 * Firefox desktop. Falls back gracefully if popups are blocked — we
 * throw with a message the caller surfaces as a toast.
 */

import { downloadHtmlAsPdf } from '../../utils/htmlToPdf.js'
import { injectHtmlWatermark, WATERMARK_TEXT } from '../../utils/exportWatermark.js'
import { renderPlanHtml } from '../../shared/utils/renderPlanHtml.js'
import { lessonPlanPrintCss } from '../../utils/lessonPlanPrintCss.js'
import { resolveLessonFormat } from '../../utils/lessonPlanFormat.js'

const BRAND_PRIMARY = '#059669' // emerald-600, matches the lesson-plan UI

// Free-plan exports get the diagonal ZedExams watermark; paid/admin stay clean.
const withWatermark = (html, attribution) =>
  attribution ? injectHtmlWatermark(html, WATERMARK_TEXT) : html

/**
 * Download the lesson plan as a real .pdf file. Falls back to the browser
 * print dialog (printLessonPlanAsPdf) if client-side rendering fails.
 */
export async function downloadLessonPlanPdf(
  plan,
  titleForDocument = 'CBC Lesson Plan',
  filename = 'lesson-plan.pdf',
  { attribution = false, ...meta } = {},
) {
  if (!plan) throw new Error('No lesson plan to export.')
  const html = withWatermark(buildPrintableHtml(plan, titleForDocument, meta), attribution)
  return downloadHtmlAsPdf(html, filename, {
    onFallback: () => printLessonPlanAsPdf(plan, titleForDocument, { attribution, ...meta }),
  })
}

export function printLessonPlanAsPdf(plan, titleForDocument = 'CBC Lesson Plan', { attribution = false, ...meta } = {}) {
  if (!plan) throw new Error('No lesson plan to export.')

  // NOTE: must NOT pass `noopener`/`noreferrer` in the features string — when
  // either is present `window.open` opens a blank window but returns `null`,
  // severing the handle we need to write the document into. That is what made
  // the "Download PDF" buttons across the app pop a blank white page.
  const win = window.open('', '_blank', 'width=900,height=1100')
  if (!win) {
    throw new Error('Your browser blocked the print window. Please allow pop-ups and try again.')
  }

  const html = withWatermark(buildPrintableHtml(plan, titleForDocument, meta), attribution)
  win.document.open()
  win.document.write(html)
  win.document.close()

  // Some browsers need a tick before print() works against the injected doc.
  // We wait for both the load event and a small safety delay, then trigger.
  const ready = () => {
    try {
      win.focus()
      win.print()
    } catch {
      // If print() throws (very rare), just leave the window so the user
      // can print manually with Ctrl+P.
    }
  }
  if (win.document.readyState === 'complete') setTimeout(ready, 120)
  else win.addEventListener('load', () => setTimeout(ready, 120))
}

/* ────────────────────────────────────────────────────────────────────
 * HTML template
 * ─────────────────────────────────────────────────────────────────── */

// Exported for the plain-node export tests — pure string builder, no DOM.
export function buildPrintableHtml(plan, title, opts = {}) {
  const isV3 = Array.isArray(plan.stages) || plan.schemaVersion === '3.0'
  if (isV3) return buildPrintableHtmlV3(plan, title, opts)
  return buildPrintableHtmlLegacy(plan, title)
}

/**
 * v3 — the compact official layout.
 *
 * This does NOT build its own HTML. It renders through `renderPlanHtml`, the
 * same function the studio preview uses, and styles it with
 * `lessonPlanPrintCss`, the same stylesheet the preview injects. Before this,
 * the preview and the PDF were two independent implementations of "the lesson
 * plan", and they drifted: the environment section, the evaluation blanks, the
 * column widths and the page margins all disagreed. Whatever a teacher sees on
 * screen is now literally what this prints.
 *
 * The one adaptation needed is shape: the exporters are handed the plan with
 * its coordinates under `plan.header` and its activities as arrays, while the
 * renderer reads a studio `meta` object. `metaFromPlan` is that translation and
 * nothing more.
 */
function buildPrintableHtmlV3(plan, title, opts = {}) {
  const curriculumMode = opts.curriculumMode === 'previous' ? 'previous' : 'cbc'
  const fmt = resolveLessonFormat(opts.lessonFormat || {})
  const meta = metaFromPlan(plan, opts, fmt)
  const body = renderPlanHtml(plan, meta, curriculumMode)
  const css = lessonPlanPrintCss(fmt, { includePageRule: true })

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(String(title || 'Lesson Plan'))}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#fff;color:#000}
  /* The rasteriser used by the PDF download reads computed styles in SCREEN
     media to decide where not to cut a page, so these stay outside @media print. */
  body{padding:${fmt.marginMm}mm;max-width:210mm;margin:0 auto}
${css}
  /* Last, so it overrides — and so the fragmentation rules above stay in the
     base stylesheet where the rasteriser can read them. */
  @media print{ body{padding:0;max-width:none} }
</style>
</head>
<body>${body}</body>
</html>`
}

/**
 * Build the renderer's `meta` from an export-shaped plan.
 *
 * `opts` is the studio/library meta when there is one — a plan exported from
 * the studio carries the very object its preview was rendered with, so the two
 * agree by construction rather than by both guessing from `plan.header`.
 */
function metaFromPlan(plan, opts = {}, fmt) {
  const h = plan.header || {}
  return {
    ...opts,
    format: opts.format || 'classic',
    lessonFormat: fmt,
    school: opts.school || h.school || '',
    teacherName: opts.teacherName || h.teacherName || '',
    date: opts.date || h.date || '',
    time: opts.time || h.time || '',
    grade: opts.grade || h.class || '',
    subject: opts.subject || h.subject || '',
    topic: opts.topic || h.topic || '',
    subtopic: opts.subtopic || h.subtopic || '',
    duration: opts.duration || h.durationMinutes || 40,
  }
}


function buildPrintableHtmlLegacy(plan, title) {
  const header = plan.header || {}
  const safe = (v) => (v == null ? '' : escapeHtml(String(v)))

  const headerRows = [
    ['School',            header.school],
    ['Teacher',           header.teacherName],
    ['Date',              header.date],
    ['Time',              header.time],
    ['Duration',          header.durationMinutes ? `${header.durationMinutes} min` : ''],
    ['Class',             header.class],
    ['Subject',           header.subject],
    ['Topic',             header.topic],
    ['Sub-topic',         header.subtopic],
    ['Term & Week',       header.termAndWeek],
    ['Number of Pupils',  header.numberOfPupils],
  ].filter(([, v]) => v != null && v !== '')

  const list = (items) => (items || []).length
    ? `<ul>${(items || []).map(i => `<li>${safe(i)}</li>`).join('')}</ul>`
    : '<p class="muted">—</p>'

  const orderedList = (items) => (items || []).length
    ? `<ol>${(items || []).map(i => `<li>${safe(i)}</li>`).join('')}</ol>`
    : '<p class="muted">—</p>'

  const phase = (label, block) => {
    if (!block) return ''
    return `
      <div class="phase">
        <h4>${safe(label)}${block.durationMinutes ? ` <span class="mins">· ${safe(block.durationMinutes)} min</span>` : ''}</h4>
        <div class="phase-grid">
          <div>
            <p class="sub">Teacher activities</p>
            ${list(block.teacherActivities)}
          </div>
          <div>
            <p class="sub">Pupil activities</p>
            ${list(block.pupilActivities)}
          </div>
        </div>
      </div>
    `
  }

  const development = (plan.lessonDevelopment?.development || [])
    .map(step => phase(
      `Development — Step ${safe(step.stepNumber)}: ${safe(step.title)}`,
      step,
    ))
    .join('')

  const references = (plan.references || []).length
    ? `<ul>${plan.references.map(r => {
        const label = r.title ? `${safe(r.title)}${r.publisher ? ' — ' + safe(r.publisher) : ''}${r.year ? ' (' + safe(r.year) + ')' : ''}` : safe(r)
        return `<li>${label}</li>`
      }).join('')}</ul>`
    : '<p class="muted">—</p>'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${safe(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:"Times New Roman",Georgia,serif;color:#0f172a;background:#fff;font-size:12pt;line-height:1.5}
  body{padding:24px 32px;max-width:210mm;margin:0 auto}
  h1{font-size:22pt;font-weight:800;color:${BRAND_PRIMARY};letter-spacing:-0.4px;border-bottom:3px solid ${BRAND_PRIMARY};padding-bottom:10px;margin-bottom:18px}
  h2{font-size:12pt;font-weight:800;color:${BRAND_PRIMARY};text-transform:uppercase;letter-spacing:0.8px;border-left:3px solid ${BRAND_PRIMARY};padding-left:9px;margin:18px 0 8px}
  h3{font-size:11pt;font-weight:700;color:#334155;margin:12px 0 4px}
  h4{font-size:11pt;font-weight:700;color:#0f172a;margin:12px 0 6px;border-bottom:1px dashed #cbd5e1;padding-bottom:4px}
  h4 .mins{color:#64748b;font-weight:500;font-size:10pt}
  p{margin:4px 0}
  p.muted{color:#94a3b8;font-style:italic}
  p.sub{font-size:10pt;font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.4px}
  ul,ol{margin:4px 0 4px 22px}
  li{margin:2px 0}
  table{width:100%;border-collapse:collapse;margin:4px 0 12px}
  th,td{border:1px solid #cbd5e1;padding:7px 10px;text-align:left;vertical-align:top;font-size:11pt}
  th{background:#f1f5f9;font-weight:700;width:36%;color:#334155}
  .columns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .phase{margin-bottom:14px;page-break-inside:avoid}
  .phase-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .masthead{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px;border-bottom:2px solid ${BRAND_PRIMARY};padding-bottom:10px}
  .brand{font-size:16pt;font-weight:800;color:${BRAND_PRIMARY}}
  .brand-sub{font-size:9pt;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;margin-top:2px}
  .masthead-meta{font-size:9pt;color:#64748b;text-align:right}
  .reflection{font-style:italic;color:#64748b}
  .illus{margin:10px 0 14px;text-align:center;page-break-inside:avoid}
  .illus img{max-width:80%;max-height:260px;height:auto;border:1px solid #cbd5e1;border-radius:6px}
  .illus figcaption{font-size:9pt;font-style:italic;color:#64748b;margin-top:4px}
  @media print{
    body{padding:14mm 16mm;max-width:none}
    h2{page-break-after:avoid}
    .phase{page-break-inside:avoid}
  }
</style>
</head>
<body>
  <div class="masthead">
    <div>
      <div class="brand">ZedExams</div>
      <div class="brand-sub">Zambian CBC · Lesson Plan</div>
    </div>
    <div class="masthead-meta">
      ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}
    </div>
  </div>

  <h1>${safe(header.topic || 'Lesson Plan')}</h1>

  <table>
    <tbody>
      ${headerRows.map(([k, v]) => `<tr><th>${safe(k)}</th><td>${safe(v)}</td></tr>`).join('')}
    </tbody>
  </table>

  ${plan.specificOutcomes?.length ? `<h2>Specific Outcomes</h2>${orderedList(plan.specificOutcomes)}` : ''}

  <div class="columns">
    <div>
      <h3>Key Competencies</h3>
      ${list(plan.keyCompetencies)}
    </div>
    <div>
      <h3>Values</h3>
      ${list(plan.values)}
    </div>
    <div>
      <h3>Prerequisite Knowledge</h3>
      ${list(plan.prerequisiteKnowledge)}
    </div>
  </div>

  <div class="two-col">
    <div>
      <h3>Teaching / Learning Materials</h3>
      ${list(plan.teachingLearningMaterials)}
    </div>
    <div>
      <h3>References</h3>
      ${references}
    </div>
  </div>

  ${plan.lessonDiagram?.url ? `<h2>Teaching Illustration</h2>${diagramFigureHtml(plan, safe)}` : ''}

  <h2>Lesson Development</h2>
  ${phase('Introduction', plan.lessonDevelopment?.introduction)}
  ${development}
  ${phase('Conclusion', plan.lessonDevelopment?.conclusion)}

  <div class="two-col">
    <div>
      <h2>Assessment</h2>
      <h3>Formative</h3>
      ${list(plan.assessment?.formative)}
      ${plan.assessment?.summative?.description ? `
        <h3>Summative</h3>
        <p>${safe(plan.assessment.summative.description)}</p>
        ${plan.assessment.summative.successCriteria ? `<p class="muted"><strong>Success criteria:</strong> ${safe(plan.assessment.summative.successCriteria)}</p>` : ''}
      ` : ''}
    </div>
    <div>
      <h2>Differentiation</h2>
      <h3>For struggling pupils</h3>
      ${list(plan.differentiation?.forStruggling)}
      <h3>For advanced pupils</h3>
      ${list(plan.differentiation?.forAdvanced)}
    </div>
  </div>

  ${plan.homework?.description ? `
    <h2>Homework</h2>
    <p>${safe(plan.homework.description)}</p>
    ${plan.homework.estimatedMinutes ? `<p class="muted">Estimated time: ${safe(plan.homework.estimatedMinutes)} minutes</p>` : ''}
  ` : ''}

  <h2>Teacher's Reflection</h2>
  <p class="reflection">— What went well? What will you improve next time? Which pupils need follow-up?</p>

</body>
</html>`
}

// A centred figure for the (black-and-white) lesson illustration. `safe` is
// the caller's HTML escaper — escaping the Storage URL is fine because the
// `&` query separators become `&amp;`, which browsers decode back in attribute
// context. `crossorigin` lets html2canvas read the pixels for the real-PDF
// path; the print fallback only needs to display it, so it works either way.
function diagramFigureHtml(plan, safe) {
  const d = plan && plan.lessonDiagram
  if (!d || !d.url) return ''
  const caption = d.prompt ? `<figcaption>${safe(d.prompt)}</figcaption>` : ''
  return `<figure class="illus"><img src="${safe(d.url)}" alt="${safe(d.prompt || 'Lesson illustration')}" crossorigin="anonymous" />${caption}</figure>`
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
