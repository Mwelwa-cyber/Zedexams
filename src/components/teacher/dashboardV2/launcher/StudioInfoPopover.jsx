import { useLayoutEffect, useRef } from 'react'
import { ArrowRight, Clock, FolderOpen, Star } from 'lucide-react'

/**
 * Floating info card shown on desktop hover / keyboard focus of a studio
 * icon. Positioned by the launcher (fixed, viewport-clamped, edge-flipping —
 * see resolvePopoverPlacement); after first paint it reports its REAL size
 * via onMeasure so the launcher can re-clamp (the estimate can undershoot
 * near the bottom edge). Non-modal: it never traps focus and the icon
 * itself remains the primary open action; this card only adds context and
 * secondary actions.
 *
 * "View saved work" renders only when the studio has a savedWorkTo
 * destination — for hub studios (Curriculum, School Calendar, …) the studio
 * route IS the list, so the button would duplicate Open Studio.
 *
 * Everything here is available elsewhere (tap opens the studio, the badge
 * shows the count, the info sheet carries the same actions) so it satisfies
 * "tooltips must not hold essential, unavailable-elsewhere information".
 */
export default function StudioInfoPopover({
  studio,
  badge = null,
  savedCount = null,
  lastOpened = null,
  isFavourite = false,
  placement = { side: 'right', top: 0, left: 0 },
  onMeasure,
  onOpenStudio,
  onViewSaved,
  onToggleFavourite,
  onMouseEnter,
  onMouseLeave,
}) {
  const ref = useRef(null)

  // Report the rendered size once per studio so the launcher can correct
  // the placement if the height estimate was off (meta rows vary).
  useLayoutEffect(() => {
    if (!ref.current || !onMeasure) return
    const rect = ref.current.getBoundingClientRect()
    onMeasure({ width: Math.round(rect.width), height: Math.round(rect.height) })
  }, [studio, onMeasure])

  if (!studio) return null
  const Icon = studio.icon
  const savedText = typeof savedCount === 'number' ? `${savedCount} saved` : null

  return (
    <div
      ref={ref}
      className={`tsl-pop side-${placement.side}`}
      style={{ top: placement.top, left: placement.left }}
      role="dialog"
      aria-label={`${studio.title} — details`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="tsl-pop-head">
        <span
          className={`tsl-app-tile ${studio.image ? 'is-img' : `tint-${studio.tint || 'teal'}`}`}
          aria-hidden="true"
        >
          {studio.image ? (
            <img className="tsl-app-img" src={studio.image} alt="" loading="lazy" />
          ) : (
            <Icon size={22} strokeWidth={1.9} />
          )}
        </span>
        <div className="tsl-pop-heading">
          <span className="tsl-pop-title">{studio.title}</span>
          {badge?.type === 'new' ? <span className="tsl-pop-tag">New</span> : null}
        </div>
      </div>

      <p className="tsl-pop-desc">{studio.description}</p>

      {savedText || lastOpened ? (
        <div className="tsl-pop-meta">
          {savedText ? (
            <span className="tsl-pop-metaitem">
              <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
              {savedText}
            </span>
          ) : null}
          {lastOpened ? (
            <span className="tsl-pop-metaitem">
              <Clock size={14} strokeWidth={2} aria-hidden="true" />
              Last opened: {lastOpened}
            </span>
          ) : null}
        </div>
      ) : null}

      <button type="button" className="tsl-pop-primary" onClick={() => onOpenStudio?.(studio)}>
        Open Studio
        <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
      </button>

      <div className="tsl-pop-actions">
        {studio.savedWorkTo ? (
          <button type="button" className="tsl-pop-secondary" onClick={() => onViewSaved?.(studio)}>
            <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
            View saved work
          </button>
        ) : null}
        <button
          type="button"
          className={`tsl-pop-fav ${isFavourite ? 'is-on' : ''}`}
          aria-pressed={isFavourite}
          onClick={() => onToggleFavourite?.(studio)}
        >
          <Star size={14} strokeWidth={2} fill={isFavourite ? 'currentColor' : 'none'} aria-hidden="true" />
          {isFavourite ? 'Favourited' : 'Add to favourites'}
        </button>
      </div>
    </div>
  )
}
