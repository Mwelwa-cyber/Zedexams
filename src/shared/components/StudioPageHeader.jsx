import { Link } from 'react-router-dom'
import Icon from '../../components/ui/Icon'
import { ChevronLeft, Sparkles } from '../../components/ui/icons'

/**
 * StudioPageHeader — the ONE header band for every teacher studio page.
 *
 * The rules it encodes (agreed in the 2026-08 consistency pass):
 *   - eyebrow = the Teacher Workspace CATEGORY (PLANNING / TEACHING MATERIALS /
 *     ASSESSMENT / CLASS ADMINISTRATION), never the studio's own name.
 *   - title = the studio name, in the serif display face (the only serif on
 *     the page).
 *   - description = one sentence max — long feature lists go in `metaItems`.
 *   - `icon` is a Lucide component drawn teal-on-white in a round tile.
 *     Emoji and mascots are learner-side only; `emoji` remains for studios
 *     not yet converted and renders the legacy 92px medallion.
 *   - Passing `icon` also switches the band to the compact treatment
 *     (~130px tall) so content is visible without scrolling on a laptop.
 *
 * Styles live in index.css under `.studio-page-header`.
 */
export default function StudioPageHeader({
  eyebrow,
  title,
  subtitle,
  emoji,
  icon: HeaderIcon = null,
  metaItems = null,
  primaryAction = null,
  backTo = '/teacher',
  backLabel = 'Studios',
  rightSlot = null,
}) {
  const compact = Boolean(HeaderIcon)
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <Link to={backTo} className="studio-backlink">
          <Icon as={ChevronLeft} size="xs" />
          {backLabel}
        </Link>
        {rightSlot}
      </div>
      <div className={`studio-page-header${compact ? ' studio-page-header--compact' : ''}`}>
        <div className="studio-page-header__body">
          {eyebrow && (
            <span className="studio-page-header__eyebrow">
              <Icon as={Sparkles} size="xs" />
              {eyebrow}
            </span>
          )}
          <h1 className="studio-display studio-page-header__title">{title}</h1>
          {subtitle && <p className="studio-page-header__subtitle">{subtitle}</p>}
          {Array.isArray(metaItems) && metaItems.length > 0 && (
            <div className="studio-page-header__meta">
              {metaItems.map((item, i) => (
                <span key={item}>
                  {i > 0 && (
                    <span aria-hidden="true" className="studio-page-header__meta-dot">
                      ·
                    </span>
                  )}
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
        {HeaderIcon && (
          <div className="studio-page-header__icon" aria-hidden="true">
            <HeaderIcon size={27} strokeWidth={2} />
          </div>
        )}
        {!HeaderIcon && emoji && (
          <div className="studio-page-header__emoji" aria-hidden="true">
            {emoji}
          </div>
        )}
        {primaryAction}
      </div>
    </div>
  )
}
