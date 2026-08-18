/**
 * The scrolling list of rendered paper pages, and the single page image it
 * repeats.
 *
 * `PaperPageImage` is co-located rather than given its own file because this
 * list is its only consumer: it owns the per-page loaded/failed/retry state
 * that the image reports back into.
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import { ImageZoomOverlay } from './lazyOverlays'

/**
 * Vertical stack of past-paper page images. Each image uses onLoad /
 * onError so a network or permission failure swaps the page to a clean
 * "page failed to load" panel instead of the browser's broken-image
 * glyph (which would otherwise show the alt text and an icon).
 */
function PageImageList({ pages, totalPages, loading, loadedPages, failedPages, retryNonces = {}, dataSaver = false, onLoad, onError, onRetry, altPrefix = 'Question paper page', syncHash = false, progressKey = null }) {
  const articleRefs = useRef({})
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

  return (
    <div
      className="flex flex-col gap-5 relative"
      // The page stack is a normal-flow surface: the document/body owns
      // vertical scrolling (no inner scroll container). `pan-y pinch-zoom`
      // guarantees a swipe anywhere on the paper scrolls the page and still
      // allows pinch-zoom; `overscroll-behavior-y: auto` keeps native rubber-
      // band scrolling at the ends.
      style={{ touchAction: 'pan-y pinch-zoom', overscrollBehaviorY: 'auto' }}
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
            <div className="w-full bg-white rounded-radius-md overflow-hidden shadow-elev-sm">
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
          </article>
        )
      })}

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
        // `pan-y pinch-zoom` keeps single-finger vertical scrolling AND
        // pinch-to-zoom available when a swipe starts on the page image —
        // never `touch-action: none`, which would freeze the scroll. The
        // drag/select hints stop a long-press from starting an image drag
        // that swallows the scroll gesture instead.
        touchAction: 'pan-y pinch-zoom',
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
