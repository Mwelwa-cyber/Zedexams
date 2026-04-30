import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import {
  listMyGenerations,
  TOOL_META,
  TOOL_FILTER_OPTIONS,
  titleForGeneration,
  formatDate,
} from '../../../utils/teacherLibraryService'
import {
  TEACHER_GRADES,
  TEACHER_SUBJECTS,
} from '../../../utils/teacherTools'
import { downloadCSV } from '../../../utils/csvExport'

/**
 * Teacher Library — every generation the user has created, filterable and
 * clickable through to the detail view.
 */
export default function TeacherLibrary() {
  const { currentUser } = useAuth()
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error | empty
  const [errorMessage, setErrorMessage] = useState('')
  const [searchParams] = useSearchParams()
  const [filters, setFilters] = useState({
    tool: searchParams.get('tool') || '',
    grade: searchParams.get('grade') || '',
    subject: searchParams.get('subject') || '',
    search: '',
  })

  useEffect(() => {
    if (!currentUser) return
    setStatus('loading')
    listMyGenerations({ uid: currentUser.uid })
      .then((rows) => {
        setItems(rows)
        setStatus(rows.length === 0 ? 'empty' : 'ready')
      })
      .catch((err) => {
        setErrorMessage(err?.message || 'Could not load your library.')
        setStatus('error')
      })
  }, [currentUser])

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase()
    return items.filter((r) => {
      if (filters.tool && r.tool !== filters.tool) return false
      if (filters.grade && r.inputs?.grade !== filters.grade) return false
      if (filters.subject && r.inputs?.subject !== filters.subject) return false
      if (term) {
        const haystack = [
          r.inputs?.topic, r.inputs?.subtopic,
          titleForGeneration(r), r.inputs?.grade, r.inputs?.subject,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [items, filters])

  function handleExportCsv() {
    if (!filtered.length) return
    const rows = filtered.map((r) => ({
      title: titleForGeneration(r),
      tool: TOOL_META[r.tool]?.label || r.tool || '',
      grade: r.inputs?.grade || '',
      subject: r.inputs?.subject || '',
      topic: r.inputs?.topic || '',
      subtopic: r.inputs?.subtopic || '',
      difficulty: r.inputs?.difficulty || '',
      status: r.status || '',
      createdAt: formatDate(r.createdAt),
      exportedFormats: (r.exportedFormats || []).join('; '),
    }))
    downloadCSV(`zedexams-library-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  return (
    <div className="min-h-screen theme-bg p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black theme-text">My Library</h1>
            <p className="text-sm theme-text-secondary mt-1">
              Every lesson plan, worksheet and flashcard set you've generated.
              {status === 'ready' && ` Showing ${filtered.length} of ${items.length}.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={status !== 'ready' || filtered.length === 0}
              title={
                status !== 'ready'
                  ? 'Load your library first'
                  : filtered.length === 0
                    ? 'No items to export'
                    : `Export ${filtered.length} item${filtered.length === 1 ? '' : 's'} as CSV`
              }
              className="px-3 py-2 rounded-xl text-sm font-bold border theme-border hover:bg-slate-50 dark:hover:bg-slate-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ⬇️ Export CSV
            </button>
            <Link
              to="/teacher/generate/lesson-plan"
              className="px-3 py-2 rounded-xl text-sm font-bold border theme-border hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              ✨ New lesson plan
            </Link>
            <Link
              to="/teacher/generate/worksheet"
              className="px-3 py-2 rounded-xl text-sm font-bold border theme-border hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              📝 New worksheet
            </Link>
            <Link
              to="/teacher/generate/flashcards"
              className="px-3 py-2 rounded-xl text-sm font-bold border theme-border hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              🎴 New flashcards
            </Link>
          </div>
        </header>

        {/* Filter bar */}
        <div className="theme-card border theme-border rounded-2xl p-3 mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <FieldSelect
            ariaLabel="Filter by tool"
            value={filters.tool}
            options={TOOL_FILTER_OPTIONS}
            onChange={(v) => setFilters((f) => ({ ...f, tool: v }))}
          />
          <FieldSelect
            ariaLabel="Filter by grade"
            value={filters.grade}
            options={[{ value: '', label: 'All grades' }, ...TEACHER_GRADES]}
            onChange={(v) => setFilters((f) => ({ ...f, grade: v }))}
          />
          <FieldSelect
            ariaLabel="Filter by subject"
            value={filters.subject}
            options={[{ value: '', label: 'All subjects' }, ...TEACHER_SUBJECTS]}
            onChange={(v) => setFilters((f) => ({ ...f, subject: v }))}
          />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search by topic…"
            className="px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {status === 'loading' && (
          <LoadingState />
        )}
        {status === 'error' && (
          <ErrorState message={errorMessage} />
        )}
        {status === 'empty' && (
          <EmptyState />
        )}
        {status === 'ready' && filtered.length === 0 && (
          <NoResults onClear={() => setFilters({ tool: '', grade: '', subject: '', search: '' })} />
        )}
        {status === 'ready' && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ItemCard({ item }) {
  const meta = TOOL_META[item.tool] || { label: item.tool, icon: '📄', colour: 'slate' }
  const title = titleForGeneration(item)
  const isKbFallback = !item.kbVersion || (item.errorMessage || '').includes('general CBC')
  return (
    <Link
      to={`/teacher/library/${item.id}`}
      className="group block rounded-2xl border-2 theme-border p-4 shadow-elev-sm transition-all duration-base ease-out hover:-translate-y-0.5 hover:shadow-elev-md hover:border-emerald-400"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl" aria-hidden="true">{meta.icon}</span>
        <span className="text-[10px] font-black uppercase tracking-wide theme-text-secondary">
          {meta.label}
        </span>
        {item.status === 'flagged' && (
          <span className="ml-auto text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
            Review
          </span>
        )}
        {item.status === 'failed' && (
          <span className="ml-auto text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
            Failed
          </span>
        )}
      </div>
      <h3 className="font-black theme-text text-base leading-snug mb-1 line-clamp-2">
        {title}
      </h3>
      <div className="flex flex-wrap gap-2 text-xs theme-text-secondary">
        {item.inputs?.grade && <Pill>{item.inputs.grade}</Pill>}
        {item.inputs?.subject && <Pill>{formatSubject(item.inputs.subject)}</Pill>}
        {item.inputs?.difficulty && <Pill>{item.inputs.difficulty}</Pill>}
      </div>
      <div className="flex items-center justify-between mt-3 text-xs theme-text-secondary">
        <span>{formatDate(item.createdAt)}</span>
        {item.exportedFormats?.length > 0 && (
          <span>Exported: {item.exportedFormats.join(', ')}</span>
        )}
      </div>
    </Link>
  )
}

function Pill({ children }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800">
      {children}
    </span>
  )
}

function FieldSelect({ value, options, onChange, ariaLabel }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 rounded-lg border theme-border bg-transparent theme-text focus:outline-none focus:ring-2 focus:ring-emerald-500"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

function LoadingState() {
  return (
    <div className="theme-card border theme-border rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3 animate-bounce">📚</div>
      <p className="theme-text-secondary">Loading your library…</p>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div className="theme-card border theme-border rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3">⚠️</div>
      <p className="theme-text font-bold mb-1">Could not load your library</p>
      <p className="text-sm theme-text-secondary">{message}</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="theme-card border theme-border rounded-2xl p-12 text-center">
      <div className="text-5xl mb-3">🗂️</div>
      <h3 className="text-lg font-black theme-text mb-2">Your library is empty</h3>
      <p className="text-sm theme-text-secondary max-w-md mx-auto mb-5">
        Once you generate a lesson plan, worksheet, or flashcard set, it'll
        save here automatically — and you can re-export it any time.
      </p>
      <Link
        to="/teacher/generate/lesson-plan"
        className="inline-block px-5 py-3 rounded-xl font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500"
      >
        ✨ Generate your first lesson plan
      </Link>
    </div>
  )
}

function NoResults({ onClear }) {
  return (
    <div className="theme-card border theme-border rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3">🔍</div>
      <p className="theme-text font-bold mb-1">No matches</p>
      <p className="text-sm theme-text-secondary mb-4">
        Try clearing your filters to see everything.
      </p>
      <button
        onClick={onClear}
        className="px-4 py-2 rounded-xl text-sm font-bold border theme-border"
      >
        Clear filters
      </button>
    </div>
  )
}

function formatSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
