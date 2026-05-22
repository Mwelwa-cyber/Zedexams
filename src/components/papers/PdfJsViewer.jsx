/**
 * PDF.js viewer for the past-paper archive (audit A2 PR 2).
 *
 * Replaces the iframe-based viewer with proper page-by-page rendering
 * on canvas. Three reasons this matters:
 *   1. iOS Safari often refuses inline PDFs and falls back to "tap to
 *      download" — for a mobile-first Zambian audience, that's the
 *      majority of users.
 *   2. The iframe's chrome differs across browsers (Edge has its own
 *      PDF UI, Firefox renders via PDF.js anyway, Chrome is a third
 *      look). One unified UI keeps the surface predictable.
 *   3. Page navigation lets us add a "Jump to page 7" deep link for
 *      lesson plans / blog posts that want to point at one question.
 *
 * Implementation:
 *   - PDF.js (`pdfjs-dist`) is already bundled (used by the document
 *     quiz importer). We lazy-load it on mount so a learner browsing
 *     /papers without opening a paper doesn't pay the parse cost.
 *   - Fetch the PDF as ArrayBuffer client-side. Storage's tokenised
 *     download URL has CORS allowed by Firebase, but `getDocument`
 *     handles ArrayBuffer more reliably across iOS Safari, the
 *     Capacitor WebView, and old-Chrome Android builds we still see.
 *   - Render one page at a time at devicePixelRatio-aware scale.
 *     Past papers can be 20+ pages — rendering all at once kills
 *     memory on Tecno / Itel devices.
 *
 * Public surface mirrors the iframe: pass `url` and a `title`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const ZOOM_LEVELS = [0.6, 0.75, 0.9, 1.0, 1.25, 1.5, 1.75, 2.0]
const DEFAULT_ZOOM_INDEX = 3 // 1.0

let pdfjsLoader = null
async function loadPdfJs() {
  if (!pdfjsLoader) {
    pdfjsLoader = (async () => {
      const [{ GlobalWorkerOptions, getDocument }, workerUrl] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.mjs?url').then((m) => m.default),
      ])
      GlobalWorkerOptions.workerSrc = workerUrl
      return { getDocument }
    })()
  }
  return pdfjsLoader
}

async function fetchPdfBuffer(url) {
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`)
  return res.arrayBuffer()
}

export default function PdfJsViewer({ url, title }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const renderTaskRef = useRef(null)
  const [pdf, setPdf] = useState(null)
  const [pageIndex, setPageIndex] = useState(0) // 0-based
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Load + parse the PDF once per URL change.
  useEffect(() => {
    if (!url) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPdf(null)
    setPageIndex(0)
    ;(async () => {
      try {
        const [{ getDocument }, buffer] = await Promise.all([
          loadPdfJs(),
          fetchPdfBuffer(url),
        ])
        if (cancelled) return
        const doc = await getDocument({ data: buffer }).promise
        if (cancelled) {
          doc.destroy?.()
          return
        }
        setPdf(doc)
      } catch (err) {
        console.warn('[PdfJsViewer] load failed', err)
        if (!cancelled) setError(err?.message || 'Could not open this paper.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url])

  // Render the current page when pdf / pageIndex / zoom change.
  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    ;(async () => {
      try {
        // Cancel an in-flight render before starting a new one — fast
        // page-flips would otherwise overlap and tear the canvas.
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel?.()
          renderTaskRef.current = null
        }
        const page = await pdf.getPage(pageIndex + 1) // PDF.js is 1-based
        if (cancelled) return

        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container) return

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        // Fit to container width, capped by chosen zoom.
        const baseViewport = page.getViewport({ scale: 1 })
        const containerWidth = Math.max(220, container.clientWidth - 4)
        const fitScale = containerWidth / baseViewport.width
        const userScale = ZOOM_LEVELS[zoomIndex]
        const finalScale = Math.max(0.4, Math.min(4, fitScale * userScale))
        const viewport = page.getViewport({ scale: finalScale * dpr })

        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${viewport.width / dpr}px`
        canvas.style.height = `${viewport.height / dpr}px`

        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const renderTask = page.render({ canvasContext: ctx, viewport })
        // Overlapping renders are cancelled at the top of this effect, so
        // assigning the latest task is the intended behaviour.
        // eslint-disable-next-line require-atomic-updates
        renderTaskRef.current = renderTask
        await renderTask.promise
        if (renderTaskRef.current === renderTask) renderTaskRef.current = null
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('[PdfJsViewer] render failed', err)
          if (!cancelled) setError('Could not render this page.')
        }
      }
    })()
    return () => {
      cancelled = true
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel?.()
        renderTaskRef.current = null
      }
    }
  }, [pdf, pageIndex, zoomIndex])

  // Re-render on container resize — page width follows the column.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      // Bumping zoomIndex through a no-op forces the render effect to
      // recompute fitScale against the new container width.
      setZoomIndex((z) => z)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Tear down PDF.js doc on unmount.
  useEffect(() => () => {
    if (pdf) {
      try { pdf.destroy?.() } catch { /* ignore */ }
    }
  }, [pdf])

  const goPrev = useCallback(() => setPageIndex((i) => Math.max(0, i - 1)), [])
  const goNext = useCallback(() => {
    if (!pdf) return
    setPageIndex((i) => Math.min(pdf.numPages - 1, i + 1))
  }, [pdf])

  const handleKey = useCallback((e) => {
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goPrev() }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goNext() }
  }, [goPrev, goNext])

  return (
    <div
      className="theme-card border theme-border rounded-radius-md overflow-hidden flex flex-col"
      role="region"
      aria-label={title ? `${title} viewer` : 'PDF viewer'}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b theme-border theme-bg-subtle">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={!pdf || pageIndex === 0}
            aria-label="Previous page"
            className="rounded-full theme-card border-2 theme-border theme-text-muted hover:theme-text px-2.5 py-1 text-xs font-bold disabled:opacity-40"
          >
            ←
          </button>
          <span className="text-xs font-bold theme-text tabular-nums whitespace-nowrap">
            {pdf ? `Page ${pageIndex + 1} of ${pdf.numPages}` : 'Loading…'}
          </span>
          <button
            type="button"
            onClick={goNext}
            disabled={!pdf || pageIndex >= (pdf?.numPages ?? 1) - 1}
            aria-label="Next page"
            className="rounded-full theme-card border-2 theme-border theme-text-muted hover:theme-text px-2.5 py-1 text-xs font-bold disabled:opacity-40"
          >
            →
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}
            disabled={zoomIndex === 0}
            aria-label="Zoom out"
            className="rounded-full theme-card border-2 theme-border theme-text-muted hover:theme-text px-2.5 py-1 text-xs font-bold disabled:opacity-40"
          >
            −
          </button>
          <span className="text-xs font-bold theme-text-muted tabular-nums w-10 text-center">
            {Math.round(ZOOM_LEVELS[zoomIndex] * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoomIndex((z) => Math.min(ZOOM_LEVELS.length - 1, z + 1))}
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            aria-label="Zoom in"
            className="rounded-full theme-card border-2 theme-border theme-text-muted hover:theme-text px-2.5 py-1 text-xs font-bold disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      {/* Canvas surface */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKey}
        className="w-full overflow-auto theme-bg flex items-start justify-center p-3"
        style={{ minHeight: '60vh', maxHeight: '85vh', touchAction: 'pinch-zoom' }}
      >
        {loading && (
          <p className="theme-text-muted text-sm py-12">Loading paper…</p>
        )}
        {!loading && error && (
          <p role="alert" className="text-rose-700 font-bold text-sm py-12 text-center">
            {error}
          </p>
        )}
        <canvas
          ref={canvasRef}
          aria-label={title || 'PDF page'}
          className={loading || error ? 'hidden' : 'block max-w-full shadow-elev-sm'}
        />
      </div>
    </div>
  )
}
