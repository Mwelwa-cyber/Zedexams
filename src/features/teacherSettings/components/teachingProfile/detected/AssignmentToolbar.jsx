import Icon from '../../../../../shared/components/Icon'
import { Search } from '../../../../../shared/components/icons'

/**
 * Summary row above the assignment list — "Teaching assignments found (N)" on
 * the left; live selected count + Select all / Clear all on the right — plus
 * compact search & filter controls when the list is long (> 8 assignments).
 * All counts are computed by the caller; nothing here is hard-coded.
 */
export default function AssignmentToolbar({
  totalCount,
  visibleCount,
  selectedCount,
  onSelectAll,
  onClearAll,
  showFilters = false,
  query,
  onQueryChange,
  gradeFilter,
  onGradeFilterChange,
  gradeOptions = [],
  curriculumFilter,
  onCurriculumFilterChange,
  curriculumOptions = [],
  onClearFilters,
}) {
  const filtersActive = !!(query || gradeFilter || curriculumFilter)
  return (
    <div className="tset-dta-toolbar">
      <div className="tset-dta-toolbar__summary">
        <h3 className="tset-dta-toolbar__found" id="tset-dta-found">
          Teaching assignments found ({totalCount})
        </h3>
        <div className="tset-dta-toolbar__selection">
          <span className="tset-dta-toolbar__count" aria-live="polite">
            {selectedCount === 0 ? 'No assignments selected' : `${selectedCount} selected`}
          </span>
          <button
            type="button"
            className="tset-dta-toolbar__action"
            onClick={onSelectAll}
            disabled={visibleCount === 0}
          >
            Select all
          </button>
          <span className="tset-dta-toolbar__sep" aria-hidden="true">·</span>
          <button
            type="button"
            className="tset-dta-toolbar__action"
            onClick={onClearAll}
            disabled={selectedCount === 0}
          >
            Clear all
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="tset-dta-toolbar__filters">
          <div className="tset-dta-toolbar__search">
            <Icon as={Search} size="sm" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search assignments"
              aria-label="Search assignments by grade, subject, curriculum or class"
            />
          </div>
          <label className="tset-dta-toolbar__filter">
            <span className="sr-only">Filter by grade</span>
            <select value={gradeFilter} onChange={(e) => onGradeFilterChange(e.target.value)} aria-label="Filter by grade">
              <option value="">All grades</option>
              {gradeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="tset-dta-toolbar__filter">
            <span className="sr-only">Filter by curriculum</span>
            <select value={curriculumFilter} onChange={(e) => onCurriculumFilterChange(e.target.value)} aria-label="Filter by curriculum">
              <option value="">All curricula</option>
              {curriculumOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          {filtersActive && (
            <button type="button" className="tset-dta-toolbar__clear" onClick={onClearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}
