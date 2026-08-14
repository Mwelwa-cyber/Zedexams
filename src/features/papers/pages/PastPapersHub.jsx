/**
 * /papers — public ECZ past-paper archive, guided-navigation redesign.
 *
 * The audit calls this "the largest organic-demand gap in the Zambian
 * market" — ECZ past papers drive significant SEO traffic and are
 * typically the #1 reason a learner lands on a revision site. Grade 9
 * was phased out by ECZ, so the archive covers Grade 7 and Grade 12.
 *
 * Routing is open (no auth required) so search engines can index the
 * list and signed-out visitors browse before signing up. The actual
 * PDF viewer / download is auth-gated by Storage rules — that's the
 * incentive to register.
 *
 * Navigation model (premium, phone-first): a guided drill-down
 *
 *     Grade → Year → Subject → Paper (viewer) → Quiz
 *
 *   - Screen 1 (years): a grid of beautiful year cards for the selected
 *     grade. Calendar tile + big year + "Past Papers" + arrow.
 *   - Screen 2 (subjects): tap a year → a grid of colourful subject
 *     cards for that grade+year, each with a "Paper Available" badge.
 *   - A Grade 7/12 toggle, a search field, and quick filters sit above.
 *     Searching or picking a quick filter drops into a flat results
 *     list that spans every year.
 *
 * The step + grade + year are mirrored into the URL query (?grade=7&
 * year=2025) so the browser back button and shared links restore the
 * exact view. The single load-bearing quiz link is always
 * `/papers/:paperId/quiz` (resolved through `paper.quizId`) — never a
 * direct `/quiz/:id` — so existing quizzes keep working.
 *
 * Data: live Firestore (`loadPublishedPapers`) is the source of truth,
 * seeded from a per-tab cache for an instant paint. If the archive is
 * empty or the read fails we fall back to a small curated sample set so
 * the surface is never blank.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import {
  PAPER_GRADES,
  getCachedPublishedPapers,
  loadPublishedPapers,
} from '../../../utils/pastPapers'
import { paperQuizIsAttached } from '../../../utils/pastPaperQuizStatus'
import {
  deriveYears,
  filterPapers,
  isSpecimen,
  subjectsForYear,
  viewPath,
} from '../lib/paperNav'
import { isOfficialSource, paperSourceLabel } from '../../../config/paperSources'
import { fullPaperTitle } from '../../../utils/paperTitleCore'
import PaperTitle, { PaperSourceBadge } from '../components/PaperTitle'
import { subjectMeta } from '../lib/paperVisuals'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Logo from '../../../shared/components/Logo'
import Skeleton from '../../../shared/components/Skeleton'
import {
  ArrowRight,
  BookmarkSquareIcon,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Gamepad2,
  GraduationCap,
  Home,
  PencilLine,
  Search,
  SlidersHorizontal,
  Sparkles,
  StarIcon,
  X,
} from '../../../shared/components/icons'

// ── Sample fallback (only shown when Firestore is empty / errors) ────
// Every sample carries a source and an explicit confidence, because these rows
// render through exactly the same components as real papers — a sample without
// a source would be the one paper in the archive with no badge, which is the
// defect this feature exists to remove rather than a harmless placeholder.
//
// `special-paper-1` is a genuine ECZ Grade 7 PSLE subject (verbal reasoning),
// not a paper variant of another subject — see SPECIAL_PAPER_SUBJECTS in
// src/config/curriculum.js. It keeps its own subject tile.
const SAMPLE_PAPERS = [
  { id: 's-tech-2025',    title: 'Grade 7 Creative and Technology Studies — ECZ · 2025', grade: '7',  subject: 'creative-technology-studies', year: 2025, quizId: 'sample', specimen: true, source: 'ecz',    isOfficial: true,  paperNumber: 1, sourceConfidence: 'explicit' },
  { id: 's-math12-2025',  title: 'Grade 12 Mathematics — ECZ · 2025',                    grade: '12', subject: 'mathematics',                 year: 2025,                                    source: 'ecz',    isOfficial: true,  paperNumber: 1, sourceConfidence: 'explicit' },
  { id: 's-sci-2025',     title: 'Grade 7 Integrated Science — PRISCA mock · 2025',      grade: '7',  subject: 'science',                     year: 2025, quizId: 'sample',                  source: 'prisca', isOfficial: false, paperNumber: 'mock', sourceConfidence: 'explicit' },
  { id: 's-soc-2024',     title: 'Grade 7 Social Studies — ECZ · 2024',                  grade: '7',  subject: 'social-studies',              year: 2024, quizId: 'sample',                  source: 'ecz',    isOfficial: true,  paperNumber: 1, sourceConfidence: 'explicit' },
  { id: 's-eng-2024',     title: 'Grade 7 English — ECZ · 2024',                         grade: '7',  subject: 'english',                     year: 2024, quizId: 'sample',                  source: 'ecz',    isOfficial: true,  paperNumber: 1, sourceConfidence: 'explicit' },
  { id: 's-math-2023',    title: 'Grade 7 Mathematics — ECZ · 2023',                     grade: '7',  subject: 'mathematics',                 year: 2023, quizId: 'sample',                  source: 'ecz',    isOfficial: true,  paperNumber: 1, sourceConfidence: 'explicit' },
  { id: 's-homeec-2023',  title: 'Grade 7 Home Economics — ECZ · 2023',                  grade: '7',  subject: 'home-economics',              year: 2023,                                    source: 'ecz',    isOfficial: true,  paperNumber: 1, sourceConfidence: 'explicit' },
  { id: 's-special-2022', title: 'Grade 7 Special Paper 1 — ECZ · 2022',                 grade: '7',  subject: 'special-paper-1',             year: 2022, quizId: 'sample',                  source: 'ecz',    isOfficial: true,  paperNumber: 'special', sourceConfidence: 'explicit' },
  { id: 's-eng12-2022',   title: 'Grade 12 English — ECZ · 2022',                        grade: '12', subject: 'english',                     year: 2022, quizId: 'sample',                  source: 'ecz',    isOfficial: true,  paperNumber: 1, sourceConfidence: 'explicit' },
]

const SORTS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'az',     label: 'A–Z' },
]

// Quick filters — a flat browse override on top of the guided flow.
// "Official only" sits with the others rather than in the sort sheet: it is
// the question a learner revising for the real exam asks first, and it filters
// on the derived `isOfficial` boolean — one equality, never an OR across every
// mock publisher.
const QUICK_FILTERS = [
  { id: 'all',        label: 'All Papers' },
  { id: 'official',   label: 'Official only' },
  { id: 'quiz',       label: 'Quiz Available' },
  { id: 'recent',     label: 'Recently Added' },
  { id: 'bookmarked', label: 'Bookmarked' },
]

// Fallback years shown before any live data has loaded.
const FALLBACK_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016]

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

// Quiz availability badge — a tiny dot pill that scans instantly.
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

// "Paper Available" badge for the subject cards (Screen 2).
function AvailableBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-[11px] font-black">
      <Check size={12} strokeWidth={3} />
      Paper Available
    </span>
  )
}

// A pill chip used inside the filter sheet. Active = accent fill.
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

// Bottom sheet — slides up on a dimmed, blurred backdrop.
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

// ── Screen 1 — Year card ────────────────────────────────────────────
// A beautiful, tappable card: calendar tile, big year, "Past Papers",
// arrow. Soft shadow, rounded, hover lift, tap press (ripple feel).
function YearCard({ year, count, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(year)}
      className="group text-left theme-card rounded-radius-lg shadow-elev-md ring-1 ring-black/5 p-4 flex items-center gap-4 transition-all hover:-translate-y-0.5 hover:shadow-elev-lg active:scale-[0.98] animate-press"
    >
      <div className="flex-shrink-0 w-14 h-14 rounded-2xl grid place-items-center bg-orange-100 text-orange-700 group-hover:bg-orange-200 transition-colors">
        <CalendarDays size={26} strokeWidth={2.2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-display font-black text-2xl theme-text leading-none">{year}</p>
        <p className="theme-text-muted text-xs font-bold mt-1">
          Past Papers{count ? ` · ${count}` : ''}
        </p>
      </div>
      <ArrowRight
        size={20}
        strokeWidth={2.4}
        className="theme-text-muted group-hover:theme-accent-text group-hover:translate-x-0.5 transition-all flex-shrink-0"
      />
    </button>
  )
}

// ── Screen 2 — Subject card ─────────────────────────────────────────
// Large colourful icon, subject name, "Paper Available" badge, arrow.
// One paper → links straight to the viewer. Several papers (Paper 1 /
// Paper 2) → expands to an inline list.
function SubjectCard({ subject, papers, saved, onToggleSave, onOpen }) {
  const [expanded, setExpanded] = useState(false)
  const { fullLabel, Icon, tile } = subjectMeta(subject)
  const single = papers.length === 1
  // Derived — a paper published with the Studio's Quiz step skipped can still
  // carry an id, and badging it "Quiz" would advertise a quiz the viewer then
  // tells the learner is still coming.
  const anyQuiz = papers.some((p) => paperQuizIsAttached(p))
  const first = papers[0]
  // Distinct sources, in the order the papers are already sorted (official
  // first) so the ECZ chip leads. De-duplicated: three ECZ papers are one
  // "ECZ" badge, not three.
  const sourceBadges = useMemo(() => {
    const seen = new Map()
    for (const p of papers) {
      const label = paperSourceLabel(p.source)
      if (!label || seen.has(p.source)) continue
      seen.set(p.source, { source: p.source, label, isOfficial: isOfficialSource(p.source) })
    }
    return [...seen.values()]
  }, [papers])

  const CardInner = (
    <div className="flex items-start gap-3.5">
      <div className={`flex-shrink-0 w-14 h-14 rounded-2xl grid place-items-center ${tile}`}>
        <Icon size={28} strokeWidth={2.1} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="theme-text font-black text-base leading-snug">{fullLabel}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {/* One badge per distinct source, so a subject holding both an ECZ
              paper and a mock says so on the collapsed card — the learner
              should not have to expand it to find out whether the official
              paper is in there. */}
          {sourceBadges.map((b) => (
            <PaperSourceBadge key={b.source} label={b.label} isOfficial={b.isOfficial} size="sm" />
          ))}
          {!sourceBadges.length && <AvailableBadge />}
          {anyQuiz && <QuizBadge available />}
          {papers.length > 1 && (
            <span className="text-[11px] font-bold theme-text-muted">{papers.length} papers</span>
          )}
        </div>
      </div>
      <ArrowRight
        size={20}
        strokeWidth={2.4}
        className="theme-text-muted group-hover:theme-accent-text group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1"
      />
    </div>
  )

  if (single) {
    return (
      <Link
        to={viewPath(first)}
        onClick={() => onOpen(first.id)}
        className="group theme-card rounded-radius-lg shadow-elev-md ring-1 ring-black/5 p-4 transition-all hover:-translate-y-0.5 hover:shadow-elev-lg active:scale-[0.99] animate-press block"
      >
        {CardInner}
      </Link>
    )
  }

  return (
    <div className="theme-card rounded-radius-lg shadow-elev-md ring-1 ring-black/5 p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="group w-full text-left"
      >
        {CardInner}
      </button>
      {expanded && (
        <div className="mt-3 pt-3 border-t theme-border space-y-2">
          {papers.map((p) => (
            <PaperRow
              key={p.id}
              paper={p}
              saved={saved.has(p.id)}
              onToggleSave={() => onToggleSave(p.id)}
              onOpen={onOpen}
              variant="row"
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Paper row ────────────────────────────────────────────────────────
//
// Two shapes, one component. Inside an expanded subject card the row is a
// BORDERED ROW (`variant="row"`): the card is already a card, and nesting a
// second rounded, shadowed card inside it made the two papers of one subject
// read as two unrelated things. In the flat results list it keeps its own card
// surface, because there is no parent card to sit inside.
//
// The name is composed by <PaperTitle/> from the structured fields — nothing
// here reads `paper.title`, and nothing is ellipsised: at 360px the source
// badge and the paper number are both still on screen because whole facts are
// dropped in priority order instead of characters being cut.
function PaperRow({ paper, saved, onToggleSave, onOpen, variant = 'card' }) {
  const { Icon, tile } = subjectMeta(paper.subject)
  const hasQuiz = paperQuizIsAttached(paper)
  const specimen = isSpecimen(paper)
  // The accessible name for the icon-only buttons. Composed, not `paper.title`
  // — a button announced as "Save In" (a real title in the archive begins with
  // the word "In") tells a screen-reader user nothing.
  const name = fullPaperTitle(paper)

  const shell = variant === 'row'
    ? 'border theme-border rounded-radius-md hover:theme-bg-subtle transition-colors'
    : 'theme-card rounded-radius-md shadow-elev-sm ring-1 ring-black/5 hover:shadow-elev-md transition-shadow'

  return (
    <div className={`group min-w-0 flex items-center gap-3 p-2.5 pr-3 ${shell}`}>
      <Link
        to={viewPath(paper)}
        onClick={() => onOpen(paper.id)}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <div className={`flex-shrink-0 w-11 h-11 rounded-xl grid place-items-center ${tile}`}>
          <Icon size={20} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <PaperTitle paper={paper} variant="row" />
          <div className="flex flex-wrap items-center gap-1 mt-1">
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
            aria-label={`Take quiz for ${name}`}
            className="grid place-items-center w-9 h-9 rounded-full theme-accent-fill theme-on-accent active:scale-90 transition"
          >
            <PencilLine size={16} strokeWidth={2.4} />
          </Link>
        )}
        <button
          type="button"
          onClick={onToggleSave}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${name} from saved` : `Save ${name}`}
          className={`grid place-items-center w-9 h-9 rounded-full transition active:scale-90 ${
            saved ? 'theme-accent-text theme-bg-subtle' : 'theme-text-muted hover:theme-bg-subtle'
          }`}
        >
          <BookmarkSquareIcon size={17} strokeWidth={saved ? 2.6 : 2} />
        </button>
      </div>
    </div>
  )
}

// ── Segmented grade toggle (7 / 12) ─────────────────────────────────
function GradeToggle({ grade, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full theme-bg-subtle p-1" role="tablist" aria-label="Grade">
      {PAPER_GRADES.map((g) => {
        const active = grade === g
        return (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(g)}
            className={`rounded-full px-4 py-1.5 text-sm font-black transition active:scale-95 ${
              active ? 'theme-accent-fill theme-on-accent shadow-elev-sm' : 'theme-text-muted hover:theme-text'
            }`}
          >
            Grade {g}
          </button>
        )
      })}
    </div>
  )
}

// ── Floating glassmorphism bottom navigation ────────────────────────
function BottomNav() {
  // Matches the learner-home bottom-nav IA (Home · Learn · Papers ·
  // Practice · Games). Profile moved to the header avatar (2026-07).
  const items = [
    { to: '/dashboard', label: 'Home', Icon: Home },
    { to: '/learn', label: 'Learn', Icon: GraduationCap },
    { to: '/papers', label: 'Papers', Icon: FileText, active: true },
    { to: '/practice', label: 'Practice', Icon: PencilLine },
    { to: '/games', label: 'Games', Icon: Gamepad2 },
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

// ── Decorative books / graduation-cap cluster (header illustration) ──
function HeaderArt() {
  return (
    <div aria-hidden="true" className="relative flex-shrink-0 w-24 h-24 hidden sm:grid place-items-center">
      <div className="absolute inset-2 rounded-[28px] bg-gradient-to-br from-orange-200 to-amber-100 rotate-6" />
      <div className="absolute inset-3 rounded-[24px] bg-gradient-to-br from-violet-200 to-orange-100 -rotate-6" />
      <div className="relative grid place-items-center w-16 h-16 rounded-2xl theme-card shadow-elev-md">
        <GraduationCap size={30} strokeWidth={2} className="theme-accent-text" />
      </div>
      <Sparkles size={16} strokeWidth={2.4} className="absolute -top-0.5 right-1 text-amber-400" />
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────

export default function PastPapersHub() {
  const { currentUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchRef = useRef(null)

  const cachedOnMount = getCachedPublishedPapers()
  const [loaded, setLoaded] = useState(() =>
    cachedOnMount ? cachedOnMount.filter((p) => PAPER_GRADES.includes(String(p.grade))) : [],
  )
  const [loading, setLoading] = useState(() => !cachedOnMount)
  const [usingSample, setUsingSample] = useState(false)

  // Grade defaults to 7 (the mockup's focus); ?grade=12 deep-links G12.
  const initialGrade = searchParams.get('grade')
  const [grade, setGrade] = useState(
    initialGrade && PAPER_GRADES.includes(initialGrade) ? initialGrade : '7',
  )
  const initialYear = searchParams.get('year')
  const [year, setYearState] = useState(
    initialYear && /^\d{4}$/.test(initialYear) ? Number(initialYear) : null,
  )
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('newest')
  const [quickFilter, setQuickFilter] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [savedIds, setSavedIds] = useState(() => new Set(readStored(BOOKMARK_KEY)))
  const [, setRecentIds] = useState(() => readStored(RECENT_KEY))

  // Keep the URL query in sync so back / share restore the exact view.
  const syncParams = (nextGrade, nextYear) => {
    const params = {}
    if (nextGrade) params.grade = nextGrade
    if (nextYear) params.year = String(nextYear)
    setSearchParams(params, { replace: false })
  }

  const chooseGrade = (g) => {
    setGrade(g)
    setYearState(null) // years differ per grade — reset the drill-down
    setQuickFilter('all')
    syncParams(g, null)
  }
  const chooseYear = (y) => {
    setYearState(y)
    syncParams(grade, y)
  }
  const backToYears = () => {
    setYearState(null)
    syncParams(grade, null)
  }

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

  // Papers for the currently selected grade.
  const gradePapers = useMemo(
    () => loaded.filter((p) => String(p.grade) === grade),
    [loaded, grade],
  )

  // Screen 1 — the year universe for this grade.
  const years = useMemo(() => deriveYears(gradePapers), [gradePapers])
  const yearOptions = years.length ? years : FALLBACK_YEARS
  const yearCounts = useMemo(() => {
    const counts = {}
    for (const p of gradePapers) if (typeof p.year === 'number') counts[p.year] = (counts[p.year] || 0) + 1
    return counts
  }, [gradePapers])

  // Screen 2 — subjects for grade+year.
  const subjectGroups = useMemo(
    () => (year ? subjectsForYear(loaded, grade, year) : []),
    [loaded, grade, year],
  )

  // Determine the active mode. Search or a quick filter drops into a
  // flat results list; otherwise the guided year → subject flow. The query
  // is debounced so a fast typist doesn't flicker between the years/subjects
  // view and the flat results view on every keystroke.
  const debouncedQuery = useDebouncedValue(query, 200)
  const searching = debouncedQuery.trim().length > 0
  const filtering = quickFilter !== 'all'
  const mode = searching || filtering ? 'results' : year ? 'subjects' : 'years'

  const results = useMemo(() => {
    if (mode !== 'results') return []
    return filterPapers(gradePapers, {
      query: debouncedQuery,
      quizOnly: quickFilter === 'quiz',
      officialOnly: quickFilter === 'official',
      sort: quickFilter === 'recent' ? 'newest' : sort,
      labelOf: (id) => subjectMeta(id).label,
    }).filter((p) => (quickFilter === 'bookmarked' ? savedIds.has(p.id) : true))
  }, [mode, gradePapers, debouncedQuery, quickFilter, sort, savedIds])

  const clearBrowse = () => {
    setQuery('')
    setQuickFilter('all')
  }

  return (
    <div className="admin-game-theme min-h-screen theme-bg theme-text pb-28">
      <SeoHelmet
        title="ECZ Past Papers — Grade 7 & Grade 12 archive"
        description="Browse the official ECZ past-paper archive — Grade 7 and Grade 12 papers across every CBC subject. Choose a year, pick a subject, read the paper and take the linked quiz."
        path="/papers"
      />

      {/* Slim top bar — brand + "My runs". */}
      <header className="sticky top-0 z-30 theme-bg">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
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

      <main className="max-w-5xl mx-auto px-4">
        {/* Title block — dynamic to the selected grade + step */}
        <div className="pt-4 pb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {mode === 'subjects' && (
              <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-bold theme-text-muted mb-1.5">
                <button type="button" onClick={backToYears} className="hover:theme-text">Grade {grade}</button>
                <ChevronRight size={13} strokeWidth={2.6} />
                <span className="theme-text">{year}</span>
              </nav>
            )}
            <h1 className="font-display font-black text-2xl sm:text-3xl theme-text leading-tight">
              {mode === 'subjects' ? `${year} Grade ${grade} Past Papers` : `Grade ${grade} Past Papers`}
            </h1>
            <p className="theme-text-muted text-sm mt-1">
              {mode === 'subjects'
                ? 'Choose a subject to view past papers and take quizzes.'
                : 'Choose a year to explore ECZ past papers and quizzes.'}
            </p>
          </div>
          <HeaderArt />
        </div>

        {/* Grade toggle */}
        <GradeToggle grade={grade} onChange={chooseGrade} />

        {/* Search first, with a Filters button inside on the right */}
        <div className="relative mt-4">
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
            placeholder="Search years, subjects, or papers"
            className="w-full rounded-full theme-card pl-12 pr-14 py-3.5 text-sm font-medium theme-text placeholder:theme-text-muted shadow-elev-sm ring-1 ring-black/5 focus:outline-none focus:ring-2 focus:ring-orange-300 transition"
            aria-label="Search years, subjects, or papers"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label="Sort options"
            className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-10 h-10 rounded-full theme-accent-fill theme-on-accent active:scale-90 transition"
          >
            <SlidersHorizontal size={18} strokeWidth={2.2} />
          </button>
        </div>

        {/* Quick filters */}
        <div className="mt-3 -mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {QUICK_FILTERS.map((f) => {
            const active = quickFilter === f.id && !searching
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => { setQuery(''); setQuickFilter(f.id) }}
                aria-pressed={active}
                className={`flex-shrink-0 rounded-full px-4 py-2 text-xs font-black transition active:scale-95 ${
                  active
                    ? 'theme-accent-fill theme-on-accent shadow-elev-sm'
                    : 'theme-card theme-text-muted ring-1 ring-black/5 hover:theme-text'
                }`}
              >
                {f.label}
              </button>
            )
          })}
        </div>

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
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 rounded-radius-lg" />)}
          </div>
        ) : mode === 'results' ? (
          /* ── Flat results (search / quick filter) ── */
          <section className="mt-5">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <h2 className="font-display font-black text-sm theme-text uppercase tracking-wide">
                {searching ? 'Search results' : QUICK_FILTERS.find((f) => f.id === quickFilter)?.label}
              </h2>
              <button type="button" onClick={clearBrowse} className="text-xs font-black theme-accent-text hover:underline">
                {searching ? 'Clear search' : 'Back to years'}
              </button>
            </div>
            {results.length === 0 ? (
              <EmptyResults onClear={clearBrowse} />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {results.map((paper) => (
                  <PaperRow
                    key={paper.id}
                    paper={paper}
                    saved={savedIds.has(paper.id)}
                    onToggleSave={() => toggleSave(paper.id)}
                    onOpen={recordOpen}
                  />
                ))}
              </div>
            )}
          </section>
        ) : mode === 'years' ? (
          /* ── Screen 1 — Year cards ── */
          <section className="mt-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {yearOptions.map((y) => (
                <YearCard key={y} year={y} count={yearCounts[y]} onSelect={chooseYear} />
              ))}
            </div>
          </section>
        ) : (
          /* ── Screen 2 — Subject cards ── */
          <section className="mt-5">
            <button
              type="button"
              onClick={backToYears}
              className="inline-flex items-center gap-1.5 rounded-full theme-bg-subtle theme-text text-xs font-black px-3 py-2 mb-4 active:scale-95 transition"
            >
              <ChevronLeft size={15} strokeWidth={2.6} />
              Back to years
            </button>
            {subjectGroups.length === 0 ? (
              <EmptyResults
                title="No papers for this year yet"
                subtitle="We're still uploading this year's papers. Try another year."
                onClear={backToYears}
                clearLabel="Choose another year"
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {subjectGroups.map(({ subject, papers }) => (
                  <SubjectCard
                    key={subject}
                    subject={subject}
                    papers={papers}
                    saved={savedIds}
                    onToggleSave={toggleSave}
                    onOpen={recordOpen}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Sort options in a bottom sheet */}
      <BottomSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Sort papers"
        footer={
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            className="w-full rounded-full theme-accent-fill theme-on-accent text-sm font-black py-3 active:scale-95 transition"
          >
            Done
          </button>
        }
      >
        <div className="space-y-5 pb-2">
          <div>
            <p className="text-[11px] font-black theme-text-muted uppercase tracking-widest mb-2">Sort results by</p>
            <div className="flex flex-wrap gap-2">
              {SORTS.map((s) => (
                <Chip key={s.id} active={sort === s.id} onClick={() => setSort(s.id)}>{s.label}</Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-black theme-text-muted uppercase tracking-widest mb-2">Grade</p>
            <div className="flex flex-wrap gap-2">
              {PAPER_GRADES.map((g) => (
                <Chip key={g} active={grade === g} onClick={() => chooseGrade(g)}>Grade {g}</Chip>
              ))}
            </div>
          </div>
        </div>
      </BottomSheet>

      <BottomNav />
    </div>
  )
}

// ── Empty state ─────────────────────────────────────────────────────
function EmptyResults({
  title = 'No papers match your search',
  subtitle = 'Try a different subject, year, or keyword.',
  onClear,
  clearLabel = 'Clear',
}) {
  return (
    <div className="theme-card rounded-radius-lg p-8 text-center shadow-elev-sm ring-1 ring-black/5">
      <div className="mx-auto w-12 h-12 rounded-2xl theme-bg-subtle grid place-items-center mb-3">
        <Search size={24} strokeWidth={2} className="theme-text-muted" />
      </div>
      <h3 className="theme-text font-black">{title}</h3>
      <p className="theme-text-muted text-sm mt-1">{subtitle}</p>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full theme-accent-fill theme-on-accent text-xs font-black px-4 py-2"
        >
          {clearLabel}
        </button>
      )}
    </div>
  )
}
