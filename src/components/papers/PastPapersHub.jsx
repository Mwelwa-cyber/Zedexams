/**
 * /papers — public ECZ past-paper archive (audit A2), 2026 mobile-first
 * redesign.
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
 * Redesign goals (premium, low-clutter, phone-first):
 *   - Compact title block ("Past Papers" + a one-line subtitle), minimal
 *     top chrome — no stat chips, no heavy app-bar.
 *   - Search first: one big rounded search field with a Filters button
 *     tucked inside it on the right.
 *   - Filters are hidden by default — the Filters button opens a bottom
 *     sheet with pill chips (Grade / Subject / Year + sort).
 *   - "Recommended" is a single compact card (badges + title, actions
 *     on their own row so nothing collides on narrow phones).
 *   - Papers render as compact one-row list cards so several fit on a
 *     phone screen at once.
 *   - "Browse by year" is a single-open accordion — tapping a year
 *     collapses the others, so the page never feels long.
 *   - Soft shadows, generous whitespace, almost no borders, 16–24px
 *     rounded corners, orange accent on a warm off-white background.
 *   - A floating glassmorphism bottom navigation bar.
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
  getCachedPublishedPapers,
  loadPublishedPapers,
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
  SlidersHorizontal,
  Sparkles,
  StarIcon,
  User,
  X,
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

// Short, learner-friendly labels for the filter chips. Real papers
// prefer the curriculum label.
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

// Quiz availability badge — a tiny dot pill that scans instantly in a
// dense list. Two variants: ready (green) vs coming soon (muted).
function QuizBadge({ available, compact = false }) {
  if (available) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">
        <Check size={11} strokeWidth={3} />
        Quiz
      </span>
    )
  }
  if (compact) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full theme-bg-subtle theme-text-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
      <Clock size={11} strokeWidth={2.4} />
      Soon
    </span>
  )
}

// A pill chip used inside the filter sheet. Active = orange fill.
function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-2 text-sm font-bold transition active:scale-95 ${
        active
          ? 'theme-accent-fill theme-on-accent shadow-elev-sm'
          : 'theme-bg-subtle theme-text-muted hover:theme-text'
      }`}
    >
      {children}
    </button>
  )
}

// Bottom sheet — slides up from the bottom on a dimmed, blurred
// backdrop. Used for the hidden filters panel.
function BottomSheet({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
      />
      <div className="relative theme-card rounded-t-[28px] shadow-elev-xl max-h-[85vh] flex flex-col animate-slide-up">
        <div className="pt-3 pb-1 grid place-items-center">
          <span className="h-1.5 w-10 rounded-full theme-bg-subtle" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between px-5 pt-1 pb-3">
          <h2 className="font-display font-black text-lg theme-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="grid place-items-center w-9 h-9 rounded-full theme-bg-subtle theme-text-muted hover:theme-text active:scale-90 transition"
          >
            <X size={18} strokeWidth={2.4} />
          </button>
        </div>
        <div className="px-5 overflow-y-auto pb-2">{children}</div>
        {footer && <div className="px-5 py-4 border-t theme-border safe-area-bottom">{footer}</div>}
      </div>
    </div>
  )
}

// ── Recommended (compact card: badges + full title, actions below) ──
// Stacked on purpose: on a 360px phone a single row can't fit the badge
// pair, the title, AND two buttons — the title truncated to a few words
// and the chips collided with the buttons. Two short rows read cleanly.
function RecommendedCard({ paper, onOpen }) {
  const { label, Icon, tile } = subjectMeta(paper.subject)
  const hasQuiz = Boolean(paper.quizId)
  const viewTo = paper.slug ? `/papers/${paper.id}/${paper.slug}` : `/papers/${paper.id}`

  return (
    <div className="theme-card rounded-radius-lg shadow-elev-md p-3.5 ring-1 ring-orange-200">
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-12 h-12 rounded-2xl grid place-items-center ${tile}`}>
          <Icon size={24} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {hasQuiz && <QuizBadge available />}
            <span className="text-[10px] font-bold theme-text-muted uppercase tracking-wide truncate">{label}</span>
          </div>
          <h3 className="theme-text font-black text-sm leading-snug line-clamp-2 mt-1">{paper.title}</h3>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {hasQuiz && (
          <Link
            to={`/papers/${paper.id}/quiz`}
            onClick={() => onOpen(paper.id)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full theme-accent-fill theme-on-accent text-xs font-black px-4 py-2.5 active:scale-95 transition"
          >
            <PencilLine size={14} strokeWidth={2.4} />
            Take quiz
          </Link>
        )}
        <Link
          to={viewTo}
          onClick={() => onOpen(paper.id)}
          className="flex-1 inline-flex items-center justify-center rounded-full theme-bg-subtle theme-text text-xs font-bold px-4 py-2.5 active:scale-95 transition"
        >
          View paper
        </Link>
      </div>
    </div>
  )
}

// ── Compact list-style paper card (one short row) ───────────────────
function PaperRow({ paper, saved, onToggleSave, onOpen }) {
  const { Icon, tile } = subjectMeta(paper.subject)
  const hasQuiz = Boolean(paper.quizId)
  const specimen = isSpecimen(paper)
  const viewTo = paper.slug ? `/papers/${paper.id}/${paper.slug}` : `/papers/${paper.id}`

  return (
    // min-w-0 matters: as a grid item, without it the nowrap (truncate)
    // title sets a min-content wider than a phone screen, the track
    // overflows, and the accordion's overflow-hidden clips the quiz +
    // bookmark buttons off the right edge.
    <div className="group min-w-0 theme-card rounded-radius-md shadow-elev-sm hover:shadow-elev-md transition-shadow flex items-center gap-3 p-2.5 pr-3">
      <Link
        to={viewTo}
        onClick={() => onOpen(paper.id)}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <div className={`flex-shrink-0 w-11 h-11 rounded-xl grid place-items-center ${tile}`}>
          <Icon size={20} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="theme-text font-bold text-sm leading-snug truncate">{paper.title}</h3>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1">
            <span className="text-[11px] font-bold theme-text-muted whitespace-nowrap">Grade {paper.grade}</span>
            <span className="text-[11px] theme-text-muted" aria-hidden="true">·</span>
            <span className="text-[11px] font-bold theme-text-muted">{paper.year}</span>
            {specimen && <StarIcon size={12} strokeWidth={2.6} className="theme-accent-text" />}
            <QuizBadge available={hasQuiz} compact />
          </div>
        </div>
      </Link>

      <div className="flex-shrink-0 flex items-center gap-1">
        {hasQuiz && (
          <Link
            to={`/papers/${paper.id}/quiz`}
            onClick={() => onOpen(paper.id)}
            aria-label={`Take quiz for ${paper.title}`}
            className="grid place-items-center w-9 h-9 rounded-full theme-accent-fill theme-on-accent active:scale-90 transition"
          >
            <PencilLine size={16} strokeWidth={2.4} />
          </Link>
        )}
        <button
          type="button"
          onClick={onToggleSave}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${paper.title} from saved` : `Save ${paper.title}`}
          className={`grid place-items-center w-9 h-9 rounded-full transition active:scale-90 ${
            saved ? 'theme-accent-text bg-orange-50' : 'theme-text-muted hover:theme-bg-subtle'
          }`}
        >
          <BookmarkSquareIcon size={17} strokeWidth={saved ? 2.6 : 2} />
        </button>
      </div>
    </div>
  )
}

// ── Year accordion (single-open) ────────────────────────────────────
function YearAccordion({ year, papers, open, onToggle, savedIds, onToggleSave, onOpen }) {
  const quizzes = papers.filter((p) => p.quizId).length
  return (
    <div className="theme-card rounded-radius-md shadow-elev-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 hover:theme-bg-subtle transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="theme-text font-black text-base">{year}</span>
          <span className="rounded-full theme-bg-subtle theme-text-muted text-[11px] font-black px-2 py-0.5">
            {papers.length}
          </span>
          {quizzes > 0 && (
            <span className="hidden sm:inline text-[11px] font-bold text-emerald-600">{quizzes} with quiz</span>
          )}
        </div>
        <ChevronDown
          size={20}
          strokeWidth={2.4}
          className={`theme-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {papers.map((paper) => (
            <PaperRow
              key={paper.id}
              paper={paper}
              saved={savedIds.has(paper.id)}
              onToggleSave={() => onToggleSave(paper.id)}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Floating glassmorphism bottom navigation ────────────────────────
function BottomNav() {
  const items = [
    { to: '/dashboard', label: 'Home', Icon: Home },
    { to: '/lessons', label: 'Library', Icon: BookOpen },
    { to: '/papers', label: 'Papers', Icon: FileText, active: true },
    { to: '/quizzes', label: 'Quizzes', Icon: PencilLine },
    { to: '/profile', label: 'Profile', Icon: User },
  ]
  return (
    <nav
      className="fixed bottom-3 left-3 right-3 z-40 mx-auto max-w-md safe-area-bottom"
      aria-label="Primary navigation"
    >
      <div className="flex items-center justify-around rounded-full border border-white/40 bg-white/70 px-2 py-1.5 shadow-elev-lg backdrop-blur-xl dark:bg-white/10 dark:border-white/10">
        {items.map(({ to, label, Icon, active }) => (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 rounded-2xl px-3 py-1.5 transition active:scale-95 ${
              active ? 'theme-accent-text' : 'theme-text-muted hover:theme-text'
            }`}
          >
            <span className={`grid place-items-center h-7 w-9 rounded-full transition ${active ? 'bg-orange-100' : ''}`}>
              <Icon size={20} strokeWidth={active ? 2.6 : 2} />
            </span>
            <span className={`text-[10px] ${active ? 'font-black' : 'font-bold'}`}>{label}</span>
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

  // Seed from the per-tab / sessionStorage cache so a revisit to /papers
  // paints instantly instead of waiting on a cold full-archive read.
  const cachedOnMount = getCachedPublishedPapers()
  const [loaded, setLoaded] = useState(() =>
    cachedOnMount ? cachedOnMount.filter((p) => PAPER_GRADES.includes(String(p.grade))) : [],
  )
  const [loading, setLoading] = useState(() => !cachedOnMount)
  const [usingSample, setUsingSample] = useState(false)

  const [query, setQuery] = useState('')
  const [grade, setGrade] = useState(() => {
    const g = searchParams.get('grade')
    return g && PAPER_GRADES.includes(g) ? g : ANY
  })
  // ?subject= mirrors the ?grade= seeding above — deep links from the exam
  // timetable's quick actions land pre-filtered on the right subject.
  const [subject, setSubject] = useState(() => {
    const s = searchParams.get('subject')
    return s && PAPER_SUBJECTS.some((p) => p.id === s) ? s : ANY
  })
  const [year, setYear] = useState(ANY)
  const [sort, setSort] = useState('newest')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [savedIds, setSavedIds] = useState(() => new Set(readStored(BOOKMARK_KEY)))
  const [recentIds, setRecentIds] = useState(() => readStored(RECENT_KEY))
  // Single-open accordion: only one year expanded at a time.
  const [openYear, setOpenYear] = useState(null)

  // Revalidate against live Firestore. When the cache already painted
  // a list we refresh in the background (no spinner, and a transient
  // failure keeps the cached rows on screen). Fall back to the curated
  // sample only when there's nothing cached to show.
  useEffect(() => {
    let cancelled = false
    const hadCache = Boolean(getCachedPublishedPapers())
    if (!hadCache) setLoading(true)
    loadPublishedPapers()
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
        if (!cancelled && !hadCache) {
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

  // Apply search + filters + sort.
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

  // Group filtered papers by year (newest first).
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

  // Default-open the first (newest) year group whenever the grouping
  // changes so the page is never empty, without clobbering a manual tap.
  useEffect(() => {
    if (grouped.length) setOpenYear(String(grouped[0].year))
    else setOpenYear(null)
  }, [grouped.length, sort, grade, subject, year, query]) // eslint-disable-line react-hooks/exhaustive-deps

  // Single-open accordion: tapping the open year closes it, tapping any
  // other year switches to it (collapsing the previous one).
  const toggleYear = (y) => {
    const key = String(y)
    setOpenYear((cur) => (cur === key ? null : key))
  }

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

  // "Recently opened" — map stored ids back to live papers (cap 4).
  const recentlyOpened = useMemo(() => {
    const byId = new Map(loaded.map((p) => [p.id, p]))
    return recentIds.map((id) => byId.get(id)).filter(Boolean).slice(0, 4)
  }, [recentIds, loaded])

  const activeFilterCount =
    (grade !== ANY ? 1 : 0) + (subject !== ANY ? 1 : 0) + (year !== ANY ? 1 : 0)
  const hasActiveFilter = activeFilterCount > 0 || Boolean(query.trim())
  const clearFilters = () => {
    setGrade(ANY); setSubject(ANY); setYear(ANY); setQuery('')
  }

  const yearOptions = availableYears.length ? availableYears : [2025, 2024, 2023, 2022]

  return (
    <div className="admin-game-theme min-h-screen theme-bg theme-text pb-28">
      <SeoHelmet
        title="ECZ Past Papers — Grade 7 & Grade 12 archive"
        description="Browse the official ECZ past-paper archive — Grade 7 and Grade 12 papers across every CBC subject. Sign in to download papers and take linked quizzes."
        path="/papers"
      />

      {/* Slim top bar — brand + "My runs". Primary nav lives in the
          floating bottom bar, so the header stays minimal. */}
      <header className="sticky top-0 z-30 theme-bg">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <Logo variant="icon" size="sm" className="!h-8 !w-8" />
            <span className="rounded-full bg-orange-100 theme-accent-text text-[10px] font-black px-2 py-0.5 uppercase tracking-wide whitespace-nowrap">
              ECZ Archive
            </span>
          </Link>
          <Link
            to={currentUser ? '/my-papers' : '/login'}
            className="inline-flex items-center gap-1.5 rounded-full theme-bg-subtle theme-text text-xs font-bold px-3 py-2 active:scale-95 transition"
          >
            <Clock size={14} strokeWidth={2.4} className="theme-accent-text" />
            My runs
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4">
        {/* 1 — Compact title block */}
        <div className="pt-3 pb-4">
          <h1 className="font-display font-black text-2xl theme-text leading-tight">Past Papers</h1>
          <p className="theme-text-muted text-sm mt-0.5">Grade 7 &amp; Grade 12 ECZ Papers</p>
        </div>

        {/* 2 — Search first, with a Filters button inside on the right */}
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
            className="w-full rounded-full theme-card pl-12 pr-14 py-3.5 text-sm font-medium theme-text placeholder:theme-text-muted shadow-elev-sm focus:outline-none focus:ring-2 focus:ring-orange-300 transition"
            aria-label="Search papers, subjects, or year"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label="Filters"
            className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-10 h-10 rounded-full theme-accent-fill theme-on-accent active:scale-90 transition"
          >
            <SlidersHorizontal size={18} strokeWidth={2.2} />
            {activeFilterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-white text-orange-600 text-[10px] font-black shadow-elev-sm">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Active-filter summary chips (only when something is set) */}
        {hasActiveFilter && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {grade !== ANY && (
              <button type="button" onClick={() => setGrade(ANY)} className="inline-flex items-center gap-1 rounded-full theme-accent-fill theme-on-accent text-xs font-bold px-3 py-1.5 active:scale-95">
                Grade {grade} <X size={13} strokeWidth={2.6} />
              </button>
            )}
            {subject !== ANY && (
              <button type="button" onClick={() => setSubject(ANY)} className="inline-flex items-center gap-1 rounded-full theme-accent-fill theme-on-accent text-xs font-bold px-3 py-1.5 active:scale-95">
                {SUBJECT_LABEL[subject] || 'Subject'} <X size={13} strokeWidth={2.6} />
              </button>
            )}
            {year !== ANY && (
              <button type="button" onClick={() => setYear(ANY)} className="inline-flex items-center gap-1 rounded-full theme-accent-fill theme-on-accent text-xs font-bold px-3 py-1.5 active:scale-95">
                {year} <X size={13} strokeWidth={2.6} />
              </button>
            )}
            <button type="button" onClick={clearFilters} className="text-xs font-black theme-accent-text hover:underline px-1">
              Clear all
            </button>
          </div>
        )}

        {usingSample && !loading && (
          <div className="mt-3 flex items-start gap-2 rounded-radius-md bg-orange-50 px-3 py-2.5 text-xs theme-text">
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

        {loading ? (
          <div className="mt-6 space-y-2.5">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-radius-md" />)}
          </div>
        ) : (
          <>
            {/* 4 — Recommended (single slim horizontal card) */}
            {recommended && !hasActiveFilter && (
              <section className="mt-5">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Sparkles size={16} strokeWidth={2.4} className="theme-accent-text" />
                  <h2 className="font-display font-black text-sm theme-text uppercase tracking-wide">Recommended</h2>
                </div>
                <RecommendedCard paper={recommended} onOpen={recordOpen} />
              </section>
            )}

            {/* Recently opened — compact horizontal scroll rail */}
            {recentlyOpened.length > 0 && (
              <section className="mt-5">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <Clock size={16} strokeWidth={2.4} className="theme-accent-text" />
                    <h2 className="font-display font-black text-sm theme-text uppercase tracking-wide">Recently opened</h2>
                  </div>
                  <Link to={currentUser ? '/my-papers' : '/login'} className="text-xs font-black theme-accent-text hover:underline">
                    View all
                  </Link>
                </div>
                <div className="-mx-4 px-4 flex gap-2.5 overflow-x-auto pb-1 no-scrollbar">
                  {recentlyOpened.map((paper) => {
                    const { Icon, tile, label } = subjectMeta(paper.subject)
                    const viewTo = paper.slug ? `/papers/${paper.id}/${paper.slug}` : `/papers/${paper.id}`
                    return (
                      <Link
                        key={paper.id}
                        to={viewTo}
                        onClick={() => recordOpen(paper.id)}
                        className="flex-shrink-0 w-40 theme-card rounded-radius-md shadow-elev-sm p-3 active:scale-95 transition"
                      >
                        <div className={`w-9 h-9 rounded-xl grid place-items-center ${tile}`}>
                          <Icon size={18} strokeWidth={2.2} />
                        </div>
                        <p className="text-[11px] font-bold theme-text-muted mt-2">{label} · {paper.year}</p>
                        <p className="text-xs font-bold theme-text leading-snug line-clamp-2 mt-0.5">{paper.title}</p>
                      </Link>
                    )
                  })}
                </div>
              </section>
            )}

            {/* 5 + 6 — Browse by year (single-open accordion of compact rows) */}
            <section className="mt-5">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <h2 className="font-display font-black text-sm theme-text uppercase tracking-wide">Browse by year</h2>
                <span className="text-xs font-bold theme-text-muted">
                  {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
                </span>
              </div>

              {grouped.length === 0 ? (
                <div className="theme-card rounded-radius-md p-8 text-center shadow-elev-sm">
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
                <div className="space-y-2.5">
                  {grouped.map(({ year: y, papers: list }) => (
                    <YearAccordion
                      key={String(y)}
                      year={y}
                      papers={list}
                      open={openYear === String(y)}
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

      {/* 3 — Hidden filters in a bottom sheet */}
      <BottomSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { clearFilters(); }}
              className="flex-1 rounded-full theme-bg-subtle theme-text text-sm font-black py-3 active:scale-95 transition"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              className="flex-1 rounded-full theme-accent-fill theme-on-accent text-sm font-black py-3 active:scale-95 transition"
            >
              Show {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
            </button>
          </div>
        }
      >
        <div className="space-y-5 pb-2">
          <div>
            <p className="text-[11px] font-black theme-text-muted uppercase tracking-widest mb-2">Grade</p>
            <div className="flex flex-wrap gap-2">
              <Chip active={grade === ANY} onClick={() => setGrade(ANY)}>All</Chip>
              {PAPER_GRADES.map((g) => (
                <Chip key={g} active={grade === g} onClick={() => setGrade(g)}>Grade {g}</Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-black theme-text-muted uppercase tracking-widest mb-2">Subject</p>
            <div className="flex flex-wrap gap-2">
              <Chip active={subject === ANY} onClick={() => setSubject(ANY)}>All</Chip>
              {SUBJECT_FILTERS.map((s) => (
                <Chip key={s.id} active={subject === s.id} onClick={() => setSubject(s.id)}>{s.label}</Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-black theme-text-muted uppercase tracking-widest mb-2">Year</p>
            <div className="flex flex-wrap gap-2">
              <Chip active={year === ANY} onClick={() => setYear(ANY)}>All</Chip>
              {yearOptions.map((y) => (
                <Chip key={y} active={year === String(y)} onClick={() => setYear(String(y))}>{y}</Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-black theme-text-muted uppercase tracking-widest mb-2">Sort by</p>
            <div className="flex flex-wrap gap-2">
              {SORTS.map((s) => (
                <Chip key={s.id} active={sort === s.id} onClick={() => setSort(s.id)}>{s.label}</Chip>
              ))}
            </div>
          </div>
        </div>
      </BottomSheet>

      {/* Floating glassmorphism bottom navigation */}
      <BottomNav />
    </div>
  )
}
