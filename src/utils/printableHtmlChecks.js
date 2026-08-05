/**
 * The property checks every studio PDF exporter's printable HTML must satisfy,
 * as one copy shared by the tests that make them.
 *
 * Extracted from studioPdfExporters.test.js when the flashcard exporter moved
 * into src/features/flashcards/ (architecture.md Phase 2). A feature owns its
 * exporter and colocates its test, but the PROPERTIES are common to all seven
 * studios — duplicating them per feature is how seven exporters end up checking
 * six different things.
 *
 * Takes the caller's `assert` so each test keeps its own pass/fail accounting
 * and output format; this module contributes the checks, not the harness.
 *
 * Lives in src/utils/ rather than src/shared/ because the exporters it
 * describes are still here — it moves with them when the Export Engine is
 * built (architecture.md §12), not before.
 */

import { withWatermark } from './htmlPdfExport.js'

/** User content used to prove escaping. */
export const XSS = '<script>alert("pwn")</script>'

/**
 * @param {(cond: boolean, msg: string) => void} assert the caller's assertion fn
 */
export function makePrintableHtmlChecks(assert) {
  function checkDocumentShell(html, label) {
    assert(html.startsWith('<!DOCTYPE html>'), `${label}: full HTML document`)
    assert(html.includes('</head>') && html.includes('</body>'), `${label}: has head + body`)
  }

  // The keep-together rules must be screen-visible (base stylesheet), never
  // trapped inside @media print — same assertion style as lessonPlanToPdf.test.js.
  function checkPagination(html, label) {
    assert(/page-break-inside:avoid/.test(html), `${label}: keep-together rule present`)
    const mp = html.indexOf('@media print{')
    const printBlock = mp >= 0 ? html.slice(mp, html.indexOf('</style>', mp)) : ''
    assert(printBlock.length > 0, `${label}: @media print block exists`)
    assert(!/page-break-inside:avoid/.test(printBlock), `${label}: keep-together rules are NOT trapped inside @media print`)
  }

  function checkEscaped(html, label) {
    assert(!html.includes('<script>'), `${label}: <script> in user content is escaped`)
    assert(html.includes('&lt;script&gt;'), `${label}: escaped entity form present`)
  }

  // The watermark style marker (the SVG data-URI body background) must appear
  // with attribution:true and be absent otherwise.
  function checkWatermark(html, label) {
    const marked = withWatermark(html, true)
    assert(marked.includes('background-image:url("data:image/svg+xml'), `${label}: watermark injected with attribution:true`)
    const clean = withWatermark(html, false)
    assert(!clean.includes('background-image:url("data:image/svg+xml'), `${label}: no watermark without attribution`)
  }

  function checkAll(html, label) {
    checkDocumentShell(html, label)
    checkPagination(html, label)
    checkWatermark(html, label)
  }

  return { checkDocumentShell, checkPagination, checkEscaped, checkWatermark, checkAll }
}
