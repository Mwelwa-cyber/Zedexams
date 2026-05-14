/**
 * Multi-select panel for the teacher's classes. Shows the matching
 * count against an optional grade/subject filter so an auto-mode
 * teacher can see "12 of 15 classes will be assigned" before
 * committing.
 *
 * Renders a search box, "Select all" / "Clear" actions, and one row
 * per class with a checkbox + subject icon + learner count. Rows that
 * already have this quiz assigned are visually muted and disabled.
 *
 * Pure presentational; the wizard owns the selectedIds set.
 */

import { useMemo, useState } from 'react'
import { SUBJECTS } from '../../../config/curriculum'
import SubjectIcon from '../../ui/SubjectIcon'

export default function ClassMultiSelect({
  classes = [],
  selectedIds = [],
  onToggle,
  onSelectAll,
  onClear,
  disabledIds = [],
  emptyMessage = 'No classes match this filter.',
  className = '',
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search) return classes
    const needle = search.toLowerCase().trim()
    return classes.filter((c) =>
      (c.name || '').toLowerCase().includes(needle)
      || String(c.grade || '').toLowerCase().includes(needle)
      || (c.subject || '').toLowerCase().includes(needle)
      || (c.school || '').toLowerCase().includes(needle),
    )
  }, [classes, search])

  const selectedSet = new Set(selectedIds)
  const disabledSet = new Set(disabledIds)
  const eligible = filtered.filter((c) => !disabledSet.has(c.id))
  const allSelected = eligible.length > 0 && eligible.every((c) => selectedSet.has(c.id))

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex-1 min-w-[160px]">
          <span className="sr-only">Search classes</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, grade, or school"
            className="w-full rounded-xl border-2 theme-border theme-input px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={allSelected ? onClear : () => onSelectAll?.(eligible.map((c) => c.id))}
          disabled={eligible.length === 0}
          className="rounded-full border theme-border theme-card px-3 py-1.5 text-xs font-black hover:theme-bg-subtle disabled:opacity-50"
        >
          {allSelected ? 'Clear' : 'Select all'}
        </button>
      </div>

      <div
        role="group"
        aria-label="Class roster"
        className="theme-card theme-border rounded-2xl border overflow-hidden"
      >
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm theme-text-muted">{emptyMessage}</p>
        ) : (
          <ul className="divide-y divide-current/10 max-h-[320px] overflow-y-auto">
            {filtered.map((klass) => {
              const subjectMeta = SUBJECTS.find((s) => s.id === klass.subject)
              const learnerCount = Array.isArray(klass.learners) ? klass.learners.length : 0
              const isSelected = selectedSet.has(klass.id)
              const isDisabled = disabledSet.has(klass.id)
              return (
                <li key={klass.id}>
                  <label
                    className={[
                      'flex items-center gap-3 p-3 transition-colors min-h-[56px]',
                      isDisabled
                        ? 'opacity-60 cursor-not-allowed'
                        : isSelected
                        ? 'theme-accent-bg cursor-pointer'
                        : 'cursor-pointer hover:theme-bg-subtle',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={() => onToggle?.(klass.id)}
                      className="h-5 w-5 flex-shrink-0 rounded border-2 theme-border accent-current"
                      aria-label={`${klass.name || 'Class'} (Grade ${klass.grade})`}
                    />
                    <SubjectIcon subject={subjectMeta} size="sm" className="flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="theme-text font-bold text-sm truncate flex items-center gap-2">
                        {klass.name || 'Untitled class'}
                        {isDisabled && (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-700">
                            Already assigned
                          </span>
                        )}
                      </p>
                      <p className="theme-text-muted text-xs mt-0.5 truncate">
                        Grade {klass.grade}
                        {subjectMeta ? ` · ${subjectMeta.label}` : ''}
                        {klass.school ? ` · ${klass.school}` : ''}
                        {` · ${learnerCount} learner${learnerCount === 1 ? '' : 's'}`}
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
