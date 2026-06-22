// Export — `exportPop` is looked up fresh on each rebind so it always refers
// to the live React-rendered DOM.
let exportPop = null;

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
strong { font-weight: 700; }`;

// Build the Word-flavoured HTML document (inline print styles + Office
// namespaces) that the HTML→docx converter turns into a .docx.
function buildWordHtml() {
  return withWatermark(`<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Lesson Plan</title>
<style>${WORD_DOC_STYLES}</style>
</head><body><div class="WordSection1">${doc.innerHTML}</div></body></html>`);
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

async function exportWord() {
  if (typeof toast === 'function') toast('Preparing Word document…');
  const html = buildWordHtml();
  const filename = currentFilename() + '.docx';

  // Primary: real .docx via the locally-vendored converter.
  try {
    await loadHtmlDocxLib();
    const blob = window.htmlDocx.asBlob(html, { orientation: 'portrait', margins: { top: 1080, right: 960, bottom: 1080, left: 960 } });
    triggerDownload(blob, filename);
    if (typeof toast === 'function') toast('Word document downloaded');
    return;
  } catch (e) {
    console.error('docx export failed, falling back to .doc:', e);
  }

  // Fallback: a .doc (Word-readable HTML) built from a plain Blob — no network,
  // no library, opens in Word / Google Docs.
  if (typeof toast === 'function') toast('Downloading Word (.doc) instead…');
  exportWordLegacy();
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
// lesson split onto a fresh page (html-docx honours page-break-before).
function buildBatchWordHtml() {
  const b = window.__lpBatch || { meta: {}, lessons: [] };
  const lessons = Array.isArray(b.lessons) ? b.lessons : [];
  const brk = '<div style="page-break-before:always"></div>';
  const parts = [buildBatchCoverHtml(b.meta, lessons)].concat(lessons.map(l => l.html));
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

// Export the whole series as one .docx. Mirrors exportWord(): real .docx via the
// vendored converter, .doc fallback if it fails to load.
async function exportBatchWord() {
  if (typeof toast === 'function') toast('Preparing Word document…');
  const html = buildBatchWordHtml();
  const filename = batchFilename() + '.docx';
  try {
    await loadHtmlDocxLib();
    const blob = window.htmlDocx.asBlob(html, { orientation: 'portrait', margins: { top: 1080, right: 960, bottom: 1080, left: 960 } });
    triggerDownload(blob, filename);
    if (typeof toast === 'function') toast('Word document downloaded');
    return;
  } catch (e) {
    console.error('batch docx export failed, falling back to .doc:', e);
  }
  if (typeof toast === 'function') toast('Downloading Word (.doc) instead…');
  const b = window.__lpBatch || { meta: {}, lessons: [] };
  const lessons = Array.isArray(b.lessons) ? b.lessons : [];
  const brk = '<div style="page-break-before:always"></div>';
  const parts = [buildBatchCoverHtml(b.meta, lessons)].concat(lessons.map(l => l.html));
  const styles = gatherStyles();
  const html2 = withWatermark(`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Lesson Plans</title><style>@page{size:A4;margin:18mm 16mm}body{font-family:Georgia,serif}${styles}</style></head><body><div class="doc">${parts.join(brk)}</div></body></html>`);
  download(html2, batchFilename() + '.doc', 'application/msword');
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
