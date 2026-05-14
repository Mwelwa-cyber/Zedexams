/**
 * Per-learner targeting inside a manual-mode assignment. Surfaces
 * the union of learners across the selected classes, with a search
 * box and a collapsible "by class" grouping.
 *
 * Empty selection = "everyone in the picked classes". The wizard
 * passes whatever is checked as `learnerUids` into the cloud
 * function, which scopes the assignment to those learners.
 *
 * Members are passed in pre-resolved (uid + displayName + email +
 * className) so this component doesn't fan out Firestore reads.
 */

import { useMemo, useState } from 'react'

export default function LearnerMultiSelect({
  members = [],
  selectedUids = [],
  onToggle,
  onSelectAll,
  onClear,
  loading = false,
  className = '',
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search) return members
    const needle = search.toLowerCase().trim()
    return members.filter((m) =>
      (m.displayName || '').toLowerCase().includes(needle)
      || (m.email || '').toLowerCase().includes(needle)
      || (m.className || '').toLowerCase().includes(needle),
    )
  }, [members, search])

  const selectedSet = new Set(selectedUids)
  const allSelected = filtered.length > 0 && filtered.every((m) => selectedSet.has(m.uid))

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex-1 min-w-[160px]">
          <span className="sr-only">Search learners</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search learners by name or email"
            className="w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={allSelected ? onClear : () => onSelectAll?.(filtered.map((m) => m.uid))}
          disabled={filtered.length === 0}
          className="rounded-full border theme-border theme-card px-3 py-1.5 text-xs font-black hover:theme-bg-subtle disabled:opacity-50"
        >
          {allSelected ? 'Clear' : 'Select all'}
        </button>
      </div>

      {selectedUids.length === 0 && (
        <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-800">
          Leave empty to assign to <strong>every learner</strong> in the picked classes.
        </p>
      )}

      <div className="theme-card theme-border rounded-2xl border overflow-hidden">
        {loading ? (
          <p className="p-6 text-center text-sm theme-text-muted">Loading learners…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-center text-sm theme-text-muted">
            {members.length === 0
              ? 'Pick at least one class first to see its learners.'
              : 'No learners match that search.'}
          </p>
        ) : (
          <ul className="divide-y divide-current/10 max-h-[280px] overflow-y-auto">
            {filtered.map((member) => {
              const isSelected = selectedSet.has(member.uid)
              return (
                <li key={member.uid}>
                  <label
                    className={[
                      'flex items-center gap-3 p-3 transition-colors min-h-[52px] cursor-pointer',
                      isSelected ? 'theme-accent-bg' : 'hover:theme-bg-subtle',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggle?.(member.uid)}
                      className="h-5 w-5 flex-shrink-0 rounded border-2 theme-border accent-current"
                      aria-label={member.displayName || member.email || member.uid}
                    />
                    <div className="flex-shrink-0 w-8 h-8 rounded-full theme-bg-subtle flex items-center justify-center text-xs font-black theme-text">
                      {(member.displayName || member.email || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="theme-text font-bold text-sm truncate">
                        {member.displayName || <span className="theme-text-muted italic">(name not set)</span>}
                      </p>
                      <p className="theme-text-muted text-xs truncate">
                        {member.email || member.uid}
                        {member.className ? ` · ${member.className}` : ''}
                      </p>
                    </div>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
