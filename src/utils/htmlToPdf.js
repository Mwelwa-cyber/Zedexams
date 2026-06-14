/**
 * Turn a full, print-ready HTML document string into a REAL downloaded .pdf
 * file (not a browser print dialog).
 *
 * Why this exists
 *   Every studio used to "download" a PDF by opening a popup and calling
 *   window.print() — which only shows the system print dialog ("Save as PDF"),
 *   confusing teachers who expected a file to land in Downloads, and failing
 *   outright in the Android WebView. This renders the same HTML off-screen,
 *   rasterises it with html2canvas, paginates it into A4 with jsPDF, and saves
 *   a blob. The print path stays available as a graceful fallback.
 *
 * Both heavy libraries are lazy-loaded (dynamic import) so they never touch the
 * main bundle — they're only fetched the first time a teacher exports a PDF.
 */
import { saveBlob } from './saveBlob.js'

// 210mm at 96dpi — the CSS pixel width of an A4 page. Rendering at this width
// makes the rasterised layout line up with the @page A4 print CSS.
const A4_WIDTH_PX = 794

let _libsPromise = null
function loadLibs() {
  if (!_libsPromise) {
    _libsPromise = Promise.all([import('html2canvas'), import('jspdf')])
      .then(([h2c, jspdf]) => ({
        html2canvas: h2c.default || h2c,
        jsPDF: jspdf.jsPDF || jspdf.default,
      }))
      .catch((e) => {
        _libsPromise = null
        throw e
      })
  }
  return _libsPromise
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// Don't start rasterising until fonts + images have settled, otherwise the
// PDF comes out with fallback fonts or blank pictures (the same bug the print
// path hit with remote Firebase Storage images).
async function waitForAssets(doc, timeout = 6000) {
  try {
    if (doc.fonts && doc.fonts.ready) {
      await Promise.race([doc.fonts.ready, delay(timeout)])
    }
  } catch {
    // fonts.ready can reject in old engines — ignore, we still have the delay
  }
  const imgs = Array.from(doc.images || []).filter((img) => !img.complete)
  if (imgs.length) {
    await Promise.race([
      Promise.all(
        imgs.map(
          (img) =>
            new Promise((res) => {
              img.addEventListener('load', res, { once: true })
              img.addEventListener('error', res, { once: true })
            }),
        ),
      ),
      delay(timeout),
    ])
  }
}

/**
 * Render an HTML document string to a PDF Blob. Throws on any failure so the
 * caller can fall back to printing.
 */
export async function htmlToPdfBlob(html, { scale = 2 } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('PDF generation requires a browser environment.')
  }
  const { html2canvas, jsPDF } = await loadLibs()

  // A standalone iframe is the only container that honours the <style> in the
  // document's <head>; injecting the markup into a <div> would drop those rules
  // (and leak them into the host app).
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${A4_WIDTH_PX}px;height:1123px;border:0;background:#fff;`
  document.body.appendChild(iframe)

  try {
    const idoc = iframe.contentDocument || iframe.contentWindow.document
    idoc.open()
    idoc.write(html)
    idoc.close()

    await waitForAssets(idoc)

    const target = idoc.body
    const fullHeight = Math.max(
      target.scrollHeight,
      idoc.documentElement.scrollHeight,
      1,
    )
    iframe.style.height = `${fullHeight}px`

    const canvas = await html2canvas(target, {
      scale,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: A4_WIDTH_PX,
      width: A4_WIDTH_PX,
      height: fullHeight,
      scrollX: 0,
      scrollY: 0,
    })

    if (!canvas.width || !canvas.height) {
      throw new Error('Rendered canvas was empty.')
    }

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const imgW = pageW
    const imgH = (canvas.height * imgW) / canvas.width
    const imgData = canvas.toDataURL('image/jpeg', 0.92)

    // Slice the tall image across as many A4 pages as it needs by re-placing it
    // at a negative Y offset on each new page.
    let heightLeft = imgH
    let position = 0
    pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH, undefined, 'FAST')
    heightLeft -= pageH
    while (heightLeft > 0) {
      position -= pageH
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH, undefined, 'FAST')
      heightLeft -= pageH
    }
    return pdf.output('blob')
  } finally {
    document.body.removeChild(iframe)
  }
}

/**
 * Render HTML to a PDF and save it as `filename`. On any failure (library load,
 * rendering, tainted canvas) runs `onFallback` — typically the studio's
 * window.print() path — so the export degrades instead of dying.
 *
 * @returns {Promise<boolean>} true if a real PDF file was saved.
 */
export async function downloadHtmlAsPdf(html, filename, { onFallback } = {}) {
  try {
    const blob = await htmlToPdfBlob(html)
    await saveBlob(blob, filename)
    return true
  } catch (e) {
    try {
      console.error('[htmlToPdf] real PDF failed — falling back to print:', e)
    } catch {
      // console may be unavailable
    }
    if (typeof onFallback === 'function') {
      try {
        onFallback()
      } catch {
        // fallback is best-effort
      }
    }
    return false
  }
}
