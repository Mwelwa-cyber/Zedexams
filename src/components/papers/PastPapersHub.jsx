/**
 * /papers — public ECZ past-paper archive (audit A2), 2026 redesign.
 *
 * The audit calls this "the largest organic-demand gap in the Zambian
 * market" — ECZ past papers drive significant SEO traffic and are
 * typically the #1 reason a learner lands on a revision site. Grade 9
 * was phased out by ECZ, so the archive now covers Grade 7 and Grade
 * 12 only.
 *
 * Routing is open (no auth required) so search engines can index the
 * list and signed-out visitors browse before signing up. The actual
 * PDF viewer / download is auth-gated by Storage rules — that's the
 * incentive to register.
 *
 * Redesign goals (mobile-first, premium, low-clutter):
 *   - App-bar header with brand + ECZ Archive label + search / bell /
 *     "My runs".
 *   - Big search bar with an inline filter toggle.
 *   - Smart summary pills (paper count, quizzes, freshness).
 *   - Tappable chip filters (Grade / Subject / Year) + sort.
 *   - "Recommended for you" featured card + "Recently opened" rail.
 *   - Year-grouped, collapsible sections so the page never feels long.
 *   - Bookmark + clear quiz availability on every card; "Take quiz" is
 *     the primary action.
 *
 * Data: live Firestore (`listPublishedPapers`) is the source of truth.
 * If the archive is empty or the read fails we fall back to a small
 * curated sample set so the surface is never blank — the upload state
 * is still surfaced via the gentle banner above the sample.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  PAPER_GRADES,
  listPublishedPapers,
} from '../../utils/pastPapers'
import { PAPER_SUBJECTS } from '../../config/curriculum'
import SeoHelmet from '../seo/SeoHelmet'
import Logo from '../ui/Logo'
import Skeleton from '../ui/Skeleton'
import {
  BookOpen,
  BookmarkSquareIcon,
  Calculator,
  Check,
  ChevronDown,
  Clock,
  ComputerDesktop,
  FileText,
  Globe,
  Home,
  PencilLine,
  Search,
  Settings,
  Sparkles,
  StarIcon,
  User,
} from '../ui/icons'

const ANY = 'any'

// ── Subject presentation ────────────────────────────────────────────
// A lucide-named icon + a soft tint per subject so cards scan fast and
// feel warm without shouting. Falls back to a neutral document tile.
const SUBJECT_VISUALS = {
  english:                       { Icon: BookOpen,        tile: 'bg-amber-100 text-amber-700' },
  mathematics:                   { Icon: Calculator,      tile: 'bg-blue-100 text-blue-700' },
  'social-studies':              { Icon: Globe,           tile: 'bg-emerald-100 text-emerald-700' },
  'creative-technology-studies': { Icon: ComputerDesktop, tile: 'bg-violet-100 text-violet-700' },
  'home-economics':              { Icon: Sparkles,        tile: 'bg-rose-100 text-rose-700' },
  'special-paper-1':             { Icon: FileText,        tile: 'bg-indigo-100 text-indigo-700' },
}

// Short, learner-friendly labels for the filter chips (the design's
// fixed subject row). Real papers prefer the curriculum label.
const SUBJECT_FILTERS = [
  { id: 'english',                       label: 'English' },
  { id: 'mathematics',                   label: 'Maths' },
  { id: 'social-studies',                label: 'Social Studies' },
  { id: 'creative-technology-studies',   label: 'Technology' },
  { id: 'home-economics',                label: 'Home Ec.' },
  { id: 'special-paper-1',               label: 'Special Paper 1' },
]

const SUBJECT_LABEL = Object.fromEntries(SUBJECT_FILTERS.map((s) => [s.id, s.label]))

function subjectMeta(id) {
  const curriculum = PAPER_SUBJECTS.find((s) => s.id === id)
  return {
    label: SUBJECT_LABEL[id] || curriculum?.shortLabel || curriculum?.label || 'Paper',
    Icon: SUBJECT_VISUALS[id]?.Icon || FileText,
    tile: SUBJECT_VISUALS[id]?.tile || 'bg-orange-100 text-orange-700',
  }
}

function isSpecimen(paper) {
  return Boolean(paper.specimen) || /specimen/i.test(paper.title || '')
}

// ── Sample fallback (only shown when Firestore is empty / errors) ────
// 8 papers, 6 with a linked quiz — keeps the summary pills meaningful
// and demonstrates every card state before the real archive is loaded.
const SAMPLE_PAPERS = [
  { id: 's-tech-2025',    title: 'Grade 7 Technology Studies Past Paper 2025 (Specimen)', grade: '7',  subject: 'creative-technology-studies', year: 2025, quizId: 'sample', specimen: true },
  { id: 's-math12-2025',  title: 'Grade 12 Mathematics Past Paper 2025',                  grade: '12', subject: 'mathematics',                 year: 2025 },
  { id: 's-soc-2024',     title: 'Grade 7 Social Studies Past Paper 2024',                grade: '7',  subject: 'social-studies',              year: 2024, quizId: 'sample' },
  { id: 's-eng-2024',     title: 'Grade 7 English Past Paper 2024',                       grade: '7',  subject: 'english',                     year: 2024, quizId: 'sample' },
  { id: 's-math-2023',    title: 'Grade 7 Mathematics Past Paper 2023',                   grade: '7',  subject: 'mathematics',                 year: 2023, quizId: 'sample' },
  { id: 's-homeec-2023',  title: 'Grade 7 Home Economics Past Paper 2023',               grade: '7',  subject: 'home-economics',              year: 2023 },
  { id: 's-special-2022', title: 'Grade 7 Special Paper 1 Past Paper 2022',              grade: '7',  subject: 'special-paper-1',             year: 2022, quizId: 'sample' },
  { id: 's-eng12-2022',   title: 'Grade 12 English Past Paper 2022',                     grade: '12', subject: 'english',                     year: 2022, quizId: 'sample' },
]

const SORTS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'az',     label: 'A–Z' },
]

// ── localStorage helpers (bookmarks + recently opened) ──────────────
const BOOKMARK_KEY = 'zx_paper_bookmarks'
const RECENT_KEY = 'zx_recent_papers'

function readStored(key) {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode / quota — bookmarks are best-effort */
  }
}

// ── Small building blocks ───────────────────────────────────────────

function Pill({ Icon, children }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full theme-card border theme-border px-3 py-1.5 text-xs font-bold theme-text-muted shadow-elev-sm">
      <Icon size={14} className="theme-accent-text" strokeWidth={2.2} />
      {children}
    </div>
  )
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border-2 px-3.5 py-2 text-xs font-bold transition-colors active:scale-95 ${
        active
          ? 'theme-accent-fill theme-on-accent border-transparent shadow-elev-sm'
          : 'theme-card theme-border theme-text-muted hover:theme-text'
      }`}
    >
      {children}
    </button>
  )
}

function QuizBadge({ available }) {
  if (available) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px] font-black">
        <Check size={12} strokeWidth={3} />
        Quiz available
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full theme-bg-subtle theme-text-muted px-2 py-0.5 text-[11px] font-bold">
      <Clock size={12} strokeWidth={2.4} />
      Quiz coming soon
    </span>
  )
}

function BookmarkButton({ saved, onToggle, title }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`}
      className={`flex-shrink-0 grid place-items-center w-9 h-9 rounded-full border transition-colors active:scale-90 ${
        saved
          ? 'theme-accent-text border-transparent bg-orange-50'
          : 'theme-border theme-text-muted hover:theme-text'
      }`}
    >
      <BookmarkSquareIcon size={18} strokeWidth={saved ? 2.6 : 2} />
    </button>
  )
}

function PaperCard({ paper, saved, onToggleSave, onOpen, featured = false }) {
  const { label, Icon, tile } = subjectMeta(paper.subject)
  const hasQuiz = Boolean(paper.quizId)
  const specimen = isSpecimen(paper)

  return (
    <article
      className={`theme-card rounded-radius-md p-4 flex flex-col gap-3 transition-shadow ${
        featured
          ? 'border-2 border-orange-400 shadow-elev-md'
          : 'border-2 theme-border shadow-elev-sm hover:shadow-elev-md'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-11 h-11 rounded-2xl grid place-items-center ${tile}`}>
          <Icon size={22} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="theme-text font-black text-sm leading-snug">{paper.title}</h3>
          <p className="theme-text-muted text-xs mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span>Grade {paper.grade}</span>
            <span aria-hidden="true">•</span>
            <span>{label}</span>
            <span aria-hidden="true">•</span>
            <span>{paper.year}</span>
          </p>
        </div>
        <BookmarkButton saved={saved} onToggle={onToggleSave} title={paper.title} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {specimen && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 theme-accent-text px-2 py-0.5 text-[11px] font-black">
            <StarIcon size={12} strokeWidth={2.6} />
            Specimen
          </span>
        )}
        <QuizBadge available={hasQuiz} />
      </div>

      <div className="flex items-center gap-2 pt-0.5">
        {hasQuiz && (
          <Link
            to={`/papers/${paper.id}/quiz`}
            onClick={() => onOpen(paper.id)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full theme-accent-fill theme-on-accent text-sm font-black px-4 py-2.5 hover:opacity-90 active:scale-95 transition"
          >
            <PencilLine size={16} strokeWidth={2.4} />
            Take quiz
          </Link>
        )}
        <Link
          to={`/papers/${paper.id}`}
          onClick={() => onOpen(paper.id)}
          className={`inline-flex items-center justify-center gap-1.5 rounded-full border-2 theme-border theme-text text-sm font-bold px-4 py-2.5 hover:theme-bg-subtle active:scale-95 transition ${
            hasQuiz ? '' : 'flex-1'
          }`}
        >
          <BookOpen size={16} strokeWidth={2.2} />
          View paper
        </Link>
      </div>
    </article>
  )
}

function YearGroup({ year, papers, open, onToggle, savedIds, onToggleSave, onOpen }) {
  const quizzes = papers.filter((p) => p.quizId).length
  return (
    <section className="theme-card border-2 theme-border rounded-radius-md shadow-elev-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 hover:theme-bg-subtle transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-10 h-10 rounded-xl theme-bg-subtle theme-accent-text font-black text-sm">
            {String(year).slice(-2)}
          </span>
          <div className="text-left">
            <p className="theme-text font-black text-lg leading-none">{year}</p>
            <p className="theme-text-muted text-xs mt-1">
              {papers.length} {papers.length === 1 ? 'paper' : 'papers'}
              {quizzes > 0 && ` · ${quizzes} with quiz`}
            </p>
          </div>
        </div>
        <ChevronDown
          size={20}
          strokeWidth={2.4}
          className={`theme-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 grid gap-3 sm:grid-cols-2">
          {papers.map((paper) => (
            <PaperCard
              key={paper.id}
              paper={paper}
              saved={savedIds.has(paper.id)}
              onToggleSave={() => onToggleSave(paper.id)}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function BottomNav() {
  const items = [
    { to: '/dashboard', label: 'Home', Icon: Home },
    { to: '/lessons', label: 'Library', Icon: BookOpen },
    { to: '/papers', label: 'Past Papers', Icon: FileText, active: true },
    { to: '/quizzes', label: 'Quizzes', Icon: PencilLine },
    { to: '/profile', label: 'Profile', Icon: User },
  ]
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 theme-card border-t theme-border safe-area-bottom"
      aria-label="Primary navigation"
    >
      <div className="max-w-5xl mx-auto flex">
        {items.map(({ to, label, Icon, active }) => (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition active:scale-95 ${
              active ? 'theme-accent-text' : 'theme-text-muted hover:theme-text'
            }`}
          >
            <span
              className={`grid place-items-center w-10 h-7 rounded-full ${
                active ? 'bg-orange-100' : ''
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
            </span>
            <span className={`text-[11px] ${active ? 'font-black' : 'font-bold'}`}>{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}

// ── Page ────────────────────────────────────────────────────────────

export default function PastPapersHub() {
  const { currentUser } = useAuth()
  const [searchParams] = useSearchParams()
  const searchRef = useRef(null)

  const [loaded, setLoaded] = useState([])
  const [loading, setLoading] = useState(true)
  const [usingSample, setUsingSample] = useState(false)

  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState(() => {
    const g = searchParams.get('grade')
    return g && PAPER_GRADES.includes(g) ? g : ANY
  })
  const [subject, setSubject] = useState(ANY)
  const [year, setYear] = useState(ANY)
  const [sort, setSort] = useState('newest')
  const [sortOpen, setSortOpen] = useState(false)
  const [showFilters, setShowFilters] = useState(true)

  const [savedIds, setSavedIds] = useState(() => new Set(readStored(BOOKMARK_KEY)))
  const [recentIds, setRecentIds] = useState(() => readStored(RECENT_KEY))
  const [expandedYears, setExpandedYears] = useState(() => new Set())

  // Load live papers; fall back to the curated sample if empty/error so
  // the surface is never blank (and the redesign is fully visible).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listPublishedPapers({})
      .then((rows) => {
        if (cancelled) return
        const visible = rows.filter((p) => PAPER_GRADES.includes(String(p.grade)))
        if (visible.length) {
          setLoaded(visible)
          setUsingSample(false)
        } else {
          setLoaded(SAMPLE_PAPERS)
          setUsingSample(true)
        }
      })
      .catch((err) => {
        console.warn('[PastPapersHub] list failed', err)
        if (!cancelled) {
          setLoaded(SAMPLE_PAPERS)
          setUsingSample(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const toggleSave = (id) => {
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStored(BOOKMARK_KEY, [...next])
      return next
    })
  }

  const recordOpen = (id) => {
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8)
      writeStored(RECENT_KEY, next)
      return next
    })
  }

  // Build the year filter universe from the active dataset.
  const availableYears = useMemo(() => {
    const years = new Set()
    for (const p of loaded) if (typeof p.year === 'number') years.add(p.year)
    return [...years].sort((a, b) => b - a)
  }, [loaded])

  // Apply search + chip filters + sort.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = loaded.filter((p) => {
      if (grade !== ANY && String(p.grade) !== grade) return false
      if (subject !== ANY && p.subject !== subject) return false
      if (year !== ANY && p.year !== Number(year)) return false
      if (q) {
        const hay = `${p.title} ${subjectMeta(p.subject).label} ${p.year} grade ${p.grade}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const sorted = [...rows]
    if (sort === 'az') sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    else if (sort === 'oldest') sorted.sort((a, b) => (a.year || 0) - (b.year || 0))
    else sorted.sort((a, b) => (b.year || 0) - (a.year || 0))
    return sorted
  }, [loaded, query, grade, subject, year, sort])

  // Group filtered papers by year (newest first); expand the top group.
  const grouped = useMemo(() => {
    const byYear = new Map()
    for (const p of filtered) {
      const key = p.year || 'Undated'
      if (!byYear.has(key)) byYear.set(key, [])
      byYear.get(key).push(p)
    }
    return [...byYear.entries()]
      .sort((a, b) => (Number(b[0]) || 0) - (Number(a[0]) || 0))
      .map(([y, list]) => ({ year: y, papers: list }))
  }, [filtered])

  // Default-expand the first (newest) year group whenever the grouping
  // changes, without clobbering the learner's manual toggles.
  useEffect(() => {
    if (grouped.length) setExpandedYears(new Set([String(grouped[0].year)]))
  }, [grouped.length, sort, grade, subject, year, query]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleYear = (y) => {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      const key = String(y)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Summary pills.
  const totalPapers = loaded.length
  const quizCount = useMemo(() => loaded.filter((p) => p.quizId).length, [loaded])

  // "Recommended for you" — prefer a specimen, else the newest paper
  // that has a quiz, else the newest paper overall.
  const recommended = useMemo(() => {
    if (!loaded.length) return null
    return (
      loaded.find((p) => isSpecimen(p))
      || [...loaded].filter((p) => p.quizId).sort((a, b) => (b.year || 0) - (a.year || 0))[0]
      || [...loaded].sort((a, b) => (b.year || 0) - (a.year || 0))[0]
      || null
    )
  }, [loaded])

  // "Recently opened" — map stored ids back to live papers (cap 3).
  const recentlyOpened = useMemo(() => {
    const byId = new Map(loaded.map((p) => [p.id, p]))
    return recentIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 3)
  }, [recentIds, loaded])

  const hasActiveFilter = grade !== ANY || subject !== ANY || year !== ANY || query.trim()
  const clearFilters = () => {
    setGrade(ANY); setSubject(ANY); setYear(ANY); setQuery('')
  }

  return (
    <div className="admin-game-theme min-h-screen theme-bg theme-text pb-24">
      <SeoHelmet
        title="ECZ Past Papers — Grade 7 & Grade 12 archive"
        description="Browse the official ECZ past-paper archive — Grade 7 and Grade 12 papers across every CBC subject. Sign in to download papers and take linked quizzes."
        path="/papers"
      />

      {/* 1 — App-bar header */}
      <header className="sticky top-0 z-30 theme-card backdrop-blur border-b theme-border">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <Logo variant="icon" size="sm" className="!h-9 !w-9" />
            <span className="hidden sm:inline font-display font-black theme-text text-base">ZedExams</span>
            <span className="rounded-full bg-orange-100 theme-accent-text text-[10px] font-black px-2 py-0.5 uppercase tracking-wide whitespace-nowrap">
              ECZ Archive
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => searchRef.current?.focus()}
              aria-label="Search papers"
              className="grid place-items-center w-9 h-9 rounded-full theme-text-muted hover:theme-text hover:theme-bg-subtle transition"
            >
              <Search size={20} strokeWidth={2.2} />
            </button>
            <Link
              to={currentUser ? '/my-papers' : '/login'}
              className="ml-1 inline-flex items-center gap-1.5 rounded-full theme-accent-fill theme-on-accent text-xs font-black px-3 py-2 hover:opacity-90 active:scale-95 transition"
            >
              <Clock size={15} strokeWidth={2.4} />
              <span className="hidden sm:inline">My runs</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4">
        {/* 2 — Page title */}
        <div className="pt-6 pb-4">
          <h1 className="font-display font-black text-3xl sm:text-4xl theme-text">Past Papers</h1>
          <p className="theme-text-muted text-sm sm:text-base mt-2 max-w-2xl">
            Browse Grade 7 and Grade 12 ECZ past papers by subject and year.
          </p>
        </div>

        {/* 3 — Search bar with inline filter toggle */}
        <div className="relative">
          <Search
            size={20}
            strokeWidth={2.2}
            className="absolute left-4 top-1/2 -translate-y-1/2 theme-text-muted pointer-events-none"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search papers, subjects, or year"
            className="w-full rounded-full theme-card border-2 theme-border pl-12 pr-14 py-3.5 text-sm font-medium theme-text placeholder:theme-text-muted shadow-elev-sm focus:outline-none focus:border-orange-300 transition"
            aria-label="Search papers, subjects, or year"
          />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Toggle filters"
            aria-expanded={showFilters}
            className={`absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-10 h-10 rounded-full transition active:scale-90 ${
              showFilters ? 'theme-accent-fill theme-on-accent' : 'theme-bg-subtle theme-text-muted hover:theme-text'
            }`}
          >
            <Settings size={18} strokeWidth={2.2} />
          </button>
        </div>

        {/* 4 — Smart summary row */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill Icon={FileText}>{totalPapers} {totalPapers === 1 ? 'paper' : 'papers'}</Pill>
          <Pill Icon={PencilLine}>{quizCount} {quizCount === 1 ? 'quiz' : 'quizzes'} available</Pill>
          <Pill Icon={Sparkles}>Updated weekly</Pill>
        </div>

        {usingSample && !loading && (
          <div className="mt-3 flex items-start gap-2 rounded-radius-md bg-orange-50 border border-orange-200 px-3 py-2.5 text-xs theme-text">
            <Sparkles size={16} strokeWidth={2.2} className="theme-accent-text flex-shrink-0 mt-0.5" />
            <span>
              Showing sample papers while we upload the official ECZ archive.{' '}
              <a className="theme-accent-text font-black underline" href="https://wa.me/260977740465">
                Get notified
              </a>{' '}
              when the first batch lands.
            </span>
          </div>
        )}

        {/* 5 — Filter panel */}
        {showFilters && (
          <div className="mt-4 theme-card border-2 theme-border rounded-radius-md p-4 shadow-elev-sm space-y-4">
            <div className="space-y-2">
              <p className="text-[11px] font-black theme-text-muted uppercase tracking-widest">Grade</p>
              <div className="flex flex-wrap gap-2">
                <FilterChip active={grade === ANY} onClick={() => setGrade(ANY)}>All</FilterChip>
                {PAPER_GRADES.map((g) => (
                  <FilterChip key={g} active={grade === g} onClick={() => setGrade(g)}>Grade {g}</FilterChip>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-black theme-text-muted uppercase tracking-widest">Subject</p>
              <div className="flex flex-wrap gap-2">
                <FilterChip active={subject === ANY} onClick={() => setSubject(ANY)}>All</FilterChip>
                {SUBJECT_FILTERS.map((s) => (
                  <FilterChip key={s.id} active={subject === s.id} onClick={() => setSubject(s.id)}>
                    {s.label}
                  </FilterChip>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-black theme-text-muted uppercase tracking-widest">Year</p>
              <div className="flex flex-wrap gap-2">
                <FilterChip active={year === ANY} onClick={() => setYear(ANY)}>All</FilterChip>
                {(availableYears.length ? availableYears : [2025, 2024, 2023, 2022]).map((y) => (
                  <FilterChip key={y} active={year === String(y)} onClick={() => setYear(String(y))}>{y}</FilterChip>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t theme-border">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSortOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold theme-text-muted hover:theme-text mt-2"
                  aria-haspopup="listbox"
                  aria-expanded={sortOpen}
                >
                  Sort by:{' '}
                  <span className="theme-text font-black">{SORTS.find((s) => s.id === sort)?.label}</span>
                  <ChevronDown size={14} strokeWidth={2.4} className={sortOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                {sortOpen && (
                  <ul
                    role="listbox"
                    className="absolute left-0 top-full mt-1 z-10 theme-card border theme-border rounded-xl shadow-elev-md overflow-hidden min-w-[8rem]"
                  >
                    {SORTS.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={sort === s.id}
                          onClick={() => { setSort(s.id); setSortOpen(false) }}
                          className={`w-full text-left px-3 py-2 text-xs font-bold hover:theme-bg-subtle ${
                            sort === s.id ? 'theme-accent-text' : 'theme-text'
                          }`}
                        >
                          {s.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-bold theme-accent-text hover:underline mt-2"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="mt-6 space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-radius-md" />)}
          </div>
        ) : (
          <>
            {/* 6 — Recommended for you */}
            {recommended && !hasActiveFilter && (
              <section className="mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={18} strokeWidth={2.4} className="theme-accent-text" />
                  <h2 className="font-display font-black text-lg theme-text">Recommended for you</h2>
                </div>
                <PaperCard
                  paper={recommended}
                  saved={savedIds.has(recommended.id)}
                  onToggleSave={() => toggleSave(recommended.id)}
                  onOpen={recordOpen}
                  featured
                />
              </section>
            )}

            {/* 7 — Recently opened */}
            {recentlyOpened.length > 0 && (
              <section className="mt-6">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Clock size={18} strokeWidth={2.4} className="theme-accent-text" />
                    <h2 className="font-display font-black text-lg theme-text">Recently opened</h2>
                  </div>
                  <Link to={currentUser ? '/my-papers' : '/login'} className="text-xs font-black theme-accent-text hover:underline">
                    View all
                  </Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {recentlyOpened.map((paper) => (
                    <PaperCard
                      key={paper.id}
                      paper={paper}
                      saved={savedIds.has(paper.id)}
                      onToggleSave={() => toggleSave(paper.id)}
                      onOpen={recordOpen}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 8 + 9 — Browse by year (collapsible) */}
            <section className="mt-6">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="font-display font-black text-lg theme-text">Browse by year</h2>
                <span className="text-xs font-bold theme-text-muted">
                  {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
                </span>
              </div>

              {grouped.length === 0 ? (
                <div className="theme-card border-2 theme-border rounded-radius-md p-8 text-center shadow-elev-sm">
                  <div className="mx-auto w-12 h-12 rounded-2xl theme-bg-subtle grid place-items-center mb-3">
                    <Search size={24} strokeWidth={2} className="theme-text-muted" />
                  </div>
                  <h3 className="theme-text font-black">No papers match your filters</h3>
                  <p className="theme-text-muted text-sm mt-1">Try a different grade, subject, or year.</p>
                  {hasActiveFilter && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-full theme-accent-fill theme-on-accent text-xs font-black px-4 py-2"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {grouped.map(({ year: y, papers: list }) => (
                    <YearGroup
                      key={String(y)}
                      year={y}
                      papers={list}
                      open={expandedYears.has(String(y))}
                      onToggle={() => toggleYear(y)}
                      savedIds={savedIds}
                      onToggleSave={toggleSave}
                      onOpen={recordOpen}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* 10 — Bottom navigation */}
      <BottomNav />
    </div>
  )
}
