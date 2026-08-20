import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Lock,
  PencilLine,
  Play,
  Search,
  Sparkles,
  StarIcon,
  X,
} from '../../../shared/components/icons'
import { useLearnerFirestore } from '../../../hooks/useLearnerFirestore'
import { useDebouncedValue } from '../../../hooks/useDebouncedValue'
import { useSubscription } from '../../../hooks/useSubscription'
import { useAuth } from '../../../contexts/AuthContext'
import UpgradeModal from '../../../components/subscription/UpgradeModal'
import ComingSoon from '../../../shared/components/ComingSoon'
import Button from '../../../shared/components/Button'
import Icon from '../../../shared/components/Icon'
import Skeleton from '../../../shared/components/Skeleton'
import ContentLoadError from '../../../shared/components/ContentLoadError'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import GameStickerStyles from '../../../shared/components/GameStickerStyles'
import { QuizzesHubTour } from '../../../shared/components/learnerTours'
import { gradesForFeature, gradeNumberOf } from '../../../config/canonicalEducation'
import { PAPER_SUBJECTS } from '../../../config/curriculum'
import { resolveLearnerCalendar } from '../../../utils/learnerCalendar'
import useDayKey, { dayKeyDate } from '../../../hooks/useDayKey'

// ── Config ────────────────────────────────────────────────────────────────
// A filter on the canonical ladder — see FEATURE_GRADE_RESTRICTIONS.
const GRADES = gradesForFeature('learner-catalogue').map((g) => gradeNumberOf(g.code))
const TERMS  = ['1', '2', '3']

// Each subject is presented as a mascot tile, mirroring the /games hub.
// `slug` matches the keys in gamesUi SUBJECT_MASCOTS and SUBJECT_TILE_BG.
//
// The presentation (mascot, colours, slug) is this page's own and is keyed by
// the learner-catalogue subject id; the `id` a tile FILTERS on is the
// catalogue's own label, read from it rather than retyped. Retyping is what let
// this list drift — a label edited in the catalogue and not here would leave a
// tile that matches no quiz and silently shows an empty subject.
const SUBJECT_PRESENTATION = {
  english:         { slug: 'english',         tile: 'bg-blue-100',   bar: 'bg-blue-600',    mascot: '🦉', mascotName: 'Story Owl' },
  science:         { slug: 'science',         tile: 'bg-green-100',  bar: 'bg-green-600',   mascot: '🐢', mascotName: 'Science Turtle' },
  mathematics:     { slug: 'mathematics',     tile: 'bg-orange-100', bar: 'bg-orange-500',  mascot: '🦊', mascotName: 'Maths Fox' },
  'social-studies':{ slug: 'social',          tile: 'bg-yellow-100', bar: 'bg-yellow-500',  mascot: '🦁', mascotName: 'Adventure Lion' },
  'expressive-arts':{ slug: 'arts',           tile: 'bg-rose-100',   bar: 'bg-rose-500',    mascot: '🎨', mascotName: 'Art Parrot' },
  technology:      { slug: 'technology',      tile: 'bg-cyan-100',   bar: 'bg-cyan-500',    mascot: '🤖', mascotName: 'Tech Robot' },
  cinyanja:        { slug: 'cinyanja',        tile: 'bg-pink-100',   bar: 'bg-pink-500',    mascot: '🦜', mascotName: 'Nyanja Parrot' },
  'home-economics':{ slug: 'home',            tile: 'bg-rose-100',   bar: 'bg-rose-500',    mascot: '🐝', mascotName: 'Home Bee' },
  // The PSLE special-paper categories — ECZ exam categories rather than
  // subjects, which is why they have no canonical subject behind them.
  'special-paper-1':{ slug: 'special-paper-1', tile: 'bg-purple-100', bar: 'bg-purple-600', mascot: '📝', mascotName: 'Exam Scholar' },
  'special-paper-2':{ slug: 'special-paper-2', tile: 'bg-violet-100', bar: 'bg-violet-600', mascot: '🧩', mascotName: 'Puzzle Scholar' },
}

const SUBJECTS = PAPER_SUBJECTS
  .filter((s) => SUBJECT_PRESENTATION[s.id])
  .map((s) => ({ id: s.label, ...SUBJECT_PRESENTATION[s.id] }))

// Process-lived cache of fetched quiz lists, keyed by `grade|term`. The library
// is read on every mount of this page — and learners bounce in and out of it
// constantly (open a quiz, take it, come back). Without a cache each return trip
// re-downloads the whole grade's catalogue and shows a spinner again. We keep
// the last result per filter and render it instantly on revisit, then refresh in
// the background (stale-while-revalidate) so the list still picks up new quizzes.
// Module scope (not a ref) so it survives unmount; harmless to leak — it's small
// metadata and naturally bounded by the grade/term filter combinations.
const quizListCache = new Map()

function difficultyColor(count = 0) {
  if (count > 30) return 'text-red-500'
  if (count > 15) return 'text-amber-500'
  return 'text-emerald-600'
}

function resolveDefaultGrade(profileGrade) {
  const value = profileGrade == null ? '' : String(profileGrade)
  return GRADES.includes(value) ? value : GRADES[0]
}

// CBC exam policy: a learner's grade builds on the grades below it, so
// quizzes from lower grades stay visible for revision. Grade 4 sees only
// Grade 4; Grade 5 sees 4–5; Grade 6 sees 4–6; Grade 7 sees everything.
function resolveAllowedGrades(profileGrade) {
  const value = profileGrade == null ? '' : String(profileGrade)
  if (!GRADES.includes(value)) return GRADES
  const ceiling = GRADES.indexOf(value)
  return GRADES.slice(0, ceiling + 1)
}

// ── Inline quiz row (revealed inside an expanded subject card) ─────────────
function QuizRow({ quiz, locked, onStart }) {
  return (
    <button
      type="button"
      onClick={() => onStart(quiz.id, locked)}
      aria-label={locked ? 'Locked — upgrade to access' : `Start ${quiz.title}`}
      className="zx-card group flex w-full items-center justify-between gap-3 rounded-[18px] bg-white px-3.5 py-3 text-left transition active:translate-y-[2px] active:shadow-none sm:px-4 sm:py-3.5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border-2 border-slate-900 bg-amber-100 text-slate-900 sm:h-10 sm:w-10">
          <Icon as={locked ? Lock : Play} size="sm" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h4 className="font-display truncate text-[14px] font-bold leading-snug text-slate-900 sm:text-[15px]">
              {quiz.title}
            </h4>
            {quiz.isDemo && (
              <span className="shrink-0 rounded-full border-[1.5px] border-slate-900 bg-emerald-400 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-900">
                Demo
              </span>
            )}
            {locked && !quiz.isDemo && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border-[1.5px] border-slate-900 bg-slate-900 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-white">
                <Icon as={Lock} size="xs" /> Locked
              </span>
            )}
          </div>
          {quiz.topic && (
            <p className="mt-0.5 truncate text-[11.5px] font-semibold text-slate-500">{quiz.topic}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
            <span className={`inline-flex items-center gap-1 ${difficultyColor(quiz.questionCount)}`}>
              <Icon as={ClipboardList} size="xs" /> {quiz.questionCount ?? '?'} qs
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon as={Clock} size="xs" /> {quiz.duration} min
            </span>
            {quiz.term && (
              <span className="rounded-full border-[1.5px] border-slate-900 bg-white px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-slate-900">
                Term {quiz.term}
              </span>
            )}
            {quiz.totalMarks && (
              <span className="inline-flex items-center gap-1">
                <Icon as={StarIcon} size="xs" /> {quiz.totalMarks}
              </span>
            )}
          </div>
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-slate-900 bg-[#D97757] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-white shadow-[0_2px_0_#0F1B2D] transition group-hover:translate-y-[1px] group-hover:shadow-[0_1px_0_#0F1B2D]">
        {locked ? 'Unlock' : 'Start'}
        <Icon as={locked ? Lock : ChevronRight} size="xs" />
      </span>
    </button>
  )
}

// ── Subject tile (mascot card that expands inline to reveal its quizzes) ───
function SubjectCard({ subject, quizzes, expanded, onToggle, onStart, isLocked }) {
  const total = quizzes.length
  const empty = total === 0
  const demoCount = quizzes.filter(q => q.isDemo).length

  return (
    <div className="zx-card overflow-hidden rounded-[22px] bg-white">
      <button
        type="button"
        disabled={empty}
        onClick={() => !empty && onToggle(subject.id)}
        aria-expanded={expanded}
        aria-controls={`quizzes-${subject.slug}`}
        className={`flex w-full items-center gap-4 p-4 text-left transition sm:p-5 ${empty ? 'cursor-not-allowed opacity-65' : 'active:translate-y-[1px]'}`}
      >
        <div
          className={`zx-mascot-tile grid h-16 w-16 shrink-0 place-items-center rounded-[18px] border-2 border-slate-900 text-[34px] leading-none sm:h-20 sm:w-20 sm:text-[42px] ${subject.tile}`}
        >
          <span aria-hidden="true">{subject.mascot}</span>
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[19px] font-bold leading-none text-slate-900 sm:text-xl lg:text-[22px]">
            {subject.id}
          </h3>
          <p className="mt-1 text-[11.5px] font-semibold text-slate-500 sm:text-xs">
            {subject.mascotName}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-slate-900 bg-slate-900 px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-white">
              {empty ? 'Coming soon' : `${total} ${total === 1 ? 'quiz' : 'quizzes'}`}
            </span>
            {demoCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-slate-900 bg-emerald-400 px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-slate-900">
                <Icon as={Sparkles} size="xs" /> {demoCount} demo
              </span>
            )}
          </div>
        </div>

        {!empty && (
          <span
            aria-hidden="true"
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-slate-900 bg-white text-slate-900 transition-transform sm:h-10 sm:w-10 ${expanded ? 'rotate-180' : ''}`}
          >
            <Icon as={ChevronDown} size="sm" />
          </span>
        )}
      </button>

      {expanded && !empty && (
        <div
          id={`quizzes-${subject.slug}`}
          className="space-y-2.5 border-t-2 border-dashed border-slate-300 bg-[#FCF7F3]/60 p-3.5 sm:p-5"
        >
          {quizzes.map(quiz => (
            <QuizRow
              key={quiz.id}
              quiz={quiz}
              locked={isLocked(quiz)}
              onStart={onStart}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Skeletons ──────────────────────────────────────────────────────────────
function SubjectSkeleton() {
  return (
    <div className="zx-card rounded-[22px] bg-white p-4 sm:p-5">
      <div className="flex items-center gap-4">
        <Skeleton shape="circle" size={64} />
        <div className="flex-1 space-y-2">
          <Skeleton height={16} width="55%" />
          <Skeleton height={12} width="35%" />
          <Skeleton height={20} width={80} className="rounded-full" />
        </div>
      </div>
    </div>
  )
}

// ── Locked banner (premium nudge) ──────────────────────────────────────────
function LockedBanner({ onUpgrade, hasDemos }) {
  return (
    <div className="zx-card mb-4 rounded-[22px] bg-white p-5 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-[14px] border-2 border-slate-900 bg-amber-100">
        <Icon as={Lock} size="lg" />
      </div>
      <p className="font-display text-[18px] font-bold text-slate-900">Full library locked</p>
      <p className="mx-auto mt-1 max-w-md text-sm font-medium text-slate-500">
        {hasDemos
          ? "You're viewing demo quizzes only. Upgrade to unlock every quiz across all subjects and grades."
          : 'Upgrade to unlock every quiz across all subjects and grades — CBC aligned and ready to practise.'}
      </p>
      <div className="mt-4 inline-flex">
        <Button
          variant="primary"
          size="md"
          onClick={onUpgrade}
          leadingIcon={<Icon as={Sparkles} size="sm" />}
          trailingIcon={<Icon as={ChevronRight} size="sm" />}
        >
          Upgrade now
        </Button>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function QuizList() {
  const { getQuizzes } = useLearnerFirestore()
  const { isDemoOnly, accessBadge } = useSubscription()
  const { userProfile, isAdmin, isTeacher } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const profileGrade = userProfile?.grade
  // Admins and teachers manage/preview content across the whole curriculum,
  // so their own profile grade must not gate the library — they see every
  // grade. Learners stay on the CBC build-up policy (own grade + below).
  const canSeeAllGrades = isAdmin || isTeacher
  const allowedGrades = useMemo(
    () => (canSeeAllGrades ? GRADES : resolveAllowedGrades(profileGrade)),
    [canSeeAllGrades, profileGrade],
  )
  const [gradeF, setGradeF]             = useState(() => resolveDefaultGrade(profileGrade))
  const [termF, setTermF]               = useState('')
  // Which term the school year is in right now (the term that just closed
  // while school is shut — that is the work a learner is revising). Read once;
  // it only changes at a term boundary.
  const termDayKey = useDayKey()
  const currentTermId = useMemo(() => {
    const n = resolveLearnerCalendar(dayKeyDate(termDayKey)).recent?.term?.number
    return n ? String(n) : ''
  }, [termDayKey])
  const [search, setSearch]             = useState('')
  const [expandedSubject, setExpanded]  = useState(null)
  // Seed from cache (if this grade/term was viewed before) so a return visit
  // paints the library immediately instead of flashing a skeleton.
  const initialKey = `${resolveDefaultGrade(profileGrade)}|`
  const [quizzes, setQuizzes]           = useState(() => quizListCache.get(initialKey) || [])
  const [loading, setLoading]           = useState(() => !quizListCache.has(initialKey))
  // A Firestore read failure must never masquerade as "no quizzes yet" or hang
  // on the skeleton forever — track it so we can show a retryable error card.
  const [loadError, setLoadError]       = useState(false)
  const [reloadNonce, setReloadNonce]   = useState(0)
  const [showUpgrade, setShowUpgrade]   = useState(false)
  const [blockedToast, setBlockedToast] = useState(location.state?.blocked || false)

  // Sync the chip when the user's profile grade loads/changes after mount.
  // If the current selection is no longer allowed (e.g. a stale Grade 7 chip
  // for a Grade 5 learner), fall back to the learner's own grade.
  useEffect(() => {
    if (!profileGrade) return
    const next = resolveDefaultGrade(profileGrade)
    setGradeF(prev => (prev && allowedGrades.includes(prev) ? prev : next))
  }, [profileGrade, allowedGrades])

  useEffect(() => {
    let cancelled = false
    const key = `${gradeF}|${termF}`
    const cached = quizListCache.get(key)
    async function load() {
      // Stale-while-revalidate: if we already have this filter's list, show it
      // now (no spinner) and refresh quietly in the background. Otherwise show
      // the skeleton until the first fetch lands.
      if (cached) {
        setQuizzes(cached)
        setLoading(false)
      } else {
        setLoading(true)
      }
      try {
        const data = await getQuizzes({ grade: gradeF, term: termF })
        quizListCache.set(key, data)
        if (!cancelled) {
          setQuizzes(data)
          setLoadError(false)
          setLoading(false)
        }
      } catch (err) {
        // Read failure (offline / Firestore outage): stop the skeleton and
        // surface a friendly retry instead of an infinite spinner or a false
        // "no quizzes published" empty state.
        console.warn('[QuizList] load failed', err)
        if (!cancelled) {
          setLoadError(true)
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [gradeF, termF, getQuizzes, reloadNonce])

  // Auto-dismiss the "blocked" toast that the upgrade flow forwards in.
  useEffect(() => {
    if (!blockedToast) return
    const t = setTimeout(() => setBlockedToast(false), 4000)
    return () => clearTimeout(t)
  }, [blockedToast])

  const debouncedSearch = useDebouncedValue(search, 200)

  const filteredQuizzes = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase()
    if (!needle) return quizzes
    return quizzes.filter(q =>
      q && (
        (q.title ?? '').toLowerCase().includes(needle) ||
        (q.topic ?? '').toLowerCase().includes(needle)
      )
    )
  }, [quizzes, debouncedSearch])

  // Group filtered quizzes by subject. Subjects without any matching quizzes
  // still appear in the grid as "Coming soon" so the layout stays predictable.
  // A quiz with a subject string that doesn't match any SUBJECTS.id would be
  // silently dropped (e.g. legacy "Maths" vs "Mathematics"); log it so the
  // mismatch surfaces in the console instead of vanishing from the library.
  const grouped = useMemo(() => {
    const map = new Map()
    for (const subject of SUBJECTS) map.set(subject.id, [])
    const orphans = []
    for (const quiz of filteredQuizzes) {
      if (!quiz) continue // a nullish entry must never crash the whole library grid
      const list = map.get(quiz.subject)
      if (list) list.push(quiz)
      else orphans.push(quiz)
    }
    if (orphans.length) {
      console.warn(
        `[QuizList] ${orphans.length} quiz(zes) dropped from grid — subject does not match any SUBJECTS.id:`,
        orphans.map(q => ({ id: q.id, title: q.title, subject: q.subject })),
      )
    }
    return SUBJECTS.map(subject => ({ subject, items: map.get(subject.id) || [] }))
  }, [filteredQuizzes])

  // Auto-open a single subject when search narrows the results so learners
  // immediately see what matched, instead of having to tap to reveal it.
  useEffect(() => {
    if (!debouncedSearch.trim()) return
    const populated = grouped.filter(g => g.items.length > 0)
    if (populated.length === 1) setExpanded(populated[0].subject.id)
  }, [debouncedSearch, grouped])

  function handleToggle(subjectId) {
    setExpanded(prev => (prev === subjectId ? null : subjectId))
  }

  function handleStart(quizId, locked) {
    if (locked) { setShowUpgrade(true); return }
    navigate(`/quiz/${quizId}`)
  }

  function isLocked(quiz) {
    return isDemoOnly && !quiz.isDemo
  }

  function handleClearSearch() {
    setSearch('')
    setTermF('')
  }

  const totalForGrade = filteredQuizzes.length
  const demoForGrade  = filteredQuizzes.filter(q => q.isDemo).length

  return (
    <div className="force-light-theme min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#fcf7f3_0%,#f8fafc_38%,#ffffff_100%)] text-slate-900">
      <GameStickerStyles />
      <SeoHelmet title="Quizzes" path="/quizzes" noIndex />
      {/* Audit A8 PR 3 — first-session tour. Self-suppresses via
          localStorage; safe to render unconditionally. */}
      <QuizzesHubTour />
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_36%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.14),_transparent_32%),radial-gradient(circle_at_center,_rgba(16,185,129,0.12),_transparent_42%)]" />

      {blockedToast && (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-[#D97757] px-5 py-3 text-sm font-black text-white shadow-lg">
          <Icon as={Lock} size="sm" /> Upgrade required to access that quiz
          <button
            onClick={() => setBlockedToast(false)}
            className="ml-1 rounded-full p-0 text-lg leading-none text-white/80 hover:text-white"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="relative mx-auto w-full max-w-md space-y-7 px-4 pb-12 pt-6 sm:max-w-3xl sm:space-y-9 sm:px-6 sm:pt-8 lg:max-w-5xl lg:space-y-10">
        {/* Hero */}
        <section className="zx-card flex flex-col gap-4 rounded-[22px] bg-slate-900 p-5 text-white sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="zx-chip border-white/30 bg-white/15 text-white">Quiz Library</span>
            <span className={`inline-flex items-center gap-1 rounded-full border-2 border-white/30 px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.08em] ${
              accessBadge.color === 'green'  ? 'bg-emerald-500/30 text-emerald-100' :
              accessBadge.color === 'blue'   ? 'bg-sky-500/30 text-sky-100' :
              accessBadge.color === 'yellow' ? 'bg-amber-500/30 text-amber-100' :
              'bg-white/15 text-white/80'
            }`}>
              <Icon as={Sparkles} size="xs" /> {accessBadge.label}
            </span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-[28px] font-bold leading-none tracking-tight sm:text-4xl">
                Test your knowledge
              </h1>
              <p className="mt-2 text-[12.5px] font-semibold text-white/75 sm:text-sm">
                {isDemoOnly
                  ? demoForGrade > 0
                    ? `${demoForGrade} demo quiz${demoForGrade === 1 ? '' : 'zes'} for Grade ${gradeF} · Upgrade for full access`
                    : `Unlock every Grade ${gradeF} quiz · Upgrade for full access`
                  : `${totalForGrade} quiz${totalForGrade === 1 ? '' : 'zes'} for Grade ${gradeF} · CBC aligned`}
              </p>
            </div>
            <div className="rounded-[18px] border-2 border-white/20 bg-white/10 px-4 py-3 text-center">
              {isDemoOnly && demoForGrade === 0 ? (
                <>
                  <span className="mx-auto grid h-7 w-7 place-items-center text-white/90">
                    <Icon as={Lock} size="md" />
                  </span>
                  <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/70">
                    Locked
                  </p>
                </>
              ) : (
                <>
                  <p className="font-display text-2xl font-bold leading-none">
                    {isDemoOnly ? demoForGrade : totalForGrade}
                  </p>
                  <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/70">
                    {isDemoOnly ? 'Demo' : 'Quizzes'}
                  </p>
                </>
              )}
            </div>
          </div>
          <label className="relative block">
            <span className="sr-only">Search quizzes</span>
            <span className="pointer-events-none absolute left-4 top-1/2 inline-flex -translate-y-1/2 items-center text-white/70">
              <Icon as={Search} size="sm" />
            </span>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by title or topic…"
              className="w-full rounded-[14px] border-2 border-white/20 bg-white/15 px-10 py-3 text-sm font-semibold text-white placeholder-white/65 outline-none transition focus:border-white/60 focus:bg-white/25"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-full bg-white/15 p-1 text-white/80 transition hover:bg-white/25 hover:text-white"
                aria-label="Clear search"
              >
                <Icon as={X} size="xs" />
              </button>
            )}
          </label>
        </section>

        {/* Locked banner for demo-only learners */}
        {isDemoOnly && <LockedBanner onUpgrade={() => setShowUpgrade(true)} hasDemos={demoForGrade > 0} />}

        {/* Grade picker (single-select — only one grade is visible at a time) */}
        <section>
          <div className="mb-2 flex items-end justify-between">
            <div>
              <span className="zx-eyebrow">Pick your grade</span>
              <h2 className="font-display mt-1 text-[22px] font-bold leading-none tracking-tight text-slate-900 sm:text-2xl">
                Grade {gradeF}
              </h2>
            </div>
            <p className="hidden text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:block">
              Switch grade to see its quizzes
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {allowedGrades.map(g => {
              const active = gradeF === g
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => { setGradeF(g); setExpanded(null) }}
                  aria-pressed={active}
                  className={`zx-card rounded-full px-4 py-2 text-[12px] font-extrabold uppercase tracking-[0.08em] transition ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-900 hover:bg-amber-50'
                  }`}
                >
                  Grade {g}
                </button>
              )
            })}
          </div>
        </section>

        {/* Term filter */}
        <section>
          <div className="mb-2">
            <span className="zx-eyebrow">Filter by term</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[{ id: '', label: 'All terms' }, ...TERMS.map(t => ({
              id: t,
              // The calendar says which term the school year is actually in;
              // marking it is the whole intelligence this filter needs. The
              // DEFAULT stays "All terms" on purpose — seeding the filter to
              // the current term would hide the rest of the catalogue from a
              // learner who came here to revise, which is most of them.
              label: t === currentTermId ? `Term ${t} · now` : `Term ${t}`,
            }))].map(opt => {
              const active = termF === opt.id
              return (
                <button
                  key={opt.id || 'all'}
                  type="button"
                  onClick={() => setTermF(opt.id)}
                  aria-pressed={active}
                  className={`zx-card rounded-full px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] transition ${
                    active
                      ? 'bg-[#D97757] text-white'
                      : 'bg-white text-slate-900 hover:bg-amber-50'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
            {(termF || search) && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-rose-600 hover:text-rose-700"
              >
                <Icon as={X} size="xs" /> Clear
              </button>
            )}
          </div>
        </section>

        {/* Subjects (mascot tiles, tap to expand inline) */}
        <section>
          <div className="mb-3 flex items-end justify-between sm:mb-4">
            <div>
              <span className="zx-eyebrow">Subjects</span>
              <h2 className="font-display mt-1 text-[26px] font-bold leading-none tracking-tight text-slate-900 sm:text-3xl lg:text-4xl">
                Pick a subject
              </h2>
            </div>
            <p className="text-xs font-bold text-slate-500 sm:text-sm">
              {loading ? 'Loading…' : `${filteredQuizzes.length} match${filteredQuizzes.length === 1 ? '' : 'es'}`}
            </p>
          </div>

          {loadError && quizzes.length === 0 ? (
            <ContentLoadError
              title="Couldn’t load quizzes"
              message="We couldn’t load the quizzes just now. Please check your connection and try again."
              onRetry={() => { setLoadError(false); setReloadNonce(n => n + 1) }}
            />
          ) : loading ? (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-5">
              {Array.from({ length: 4 }).map((_, i) => <SubjectSkeleton key={i} />)}
            </div>
          ) : quizzes.length === 0 ? (
            <ComingSoon
              title="Quizzes Coming Soon"
              message={`No quizzes have been published for Grade ${gradeF} yet. Try a different grade or check back soon.`}
              icon={PencilLine}
              showQuizBtn={false}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:gap-4 lg:gap-5">
              {grouped.map(({ subject, items }) => (
                <SubjectCard
                  key={subject.id}
                  subject={subject}
                  quizzes={items}
                  expanded={expandedSubject === subject.id}
                  onToggle={handleToggle}
                  onStart={handleStart}
                  isLocked={isLocked}
                />
              ))}
            </div>
          )}

          {!loading && quizzes.length > 0 && filteredQuizzes.length === 0 && (
            <div className="zx-card mt-4 rounded-[22px] bg-white p-6 text-center">
              <Icon as={Search} size="xl" className="mx-auto mb-2 text-slate-400" />
              <p className="font-display text-[16px] font-bold text-slate-900">No quizzes match your search</p>
              <p className="mt-1 text-sm text-slate-500">Try clearing the term filter or your search query.</p>
              <button
                type="button"
                onClick={handleClearSearch}
                className="mt-3 text-sm font-extrabold text-[#0E5E70] hover:text-[#053541]"
              >
                Clear filters →
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
