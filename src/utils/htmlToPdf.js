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

/**
 * html2canvas rasterises the whole document into one flat bitmap, so the print
 * CSS that keeps a question/passage/table on one page (`page-break-inside:
 * avoid`) and the explicit `.pagebreak` divs (`page-break-after: always`) are
 * lost — the bitmap has no idea where a block starts or ends. We re-derive
 * those intentions from the live DOM here, in CANVAS pixels, so the paginator
 * can cut in the gaps between blocks instead of straight through a question.
 *
 * Returns:
 *   atomic — [{top, bottom}] for each top-level "keep together" block.
 *   forced — [y] where the layout asked for a hard page break.
 * Both are best-effort; on any failure we hand back empties and the caller
 * degrades to fixed-height slicing (the previous behaviour).
 */
function collectBreakGeometry(idoc, scale) {
  const empty = { atomic: [], forced: [] }
  try {
    const win = idoc.defaultView
    if (!win || typeof win.getComputedStyle !== 'function') return empty
    const bodyTop = idoc.body.getBoundingClientRect().top
    const toY = (clientY) => Math.round((clientY - bodyTop) * scale)
    const all = Array.from(idoc.body.querySelectorAll('*'))

    const avoidEls = all.filter((el) => {
      const cs = win.getComputedStyle(el)
      return cs.breakInside === 'avoid' || cs.pageBreakInside === 'avoid'
    })
    // Keep only the outermost avoid blocks — a table inside an avoided question
    // is already covered by the question; nested intervals just confuse the cut.
    const atomic = avoidEls
      .filter((el) => !avoidEls.some((other) => other !== el && other.contains(el)))
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { top: toY(r.top), bottom: toY(r.bottom) }
      })
      .filter((b) => b.bottom > b.top)

    const forced = []
    for (const el of all) {
      const cs = win.getComputedStyle(el)
      const r = el.getBoundingClientRect()
      if (cs.breakAfter === 'page' || cs.pageBreakAfter === 'always') forced.push(toY(r.bottom))
      if (cs.breakBefore === 'page' || cs.pageBreakBefore === 'always') forced.push(toY(r.top))
    }
    return { atomic, forced: forced.filter((y) => y > 0) }
  } catch {
    return empty
  }
}

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
 * Decide where to end the current page when slicing a tall canvas, in canvas
 * pixels. Pure (no DOM) so it can be unit-tested directly.
 *
 *   - The final page always runs to the bottom of the canvas.
 *   - An explicit page break inside the page wins outright.
 *   - Otherwise the page bottom is pulled up above any block that would
 *     straddle `limit`, so that block flows onto the next page intact.
 *   - A block taller than a page (top at/above the page top) can't be saved,
 *     so the hard cut at `limit` stands — callers must still guard against a
 *     zero-progress result for fully-degenerate input.
 *
 * @returns {number} the canvas-pixel Y at which to end the page.
 */
export function chooseSliceBottom({ sliceTop, limit, canvasHeight, atomic = [], forced = [] }) {
  if (limit >= canvasHeight) return canvasHeight
  const forcedCut = forced
    .filter((y) => y > sliceTop && y <= limit)
    .sort((a, b) => a - b)[0]
  if (forcedCut != null) return forcedCut
  let cut = limit
  for (const blk of atomic) {
    if (blk.top > sliceTop && blk.top < limit && blk.bottom > limit && blk.top < cut) {
      cut = blk.top
    }
  }
  return cut
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

    // Snapshot where blocks begin/end BEFORE rasterising — once html2canvas
    // flattens the DOM to a bitmap this information is gone.
    const breaks = collectBreakGeometry(idoc, scale)

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

    // A slice placed on a page is `pageW` pt wide, so its height in pt is
    // sliceHeightPx * pageW / canvas.width. Capping each slice at this many
    // canvas pixels keeps it inside one A4 page.
    const pageHeightPx = Math.max(1, Math.floor((pageH * canvas.width) / pageW))
    const { atomic, forced } = breaks

    // Crop [sliceTop, sliceBottom) out of the tall canvas and drop it at the
    // top of the current page. Each page gets its own JPEG so a short final
    // page is just blank below the content (no negative-offset overlap tricks).
    const placeSlice = (sliceTop, sliceBottom) => {
      const sliceH = sliceBottom - sliceTop
      if (sliceH <= 0) return
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = sliceH
      const ctx = slice.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, slice.width, slice.height)
      ctx.drawImage(canvas, 0, sliceTop, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
      const placedH = (sliceH * pageW) / canvas.width
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, placedH, undefined, 'FAST')
    }

    let sliceTop = 0
    let firstPage = true
    let guard = 0
    while (sliceTop < canvas.height - 1 && guard < 1000) {
      guard += 1
      const limit = sliceTop + pageHeightPx
      let sliceBottom = chooseSliceBottom({
        sliceTop,
        limit,
        canvasHeight: canvas.height,
        atomic,
        forced,
      })
      // Never stall: if the smart logic produced no progress, take the hard cut.
      if (sliceBottom <= sliceTop) sliceBottom = Math.min(limit, canvas.height)

      if (!firstPage) pdf.addPage()
      placeSlice(sliceTop, sliceBottom)
      firstPage = false
      sliceTop = sliceBottom
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
