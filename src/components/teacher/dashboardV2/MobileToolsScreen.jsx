import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search, SearchX } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { STUDIO_CATEGORIES, TEACHER_STUDIOS } from './launcher/teacherStudios'
import {
  filterStudiosByPermission,
  resolveBadge,
  searchStudios,
} from './launcher/teacherLauncherCore'
import useStudioAvailability from '../../../hooks/useStudioAvailability'
import GlassToolTile from './GlassToolTile'
import './glassSurface.css'

/* Category groups get the same tinted glass panels as the desktop
   workspace sections; search results and Planning & Setup take the
   neutral panel. */
const PANEL_CLASS = {
  planning: 'glass-panel glass-panel--planning',
  materials: 'glass-panel glass-panel--materials',
  assessment: 'glass-panel glass-panel--assessment',
}

/**
 * "All Teacher Tools" — the dedicated full-screen mobile launcher opened
 * from the dashboard's shortcut card. A presentation layer over the
 * canonical studio registry (teacherStudios.js): every route, permission
 * and saved count is the existing one; nothing is re-declared here.
 *
 * Four icons per row, grouped by category, with search and category
 * filter chips. Closes via the back button, Escape, or by navigating to
 * any tool (route change unmounts the dashboard).
 */
export default function MobileToolsScreen({ onClose, savedCounts = null, warnings = [] }) {
  // The live dashboard sits behind ProtectedRoute(requiredRole="teacher");
  // the only signed-out visitor is the mock-data preview page, which should
  // still show the full registry. Signed-in non-teachers keep the filter.
  const auth = useAuth() || {}
  const isTeacher = auth.currentUser ? auth.isTeacher : true
  const { filterEntries } = useStudioAvailability()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const backRef = useRef(null)

  // Scroll-lock the dashboard behind the screen; Escape closes.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    backRef.current?.focus()
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const warningSet = useMemo(() => new Set(warnings), [warnings])
  // Permission ("may this teacher open it") and availability ("is it offered
  // at all") are separate questions; both narrow the same list so search can
  // never surface a withdrawn studio the grid has hidden.
  const permitted = useMemo(
    () => filterEntries(filterStudiosByPermission(TEACHER_STUDIOS, { isTeacher }), 'route'),
    [isTeacher, filterEntries],
  )

  const searching = query.trim().length > 0
  const groups = useMemo(() => {
    if (searching) {
      return [{ id: 'results', label: 'Search results', studios: searchStudios(permitted, query) }]
    }
    const cats = category === 'all'
      ? STUDIO_CATEGORIES
      : STUDIO_CATEGORIES.filter((c) => c.id === category)
    return cats.map((c) => ({ ...c, studios: permitted.filter((s) => s.category === c.id) }))
  }, [searching, query, category, permitted])

  const empty = groups.every((g) => g.studios.length === 0)

  return (
    <div className="tdv2m-tools" role="dialog" aria-modal="true" aria-label="All Teacher Tools">
      <header className="tdv2m-tools-head">
        <button
          type="button"
          ref={backRef}
          className="tdv2m-iconbtn"
          aria-label="Back to dashboard"
          onClick={onClose}
        >
          <ArrowLeft size={22} strokeWidth={2} aria-hidden="true" />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="tdv2m-tools-title">All Teacher Tools</h1>
          <p className="tdv2m-tools-sub">Explore all studios and resources</p>
        </div>
      </header>

      <div className="tdv2m-tools-controls">
        <div className="tdv2-search tdv2m-tools-search">
          <Search size={18} strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools…"
            aria-label="Search teacher tools"
          />
        </div>
        <div className="tdv2m-tools-chips" role="tablist" aria-label="Filter by category">
          <button
            type="button"
            role="tab"
            aria-selected={category === 'all' && !searching}
            className={`tdv2m-tools-chip ${category === 'all' && !searching ? 'is-active' : ''}`}
            onClick={() => { setCategory('all'); setQuery('') }}
          >
            All
          </button>
          {STUDIO_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id && !searching}
              className={`tdv2m-tools-chip ${category === c.id && !searching ? 'is-active' : ''}`}
              onClick={() => { setCategory(c.id); setQuery('') }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="tdv2m-tools-body">
        {empty ? (
          <div className="tdv2-empty tdv2m-tools-empty">
            <SearchX size={22} strokeWidth={1.75} aria-hidden="true" />
            <p>
              {searching
                ? <>No tools match “{query.trim()}”. Try another word.</>
                : 'Nothing to show here yet.'}
            </p>
          </div>
        ) : (
          groups.filter((g) => g.studios.length > 0).map((group) => (
            <section
              key={group.id}
              aria-label={group.label}
              className={`tdv2m-tools-panel ${PANEL_CLASS[group.id] || 'glass-panel'}`}
            >
              <h2 className="tdv2-eyebrow tdv2m-tools-group">{group.label}</h2>
              <div className="tdv2m-tool-grid">
                {group.studios.map((studio) => {
                  const badge = resolveBadge(studio, savedCounts, { warnings: warningSet })
                  return (
                    <Link
                      key={studio.id}
                      to={studio.route}
                      className="tdv2m-tool"
                      aria-label={`${studio.title}${badge ? `, ${badge.label}` : ''}`}
                    >
                      <GlassToolTile studio={studio} badge={badge} sizeClass="tdv2m-tool-tile" />
                      <span className="tdv2m-tool-name">{studio.title}</span>
                      {badge?.type === 'saved' ? (
                        <span className="tdv2m-tool-saved" aria-hidden="true">
                          {badge.count} saved
                        </span>
                      ) : null}
                    </Link>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
