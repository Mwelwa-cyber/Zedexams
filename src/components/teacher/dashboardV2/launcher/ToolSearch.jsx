import { Search, X } from 'lucide-react'

/**
 * Controlled search field for the launcher. Purely presentational — the
 * launcher owns the query state and does the actual filtering through the
 * pure searchStudios helper.
 */
export default function ToolSearch({ value, onChange, resultCount = null }) {
  return (
    <div className="tsl-search" role="search">
      <Search size={18} strokeWidth={2} aria-hidden="true" />
      <input
        type="search"
        className="tsl-search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search teacher tools"
        aria-label="Search teacher tools"
        // Native clear is inconsistent; we render our own below.
        autoComplete="off"
        spellCheck={false}
      />
      {value ? (
        <>
          <span className="tsl-search-count" aria-live="polite">
            {resultCount} result{resultCount === 1 ? '' : 's'}
          </span>
          <button type="button" className="tsl-search-clear" aria-label="Clear search" onClick={() => onChange('')}>
            <X size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </>
      ) : null}
    </div>
  )
}
