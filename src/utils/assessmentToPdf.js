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

import { buildPaperLayout } from './assessmentPaperLayout.js'

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

export function openPrintWindow() {
  return window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100')
}

export function printAssessmentAsPdf(assessment, questions, { mode = 'paper', win: preWin = null } = {}) {
  if (!assessment) throw new Error('No assessment to export.')

  const win = preWin || window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100')
  if (!win) {
    throw new Error('Your browser blocked the print window. Please allow pop-ups and try again.')
  }

  const html = buildPrintableHtml(assessment, questions || [], mode)
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

function buildPrintableHtml(assessment, questions, mode) {
  const blocks = buildPaperLayout(assessment, questions, { mode })
  const docTitle = mode === 'scheme'
    ? `${assessment.title || 'Marking Key'} — Marking Key`
    : (assessment.title || 'Assessment')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(docTitle)}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
${blocks.map(renderBlock).join('\n')}
</body>
</html>`
}

const PRINT_CSS = `
@page { size: A4; margin: 20mm 18mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: white; }
body {
  color: #111;
  font-family: 'Times New Roman', 'Liberation Serif', serif;
  font-size: 11.5pt;
  line-height: 1.45;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

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
  border-bottom: 1pt solid #777;
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
  border: 1px solid #ccc;
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
.question .q-image .q-image-frame { position: relative; display: inline-block; max-width: 80%; }
.question .q-image .q-image-frame img { max-width: 100%; max-height: 240pt; display: block; }
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
  border: 1px solid #999;
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
  border: 1px solid #ccc;
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
.match-row { padding: 3pt 0; border-bottom: 1px dotted #999; }
.seq-list { margin: 6pt 0 12pt; }
.seq-row { display: flex; align-items: center; gap: 10pt; padding: 3pt 0; border-bottom: 1px dotted #999; }
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
  border: 1px dashed #999;
  background: #fafafa;
  padding: 8pt;
  text-align: center;
  font-style: italic;
  font-size: 10pt;
  color: #777;
  margin: 6pt 0;
  min-height: 80pt;
  display: grid; place-items: center;
}
.diagram-box img { max-width: 100%; max-height: 280pt; object-fit: contain; }

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
.footer-code {
  text-align: right;
  margin-top: 18pt;
  font-size: 9.5pt;
  color: #333;
}

@media print {
  .section-head, .passage, .instructions, .banner { page-break-inside: avoid; break-inside: avoid; }
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
    case 'pagebreak': return '<div class="pagebreak"></div>'
    case 'endOfPaper': return `<div class="end-of-paper">${escapeHtml(block.text)}</div>`
    case 'footerCode': return `<div class="footer-code">${escapeHtml(block.code)}</div>`
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
  const logoHtml = b.logoUrl
    ? `<div class="logo"${logoStyle}><img src="${escapeHtml(b.logoUrl)}" alt=""></div>`
    : `<div class="logo"${logoStyle}></div>`
  const codeLine = b.footerCode
    ? `<div class="line-1">${escapeHtml(String(b.footerCode).toUpperCase())}</div>`
    : ''
  const titleCodeLine = b.title
    ? `<div class="line-2">${escapeHtml(b.title)}</div>`
    : ''
  const durationLine = b.duration ? `<div class="banner-duration">${escapeHtml(String(b.duration))} MINUTES</div>` : ''
  return `<div class="banner">
  <div class="banner-top">
    ${logoHtml}
    <div class="banner-text">
    <div class="school">${escapeHtml(school).toUpperCase()}</div>
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
  const parts = []
  if (b.name) parts.push(`<span>NAME:</span><div class="line"></div>`)
  if (b.date) parts.push(`<span>DATE:</span><div class="line" style="max-width: 140pt;"></div>`)
  const row1 = parts.length
    ? `<div class="learner-row">${parts.join('')}</div>`
    : ''
  const row2 = b.classField
    ? `<div class="learner-row"><span>CLASS:</span><div class="line"></div></div>`
    : ''
  const marksLine = b.marks
    ? `<div class="total-marks">TOTAL MARKS: _____________ &nbsp; / &nbsp; ${b.totalMarks || '____'}</div>`
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
  return `<div class="section-head">Section ${escapeHtml(b.letter)}${b.title ? ` — ${escapeHtml(b.title)}` : ''} <span class="marks-tag">(${b.marks} mark${b.marks === 1 ? '' : 's'})</span></div>
  ${b.instructions ? `<div class="section-instr">${escapeHtml(b.instructions)}</div>` : ''}`
}

function renderPassage(b) {
  return `<div class="passage">
    ${b.title ? `<strong class="h">${escapeHtml(b.title)}</strong>` : ''}
    ${b.text ? `<div>${b.text.split('\n\n').map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div>` : ''}
    ${b.imageUrl ? `<div style="margin-top:6pt; text-align:center;"><img src="${escapeHtml(b.imageUrl)}" alt=""></div>` : ''}
  </div>`
}

function renderQuestion(b) {
  const marks = b.marks ?? 1
  const qmark = marks > 1
    ? `<em class="qmarks">(${marks}&nbsp;marks)</em>`
    : ''
  let body = ''

  if (b.imageUrl) {
    const labels = Array.isArray(b.diagramLabels) ? b.diagramLabels : []
    const isIdentify = b.diagramMode === 'identify'
    // Identify mode prints numbered hotspots (1, 2, …) instead of the
    // label text — the text goes into the marking key, not the paper.
    const labelHtml = labels.map((l, i) => {
      const inner = isIdentify ? String(i + 1) : escapeHtml(l.text)
      const cls = isIdentify ? 'diagram-label diagram-label-num' : 'diagram-label'
      return `<span class="${cls}" style="left:${(l.x * 100).toFixed(2)}%;top:${(l.y * 100).toFixed(2)}%">${inner}</span>`
    }).join('')
    body += `<div class="q-image"><div class="q-image-frame"><img src="${escapeHtml(b.imageUrl)}" alt="">${labelHtml}</div></div>`
    if (isIdentify && labels.length) {
      const blanks = labels.map(() => `<li><span class="identify-blank"></span></li>`).join('')
      body += `<ol class="identify-list">${blanks}</ol>`
    }
  }
  // Additional figures stacked below the primary (multi-figure questions).
  if (Array.isArray(b.images)) {
    for (const img of b.images) {
      if (img && img.url) {
        body += `<div class="q-image"><div class="q-image-frame"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}"></div></div>`
      }
    }
  }
  if (b.tableData) {
    body += renderDataTable(b.tableData)
  }
  if (b.wordBank && b.wordBank.length) {
    body += `<div class="word-bank"><strong>Word bank:</strong> ${b.wordBank.map(escapeHtml).join(' · ')}</div>`
  }

  if (b.type === 'mcq' || b.type === 'truefalse' || b.type === 'true_false' || b.type === 'tf') {
    body += renderOptionsHtml(b)
  } else if (b.type === 'short_answer' || b.type === 'fill') {
    body += renderAnswerLines(b.answerLines ?? 2)
  } else if (b.type === 'diagram') {
    body += renderAnswerLines(b.answerLines ?? 4)
  } else if (b.type === 'essay') {
    body += renderAnswerLines(b.answerLines ?? 10)
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
  return `<div class="${questionClasses.join(' ')}">
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
        const img = media?.imageUrl
          ? `<img src="${escapeHtml(media.imageUrl)}" alt="${escapeHtml(media.alt || '')}">`
          : '<span style="font-size:24pt;">?</span>'
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
        const img = media?.imageUrl
          ? `<img class="img" src="${escapeHtml(media.imageUrl)}" alt="${escapeHtml(media.alt || '')}">`
          : '<span class="img" style="display:inline-block;width:40pt;height:40pt;"></span>'
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

function renderAnswerLines(count) {
  const n = Math.max(1, Math.min(20, count))
  return `<div class="answer-lines">${Array.from({ length: n }).map(() => '<div class="answer-line"></div>').join('')}</div>`
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
function renderDataTable(tableData) {
  if (!tableData || !Array.isArray(tableData.headers) || !tableData.headers.length) return ''
  const headers = tableData.headers
  const rows = Array.isArray(tableData.rows) ? tableData.rows : []
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
  // Identify-mode diagrams print a numbered list of expected answers.
  if (b.type === 'diagram' && b.diagramMode === 'identify' && Array.isArray(b.diagramLabels) && b.diagramLabels.length) {
    const pairs = b.diagramLabels.map((l, i) => `${i + 1}. ${escapeHtml(l.text || '—')}`).join('&nbsp;&nbsp; ')
    const body = `<div><span class="label">Answers:</span> ${pairs}</div>`
    const notes = b.explanation ? `<div class="notes">Notes: ${escapeHtml(b.explanation)}</div>` : ''
    return `<div class="answer-block">${body}${notes}</div>`
  }
  let body = ''
  if (b.type === 'mcq' || b.type === 'truefalse' || b.type === 'true_false' || b.type === 'tf') {
    const i = Number(b.correctAnswer)
    const letter = SECTION_LETTERS[i] || '?'
    const opt = b.options?.[i] ?? ''
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
  } else {
    body = `<div><span class="label">Expected answer:</span> ${escapeHtml(String(b.correctAnswer ?? ''))}</div>`
  }
  if (b.explanation) {
    body += `<div class="notes">Notes: ${escapeHtml(b.explanation)}</div>`
  }
  return `<div class="answer-block">${body}</div>`
}
