import { memo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'

const LONG_PRESS_MS = 480
const MOVE_TOLERANCE = 10

/**
 * A single studio rendered as an installed-app icon: the bespoke artwork
 * (or a rounded tinted Lucide tile as fallback) with the studio name below
 * and an optional status badge.
 *
 * Interaction:
 *  - tap / click / Enter → opens the studio directly (Link navigation);
 *    onOpen fires first so the launcher can record it as recent.
 *  - hover / keyboard focus (desktop) → onShowInfo(studio, element) so the
 *    launcher can float the info popover; onHideInfo on leave/blur.
 *  - press-and-hold (touch/pen) → onLongPress(studio); the follow-up click
 *    is suppressed so hold never also navigates. Mouse right-click keeps
 *    the NATIVE context menu (open in new tab etc.) — only touch-originated
 *    contextmenu events are treated as the info gesture.
 *  - Shift+F10 / the ContextMenu key → onLongPress(studio) too, so
 *    keyboard-only users reach favourites + saved work through the
 *    focus-trapped info sheet.
 *
 * The whole cell is the touch target (min 72×88, enforced in CSS) and the
 * aria-label includes the badge, so status is never conveyed by colour
 * alone. Memoised — the launcher passes stable handlers so grid-wide
 * re-renders (search keystrokes, count updates) skip unchanged icons.
 */
function StudioAppIcon({
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
  const lastPointerType = useRef('mouse')

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
    startPt.current = null
  }

  const onPointerDown = (e) => {
    lastPointerType.current = e.pointerType || 'mouse'
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

  const handleKeyDown = (e) => {
    // The standard context-menu keyboard gesture opens the info sheet, the
    // only place keyboard users can favourite / jump to saved work.
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      onLongPress?.(studio)
    }
  }

  const handleContextMenu = (e) => {
    // Android long-press raises contextmenu — treat it as the info gesture.
    // A mouse right-click keeps the browser's own menu.
    if (lastPointerType.current !== 'mouse' && onLongPress) {
      e.preventDefault()
      onLongPress(studio)
    }
  }

  const badgeLabel = badge ? `, ${badge.label}` : ''
  const favLabel = isFavourite ? ', favourite' : ''

  return (
    <Link
      ref={ref}
      to={studio.route}
      className="tsl-app"
      aria-label={`${studio.title}${badgeLabel}${favLabel}. Open studio`}
      aria-keyshortcuts="Shift+F10"
      data-studio={studio.id}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => onShowInfo?.(studio, ref.current)}
      onMouseLeave={() => onHideInfo?.(studio)}
      onFocus={() => onShowInfo?.(studio, ref.current, { immediate: true })}
      onBlur={() => onHideInfo?.(studio)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={handleContextMenu}
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

export default memo(StudioAppIcon)
