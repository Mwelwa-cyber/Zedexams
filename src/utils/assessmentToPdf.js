/**
 * Print an assessment as a PDF via the browser's native print dialog.
 *
 * The output mirrors the in-studio Preview pixel-for-pixel: marble banner,
 * subject + optional paper name, school logo, comprehension passages,
 * image-MCQ option grids, etc. The shared `buildPaperLayout` helper is the
 * single source of truth — preview, PDF, and DOCX all walk the same blocks.
 *
 * Two modes:
 *   - 'paper'  (default): printable paper for pupils.
 *   - 'scheme': marking key for teachers (correct answer + explanation per Q).
 */

import { DEFAULT_ANSWER_LINES } from './assessmentPaperLayout.js'
import { renderDiagramSvg } from '../curriculum/diagrams/diagramCatalog.js'
import { splitStatementSegments, statementLabel } from './fillBlanks.js'
import { subPartLabel, splitPartBlanks } from './questionParts.js'
import { hydrateTableData } from './tableData.js'
import { resolveFigureLabels, resolveAnswerKeyLabels } from './figureLabelLayout.js'
import { resolveImageWidthPercent } from './imageWidth.js'
import { FOOTER_MM, FOOTER_RESERVE_MM } from '../config/paperPageGeometry.js'
import { buildAssessmentDocument } from './assessmentDocument.js'

const SECTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Render option letters like (A) (B) inline-bold even when wrapped in text.
function renderInstructionsHtml(text) {
  if (!text) return ''
  // Treat as plain text — escape, then bold (A)(B)(C)(D) tags.
  const escaped = escapeHtml(text)
  const withBold = escaped.replace(/\(([A-D])\)/g, '<strong>($1)</strong>')
  // Preserve paragraph breaks
  const paras = withBold.split(/\n\s*\n/).map(p => p.replace(/\n/g, ' '))
  return paras.map(p => `<p>${p}</p>`).join('')
}

// Render a catalog shape diagram (imageDiagram: {libraryKey, params}) as an
// inline SVG. Mirrors the `diagramHtml` helper in sbaTaskToPdf.js — same
// catalog, same default color.
//
// A key the catalog cannot draw prints the same dashed placeholder the Word
// export uses, rather than nothing. Returning '' here was the quieter half of
// the defect the DOCX path already fixed: the paper printed with a figure-shaped
// hole and the question above it still said "label the diagram". The export gate
// refuses this paper before the teacher gets here, so the placeholder is the
// backstop for a paper that reached print another way — the library list, or a
// catalog entry removed after the gate ran.
function diagramHtml(imageDiagram) {
  if (!imageDiagram?.libraryKey) return ''
  const svg = renderDiagramSvg(imageDiagram.libraryKey, imageDiagram.params, '#1c1612')
  if (!svg) return figurePlaceholderHtml(imageDiagram.label || '')
  return `<div class="q-diagram">${svg}</div>`
}

/** The printed marker for a figure that is not there. Never a rendered diagram. */
function figurePlaceholderHtml(label) {
  const caption = label ? `Figure could not be loaded — ${escapeHtml(label)}` : 'Figure could not be loaded'
  return `<div class="q-diagram figure-missing">${caption}</div>`
}

// NOTE: must NOT pass `noopener`/`noreferrer` in the features string — when
// either is present `window.open` opens the blank window but returns `null`,
// severing the handle the document is written into. Every sibling exporter
// (lessonPlanToPdf, classTimetableToPdf, worksheetToPdf, htmlPdfExport) carries
// the same note, and scripts/test-pdf-export-window.test.js enforces it.
export function openPrintWindow() {
  return window.open('', '_blank', 'width=900,height=1100')
}

export function printAssessmentAsPdf(assessment, questions, { mode = 'paper', win: preWin = null, attribution = false } = {}) {
  if (!assessment) throw new Error('No assessment to export.')

  const win = preWin || window.open('', '_blank', 'width=900,height=1100')
  if (!win) {
    throw new Error('Your browser blocked the print window. Please allow pop-ups and try again.')
  }

  const html = buildPrintableHtml(assessment, questions || [], mode, { attribution })
  win.document.open()
  win.document.write(html)
  win.document.close()

  const ready = () => {
    try {
      win.focus()
      win.print()
    } catch {
      // User can hit Ctrl+P manually.
    }
  }
  if (win.document.readyState === 'complete') setTimeout(ready, 200)
  else win.addEventListener('load', () => setTimeout(ready, 200))
}

// Free-plan attribution — the same branding contract as the DOCX exporters
// (see docxAttribution.js, which owns the canonical wording): a light
// diagonal watermark plus a "Made with ZedExams" footer line. Both are
// `position: fixed`, which browsers repeat on every printed page. Paid /
// admin exports stay completely clean.
const ATTRIBUTION_WATERMARK_TEXT = 'ZedExams.com'
const ATTRIBUTION_FOOTER_TEXT =
  'Made with ZedExams — free CBC teacher tools at zedexams.com/teachers'

function attributionHtml() {
  return `<div class="attribution-watermark" aria-hidden="true">${escapeHtml(ATTRIBUTION_WATERMARK_TEXT)}</div>
<div class="attribution-footer">${escapeHtml(ATTRIBUTION_FOOTER_TEXT)}</div>`
}

export function buildPrintableHtml(assessment, questions, mode, { attribution = false } = {}) {
  // The canonical document (§2): one resolution of the layout, the metadata and
  // the marks, shared with the studio preview and the Word export. The print
  // window renders its blocks and its layout tokens, so a page-setup change
  // reaches the printed sheet rather than only the preview.
  const doc = buildAssessmentDocument(assessment, questions, { mode })
  const layout = doc.layout
  const blocks = doc.blocks
  const docTitle = mode === 'scheme'
    ? `${assessment.title || 'Marking Key'} — Marking Key`
    : (assessment.title || 'Assessment')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(docTitle)}</title>
  <style>${documentCss(layout)}${PRINT_CSS}</style>
</head>
<body>
${attribution ? attributionHtml() : ''}
<table class="paper-sheet"><tbody><tr><td>
${blocks.filter(isPaperBody).map((b, i) => withBlockIndex(renderBlock(b), i)).join('\n')}
</td></tr></tbody><tfoot><tr><td class="footer-reserve"></td></tr></tfoot></table>
${blocks.filter((b) => !isPaperBody(b)).map(renderBlock).join('\n')}
</body>
</html>`
}

/**
 * Stamp a block's position in the body onto the element it rendered to.
 *
 * This is the join key between the two renderers (§1). The measurement runs in
 * THIS document, and the studio's paginated preview draws the SAME blocks in the
 * same order as React; without a shared identity, "which blocks are on page 2"
 * is knowable in the print renderer and unknowable in the preview, and the
 * preview is reduced to guessing its own page boundaries with a second set of
 * rules. With it, the preview shows the pages the PDF will have because it is
 * literally told where they fall.
 *
 * The index is the position in the BODY array — the same array the preview maps
 * — not in `blocks`, because the paper code is excluded from both.
 *
 * Injected into the opening tag rather than threaded through every `render*`
 * function: the alternative is thirteen call sites that each have to remember,
 * and one that forgets is a block the measurement cannot place.
 */
function withBlockIndex(html, index) {
  const s = String(html || '')
  if (!s.trim()) return ''
  return s.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 id="pb-${index}" data-block-index="${index}"`)
}

/**
 * Is this block part of the paper's flowing body?
 *
 * The paper code is not. In print it is a fixed element that repeats on every
 * sheet, so it contributes nothing to the flow — but while it sat inside the
 * table cell it was still the cell's LAST CHILD, which put the real last block's
 * trailing margin out of reach of the rule that zeroes it. That margin is
 * invisible and it cost vr-004's marking key a whole sheet: content ended at
 * 278.5mm, comfortably inside the 281mm limit, and the reservation was pushed
 * past the page anyway, producing a second page carrying nothing but the code.
 * Exactly the defect this whole change exists to end, one copy over.
 */
function isPaperBody(block) {
  return block.kind !== 'footerCode'
}

/**
 * The document's own page rule and body typography (§2).
 *
 * Emitted from the RESOLVED layout tokens rather than written as literals, so a
 * paper set to A5 landscape with wide margins and 14pt type prints as that in
 * the browser, in the PDF that comes out of it, and — through the same tokens —
 * in Word. Before this, `@page` said A4 and the body said 11.5pt whatever the
 * document declared, so the page-setup controls would have been a preference the
 * printer ignored.
 *
 * The DEFAULT output is byte-identical to the literals it replaces: A4, the
 * margins paperPageGeometry derives, 11.5pt Times at 1.45. That is what makes
 * this safe to land under the visual gate.
 */
function documentCss(layout) {
  const t = layout.typography
  return `
@page { size: ${layout.page.cssSize}; margin: ${layout.margins.cssRule}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: white; }
body {
  color: #111;
  font-family: ${t.bodyFontCss};
  font-size: ${t.bodySizePt}pt;
  line-height: ${t.lineSpacing};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
`
}

const PRINT_CSS = `
* { box-sizing: border-box; }

.banner {
  margin-bottom: 10pt;
  page-break-inside: avoid;
}
.banner-top {
  display: grid;
  grid-template-columns: 74pt 1fr;
  gap: 12pt;
  align-items: center;
}
.banner-text {
  text-align: center;
  min-width: 0;
}
.banner-text .school {
  font-family: Arial, Helvetica, sans-serif;
  font-weight: 800;
  font-size: 13.5pt;
  letter-spacing: 0.3pt;
  text-transform: uppercase;
  line-height: 1.15;
}
.banner-text .title {
  font-family: Arial, Helvetica, sans-serif;
  font-weight: 800;
  font-size: 10.5pt;
  margin-top: 8pt;
  letter-spacing: 0.2pt;
  text-transform: uppercase;
}
.banner-text .subject {
  font-family: Arial, Helvetica, sans-serif;
  font-weight: 900;
  font-size: 25pt;
  margin-top: 24pt;
  line-height: 1.1;
}
.banner-text .paper-name {
  font-family: Arial, Helvetica, sans-serif;
  font-weight: 800;
  font-size: 11pt;
  margin-top: 5pt;
  text-transform: uppercase;
}
.logo {
  width: 70pt; height: 70pt;
  display: grid;
  place-items: center;
  position: relative;
  overflow: hidden;
  color: #111;
  font-size: 18pt;
}
.logo img { width: 100%; height: 100%; object-fit: contain; }
.banner-meta {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 12pt;
  margin-top: 10pt;
  padding-bottom: 8pt;
  border-bottom: 1pt solid #888;
}
.banner-code {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10pt;
  font-weight: 700;
  text-transform: uppercase;
}
.banner-code .line-2 {
  margin-top: 8pt;
  text-transform: none;
}
.banner-duration {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10.5pt;
  font-weight: 800;
  text-transform: uppercase;
  white-space: nowrap;
}

.learner-row {
  display: flex; justify-content: space-between;
  gap: 18pt;
  font-size: 11pt;
  margin: 12pt 0 4pt;
  align-items: flex-end;
  page-break-inside: avoid;
}
.learner-row span { white-space: nowrap; font-weight: 600; }
.learner-row .line { flex: 1; border-bottom: 1px solid #000; height: 14pt; }
.total-marks {
  text-align: right;
  font-size: 11pt; font-weight: 600;
  margin: 4pt 0 14pt;
}

.instructions {
  margin: 0 0 14pt;
  font-size: 11pt;
  line-height: 1.5;
  page-break-inside: avoid;
}
.instructions .label {
  display: none;
}
.instructions ol {
  margin: 0;
  padding-left: 18pt;
}
.instructions li {
  margin: 0 0 8pt;
  padding-left: 8pt;
}
.instructions p { margin: 0; }
.instructions strong { font-weight: 700; }

.section-head {
  font-weight: 700; font-size: 11.5pt;
  text-transform: uppercase;
  letter-spacing: 0.2pt;
  border-bottom: 1px solid #000;
  padding-bottom: 3pt;
  margin: 16pt 0 6pt;
  page-break-after: avoid;
}
.section-head .marks-tag { float: right; font-size: 10pt; }
.section-instr {
  font-style: italic; font-size: 11pt;
  margin: 0 0 10pt;
  color: #333;
}

.passage {
  background: #fafafa;
  border: 1px solid #888;
  padding: 10pt 14pt;
  margin: 8pt 0 14pt;
  font-size: 11pt;
  line-height: 1.6;
  page-break-inside: avoid;
}
.passage .h {
  display: block;
  font-size: 10pt;
  text-transform: uppercase;
  letter-spacing: 0.4pt;
  margin-bottom: 6pt;
  font-weight: 700;
}
.passage img { max-width: 100%; max-height: 240pt; object-fit: contain; }

.question {
  margin: 10pt 0 12pt;
  page-break-inside: auto;
  break-inside: auto;
  orphans: 3; widows: 3;
}
.question .qline {
  font-size: 11.5pt;
  line-height: 1.5;
  break-after: avoid;
  page-break-after: avoid;
}
.question .qline strong { font-weight: 700; }
.question .qmarks {
  white-space: nowrap;
  font-style: italic;
  color: #555;
  font-size: 10pt;
  margin-left: 4pt;
}
.question .word-bank {
  border: 1px solid #000;
  padding: 4pt 10pt;
  margin: 4pt 0;
  display: inline-block;
  font-size: 10.5pt;
}
.question .word-bank strong { margin-right: 4pt; }
.question .q-image { margin: 6pt 0; text-align: center; }
.question .q-image .q-image-frame { position: relative; display: block; max-width: 100%; margin-inline: auto; }
.question .q-image .q-image-frame img { width: 100%; max-height: 240pt; display: block; }
.diagram-leaders {
  position: absolute; inset: 0; width: 100%; height: 100%;
  overflow: visible; pointer-events: none;
}
.diagram-label {
  position: absolute;
  transform: translate(-50%, -50%);
  background: white;
  border: 1px solid #000;
  border-radius: 2pt;
  padding: 1pt 4pt;
  font-size: 9pt;
  white-space: nowrap;
  line-height: 1.1;
}
.diagram-label-answer {
  color: #047857;
  border-color: #047857;
  font-weight: 600;
}
.diagram-label-num {
  background: #000;
  color: #fff;
  border-radius: 50%;
  width: 16pt; height: 16pt;
  padding: 0;
  font-weight: 700;
  display: inline-grid;
  place-items: center;
  text-align: center;
}
.identify-list { margin: 6pt 0 12pt 22pt; padding: 0; }
.identify-list li { margin-bottom: 4pt; }
.identify-blank { display: inline-block; min-width: 180pt; border-bottom: 1px solid #000; height: 12pt; }
.draw-canvas { border: 1px solid #000; background: #fff; margin: 6pt 0 12pt; page-break-inside: avoid; }

.options-text {
  padding-left: 26pt;
  font-size: 11pt;
  display: grid;
  grid-template-columns: 1fr;
  gap: 4pt;
  margin: 5pt 0 8pt;
}
.options-text.stacked { grid-template-columns: 1fr; padding-left: 26pt; }
.options-text > div { white-space: normal; }
.options-text .letter { display: inline-block; width: 16pt; font-weight: 700; margin-right: 8pt; }

.options-image {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 8pt;
  margin: 6pt 0 8pt;
  page-break-inside: avoid;
}
.options-image .item {
  text-align: center;
  border: 1px solid #888;
  border-radius: 3pt;
  padding: 4pt;
  background: #fafafa;
}
.options-image .item .img-box {
  width: 100%; aspect-ratio: 1;
  display: grid; place-items: center;
  background: white;
  border-radius: 2pt;
  margin-bottom: 2pt;
  overflow: hidden;
}
.options-image .item .img-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
.options-image .item .lbl { font-size: 9.5pt; font-weight: 700; }

.options-mixed {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6pt;
  margin: 6pt 0;
  padding-left: 0;
}
.options-mixed .item {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 4pt;
  align-items: center;
  padding: 4pt 6pt;
  border: 1px solid #888;
  border-radius: 3pt;
}
.options-mixed .item .img { width: 40pt; height: 40pt; object-fit: contain; }
.options-mixed .item .letter { font-weight: 700; }

.answer-lines { margin: 6pt 0 12pt; }
.answer-line { border-bottom: 1px solid #000; height: 18pt; margin-bottom: 4pt; }
.numeric-line { display: flex; align-items: flex-end; gap: 8pt; margin: 6pt 0 12pt; }
.numeric-line .answer-line.numeric { display: inline-block; flex: 0 0 160pt; margin-bottom: 0; }
.numeric-unit { font-size: 11pt; }
.match-columns { display: grid; grid-template-columns: 1fr 1fr; column-gap: 36pt; margin: 6pt 0 12pt; }
.match-row { padding: 3pt 0; border-bottom: 1px dotted #888; }
.seq-list { margin: 6pt 0 12pt; }
.seq-row { display: flex; align-items: center; gap: 10pt; padding: 3pt 0; border-bottom: 1px dotted #888; }
.seq-blank { display: inline-block; width: 30pt; border-bottom: 1px solid #000; height: 12pt; }
.pagebreak { page-break-after: always; break-after: page; height: 0; }

/* ── Grade-7 math blocks (must match editor.css visually) ── */
.qbody p { margin: 0; }
.qbody p + p { margin-top: 4pt; }
.opt-rich, .opt-rich p { display: inline; margin: 0; }
.opt-rich .vert-arith, .opt-rich .math-frac, .opt-rich .num-base {
  display: inline-flex;
  vertical-align: middle;
}
.vert-arith {
  display: inline-block;
  margin: 4pt 6pt 6pt 0;
  font-family: 'Cambria Math', 'Times New Roman', 'Liberation Serif', serif;
  font-size: 13pt;
  line-height: 1.25;
  vertical-align: middle;
  page-break-inside: avoid;
}
.vert-arith .va-row {
  display: flex;
  justify-content: flex-end;
  gap: 6pt;
  white-space: pre;
}
.vert-arith .va-op {
  display: inline-block;
  width: 14pt;
  text-align: left;
  font-weight: 700;
}
.vert-arith .va-num {
  display: inline-block;
  text-align: right;
  font-feature-settings: 'tnum' 1;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1pt;
}
.vert-arith .va-rule {
  border-top: 1.5pt solid #000;
  margin: 1pt 0 1pt 16pt;
  min-width: 56pt;
}
.vert-arith .va-answer-row .va-num { min-height: 16pt; }
.vert-arith .va-working {
  border-top: 1pt dashed #888;
  margin-top: 4pt;
  padding-top: 4pt;
}
.vert-arith .va-working-line {
  border-bottom: 1px solid #888;
  height: 14pt;
  width: 100pt;
  margin: 2pt 0;
}

.math-frac {
  display: inline-flex;
  align-items: center;
  gap: 2pt;
  vertical-align: middle;
  line-height: 1;
  margin: 0 1pt;
  font-family: 'Cambria Math', 'Times New Roman', serif;
}
.math-frac-whole { padding-right: 3pt; }
.math-frac-stack {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;
  vertical-align: middle;
  text-align: center;
}
.math-frac-num,
.math-frac-den {
  display: block;
  font-size: 0.85em;
  padding: 0 2pt;
  line-height: 1.1;
  text-align: center;
}
.math-frac-num { border-bottom: 1pt solid currentColor; padding-bottom: 1pt; }
.math-frac-den { padding-top: 1pt; }

.num-base {
  display: inline-flex;
  align-items: baseline;
  vertical-align: baseline;
  font-family: inherit;
}
.num-base-num { font: inherit; }
.num-base-sub {
  font-size: 0.65em;
  position: relative;
  bottom: -0.35em;
  margin-left: 1pt;
  font-weight: 500;
}
.table-wrap {
  margin: 6pt 0 10pt;
  page-break-inside: auto;
  break-inside: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 0;
  font-size: 10.5pt;
  page-break-inside: auto;
  break-inside: auto;
}
.data-table thead { display: table-header-group; }
.data-table tfoot { display: table-footer-group; }
.data-table tr { page-break-inside: avoid; break-inside: avoid; }
.data-table th, .data-table td {
  border: 1px solid #000;
  padding: 4pt 6pt;
  vertical-align: top;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.data-table th {
  background: #fff;
  font-weight: 700;
}

.diagram-box {
  border: 1px dashed #888;
  background: #fafafa;
  padding: 8pt;
  text-align: center;
  font-style: italic;
  font-size: 10pt;
  color: #6b7280;
  margin: 6pt 0;
  min-height: 80pt;
  display: grid; place-items: center;
}
.diagram-box img { max-width: 100%; max-height: 280pt; object-fit: contain; }

/* ── catalog shape diagram SVGs (imageDiagram field) ── */
.q-diagram { text-align: center; margin: 6pt 0; }
.q-diagram svg { max-width: 100%; max-height: 280pt; height: auto; display: inline-block; }
/* A figure that is not there. Dashed and named so a teacher proof-reading the
   print preview sees the gap, rather than a question about a diagram above
   blank paper. Matches the Word export's placeholder. */
.figure-missing {
  border: 1pt dashed #b91c1c; color: #b91c1c;
  padding: 10pt; font-size: 9.5pt; font-style: italic;
}
/* SVG diagrams inside image-mode option boxes */
.options-image .item .img-box svg { max-width: 100%; max-height: 100%; width: auto; height: auto; }
/* SVG diagrams inside mixed-mode option boxes */
.options-mixed .item svg { width: 40pt; height: 40pt; display: inline-block; vertical-align: middle; }
/* ── fill-in-the-blanks ── */
.fill-blanks { margin: 4pt 0; }
.fill-word-bank { border: 1px solid #000; padding: 4pt 10pt; margin: 4pt 0 10pt; display: inline-block; font-size: 10.5pt; }
.fill-row { display: flex; gap: 8pt; margin: 10pt 0; font-size: 11pt; line-height: 2; }
.fill-label { flex: 0 0 auto; }
.fill-text { flex: 1; }
.fill-gap { display: inline-block; min-width: 100pt; border-bottom: 1px solid #000; height: 12pt; margin: 0 4pt; vertical-align: middle; }
.fill-answer { color: #047857; font-weight: 700; }
/* ── short-answer sub-parts ── */
.subparts { margin: 4pt 0; }
.subpart-row { display: flex; gap: 8pt; margin: 8pt 0; font-size: 11pt; line-height: 1.9; }
.subpart-label { flex: 0 0 auto; }
.subpart-body { flex: 1; }
.subpart-gap { display: inline-block; min-width: 100pt; border-bottom: 1px dotted #000; height: 12pt; margin: 0 4pt; vertical-align: middle; }
.subpart-lines { margin-left: 30pt; }
/* ── labelled blanks answer space ── */
.labelled-blanks { margin: 6pt 0; }
.labelled-blank-row { display: flex; align-items: flex-end; gap: 8pt; margin: 4pt 0; }
.blank-label { font-weight: 600; white-space: nowrap; }
.labelled-line { flex: 1; border-bottom: 1px solid #000; height: 14pt; display: inline-block; }

.correct-mark { color: #047857; font-weight: 700; }
.answer-block {
  margin: 4pt 0 4pt 14pt;
  padding: 4pt 8pt;
  background: #ecfdf5;
  border-left: 3pt solid #047857;
  font-size: 10.5pt;
}
.answer-block .label { font-weight: 700; color: #047857; }
.answer-block .notes { color: #555; font-style: italic; font-size: 10pt; margin-top: 2pt; }

.end-of-paper {
  text-align: center;
  margin-top: 18pt;
  padding-top: 8pt;
  border-top: 1pt solid #000;
  font-style: italic;
  font-size: 10pt;
  color: #555;
}
/* Free-plan attribution — fixed elements repeat on every printed page. */
.attribution-watermark {
  position: fixed;
  top: 45%; left: 0; right: 0;
  text-align: center;
  transform: rotate(-35deg);
  font-family: Arial, Helvetica, sans-serif;
  font-weight: 800;
  font-size: 52pt;
  letter-spacing: 2pt;
  color: rgba(0, 0, 0, 0.07);
  z-index: -1;
  pointer-events: none;
}
.attribution-footer {
  position: fixed;
  /* Anchored to the footer band, not to a constant of its own. It is a second
     fixed line at the foot of the sheet, so if the band moves it must move with
     it — left-aligned against the centred paper code so the two do not stack. */
  bottom: 0; left: 0; right: 0;
  height: ${FOOTER_MM.lineHeight}mm;
  line-height: ${FOOTER_MM.lineHeight}mm;
  text-align: left;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 8.5pt;
  color: #888;
}
.footer-code {
  text-align: right;
  margin-top: 18pt;
  font-size: 9.5pt;
  color: #333;
}

/*
 * The paper sheet is a table so the footer's space can be RESERVED.
 *
 * Nothing else in Chromium reserves space at the foot of every printed page. A
 * fixed element is positioned against the page area, which is the same box the
 * body flows through, so taking the paper code out of flow stopped it creating
 * pages but did not stop the body printing on top of it — vr-006 page 3 ran an
 * answer line straight through the code. Two alternatives were measured and
 * rejected: a negative offset, which makes Chromium grow the document by a page
 * (the original defect, back again), and a table-footer-group on the body
 * element, which reserves on the last page only.
 *
 * A real tfoot on a real table repeats on every page AND reserves its height
 * in the flow, so the body physically cannot reach the strip below it. The row
 * prints nothing: it is a reservation, not a footer. The paper code is still the
 * fixed element below, which is what keeps it off the flow and out of the page
 * count.
 *
 * The cell is transparent to layout — no padding, no borders, full width — so
 * the paper paginates exactly as it did; only the last usable line on each page
 * moves up by the reserved height. A .pagebreak inside the cell still breaks
 * the page (measured: a one-page paper becomes two).
 */
.paper-sheet { width: 100%; border-collapse: collapse; }
.paper-sheet > tbody > tr > td,
.paper-sheet > tfoot > tr > td { padding: 0; border: 0; vertical-align: top; }
/* On screen the reservation costs nothing: there are no pages to reserve on. */
.footer-reserve { height: 0; padding: 0; }
/*
 * A trailing margin below the last block is dead space that was never visible,
 * and once the reservation sits under it, it is dead space that can cost a
 * sheet: it pushes the reserved row past the page and Chromium answers with a
 * page carrying nothing but the paper code.
 */
.paper-sheet > tbody > tr > td > *:last-child { margin-bottom: 0; }

/*
 * In PRINT the paper code leaves the flow entirely.
 *
 * In flow it was an ordinary block with an 18pt top margin, so on a paper that
 * filled the page it — and nothing else — was pushed onto a second sheet. Out of
 * flow it cannot lengthen the document, so no content length can make it create
 * a page; and because a fixed element repeats in paged media it prints on
 * EVERY sheet, which is what a paper code is for: a loose page stays
 * identifiable.
 *
 * It anchors to the bottom of the PAGE AREA, and the page's bottom margin is
 * the footer's declared offset, so a zero bottom offset lands the code exactly
 * where paperPageGeometry says it goes rather than wherever the margin happened
 * to leave it. The clearance above it is the tfoot reservation.
 */
@media print {
  .footer-reserve { height: ${FOOTER_RESERVE_MM}mm; }
  .footer-code {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    margin: 0;
    padding: 0;
    height: ${FOOTER_MM.lineHeight}mm;
    line-height: ${FOOTER_MM.lineHeight}mm;
    text-align: center;
    /* Monochrome and quiet: it identifies the sheet, it does not compete with
       the paper. #555 survives a photocopier at this size (see monochrome.js). */
    color: #555;
  }
}

/* ── §7 Semantic page-breaking ──────────────────────────────────────────────
   The rules a school paper has to obey, stated as CSS because the printer is
   what enforces them — and mirrored in paperPaginationCore so the measured page
   count agrees with the sheet.

   The organising idea is that a question is either ATOMIC or STRUCTURED. A
   multiple-choice item and anything carrying a figure are atomic: they are short
   enough to move whole, and splitting them produces the two defects a learner
   actually suffers — an option list beginning at B on the next page, or a
   diagram they are asked to read that is not in front of them. A long structured
   question is not short enough to move whole, so it may split, but only between
   sub-parts, never mid-part.

   An option GROUP is kept together in every case. That is what stops a single
   orphaned choice at the top of a page, which no orphans/widows count can
   express because the browser counts lines, not choices. */
.question.q-choice,
.question.has-figure {
  page-break-inside: avoid;
  break-inside: avoid;
}
.question.has-subparts {
  page-break-inside: auto;
  break-inside: auto;
}
.question.has-subparts .subpart {
  page-break-inside: avoid;
  break-inside: avoid;
}
.options-text, .options-image, .options-mixed {
  page-break-inside: avoid;
  break-inside: avoid;
}
/* A figure never splits, and never leaves the stem behind. */
.q-diagram, .q-figure {
  page-break-inside: avoid;
  break-inside: avoid;
  page-break-before: avoid;
  break-before: avoid;
}

@media print {
  .section-head, .passage, .instructions, .banner { page-break-inside: avoid; break-inside: avoid; }
  /* A section heading is kept with the question that follows it: a heading
     alone at the foot of a sheet tells the learner a section started on the
     page they have just turned away from. */
  .section-head, .section-instr { page-break-after: avoid; break-after: avoid; }
  .question.has-table { page-break-inside: auto; break-inside: auto; }
  .question.has-table .qline { page-break-after: avoid; break-after: avoid; }
  .table-wrap, .data-table { page-break-inside: auto; break-inside: auto; }
}
`

function renderBlock(block) {
  switch (block.kind) {
    case 'header': return renderHeader(block)
    case 'learnerFields': return renderLearnerFields(block)
    case 'instructions': return renderInstructionsBlock(block)
    case 'sectionHeader': return renderSectionHeader(block)
    case 'passage': return renderPassage(block)
    case 'question': return renderQuestion(block)
    case 'passageTotal': return `<div style="text-align:right;font-weight:700;font-size:10.5pt;margin:0 0 8pt;">Total: ${block.totalMarks} mark${block.totalMarks === 1 ? '' : 's'}</div>`
    case 'pagebreak': return '<div class="pagebreak"></div>'
    case 'endOfPaper': return `<div class="end-of-paper">${escapeHtml(block.text)}</div>`
    case 'footerCode': return `<div class="footer-code">${escapeHtml(block.code)}</div>`
    case 'schoolFooter': return `<div class="end-of-paper" style="border-top:none;font-style:normal;">${escapeHtml(block.text)}</div>`
    default: return ''
  }
}

function renderHeader(b) {
  const school = b.schoolName || 'YOUR SCHOOL NAME'
  // Subject is required and always rendered. Paper name only when present.
  const subjectLine = b.subject
    ? `<div class="subject">${escapeHtml(b.subject)}</div>`
    : ''
  const paperLine = b.paperName
    ? `<div class="paper-name">${escapeHtml(b.paperName)}</div>`
    : ''
  // Apply teacher-set transform if any. Width converts directly to the
  // .logo box size; offsets become a CSS translate so the surrounding
  // banner reflows around the (now-shifted) logo box naturally.
  const t = b.logoTransform
  const logoStyleParts = []
  if (t?.width) {
    const px = `${Math.round(t.width)}pt`
    logoStyleParts.push(`width: ${px}`, `height: ${px}`)
  }
  if (t && (t.offsetX || t.offsetY)) {
    logoStyleParts.push(`transform: translate(${Math.round(t.offsetX)}pt, ${Math.round(t.offsetY)}pt)`)
  }
  const logoStyle = logoStyleParts.length ? ` style="${logoStyleParts.join('; ')}"` : ''
  const logoSrc = b.logoUrl || b.schoolLogoUrl
  const logoHtml = logoSrc
    ? `<div class="logo"${logoStyle}><img src="${escapeHtml(logoSrc)}" alt=""></div>`
    : `<div class="logo"${logoStyle}></div>`
  const codeLine = b.footerCode
    ? `<div class="line-1">${escapeHtml(String(b.footerCode).toUpperCase())}</div>`
    : ''
  const titleCodeLine = b.title
    ? `<div class="line-2">${escapeHtml(b.title)}</div>`
    : ''
  const durationLine = b.duration ? `<div class="banner-duration">${escapeHtml(String(b.duration))} MINUTES</div>` : ''
  // School identity lines from Teacher Settings → My School (all optional) —
  // keeps the PDF header in step with the preview and the DOCX export.
  const addressLine = [b.address, b.emisNumber ? `EMIS: ${b.emisNumber}` : '']
    .filter(Boolean).join(' · ')
  const addressHtml = addressLine
    ? `<div style="font-size:9pt;letter-spacing:.02em;">${escapeHtml(addressLine)}</div>`
    : ''
  const mottoHtml = b.motto
    ? `<div style="font-size:9pt;font-style:italic;margin-bottom:2pt;">“${escapeHtml(b.motto)}”</div>`
    : ''
  return `<div class="banner">
  <div class="banner-top">
    ${logoHtml}
    <div class="banner-text">
    <div class="school">${escapeHtml(school).toUpperCase()}</div>
    ${addressHtml}
    ${mottoHtml}
    <div class="title">${escapeHtml(b.title)}</div>
    ${subjectLine}
    ${paperLine}
  </div>
  </div>
  <div class="banner-meta">
    <div class="banner-code">${codeLine}${titleCodeLine}</div>
    ${durationLine}
  </div>
</div>`
}

function renderLearnerFields(b) {
  // The labels come off the block (§9), so a mock examination can say
  // "CANDIDATE'S NAME" and a Grade 3 test "PUPIL'S NAME" — and the preview, the
  // PDF and Word print the same words because all three read the same resolved
  // field. The defaults reproduce exactly what was hard-coded here before.
  const labels = b.labels || {}
  const label = (key, fallback) => escapeHtml(String(labels[key] || fallback).toUpperCase())
  const parts = []
  if (b.name) parts.push(`<span>${label('name', 'Name')}:</span><div class="line"></div>`)
  if (b.date) parts.push(`<span>${label('date', 'Date')}:</span><div class="line" style="max-width: 140pt;"></div>`)
  const row1 = parts.length
    ? `<div class="learner-row">${parts.join('')}</div>`
    : ''
  const row2 = b.classField
    ? `<div class="learner-row"><span>${label('classField', 'Class')}:</span><div class="line"></div></div>`
    : ''
  const marksLine = b.marks
    ? `<div class="total-marks">${label('marks', 'Total marks')}: _____________ &nbsp; / &nbsp; ${b.totalMarks || '____'}</div>`
    : ''
  return [row1, row2, marksLine].filter(Boolean).join('\n')
}

function renderInstructionsBlock(b) {
  if (!b.text) return ''
  const items = String(b.text)
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
  const content = items.length > 1
    ? `<ol>${items.map(item => `<li>${renderInstructionsHtml(item)}</li>`).join('')}</ol>`
    : renderInstructionsHtml(b.text)
  return `<div class="instructions">
  <span class="label">Instructions</span>
  ${content}
</div>`
}

function renderSectionHeader(b) {
  // The section's total honours the same show/hide decision as the per-question
  // marks (§4): a paper that hides marks from learners must not print the
  // section's total in its heading.
  const marksTag = b.showMarks === false
    ? ''
    : ` <span class="marks-tag">(${b.marks} mark${b.marks === 1 ? '' : 's'})</span>`
  return `<div class="section-head">Section ${escapeHtml(b.letter)}${b.title ? ` — ${escapeHtml(b.title)}` : ''}${marksTag}</div>
  ${b.instructions ? `<div class="section-instr">${escapeHtml(b.instructions)}</div>` : ''}`
}

function renderPassage(b) {
  return `<div class="passage">
    ${b.title ? `<strong class="h">${escapeHtml(b.title)}</strong>` : ''}
    ${b.text ? `<div>${b.text.split('\n\n').map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div>` : ''}
    ${b.imageUrl ? `<div style="margin-top:6pt; text-align:center;"><img src="${escapeHtml(b.imageUrl)}" alt=""></div>` : ''}
    ${diagramHtml(b.imageDiagram)}
  </div>`
}

/**
 * The width a figure's frame prints at, and the floor it may not go under (§4.2).
 *
 * The print window used to shrink-wrap the frame around the source image
 * (`display:inline-block; max-width:80%`), so a 96px diagram printed at 96px no
 * matter what the teacher's preset said and the band's minimum never applied —
 * the same figure came out at 25.4mm here and 93mm in Word. It also ignored the
 * width preset entirely, hard-coding 80%.
 *
 * `max-width:100%` in the stylesheet keeps the page winning over the floor, so a
 * figure the column cannot fit is narrowed rather than pushed off the sheet.
 */
function figureFrameStyle(block, widthPreset) {
  const percent = resolveImageWidthPercent(widthPreset ?? block?.imageWidth)
  const floorPx = Number(block?.figureMinWidthPx) || 0
  return `width:${percent}%;${floorPx > 0 ? `min-width:${floorPx}px;` : ''}`
}

function renderQuestion(b) {
  const marks = b.marks ?? 1
  // `showMarks` is the paper's or the section's decision (§4); absent on a block
  // built by a caller that predates it, which then keeps the old behaviour.
  const qmark = marks > 1 && b.showMarks !== false
    ? `<em class="qmarks">(${marks}&nbsp;marks)</em>`
    : ''
  let body = ''

  if (b.imageUrl) {
    const labels = Array.isArray(b.diagramLabels) ? b.diagramLabels : []
    const isIdentify = b.diagramMode === 'identify'
    // Identify mode prints numbered hotspots (1, 2, …) instead of the
    // label text — the text goes into the marking key, not the paper.
    // Positions, targets and leader endpoints come from the shared resolver, so
    // a label separated in the studio preview is separated here too. Before
    // this the print window drew the pills and silently DROPPED the leader
    // lines, leaving labels floating with nothing pointing at the part.
    const placed = resolveFigureLabels(labels, { mode: b.diagramMode }).labels
    // On the marking key an identify diagram is NAMED on the picture (§4.3).
    // The markers resolve identically on both copies, so the numbers still
    // correspond — the key adds names, it does not move anything.
    const answerNames = (b.showAnswer && isIdentify)
      ? resolveAnswerKeyLabels(labels).names
      : []
    const labelHtml = placed.map((l) => {
      const inner = isIdentify ? String(l.index + 1) : escapeHtml(l.text)
      const cls = isIdentify ? 'diagram-label diagram-label-num' : 'diagram-label'
      return `<span class="${cls}" style="left:${(l.x * 100).toFixed(2)}%;top:${(l.y * 100).toFixed(2)}%">${inner}</span>`
    }).join('') + answerNames.map((l) => (
      `<span class="diagram-label diagram-label-answer" style="left:${(l.x * 100).toFixed(2)}%;top:${(l.y * 100).toFixed(2)}%">${escapeHtml(l.text)}</span>`
    )).join('')
    const withLeaders = [...placed, ...answerNames]
    const leaderHtml = withLeaders.some(l => l.leader)
      ? `<svg class="diagram-leaders" aria-hidden="true">${withLeaders.map(l => (l.leader
        ? `<line x1="${(l.leader.x1 * 100).toFixed(2)}%" y1="${(l.leader.y1 * 100).toFixed(2)}%"` +
          ` x2="${(l.leader.x2 * 100).toFixed(2)}%" y2="${(l.leader.y2 * 100).toFixed(2)}%"` +
          ' stroke="#000" stroke-width="1"/>' +
          `<circle cx="${(l.leader.x2 * 100).toFixed(2)}%" cy="${(l.leader.y2 * 100).toFixed(2)}%" r="2.5" fill="#000"/>`
        : '')).join('')}</svg>`
      : ''
    body += `<div class="q-image"><div class="q-image-frame" style="${figureFrameStyle(b)}"><img src="${escapeHtml(b.imageUrl)}" alt="">${leaderHtml}${labelHtml}</div></div>`
    if (isIdentify && labels.length) {
      const blanks = labels.map(() => `<li><span class="identify-blank"></span></li>`).join('')
      body += `<ol class="identify-list">${blanks}</ol>`
    }
  }
  // Additional figures stacked below the primary (multi-figure questions).
  if (Array.isArray(b.images)) {
    for (const img of b.images) {
      if (img && img.url) {
        body += `<div class="q-image"><div class="q-image-frame" style="${figureFrameStyle(b, img.width)}"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}"></div></div>`
      }
    }
  }
  // Catalog shape diagram on the question stem (imageDiagram: {libraryKey, params}).
  // Rendered after uploaded images so a question can carry both a photo and a
  // geometric figure without either obscuring the other — mirrors PaperBlocks.jsx.
  body += diagramHtml(b.imageDiagram)
  if (b.tableData) {
    body += renderDataTable(b.tableData)
  }
  // Word bank for non-fill_blanks types (fill_blanks has its own bordered box
  // rendered inside renderFillBlanksHtml; a generic word-bank line printed here
  // would double it up and diverge from the preview — PaperBlocks.jsx ~:321).
  if (b.type !== 'fill_blanks' && b.wordBank && b.wordBank.length) {
    body += `<div class="word-bank"><strong>Word bank:</strong> ${b.wordBank.map(escapeHtml).join(' · ')}</div>`
  }

  if (b.type === 'mcq' || b.type === 'truefalse' || b.type === 'true_false' || b.type === 'tf') {
    body += renderOptionsHtml(b)
  } else if (b.type === 'fill_blanks') {
    // Fill-in-the-Blanks: word-bank box + numbered statements with blank spans.
    // In scheme mode (showAnswer) the blanks are filled with the expected answer
    // in green — mirrors PaperFillBlanks in PaperBlocks.jsx ~:372-419 and the
    // DOCX renderQuestion fill_blanks branch in assessmentToDocx.js ~:1065-1092.
    body += renderFillBlanksHtml(b)
  } else if (b.type === 'short_answer' || b.type === 'fill') {
    // Short-answer: sub-parts take priority if present; otherwise a plain answer
    // space honouring answerFormat / blankLabels / explicit answerLines (incl. 0).
    body += b.subParts?.length > 0
      ? renderSubParts(b)
      : answerSpaceHtml(b, DEFAULT_ANSWER_LINES.short)
  } else if (b.type === 'diagram') {
    body += answerSpaceHtml(b, DEFAULT_ANSWER_LINES.diagram)
  } else if (b.type === 'essay') {
    body += answerSpaceHtml(b, DEFAULT_ANSWER_LINES.essay)
  } else if (b.type === 'numeric') {
    body += renderNumericLine(b)
  } else if (b.type === 'matching') {
    body += renderMatchingColumns(b)
  } else if (b.type === 'sequence') {
    body += renderSequenceList(b)
  }

  if (Number.isFinite(Number(b.drawingHeight)) && Number(b.drawingHeight) > 0) {
    const h = Math.round(Number(b.drawingHeight))
    body += `<div class="draw-canvas" style="height:${h}pt"></div>`
  }

  if (b.showAnswer) {
    body += renderAnswerBlock(b)
  }

  // Prefer the pre-hydrated rich HTML (Tiptap JSON → safeRender → paper
  // HTML) so vertical sums, fractions, and number bases survive into the
  // printable paper exactly as the editor preview drew them. Fall back
  // to the escaped plain text for legacy content.
  const qBody = b.textHtml && b.textHtml.trim()
    ? b.textHtml
    : escapeHtml(b.text || '(no question text)')
  const questionClasses = ['question']
  if (b.tableData) questionClasses.push('has-table')
  // §7's semantic page-breaking, expressed as classes the stylesheet keys off.
  // The distinction the rules turn on is whether the question is a SHORT,
  // atomic one (a multiple-choice item, anything carrying a figure) — which
  // moves whole to the next page rather than splitting — or a long structured
  // one, which may split, but only between its sub-parts.
  if (b.type === 'mcq' || b.type === 'tf') questionClasses.push('q-choice')
  if (b.imageUrl || b.imageDiagram || (b.images || []).length) questionClasses.push('has-figure')
  if ((b.subParts || []).length) questionClasses.push('has-subparts')
  // Identity, for the pagination measurement. The printed sheet carries no
  // visible change — these are attributes, not content — but without them a
  // measured block cannot be traced back to the question it belongs to, and
  // "question 4 is split across two sheets" is exactly the finding a page
  // count is worth having for. The visual gate proves the render is unchanged.
  const qid = b.localId ?? b.id ?? b.questionId ?? ''
  return `<div class="${questionClasses.join(' ')}"${qid ? ` data-question-id="${escapeHtml(qid)}"` : ''} data-question-number="${escapeHtml(b.number)}">
    <div class="qline"><strong>${b.number}.</strong> <span class="qbody">${qBody}</span> ${qmark}</div>
    ${body}
  </div>`
}

function renderOptionsHtml(b) {
  const opts = b.options || []
  const optsHtml = b.optionsHtml || []
  const optsPlain = b.optionsPlain || []
  const correct = Number(b.correctAnswer)

  // Pick the best HTML representation for option `i`. Prefer the
  // pre-hydrated rich HTML (so stacked fractions / vertical sums survive
  // into the printed paper). Fall back to escaped plain text otherwise.
  const optHtml = (i) => {
    const rich = optsHtml[i]
    if (rich && String(rich).trim() && String(rich).trim() !== '<p></p>') return rich
    const fallback = optsPlain[i] ?? opts[i]
    return escapeHtml(fallback ?? '')
  }
  const optLength = (i) => {
    const text = optsPlain[i] ?? String(opts[i] ?? '')
    return text.length
  }

  if (b.optionsMode === 'image') {
    return `<div class="options-image">
      ${opts.map((opt, i) => {
        const media = b.optionMedia?.[i]
        // Prefer the catalog shape diagram; fall back to an uploaded image.
        // Mirrors PaperMcqOptions image-mode in PaperBlocks.jsx ~:535-539.
        let img
        if (media?.diagram?.libraryKey) {
          const svg = renderDiagramSvg(media.diagram.libraryKey, media.diagram.params, '#1c1612') || ''
          img = svg || '<span style="font-size:24pt;">?</span>'
        } else if (media?.imageUrl) {
          img = `<img src="${escapeHtml(media.imageUrl)}" alt="${escapeHtml(media.alt || '')}">`
        } else {
          img = '<span style="font-size:24pt;">?</span>'
        }
        const correctMark = (b.showAnswer && correct === i) ? ' <span class="correct-mark">✓</span>' : ''
        const labelInner = optsPlain[i] || opt
          ? ` <span class="opt-rich">${optHtml(i)}</span>`
          : ''
        return `<div class="item">
          <div class="img-box">${img}</div>
          <div class="lbl">${SECTION_LETTERS[i]}.${labelInner}${correctMark}</div>
        </div>`
      }).join('')}
    </div>`
  }
  if (b.optionsMode === 'mixed') {
    return `<div class="options-mixed">
      ${opts.map((opt, i) => {
        const media = b.optionMedia?.[i]
        // Prefer the catalog shape diagram; fall back to an uploaded image.
        // Mirrors PaperMcqOptions mixed-mode in PaperBlocks.jsx ~:559-563.
        let img
        if (media?.diagram?.libraryKey) {
          const svg = renderDiagramSvg(media.diagram.libraryKey, media.diagram.params, '#1c1612') || ''
          img = `<span class="img">${svg}</span>`
        } else if (media?.imageUrl) {
          img = `<img class="img" src="${escapeHtml(media.imageUrl)}" alt="${escapeHtml(media.alt || '')}">`
        } else {
          img = '<span class="img" style="display:inline-block;width:40pt;height:40pt;"></span>'
        }
        const correctMark = (b.showAnswer && correct === i) ? ' <span class="correct-mark">✓</span>' : ''
        return `<div class="item">
          <span class="letter">${SECTION_LETTERS[i]}.</span>
          ${img}
          <span class="opt-rich">${optHtml(i)}${correctMark}</span>
        </div>`
      }).join('')}
    </div>`
  }
  const long = opts.some((_, i) => optLength(i) > 18)
  return `<div class="options-text ${long ? 'stacked' : ''}">
    ${opts.map((opt, i) => {
      const correctMark = (b.showAnswer && correct === i) ? ' <span class="correct-mark">✓</span>' : ''
      return `<div><span class="letter">${SECTION_LETTERS[i]}.</span> <span class="opt-rich">${optHtml(i)}</span>${correctMark}</div>`
    }).join('')}
  </div>`
}

// Honour answerFormat / blankLabels / explicit answerLines (including 0) — mirrors
// answerSpaceParas in assessmentToDocx.js and PaperAnswerSpace in PaperBlocks.jsx.
// `defaultLines` is the fallback from DEFAULT_ANSWER_LINES when no explicit count is set.
function answerSpaceHtml(b, defaultLines) {
  if (b.answerFormat === 'none') return ''
  if (b.answerFormat === 'labelled_blanks' && Array.isArray(b.blankLabels) && b.blankLabels.length) {
    const rows = b.blankLabels.map(label =>
      `<div class="labelled-blank-row"><span class="blank-label">${escapeHtml(label)}:</span><span class="answer-line labelled-line"></span></div>`
    ).join('')
    return `<div class="answer-lines labelled-blanks">${rows}</div>`
  }
  const n = b.answerLines != null && Number.isFinite(Number(b.answerLines)) && Number(b.answerLines) >= 0
    ? Number(b.answerLines)
    : defaultLines
  if (n === 0) return ''
  return `<div class="answer-lines">${Array.from({ length: n }).map(() => '<div class="answer-line"></div>').join('')}</div>`
}

// Fill-in-the-Blanks: word-bank box (when non-empty) + one labelled row per statement.
// Blanks are rendered as dotted underline spans. In scheme mode (`b.showAnswer`) they
// are replaced with the expected answer highlighted in green — mirrors PaperFillBlanks
// in PaperBlocks.jsx (~:372-419) and the DOCX fill_blanks branch in
// assessmentToDocx.js (~:1065-1092).
function renderFillBlanksHtml(b) {
  const statements = Array.isArray(b.statements) ? b.statements : []
  let html = '<div class="fill-blanks">'
  if (Array.isArray(b.wordBank) && b.wordBank.length) {
    html += `<div class="fill-word-bank"><strong>Word Bank:</strong> ${b.wordBank.map(escapeHtml).join(' &nbsp;·&nbsp; ')}</div>`
  }
  for (let si = 0; si < statements.length; si++) {
    const s = statements[si]
    const text = String(s?.text ?? '')
    const answers = Array.isArray(s?.answers) ? s.answers : []
    // splitStatementSegments returns plain text segments; blanks sit between
    // adjacent pairs (segs.length - 1 blanks total).
    const segs = splitStatementSegments(text)
    let inner = ''
    for (let i = 0; i < segs.length; i++) {
      inner += escapeHtml(segs[i])
      if (i < segs.length - 1) {
        const ans = answers[i]
        if (b.showAnswer && ans) {
          inner += `<span class="fill-answer">${escapeHtml(String(ans))}</span>`
        } else {
          inner += '<span class="fill-gap"></span>'
        }
      }
    }
    html += `<div class="fill-row">
      <span class="fill-label">${escapeHtml(statementLabel(si))}.</span>
      <span class="fill-text">${inner}</span>
    </div>`
  }
  html += '</div>'
  return html
}

// Sub-parts: "(a) sentence text [marks]" rows, each honouring per-part answerFormat
// ('inline' dotted-gap / 'lines' ruled lines / 'none' no space). Mirrors PaperSubParts
// in PaperBlocks.jsx (~:427-479) and subPartParas in assessmentToDocx.js (~:908-952).
function renderSubParts(b) {
  const subParts = Array.isArray(b.subParts) ? b.subParts : []
  let html = '<div class="subparts">'
  for (let i = 0; i < subParts.length; i++) {
    const p = subParts[i]
    const label = subPartLabel(i)
    const pMarks = Number(p.marks ?? 1)
    const marksTag = pMarks > 0 ? `<em class="qmarks" style="font-size:9.5pt;">&nbsp;[${pMarks}]</em>` : ''
    const fmt = p.answerFormat ?? 'inline'
    let partBody = ''
    if (fmt === 'none') {
      partBody = `<span>${escapeHtml(p.text || '')}</span>${marksTag}`
    } else if (fmt === 'lines') {
      const n = p.answerLines != null && Number.isFinite(Number(p.answerLines)) && Number(p.answerLines) >= 0
        ? Number(p.answerLines)
        : DEFAULT_ANSWER_LINES.short
      const linesHtml = n > 0
        ? `<div class="subpart-lines">${Array.from({ length: n }).map(() => '<div class="answer-line"></div>').join('')}</div>`
        : ''
      partBody = `<span>${escapeHtml(p.text || '')}</span>${marksTag}${linesHtml}`
    } else {
      // 'inline' (default): blanks are dotted gaps within the sentence.
      // splitPartBlanks returns plain text segments; blanks sit between pairs.
      const segs = splitPartBlanks(p.text || '')
      let inner = ''
      for (let j = 0; j < segs.length; j++) {
        inner += escapeHtml(segs[j])
        if (j < segs.length - 1) {
          inner += '<span class="subpart-gap"></span>'
        }
      }
      partBody = `<span>${inner}</span>${marksTag}`
    }
    html += `<div class="subpart-row">
      <span class="subpart-label">(${escapeHtml(label)})</span>
      <span class="subpart-body">${partBody}</span>
    </div>`
  }
  html += '</div>'
  return html
}

// Numeric questions get a single short answer line with an optional unit
// label printed after it (e.g. "____________ kg"). The fixed-width line
// matches the visual cue in the studio's PaperQuestionBlock preview.
function renderNumericLine(b) {
  const unit = b.numericUnit ? `<span class="numeric-unit">${escapeHtml(b.numericUnit)}</span>` : ''
  return `<div class="numeric-line"><span class="answer-line numeric"></span>${unit}</div>`
}

// Data/Table render — emits a plain HTML table with thin black borders.
// Empty cells stay empty so students can fill values in when relevant.
function renderDataTable(rawTableData) {
  // Unfold the persisted { cells } row shape when the block came straight
  // from a Firestore doc (see src/utils/tableData.js); in-memory string[][]
  // rows pass through unchanged.
  const tableData = hydrateTableData(rawTableData)
  if (!tableData || !tableData.headers.length) return ''
  const headers = tableData.headers
  const rows = tableData.rows
  const headerHtml = headers.map(h => `<th>${escapeHtml(h || '')}</th>`).join('')
  const bodyHtml = rows.map(row => {
    const cells = headers.map((_, j) => `<td>${escapeHtml((Array.isArray(row) ? row[j] : '') || '')}</td>`).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return `<div class="table-wrap"><table class="data-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`
}

// Sequence questions render as a single column of items, each preceded by
// a short underline where the student writes the correct 1-based position.
// Printed in the order the teacher typed (typically jumbled).
function renderSequenceList(b) {
  const items = Array.isArray(b.sequenceItems) ? b.sequenceItems : []
  let html = ''
  for (const it of items) {
    html += `<div class="seq-row"><span class="seq-blank"></span>${escapeHtml(it || '')}</div>`
  }
  return `<div class="seq-list">${html}</div>`
}

// Matching questions render as two side-by-side columns. Students draw
// lines between the left prompts and the right options; rendering matches
// the studio's PaperMatching preview exactly so what teachers see is what
// they print.
function renderMatchingColumns(b) {
  const left = Array.isArray(b.matchingLeft) ? b.matchingLeft : []
  const right = Array.isArray(b.matchingRight) ? b.matchingRight : []
  const rows = Math.max(left.length, right.length)
  const cell = (label, text) => `<div class="match-row">
    <strong>${escapeHtml(label)}.</strong> ${escapeHtml(text || '')}
  </div>`
  let leftHtml = ''
  let rightHtml = ''
  for (let i = 0; i < rows; i += 1) {
    leftHtml += cell(String(i + 1), left[i] || '')
    rightHtml += cell(SECTION_LETTERS[i] || '?', right[i] || '')
  }
  return `<div class="match-columns">
    <div class="match-col">${leftHtml}</div>
    <div class="match-col">${rightHtml}</div>
  </div>`
}

function renderAnswerBlock(b) {
  // fill_blanks answers are already rendered inline (green spans) by
  // renderFillBlanksHtml when b.showAnswer === true — nothing more to add here.
  if (b.type === 'fill_blanks') return ''

  // Sub-parts: list "(a) expected (b) expected …" before the normal answer lines —
  // mirrors PaperAnswerBlock's subParts branch in PaperBlocks.jsx (~:676).
  if (Array.isArray(b.subParts) && b.subParts.length > 0) {
    const pairs = b.subParts
      .map((p, i) => `(${subPartLabel(i)}) ${escapeHtml(String(p.answer ?? '—'))}`)
      .join('&nbsp;&nbsp; ')
    const body = `<div><span class="label">Answers:</span> ${pairs}</div>`
    return `<div class="answer-block">${body}${schemeNotesHtml(b)}</div>`
  }

  // Identify-mode diagrams print a numbered list of expected answers.
  if (b.type === 'diagram' && b.diagramMode === 'identify' && Array.isArray(b.diagramLabels) && b.diagramLabels.length) {
    const pairs = b.diagramLabels.map((l, i) => `${i + 1}. ${escapeHtml(l.text || '—')}`).join('&nbsp;&nbsp; ')
    const body = `<div><span class="label">Answers:</span> ${pairs}</div>`
    return `<div class="answer-block">${body}${schemeNotesHtml(b)}</div>`
  }
  let body = ''
  if (b.type === 'mcq' || b.type === 'truefalse' || b.type === 'true_false' || b.type === 'tf') {
    const i = Number(b.correctAnswer)
    const letter = SECTION_LETTERS[i] || '?'
    // The PLAIN mirror, not the raw option. A rich option is a Tiptap doc, and
    // `String(doc)` is "[object Object]" — which is what the printed marking
    // key said for a fraction answer. The Word export already read
    // `optionsPlain` here; the print window did not, and the two disagreed.
    const opt = b.optionsPlain?.[i] ?? b.options?.[i] ?? ''
    body = `<div><span class="label">Answer:</span> ${escapeHtml(letter)}. ${escapeHtml(String(opt))}</div>`
  } else if (b.type === 'numeric') {
    const value = escapeHtml(String(b.correctAnswer ?? ''))
    const unit = b.numericUnit ? ` ${escapeHtml(b.numericUnit)}` : ''
    const tol = Number(b.numericTolerance) > 0 ? ` (±${escapeHtml(String(b.numericTolerance))})` : ''
    body = `<div><span class="label">Expected answer:</span> ${value}${unit}${tol}</div>`
  } else if (b.type === 'matching') {
    const left = Array.isArray(b.matchingLeft) ? b.matchingLeft : []
    const right = Array.isArray(b.matchingRight) ? b.matchingRight : []
    const answer = Array.isArray(b.matchingAnswer) ? b.matchingAnswer : []
    const pairs = left.map((_, i) => {
      const j = Number(answer[i])
      if (!Number.isInteger(j) || j < 0) return `${i + 1}→—`
      const letter = SECTION_LETTERS[j] || '?'
      const r = right[j] || ''
      return `${i + 1}→${escapeHtml(letter)}${r ? ` (${escapeHtml(r)})` : ''}`
    }).join('&nbsp;&nbsp; ')
    body = `<div><span class="label">Answer:</span> ${pairs}</div>`
  } else if (b.type === 'sequence') {
    const items = Array.isArray(b.sequenceItems) ? b.sequenceItems : []
    const answer = Array.isArray(b.sequenceAnswer) ? b.sequenceAnswer : []
    const ordered = items
      .map((it, idx) => ({ pos: Number(answer[idx]) || 999, text: it }))
      .sort((a, b2) => a.pos - b2.pos)
    const seq = ordered.map(e => {
      const label = e.pos < 999 ? `${e.pos}.` : '?'
      return `${label} ${escapeHtml(e.text || '—')}`
    }).join('&nbsp;&nbsp; ')
    body = `<div><span class="label">Correct order:</span> ${seq}</div>`
  } else if (b.answerHtml && b.answerHtml.trim()) {
    // A structured expected answer. `b.answerHtml` is already sanitised and
    // pre-hydrated by the layout, so the fraction bar is in the markup — which
    // matters here more than anywhere, because the print window runs no
    // JavaScript. escapeHtml(String(correctAnswer)) printed "[object Object]".
    body = `<div><span class="label">Expected answer:</span> ${b.answerHtml}</div>`
  } else {
    body = `<div><span class="label">Expected answer:</span> ${escapeHtml(b.answerPlain ?? String(b.correctAnswer ?? ''))}</div>`
  }
  body += schemeNotesHtml(b)
  return `<div class="answer-block">${body}</div>`
}

/**
 * The marking note under an answer — rich when the teacher wrote mathematics
 * into it, escaped plain text otherwise (which is what every note written
 * before this existed still takes).
 */
function schemeNotesHtml(b) {
  if (b.explanationHtml && b.explanationHtml.trim()) {
    return `<div class="notes">Notes: ${b.explanationHtml}</div>`
  }
  if (!b.explanation) return ''
  return `<div class="notes">Notes: ${escapeHtml(b.explanation)}</div>`
}
