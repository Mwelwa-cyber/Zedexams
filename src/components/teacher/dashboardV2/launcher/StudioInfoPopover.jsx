import { ArrowRight, Clock, FolderOpen, Star } from 'lucide-react'

/**
 * Floating info card shown on desktop hover / keyboard focus of a studio
 * icon. Positioned by the launcher (fixed, viewport-clamped, edge-flipping —
 * see resolvePopoverPlacement). Non-modal: it never traps focus and the icon
 * itself remains the primary open action; this card only adds context and
 * secondary actions.
 *
 * Everything it shows is available elsewhere (the icon opens the studio, the
 * badge shows the count) so it satisfies "tooltips must not hold essential,
 * unavailable-elsewhere information".
 */
export default function StudioInfoPopover({
  studio,
  badge = null,
  savedCount = null,
  lastOpened = null,
  isFavourite = false,
  placement = { side: 'right', top: 0, left: 0 },
  onOpenStudio,
  onViewSaved,
  onToggleFavourite,
  onMouseEnter,
  onMouseLeave,
}) {
  if (!studio) return null
  const Icon = studio.icon
  const savedText = typeof savedCount === 'number' ? `${savedCount} saved` : null

  return (
    <div
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

      <button type="button" className="tsl-pop-primary" onClick={() => onOpenStudio?.(studio)}>
        Open Studio
        <ArrowRight size={15} strokeWidth={2.2} aria-hidden="true" />
      </button>

      <div className="tsl-pop-actions">
        <button type="button" className="tsl-pop-secondary" onClick={() => onViewSaved?.(studio)}>
          <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
          View saved work
        </button>
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
