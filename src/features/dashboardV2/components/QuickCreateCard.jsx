import { Link } from 'react-router-dom'
import { ArrowRight, ClipboardList } from 'lucide-react'
import { QUICK_CREATE_TILES, QUICK_CREATE_TILE_COUNT } from '../../../components/teacher/dashboardV2/dashboardV2Config'
import useStudioAvailability from '../../../hooks/useStudioAvailability'
import useGlassTile from '../../../hooks/useGlassTile'
import '../../../components/teacher/dashboardV2/glassSurface.css'

/* Full glass tile, accented by the tile's existing tone family so nothing
   shifts hue (coral, teal, green, blue). */
function QuickCreateTile({ tile }) {
  const tileRef = useGlassTile()
  const TileIcon = tile.icon
  return (
    <Link
      ref={tileRef}
      to={tile.to}
      className={`tdv2-tile glass-tile glass-accent--tone-${tile.tone}`}
    >
      <span className="glass-sheen" aria-hidden="true" />
      <span className={`tdv2-tile-icon tone-${tile.tone}`} aria-hidden="true">
        <TileIcon size={22} strokeWidth={1.75} />
      </span>
      <span className="tdv2-tile-title">{tile.title}</span>
      <span className="tdv2-tile-desc">{tile.description}</span>
      <span className="tdv2-tile-arrow" aria-hidden="true">
        <ArrowRight size={16} strokeWidth={2} />
      </span>
    </Link>
  )
}

export default function QuickCreateCard({ onViewAllTools }) {
  const { filterEntries } = useStudioAvailability()
  // Five declared, four shown — see QUICK_CREATE_TILES.
  const tiles = filterEntries(QUICK_CREATE_TILES).slice(0, QUICK_CREATE_TILE_COUNT)
  return (
    <section
      className="tdv2-card glass-panel glass-panel--create"
      aria-labelledby="tdv2-quick-create-h"
      data-tour="quick-create"
    >
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-quick-create-h">
          <ClipboardList size={17} strokeWidth={2} aria-hidden="true" />
          Quick Create
        </h2>
        {onViewAllTools ? (
          <button type="button" className="tdv2-link-action" onClick={onViewAllTools}>
            View all teacher tools
            <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : (
          <Link className="tdv2-link-action" to="/teacher/library">
            View all teacher tools
            <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className="tdv2-tile-grid">
        {tiles.map((tile) => (
          <QuickCreateTile key={tile.id} tile={tile} />
        ))}
      </div>
    </section>
  )
}
