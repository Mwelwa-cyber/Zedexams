import { ChevronLeft } from 'lucide-react'

/**
 * StudioShell — layout wrapper for the Lesson Plan Studio.
 *
 * Two mutually exclusive views (the wizard redesign removed the old
 * side-by-side form + empty-canvas layout):
 *
 *   - view="form"   → the five-step creation wizard fills the page. No canvas
 *                     is rendered at all, so the teacher never scrolls past an
 *                     empty "waiting" panel while entering information.
 *   - view="canvas" → the document canvas fills the page (generation progress,
 *                     the finished plan, the editor and export actions), with
 *                     a "Back to form" control to return to the wizard without
 *                     losing anything.
 *
 * Both slots stay flex-col + md:flex-row capable inside the canvas branch so
 * StudioCanvas's own internal scrolling behaviour is unchanged.
 *
 * Props:
 *   view         — 'form' | 'canvas'
 *   sidebar      — ReactNode  the wizard (kept the historical prop name so the
 *                  root component/spec wiring stays stable)
 *   canvas       — ReactNode  StudioCanvas
 *   onBackToForm — () => void shown in the canvas view's top bar
 */
export function StudioShell({ view = 'form', sidebar, canvas, onBackToForm }) {
  if (view === 'canvas') {
    return (
      <div className="lps-game flex flex-col md:flex-row min-h-screen md:h-screen md:overflow-hidden bg-[#F5EFE1]">
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-[#e5ddd0] bg-[#F5EFE1] px-3 py-2">
            <button
              type="button"
              onClick={onBackToForm}
              className="lps-btn-ghost min-h-[40px] px-3 py-1.5 text-[12.5px]"
            >
              <ChevronLeft size={16} aria-hidden="true" />
              Back to form
            </button>
          </div>
          {canvas}
        </div>
      </div>
    )
  }

  return (
    <div className="lps-game flex flex-col min-h-screen bg-[#F5EFE1]">
      <div className="w-full">{sidebar}</div>
    </div>
  )
}
