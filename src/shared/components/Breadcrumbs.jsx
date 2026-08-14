import { Link } from 'react-router-dom'
import { ChevronRight } from './icons'

/**
 * Breadcrumbs — `Admin / Quizzes / Edit "Grade 5 Math Test"`.
 *
 * Pass an array of `{ label, to? }`. Items with `to` render as Links;
 * the last item renders as the current page (bold, no link).
 */
export default function Breadcrumbs({ items = [], className = '' }) {
  if (!items.length) return null
  const last = items.length - 1
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center gap-1 text-body-sm theme-text-muted ${className}`}
    >
      {items.map((item, i) => {
        const isLast = i === last
        return (
          <span key={`${item.label}-${i}`} className="flex items-center gap-1 min-w-0">
            {item.to && !isLast ? (
              <Link
                to={item.to}
                className="truncate hover:theme-text transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={`truncate ${isLast ? 'theme-text font-bold' : ''}`}
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
            {!isLast && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
            )}
          </span>
        )
      })}
    </nav>
  )
}
