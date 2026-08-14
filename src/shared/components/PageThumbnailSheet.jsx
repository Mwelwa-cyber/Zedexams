/**
 * PageThumbnailSheet — bottom-sheet page picker for the past-paper viewers.
 *
 * Opened from the glass dock's grid button. Shows a drag handle, a "Pages"
 * title with the current position, a responsive grid of lazily-rendered
 * page thumbnails (page number under each, accent outline on the current
 * page), a direct page-number input, and a Close button.
 *
 * Thumbnails are produced by the owner via `getThumbnail(pageNumber)` —
 * an async function returning an image URL / data-URL — so this sheet
 * works for BOTH source modes without knowing about PDF.js:
 *   - PDF mode: the viewer renders a small canvas per page and caches it.
 *   - Image mode: the viewer hands back the (already downscaled) page URL.
 * Each cell only requests its thumbnail once it scrolls into view inside
 * the sheet (IntersectionObserver), so a 20-page paper doesn't render 20
 * canvases up front.
 *
 * Selecting a page calls `onSelect(pageNumber)` and closes the sheet; the
 * owner decides what "select" means (flip a PDF page index vs smooth-scroll
 * an image page into view).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from './icons'
import useFocusTrap from '../../hooks/useFocusTrap'

function ThumbnailCell({ pageNumber, selected, getThumbnail, onSelect }) {
  const cellRef = useRef(null)
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  const requestedRef = useRef(false)

  // Lazy-load: only ask for the thumbnail once the cell is (nearly) visible.
  useEffect(() => {
    const el = cellRef.current
    if (!el || requestedRef.current) return undefined
    let cancelled = false
    const load = () => {
      if (requestedRef.current) return
      requestedRef.current = true
      Promise.resolve(getThumbnail(pageNumber))
        .then((url) => { if (!cancelled && url) setSrc(url) })
        .catch(() => { if (!cancelled) setFailed(true) })
    }
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return () => { cancelled = true }
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        load()
        observer.disconnect()
      }
    }, { rootMargin: '160px' })
    observer.observe(el)
    return () => { cancelled = true; observer.disconnect() }
  }, [getThumbnail, pageNumber])

  return (
    <button
      ref={cellRef}
      type="button"
      onClick={() => onSelect(pageNumber)}
      aria-label={`Go to page ${pageNumber}`}
      aria-current={selected ? 'page' : undefined}
      className={`group flex flex-col items-center gap-1.5 rounded-xl p-1.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
        selected ? 'bg-[var(--accent-bg)]' : 'hover:theme-bg-subtle'
      }`}
    >
      <span
        className={`block w-full aspect-[1/1.41] overflow-hidden rounded-lg bg-white shadow-elev-sm ring-2 transition ${
          selected ? 'ring-[var(--accent)]' : 'ring-black/10 group-hover:ring-black/20'
        }`}
      >
        {src ? (
          <img src={src} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain" />
        ) : (
          <span className="w-full h-full grid place-items-center text-[10px] font-bold theme-text-muted">
            {failed ? '—' : '…'}
          </span>
        )}
      </span>
      {/* Selection is conveyed by aria-current + the bold label, not colour
          alone. */}
      <span className={`text-xs tabular-nums ${selected ? 'font-black theme-accent-text' : 'font-bold theme-text-muted'}`}>
        {pageNumber}
      </span>
    </button>
  )
}

export default function PageThumbnailSheet({
  open,
  onClose,
  pageCount,
  currentPage,       // 1-based
  getThumbnail,      // async (pageNumber) => image URL
  onSelect,          // (pageNumber) => void
  title = 'Pages',
}) {
  const panelRef = useRef(null)
  const [jumpValue, setJumpValue] = useState('')

  useFocusTrap(panelRef, { active: open, onEscape: onClose })

  // Lock the page scroll behind the sheet while it's open.
  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const handleSelect = useCallback((pageNumber) => {
    onSelect(pageNumber)
    onClose()
  }, [onSelect, onClose])

  const submitJump = useCallback((e) => {
    e.preventDefault()
    const parsed = parseInt(jumpValue, 10)
    if (Number.isInteger(parsed) && pageCount) {
      handleSelect(Math.min(pageCount, Math.max(1, parsed)))
    }
    setJumpValue('')
  }, [jumpValue, pageCount, handleSelect])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Page thumbnails"
        className="relative w-full sm:max-w-lg theme-card rounded-t-3xl sm:rounded-3xl sm:mb-6 shadow-elev-lg border theme-border flex flex-col max-h-[75vh]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1" aria-hidden="true">
          <span className="block w-10 h-1.5 rounded-full bg-black/15" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="theme-text font-black text-base leading-tight">{title}</h2>
            <p className="theme-text-muted text-xs font-bold tabular-nums">
              Page {currentPage} of {pageCount}
            </p>
          </div>
          <form onSubmit={submitJump} className="flex items-center gap-1.5">
            <label htmlFor="thumb-sheet-jump" className="sr-only">Go to page number</label>
            <input
              id="thumb-sheet-jump"
              type="number"
              inputMode="numeric"
              min={1}
              max={pageCount || undefined}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              placeholder="Page…"
              className="w-20 h-11 rounded-xl border theme-border theme-card theme-text text-center text-sm font-bold tabular-nums"
            />
          </form>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close page thumbnails"
            className="flex-shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-full theme-bg-subtle theme-text hover:theme-card active:scale-95 transition"
          >
            <X size={20} strokeWidth={2.6} />
          </button>
        </div>

        {/* Thumbnail grid */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {Array.from({ length: pageCount || 0 }, (_, i) => i + 1).map((pageNumber) => (
              <ThumbnailCell
                key={pageNumber}
                pageNumber={pageNumber}
                selected={pageNumber === currentPage}
                getThumbnail={getThumbnail}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
