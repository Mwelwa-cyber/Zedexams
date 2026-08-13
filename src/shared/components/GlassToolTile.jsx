import useGlassTile from '../../hooks/useGlassTile'
import './glassSurface.css'

/**
 * The ONE compact tool visual — the studio's 3D artwork (or its Lucide icon
 * on a tinted chip) plus the optional NEW badge. Used by Recently Used and
 * the Quick Create sheet, where a tool is an icon with its name beneath it.
 * The full card — icon, badge, name, description — is `StudioCard`, which
 * both the desktop workspace and All Teacher Tools render.
 *
 * The artwork has NO container behind it. It is a transparent cut-out, and a
 * rounded box behind a cut-out is a second, harder-edged tile inside the
 * glass one — the tile the icons were re-cut to stop drawing. It floats on
 * the surface under a radial glow in the studio's own section accent, via
 * the shared `glass-artwork` mount. `studio.boxedArtwork` marks the one file
 * that still has its background baked in; that mount clips it instead.
 *
 * A studio with no artwork keeps its tinted Lucide chip — a glyph needs a
 * ground to read against in a way a rendered illustration does not — and
 * that chip keeps the glass tile behind it.
 *
 * The whole thing is decorative (`aria-hidden`); the accessible name lives
 * on the Link that wraps it.
 *
 * `sheen` is on for scrollable grids and OFF inside the Quick Create bottom
 * sheet — the sheet remounts on every open, and a sweep replaying each time
 * would break "once per tile per page load".
 */
export default function GlassToolTile({
  studio,
  badge = null,
  sizeClass,
  iconSize = 26,
  sheen = true,
  press = true,
}) {
  const StudioIcon = studio.icon
  const category = studio.category || 'more'
  // Artwork floats bare, so it has no surface to sweep or press; the sheen
  // and press feedback belong to the tinted chip that does have one.
  const bare = Boolean(studio.image)
  const tileRef = useGlassTile({ sheen: sheen && !bare, press: press && !bare })
  return (
    <span
      ref={tileRef}
      className={
        bare
          ? `glass-artwork glass-accent--${category} tdv2m-glass-tile is-bare ${sizeClass || ''}`
          : `glass-tile glass-accent--${category} tdv2m-glass-tile ${sizeClass || ''}`
      }
      aria-hidden="true"
    >
      {sheen && !bare ? <span className="glass-sheen" /> : null}
      {studio.image ? (
        <img
          className={studio.boxedArtwork ? 'is-boxed' : undefined}
          src={studio.image}
          alt=""
          loading="lazy"
          draggable="false"
        />
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
