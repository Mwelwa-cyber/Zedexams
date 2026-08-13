import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import useGlassTile from '../../../hooks/useGlassTile'
import '../../../shared/components/glassSurface.css'
import './teacherWorkspaceSection.css'

/**
 * The ONE studio card — a glass tile carrying the studio's artwork, its
 * badge, its name and its description. The desktop Teacher Workspace grid
 * and the mobile "All Teacher Tools" screen both render THIS; the mobile
 * screen used to have an icon-launcher of its own (a 4-column grid of big
 * icons with the name underneath), which is how the two surfaces came to
 * disagree about what a tool looks like.
 *
 * `compact` is the only difference between them, and it is sizing alone —
 * two columns on a phone rather than auto-filled 220px columns, smaller
 * type, tighter padding. The surface, the hover, the press, the sheen and
 * the badge shimmer are the glass recipe's in both.
 *
 * The artwork has NO container: it sits directly on the card under a radial
 * glow in the section's accent. A rounded box behind a cut-out icon puts a
 * second, harder-edged tile inside the glass one — the tile the artwork was
 * re-cut to stop drawing.
 */
export default function StudioCard({ studio, badge, pending = false, compact = false }) {
  const Icon = studio.icon
  const badgeLabel = badge ? `, ${badge.label}` : ''
  const tileRef = useGlassTile()
  return (
    <Link
      ref={tileRef}
      to={studio.route}
      className={`tws-card glass-tile${compact ? ' is-compact' : ''}`}
      aria-label={`${studio.title}${badgeLabel}. Open studio`}
    >
      <span className="glass-sheen" aria-hidden="true" />
      <span className="tws-card-top">
        <span
          className={`tws-card-icon ${
            studio.image ? 'is-img glass-artwork' : `tint-${studio.tint || 'teal'}`
          }`}
          aria-hidden="true"
        >
          {studio.image ? (
            <img
              className={studio.boxedArtwork ? 'is-boxed' : undefined}
              src={studio.image}
              alt=""
              loading="lazy"
              draggable="false"
            />
          ) : (
            <Icon size={22} strokeWidth={1.9} />
          )}
        </span>
        {pending ? (
          <span className="tws-pill is-skeleton" aria-hidden="true" />
        ) : badge?.type === 'saved' ? (
          <span className="tws-pill kind-saved" aria-hidden="true">{badge.count} SAVED</span>
        ) : badge?.type === 'new' ? (
          <span className="tws-pill kind-new glass-badge-shimmer" aria-hidden="true">NEW</span>
        ) : badge?.type === 'warning' ? (
          <span className="tws-dot" aria-hidden="true" />
        ) : null}
      </span>
      <span className="tws-card-title">{studio.title}</span>
      <span className="tws-card-desc">{studio.description}</span>
      {compact ? null : (
        <ArrowRight size={16} strokeWidth={2} className="tws-card-arrow" aria-hidden="true" />
      )}
    </Link>
  )
}
