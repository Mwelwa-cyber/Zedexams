/**
 * Shared plumbing for the studio HTML→PDF exporters (flashcards, rubric,
 * notes, homework, full lesson, scheme of work, SBA task …).
 *
 * Each exporter keeps its own pure `build*PrintableHtml(data, opts)` template;
 * this module only factors the identical download/print shell around it:
 *
 *   - real-PDF download via htmlToPdf.js (lazy html2canvas + jsPDF), with
 *   - a window.print() fallback when client-side rendering fails, and
 *   - the free-plan diagonal watermark (exportWatermark.js).
 *
 * NOTE for the print fallback: the features string passed to `window.open`
 * must NOT contain `noopener`/`noreferrer` — either one makes the call return
 * `null` and the export dies on a blank white page (see
 * scripts/test-pdf-export-window.test.js for the long version).
 */
import { downloadHtmlAsPdf } from './htmlToPdf.js'
import { injectHtmlWatermark, WATERMARK_TEXT } from './exportWatermark.js'

/** Escape a value for interpolation into HTML text/attribute context. */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Free-plan exports get the diagonal ZedExams watermark; paid/admin stay clean. */
export const withWatermark = (html, attribution) =>
  attribution ? injectHtmlWatermark(html, WATERMARK_TEXT) : html

/**
 * Wrap a pure HTML builder into `{ download, print }`.
 *
 *   download(data, filename, opts) → Promise<boolean> — saves a real .pdf,
 *     falling back to print() if rendering fails.
 *   print(data, opts) — opens a popup, writes the document, calls print().
 *
 * `opts` is passed straight through to `buildHtml(data, opts)`; the one key
 * this shell reads itself is `opts.attribution` (watermark on/off).
 */
export function makePdfExporter(buildHtml, { emptyMessage = 'Nothing to export.' } = {}) {
  const render = (data, opts) => withWatermark(buildHtml(data, opts), opts.attribution)

  function print(data, opts = {}) {
    if (!data) throw new Error(emptyMessage)
    const win = window.open('', '_blank', 'width=900,height=1200')
    if (!win) {
      throw new Error('Your browser blocked the print window. Please allow pop-ups and try again.')
    }
    const html = render(data, opts)
    win.document.open()
    win.document.write(html)
    win.document.close()
    const ready = () => {
      try { win.focus(); win.print() } catch { /* leave for manual Ctrl+P */ }
    }
    if (win.document.readyState === 'complete') setTimeout(ready, 120)
    else win.addEventListener('load', () => setTimeout(ready, 120))
  }

  async function download(data, filename, opts = {}) {
    if (!data) throw new Error(emptyMessage)
    return downloadHtmlAsPdf(render(data, opts), filename, {
      onFallback: () => print(data, opts),
    })
  }

  return { download, print }
}
