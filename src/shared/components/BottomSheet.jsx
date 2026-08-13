import { useEffect, useRef, useState } from 'react'

/**
 * Mobile bottom sheet for the Dashboard V2 mobile IA — slides up from the
 * bottom edge with a drag handle, closing on backdrop tap, Escape, or a
 * downward swipe. Content area scrolls; the page behind is scroll-locked.
 * Safe-area aware; motion collapses under prefers-reduced-motion via the
 * global .tdv2 reduced-motion rules.
 */
export default function BottomSheet({ open, onClose, title, children }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const returnFocus = useRef(null)
  const drag = useRef(null)
  const [dragY, setDragY] = useState(0)

  // Keep the latest onClose in a ref so the Escape handler stays current
  // WITHOUT making onClose a dependency of the open/close effect below.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  // Scroll-lock + Escape + initial focus, and focus restore on close. Keyed on
  // `open` ONLY: every caller passes an inline onClose, so including it here
  // would re-run this effect on any in-sheet state change (Next recommendation,
  // View all…). The cleanup would then restore focus prematurely and re-capture
  // the sheet's own close button as the opener, so focus could never return to
  // the element that opened the sheet. Running only on the open transition
  // captures the true opener once and restores it once, on close.
  useEffect(() => {
    if (!open) return undefined
    returnFocus.current = document.activeElement
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
      const el = returnFocus.current
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) setDragY(0)
  }, [open])

  if (!open) return null

  // Swipe-to-close, armed on the handle/header strip only so the sheet's
  // scrollable content never fights the gesture.
  const onDragStart = (e) => {
    drag.current = { startY: e.clientY, pointerId: e.pointerId }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onDragMove = (e) => {
    if (!drag.current) return
    setDragY(Math.max(0, e.clientY - drag.current.startY))
  }
  const onDragEnd = (e) => {
    if (!drag.current) return
    const dy = e.clientY - drag.current.startY
    drag.current = null
    setDragY(0)
    if (dy > 80) onClose()
  }

  return (
    <div className="tdv2m-sheet-root" role="presentation">
      <div className="tdv2m-sheet-backdrop" onPointerDown={onClose} />
      <div
        className="tdv2m-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
      >
        <div
          className="tdv2m-sheet-grip"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <span className="tdv2m-sheet-handle" aria-hidden="true" />
          <div className="tdv2m-sheet-head">
            <h2 className="tdv2m-sheet-title">{title}</h2>
            <button
              type="button"
              ref={closeRef}
              className="tdv2m-sheet-close"
              aria-label="Close"
              onClick={onClose}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="M2 2l11 11M13 2L2 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="tdv2m-sheet-body">{children}</div>
      </div>
    </div>
  )
}
