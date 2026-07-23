import { Star } from 'lucide-react'

/**
 * The pinned "Favourites" row on the launcher's default view — the payoff
 * for pinning a studio: it sits above Recently used, in the teacher's own
 * pin order. Hidden entirely while empty (the Favourites chip's empty state
 * teaches how to pin).
 */
export default function FavouriteStudios({ studios = [], columns = 8, renderIcon }) {
  if (!studios.length) return null
  return (
    <section className="tsl-recent tsl-favs" aria-labelledby="tsl-favs-h">
      <div className="tsl-recent-head">
        <Star size={15} strokeWidth={2} aria-hidden="true" />
        <span id="tsl-favs-h">Favourites</span>
      </div>
      <div className="tsl-grid" role="list" style={{ '--tsl-cols': columns }}>
        {studios.map((studio) => (
          <div role="listitem" key={studio.id} className="tsl-grid-cell">
            {renderIcon(studio)}
          </div>
        ))}
      </div>
    </section>
  )
}
