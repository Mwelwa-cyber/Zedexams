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
 * Two chrome variants:
 *   - Default (admin studio preview, timed practice, timetable): the
 *     original compact toolbar with inline prev/next arrows.
 *   - `dock` (the past-paper viewer redesign): prev/next move into the
 *     floating {@link ./GlassPageNavigation} glass dock near the bottom
 *     of the viewport (52px thumb targets, page indicator with jump
 *     input, lazy {@link ./PageThumbnailSheet} thumbnails), and the
 *     secondary zoom / fit / rotate / print controls collapse into a
 *     small overflow menu so no small controls sit over exam content.
 *     Mobile default stays fit-width; the chosen zoom level survives
 *     page changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPdfjs } from '../../utils/pdfjsLoader'
import { friendlyMessage } from '../../utils/friendlyErrors'
import GlassPageNavigation from './GlassPageNavigation'
import PageThumbnailSheet from './PageThumbnailSheet'
import {
  Download,
  Maximize2,
  MoreHorizontal,
  Printer,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from './icons'

const ZOOM_LEVELS = [0.6, 0.75, 0.9, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]
const DEFAULT_ZOOM_INDEX = 3 // 1.0 = fit the container width

async function fetchPdfBuffer(url, { retries = 1 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { mode: 'cors' })
      if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`)
      return await res.arrayBuffer()
    } catch (err) {
      lastErr = err
      // A cross-origin / transient network hiccup throws a bare
      // "Failed to fetch". Retry once before surfacing the error — a
      // freshly uploaded file occasionally isn't reachable on the very
      // first request.
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400))
    }
  }
  throw lastErr || new Error('PDF fetch failed')
}

export default function PdfJsViewer({ url, blob, title, fill = false, storageKey = null, dock = false }) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const renderTaskRef = useRef(null)
  const thumbCacheRef = useRef(new Map())
  const [pdf, setPdf] = useState(null)
  const [pageIndex, setPageIndex] = useState(0) // 0-based
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  const [rotation, setRotation] = useState(0) // 0 / 90 / 180 / 270
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)       // whole-document failure
  const [pageError, setPageError] = useState(false) // single page failed to render
  const [loadNonce, setLoadNonce] = useState(0)  // bump to retry the document
  const [renderNonce, setRenderNonce] = useState(0) // bump to retry the page
  const [thumbsOpen, setThumbsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  // Load + parse the PDF whenever the source (URL or in-memory blob)
  // changes. A `blob` is preferred when present — e.g. a file the admin
  // just uploaded — so the preview renders from local bytes and skips
  // the cross-origin Storage fetch entirely.
  useEffect(() => {
    if (!url && !blob) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPageError(false)
    setPdf(null)
    setPageIndex(0)
    thumbCacheRef.current = new Map()
    ;(async () => {
      try {
        const [pdfjs, buffer] = await Promise.all([
          loadPdfjs(),
          blob ? blob.arrayBuffer() : fetchPdfBuffer(url),
        ])
        if (cancelled) return
        const { getDocument } = pdfjs
        const doc = await getDocument({ data: buffer }).promise
        if (cancelled) {
          doc.destroy?.()
          return
        }
        setPdf(doc)
        // Resume where the reader left off — a stored 1-based page number,
        // clamped to the document so a shorter re-upload can't land off-end.
        if (storageKey) {
          try {
            const stored = window.localStorage?.getItem(storageKey)
            const parsed = stored ? parseInt(stored, 10) : NaN
            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= doc.numPages) {
              setPageIndex(parsed - 1)
            }
          } catch { /* private mode / quota — start at page 1 */ }
        }
      } catch (err) {
        console.warn('[PdfJsViewer] load failed', err)
        if (!cancelled) setError(friendlyMessage(err, 'We could not open this paper.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url, blob, storageKey, loadNonce])

  // Render the current page when pdf / pageIndex / zoom change.
  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    ;(async () => {
      try {
        // Only one render task may be active per canvas: cancel the
        // in-flight one before starting a new render — fast page-flips
        // would otherwise overlap and tear the canvas.
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
        const finalScale = Math.max(0.4, Math.min(6, fitScale * userScale))
        const viewport = page.getViewport({ scale: finalScale * dpr, rotation })

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
        if (!cancelled) setPageError(false)
        // Warm the page parse cache for the neighbours so a normal
        // read-forward (or flip back) doesn't pay the getPage cost on
        // tap. PDF.js caches page proxies internally; no rastering here.
        if (pageIndex + 2 <= pdf.numPages) pdf.getPage(pageIndex + 2).catch(() => {})
        if (pageIndex >= 1) pdf.getPage(pageIndex).catch(() => {})
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('[PdfJsViewer] render failed', err)
          if (!cancelled) setPageError(true)
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
  }, [pdf, pageIndex, zoomIndex, rotation, renderNonce])

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

  // Persist the current page (1-based) so reopening this paper resumes here.
  useEffect(() => {
    if (!pdf || !storageKey) return
    try {
      window.localStorage?.setItem(storageKey, String(pageIndex + 1))
    } catch { /* quota / private mode — resume is best-effort */ }
  }, [pdf, pageIndex, storageKey])

  const goPrev = useCallback(() => setPageIndex((i) => Math.max(0, i - 1)), [])
  const goNext = useCallback(() => {
    if (!pdf) return
    setPageIndex((i) => Math.min(pdf.numPages - 1, i + 1))
  }, [pdf])
  const jumpToPage = useCallback((pageNumber) => {
    if (!pdf) return
    setPageIndex(Math.min(pdf.numPages - 1, Math.max(0, pageNumber - 1)))
    // Bring the paper back into view — the dock sits at the viewport
    // bottom, so after a thumbnail jump the page itself may be off-screen.
    containerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [pdf])

  const handleKey = useCallback((e) => {
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goPrev() }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goNext() }
  }, [goPrev, goNext])

  // Dock mode: desktop arrow keys page the document without needing the
  // canvas focused first — but never while the reader is typing.
  useEffect(() => {
    if (!dock) return undefined
    const onKey = (e) => {
      if (e.defaultPrevented) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goPrev() }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dock, goPrev, goNext])

  // Close the overflow menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const rotate = useCallback(() => setRotation((r) => (r + 90) % 360), [])
  const fitWidth = useCallback(() => setZoomIndex(DEFAULT_ZOOM_INDEX), [])
  const handlePrint = useCallback(() => {
    // Native browser viewers print multi-page PDFs reliably; open the
    // source in a new tab where the reader can Ctrl/⌘-P the full paper.
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }, [url])

  // Small, cached thumbnail per page for the bottom sheet. Rendered
  // lazily (the sheet only asks when a cell scrolls into view) at ~96
  // CSS px wide — never the full-resolution page.
  const getThumbnail = useCallback(async (pageNumber) => {
    const cache = thumbCacheRef.current
    if (cache.has(pageNumber)) return cache.get(pageNumber)
    if (!pdf) return null
    const page = await pdf.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const scale = (96 / baseViewport.width) * 1.5
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    await page.render({ canvasContext: ctx, viewport }).promise
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72)
    cache.set(pageNumber, dataUrl)
    // Free the scratch canvas eagerly for low-memory devices.
    canvas.width = 0
    canvas.height = 0
    return dataUrl
  }, [pdf])

  const retryDocument = useCallback(() => setLoadNonce((n) => n + 1), [])
  const retryPage = useCallback(() => {
    setPageError(false)
    setRenderNonce((n) => n + 1)
  }, [])

  const pageCount = pdf?.numPages ?? 0
  const pageLabel = pdf ? `Page ${pageIndex + 1} of ${pdf.numPages}` : 'Loading…'

  const smallButtonClass =
    'rounded-full theme-card border-2 theme-border theme-text-muted hover:theme-text px-2.5 py-1 text-xs font-bold disabled:opacity-40'

  return (
    <div
      className={`theme-card border theme-border overflow-hidden flex flex-col ${
        fill ? 'h-full rounded-none' : 'rounded-radius-md'
      }`}
      role="region"
      aria-label={title ? `${title} viewer` : 'PDF viewer'}
    >
      {/* Toolbar — dock mode keeps it minimal (page label + overflow menu);
          classic mode keeps the original inline arrows for the admin
          studio / practice surfaces. */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b theme-border theme-bg-subtle">
        <div className="flex items-center gap-2 min-w-0">
          {!dock && (
            <button
              type="button"
              onClick={goPrev}
              disabled={!pdf || pageIndex === 0}
              aria-label="Previous page"
              className={smallButtonClass}
            >
              ←
            </button>
          )}
          <span className="text-xs font-bold theme-text tabular-nums whitespace-nowrap" aria-live={dock ? undefined : 'polite'}>
            {pageLabel}
          </span>
          {!dock && (
            <button
              type="button"
              onClick={goNext}
              disabled={!pdf || pageIndex >= (pdf?.numPages ?? 1) - 1}
              aria-label="Next page"
              className={smallButtonClass}
            >
              →
            </button>
          )}
        </div>

        {dock ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="More viewer options"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              disabled={!pdf}
              className="inline-flex items-center justify-center w-11 h-11 rounded-full theme-text-muted hover:theme-text hover:theme-card active:scale-95 transition disabled:opacity-40"
            >
              <MoreHorizontal size={22} strokeWidth={2.4} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                aria-label="Viewer options"
                className="absolute right-0 top-12 z-30 w-56 theme-card border theme-border rounded-2xl shadow-elev-lg p-2 space-y-1"
              >
                <div className="flex items-center justify-between gap-1 px-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}
                    disabled={zoomIndex === 0}
                    aria-label="Zoom out"
                    className="inline-flex items-center justify-center w-11 h-11 rounded-xl theme-bg-subtle theme-text hover:theme-card disabled:opacity-40"
                  >
                    <ZoomOut size={18} strokeWidth={2.2} />
                  </button>
                  <span className="text-sm font-black theme-text tabular-nums">
                    {Math.round(ZOOM_LEVELS[zoomIndex] * 100)}%
                  </span>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setZoomIndex((z) => Math.min(ZOOM_LEVELS.length - 1, z + 1))}
                    disabled={zoomIndex === ZOOM_LEVELS.length - 1}
                    aria-label="Zoom in"
                    className="inline-flex items-center justify-center w-11 h-11 rounded-xl theme-bg-subtle theme-text hover:theme-card disabled:opacity-40"
                  >
                    <ZoomIn size={18} strokeWidth={2.2} />
                  </button>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { fitWidth(); setMenuOpen(false) }}
                  className="w-full inline-flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold theme-text hover:theme-bg-subtle min-h-[44px]"
                >
                  <Maximize2 size={17} strokeWidth={2.2} /> Fit width
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={rotate}
                  className="w-full inline-flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold theme-text hover:theme-bg-subtle min-h-[44px]"
                >
                  <RotateCw size={17} strokeWidth={2.2} /> Rotate
                </button>
                {url && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { handlePrint(); setMenuOpen(false) }}
                    className="w-full inline-flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold theme-text hover:theme-bg-subtle min-h-[44px]"
                  >
                    <Printer size={17} strokeWidth={2.2} /> Print
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}
              disabled={zoomIndex === 0}
              aria-label="Zoom out"
              className={smallButtonClass}
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
              className={smallButtonClass}
            >
              +
            </button>
            <button
              type="button"
              onClick={rotate}
              disabled={!pdf}
              aria-label="Rotate page"
              title="Rotate"
              className={smallButtonClass}
            >
              ⟳
            </button>
            {url && (
              <button
                type="button"
                onClick={handlePrint}
                aria-label="Print paper"
                title="Print"
                className={smallButtonClass}
              >
                🖨
              </button>
            )}
          </div>
        )}
      </div>

      {/* Canvas surface */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKey}
        className={`w-full theme-bg flex p-3 ${
          fill
            ? 'flex-1 min-h-0 overflow-auto'
            : dock
              // Embedded past-paper mode: only horizontal (zoomed-wide) panning
              // stays inside; vertical scroll belongs to the document/body.
              ? 'overflow-x-auto'
              : 'overflow-auto'
        }`}
        style={{
          // `pan-y` is ESSENTIAL: `touch-action: pinch-zoom` on its own blocks
          // single-finger vertical scrolling, so a swipe that starts on the
          // canvas freezes the page on touch. Keeping `pinch-zoom` preserves
          // pinch-to-zoom. (Same rationale as the sibling PdfScrollViewer.)
          touchAction: 'pan-y pinch-zoom',
          overscrollBehaviorY: fill ? 'contain' : 'auto',
          // Embedded (`dock`, not fullscreen) renders in normal document flow
          // so the browser/body owns vertical scrolling — no nested vertical
          // scrollbar competing with the page. Fullscreen + classic previews
          // keep their own bounded, self-scrolling box.
          ...(dock && !fill ? { overflowY: 'visible' } : {}),
          ...(fill || dock ? {} : { minHeight: '60vh', maxHeight: '85vh' }),
          // Keep the fixed glass dock from covering the bottom of the page:
          // reserve space so the content can clear it.
          ...(dock ? { paddingBottom: 'calc(112px + env(safe-area-inset-bottom))' } : {}),
        }}
      >
        {loading && (
          // Paper-shaped skeleton instead of a blank strip while PDF.js
          // fetches + parses the document.
          <div className="m-auto w-full max-w-md py-4" aria-hidden="true">
            <div className="mx-auto w-full aspect-[1/1.3] max-h-[62vh] rounded-radius-md bg-white shadow-elev-sm p-5 space-y-3 animate-pulse">
              <div className="h-4 w-2/3 mx-auto rounded bg-black/10" />
              <div className="h-3 w-1/2 mx-auto rounded bg-black/10" />
              <div className="pt-4 space-y-2.5">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="h-2.5 rounded bg-black/5" style={{ width: `${90 - (i % 3) * 12}%` }} />
                ))}
              </div>
            </div>
            <p className="text-center text-sm font-bold theme-text-muted mt-3">Preparing your paper…</p>
          </div>
        )}
        {!loading && error && (
          <div role="alert" className="py-12 text-center space-y-3 m-auto px-4">
            <p className="theme-text font-black text-base">We could not open this paper.</p>
            <p className="text-rose-700 font-bold text-sm">{error}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={retryDocument}
                className="inline-block theme-accent-fill theme-on-accent rounded-full px-4 py-2.5 text-xs font-black hover:opacity-90 min-h-[44px]"
              >
                Retry
              </button>
              {url && (
                // Inline rendering can be blocked (cross-origin fetch, iOS
                // Safari, App Check) even when the file itself is fine.
                // A plain link isn't subject to those limits, so the reader
                // can still open the paper in the browser's native viewer.
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 theme-card border theme-border rounded-full px-4 py-2.5 text-xs font-black hover:theme-bg-subtle min-h-[44px]"
                >
                  <Download size={14} strokeWidth={2.4} /> Open the original file
                </a>
              )}
            </div>
          </div>
        )}
        {!loading && !error && pageError && (
          <div role="alert" className="py-12 text-center space-y-3 m-auto px-4">
            <p className="theme-text font-black text-base">This page could not be displayed.</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={retryPage}
                className="inline-block theme-accent-fill theme-on-accent rounded-full px-4 py-2.5 text-xs font-black hover:opacity-90 min-h-[44px]"
              >
                Retry page
              </button>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 theme-card border theme-border rounded-full px-4 py-2.5 text-xs font-black hover:theme-bg-subtle min-h-[44px]"
                >
                  <Download size={14} strokeWidth={2.4} /> Download paper
                </a>
              )}
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          aria-label={title || 'PDF page'}
          className={loading || error || pageError ? 'hidden' : 'block m-auto shadow-elev-sm'}
        />
      </div>

      {/* Glass dock + thumbnail sheet (redesigned past-paper viewer only) */}
      {dock && !error && (
        <GlassPageNavigation
          pageNumber={pageIndex + 1}
          pageCount={pageCount}
          onPrev={goPrev}
          onNext={goNext}
          onOpenThumbnails={pdf ? () => setThumbsOpen(true) : undefined}
          onJumpToPage={jumpToPage}
          zIndexClass={fill ? 'z-[70]' : 'z-40'}
        />
      )}
      {dock && pdf && (
        <PageThumbnailSheet
          open={thumbsOpen}
          onClose={() => setThumbsOpen(false)}
          pageCount={pageCount}
          currentPage={pageIndex + 1}
          getThumbnail={getThumbnail}
          onSelect={jumpToPage}
        />
      )}
    </div>
  )
}
