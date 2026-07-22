import { Link } from 'react-router-dom'
import { ArrowRight, ClipboardList } from 'lucide-react'
import { QUICK_CREATE_TILES } from './dashboardV2Config'

export default function QuickCreateCard() {
  return (
    <section className="tdv2-card" aria-labelledby="tdv2-quick-create-h">
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-quick-create-h">
          <ClipboardList size={17} strokeWidth={2} aria-hidden="true" />
          Quick Create
        </h2>
        <Link className="tdv2-link-action" to="/teacher/library">
          View all teacher tools
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
      <div className="tdv2-tile-grid">
        {QUICK_CREATE_TILES.map(({ id, title, description, icon: TileIcon, to, tone }) => (
          <Link key={id} to={to} className="tdv2-tile">
            <span className={`tdv2-tile-icon tone-${tone}`} aria-hidden="true">
              <TileIcon size={22} strokeWidth={1.75} />
            </span>
            <span className="tdv2-tile-title">{title}</span>
            <span className="tdv2-tile-desc">{description}</span>
            <span className="tdv2-tile-arrow" aria-hidden="true">
              <ArrowRight size={16} strokeWidth={2} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
