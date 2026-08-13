/**
 * GlassPageNavigation — the floating bottom "glass dock" for page-by-page
 * (PDF) past-paper reading on mobile.
 *
 * Replaces the tiny prev/next arrows that used to live in the top toolbar
 * with thumb-reachable 52px controls fixed near the bottom of the viewport:
 *
 *   [ Previous ] [ Thumbnails ] [ 5 / 14 ] [ Next ]
 *
 * Behaviour:
 *   - Fixed 16px from the viewport edges, above the Android / iOS safe-area
 *     inset (`bottom: calc(16px + env(safe-area-inset-bottom))`).
 *   - Previous disables on page 1, Next on the last page; disabled controls
 *     stay visible (dimmed) so the layout never jumps.
 *   - Tapping the page indicator opens an inline page-jump input.
 *   - Light haptic tick on page change where the Vibration API exists.
 *   - Auto-dims after a few idle seconds; any touch/scroll/page change
 *     restores full opacity (skipped under prefers-reduced-motion).
 *   - `aria-live="polite"` announces "Page X of Y" to screen readers.
 *
 * The dock is presentational + input only — page state stays in the owning
 * viewer, so PDF page-index state never leaks into image-scroll surfaces.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, LayoutGrid } from '../../components/ui/icons'

const IDLE_DIM_MS = 3500

/** Best-effort light haptic tick (Android Chrome / Capacitor WebView). */
function hapticTick() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(8)
    }
  } catch { /* haptics are decorative */ }
}

export default function GlassPageNavigation({
  pageNumber,          // 1-based current page
  pageCount,           // total pages (0/undefined while loading)
  onPrev,
  onNext,
  onOpenThumbnails,    // optional — omit to hide the thumbnails button
  onJumpToPage,        // optional — (pageNumber: number) => void; enables the jump input
  zIndexClass = 'z-40',
}) {
  const [jumpOpen, setJumpOpen] = useState(false)
  const [jumpValue, setJumpValue] = useState('')
  const [dimmed, setDimmed] = useState(false)
  const idleTimerRef = useRef(null)
  const jumpInputRef = useRef(null)

  const hasPages = Number.isInteger(pageCount) && pageCount > 0
  const atFirst = !hasPages || pageNumber <= 1
  const atLast = !hasPages || pageNumber >= pageCount

  // ── Idle dimming ──────────────────────────────────────────────────
  const wake = useCallback(() => {
    setDimmed(false)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => setDimmed(true), IDLE_DIM_MS)
  }, [])

  useEffect(() => {
    // Respect reduced motion: keep the dock fully opaque, no fade cycling.
    let reduceMotion = false
    try {
      reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
    } catch { /* matchMedia unavailable — treat as no preference */ }
    if (reduceMotion) return undefined

    wake()
    const onInteract = () => wake()
    window.addEventListener('scroll', onInteract, { passive: true })
    window.addEventListener('touchstart', onInteract, { passive: true })
    window.addEventListener('pointermove', onInteract, { passive: true })
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      window.removeEventListener('scroll', onInteract)
      window.removeEventListener('touchstart', onInteract)
      window.removeEventListener('pointermove', onInteract)
    }
  }, [wake])

  // Page changes restore full opacity so the indicator is readable.
  useEffect(() => { wake() }, [pageNumber, wake])

  useEffect(() => {
    if (jumpOpen) jumpInputRef.current?.focus()
  }, [jumpOpen])

  const handlePrev = useCallback(() => {
    if (atFirst) return
    hapticTick()
    onPrev?.()
  }, [atFirst, onPrev])

  const handleNext = useCallback(() => {
    if (atLast) return
    hapticTick()
    onNext?.()
  }, [atLast, onNext])

  const submitJump = useCallback((e) => {
    e.preventDefault()
    const parsed = parseInt(jumpValue, 10)
    if (Number.isInteger(parsed) && hasPages) {
      const clamped = Math.min(pageCount, Math.max(1, parsed))
      onJumpToPage?.(clamped)
      hapticTick()
    }
    setJumpOpen(false)
    setJumpValue('')
  }, [jumpValue, hasPages, pageCount, onJumpToPage])

  const navButtonClass =
    'flex-shrink-0 inline-flex items-center justify-center w-[52px] h-[52px] rounded-2xl ' +
    'theme-text transition active:scale-95 hover:bg-black/5 ' +
    'disabled:opacity-40 disabled:pointer-events-none ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'

  return (
    <div
      className={`fixed left-4 right-4 ${zIndexClass} pointer-events-none flex justify-center`}
      style={{ bottom: 'calc(16px + env(safe-area-inset-bottom))' }}
    >
      <div
        className={`zx-glass-dock pointer-events-auto flex items-center gap-1 px-2 py-1.5 w-full max-w-sm transition-opacity duration-500 ${
          dimmed ? 'opacity-70' : 'opacity-100'
        }`}
        onPointerDown={wake}
      >
        <button
          type="button"
          onClick={handlePrev}
          disabled={atFirst}
          aria-label="Previous page"
          className={navButtonClass}
        >
          <ChevronLeft size={24} strokeWidth={2.6} />
        </button>

        {onOpenThumbnails && (
          <button
            type="button"
            onClick={() => { wake(); onOpenThumbnails() }}
            aria-label="Open page thumbnails"
            className={navButtonClass}
          >
            <LayoutGrid size={22} strokeWidth={2.2} />
          </button>
        )}

        {/* Current page indicator / page-jump input */}
        <div className="flex-1 min-w-0 flex items-center justify-center">
          {jumpOpen && onJumpToPage ? (
            <form onSubmit={submitJump} className="flex items-center gap-1.5">
              <label htmlFor="glass-dock-jump" className="sr-only">Go to page</label>
              <input
                ref={jumpInputRef}
                id="glass-dock-jump"
                type="number"
                inputMode="numeric"
                min={1}
                max={hasPages ? pageCount : undefined}
                value={jumpValue}
                onChange={(e) => setJumpValue(e.target.value)}
                onBlur={() => { setJumpOpen(false); setJumpValue('') }}
                placeholder={String(pageNumber)}
                className="w-16 h-10 rounded-xl border theme-border theme-card theme-text text-center text-sm font-black tabular-nums"
              />
              <button
                type="submit"
                // Keep mousedown from blurring the input before submit fires.
                onMouseDown={(e) => e.preventDefault()}
                className="h-10 px-3 rounded-xl theme-accent-fill theme-on-accent text-xs font-black"
              >
                Go
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => { if (onJumpToPage) { wake(); setJumpOpen(true) } }}
              aria-label={onJumpToPage ? 'Go to a specific page' : undefined}
              disabled={!onJumpToPage}
              className="min-h-[44px] px-3 rounded-xl text-base font-black theme-text tabular-nums whitespace-nowrap disabled:opacity-100 transition hover:bg-black/5"
            >
              {hasPages ? `${pageNumber} / ${pageCount}` : '— / —'}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleNext}
          disabled={atLast}
          aria-label="Next page"
          className={navButtonClass}
        >
          <ChevronRight size={24} strokeWidth={2.6} />
        </button>
      </div>

      {/* Screen-reader page announcements */}
      <span aria-live="polite" className="sr-only">
        {hasPages ? `Page ${pageNumber} of ${pageCount}` : ''}
      </span>
    </div>
  )
}
