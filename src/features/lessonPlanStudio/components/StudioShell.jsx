import { ChevronLeft } from 'lucide-react'

/**
 * StudioShell — layout wrapper for the Lesson Plan Studio.
 *
 * Renders INSIDE the TeacherLayout dashboard shell (V2 sidebar + top bar) —
 * it must never bring its own full-page chrome, duplicate the dashboard
 * navigation, or lock the whole viewport to the screen height (pinned by
 * scripts/test-lesson-plan-routing.mjs).
 *
 * Two mutually exclusive views under a shared studio header:
 *
 *   - view="form"   → the five-step creation wizard fills the content column
 *                     and the page scrolls naturally. No canvas is rendered at
 *                     all, so the teacher never scrolls past an empty
 *                     "waiting" panel while entering information.
 *   - view="canvas" → the document canvas (generation progress, the finished
 *                     plan, editor + export actions) fills a bounded pane
 *                     sized to the viewport below the dashboard top bar
 *                     (md+ scrolls internally; phones scroll the page), with
 *                     a "Back to form" control to return to the wizard
 *                     without losing anything.
 *
 * Props:
 *   view         — 'form' | 'canvas'
 *   header       — ReactNode  studio header row (eyebrow / title / autosave / back)
 *   sidebar      — ReactNode  the wizard (kept the historical prop name so the
 *                  root component/spec wiring stays stable)
 *   canvas       — ReactNode  StudioCanvas
 *   onBackToForm — () => void shown in the canvas view's top bar
 */
export function StudioShell({ view = 'form', header = null, sidebar, canvas, onBackToForm }) {
  if (view === 'canvas') {
    return (
      <div className="lps-game mx-auto w-full max-w-[1440px] px-3 sm:px-4">
        {header}
        <div className="lps-shell-row flex flex-col md:flex-row md:items-stretch bg-[#F5EFE1] md:h-[calc(100dvh-13.5rem)] md:min-h-[540px] md:overflow-hidden md:rounded-[20px] md:border md:border-[#e5ddd0] md:shadow-[0_1px_2px_rgba(16,36,62,0.05),0_6px_18px_rgba(16,36,62,0.06)]">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-[#e5ddd0] bg-[#F5EFE1] px-3 py-2">
              <button
                type="button"
                onClick={onBackToForm}
                aria-label="Back to form — return to the lesson plan wizard"
                className="lps-btn-ghost min-h-[44px] px-3 py-1.5 text-[12.5px]"
              >
                <ChevronLeft size={16} aria-hidden="true" />
                Back to form
              </button>
            </div>
            {canvas}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="lps-game mx-auto w-full max-w-[1440px] px-3 sm:px-4">
      {header}
      <div className="w-full">{sidebar}</div>
    </div>
  )
}
