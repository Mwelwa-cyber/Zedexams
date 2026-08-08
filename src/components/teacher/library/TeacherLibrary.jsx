import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useFirestore } from '../../../hooks/useFirestore'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import {
  listMyGenerations,
  titleForGeneration,
  formatDate,
  bucketIntoTree,
  librarySectionForGeneration,
  libraryTypeForGeneration,
} from '../../../utils/teacherLibraryService'
import {
  LIBRARY_SECTION_BY_ID,
  LIBRARY_TYPES,
  SYLLABUS_OPTIONS,
  TERMS,
  getActiveGradeForms,
  getSubjectsForGradeForm,
  getAssessmentTypesForGradeForm,
} from '../../../config/library'
// The library home grid, the Create menu and the folder filter chips all render
// from ONE registry — label, icon, tint, route and hierarchy. Adding a studio
// there surfaces its card here with no change to this file.
import { STUDIOS, STUDIO_BY_ID, creatableStudios } from '../../../lib/library/studios'
import { NEUTRAL_TINT, studioIcon, studioTint } from './studioPresentation'
import { classifyForLibrary } from '../../../utils/libraryClassification'
import SeoHelmet from '../../seo/SeoHelmet'
import Icon from '../../ui/Icon'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BeakerIcon,
  BookOpen,
  Calculator,
  CalendarDays,
  ChevronRight,
  ClipboardCheckList,
  ClipboardList,
  Clock,
  ComputerDesktop,
  DocumentTextIcon,
  FileText,
  FolderOpen,
  Globe,
  GraduationCap,
  Language,
  Layers,
  ListChecks,
  Loader2,
  MusicalNote,
  Palette,
  PencilLine,
  Plus,
  Search,
  SlidersHorizontal,
  Sprout,
  Target,
  TrophyIcon,
} from '../../ui/icons'

/**
 * Hierarchical Library Browser.
 *
 * Step-by-step flow (mobile-first):
 *   1. Library Type   (Schemes / Forecasts / Syllabi / Lesson Plans / Notes / Assessments)
 *   2. Syllabus       (CBC / OBC)
 *   3. Grade / Form
 *   4. Term           (skipped for Syllabi)
 *   5. Subject
 *   6. Assessment Type   (Assessments only)
 *   7. Documents
 *
 * Selections are reflected in the URL so back/forward works and links
 * are deep-shareable. Typing in the search bar overlays a flat result
 * list across the whole library without disturbing the URL selection.
 */

const PARAM_KEYS = ['type', 'syllabus', 'grade', 'term', 'subject', 'assess']

// Every one of these is spent as an inline `style` prop, which no stylesheet
// can reach past — so the literals they used to hold were the reason this page
// stayed at full brightness on Night while the shell around it went dark. They
// are the workspace tokens now, which means the page follows all four themes
// rather than gaining one. `orange` is the brand accent and stays a literal:
// it is legible on both the cream and the dark card, and it is the same colour
// the marketing site and the Create button use.
const COLORS = {
  paper:    'var(--zt-surface)',
  ink:      'var(--zt-text)',
  inkSoft:  'var(--zt-text-muted)',
  faint:    'var(--zt-text-muted)',
  border:   'var(--zt-line)',
  card:     'var(--zt-card)',
  orange:   '#d97757',
  // The folder tiles below are painted from SECTION_PALETTE, which is a set of
  // pastels that stay light in every theme — they are the page's identity, and
  // a coloured folder on a dark page reads as a folder. Their ink therefore
  // must NOT follow --zt-text, or it goes near-white on a near-white tile. Same
  // reason the active filter chip fills from the sidebar token: that surface is
  // dark in all four themes, so white text on it is right in all four.
  onPastel:      '#0e2a32',
  onPastelSoft:  '#566f76',
  onPastelFaint: '#7c8c93',
  fill:          'var(--zt-sidebar-bg)',
  onFill:        'var(--zt-on-dark)',
}

/* ── Folder palettes + per-tile icons ──────────────────────────── */
// Both now come from the studio registry's `tint` and `icon` tokens, resolved
// by studioPresentation.js — the same twelve pastels and icons as before, with
// one place to add the thirteenth. Distinct SVG icons make folder choices
// scannable without relying on platform-specific emoji rendering.

const NEUTRAL_PALETTE = NEUTRAL_TINT

function paletteFor(studioId) {
  const studio = STUDIO_BY_ID[studioId]
  return studio ? studioTint(studio.tint) : NEUTRAL_PALETTE
}

function iconFor(studioId) {
  const studio = STUDIO_BY_ID[studioId]
  return studio ? studioIcon(studio.icon) : FolderOpen
}

const TOOL_ICON = {
  lesson_plan:     PencilLine,
  scheme_of_work:  BookOpen,
  weekly_forecast: CalendarDays,
  record_of_work:  ClipboardList,
  mark_schedule:   ListChecks,
  worksheet:       FileText,
  flashcards:      Layers,
  rubric:          ClipboardCheckList,
  notes:           DocumentTextIcon,
  assessment:      BarChart3,
  assessments:     BarChart3,
  quiz:            ClipboardList,
}

const SYLLABUS_ICON = {
  CBC:       Sprout,
  OBC:       DocumentTextIcon,
  Secondary: GraduationCap,
}

const TERM_ICON = {
  'Term 1': CalendarDays,
  'Term 2': Clock,
  'Term 3': Target,
}

const ASSESSMENT_ICON = {
  topic:       Target,
  monthly:     CalendarDays,
  midterm:     BarChart3,
  end_of_term: TrophyIcon,
}

function gradeFormIcon(value) {
  return /form/i.test(String(value)) ? GraduationCap : BookOpen
}

const SUBJECT_ICON = {
  'Mathematics':                                     Calculator,
  'Additional Mathematics':                          Calculator,
  'Mathematics and Science':                         Calculator,
  'English Language':                                BookOpen,
  'Literacy and Language':                           Language,
  'Zambian Language':                                Language,
  'Integrated Science':                              BeakerIcon,
  'Science':                                         BeakerIcon,
  'Biology':                                         Sprout,
  'Social Studies':                                  Globe,
  'History':                                         Clock,
  'Geography':                                       Globe,
  'Civic Education':                                 Globe,
  'Religious Education':                             BookOpen,
  'Technology Studies':                              ComputerDesktop,
  'Computer Studies':                                ComputerDesktop,
  'Design and Technology':                           ComputerDesktop,
  'Creative and Technology Studies':                 Palette,
  'Art and Design':                                  Palette,
  'Home Economics':                                  FileText,
  'Home Management':                                 FileText,
  'Food and Nutrition':                              FileText,
  'Expressive Arts':                                 MusicalNote,
  'Physical Education':                              Target,
  'Agricultural Science':                            Sprout,
  'Physics':                                         BeakerIcon,
  'Chemistry':                                       BeakerIcon,
  'Business Studies':                                BarChart3,
  'Commerce':                                        BarChart3,
  'Principles of Accounts':                          BarChart3,
  'Principles of Accounting':                        BarChart3,
  'Information and Communication Technology (ICT)':  ComputerDesktop,
}

function subjectIcon(value) {
  return SUBJECT_ICON[value] || BookOpen
}

function singularLabel(label) {
  if (label === 'Schemes of Work') return 'Scheme of Work'
  return String(label).replace(/s$/, '')
}

// Folder grids: 2 compact columns on phones, 3 when there's room.
const FOLDER_GRID_CLASS = 'grid grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-4 sm:gap-x-4 sm:gap-y-5'

export default function TeacherLibrary() {
  const { currentUser } = useAuth()
  const { getMyAssessments } = useFirestore()
  const [searchParams, setSearchParams] = useSearchParams()

  const sel = useMemo(() => ({
    type:     searchParams.get('type')     || '',
    syllabus: searchParams.get('syllabus') || '',
    grade:    searchParams.get('grade')    || '',
    term:     searchParams.get('term')     || '',
    subject:  searchParams.get('subject')  || '',
    assess:   searchParams.get('assess')   || '',
  }), [searchParams])

  const [generations, setGenerations] = useState([])
  const [assessments, setAssessments] = useState([])
  const [status, setStatus] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  // Bumped by the Retry button — re-triggers the data-load effect.
  const [reloadKey, setReloadKey] = useState(0)

  // The global search in TeacherTopBar lands here as /teacher/library?q=…
  // Seed the search box from the URL and re-sync whenever the param
  // changes (e.g. a second top-bar search while already on this page).
  // Local typing deliberately does NOT write back to the URL.
  const urlQuery = searchParams.get('q') || ''
  const [query, setQuery] = useState(urlQuery)
  const lastUrlQuery = useRef(urlQuery)
  useEffect(() => {
    if (urlQuery === lastUrlQuery.current) return
    lastUrlQuery.current = urlQuery
    setQuery(urlQuery)
  }, [urlQuery])

  const [filtersOpen, setFiltersOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')

  /* ── Data load ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    setStatus('loading')
    // Both reads must succeed — if either throws (network blip, permission
    // failure) the entire library cannot be trusted to be complete, so we
    // show an error with retry rather than a silently incomplete view.
    Promise.all([
      listMyGenerations({ uid: currentUser.uid }),
      getMyAssessments(currentUser.uid),
    ])
      .then(([gens, asmts]) => {
        if (cancelled) return
        setGenerations(gens)
        setAssessments(asmts)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMessage(err?.message || 'Could not load your library.')
        setStatus('error')
      })
    return () => { cancelled = true }
  // reloadKey lets the Retry button re-trigger this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, reloadKey])

  /* ── Selection helpers ─────────────────────────────────────── */
  function setStep(updates) {
    const next = new URLSearchParams(searchParams)
    for (const k of Object.keys(updates)) {
      const v = updates[k]
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setSearchParams(next, { replace: false })
  }

  function backTo(level) {
    // Clear everything below the given level (inclusive of `level`).
    const order = ['type', 'syllabus', 'grade', 'term', 'subject', 'assess']
    const idx = order.indexOf(level)
    if (idx < 0) return setStep(Object.fromEntries(PARAM_KEYS.map(k => [k, ''])))
    const next = new URLSearchParams(searchParams)
    for (let i = idx; i < order.length; i++) next.delete(order[i])
    setSearchParams(next, { replace: false })
  }

  /* ── Index legacy rows (no library coords) into the tree ──── */
  // Backfill on the fly so old generations still show up in the right
  // folder. Cheap because the user's full library is ≤60 rows.
  const indexedGenerations = useMemo(() => {
    return generations.map((g) => {
      if (g.library?.libraryType) return g
      const section = librarySectionForGeneration(g)
      if (!section) return g
      const lib = classifyForLibrary({
        libraryType: section.id,
        grade:       g.inputs?.grade || g.meta?.klass,
        term:        g.inputs?.term  || (() => {
          const tw = String(g.meta?.termWeek || '')
          const m = tw.match(/Term\s*(\d)/i)
          return m ? `Term ${m[1]}` : null
        })(),
        subject:     g.inputs?.subject || g.meta?.subject,
      })
      return { ...g, library: lib }
    })
  }, [generations])

  // Treat each saved assessment as a library row so they appear in the
  // Assessments folder alongside generated drafts.
  const assessmentRows = useMemo(() => {
    return assessments.map((a) => ({
      id:        a.id,
      ownerUid:  a.createdBy,
      tool:      'assessment',
      output:    a,
      inputs:    { grade: a.grade, subject: a.subject, term: a.term },
      createdAt: a.createdAt,
      library:   a.library || classifyForLibrary({
        libraryType:    LIBRARY_TYPES.ASSESSMENTS,
        grade:          a.grade ? `Grade ${a.grade}` : null,
        term:           a.term,
        subject:        a.subject,
        assessmentType: a.assessmentType,
      }),
      __linkTo:  `/teacher/assessment-papers/${a.id}/edit`,
      __title:   a.title || `${a.subject || 'Assessment'} ${a.assessmentType || ''}`.trim(),
    }))
  }, [assessments])

  const allRows = useMemo(
    () => [...indexedGenerations, ...assessmentRows],
    [indexedGenerations, assessmentRows],
  )

  const tree = useMemo(() => bucketIntoTree(allRows), [allRows])

  const totalSaved = allRows.length

  // Most recently created item across studios — powers the
  // "Continue editing" strip on the landing view.
  const recentItem = useMemo(() => {
    let best = null
    let bestMs = -1
    for (const r of allRows) {
      const ts = r.createdAt
      const ms = typeof ts?.toMillis === 'function' ? ts.toMillis()
        : ts?.seconds ? ts.seconds * 1000
        : ts ? new Date(ts).getTime() : 0
      if (Number.isFinite(ms) && ms > bestMs) { bestMs = ms; best = r }
    }
    return best
  }, [allRows])

  /* ── Search across the whole library ───────────────────────── */
  const debouncedQuery = useDebouncedValue(query, 200)
  const trimmedQuery = debouncedQuery.trim()
  const searchRows = useMemo(() => {
    if (!trimmedQuery) return []
    const needle = trimmedQuery.toLowerCase()
    return allRows.filter((r) => {
      if (typeFilter && libraryTypeForGeneration(r) !== typeFilter) return false
      const title = String(r.__title || titleForGeneration(r)).toLowerCase()
      const path = String(r.library?.path || '').toLowerCase()
      return title.includes(needle) || path.includes(needle)
    })
  }, [trimmedQuery, typeFilter, allRows])

  /* ── Resolve the current step into a body + heading ────────── */
  const crumbs = status === 'ready' ? buildCrumbs(sel) : []
  const section = sel.type ? LIBRARY_SECTION_BY_ID[sel.type] : null
  const palette = section ? paletteFor(section.id) : NEUTRAL_PALETTE

  let body = null
  let subtitle = ''

  if (status === 'loading') {
    body = <LoadingState />
  } else if (status === 'error') {
    body = <ErrorState message={errorMessage} onRetry={() => setReloadKey((k) => k + 1)} />
  } else if (trimmedQuery) {
    subtitle = `${searchRows.length} result${searchRows.length === 1 ? '' : 's'} for “${trimmedQuery}”`
    body = <SearchResults rows={searchRows} />
  } else if (!sel.type) {
    subtitle = `${totalSaved} saved item${totalSaved === 1 ? '' : 's'} across all studios`
    body = (
      <>
        {recentItem && <RecentStrip item={recentItem} />}
        <SectionPicker tree={tree} onPick={(t) => setStep({ type: t })} />
      </>
    )
  } else if (!section) {
    body = <ErrorState message={`Unknown library section: ${sel.type}`} />
  } else if (!sel.syllabus) {
    subtitle = section.label
    body = (
      <SyllabusPicker
        tree={tree[sel.type] || {}}
        palette={palette}
        onPick={(s) => setStep({ syllabus: s })}
      />
    )
  } else if (!sel.grade) {
    subtitle = `${section.label} · ${sel.syllabus}`
    body = (
      <GradeFormPicker
        syllabus={sel.syllabus}
        subTree={(tree[sel.type] || {})[sel.syllabus] || {}}
        palette={palette}
        onPick={(g) => setStep({ grade: g })}
      />
    )
  } else if (section.hasTerm && !sel.term) {
    subtitle = `${section.label} · ${sel.syllabus} · ${sel.grade}`
    body = (
      <TermPicker
        subTree={((tree[sel.type] || {})[sel.syllabus] || {})[sel.grade] || {}}
        palette={palette}
        onPick={(t) => setStep({ term: t })}
      />
    )
  } else if (!sel.subject) {
    const branch = section.hasTerm
      ? (((tree[sel.type] || {})[sel.syllabus] || {})[sel.grade] || {})[sel.term] || {}
      : ((tree[sel.type] || {})[sel.syllabus] || {})[sel.grade] || {}
    subtitle = [section.label, sel.syllabus, sel.grade, section.hasTerm && sel.term].filter(Boolean).join(' · ')
    body = (
      <SubjectPicker
        syllabus={sel.syllabus}
        gradeForm={sel.grade}
        subTree={branch}
        palette={palette}
        onPick={(s) => setStep({ subject: s })}
      />
    )
  } else if (section.hasAssessmentType && !sel.assess) {
    const branch = (((((tree[sel.type] || {})[sel.syllabus] || {})[sel.grade] || {})[sel.term] || {})[sel.subject]) || {}
    subtitle = [section.label, sel.syllabus, sel.grade, sel.term, sel.subject].filter(Boolean).join(' · ')
    body = (
      <AssessmentTypePicker
        syllabus={sel.syllabus}
        gradeForm={sel.grade}
        subTree={branch}
        palette={palette}
        onPick={(t) => setStep({ assess: t })}
      />
    )
  } else {
    const leaf = readLeaf(tree, sel)
    subtitle = [section.label, sel.syllabus, sel.grade, section.hasTerm && sel.term, sel.subject, section.hasAssessmentType && labelForAssessment(sel.syllabus, sel.grade, sel.assess)]
      .filter(Boolean).join(' · ')
    body = <DocumentList items={leaf} section={section} />
  }

  const showChrome = status === 'ready' && !trimmedQuery

  return (
    <Shell>
      <TopBar
        query={query}
        onQueryChange={setQuery}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
      />
      <PageHeading
        subtitle={subtitle}
        crumbs={showChrome ? crumbs : null}
        onCrumb={backTo}
        section={showChrome ? section : null}
      />
      {body}
    </Shell>
  )
}

/* ── Layout chrome ─────────────────────────────────────────────── */

function Shell({ children }) {
  // Generous bottom padding so the last folder row clears the fixed
  // bottom navigation on phones/tablets (TeacherLayout adds pb-24 too).
  return (
    <div className="min-h-screen p-4 pb-10 sm:p-6 lg:p-8" style={{ background: COLORS.paper }}>
      <SeoHelmet title="Teacher library" noIndex />
      <div className="w-full">{children}</div>
    </div>
  )
}

function TopBar({ query, onQueryChange, filtersOpen, onToggleFilters, typeFilter, onTypeFilter }) {
  const filterActive = filtersOpen || Boolean(typeFilter)
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2.5 sm:gap-3">
        <div className="relative flex-1 min-w-0">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: COLORS.faint }}>
            <Icon as={Search} size="sm" />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search lessons, notes, assessments..."
            aria-label="Search your library"
            className="w-full rounded-full outline-none transition-shadow focus:shadow-md"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 2px 8px rgba(14,42,50,.04)',
              padding: '11px 44px 11px 42px',
              fontSize: 14,
              color: COLORS.ink,
            }}
          />
          <button
            type="button"
            onClick={onToggleFilters}
            aria-label="Filter by folder"
            aria-expanded={filtersOpen}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center rounded-full cursor-pointer transition-colors"
            style={{
              width: 34,
              height: 34,
              border: 'none',
              background: filterActive ? '#fff1e7' : 'transparent',
              color: filterActive ? COLORS.orange : COLORS.inkSoft,
            }}
          >
            <Icon as={SlidersHorizontal} size="sm" />
          </button>
        </div>
        <CreateMenu />
      </div>
      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2 mt-3" role="group" aria-label="Filter search results by folder">
          <FilterChip label="All folders" active={!typeFilter} onClick={() => onTypeFilter('')} />
          {STUDIOS.map((studio) => (
            <FilterChip
              key={studio.id}
              label={studio.label}
              active={typeFilter === studio.id}
              onClick={() => onTypeFilter(typeFilter === studio.id ? '' : studio.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-bold rounded-full px-3 py-1.5 cursor-pointer transition-colors"
      style={active
        ? { background: COLORS.fill, border: `1px solid ${COLORS.fill}`, color: COLORS.onFill }
        : { background: COLORS.card, border: `1px solid ${COLORS.border}`, color: COLORS.inkSoft }}
    >
      {label}
    </button>
  )
}

function CreateMenu() {
  const [open, setOpen] = useState(false)
  const options = creatableStudios()
  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-full font-bold cursor-pointer transition-transform hover:-translate-y-0.5"
        style={{
          background: COLORS.orange,
          color: '#fff',
          border: 'none',
          padding: '11px 16px',
          fontSize: 13.5,
          boxShadow: '0 6px 14px rgba(217,119,87,.32)',
        }}
      >
        <Icon as={Plus} size="sm" strokeWidth={2.5} />
        Create
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="absolute right-0 mt-2 z-40 rounded-2xl overflow-hidden"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 16px 40px rgba(14,42,50,.16)',
              minWidth: 232,
              padding: 6,
            }}
          >
            {options.map((s) => {
              const SectionIcon = iconFor(s.id)
              const pal = paletteFor(s.id)
              return (
                <Link
                  key={s.id}
                  role="menuitem"
                  to={s.createRoute}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 no-underline transition-colors hover:bg-stone-50"
                  style={{ color: COLORS.ink }}
                >
                  <span
                    className="grid place-items-center flex-shrink-0"
                    style={{ width: 32, height: 32, borderRadius: 10, background: pal.to, color: COLORS.onPastel }}
                  >
                    <Icon as={SectionIcon} size="sm" />
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>New {singularLabel(s.label)}</span>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function PageHeading({ subtitle, crumbs, onCrumb, section }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/teacher"
            className="inline-flex items-center gap-1.5 mb-3 no-underline font-bold rounded-full transition-colors"
            style={{
              border: `1px solid ${COLORS.border}`,
              color: COLORS.ink,
              background: COLORS.card,
              boxShadow: '0 2px 6px rgba(14,42,50,.04)',
              padding: '7px 14px',
              fontSize: 13,
            }}
          >
            ← Home
          </Link>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 32, color: COLORS.ink, margin: 0, letterSpacing: '-.3px' }}>
            Library
          </h1>
          {subtitle && (
            <p style={{ fontSize: 13, color: COLORS.inkSoft, margin: '4px 0 0' }}>
              {subtitle}
            </p>
          )}
        </div>
        {section?.createTo && (
          <Link
            to={section.createTo}
            className="inline-flex items-center gap-1.5 rounded-full font-bold no-underline transition-transform hover:-translate-y-0.5"
            style={{
              background: COLORS.orange,
              color: '#fff',
              padding: '10px 16px',
              fontSize: 13,
              boxShadow: '0 6px 14px rgba(217,119,87,.32)',
            }}
          >
            + New {singularLabel(section.label)}
          </Link>
        )}
      </div>
      {crumbs && crumbs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button
            type="button"
            onClick={() => onCrumb && onCrumb('type')}
            className="text-xs font-bold rounded-full px-3 py-1.5 cursor-pointer transition-colors"
            style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, color: COLORS.inkSoft }}
          >
            Library
          </button>
          {crumbs.map((c) => (
            <span key={c.level} className="flex items-center gap-2">
              <span style={{ color: COLORS.faint, fontSize: 12 }}>›</span>
              <button
                type="button"
                onClick={() => onCrumb && onCrumb(c.level)}
                className="text-xs font-bold rounded-full px-3 py-1.5 cursor-pointer transition-colors"
                style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, color: COLORS.ink }}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Recent strip ──────────────────────────────────────────────── */

function RecentStrip({ item }) {
  const title = item.__title || titleForGeneration(item)
  const to = item.__linkTo || `/teacher/library/${item.id}`
  return (
    <Link
      to={to}
      className="flex items-center gap-3 mb-6 no-underline rounded-2xl transition-transform hover:-translate-y-0.5"
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        boxShadow: '0 4px 12px rgba(14,42,50,.05)',
        padding: '12px 16px',
        color: COLORS.ink,
      }}
    >
      <span
        className="grid place-items-center flex-shrink-0 rounded-full"
        style={{ width: 36, height: 36, background: '#fff1e7', color: COLORS.orange }}
      >
        <Icon as={Clock} size="sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: COLORS.faint }}>
          Continue editing
        </span>
        <span className="block truncate" style={{ fontSize: 14, fontWeight: 700 }}>
          {title}
        </span>
      </span>
      <Icon as={ChevronRight} size="sm" style={{ color: COLORS.faint, flexShrink: 0 }} />
    </Link>
  )
}

/* ── Step pickers ──────────────────────────────────────────────── */

function SectionPicker({ tree, onPick }) {
  // One card per registry entry — no parallel list. A studio added to STUDIOS
  // appears here with its label, icon, tint and count, and nothing in this file
  // has to know it exists.
  return (
    <div className={FOLDER_GRID_CLASS}>
      {STUDIOS.map((s) => {
        const branch = tree[s.id] || {}
        const count = countLeaves(branch)
        return (
          <FolderCard
            key={s.id}
            icon={iconFor(s.id)}
            palette={paletteFor(s.id)}
            title={s.label}
            subtitle={`${count} saved ${count === 1 ? 'item' : 'items'}`}
            onClick={() => onPick(s.id)}
          />
        )
      })}
    </div>
  )
}

function SyllabusPicker({ tree, palette, onPick }) {
  const extras = extraKeys(tree, SYLLABUS_OPTIONS.map((o) => o.value))
  return (
    <div className={FOLDER_GRID_CLASS}>
      {SYLLABUS_OPTIONS.map((opt) => {
        const branch = tree[opt.value] || {}
        const count = countLeaves(branch)
        return (
          <FolderCard
            key={opt.value}
            icon={SYLLABUS_ICON[opt.value] || BookOpen}
            palette={palette}
            title={opt.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(opt.value)}
          />
        )
      })}
      {extras.map((k) => (
        <OrphanFolder key={k} label={k} count={countLeaves(tree[k])} onClick={() => onPick(k)} />
      ))}
    </div>
  )
}

function GradeFormPicker({ syllabus, subTree, palette, onPick }) {
  const grades = getActiveGradeForms(syllabus)
  const extras = extraKeys(subTree, grades.map((g) => g.value))
  return (
    <div className={FOLDER_GRID_CLASS}>
      {grades.map((g) => {
        const branch = subTree[g.value] || {}
        const count = countLeaves(branch)
        return (
          <FolderCard
            key={g.value}
            icon={gradeFormIcon(g.value)}
            palette={palette}
            title={g.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(g.value)}
          />
        )
      })}
      {extras.map((k) => (
        <OrphanFolder key={k} label={k} count={countLeaves(subTree[k])} onClick={() => onPick(k)} />
      ))}
      {grades.length === 0 && extras.length === 0 && (
        <EmptyHint text={`No grades configured for ${syllabus} yet.`} />
      )}
    </div>
  )
}

function TermPicker({ subTree, palette, onPick }) {
  const extras = extraKeys(subTree, TERMS.map((t) => t.value))
  return (
    <div className={FOLDER_GRID_CLASS}>
      {TERMS.map((t) => {
        const branch = subTree[t.value] || {}
        const count = countLeaves(branch)
        return (
          <FolderCard
            key={t.value}
            icon={TERM_ICON[t.value] || CalendarDays}
            palette={palette}
            title={t.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(t.value)}
          />
        )
      })}
      {extras.map((k) => (
        <OrphanFolder key={k} label={k} count={countLeaves(subTree[k])} onClick={() => onPick(k)} />
      ))}
    </div>
  )
}

function SubjectPicker({ syllabus, gradeForm, subTree, palette, onPick }) {
  const subjects = getSubjectsForGradeForm(syllabus, gradeForm)
  const extras = extraKeys(subTree, subjects)
  if (subjects.length === 0 && extras.length === 0) {
    return <EmptyHint text={`Subjects for ${syllabus} ${gradeForm} are not configured yet.`} />
  }
  return (
    <div className={FOLDER_GRID_CLASS}>
      {subjects.map((s) => {
        const branch = subTree[s] || {}
        const count = countLeaves(branch)
        return (
          <FolderCard
            key={s}
            icon={subjectIcon(s)}
            palette={palette}
            title={s}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(s)}
          />
        )
      })}
      {extras.map((k) => (
        <OrphanFolder key={k} label={k} count={countLeaves(subTree[k])} onClick={() => onPick(k)} />
      ))}
    </div>
  )
}

function AssessmentTypePicker({ syllabus, gradeForm, subTree, palette, onPick }) {
  const types = getAssessmentTypesForGradeForm(syllabus, gradeForm)
  const extras = extraKeys(subTree, types.map((t) => t.value))
  return (
    <div className={FOLDER_GRID_CLASS}>
      {types.map((t) => {
        const branch = subTree[t.value] || []
        const count = Array.isArray(branch) ? branch.length : countLeaves(branch)
        return (
          <FolderCard
            key={t.value}
            icon={ASSESSMENT_ICON[t.value] || ClipboardList}
            palette={palette}
            title={t.label}
            subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
            onClick={() => onPick(t.value)}
          />
        )
      })}
      {extras.map((k) => (
        <OrphanFolder key={k} label={k} count={countLeaves(subTree[k])} onClick={() => onPick(k)} />
      ))}
    </div>
  )
}

/* ── Documents (leaf) ──────────────────────────────────────────── */

function DocumentList({ items, section }) {
  if (!items || items.length === 0) {
    return <EmptyHint text={section.emptyHint} />
  }
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
      {items.map((item) => (
        <DocumentCard key={item.id} item={item} section={section} />
      ))}
    </div>
  )
}

function DocumentCard({ item, section }) {
  const title = item.__title || titleForGeneration(item)
  const linkTo = item.__linkTo || `/teacher/library/${item.id}`
  const itemIcon = TOOL_ICON[item.tool] || iconFor(section.id) || DocumentTextIcon
  const pal = paletteFor(section.id)
  return (
    <Link
      to={linkTo}
      className="block no-underline rounded-2xl p-4 transition-transform hover:-translate-y-0.5"
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        boxShadow: '0 4px 12px rgba(14,42,50,.05)',
        minHeight: 140,
        color: COLORS.ink,
      }}
    >
      <div
        className="grid place-items-center"
        style={{ width: 40, height: 40, borderRadius: 999, background: pal.to, marginBottom: 10, flexShrink: 0 }}
      >
        <Icon as={itemIcon} size="md" />
      </div>
      <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 15, color: COLORS.ink, margin: '0 0 4px', lineHeight: 1.25 }} className="line-clamp-2">
        {title}
      </p>
      <p style={{ fontSize: 12, color: COLORS.inkSoft, margin: 0 }}>
        {item.library?.path || ''}
      </p>
      {item.createdAt && (
        <p style={{ fontSize: 11, color: COLORS.faint, margin: '10px 0 0', fontWeight: 600 }}>
          {formatDate(item.createdAt)}
        </p>
      )}
    </Link>
  )
}

/* ── Search results ────────────────────────────────────────────── */

function SearchResults({ rows }) {
  if (!rows || rows.length === 0) {
    return <EmptyHint text="No saved items match your search. Try a different keyword or clear the folder filter." />
  }
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
      {rows.map((item) => {
        const section = librarySectionForGeneration(item) || LIBRARY_SECTION_BY_ID[LIBRARY_TYPES.NOTES]
        return <DocumentCard key={item.id} item={item} section={section} />
      })}
    </div>
  )
}

/* ── Folder card ───────────────────────────────────────────────── */
// Windows-style folder: a small tab pokes above the top-left corner of
// a soft gradient body. The whole thing lifts slightly on hover.
//
// The palette hexes are handed to CSS as `--folder-tint-*` custom properties
// and everything paints from the derived `--folder-*` set (see the
// `.zx-folder-card` rules in index.css): light themes pass the tints through
// unchanged, Night derives a dark-appropriate wash of the same hue and swaps
// the on-pastel ink for theme ink. The JSX carries no theme knowledge.

function FolderCard({ icon, palette, title, subtitle, onClick }) {
  const IconComponent = icon
  return (
    <button
      type="button"
      onClick={onClick}
      className="zx-folder-card relative block w-full text-left cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{
        '--folder-tint-from': palette.from,
        '--folder-tint-to': palette.to,
        '--folder-tint-border': palette.border,
        '--folder-tint-tab': palette.tab,
        background: 'transparent',
        border: 'none',
        padding: '10px 0 0',
        margin: 0,
      }}
    >
      {/* Folder tab */}
      <span
        aria-hidden
        className="absolute"
        style={{
          top: 0,
          left: 16,
          width: 64,
          height: 24,
          borderRadius: '10px 10px 0 0',
          background: 'var(--folder-tab)',
          border: '1px solid var(--folder-border)',
          borderBottom: 'none',
        }}
      />
      {/* Folder body */}
      <span
        className="relative flex items-start justify-between gap-2"
        style={{
          background: 'linear-gradient(140deg, var(--folder-from) 0%, var(--folder-to) 100%)',
          border: '1px solid var(--folder-border)',
          borderRadius: 16,
          boxShadow: '0 5px 14px rgba(14,42,50,.06)',
          padding: '16px 14px 12px',
          minHeight: 118,
        }}
      >
        <span className="flex flex-col min-w-0 flex-1 self-stretch">
          <span
            className="line-clamp-2"
            style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 'clamp(15px, 2.2vw, 17px)', color: 'var(--folder-ink)', lineHeight: 1.2 }}
          >
            {title}
          </span>
          <span style={{ fontSize: 12, color: 'var(--folder-ink-soft)', fontWeight: 600, marginTop: 4 }}>
            {subtitle}
          </span>
          <span
            className="inline-flex items-center gap-1"
            style={{ fontSize: 11.5, color: 'var(--folder-ink-faint)', fontWeight: 700, marginTop: 'auto', paddingTop: 10 }}
          >
            Open <Icon as={ArrowRight} size={12} />
          </span>
        </span>
        <span
          className="grid place-items-center flex-shrink-0 rounded-full"
          style={{
            width: 38,
            height: 38,
            background: 'var(--folder-chip)',
            border: '1px solid var(--folder-border)',
            color: 'var(--folder-ink)',
          }}
        >
          <Icon as={IconComponent} size="sm" />
        </span>
      </span>
    </button>
  )
}

// Folder for a key that exists in the saved data but isn't in the
// static taxonomy (e.g. "Unsorted", a legacy subject, or an inactive
// grade). Without this the item is counted at the parent but unreachable.
function OrphanFolder({ label, count, onClick }) {
  return (
    <FolderCard
      icon={FolderOpen}
      palette={NEUTRAL_PALETTE}
      title={label}
      subtitle={count > 0 ? `${count} item${count === 1 ? '' : 's'}` : 'Empty'}
      onClick={onClick}
    />
  )
}

/* ── States ────────────────────────────────────────────────────── */

function EmptyHint({ text }) {
  return (
    <div className="rounded-2xl border border-dashed py-10 px-4 text-center" style={{ background: COLORS.card, borderColor: COLORS.border }}>
      <p style={{ fontSize: 13, color: COLORS.faint, margin: 0 }}>{text}</p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="rounded-2xl border border-dashed p-12 text-center" style={{ background: COLORS.card, borderColor: COLORS.border }}>
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full" style={{ background: '#fff1e7', color: COLORS.orange }}>
        <Icon as={Loader2} size="lg" className="animate-spin" />
      </div>
      <p style={{ fontSize: 13, color: COLORS.faint }}>Loading your library…</p>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="rounded-2xl border border-dashed p-12 text-center" style={{ background: COLORS.card, borderColor: COLORS.border }}>
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full" style={{ background: '#fee2e2', color: '#b91c1c' }}>
        <Icon as={AlertTriangle} size="lg" />
      </div>
      <p style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 16, color: COLORS.ink, marginBottom: 6 }}>
        Could not load your library
      </p>
      <p style={{ fontSize: 13, color: COLORS.faint, margin: 0 }}>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{ marginTop: 12, fontSize: 13, color: COLORS.ink, background: 'none', border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}
        >
          Try again
        </button>
      )}
    </div>
  )
}

/* ── Tree utilities ────────────────────────────────────────────── */

// Keys present in a tree branch that the static taxonomy doesn't offer.
// These hold real items (e.g. "Unsorted", or a subject/grade that no
// longer matches the config) and must still be navigable, otherwise the
// parent count includes rows that no child tile can reach.
function extraKeys(branch, knownValues) {
  if (!branch || typeof branch !== 'object') return []
  const known = new Set(knownValues)
  return Object.keys(branch)
    .filter((k) => !known.has(k) && countLeaves(branch[k]) > 0)
    .sort((a, b) => {
      if (a === 'Unsorted') return 1
      if (b === 'Unsorted') return -1
      return a.localeCompare(b)
    })
}

function countLeaves(node) {
  if (!node) return 0
  if (Array.isArray(node)) return node.length
  let total = 0
  for (const k of Object.keys(node)) total += countLeaves(node[k])
  return total
}

function readLeaf(tree, sel) {
  const section = LIBRARY_SECTION_BY_ID[sel.type]
  if (!section) return []
  let cursor = tree[sel.type]
  if (!cursor) return []
  cursor = cursor[sel.syllabus]; if (!cursor) return []
  cursor = cursor[sel.grade];    if (!cursor) return []
  if (section.hasTerm) {
    cursor = cursor[sel.term];   if (!cursor) return []
  }
  cursor = cursor[sel.subject];  if (!cursor) return []
  if (section.hasAssessmentType) {
    cursor = cursor[sel.assess]; if (!cursor) return []
  }
  return Array.isArray(cursor) ? cursor : []
}

function buildCrumbs(sel) {
  const out = []
  if (sel.type) {
    const s = LIBRARY_SECTION_BY_ID[sel.type]
    out.push({ level: 'syllabus', label: s?.label || sel.type })
  }
  if (sel.syllabus) out.push({ level: 'grade',  label: sel.syllabus })
  if (sel.grade)    out.push({ level: 'term',   label: sel.grade })
  if (sel.term)     out.push({ level: 'subject', label: sel.term })
  if (sel.subject)  out.push({ level: 'assess',  label: sel.subject })
  return out
}

function labelForAssessment(syllabus, gradeForm, value) {
  if (!value) return ''
  const found = getAssessmentTypesForGradeForm(syllabus, gradeForm).find((t) => t.value === value)
  return found?.label || value
}
