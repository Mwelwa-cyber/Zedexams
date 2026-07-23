import { Clock } from 'lucide-react'

/**
 * The "Recently used" row of app icons (capped per breakpoint by the
 * launcher). Hidden entirely when there is no history yet, so it never
 * shows an empty shell.
 */
export default function RecentStudios({ studios = [], columns = 8, renderIcon }) {
  if (!studios.length) return null
  return (
    <section className="tsl-recent" aria-labelledby="tsl-recent-h">
      <div className="tsl-recent-head">
        <Clock size={15} strokeWidth={2} aria-hidden="true" />
        <span id="tsl-recent-h">Recently used</span>
      </div>
      <div className="tsl-grid" role="list" style={{ '--tsl-cols': columns }}>
        {studios.map((studio) => (
          <div role="listitem" key={studio.id} className="tsl-grid-cell">
            {renderIcon(studio, 'recent')}
          </div>
        ))}
      </div>
    </section>
  )
}
