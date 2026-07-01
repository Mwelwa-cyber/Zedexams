/**
 * StudioShell — layout wrapper for the Lesson Plan Studio.
 *
 * Responsive two-pane layout:
 *   - Desktop (md+): a full-height flex ROW — sidebar on the left, canvas on
 *     the right — each pane scrolling internally (h-screen + overflow-hidden).
 *   - Mobile (< md): a flex COLUMN — the form sidebar stacks ABOVE the canvas
 *     and the whole page scrolls naturally. The previous row-only layout kept
 *     the sidebar's min-width and squeezed the canvas (the generated plan) off
 *     the right edge of the phone, so the plan rendered but was invisible.
 *
 * Props:
 *   sidebar  — ReactNode  left/top panel (StudioSidebar)
 *   canvas   — ReactNode  right/bottom panel (StudioCanvas)
 */
export function StudioShell({ sidebar, canvas }) {
  return (
    <div className="lps-game flex flex-col md:flex-row min-h-screen md:h-screen md:overflow-hidden bg-[#F5EFE1]">
      {sidebar}
      {canvas}
    </div>
  )
}
