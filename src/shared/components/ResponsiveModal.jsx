import { useEffect, useRef, useState } from 'react'

// ResponsiveModal — the shared dialog shell for compact pop-ups (paywalls,
// payment steps). One component, two presentations:
//   • ≥ sm (640px): a centred card, max 440px wide, max 80vh tall.
//   • < sm: a bottom sheet — full width, rounded top corners, max 85vh,
//     with a drag-handle affordance and safe-area padding.
//
// The body scrolls; `footer` (primary actions) stays pinned below it so the
// main CTA is always visible above the mobile keyboard. Accessibility is
// handled here once instead of per-modal: focus trap, Esc-to-close, body
// scroll lock, and focus restore to the triggering element on close.
//
// Stacks above the checkout modals (z-50/60) on purpose: this shell is used
// by pop-ups that *lead into* those flows, and must never render under them.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

export default function ResponsiveModal({
  onClose,
  labelledBy,
  children,
  footer,
  initialFocusRef,
  showClose = true,
}) {
  const dialogRef = useRef(null)
  const scrollRef = useRef(null)
  // "More below" cue for short screens: a bottom fade over the scroll area,
  // shown only while the content actually overflows and isn't scrolled to the
  // end — so it never suggests hidden content when everything fits.
  const [showScrollCue, setShowScrollCue] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function update() {
      const overflowing = el.scrollHeight - el.clientHeight > 4
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
      setShowScrollCue(overflowing && !atEnd)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  // Body scroll lock + restore focus to the element that opened the modal.
  useEffect(() => {
    const opener = document.activeElement
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => {
      const target = initialFocusRef?.current || dialogRef.current
      target?.focus?.()
    }, 60)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prev
      opener?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc closes; Tab cycles inside the dialog (focus trap).
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.('esc')
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusables = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE))
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70]">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade-in"
        onClick={() => onClose?.('backdrop')}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl theme-card theme-text shadow-2xl outline-none animate-slide-up
                   sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[80vh] sm:w-[min(440px,calc(100vw-32px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:animate-scale-in"
      >
        {/* Bottom-sheet drag-handle affordance (hidden on desktop) */}
        <div className="flex shrink-0 justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full theme-bg-subtle" />
        </div>
        {/* Close lives on the shell, above the scroll area, so it can never
            scroll out of reach on short screens. */}
        {showClose && (
          <button
            type="button"
            onClick={() => onClose?.('close')}
            aria-label="Close"
            className="absolute right-3 top-2 z-10 grid h-9 w-9 place-items-center rounded-full theme-card text-lg theme-text-muted shadow-sm ring-1 ring-black/5 transition-colors hover:theme-bg-subtle hover:theme-text sm:top-3"
          >
            ✕
          </button>
        )}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
          {/* Scroll cue lives INSIDE the scroller (sticky to its bottom edge,
              overlaying the last 40px via the negative margin) so the scroller
              keeps its natural flex sizing — a sibling overlay needed a
              percentage-height wrapper that collapsed on short screens. */}
          {showScrollCue && (
            <div
              aria-hidden="true"
              className="pointer-events-none sticky bottom-0 -mt-10 h-10 bg-gradient-to-t from-white to-transparent"
            />
          )}
        </div>
        {footer && (
          <div className="shrink-0 border-t theme-border theme-card px-5 pt-2.5 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
