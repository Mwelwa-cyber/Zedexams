/**
 * StudioShell — layout wrapper for the Lesson Plan Studio.
 *
 * Renders INSIDE the TeacherLayout dashboard shell (V2 sidebar + top bar) —
 * it must never bring its own full-page chrome, duplicate the dashboard
 * navigation, or lock the whole viewport the way the old standalone
 * full-screen page did.
 *
 * Responsive two-pane layout:
 *   - Desktop (md+): a bounded flex ROW — form panel left, live preview
 *     right — sized to the viewport space below the dashboard top bar. Each
 *     pane scrolls internally, so the studio is the single scroll area: the
 *     dashboard sidebar never scrolls with the form, and the form and
 *     preview never create competing full-page scrollbars.
 *   - Mobile (< md): a flex COLUMN — the form stacks ABOVE the preview and
 *     the page scrolls naturally under the dashboard's mobile chrome.
 *
 * Props:
 *   header  — ReactNode  studio header row (eyebrow / title / autosave / back)
 *   sidebar — ReactNode  left/top panel (StudioSidebar)
 *   canvas  — ReactNode  right/bottom panel (StudioCanvas)
 */
export function StudioShell({ header = null, sidebar, canvas }) {
  return (
    <div className="lps-game mx-auto w-full max-w-[1440px]">
      {header}
      <div
        className="lps-shell-row flex flex-col md:flex-row md:items-stretch bg-[#F5EFE1] md:h-[calc(100dvh-13.5rem)] md:min-h-[540px] md:overflow-hidden md:rounded-[20px] md:border md:border-[#e5ddd0] md:shadow-[0_1px_2px_rgba(16,36,62,0.05),0_6px_18px_rgba(16,36,62,0.06)]"
      >
        {sidebar}
        {canvas}
      </div>
    </div>
  )
}
