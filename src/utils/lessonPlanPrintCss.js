/**
 * lessonPlanPrintCss — the ONE stylesheet a rendered lesson plan is drawn with.
 *
 * The studio preview injects it, the studio's print window inlines it, and the
 * PDF exporter inlines it. That is deliberate and it is the point: the preview
 * and the printout used to be styled by different rules, so a plan could look
 * two pages on screen and come out at four. Whatever this function returns IS
 * the printed page.
 *
 * The numbers are not constants here either — they come from the resolved
 * format in `lessonPlanFormat.js`, so a Page Budget or Paper Fit change is a
 * config edit rather than a CSS one.
 *
 * Pure string builder. No DOM, no imports beyond the format resolver.
 */

import { marginWarning, resolveLessonFormat } from './lessonPlanFormat.js'

/** CSS custom properties carrying a resolved format's typography. */
export function formatCssVariables(format) {
  const fmt = resolveLessonFormat(format)
  const t = fmt.typography
  return {
    '--lp-body-pt': `${t.bodyPt}pt`,
    '--lp-table-pt': `${t.tablePt}pt`,
    '--lp-cell-pad': `${t.cellPaddingPt}pt`,
    '--lp-line-height': String(t.lineHeight),
    '--lp-gap': `${t.sectionGapPt}pt`,
    '--lp-margin': `${fmt.marginMm}mm`,
  }
}

/** The same properties as an inline `style` string. */
export function formatCssVariableString(format) {
  return Object.entries(formatCssVariables(format))
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}

/**
 * The document stylesheet.
 *
 * @param {object} [format]  raw or resolved lesson format
 * @param {object} [opts]
 * @param {boolean} [opts.includePageRule]  emit `@page` (print window / PDF only —
 *   an `@page` rule inside the app would repaginate the whole application when a
 *   teacher pressed Ctrl+P on some other screen).
 * @param {boolean} [opts.includeSheets]    emit the paginated-sheet chrome.
 * @returns {string}
 */
export function lessonPlanPrintCss(format, { includePageRule = false, includeSheets = false } = {}) {
  const fmt = resolveLessonFormat(format)
  const vars = formatCssVariableString(fmt)
  const warning = marginWarning(fmt.marginMm)

  return `
${includePageRule ? `@page{size:A4;margin:${fmt.marginMm}mm}` : ''}

/* ── Document metrics (from the teacher's Page Budget + Paper Fit) ── */
.plan-compact{
  ${vars};
  font-size:var(--lp-body-pt);
  line-height:var(--lp-line-height);
  color:#000;
  font-family:'Times New Roman',Georgia,serif;
}

/* ── Masthead: no horizontal rules anywhere in the header (§4.3) ── */
.plan-compact .doc-head.clean{text-align:center;margin:0 0 4mm;padding:0;border:0}
.plan-compact .doc-head.clean .ministry{
  font-weight:700;font-size:1.14em;letter-spacing:.06em;margin:0 0 1.5mm;text-transform:uppercase;
}
.plan-compact .doc-head.clean .school{
  font-size:1.27em;font-weight:700;line-height:1.1;margin:0 0 1mm;letter-spacing:0;color:#000;
}
.plan-compact .doc-head.clean .department{font-size:.95em;font-style:italic;margin:0 0 1mm}
/* The title carries NO border — the two rules that used to bracket it cost two
   lines on every plan, and the Ministry reference documents do not have them. */
.plan-compact .doc-head.clean .lp-title{
  display:block;border:0;padding:0;margin:0;color:#000;
  font-size:1.09em;font-weight:600;letter-spacing:.25em;text-transform:uppercase;
}

/* ── Metadata: two columns, no rules, label and value never separating ──
   A borderless <table>, NOT a CSS grid. The PDF download rasterises with
   html2canvas, which lays out display:grid unreliably; a table renders the same
   in the browser, in the rasteriser and in Word. */
.plan-compact table.meta{
  width:100%;border-collapse:collapse;border:0;
  margin:0 0 4mm;font-size:.98em;table-layout:fixed;
}
.plan-compact table.meta td.item{
  border:0;padding:.6mm 8mm .6mm 0;vertical-align:top;width:50%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  line-height:var(--lp-line-height);
}
.plan-compact table.meta td.item.span2{white-space:normal;width:auto;padding-right:0}
.plan-compact table.meta td.item b{font-weight:700;text-decoration:underline;text-underline-offset:2px}
.plan-compact table.meta td.item .val{font-weight:400}

/* ── Section lines: underlined label, value inline, one line each (§4.4) ── */
.plan-compact .field-line{margin:0 0 calc(var(--lp-gap) / 2);line-height:var(--lp-line-height)}
.plan-compact .field-line b{font-weight:700;text-decoration:underline;text-underline-offset:2px}
.plan-compact .li.outcome{padding-left:5mm;text-indent:-5mm;margin:0 0 .6mm}
.plan-compact .progression-title{
  font-size:1.05em;font-weight:700;letter-spacing:.05em;text-align:center;
  text-decoration:underline;text-underline-offset:3px;
  margin:calc(var(--lp-gap) * 0.75) 0 1.5mm;color:#000;
}

/* ── Progression table ── */
.plan-compact .lp-table{
  width:100%;margin:0 0 1mm;table-layout:fixed;border-collapse:collapse;
  font-size:var(--lp-table-pt);
}
.plan-compact .lp-table th,
.plan-compact .lp-table td{
  border:1px solid #000;vertical-align:top;text-align:left;
  padding:var(--lp-cell-pad) calc(var(--lp-cell-pad) + 1pt);
  line-height:var(--lp-line-height);
  /* §4.1 — the STAGES column used to print "INTRODU CTION". Hyphenation off and
     normal word wrapping mean a word only breaks where the stage name itself
     has a separator. */
  hyphens:none;-webkit-hyphens:none;overflow-wrap:normal;word-break:normal;
}
.plan-compact .lp-table th{font-weight:700;background:#f4f1ea}
.plan-compact .lp-table td.stage{font-weight:700;font-size:.95em}
.plan-compact .lp-table td.stage .t{display:block;font-weight:400;font-style:italic;font-size:.95em}

/* Dash lines replace in-cell bullet lists (§4.1). The hanging indent is the
   width of the dash and nothing more — no cell width is spent on a marker. */
.plan-compact .li{padding-left:3.2mm;text-indent:-3.2mm;margin:0 0 .6mm}
.plan-compact .li:last-child{margin-bottom:0}

/* Per-stage table variants (Modern / Official CBC) share the same metrics. */
.plan-compact .stage-block{margin:0 0 2mm;page-break-inside:avoid;break-inside:avoid}
.plan-compact .stage-table{
  width:100%;font-size:var(--lp-table-pt);border-collapse:collapse;table-layout:fixed;
}
.plan-compact .stage-table td,
.plan-compact .stage-table th{
  padding:var(--lp-cell-pad) calc(var(--lp-cell-pad) + 1pt);
  vertical-align:top;text-align:left;line-height:var(--lp-line-height);
}
.plan-compact .stage-table .stage-head{font-weight:700;background:#f4f1ea}
.plan-compact .stage-table .stage-head .duration{float:right;font-style:italic;font-weight:400}

/* ── Evaluation: ONE ruled line per field (§4.5) ── */
.plan-compact .eval{margin-top:var(--lp-gap)}
.plan-compact .eval-field{display:flex;gap:3mm;align-items:flex-end;margin-bottom:3mm}
.plan-compact .eval-field b{white-space:nowrap;font-weight:700;text-decoration:underline;text-underline-offset:2px}
.plan-compact .eval-field .rule{flex:1;border-bottom:1px solid #000;height:1.2em}

/* ── Structured cell blocks (§4.7) ── */
.plan-compact .lp-sum td{border:0;padding:0 .6mm;text-align:center}
.plan-compact .lp-match td.lp-obj{vertical-align:middle}
.plan-compact .lp-match-title{font-style:italic}
.plan-compact .lp-figure img{max-width:100%;height:auto}

/* §4.1 — a row MAY split. Forcing a long Development row to stay whole is what
   pushed it onto a fresh page and left the previous one half blank. The header
   row repeats instead. */
.plan-compact .lp-table tr{page-break-inside:auto;break-inside:auto}
.plan-compact .lp-table thead{display:table-header-group}
${includeSheets ? SHEET_CSS(warning) : ''}
`.trim()
}

/**
 * The paginated-sheet chrome (§3.3): real A4 sheets, a per-sheet page footer,
 * and the dashed printable boundary when the margins are close to the edge.
 */
function SHEET_CSS(warning) {
  return `
/* ── Paginated preview: real A4 sheets ── */
.lp-sheets{width:210mm;margin:0 auto;transform-origin:top left}
.lp-sheet{
  width:210mm;height:297mm;background:#fff;position:relative;overflow:hidden;
  box-shadow:0 2px 14px rgba(28,22,18,.22);margin:0 0 20px;
}
.lp-sheet .lp-sheet-content{height:100%;overflow:hidden}
.lp-sheet .lp-pgnum{
  position:absolute;bottom:2mm;left:0;right:0;text-align:center;
  font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:7.5pt;color:#999;
}
/* Most printers cannot put ink in the outer ~5 mm. The overlay is a warning,
   never a block — a teacher who knows their printer is right more often. */
.lp-sheet .lp-safe{
  position:absolute;inset:5mm;pointer-events:none;border-radius:1mm;
  border:1.5px dashed ${warning.level === 'red' ? '#c0392b' : '#d9822b'};
}
@media print{
  .lp-sheets{width:auto;margin:0;transform:none !important}
  .lp-sheet{box-shadow:none;margin:0;height:auto;page-break-after:always;break-after:page}
  .lp-sheet:last-child{page-break-after:auto;break-after:auto}
  .lp-sheet .lp-pgnum,.lp-sheet .lp-safe{display:none}
}`
}
