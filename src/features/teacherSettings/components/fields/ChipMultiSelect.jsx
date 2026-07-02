import { useMemo, useState } from 'react'

// Searchable multi-select rendered as toggle chips (grades / subjects /
// languages). Options may be strings or { value, label }; a search box
// appears automatically once the list is long. `allowCustom` lets teachers
// add free-text values (streams like "5A") with Enter or the Add button.
export default function ChipMultiSelect({
  id,
  values = [],
  onChange,
  options = [],
  searchable = null, // default: options.length > 10
  allowCustom = false,
  customPlaceholder = 'Add…',
  maxValues = 20,
}) {
  const [query, setQuery] = useState('')
  const normalized = useMemo(
    () =>
      options.map((opt) =>
        typeof opt === 'string' ? { value: opt, label: opt } : opt,
      ),
    [options],
  )
  const showSearch = searchable ?? normalized.length > 10
  const q = query.trim().toLowerCase()
  const visible = q
    ? normalized.filter((o) => o.label.toLowerCase().includes(q))
    : normalized

  const toggle = (value) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value))
    } else if (values.length < maxValues) {
      onChange([...values, value])
    }
  }

  const addCustom = () => {
    const v = query.trim()
    if (!v) return
    if (!values.includes(v) && values.length < maxValues) onChange([...values, v])
    setQuery('')
  }

  // Selected free-text values that aren't in the option list still need a
  // removable chip (streams, custom languages).
  const customSelected = values.filter((v) => !normalized.some((o) => o.value === v))

  return (
    <div>
      {(showSearch || allowCustom) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            id={id}
            className="studio-input"
            type="text"
            value={query}
            placeholder={allowCustom ? customPlaceholder : 'Search…'}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (allowCustom && e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
          />
          {allowCustom && (
            <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={addCustom}>
              Add
            </button>
          )}
        </div>
      )}
      <div className="tset-chips">
        {visible.map((opt) => {
          const on = values.includes(opt.value)
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={on}
              className={`tset-chip${on ? ' tset-chip--on' : ''}`}
              onClick={() => toggle(opt.value)}
            >
              {opt.label}
              {on && <span aria-hidden="true">✓</span>}
            </button>
          )
        })}
        {customSelected.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed="true"
            className="tset-chip tset-chip--on"
            onClick={() => toggle(v)}
          >
            {v}
            <span aria-hidden="true">✕</span>
          </button>
        ))}
        {visible.length === 0 && customSelected.length === 0 && (
          <p className="tset-help" style={{ margin: 0 }}>No matches.</p>
        )}
      </div>
    </div>
  )
}
