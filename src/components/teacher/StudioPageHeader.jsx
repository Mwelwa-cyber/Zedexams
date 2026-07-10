import { Link } from 'react-router-dom'
import Icon from '../ui/Icon'
import { ChevronLeft, Sparkles } from '../ui/icons'

/**
 * Shared header for teacher studio pages — keeps the same look as
 * the dashboard hero/eyebrow combo. Place this at the top of any
 * generator/view page so the whole teacher section feels unified.
 * Styles live in index.css under `.studio-page-header`.
 */
export default function StudioPageHeader({
  eyebrow,
  title,
  subtitle,
  emoji,
  backTo = '/teacher',
  backLabel = 'Studios',
  rightSlot = null,
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <Link to={backTo} className="studio-backlink">
          <Icon as={ChevronLeft} size="xs" />
          {backLabel}
        </Link>
        {rightSlot}
      </div>
      <div className="studio-page-header">
        <div className="studio-page-header__body">
          {eyebrow && (
            <span className="studio-page-header__eyebrow">
              <Icon as={Sparkles} size="xs" />
              {eyebrow}
            </span>
          )}
          <h1 className="studio-display studio-page-header__title">{title}</h1>
          {subtitle && <p className="studio-page-header__subtitle">{subtitle}</p>}
        </div>
        {emoji && (
          <div className="studio-page-header__emoji" aria-hidden="true">
            {emoji}
          </div>
        )}
      </div>
    </div>
  )
}
