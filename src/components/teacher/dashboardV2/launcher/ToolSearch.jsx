import { Search, X } from 'lucide-react'

/**
 * Controlled search field for the launcher. Purely presentational — the
 * launcher owns the query state and does the actual filtering through the
 * pure searchStudios helper. Enter opens the top result (Spotlight-style)
 * via onSubmit; Escape clears the query without leaving the field.
 */
export default function ToolSearch({ value, onChange, onSubmit, resultCount = null }) {
  return (
    <div className="tsl-search" role="search">
      <Search size={18} strokeWidth={2} aria-hidden="true" />
      <input
        type="search"
        className="tsl-search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit?.()
          } else if (e.key === 'Escape' && value) {
            e.stopPropagation()
            onChange('')
          }
        }}
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
