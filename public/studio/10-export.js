// Export — `exportPop` is looked up fresh on each rebind so it always refers
// to the live React-rendered DOM.
let exportPop = null;

// Count of illustrations that could not be inlined during the current export
// run. Reset to 0 at the start of exportWord() / exportBatchWord() so multiple
// exports in the same session don't accumulate.
let _exportFailedImages = 0;

function __studioInitExport() {
  exportPop = $('#export-pop');
  if (!exportPop) return;
  const btn = $('#btn-export');
  if (btn) btn.addEventListener('click', e => {
    e.stopPropagation();
    // Refresh the whole-series button before opening so the lesson count is
    // current and it only shows after a genuine multi-lesson run.
    refreshBatchExportButtons();
    exportPop.classList.toggle('open');
  });
  exportPop.addEventListener('click', e => e.stopPropagation());
  $$('#export-pop button').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.export; exportPop.classList.remove('open');
    if (t === 'word') exportWord();
  }));
}

// Document-level click closes the popover. Bound once at script load.
document.addEventListener('click', () => { if (exportPop) exportPop.classList.remove('open'); });

window.__studioRebinders = window.__studioRebinders || [];
window.__studioRebinders.push(__studioInitExport);
function gatherStyles() {
  return Array.from(document.styleSheets).map(s => { try { return Array.from(s.cssRules).map(r => r.cssText).join('\n'); } catch (e) { return ''; } }).join('\n');
}

// Free-plan watermark. LessonPlanStudio.jsx sets window.__zxExportWatermark to
// the brand text for free teachers (empty/undefined for paid + admin). We paint
// it as a tiled, semi-transparent SVG body background so it lands on every page
// of the PDF and shows behind the plan text — mirrors the DOCX/PDF watermark in
// src/utils/exportWatermark.js (kept in sync; this vanilla studio isn't bundled).
function watermarkCss() {
  const text = window.__zxExportWatermark;
  if (!text) return '';
  const label = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">' +
    '<text x="160" y="100" transform="rotate(-30 160 100)" text-anchor="middle" ' +
    'font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" ' +
    'fill="#000000" fill-opacity="0.07">' + label + '</text></svg>';
  const uri = 'data:image/svg+xml,' + encodeURIComponent(svg);
  // background-image only (not the shorthand) so the white background-color stays.
  return 'body{background-image:url("' + uri + '");background-repeat:repeat;background-position:top left;}';
}

// Inject the watermark style last so it overrides the document's own body
// background. No-op when no watermark is set.
function withWatermark(html) {
  const css = watermarkCss();
  if (!css) return html;
  const style = '<style>' + css + '</style>';
  if (html.indexOf('</head>') !== -1) return html.replace('</head>', style + '</head>');
  return html.replace(/(<body[^>]*>)/i, '$1' + style);
}
// Shared Word print styles (Office namespaces) — used by the single-plan
// export and the whole-series batch export so the two never drift.
const WORD_DOC_STYLES = `
@page WordSection1 { size: 21cm 29.7cm; margin: 18mm 16mm 18mm 16mm; }
div.WordSection1 { page: WordSection1; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.4; color: #1c1612; }
h2.sec, .progression-title { font-family: Georgia, serif; font-weight: 700; font-size: 13pt; margin: 14pt 0 6pt; text-transform: uppercase; letter-spacing: 1pt; }
.doc-head { text-align: center; margin-bottom: 14pt; }
.doc-head .header-line { font-size: 10pt; font-weight: 600; letter-spacing: 1.5pt; text-transform: uppercase; }
.doc-head .school { font-size: 16pt; font-weight: 700; margin: 4pt 0 2pt; }
.doc-head .department { font-size: 10pt; font-style: italic; color: #555; }
.doc-head .lp-title { font-size: 14pt; font-weight: 700; letter-spacing: 2pt; margin-top: 8pt; text-transform: uppercase; }
.meta-table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt; }
.meta-table td { padding: 4pt 8pt; border: 1px solid #c8baa3; vertical-align: top; }
.meta-table td:first-child { font-weight: 700; width: 25%; background: #f5ebd9; }
.field-line { margin: 3pt 0; }
.lp-table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt; font-size: 10pt; }
.lp-table th, .lp-table td { padding: 5pt 7pt; border: 1px solid #1c1612; vertical-align: top; text-align: left; }
.lp-table thead th { background: #f5ebd9; font-weight: 700; text-transform: uppercase; font-size: 9.5pt; letter-spacing: 0.5pt; }
.lp-table .stage { font-size: 8pt; font-weight: 700; text-transform: uppercase; }
.stage-block { margin: 10pt 0; page-break-inside: avoid; }
.stage-table { width: 100%; border-collapse: collapse; border: 1.5px solid #1c1612; }
.stage-table .stage-head { background: #c89a3a; color: #fff; font-weight: 700; padding: 5pt 9pt; font-size: 11pt; }
.stage-table .stage-head .duration { float: right; font-style: italic; font-weight: 500; opacity: 0.9; }
.stage-table th.col-head { background: #f5ebd9; font-weight: 700; text-transform: uppercase; padding: 5pt 8pt; font-size: 9pt; border-top: 1px solid #c8baa3; text-align: left; }
.stage-table td { padding: 6pt 8pt; vertical-align: top; border-top: 1px solid #c8baa3; }
.c2-stage-table th.col-head, .c2-stage-table td { width: 33.33%; }
.c2-stage-table td + td { border-left: 1px solid #c8baa3; }
ul, ol { margin: 4pt 0 8pt 18pt; padding: 0; }
li { margin: 2pt 0; }
strong { font-weight: 700; }
.plan-official { color: #000; }
.field-line { margin: 3pt 0; line-height: 1.4; }
.field-line strong { font-weight: 700; }
.duration { font-style: italic; font-weight: 500; }
/* Word ignores CSS grid/flex, so prepareWordBody() rewrites the .meta-compact /
   .official-meta header grids into these 2-column tables — keep the styling here
   so the exported header matches the on-screen preview's ruled metadata block. */
.word-meta-table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; }
.word-meta-table td { width: 50%; padding: 3pt 12pt 3pt 0; vertical-align: top; font-size: 10.5pt; line-height: 1.35; }
.word-meta-table td strong { font-weight: 700; text-transform: uppercase; font-size: 9.5pt; letter-spacing: 0.3pt; }
/* Illustrations: AI line-art (remote <img>) + template diagrams (inline <svg>)
   are both inlined as data URIs by prepareWordBody() so Word can embed them. */
.stage-diagrams { margin-top: 6pt; }
.diagram-wrap { margin: 10pt 0; padding: 6pt; text-align: center; page-break-inside: avoid; }
.diagram-wrap img { max-width: 90%; height: auto; }
.diagram-caption { font-style: italic; font-size: 9.5pt; text-align: center; margin-top: 4pt; color: #555; }
/* Modern-format Lesson Evaluation blanks (grid on screen → fill lines in Word). */
.callout-line { margin: 6pt 0; }
.callout-line strong { font-weight: 700; }
.callout-line .blank { display: inline-block; min-width: 45%; border-bottom: 1px solid #000; }`;

// ── Word graphics + layout normalisation ────────────────────────────────────
//
// The studio preview and the Word export render from the SAME html
// (doc.innerHTML), so in principle they should match. They didn't, for two
// reasons rooted in the Word/MHT engine the vendored html-docx-js targets:
//
//   1. PICTURES — html-docx-js only embeds images whose src is a `data:` URI
//      (its inliner is /"data:(\w+\/\w+);.../). The lesson's AI illustrations
//      are remote Firebase-Storage <img>s, and the template/auto diagrams are
//      inline <svg> — Word embeds NEITHER, so every picture vanished from the
//      download even though it showed in the preview.
//   2. ARRANGEMENT — Word's HTML engine ignores CSS grid/flex, so the
//      grid-based metadata header (.meta-compact, on by default; .official-meta
//      for the classic formats) collapsed into a plain stack instead of the
//      two-column ruled block the preview shows.
//
// prepareWordBody() rewrites the export HTML to fix both: rasterise <svg>→PNG
// data URI, fetch remote <img>→data URI, and reflow the meta grids into
// 2-column <table>s Word can lay out. Browser-only (needs DOMParser / Image /
// canvas / fetch); a no-op elsewhere so the node regression tests still load
// this file. Failures are swallowed per-element — a broken picture must never
// abort the whole download.
async function prepareWordBody(html) {
  if (typeof DOMParser === 'undefined') return html;
  let parsed;
  try { parsed = new DOMParser().parseFromString(String(html || ''), 'text/html'); }
  catch (e) { return html; }
  const root = parsed && parsed.body;
  if (!root) return html;
  await rasterizeSvgsForWord(parsed, root);
  await inlineRemoteImagesForWord(root);
  convertMetaGridsToTables(parsed, root);
  return root.innerHTML;
}

// Draw one <svg> onto a canvas and return { url: PNG data URI, w }. The clone
// gets explicit width/height (some browsers won't rasterise a viewBox-only SVG)
// and a white backing so transparent diagrams don't print as grey blocks.
function svgToPngDataUrl(svg) {
  return new Promise((resolve) => {
    try {
      const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      const wAttr = parseFloat(svg.getAttribute('width'));
      const baseW = wAttr || (vb.length === 4 ? vb[2] : 320);
      const ratio = (vb.length === 4 && vb[2] > 0) ? (vb[3] / vb[2]) : 0.62;
      const w = Math.max(1, Math.round(baseW));
      const h = Math.max(1, Math.round(w * ratio));
      const clone = svg.cloneNode(true);
      clone.setAttribute('width', String(w));
      clone.setAttribute('height', String(h));
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const xml = new XMLSerializer().serializeToString(clone);
      const svgUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
      const scale = 2; // crisp on a 96→Word DPI bump
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = w * scale;
          canvas.height = h * scale;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve({ url: canvas.toDataURL('image/png'), w });
        } catch (e) { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = svgUri;
    } catch (e) { resolve(null); }
  });
}

async function rasterizeSvgsForWord(parsed, root) {
  const svgs = Array.from(root.querySelectorAll('svg'));
  for (const svg of svgs) {
    const out = await svgToPngDataUrl(svg);
    if (out && out.url) {
      const img = parsed.createElement('img');
      img.setAttribute('src', out.url);
      img.setAttribute('width', String(out.w));
      img.setAttribute('style', 'display:block;max-width:100%;height:auto;margin:0 auto');
      svg.replaceWith(img);
    }
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    try {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    } catch (e) { resolve(null); }
  });
}

// On failure each <img> is replaced with a visible placeholder so the docx
// has no silent blank boxes — the teacher can see which illustrations didn't
// load. Increments the module-level _exportFailedImages counter per miss.
async function inlineRemoteImagesForWord(root) {
  const imgs = Array.from(root.querySelectorAll('img'));
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (!/^https?:/i.test(src)) continue; // already a data: URI (e.g. rasterised svg)
    let embedded = false;
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (res && res.ok) {
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl) { img.setAttribute('src', dataUrl); embedded = true; }
      }
    } catch (e) { /* network or CORS failure — fall through to placeholder */ }
    if (!embedded) {
      _exportFailedImages++;
      const placeholder = img.ownerDocument.createElement('p');
      placeholder.setAttribute('style',
        'border:1px dashed #bbb;padding:8px 12px;color:#999;font-size:11px;' +
        'font-family:sans-serif;margin:8px 0;border-radius:4px');
      placeholder.textContent = '⚠️ Illustration could not be embedded (image unavailable)';
      img.replaceWith(placeholder);
    }
  }
}

// Lay a list of {html, wide} metadata cells into a 2-column table. `wide`
// entries (the official header's om-wide lines, and the compact block's first
// row) span both columns, mirroring the grid-column:1/-1 rule in lesson.css.
function buildWordMetaTable(parsed, items) {
  const table = parsed.createElement('table');
  table.className = 'word-meta-table';
  let i = 0;
  while (i < items.length) {
    const tr = parsed.createElement('tr');
    if (items[i].wide) {
      const td = parsed.createElement('td');
      td.setAttribute('colspan', '2');
      td.innerHTML = items[i].html;
      tr.appendChild(td);
      i += 1;
    } else {
      const td1 = parsed.createElement('td');
      td1.innerHTML = items[i].html;
      tr.appendChild(td1);
      i += 1;
      const td2 = parsed.createElement('td');
      if (i < items.length && !items[i].wide) { td2.innerHTML = items[i].html; i += 1; }
      tr.appendChild(td2);
    }
    table.appendChild(tr);
  }
  return table;
}

function convertMetaGridsToTables(parsed, root) {
  // .meta-compact (Modern + all formats, on by default): "<lbl>: <val>" items;
  // the first item is full-width on screen (first-child grid rule).
  root.querySelectorAll('.meta-compact').forEach((grid) => {
    const cells = Array.from(grid.querySelectorAll('.item')).map((it, idx) => {
      const lbl = it.querySelector('.lbl');
      const val = it.querySelector('.val');
      const label = lbl ? lbl.textContent.replace(/:\s*$/, '') : '';
      const value = val ? val.innerHTML : it.innerHTML;
      const html = lbl ? `<strong>${esc(label)}:</strong> ${value}` : it.innerHTML;
      return { html, wide: idx === 0 };
    });
    if (cells.length) grid.replaceWith(buildWordMetaTable(parsed, cells));
  });
  // .official-meta (Classic / Classic 2): om-item lines, some flagged om-wide.
  root.querySelectorAll('.official-meta').forEach((grid) => {
    const cells = Array.from(grid.querySelectorAll('.om-item')).map((it) => ({
      html: it.innerHTML,
      wide: it.classList.contains('om-wide'),
    }));
    if (cells.length) grid.replaceWith(buildWordMetaTable(parsed, cells));
  });
}

// Build the Word-flavoured HTML document (inline print styles + Office
// namespaces) that the HTML→docx converter turns into a .docx. Async because
// prepareWordBody() fetches + rasterises the lesson's pictures so they embed.
async function buildWordHtml() {
  const body = await prepareWordBody(doc.innerHTML);
  return withWatermark(`<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Lesson Plan</title>
<style>${WORD_DOC_STYLES}</style>
</head><body><div class="WordSection1">${body}</div></body></html>`);
}

// Lazy-load the HTML→docx converter. Served locally from /studio/vendor (NOT a
// CDN): the old CDN fetch silently failed whenever the network / CSP / an ad-
// blocker got in the way, which is why "Download Word" looked broken. The local
// copy works offline and inside the Android app.
let _htmlDocxPromise = null;
function loadHtmlDocxLib() {
  if (window.htmlDocx) return Promise.resolve();
  if (_htmlDocxPromise) return _htmlDocxPromise;
  _htmlDocxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/studio/vendor/html-docx.min.js';
    s.onload = () => resolve();
    s.onerror = () => { _htmlDocxPromise = null; reject(new Error('Failed to load Word converter')); };
    document.head.appendChild(s);
  });
  return _htmlDocxPromise;
}

// Mobile Word (Android / iOS / Web) cannot open the w:altChunk / afchunk.mht
// MHTML part that html-docx-js produces ("can't open files that contain
// alternate formats"). So when the native OOXML bridge is unavailable or fails,
// mobile must SKIP the html-docx-js fallback and go straight to the .doc
// (HTML-as-Word) path, which opens everywhere. Desktop Word converts altChunk
// fine, so it keeps the higher-fidelity html-docx fallback.
function isMobileUA() {
  try { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''); }
  catch (e) { return false; }
}

async function exportWord() {
  if (typeof toast === 'function') toast('Preparing Word document…');
  _exportFailedImages = 0;
  const html = await buildWordHtml();
  const filename = currentFilename() + '.docx';

  function warnIfImagesFailed() {
    if (_exportFailedImages > 0 && typeof toast === 'function') {
      const n = _exportFailedImages;
      toast(`${n} illustration${n > 1 ? 's' : ''} could not be embedded — marked in the document`);
    }
  }

  // Primary: native OOXML via the bundled docx library (no altChunk parts —
  // safe for Word on Android / iOS / Web). The bridge is registered by
  // LessonPlanStudio.jsx as window.__zxHtmlToDocx.
  if (typeof window !== 'undefined' && typeof window.__zxHtmlToDocx === 'function') {
    try {
      const blob = await window.__zxHtmlToDocx(html);
      if (blob) {
        triggerDownload(blob, filename);
        if (typeof toast === 'function') toast('Word document downloaded');
        warnIfImagesFailed();
        return;
      }
    } catch (e) {
      console.error('native docx export failed, falling back to html-docx:', e);
    }
  }

  // Secondary: real .docx via the locally-vendored html-docx-js converter
  // (altChunk format — DESKTOP Word only). Skipped on mobile, where altChunk is
  // unopenable; mobile drops straight to the .doc fallback below.
  if (!isMobileUA()) {
    try {
      await loadHtmlDocxLib();
      const blob = window.htmlDocx.asBlob(html, { orientation: 'portrait', margins: { top: 1080, right: 960, bottom: 1080, left: 960 } });
      triggerDownload(blob, filename);
      if (typeof toast === 'function') toast('Word document downloaded');
      warnIfImagesFailed();
      return;
    } catch (e) {
      console.error('docx export failed, falling back to .doc:', e);
    }
  }

  // Fallback: a .doc (Word-readable HTML) built from a plain Blob — no network,
  // no library, opens in Word / Google Docs.
  if (typeof toast === 'function') toast('Downloading Word (.doc) instead…');
  exportWordLegacy();
  warnIfImagesFailed();
}

// Legacy .doc fallback (HTML-as-Word) used if html-docx-js fails to load
function exportWordLegacy() {
  const styles = gatherStyles();
  const html = withWatermark(`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Lesson Plan</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>@page{size:A4;margin:18mm 16mm}body{font-family:Georgia,serif}${styles}</style></head><body><div class="doc">${doc.innerHTML}</div></body></html>`);
  download(html, currentFilename() + '.doc', 'application/msword');
}
// ── Whole-series batch export ───────────────────────────────────────────────
//
// A multi-lesson run (Multiple / Full week / Let AI suggest) generates and
// saves every lesson, but #doc only ever holds the last one (each loop
// iteration overwrites it — see 06-generate.js). window.__lpBatch collects each
// lesson's rendered HTML so the teacher can download the whole series as ONE
// Word document (a cover sheet + one lesson per page) — the format heads submit
// to the HoD. The single-plan Word export above is untouched.

// True only when the last run produced more than one lesson.
function lpBatchActive() {
  const b = window.__lpBatch;
  return !!(b && Array.isArray(b.lessons) && b.lessons.length > 1);
}

// Cover sheet: school identity + a contents list of every lesson in the series.
function buildBatchCoverHtml(meta, lessons) {
  const m = meta || {};
  const rows = [];
  if (m.teacher) rows.push(['Teacher', esc(m.teacher) + (m.tsno ? ' &nbsp;·&nbsp; TS ' + esc(m.tsno) : '')]);
  rows.push(['Subject', esc(m.subject || '')]);
  rows.push(['Class', esc(m.klass || '')]);
  if (m.termWeek) rows.push(['Term &amp; Week', esc(m.termWeek)]);
  rows.push(['Medium of Instruction', esc(m.medium || 'English')]);
  rows.push(['Duration', esc(m.duration || '') + ' minutes per lesson']);
  if (m.topic) rows.push(['Topic', esc(m.topic)]);
  if (m.subtopic) rows.push(['Sub-topic', esc(m.subtopic)]);
  rows.push(['Number of lessons', String(lessons.length)]);
  const contents = lessons
    .map(l => `<li>Lesson ${esc(l.lessonNumber)} of ${esc(l.total)}${l.focus ? ' — ' + esc(l.focus) : ''}</li>`)
    .join('');
  return `<div class="lp-print-page plan-official">
    <div class="doc-head">
      ${m.headerLine ? `<div class="header-line">${esc(m.headerLine)}</div>` : ''}
      <div class="school">${esc(m.school || 'School Name')}</div>
      ${m.department ? `<div class="department">${esc(m.department)}</div>` : ''}
      <div class="lp-title">Lesson Plans</div>
    </div>
    <table class="meta-table"><tbody>${rows.map(r => `<tr><td class="k">${r[0]}</td><td class="v">${r[1]}</td></tr>`).join('')}</tbody></table>
    <div class="progression-title">Lessons in this series</div>
    <ol style="padding-left:22px;margin:8px 0">${contents}</ol>
  </div>`;
}

// Word document for the whole series — shared styles, cover sheet first, each
// lesson split onto a fresh page (html-docx honours page-break-before). Async
// so every lesson's pictures + metadata go through the same prepareWordBody()
// normalisation as the single-plan export (otherwise the batch download would
// keep losing illustrations and reflowing the header).
async function buildBatchWordHtml() {
  const b = window.__lpBatch || { meta: {}, lessons: [] };
  const lessons = Array.isArray(b.lessons) ? b.lessons : [];
  const brk = '<div style="page-break-before:always"></div>';
  const rawParts = [buildBatchCoverHtml(b.meta, lessons)].concat(lessons.map(l => l.html));
  const parts = [];
  for (const part of rawParts) parts.push(await prepareWordBody(part));
  return withWatermark(`<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Lesson Plans</title>
<style>${WORD_DOC_STYLES}</style>
</head><body><div class="WordSection1">${parts.join(brk)}</div></body></html>`);
}

// Whole-series filename, e.g. "Grade 4 Mathematics Lesson Plans - Term 2, Week 5".
function batchFilename() {
  const m = (window.__lpBatch && window.__lpBatch.meta) || {};
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const head = [clean(m.klass), clean(m.subject), 'Lesson Plans'].filter(Boolean).join(' ');
  const tw = clean(m.termWeek);
  const name = tw ? `${head} - ${tw}` : head;
  return (name || 'Lesson Plans').slice(0, 120).trim();
}

// Export the whole series as one .docx. Mirrors exportWord(): native OOXML first,
// then the vendored html-docx-js converter, then the .doc fallback.
async function exportBatchWord() {
  if (typeof toast === 'function') toast('Preparing Word document…');
  _exportFailedImages = 0;
  const html = await buildBatchWordHtml();
  const filename = batchFilename() + '.docx';

  function warnIfImagesFailed() {
    if (_exportFailedImages > 0 && typeof toast === 'function') {
      const n = _exportFailedImages;
      toast(`${n} illustration${n > 1 ? 's' : ''} could not be embedded — marked in the document`);
    }
  }

  // Primary: native OOXML via the bundled docx library (no altChunk parts —
  // safe for Word on Android / iOS / Web). The bridge is registered by
  // LessonPlanStudio.jsx as window.__zxHtmlToDocx.
  if (typeof window !== 'undefined' && typeof window.__zxHtmlToDocx === 'function') {
    try {
      const blob = await window.__zxHtmlToDocx(html);
      if (blob) {
        triggerDownload(blob, filename);
        if (typeof toast === 'function') toast('Word document downloaded');
        warnIfImagesFailed();
        return;
      }
    } catch (e) {
      console.error('native batch docx export failed, falling back to html-docx:', e);
    }
  }

  // Secondary: real .docx via the locally-vendored html-docx-js converter
  // (altChunk format — DESKTOP Word only). Skipped on mobile, where altChunk is
  // unopenable; mobile drops straight to the .doc fallback below.
  if (!isMobileUA()) {
    try {
      await loadHtmlDocxLib();
      const blob = window.htmlDocx.asBlob(html, { orientation: 'portrait', margins: { top: 1080, right: 960, bottom: 1080, left: 960 } });
      triggerDownload(blob, filename);
      if (typeof toast === 'function') toast('Word document downloaded');
      warnIfImagesFailed();
      return;
    } catch (e) {
      console.error('batch docx export failed, falling back to .doc:', e);
    }
  }
  if (typeof toast === 'function') toast('Downloading Word (.doc) instead…');
  const b = window.__lpBatch || { meta: {}, lessons: [] };
  const lessons = Array.isArray(b.lessons) ? b.lessons : [];
  const brk = '<div style="page-break-before:always"></div>';
  const parts = [buildBatchCoverHtml(b.meta, lessons)].concat(lessons.map(l => l.html));
  const styles = gatherStyles();
  const html2 = withWatermark(`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Lesson Plans</title><style>@page{size:A4;margin:18mm 16mm}body{font-family:Georgia,serif}${styles}</style></head><body><div class="doc">${parts.join(brk)}</div></body></html>`);
  download(html2, batchFilename() + '.doc', 'application/msword');
  warnIfImagesFailed();
}

// Word icon matching the static export-popover button (LessonPlanStudio.jsx).
const BATCH_WORD_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8 9.5 16 12 10 14.5 16 17 8" stroke-width="1.7"/></svg>';

// Inject (or refresh) the whole-series button in the export popover. Called
// each time the popover opens so the lesson count stays current and the button
// vanishes after a single-lesson run. The injected button lives inside
// #export-pop, so it inherits the existing popover button styling.
function refreshBatchExportButtons() {
  if (!exportPop) return;
  exportPop.querySelectorAll('.lp-batch-export').forEach(n => n.remove());
  if (!lpBatchActive()) return;
  const n = window.__lpBatch.lessons.length;
  const frag = document.createElement('div');
  frag.className = 'lp-batch-export';
  frag.style.cssText = 'border-top:1px solid var(--line,#e5ddd0);margin-top:6px;padding-top:6px';
  frag.innerHTML =
    `<div class="lp-batch-export-label" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#7a6d5d;padding:4px 12px">Whole series (${n} lessons)</div>` +
    `<button type="button" data-batch="word">${BATCH_WORD_ICON} All ${n} lessons (Word)</button>`;
  exportPop.appendChild(frag);
  const wordBtn = frag.querySelector('[data-batch="word"]');
  if (wordBtn) wordBtn.addEventListener('click', () => { exportPop.classList.remove('open'); exportBatchWord(); });
}

// Human-readable download name — "Reception Pre-Mathematics and Science Lesson
// Plan - Shapes and Space" rather than a slug. Teachers asked for files that say
// what they are once they leave the app and land in a Downloads folder.
function currentFilename() {
  const i = gatherInput();
  // Strip only the characters that are illegal in filenames; keep spaces,
  // hyphens and parentheses so the name still reads naturally.
  const clean = (s) => String(s || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const head = [clean(i.klass), clean(i.subject), 'Lesson Plan'].filter(Boolean).join(' ');
  const topic = clean(i.topic);
  const name = topic && !head.toLowerCase().includes(topic.toLowerCase())
    ? `${head} - ${topic}`
    : head;
  return (name || 'Lesson Plan').slice(0, 120).trim();
}

// Trigger a browser download that keeps `filename`.
//
// PREFERRED: the bundled saveBlob, bridged in as window.__zxSaveBlob by
// LessonPlanStudio.jsx. It is the same robust path the PDF export uses — it
// writes full bytes to disk on the native Android app, uses the Web Share API on
// mobile browsers (so the real filename sticks and nothing is truncated), and
// falls back to file-saver on desktop. This is what fixes the corrupt Word
// download: the old data:-URL route below TRUNCATES large .docx files on Android
// Chrome ("Word found unreadable content") and saves them under a random UUID.
//
// FALLBACK (bridge unavailable, e.g. scripts loaded standalone): the legacy
// route. Android Chrome ignores the anchor `download` attribute for `blob:`
// URLs and names the file after the blob's UUID, so we convert small blobs to a
// `data:` URL first to make the name stick — but data: URLs truncate large
// files, so this is strictly a last resort.
function triggerDownload(blob, filename) {
  if (typeof window !== 'undefined' && typeof window.__zxSaveBlob === 'function') {
    try {
      const r = window.__zxSaveBlob(blob, filename);
      if (r && typeof r.catch === 'function') r.catch(() => legacyTriggerDownload(blob, filename));
      return;
    } catch (e) {
      // Bridge threw synchronously — fall through to the legacy route.
    }
  }
  legacyTriggerDownload(blob, filename);
}
function legacyTriggerDownload(blob, filename) {
  const isAndroid = /Android/i.test(navigator.userAgent || '');
  if (isAndroid && typeof FileReader !== 'undefined') {
    const reader = new FileReader();
    reader.onload = () => anchorDownload(reader.result, filename);
    reader.onerror = () => blobUrlDownload(blob, filename);
    reader.readAsDataURL(blob);
    return;
  }
  blobUrlDownload(blob, filename);
}
function blobUrlDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  anchorDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function anchorDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}
function download(content, filename, mime) {
  triggerDownload(new Blob([content], { type: mime }), filename);
}
