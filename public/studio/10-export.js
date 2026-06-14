// Export — `exportPop` is looked up fresh on each rebind so it always refers
// to the live React-rendered DOM.
let exportPop = null;

function __studioInitExport() {
  exportPop = $('#export-pop');
  if (!exportPop) return;
  const btn = $('#btn-export');
  if (btn) btn.addEventListener('click', e => { e.stopPropagation(); exportPop.classList.toggle('open'); });
  exportPop.addEventListener('click', e => e.stopPropagation());
  $$('#export-pop button').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.export; exportPop.classList.remove('open');
    if (t === 'pdf') exportPDF(); if (t === 'word') exportWord(); if (t === 'html') exportHTML();
  }));
}

// Document-level click closes the popover. Bound once at script load.
document.addEventListener('click', () => { if (exportPop) exportPop.classList.remove('open'); });

window.__studioRebinders = window.__studioRebinders || [];
window.__studioRebinders.push(__studioInitExport);
function gatherStyles() {
  return Array.from(document.styleSheets).map(s => { try { return Array.from(s.cssRules).map(r => r.cssText).join('\n'); } catch (e) { return ''; } }).join('\n');
}
function exportPDF() {
  // A bare window.print() prints the WHOLE studio page — the sidebar form,
  // planner, format cards and all — so the teacher ends up with several
  // pages of UI before their plan (the bug behind the "saving gave me this
  // PDF" report). Instead open a clean popup that contains ONLY the
  // rendered document + the studio styles, and print that, so the PDF is
  // the lesson plan alone.
  if (editing) doc.contentEditable = false;
  const restore = () => { if (editing) doc.contentEditable = true; };
  let win = null;
  try { win = window.open('', '_blank', 'width=900,height=1100'); } catch (e) { win = null; }
  if (!win) {
    // Pop-up blocked — fall back to the old behaviour so export still works.
    if (typeof toast === 'function') toast('Allow pop-ups for a clean PDF of just the plan.');
    window.print();
    restore();
    return;
  }
  const styles = gatherStyles();
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
    currentFilename() + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700;800&family=Lora:wght@400;600;700&display=swap" rel="stylesheet">' +
    '<style>' + styles +
    // Print-only overrides: fill the page, no screen shadow/accent bar.
    '@page{size:A4;margin:14mm 15mm}' +
    'html,body{background:#fff;margin:0;padding:0}' +
    '.doc-wrap{max-width:none;margin:0;box-shadow:none;border-radius:0}' +
    '.doc-wrap::before{display:none}' +
    '.doc{padding:0;min-height:0}' +
    '</style></head><body><div class="doc-wrap"><div class="doc">' +
    doc.innerHTML + '</div></div></body></html>';
  win.document.open();
  win.document.write(html);
  win.document.close();
  const triggerPrint = () => { try { win.focus(); win.print(); } catch (e) { /* user can Ctrl+P */ } };
  // Let the new window lay out and load fonts before printing.
  if (win.document.readyState === 'complete') setTimeout(triggerPrint, 350);
  else win.addEventListener('load', () => setTimeout(triggerPrint, 350));
  restore();
}
function exportHTML() {
  const styles = gatherStyles();
  const body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lesson Plan</title><link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700;800&family=Lora:wght@400;600;700&display=swap" rel="stylesheet"><style>${styles}</style></head><body><div class="doc-wrap" style="max-width:794px;margin:24px auto"><div class="doc">${doc.innerHTML}</div></div></body></html>`;
  download(body, currentFilename() + '.html', 'text/html');
}

// Lazy-load html-docx-js (400KB) — only fetched when user first exports to Word
let _htmlDocxPromise = null;
function loadHtmlDocxLib() {
  if (window.htmlDocx) return Promise.resolve();
  if (_htmlDocxPromise) return _htmlDocxPromise;
  _htmlDocxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.min.js';
    s.onload = () => resolve();
    s.onerror = () => { _htmlDocxPromise = null; reject(new Error('Failed to load Word converter')); };
    document.head.appendChild(s);
  });
  return _htmlDocxPromise;
}

async function exportWord() {
  toast('Preparing Word document…');
  try {
    await loadHtmlDocxLib();
  } catch (e) {
    toast('Could not load Word converter — falling back to .doc');
    return exportWordLegacy();
  }
  const styles = gatherStyles();
  // html-docx-js requires a complete HTML document with inline styles
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Lesson Plan</title>
<style>
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
</style>
</head><body><div class="WordSection1">${doc.innerHTML}</div></body></html>`;

  try {
    const blob = window.htmlDocx.asBlob(html, { orientation: 'portrait', margins: { top: 1080, right: 960, bottom: 1080, left: 960 } });
    triggerDownload(blob, currentFilename() + '.docx');
    toast('Word document downloaded');
  } catch (e) {
    console.error('docx export failed:', e);
    toast('Word export failed — try again');
  }
}

// Legacy .doc fallback (HTML-as-Word) used if html-docx-js fails to load
function exportWordLegacy() {
  const styles = gatherStyles();
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Lesson Plan</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>@page{size:A4;margin:18mm 16mm}body{font-family:Georgia,serif}${styles}</style></head><body><div class="doc">${doc.innerHTML}</div></body></html>`;
  download(html, currentFilename() + '.doc', 'application/msword');
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
// Android Chrome (and Android WebViews) ignore the anchor `download` attribute
// for `blob:` URLs — they name the saved file after the blob's random UUID,
// which is the "5fee66fe-…-….docx" teachers were seeing. Converting the blob to
// a `data:` URL first makes the `download` filename stick on Android while
// staying an ordinary blob download on desktop.
function triggerDownload(blob, filename) {
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
