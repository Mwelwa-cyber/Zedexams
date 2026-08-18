/**
 * Breaks a child out of the page's padded column to the full viewport width.
 */

/**
 * Breaks a child out of its max-width column to span the full viewport
 * width, so an opened paper fills the whole screen edge-to-edge instead
 * of sitting in a narrow centred strip. Capped on very wide desktops so
 * a single scanned page doesn't blow up past readability; the root
 * viewer uses `overflow-x-clip` so the 100vw breakout can't introduce a
 * horizontal scrollbar.
 */
function FullBleed({ children }) {
  // Break out to the full viewport on phone / tablet so a scanned page
  // fills the screen; on desktop (lg+) the viewer lives inside its
  // three-pane column, so the breakout is disabled to leave room for
  // the right rail.
  return (
    <div className="relative left-1/2 right-1/2 w-screen -translate-x-1/2 lg:left-auto lg:right-auto lg:mx-0 lg:w-full lg:translate-x-0">
      <div className="mx-auto max-w-[1400px] px-1 sm:px-3 lg:px-0">{children}</div>
    </div>
  )
}

export default FullBleed
