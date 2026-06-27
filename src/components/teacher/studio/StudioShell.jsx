/**
 * StudioShell — layout wrapper for the Lesson Plan Studio.
 *
 * Renders a full-screen flex row: the sidebar on the left and the canvas
 * on the right. Each child owns its own width and scroll behaviour.
 *
 * Props:
 *   sidebar  — ReactNode  left panel (StudioSidebar)
 *   canvas   — ReactNode  right panel (StudioCanvas)
 */
export function StudioShell({ sidebar, canvas }) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#faf7f2]">
      {sidebar}
      {canvas}
    </div>
  )
}
