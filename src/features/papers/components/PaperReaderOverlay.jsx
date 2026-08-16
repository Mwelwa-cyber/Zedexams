/**
 * PaperReaderOverlay — an immersive, full-viewport reading mode for a past
 * paper, in the prototype-v3 viewer language (`.papers-reader`): pages on
 * the dark slate canvas, a floating gradient top bar (back + title), and
 * a bottom action bar carrying Save offline and Start Quiz.
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
import { ArrowLeft, Download, PencilLine } from '../../../shared/components/icons'
import useFocusTrap from '../../../hooks/useFocusTrap'

export default function PaperReaderOverlay({
  title,
  subtitle = '',
  onClose,
  onDownload,
  downloading = false,
  onStartQuiz = null,
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
      className="papers-reader fixed inset-0 z-[60] flex flex-col"
    >
      {/* Floating gradient top bar (prototype .pv-top) — always visible,
          unlike the old native-fullscreen chrome. */}
      <div className="papers-reader-topbar flex-shrink-0 flex items-center gap-2.5 px-3 pt-3 pb-5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Exit reading mode"
          className="papers-reader-ghost inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl !border-0 active:scale-95 transition"
        >
          <ArrowLeft size={18} strokeWidth={2.6} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-black leading-tight">{title}</p>
          {subtitle && <p className="truncate text-[11px] font-bold text-white/75">{subtitle}</p>}
        </div>
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

      {/* Bottom action bar (prototype .pv-bot): Save offline + Start Quiz. */}
      {(onDownload || onStartQuiz) && (
        <div
          className="papers-reader-botbar flex-shrink-0 flex items-center gap-2.5 px-4 pt-5"
          style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
        >
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading}
              aria-label="Download paper"
              className="papers-reader-ghost flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl px-3 py-3 text-[13px] font-black active:scale-95 transition disabled:opacity-60"
            >
              <Download size={15} strokeWidth={2.4} /> {downloading ? 'Preparing…' : 'Save offline'}
            </button>
          )}
          {onStartQuiz && (
            <button
              type="button"
              onClick={onStartQuiz}
              className="papers-reader-quiz flex-[1.35] inline-flex items-center justify-center gap-1.5 rounded-2xl px-3 py-3 text-[13px] font-black active:scale-95 transition"
            >
              <PencilLine size={15} strokeWidth={2.4} /> Start Quiz ▸
            </button>
          )}
        </div>
      )}
    </div>
  )
}
