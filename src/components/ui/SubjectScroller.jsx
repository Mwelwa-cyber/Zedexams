const VARIANTS = {
  indigo: {
    active: 'border-transparent theme-accent-fill theme-on-accent theme-shadow',
    inactive: 'theme-card theme-border theme-text-muted hover:theme-bg-subtle hover:theme-text',
    iconActive: 'bg-white/25 text-current',
    iconInactive: 'theme-bg-subtle theme-text-muted group-hover:theme-accent-bg group-hover:theme-accent-text',
  },
  amber: {
    active: 'border-amber-500 bg-amber-600 text-white shadow-md shadow-amber-100',
    inactive: 'theme-card theme-border theme-text-muted hover:theme-bg-subtle hover:theme-text',
    iconActive: 'bg-white/20 text-white',
    iconInactive: 'theme-bg-subtle theme-text-muted group-hover:theme-accent-bg group-hover:theme-accent-text',
  },
  purple: {
    active: 'border-purple-500 bg-purple-600 text-white shadow-md shadow-purple-100',
    inactive: 'theme-card theme-border theme-text-muted hover:theme-bg-subtle hover:theme-text',
    iconActive: 'bg-white/20 text-white',
    iconInactive: 'theme-bg-subtle theme-text-muted group-hover:theme-accent-bg group-hover:theme-accent-text',
  },
}

export default function SubjectScroller({
  subjects,
  value,
  onChange,
  variant = 'indigo',
  allLabel = 'All Subjects',
  allIcon = '📚',
}) {
  const styles = VARIANTS[variant] ?? VARIANTS.indigo
  const items = [{ id: '', label: allLabel, icon: allIcon }, ...subjects]

  return (
    <div className="overflow-x-auto no-scrollbar scroll-smooth overscroll-x-contain pb-1">
      <div
        className="flex w-max gap-2 snap-x snap-mandatory"
        aria-label="Filter by subject"
      >
        {items.map(subject => {
          const active = value === subject.id
          return (
            <button
              key={subject.id || 'all-subjects'}
              type="button"
              onClick={() => onChange(active ? '' : subject.id)}
              aria-pressed={active}
              className={`group flex w-40 shrink-0 snap-start items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all duration-200 min-h-0 ${
                active ? styles.active : styles.inactive
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg transition-colors ${
                  active ? styles.iconActive : styles.iconInactive
                }`}
                aria-hidden="true"
              >
                {subject.icon}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-black leading-tight">
                  {subject.label}
                </span>
                <span className={`mt-0.5 block text-xs font-bold ${active ? 'opacity-75' : 'theme-text-muted'}`}>
                  {active ? 'Selected' : 'Tap to filter'}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
