/**
 * ZoomControl — the floating zoom pill for a past-paper reading surface.
 *
 * Pinch is the gesture people reach for, but it is not discoverable and it is
 * awkward one-handed on a phone held at the bottom, so the paper also needs a
 * control you can SEE. This is that control: a thumb-reachable glass pill in
 * the corner, above the page dock, carrying +, the current zoom, − and (once
 * the paper is off fit-to-width) a Fit button so a learner who zoomed by
 * accident always has a way back.
 *
 * It is deliberately not another row inside {@link ./GlassPageNavigation}:
 * that dock is already four controls wide at `max-w-sm`, and page navigation
 * and magnification are different jobs — merging them would shrink the 52px
 * page arrows on exactly the small screens they exist for.
 *
 * Presentational: the owning viewer holds the zoom, because the zoom is what
 * its layout is built from.
 */

import { Maximize2, ZoomIn, ZoomOut } from './icons'
import { isFitZoom, MAX_ZOOM, MIN_ZOOM } from '../utils/pinchZoomCore'

export default function ZoomControl({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  /**
   * Distance from the bottom of the viewport, in px, before the safe-area
   * inset. The bottom-right corner is contested — the glass page dock on PDF
   * papers, the back-to-top FAB on image papers, the reader's own action bar
   * in fullscreen — so the caller, which knows what else it has mounted, says
   * where the pill goes rather than this component guessing.
   */
  bottomPx = 16,
  /** Rendered inside the fullscreen reader, which sits at z-60. */
  zIndexClass = 'z-40',
  label = 'Zoom',
}) {
  const atFit = isFitZoom(zoom)
  const buttonClass =
    'inline-flex items-center justify-center w-11 h-11 rounded-2xl theme-text transition ' +
    'active:scale-95 hover:bg-black/5 disabled:opacity-40 disabled:pointer-events-none ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'

  return (
    <div
      className={`fixed right-3 ${zIndexClass} pointer-events-none`}
      style={{ bottom: `calc(${bottomPx}px + env(safe-area-inset-bottom))` }}
    >
      <div
        role="group"
        aria-label={label}
        className="zx-glass-dock pointer-events-auto flex flex-col items-center gap-0.5 px-1 py-1.5"
      >
        <button
          type="button"
          onClick={onZoomIn}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          className={buttonClass}
        >
          <ZoomIn size={20} strokeWidth={2.4} />
        </button>
        {/* The percentage is a readout, not a control: it tells a learner who
            pinched by accident what happened, and names what Fit resets to. */}
        <span className="text-[10px] font-black theme-text-muted tabular-nums leading-none py-0.5">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={onZoomOut}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
          className={buttonClass}
        >
          <ZoomOut size={20} strokeWidth={2.4} />
        </button>
        {!atFit && (
          <button
            type="button"
            onClick={onFit}
            aria-label="Fit the page to the screen"
            className={buttonClass}
          >
            <Maximize2 size={18} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  )
}
