/**
 * Export flashcards as a real .pdf file — cut-out-ready card pairs mirroring
 * flashcardsToDocx.js: cards go two-up per row, the QUESTION fronts on one
 * row and the matching ANSWER backs directly beneath, dashed borders for the
 * scissors. Uses htmlToPdf.js (lazy html2canvas + jsPDF); falls back to the
 * browser print dialog if client-side rendering fails.
 */
import { makePdfExporter, escapeHtml as safe } from '../../utils/htmlPdfExport.js'

const BRAND = '#059669' // emerald-600
const FRONT_ACCENT = '#f59e0b' // amber-500, matches the DOCX front label

function cardCell(card, isFront) {
  if (!card) return '<td class="card"></td>'
  let inner = `<p class="card-label ${isFront ? 'is-front' : 'is-back'}">${isFront ? 'QUESTION' : 'ANSWER'}</p>`
  if (isFront) {
    inner += `<p class="card-front">${safe(card.front)}</p>`
  } else {
    inner += `<p class="card-back">${safe(card.back)}</p>`
    if (card.example) inner += `<p class="card-extra">Example: ${safe(card.example)}</p>`
    if (card.hint) inner += `<p class="card-extra">&#128161; ${safe(card.hint)}</p>`
  }
  return `<td class="card">${inner}</td>`
}

// Exported for the plain-node export tests — pure string builder, no DOM.
export function buildFlashcardsPrintableHtml(flashcards) {
  const h = flashcards.header || {}
  const cards = flashcards.cards || []
  const metaLine = [h.grade, h.subject, h.topic].filter(Boolean).map(safe).join(' &middot; ')

  // Pair the cards like the DOCX: fronts row on top, matching backs below,
  // one small table per pair so a pair never splits across pages.
  let pairs = ''
  for (let i = 0; i < cards.length; i += 2) {
    const a = cards[i]
    const b = cards[i + 1] || null
    pairs += `<table class="pair"><tbody>
      <tr>${cardCell(a, true)}${cardCell(b, true)}</tr>
      <tr>${cardCell(a, false)}${cardCell(b, false)}</tr>
    </tbody></table>`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${safe(h.title || 'Flashcards')}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:"Times New Roman",Georgia,serif;color:#0f172a;background:#fff;font-size:11.5pt;line-height:1.45}
  body{padding:22px 30px;max-width:210mm;margin:0 auto}

  .masthead{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid ${BRAND};padding-bottom:8px;margin-bottom:14px}
  .brand{font-size:15pt;font-weight:800;color:${BRAND}}
  .brand-sub{font-size:8.5pt;color:#64748b;text-transform:uppercase;letter-spacing:.7px;margin-top:1px}
  .doc-type{font-size:9pt;color:#64748b;text-align:right}

  h1{font-size:17pt;font-weight:800;text-align:center;margin:0 0 4px}
  .meta{text-align:center;font-size:10pt;color:#6b7280;margin-bottom:4px}
  .cut-note{text-align:center;font-size:9.5pt;font-style:italic;color:#6b7280;margin-bottom:16px}

  /* one table per card pair — a <table> (not CSS grid) so html2canvas lays
     the two columns out reliably */
  table.pair{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 14px}
  td.card{width:50%;border:1.5px dashed #9ca3af;padding:10px 12px;vertical-align:top}
  .card-label{font-size:8pt;font-weight:800;letter-spacing:.8px;margin-bottom:4px}
  .card-label.is-front{color:${FRONT_ACCENT}}
  .card-label.is-back{color:${BRAND}}
  .card-front{font-size:11.5pt;font-weight:700}
  .card-back{font-size:11pt}
  .card-extra{font-size:9.5pt;font-style:italic;color:#6b7280;margin-top:4px}

  /* Keep these out of @media print: the PDF download rasterises in screen
     media and reads these computed styles to decide where NOT to cut a page. */
  table.pair{page-break-inside:avoid;break-inside:avoid}
  tr{page-break-inside:avoid;break-inside:avoid}

  @media print{ body{padding:12mm 16mm;max-width:none} }
</style>
</head>
<body>
  <div class="masthead">
    <div>
      <div class="brand">ZedExams</div>
      <div class="brand-sub">Zambian CBC &middot; Teacher Tools</div>
    </div>
    <div class="doc-type">FLASHCARDS &mdash; Cut-out set</div>
  </div>

  <h1>${safe(h.title || 'Flashcards')}</h1>
  ${metaLine ? `<p class="meta">${metaLine}</p>` : ''}
  <p class="cut-note">Print double-sided. Cut along the dashed lines and fold each pair to make flashcards.</p>

  ${pairs}
</body>
</html>`
}

const exporter = makePdfExporter(buildFlashcardsPrintableHtml, { emptyMessage: 'No flashcards to export.' })

/**
 * Download the flashcards as a real .pdf file. Falls back to the browser
 * print dialog if client-side rendering fails.
 */
export async function downloadFlashcardsPdf(flashcards, filename = 'flashcards.pdf', { attribution = false } = {}) {
  return exporter.download(flashcards, filename, { attribution })
}

export function printFlashcardsPdf(flashcards, { attribution = false } = {}) {
  return exporter.print(flashcards, { attribution })
}
