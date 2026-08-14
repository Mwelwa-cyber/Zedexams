/**
 * PaperReaderOverlay — an immersive, full-viewport reading mode for a past
 * paper.
 *
 * Why this replaces the native Fullscreen API:
 *   The old "Fullscreen" button called `element.requestFullscreen()` on the
 *   viewer's content column. That failed three ways for our mobile-first
 *   Zambian audience:
 *     1. The fullscreened <div> had no scroll overflow, so a taller-than-
 *        viewport paper was clipped and frozen — "I can't move anything".
 *     2. The toolbar (incl. the exit button) lived OUTSIDE the fullscreened
 *        element, so once in fullscreen there was no visible way out.
 *     3. iPhone Safari doesn't implement the Fullscreen API on elements at
 *        all, so on iOS the button silently did nothing.
 *
 * A CSS overlay (fixed inset-0) sidesteps every one of those: it always
 * scrolls, always keeps its own toolbar in view, and works identically on
 * iOS Safari, Android Chrome, and the Capacitor WebView. It mirrors the
 * proven pattern in {@link ./ImageZoomOverlay} (body-scroll lock + Escape).
 *
 * The Android hardware back button / browser back gesture closes the reader
 * instead of leaving the page: we push a throwaway history entry on open and
 * treat `popstate` as "close".
 */

import { useEffect, useRef } from 'react'
import { Download, X } from '../../../shared/components/icons'
import useFocusTrap from '../../../hooks/useFocusTrap'

export default function PaperReaderOverlay({
  title,
  onClose,
  onDownload,
  downloading = false,
  children,
}) {
  const overlayRef = useRef(null)
  const bodyRef = useRef(null)

  // Escape-to-close, Tab-trap, and focus restore live in the shared hook.
  // Initial focus goes to the scroll surface (tabIndex=-1) so keyboard
  // page-nav (arrows / space / PageDown) works the moment the reader opens.
  useFocusTrap(overlayRef, { onEscape: () => onClose(), initialFocusRef: bodyRef })

  // Lock body scroll and hook the back button — torn down together.
  // `closedByPop` distinguishes "user pressed back" (history already unwound)
  // from "user tapped Exit / Esc" (we must unwind it).
  useEffect(() => {
    const closedByPop = { current: false }

    function onPop() {
      closedByPop.current = true
      onClose()
    }

    window.addEventListener('popstate', onPop)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    try {
      window.history.pushState({ paperReader: true }, '')
    } catch { /* history blocked (rare) — Esc/Exit still close */ }

    return () => {
      window.removeEventListener('popstate', onPop)
      document.body.style.overflow = previousOverflow
      // Remove the history entry we added, unless back already consumed it.
      if (!closedByPop.current) {
        try {
          if (window.history.state?.paperReader) window.history.back()
        } catch { /* ignore */ }
      }
    }
  }, [onClose])

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={title ? `${title} — reading mode` : 'Reading mode'}
      className="fixed inset-0 z-[60] theme-bg flex flex-col"
    >
      {/* Toolbar — always visible, unlike the old native-fullscreen chrome. */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b theme-border theme-card">
        <button
          type="button"
          onClick={onClose}
          aria-label="Exit reading mode"
          className="inline-flex items-center gap-1.5 rounded-full theme-bg-subtle theme-text px-3 py-2 text-xs font-black hover:theme-card active:scale-95 transition"
        >
          <X size={16} strokeWidth={2.6} /> Exit
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-black theme-text">
          {title}
        </p>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            aria-label="Download paper"
            className="inline-flex items-center gap-1.5 rounded-full theme-accent-fill theme-on-accent px-3 py-2 text-xs font-black active:scale-95 transition disabled:opacity-60"
          >
            <Download size={15} strokeWidth={2.4} /> {downloading ? 'Preparing…' : 'Download'}
          </button>
        )}
      </div>

      {/* Scroll surface — `pan-y pinch-zoom` keeps single-finger scroll AND
          pinch-zoom on touch; `overscroll-contain` stops the scroll chaining
          to the (locked) page behind. Children bring their own layout. */}
      <div
        ref={bodyRef}
        tabIndex={-1}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain outline-none"
        style={{ touchAction: 'pan-y pinch-zoom', WebkitOverflowScrolling: 'touch' }}
      >
        {children}
      </div>
    </div>
  )
}
