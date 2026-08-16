/**
 * PdfPageStream — continuous, scroll-down reading for PDF papers.
 *
 * The learner-facing paper surfaces used to open PDFs through the
 * page-by-page {@link ./PdfJsViewer}: one canvas, prev/next in the glass
 * dock. Scanned (image) papers, by contrast, have always rendered as a
 * vertical stack you simply scroll. Two file formats of the same archive
 * therefore behaved differently — a learner who opened an ECZ scan and
 * then a PRISCA PDF had to learn a second set of gestures, and paging
 * left/right is the wrong idiom on a phone anyway.
 *
 * This component gives PDFs the image papers' behaviour: every page
 * stacked vertically, fit to the column, scroll to move.
 *
 * Why not simply reuse {@link ./PdfScrollViewer} (which already stacks
 * pages): that one rasterises EVERY page up front. It is sized for the
 * 3-page exam timetable. Past papers run 11–20+ pages, and a full-width
 * canvas is roughly 3–4 MB of bitmap on a phone at dpr 2, so rendering
 * them all would cost 50–80 MB — the low-end Tecno / Itel devices much
 * of our audience uses would drop the tab.
 *
 * So the stack here is VIRTUALISED:
 *   - Page boxes are laid out immediately from each page's measured
 *     aspect ratio (a cheap `getViewport` — no rasterising), so the
 *     scrollbar is honest and "jump to page 9" lands in the right place
 *     before a single pixel is drawn.
 *   - Only the active page and its immediate neighbours hold a canvas
 *     (RENDER_RADIUS); anything further than KEEP_RADIUS away has its
 *     canvas freed (`width = 0`), which is what actually returns the
 *     bitmap memory. Peak live canvases: five, normally three.
 *   - Un-rendered pages show a paper-shaped skeleton, so a fast fling
 *     never leaves a blank void.
 *
 * Scroll ownership: the stack always flows in the document (or in the
 * fullscreen reader's scroll surface). There is no nested vertical
 * scroller — one scrollbar, like the image papers. Zoomed pages pan
 * horizontally inside their own per-page strip, which keeps that
 * horizontal overflow from forcing a second vertical scrollbar.
 *
 * Mirrors PdfJsViewer's loader/fetch approach (lazy pdfjs-dist through
 * the shared loadPdfjs() — which runs the worker on the main thread so
 * old Android WebViews don't fail at "Setting up fake worker failed" —
 * and an ArrayBuffer fetch for iOS Safari / Capacitor reliability) plus
 * its native-link error fallback.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
const DEFAULT_ZOOM_INDEX = 3 // 1.0 = fit the column width

/** Pages either side of the active page that hold a live canvas. */
const RENDER_RADIUS = 1
/** Pages either side of the active page kept before the canvas is freed. */
const KEEP_RADIUS = 2

/** A4 portrait — the placeholder ratio used until a page is measured. */
const FALLBACK_ASPECT = 1 / 1.414

async function fetchPdfBuffer(url, { retries = 1 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { mode: 'cors' })
      if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`)
      return await res.arrayBuffer()
    } catch (err) {
      lastErr = err
      // A cross-origin / transient network hiccup throws a bare "Failed to
      // fetch"; a freshly uploaded file occasionally isn't reachable on the
      // very first request. Retry once before surfacing the error.
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400))
    }
  }
  throw lastErr || new Error('PDF fetch failed')
}

export default function PdfPageStream({
  url,
  blob,
  title,
  /** localStorage key holding the 1-based page to resume on. */
  storageKey = null,
  /** Mirror the visible page into the `#page=N` hash (shareable deep links). */
  syncHash = false,
  /** Rendered inside the fullscreen reader — lifts the dock above its chrome. */
  overlay = false,
  /** Set false on surfaces that own their own navigation (e.g. timed practice). */
  showDock = true,
}) {
  const rootRef = useRef(null)
  const menuRef = useRef(null)
  const pageElRefs = useRef(new Map())
  const canvasRefs = useRef(new Map())
  const renderTasksRef = useRef(new Map())
  const renderedKeyRef = useRef(new Map()) // pageNumber -> scaleKey it was drawn at
  const thumbCacheRef = useRef(new Map())
  const restoredRef = useRef(false)

  const [pdf, setPdf] = useState(null)
  const [baseSize, setBaseSize] = useState(null)   // page 1, unrotated
  const [pageSizes, setPageSizes] = useState([])   // per page, index 0 = page 1
  const [columnWidth, setColumnWidth] = useState(0)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX)
  const [rotation, setRotation] = useState(0)
  const [activePage, setActivePage] = useState(1)
  const [renderedPages, setRenderedPages] = useState(() => new Set())
  const [failedPages, setFailedPages] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadNonce, setLoadNonce] = useState(0)
  const [renderNonce, setRenderNonce] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [thumbsOpen, setThumbsOpen] = useState(false)

  const pageCount = pdf?.numPages ?? 0
  const contentWidth = columnWidth ? Math.max(220, columnWidth) * ZOOM_LEVELS[zoomIndex] : 0
  const contentWidthRef = useRef(0)
  contentWidthRef.current = contentWidth

  // ---------------------------------------------------------------- load

  useEffect(() => {
    if (!url && !blob) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)
    setPdf(null)
    setBaseSize(null)
    setPageSizes([])
    setActivePage(1)
    setRenderedPages(new Set())
    setFailedPages(new Set())
    renderedKeyRef.current = new Map()
    thumbCacheRef.current = new Map()
    restoredRef.current = false
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
        // Measure page 1 straight away: every placeholder box borrows its
        // aspect ratio until the background pass measures the real one, so
        // the stack has a sensible height on the very first paint.
        try {
          const first = await doc.getPage(1)
          const vp = first.getViewport({ scale: 1 })
          if (!cancelled) setBaseSize({ w: vp.width, h: vp.height })
        } catch { /* fall back to A4 */ }
        if (cancelled) {
          doc.destroy?.()
          return
        }
        setPdf(doc)
      } catch (err) {
        console.warn('[PdfPageStream] load failed', err)
        if (!cancelled) setError(friendlyMessage(err, 'We could not open this paper.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url, blob, loadNonce])

  // Measure the remaining pages in the background so mixed-orientation
  // papers (a landscape map sheet inside a portrait paper) get honest box
  // heights. Yields between pages — this must never block the first paint.
  useEffect(() => {
    if (!pdf) return undefined
    let cancelled = false
    ;(async () => {
      const sizes = []
      for (let n = 1; n <= pdf.numPages; n += 1) {
        if (cancelled) return
        try {
          const page = await pdf.getPage(n)
          const vp = page.getViewport({ scale: 1 })
          sizes[n - 1] = { w: vp.width, h: vp.height }
        } catch {
          sizes[n - 1] = null
        }
        if (n % 4 === 0) await new Promise((r) => setTimeout(r, 0))
      }
      if (!cancelled) setPageSizes(sizes)
    })()
    return () => {
      cancelled = true
    }
  }, [pdf])

  // Tear down PDF.js doc + any live canvases on unmount / document swap.
  useEffect(() => () => {
    renderTasksRef.current.forEach((task) => task.cancel?.())
    renderTasksRef.current.clear()
    if (pdf) {
      try { pdf.destroy?.() } catch { /* ignore */ }
    }
  }, [pdf])

  // --------------------------------------------------------------- width

  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const measure = () => setColumnWidth(el.clientWidth || 0)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    let timer = null
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      // Debounced: a drag-resize must not re-rasterise on every frame.
      timer = setTimeout(measure, 150)
    })
    ro.observe(el)
    return () => {
      if (timer) clearTimeout(timer)
      ro.disconnect()
    }
  }, [pdf])

  // -------------------------------------------------------------- render

  const releasePage = useCallback((pageNumber) => {
    const task = renderTasksRef.current.get(pageNumber)
    if (task) {
      task.cancel?.()
      renderTasksRef.current.delete(pageNumber)
    }
    const canvas = canvasRefs.current.get(pageNumber)
    if (canvas) {
      // Setting the dimensions to 0 is what actually frees the bitmap;
      // clearRect alone keeps the backing store allocated.
      canvas.width = 0
      canvas.height = 0
    }
    renderedKeyRef.current.delete(pageNumber)
    setRenderedPages((prev) => {
      if (!prev.has(pageNumber)) return prev
      const next = new Set(prev)
      next.delete(pageNumber)
      return next
    })
  }, [])

  const renderPage = useCallback(async (doc, pageNumber, scaleKey, width, dpr) => {
    const canvas = canvasRefs.current.get(pageNumber)
    if (!canvas) return
    const existing = renderTasksRef.current.get(pageNumber)
    if (existing) {
      existing.cancel?.()
      renderTasksRef.current.delete(pageNumber)
    }
    try {
      const page = await doc.getPage(pageNumber)
      const unit = page.getViewport({ scale: 1, rotation })
      const scale = width / unit.width
      const viewport = page.getViewport({ scale: scale * dpr, rotation })
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = '100%'
      canvas.style.height = 'auto'
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const task = page.render({ canvasContext: ctx, viewport })
      renderTasksRef.current.set(pageNumber, task)
      await task.promise
      if (renderTasksRef.current.get(pageNumber) === task) {
        renderTasksRef.current.delete(pageNumber)
      }
      renderedKeyRef.current.set(pageNumber, scaleKey)
      setRenderedPages((prev) => {
        if (prev.has(pageNumber)) return prev
        const next = new Set(prev)
        next.add(pageNumber)
        return next
      })
      setFailedPages((prev) => {
        if (!prev.has(pageNumber)) return prev
        const next = new Set(prev)
        next.delete(pageNumber)
        return next
      })
    } catch (err) {
      if (err?.name === 'RenderingCancelledException') return
      console.warn('[PdfPageStream] render failed', err)
      setFailedPages((prev) => {
        if (prev.has(pageNumber)) return prev
        const next = new Set(prev)
        next.add(pageNumber)
        return next
      })
    }
  }, [rotation])

  // Reconcile the render window whenever the active page, the column
  // width, the zoom or the rotation changes. Frees first, then draws, so
  // peak memory during a re-zoom stays bounded.
  useEffect(() => {
    if (!pdf || !contentWidth) return undefined
    let cancelled = false
    const scaleKey = `${Math.round(contentWidth)}:${rotation}`
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    Array.from(renderedKeyRef.current.keys()).forEach((pageNumber) => {
      if (Math.abs(pageNumber - activePage) > KEEP_RADIUS) releasePage(pageNumber)
    })

    // Active page first, then outwards — forwards before backwards, since
    // that is the direction a reader is usually heading.
    const wanted = []
    for (let d = 0; d <= RENDER_RADIUS; d += 1) {
      if (d === 0) wanted.push(activePage)
      else wanted.push(activePage + d, activePage - d)
    }
    const queue = wanted.filter((n) => n >= 1 && n <= pdf.numPages)

    ;(async () => {
      for (const pageNumber of queue) {
        if (cancelled) return
        if (renderedKeyRef.current.get(pageNumber) === scaleKey) continue
        await renderPage(pdf, pageNumber, scaleKey, contentWidth, dpr)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pdf, activePage, contentWidth, rotation, renderNonce, renderPage, releasePage])

  // ------------------------------------------------------ active page

  useEffect(() => {
    if (!pageCount) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        // When two pages straddle the band, the one showing more wins.
        const inView = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (!inView.length) return
        const pageNumber = Number(inView[0].target.dataset.pageNumber)
        if (!pageNumber) return
        setActivePage(pageNumber)
        if (syncHash && typeof window !== 'undefined') {
          const nextHash = `#page=${pageNumber}`
          if (window.location.hash !== nextHash) {
            window.history.replaceState(
              null,
              '',
              `${window.location.pathname}${window.location.search}${nextHash}`,
            )
          }
        }
        if (storageKey && typeof window !== 'undefined') {
          try {
            window.localStorage?.setItem(storageKey, String(pageNumber))
          } catch { /* quota / private mode — resume is best-effort */ }
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-20% 0px -60% 0px' },
    )
    pageElRefs.current.forEach((el) => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [pageCount, syncHash, storageKey])

  const scrollToPage = useCallback((pageNumber, behavior = 'smooth') => {
    if (!pageCount) return
    const target = Math.min(pageCount, Math.max(1, pageNumber))
    setActivePage(target)
    const el = pageElRefs.current.get(target)
    if (el?.scrollIntoView) el.scrollIntoView({ behavior, block: 'start' })
  }, [pageCount])

  // Resume where the reader left off — a shared `#page=N` link wins over
  // stored progress (explicit intent). Runs once per document.
  useEffect(() => {
    if (!pageCount || restoredRef.current) return
    if (typeof window === 'undefined') return
    restoredRef.current = true
    let target = null
    if (syncHash) {
      const match = /#page=(\d+)/.exec(window.location.hash)
      if (match) target = Number(match[1])
    }
    if (target == null && storageKey) {
      try {
        const stored = window.localStorage?.getItem(storageKey)
        const parsed = stored ? parseInt(stored, 10) : NaN
        if (Number.isInteger(parsed) && parsed > 1) target = parsed
      } catch { /* private mode — start at page 1 */ }
    }
    if (!target || target < 2 || target > pageCount) return
    // One frame so the placeholder boxes have their measured heights.
    requestAnimationFrame(() => scrollToPage(target, 'auto'))
  }, [pageCount, syncHash, storageKey, scrollToPage])

  // ------------------------------------------------------------ chrome

  const goPrev = useCallback(() => scrollToPage(activePage - 1), [activePage, scrollToPage])
  const goNext = useCallback(() => scrollToPage(activePage + 1), [activePage, scrollToPage])

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'PageUp') { e.preventDefault(); goPrev() }
      else if (e.key === 'PageDown') { e.preventDefault(); goNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPrev, goNext])

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

  const retryDocument = useCallback(() => setLoadNonce((n) => n + 1), [])
  const retryPage = useCallback((pageNumber) => {
    setFailedPages((prev) => {
      const next = new Set(prev)
      next.delete(pageNumber)
      return next
    })
    renderedKeyRef.current.delete(pageNumber)
    setRenderNonce((n) => n + 1)
  }, [])

  // Small cached thumbnail per page for the jump sheet — ~96 CSS px wide,
  // never the full-resolution page.
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
    canvas.width = 0
    canvas.height = 0
    return dataUrl
  }, [pdf])

  // ------------------------------------------------------------ render

  const pageNumbers = useMemo(
    () => Array.from({ length: pageCount }, (_, i) => i + 1),
    [pageCount],
  )

  const aspectFor = useCallback((pageNumber) => {
    const size = pageSizes[pageNumber - 1] || baseSize
    if (!size?.w || !size?.h) return FALLBACK_ASPECT
    const flipped = rotation % 180 !== 0
    const w = flipped ? size.h : size.w
    const h = flipped ? size.w : size.h
    return w / h
  }, [pageSizes, baseSize, rotation])

  const boxWidth = contentWidth ? `${Math.round(contentWidth)}px` : '100%'

  return (
    <div
      className="w-full"
      role="region"
      aria-label={title ? `${title} viewer` : 'PDF viewer'}
    >
      {/* Toolbar — page label plus the secondary controls in an overflow
          menu, so no small tap targets sit over exam content. */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-black theme-text-muted uppercase tracking-widest tabular-nums">
          {pageCount ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}` : 'Loading…'}
        </span>
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
      </div>

      {/* The page stack. Normal document flow — the document (or the
          fullscreen reader's surface) owns vertical scrolling, so there is
          exactly one scrollbar, as on image papers. `pan-y pinch-zoom`
          keeps a swipe that starts on the paper scrolling the page while
          still allowing pinch-to-zoom. */}
      <div
        ref={rootRef}
        className="w-full flex flex-col gap-5 relative"
        style={{ touchAction: 'pan-y pinch-zoom', overscrollBehaviorY: 'auto' }}
      >
        {loading && (
          <div className="w-full max-w-md mx-auto py-4" aria-hidden="true">
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
          <div role="alert" className="py-12 text-center space-y-3 px-4">
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

        {/* Sticky page indicator — orients the reader inside a long paper,
            exactly as the image stack does. Skipped when the glass dock is
            on screen: the dock already shows "7 / 11" and two indicators
            plus the per-page caption is noise, not orientation. */}
        {pageCount > 3 && !showDock && (
          <div aria-hidden="true" className="sticky top-2 z-10 self-center pointer-events-none">
            <span className="inline-block bg-black/75 text-white text-xs font-black rounded-full px-3 py-1 shadow-elev-md tabular-nums">
              Page {activePage} of {pageCount}
            </span>
          </div>
        )}

        {pageNumbers.map((pageNumber) => {
          const drawn = renderedPages.has(pageNumber)
          const failed = failedPages.has(pageNumber)
          return (
            <article
              key={pageNumber}
              ref={(el) => {
                if (el) pageElRefs.current.set(pageNumber, el)
                else pageElRefs.current.delete(pageNumber)
              }}
              data-page-number={pageNumber}
              className="w-full"
              // Clear the viewer's sticky top chrome when jumping to a page.
              style={{ scrollMarginTop: '72px' }}
            >
              <p className="text-center text-xs font-bold theme-text-muted mb-2">
                Page {pageNumber} of {pageCount}
              </p>
              {/* Per-page horizontal strip: a zoomed page pans inside its own
                  row, so the wide content never forces a second vertical
                  scrollbar onto the stack. */}
              <div
                className="w-full overflow-x-auto"
                style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
              >
                <div
                  className="relative mx-auto bg-white rounded-radius-md overflow-hidden shadow-elev-sm"
                  style={{ width: boxWidth, aspectRatio: aspectFor(pageNumber) }}
                >
                  <canvas
                    ref={(el) => {
                      if (el) canvasRefs.current.set(pageNumber, el)
                      else canvasRefs.current.delete(pageNumber)
                    }}
                    aria-label={`${title || 'Paper'} — page ${pageNumber}`}
                    className={drawn && !failed ? 'block w-full h-auto' : 'hidden'}
                  />
                  {failed && (
                    <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-rose-50 px-4 text-center">
                      <p className="text-sm font-bold text-rose-700">
                        This page could not be displayed.
                      </p>
                      <button
                        type="button"
                        onClick={() => retryPage(pageNumber)}
                        className="inline-flex items-center justify-center rounded-full bg-rose-600 text-white px-4 py-2 text-xs font-black hover:bg-rose-700 min-h-[40px]"
                      >
                        Retry page
                      </button>
                    </div>
                  )}
                  {!drawn && !failed && (
                    // Paper-shaped skeleton so a fast fling never shows a void.
                    <div aria-hidden="true" className="absolute inset-0 p-[8%] space-y-3 animate-pulse">
                      <div className="h-3 w-2/3 mx-auto rounded bg-black/10" />
                      <div className="h-2.5 w-1/2 mx-auto rounded bg-black/10" />
                      <div className="pt-4 space-y-2.5">
                        {Array.from({ length: 10 }, (_, i) => (
                          <div key={i} className="h-2 rounded bg-black/5" style={{ width: `${92 - (i % 4) * 11}%` }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {showDock && !error && (
        <GlassPageNavigation
          pageNumber={activePage}
          pageCount={pageCount}
          onPrev={goPrev}
          onNext={goNext}
          onOpenThumbnails={pdf ? () => setThumbsOpen(true) : undefined}
          onJumpToPage={scrollToPage}
          zIndexClass={overlay ? 'z-[70]' : 'z-40'}
        />
      )}
      {showDock && pdf && (
        <PageThumbnailSheet
          open={thumbsOpen}
          onClose={() => setThumbsOpen(false)}
          pageCount={pageCount}
          currentPage={activePage}
          getThumbnail={getThumbnail}
          onSelect={scrollToPage}
        />
      )}
    </div>
  )
}
