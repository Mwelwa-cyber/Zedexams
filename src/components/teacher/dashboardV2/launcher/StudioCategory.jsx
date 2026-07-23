import { ChevronDown } from 'lucide-react'

/**
 * A workspace category: a header row (label + tool count) and the
 * responsive app-icon grid. Real categories collapse/expand (state owned by
 * the launcher, persisted per device); transient result sections (search,
 * chips, category filter) pass collapsible={false} and render a static
 * header — collapsing "Search results" would just hide what the teacher
 * asked for.
 *
 * `columns` drives the CSS grid via a custom property so the exact column
 * count per breakpoint is decided in JS but rendered without layout thrash.
 * `renderIcon(studio)` is supplied by the launcher so all the shared
 * interaction handlers live in one place.
 */
export default function StudioCategory({
  id,
  label,
  studios = [],
  columns = 6,
  collapsible = true,
  collapsed = false,
  onToggle,
  renderIcon,
}) {
  if (!studios.length) return null
  const bodyId = `tsl-cat-${id}`
  const headContent = (
    <>
      <span className="tsl-cat-title" id={`${bodyId}-h`}>{label}</span>
      <span className="tsl-cat-count">{studios.length}</span>
    </>
  )
  return (
    <section className="tsl-cat" aria-labelledby={`${bodyId}-h`}>
      {collapsible ? (
        <button
          type="button"
          className="tsl-cat-head"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => onToggle?.(id)}
        >
          {headContent}
          <ChevronDown
            size={18}
            strokeWidth={2}
            className={`tsl-cat-chev ${collapsed ? 'is-collapsed' : ''}`}
            aria-hidden="true"
          />
        </button>
      ) : (
        <div className="tsl-cat-head is-static">{headContent}</div>
      )}

      {!collapsed ? (
        <div
          className="tsl-grid"
          id={bodyId}
          role="list"
          style={{ '--tsl-cols': columns }}
        >
          {studios.map((studio) => (
            <div role="listitem" key={studio.id} className="tsl-grid-cell">
              {renderIcon(studio)}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
