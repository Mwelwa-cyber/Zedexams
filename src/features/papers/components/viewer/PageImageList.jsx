/**
 * The scrolling list of rendered paper pages, and the single page image it
 * repeats.
 *
 * `PaperPageImage` is co-located rather than given its own file because this
 * list is its only consumer: it owns the per-page loaded/failed/retry state
 * that the image reports back into.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import usePinchZoom from '../../../../shared/hooks/usePinchZoom'
import { stepZoom, FIT_ZOOM, MAX_ZOOM, MIN_ZOOM } from '../../../../shared/utils/pinchZoomCore'
import ZoomControl from '../../../../shared/components/ZoomControl'
import { ImageZoomOverlay } from './lazyOverlays'

/**
 * Vertical stack of past-paper page images. Each image uses onLoad /
 * onError so a network or permission failure swaps the page to a clean
 * "page failed to load" panel instead of the browser's broken-image
 * glyph (which would otherwise show the alt text and an icon).
 */
function PageImageList({ pages, totalPages, loading, loadedPages, failedPages, retryNonces = {}, dataSaver = false, onLoad, onError, onRetry, altPrefix = 'Question paper page', syncHash = false, progressKey = null, overlay = false }) {
  const articleRefs = useRef({})
  const stackRef = useRef(null)
  const stripRefs = useRef({})
  // How far across a zoomed page the reader has panned, 0–1 — carried onto the
  // next page so reading the right-hand side of a wide paper does not snap
  // back to the left margin on every page turn.
  const panRatioRef = useRef(0)
  // Pinch-to-zoom on the page stack itself. Scanned papers and PDF papers now
  // zoom the same way (see PdfPageStream): two formats of the same archive
  // behaving differently is what this viewer keeps having to be fixed for.
  const [zoom, setZoom] = useState(FIT_ZOOM)
  const [visiblePage, setVisiblePage] = useState(1)
  // The page currently open in the full-screen pinch-to-zoom viewer, if any.
  const [zoomedPage, setZoomedPage] = useState(null)
  const hasScrolledToHashRef = useRef(false)
  const hasRestoredProgressRef = useRef(false)
  // In Data Saver mode, pre-load only the first 2 pages; later pages
  // wait for an explicit "Load page" tap so a long paper doesn't burn
  // through 10+ MB on open.
  const DATA_SAVER_AUTOLOAD = 2
  const [revealedPages, setRevealedPages] = useState(() => {
    const next = {}
    if (dataSaver) {
      pages.slice(0, DATA_SAVER_AUTOLOAD).forEach((p) => { next[p.key] = true })
    }
    return next
  })

  useEffect(() => {
    if (!dataSaver) return
    setRevealedPages((prev) => {
      const next = { ...prev }
      pages.slice(0, DATA_SAVER_AUTOLOAD).forEach((p) => { next[p.key] = true })
      return next
    })
  }, [dataSaver, pages])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the largest intersection ratio in view —
        // when two pages straddle the viewport, the bigger one wins.
        const inView = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (inView.length) {
          const pageNumber = Number(inView[0].target.dataset.pageNumber)
          if (pageNumber) {
            setVisiblePage(pageNumber)
            if (syncHash && typeof window !== 'undefined') {
              const nextHash = `#page=${pageNumber}`
              if (window.location.hash !== nextHash) {
                window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`)
              }
            }
            if (progressKey && typeof window !== 'undefined') {
              try {
                window.localStorage?.setItem(progressKey, String(pageNumber))
              } catch { /* quota / private mode — ignore */ }
            }
          }
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-20% 0px -60% 0px' },
    )
    Object.values(articleRefs.current).forEach((el) => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [pages, syncHash, progressKey])

  // On first mount, scroll to either:
  //   1. the #page=N hash (shared deep link wins — explicit intent)
  //   2. otherwise the locally-saved progress page (resume reading)
  // Only runs once per pages array; subsequent hash / progress updates
  // are driven by the observer and shouldn't fight the user's scroll.
  useEffect(() => {
    if (!pages.length) return
    if (hasScrolledToHashRef.current && hasRestoredProgressRef.current) return
    if (typeof window === 'undefined') return
    let targetPageNumber = null
    if (syncHash && !hasScrolledToHashRef.current) {
      const match = /#page=(\d+)/.exec(window.location.hash)
      if (match) targetPageNumber = Number(match[1])
    }
    if (targetPageNumber == null && progressKey && !hasRestoredProgressRef.current) {
      try {
        const stored = window.localStorage?.getItem(progressKey)
        const parsed = stored ? Number(stored) : NaN
        if (Number.isInteger(parsed) && parsed > 1) targetPageNumber = parsed
      } catch { /* ignore */ }
    }
    hasScrolledToHashRef.current = true
    hasRestoredProgressRef.current = true
    if (!targetPageNumber) return
    const target = pages.find((p) => p.pageNumber === targetPageNumber)
    if (!target) return
    if (dataSaver) setRevealedPages((prev) => ({ ...prev, [target.key]: true }))
    const el = articleRefs.current[target.key]
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
  }, [pages, syncHash, dataSaver, progressKey])

  // Declared above the early returns below — a hook cannot sit behind one.
  const { requestZoom } = usePinchZoom(stackRef, {
    zoom,
    onZoomChange: setZoom,
    min: MIN_ZOOM,
    max: MAX_ZOOM,
  })
  const zoomIn = useCallback(() => requestZoom(stepZoom(zoom, 1)), [requestZoom, zoom])
  const zoomOut = useCallback(() => requestZoom(stepZoom(zoom, -1)), [requestZoom, zoom])
  const fitWidth = useCallback(() => requestZoom(FIT_ZOOM), [requestZoom])

  const rememberPan = useCallback((event) => {
    const el = event.currentTarget
    const travel = el.scrollWidth - el.clientWidth
    if (travel > 0) panRatioRef.current = Math.min(1, Math.max(0, el.scrollLeft / travel))
  }, [])

  // Carry the horizontal pan onto the page scrolled into view, unless that
  // page has already been positioned (by the reader, or by the zoom's own
  // focal correction).
  useEffect(() => {
    const ratio = panRatioRef.current
    if (ratio <= 0) return
    const page = pages.find((p) => p.pageNumber === visiblePage)
    const el = page ? stripRefs.current[page.key] : null
    if (!el || el.scrollLeft > 0) return
    const travel = el.scrollWidth - el.clientWidth
    if (travel > 0) el.scrollLeft = travel * ratio
  }, [visiblePage, zoom, pages])

  if (loading) {
    return (
      <div className="theme-card border theme-border rounded-radius-md h-[60vh] flex items-center justify-center theme-text-muted text-sm">
        Loading paper…
      </div>
    )
  }

  if (!pages.length) {
    return (
      <div className="theme-card border theme-border rounded-radius-md p-6 text-center text-sm theme-text-muted">
        No pages available. Please refresh or contact support.
      </div>
    )
  }

  // A percentage, not a transform: the <img> redraws from its own full-
  // resolution source at the larger size, so a zoomed page is genuinely
  // sharper. Scaling the rendered pixels would just magnify the unreadable
  // thing the learner started with.
  const zoomWidth = zoom === FIT_ZOOM ? '100%' : `${(zoom * 100).toFixed(2)}%`

  return (
    <div
      ref={stackRef}
      className="flex flex-col gap-5 relative"
      // The page stack is a normal-flow surface: the document/body owns
      // vertical scrolling (no inner scroll container). `pan-y` guarantees a
      // one-finger swipe anywhere on the paper scrolls the page;
      // `overscroll-behavior-y: auto` keeps native rubber-band scrolling at
      // the ends. `pinch-zoom` is deliberately absent: the stack implements
      // pinch itself (usePinchZoom), because the Android WebView the app ships
      // in has the browser's own pinch switched off — so the CSS keyword bought
      // a learner on a phone nothing at all.
      style={{ touchAction: 'pan-y', overscrollBehaviorY: 'auto' }}
    >
      <p className="text-center text-xs font-black theme-text-muted uppercase tracking-widest">
        {totalPages} {totalPages === 1 ? 'page' : 'pages'}
      </p>

      {/* Sticky page indicator — orients the learner inside a long paper */}
      {totalPages > 3 && (
        <div
          aria-hidden="true"
          className="sticky top-2 z-10 self-center pointer-events-none"
        >
          <span className="inline-block bg-black/75 text-white text-xs font-black rounded-full px-3 py-1 shadow-elev-md tabular-nums">
            Page {visiblePage} of {totalPages}
          </span>
        </div>
      )}

      {pages.map((page) => {
        const hasFailed = failedPages[page.key]
        const hasLoaded = loadedPages[page.key]
        const nonce = retryNonces[page.key] || 0
        const gated = dataSaver && !revealedPages[page.key]
        // Add a cache-busting param on retry so the browser refetches
        // instead of replaying its cached failure.
        const src = nonce > 0
          ? `${page.url}${page.url.includes('?') ? '&' : '?'}_r=${nonce}`
          : page.url
        return (
          <article
            key={page.key}
            ref={(el) => { articleRefs.current[page.key] = el }}
            data-page-number={page.pageNumber}
            className="w-full"
          >
            <p className="text-center text-xs font-bold theme-text-muted mb-2">
              Page {page.pageNumber} of {totalPages}
            </p>
            {/* Per-page horizontal strip. A zoomed page is wider than the
                column, and it pans inside its OWN row rather than the stack's:
                a horizontally scrollable stack computes overflow-y to `auto`
                and reintroduces the nested vertical scroller this viewer is
                built to avoid. */}
            <div
              ref={(el) => {
                if (el) stripRefs.current[page.key] = el
                else delete stripRefs.current[page.key]
              }}
              onScroll={rememberPan}
              className="w-full overflow-x-auto"
              style={{ touchAction: 'pan-x pan-y' }}
            >
              <div
                // What a zoom is anchored on: usePinchZoom measures this box
                // before and after the change and scrolls by the difference, so
                // the question under the reader's fingers stays under them.
                data-zoom-anchor=""
                className="bg-white rounded-radius-md overflow-hidden shadow-elev-sm"
                style={{ width: zoomWidth }}
              >
                {hasFailed ? (
                  <div className="px-4 py-8 text-center bg-rose-50">
                    <p className="text-sm font-bold text-[var(--danger-fg)]">
                      Page failed to load. Please check your connection and try again.
                    </p>
                    {onRetry && (
                      <button
                        type="button"
                        onClick={() => onRetry(page.key, page)}
                        className="mt-3 inline-flex items-center justify-center rounded-full bg-rose-600 text-white px-4 py-2 text-xs font-black hover:bg-rose-700 min-h-[40px]"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ) : gated ? (
                  <button
                    type="button"
                    onClick={() => setRevealedPages((prev) => ({ ...prev, [page.key]: true }))}
                    className="w-full flex flex-col items-center justify-center gap-2 py-12 text-sm font-black theme-text-muted hover:theme-text hover:theme-bg-subtle"
                    style={{ minHeight: '40vh' }}
                  >
                    <span className="text-3xl" aria-hidden="true">📄</span>
                    <span>Tap to load page {page.pageNumber}</span>
                    <span className="text-xs font-bold theme-text-muted">Data Saver is on</span>
                  </button>
                ) : (
                  <div className="relative">
                    <PaperPageImage
                      pageKey={page.key}
                      src={src}
                      alt={`${altPrefix} ${page.pageNumber} of ${totalPages}`}
                      eager={page.pageNumber <= 2}
                      width={page.width || undefined}
                      height={page.height || undefined}
                      hasLoaded={hasLoaded}
                      onLoad={onLoad}
                      onError={() => onError(page.key, page)}
                    />
                    {!hasLoaded && (
                      <div
                        className="absolute inset-0 flex items-center justify-center theme-text-muted text-sm pointer-events-none"
                        aria-hidden="true"
                      >
                        Loading page {page.pageNumber}…
                      </div>
                    )}
                    {hasLoaded && (
                      <button
                        type="button"
                        onClick={() => setZoomedPage({
                          src,
                          alt: `${altPrefix} ${page.pageNumber} of ${totalPages}`,
                        })}
                        aria-label={`Zoom in on page ${page.pageNumber}`}
                        className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 text-white px-3 py-1.5 text-xs font-black shadow-elev-md hover:bg-black/85"
                      >
                        <span aria-hidden="true">🔍</span> Zoom
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </article>
        )
      })}

      {/* The always-visible way in, for a learner who does not know to pinch
          (and for one holding the phone one-handed, where pinching is
          awkward). Same control the PDF stack carries. */}
      <ZoomControl
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fitWidth}
        // 76px clears the two things that share this corner on the image
        // path: the back-to-top FAB in the plain viewer (fixed bottom-5, 48px
        // tall) and the reader overlay's Save offline / Start Quiz bar.
        bottomPx={76}
        // The reader overlay is z-60; a z-40 pill inside it would be drawn
        // behind the paper and simply not exist for the learner.
        zIndexClass={overlay ? 'z-[70]' : 'z-40'}
        label="Zoom the paper"
      />

      {zoomedPage && (
        <Suspense fallback={null}>
          <ImageZoomOverlay
            src={zoomedPage.src}
            alt={zoomedPage.alt}
            onClose={() => setZoomedPage(null)}
          />
        </Suspense>
      )}
    </div>
  )
}

/**
 * Renders the paper page <img> with a defensive "already cached?" check.
 *
 * The bug this guards against: when the Firebase Storage SW cache (or
 * the browser HTTP cache) serves the image synchronously fast — fast
 * enough that the image's `complete` flag is true before React attaches
 * the `onLoad` listener — the native `load` event never fires for our
 * listener. The "Loading page N…" overlay then sticks forever even
 * though the image is fully rendered behind it.
 *
 * Fix: on mount and on every src change, look at the underlying img
 * element. If it's already complete with non-zero natural dimensions,
 * call `onLoad` manually so the overlay clears.
 */
function PaperPageImage({ pageKey, src, alt, eager, width, height, hasLoaded, onLoad, onError }) {
  const imgRef = useRef(null)

  useEffect(() => {
    const el = imgRef.current
    if (!el || hasLoaded) return
    if (el.complete && el.naturalWidth > 0) {
      onLoad(pageKey)
    }
  }, [src, hasLoaded, pageKey, onLoad])

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      width={width}
      height={height}
      onLoad={() => onLoad(pageKey)}
      onError={onError}
      className="block w-full h-auto select-none"
      style={{
        // `pan-x pan-y` keeps single-finger scrolling available when a swipe
        // starts on the page image — vertically down the stack, and
        // horizontally across a zoomed page inside its strip. Never
        // `touch-action: none`, which would freeze the scroll, and no longer
        // `pinch-zoom`: the stack implements the pinch itself. The drag/select
        // hints stop a long-press from starting an image drag that swallows
        // the scroll gesture instead.
        touchAction: 'pan-x pan-y',
        userSelect: 'none',
        WebkitUserDrag: 'none',
        // Fallback aspect ratio reserves layout space for old uploads that
        // don't have stored dimensions yet, reducing load-time layout jumps.
        // Drop it once loaded so the intrinsic ratio takes over and the
        // rendered page isn't squashed.
        ...(!hasLoaded && !(width && height) ? { aspectRatio: '1 / 1.41' } : {}),
      }}
    />
  )
}

export default PageImageList
