import useGlassTile from '../../../hooks/useGlassTile'
import './glassSurface.css'

/**
 * The ONE mobile tool-tile visual — the square glass tile with the studio's
 * 3D artwork (or its Lucide icon on a tinted chip) and the optional NEW
 * badge. Used by Recently Used, the All Teacher Tools screen and the Quick
 * Create sheet, so the glass recipe exists in exactly one place; each
 * surface supplies only its own sizing class (`tdv2m-recent-tile`, …).
 *
 * The whole tile is decorative (`aria-hidden`) — the accessible name lives
 * on the Link that wraps it, exactly as before. The accent the press tint
 * and hover ring use comes from the studio's category via a
 * glass-accent-- class, so a Planning tool presses peach here and in the
 * desktop workspace alike.
 *
 * `sheen` is on for scrollable tool grids and OFF for tiles inside the
 * Quick Create bottom sheet — the sheet remounts on every open, and a
 * sweep replaying on each open would break "once per tile per page load".
 */
export default function GlassToolTile({
  studio,
  badge = null,
  sizeClass,
  iconSize = 26,
  sheen = true,
  press = true,
}) {
  const tileRef = useGlassTile({ sheen, press })
  const StudioIcon = studio.icon
  const category = studio.category || 'more'
  return (
    <span
      ref={tileRef}
      className={`glass-tile glass-accent--${category} tdv2m-glass-tile ${sizeClass || ''}`}
      aria-hidden="true"
    >
      {sheen ? <span className="glass-sheen" /> : null}
      {studio.image ? (
        <img src={studio.image} alt="" loading="lazy" draggable="false" />
      ) : StudioIcon ? (
        <span className={`tdv2m-glass-chip tint-${studio.tint || 'teal'}`}>
          <StudioIcon size={iconSize} strokeWidth={1.9} />
        </span>
      ) : null}
      {badge?.type === 'new' ? (
        <span className="tdv2m-tool-new glass-badge-shimmer">New</span>
      ) : null}
    </span>
  )
}
