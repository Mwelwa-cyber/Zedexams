// Export
const exportPop = $('#export-pop');
$('#btn-export').addEventListener('click', e => { e.stopPropagation(); exportPop.classList.toggle('open'); });
document.addEventListener('click', () => exportPop.classList.remove('open'));
exportPop.addEventListener('click', e => e.stopPropagation());
$$('#export-pop button').forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.export; exportPop.classList.remove('open');
  if (t === 'pdf') exportPDF(); if (t === 'word') exportWord(); if (t === 'html') exportHTML();
}));
function gatherStyles() {
  return Array.from(document.styleSheets).map(s => { try { return Array.from(s.cssRules).map(r => r.cssText).join('\n'); } catch (e) { return ''; } }).join('\n');
}
function exportPDF() { if (editing) doc.contentEditable = false; window.print(); if (editing) doc.contentEditable = true; }
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = currentFilename() + '.docx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
function currentFilename() {
  const i = gatherInput();
  const safe = (s) => (s || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return ['lesson', safe(i.klass), safe(i.subject), safe(i.topic) || 'plan'].filter(Boolean).join('_').toLowerCase();
}
function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
