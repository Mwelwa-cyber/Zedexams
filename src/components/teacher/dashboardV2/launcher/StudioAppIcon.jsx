import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'

const LONG_PRESS_MS = 480
const MOVE_TOLERANCE = 10

/**
 * A single studio rendered as an installed-app icon: a rounded-square tinted
 * icon tile with the studio name below and an optional status badge.
 *
 * Interaction:
 *  - tap / click / Enter → opens the studio directly (Link navigation);
 *    onOpen fires first so the launcher can record it as recent.
 *  - hover / keyboard focus (desktop) → onShowInfo(studio, element) so the
 *    launcher can float the info popover; onHideInfo on leave/blur.
 *  - press-and-hold (touch) → onLongPress(studio); the following click is
 *    suppressed so hold never also navigates.
 *
 * The whole cell is the touch target (min 72×88, enforced in CSS) and every
 * icon carries an aria-label that includes its badge, so status is never
 * conveyed by colour alone.
 */
export default function StudioAppIcon({
  studio,
  badge = null,
  pending = false,
  isFavourite = false,
  onOpen,
  onShowInfo,
  onHideInfo,
  onLongPress,
}) {
  const Icon = studio.icon
  const ref = useRef(null)
  const pressTimer = useRef(null)
  const suppressClick = useRef(false)
  const startPt = useRef(null)

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
    startPt.current = null
  }

  const onPointerDown = (e) => {
    // Only arm long-press for touch/pen — mouse users get the hover popover.
    if (e.pointerType === 'mouse') return
    startPt.current = { x: e.clientX, y: e.clientY }
    suppressClick.current = false
    pressTimer.current = setTimeout(() => {
      suppressClick.current = true
      onLongPress?.(studio)
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (e) => {
    if (!startPt.current) return
    const dx = Math.abs(e.clientX - startPt.current.x)
    const dy = Math.abs(e.clientY - startPt.current.y)
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) clearPress()
  }

  const handleClick = (e) => {
    if (suppressClick.current) {
      e.preventDefault()
      suppressClick.current = false
      return
    }
    onOpen?.(studio)
  }

  const badgeLabel = badge ? `, ${badge.label}` : ''
  const favLabel = isFavourite ? ', favourite' : ''

  return (
    <Link
      ref={ref}
      to={studio.route}
      className="tsl-app"
      aria-label={`${studio.title}${badgeLabel}${favLabel}. Open studio`}
      data-studio={studio.id}
      onClick={handleClick}
      onMouseEnter={() => onShowInfo?.(studio, ref.current)}
      onMouseLeave={() => onHideInfo?.(studio)}
      onFocus={() => onShowInfo?.(studio, ref.current)}
      onBlur={() => onHideInfo?.(studio)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(e) => {
        // Long-press on some touch browsers raises contextmenu — treat it as
        // the info gesture rather than a browser menu.
        if (onLongPress) {
          e.preventDefault()
          onLongPress(studio)
        }
      }}
    >
      <span
        className={`tsl-app-tile ${studio.image ? 'is-img' : `tint-${studio.tint || 'teal'}`}`}
        aria-hidden="true"
      >
        {studio.image ? (
          <img className="tsl-app-img" src={studio.image} alt="" loading="lazy" draggable="false" />
        ) : (
          <Icon size={24} strokeWidth={1.9} />
        )}
        {isFavourite ? (
          <span className="tsl-app-fav" aria-hidden="true">
            <Star size={11} strokeWidth={0} fill="currentColor" />
          </span>
        ) : null}
      </span>

      {pending ? (
        <span className="tsl-app-badge is-skeleton" aria-hidden="true" />
      ) : badge ? (
        <span className={`tsl-app-badge kind-${badge.type}`} aria-hidden="true">
          {badge.type === 'warning' ? <span className="tsl-badge-dot" /> : badge.label}
        </span>
      ) : null}

      <span className="tsl-app-name">{studio.title}</span>
    </Link>
  )
}
