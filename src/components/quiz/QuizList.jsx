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
} from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import { useSubscription } from '../../hooks/useSubscription'
import { useAuth } from '../../contexts/AuthContext'
import UpgradeModal from '../subscription/UpgradeModal'
import ComingSoon from '../ui/ComingSoon'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'
import SeoHelmet from '../seo/SeoHelmet'
import GameStickerStyles from '../games/GameStickerStyles'

// ── Config ────────────────────────────────────────────────────────────────
const GRADES = ['4', '5', '6']
const TERMS  = ['1', '2', '3']

// Each CBC subject is presented as a mascot tile, mirroring the /games hub.
// `slug` matches the keys in gamesUi SUBJECT_MASCOTS and SUBJECT_TILE_BG.
const SUBJECTS = [
  { id: 'Mathematics',         slug: 'mathematics', tile: 'bg-orange-100', bar: 'bg-orange-500',  mascot: '🦊', mascotName: 'Maths Fox' },
  { id: 'English',             slug: 'english',     tile: 'bg-blue-100',   bar: 'bg-blue-600',    mascot: '🦉', mascotName: 'Story Owl' },
  { id: 'Integrated Science',  slug: 'science',     tile: 'bg-green-100',  bar: 'bg-green-600',   mascot: '🐢', mascotName: 'Science Turtle' },
  { id: 'Social Studies',      slug: 'social',      tile: 'bg-yellow-100', bar: 'bg-yellow-500',  mascot: '🦁', mascotName: 'Adventure Lion' },
  { id: 'Technology Studies',  slug: 'technology',  tile: 'bg-cyan-100',   bar: 'bg-cyan-500',    mascot: '🤖', mascotName: 'Tech Robot' },
  { id: 'Home Economics',      slug: 'home',        tile: 'bg-pink-100',   bar: 'bg-pink-500',    mascot: '🐝', mascotName: 'Home Bee' },
  { id: 'Expressive Arts',     slug: 'arts',        tile: 'bg-rose-100',   bar: 'bg-rose-500',    mascot: '🎨', mascotName: 'Art Parrot' },
]

function difficultyColor(count = 0) {
  if (count > 30) return 'text-red-500'
  if (count > 15) return 'text-amber-500'
  return 'text-emerald-600'
}

function resolveDefaultGrade(profileGrade) {
  const value = profileGrade == null ? '' : String(profileGrade)
  return GRADES.includes(value) ? value : GRADES[0]
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
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-slate-900 bg-[#FF7A1A] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-white shadow-[0_2px_0_#0F1B2D] transition group-hover:translate-y-[1px] group-hover:shadow-[0_1px_0_#0F1B2D]">
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
          className="space-y-2.5 border-t-2 border-dashed border-slate-300 bg-[#FFF7ED]/60 p-3.5 sm:p-5"
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
    <div className="zx-card animate-pulse rounded-[22px] bg-white p-4 sm:p-5">
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
function LockedBanner({ onUpgrade }) {
  return (
    <div className="zx-card mb-4 rounded-[22px] bg-white p-5 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-[14px] border-2 border-slate-900 bg-amber-100">
        <Icon as={Lock} size="lg" />
      </div>
      <p className="font-display text-[18px] font-bold text-slate-900">Full library locked</p>
      <p className="mx-auto mt-1 max-w-md text-sm font-medium text-slate-500">
        You're viewing demo quizzes only. Upgrade to unlock every quiz across all subjects and grades.
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
  const { getQuizzes } = useFirestore()
  const { isDemoOnly, accessBadge } = useSubscription()
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const profileGrade = userProfile?.grade
  const [gradeF, setGradeF]             = useState(() => resolveDefaultGrade(profileGrade))
  const [termF, setTermF]               = useState('')
  const [search, setSearch]             = useState('')
  const [expandedSubject, setExpanded]  = useState(null)
  const [quizzes, setQuizzes]           = useState([])
  const [loading, setLoading]           = useState(true)
  const [showUpgrade, setShowUpgrade]   = useState(false)
  const [blockedToast, setBlockedToast] = useState(location.state?.blocked || false)

  // Sync the chip when the user's profile grade loads/changes after mount.
  useEffect(() => {
    if (!profileGrade) return
    const next = resolveDefaultGrade(profileGrade)
    setGradeF(prev => (prev ? prev : next))
  }, [profileGrade])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const data = await getQuizzes({ grade: gradeF, term: termF })
      if (!cancelled) {
        setQuizzes(data)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [gradeF, termF])

  // Auto-dismiss the "blocked" toast that the upgrade flow forwards in.
  useEffect(() => {
    if (!blockedToast) return
    const t = setTimeout(() => setBlockedToast(false), 4000)
    return () => clearTimeout(t)
  }, [blockedToast])

  const filteredQuizzes = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return quizzes
    return quizzes.filter(q =>
      (q.title ?? '').toLowerCase().includes(needle) ||
      (q.topic ?? '').toLowerCase().includes(needle)
    )
  }, [quizzes, search])

  // Group filtered quizzes by subject. Subjects without any matching quizzes
  // still appear in the grid as "Coming soon" so the layout stays predictable.
  const grouped = useMemo(() => {
    const map = new Map()
    for (const subject of SUBJECTS) map.set(subject.id, [])
    for (const quiz of filteredQuizzes) {
      const list = map.get(quiz.subject)
      if (list) list.push(quiz)
    }
    return SUBJECTS.map(subject => ({ subject, items: map.get(subject.id) || [] }))
  }, [filteredQuizzes])

  // Auto-open a single subject when search narrows the results so learners
  // immediately see what matched, instead of having to tap to reveal it.
  useEffect(() => {
    if (!search.trim()) return
    const populated = grouped.filter(g => g.items.length > 0)
    if (populated.length === 1) setExpanded(populated[0].subject.id)
  }, [search, grouped])

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
    <div className="force-light-theme min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#fff7ed_0%,#f8fafc_38%,#ffffff_100%)] text-slate-900">
      <GameStickerStyles />
      <SeoHelmet title="Quizzes" path="/quizzes" noIndex />
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_36%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.14),_transparent_32%),radial-gradient(circle_at_center,_rgba(16,185,129,0.12),_transparent_42%)]" />

      {blockedToast && (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-[#FF7A1A] px-5 py-3 text-sm font-black text-white shadow-lg">
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
                  ? `${demoForGrade} demo quiz${demoForGrade === 1 ? '' : 'zes'} for Grade ${gradeF} · Upgrade for full access`
                  : `${totalForGrade} quiz${totalForGrade === 1 ? '' : 'zes'} for Grade ${gradeF} · CBC aligned`}
              </p>
            </div>
            <div className="rounded-[18px] border-2 border-white/20 bg-white/10 px-4 py-3 text-center">
              <p className="font-display text-2xl font-bold leading-none">
                {isDemoOnly ? demoForGrade : totalForGrade}
              </p>
              <p className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/70">
                {isDemoOnly ? 'Demo' : 'Quizzes'}
              </p>
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
        {isDemoOnly && <LockedBanner onUpgrade={() => setShowUpgrade(true)} />}

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
            {GRADES.map(g => {
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
            {[{ id: '', label: 'All terms' }, ...TERMS.map(t => ({ id: t, label: `Term ${t}` }))].map(opt => {
              const active = termF === opt.id
              return (
                <button
                  key={opt.id || 'all'}
                  type="button"
                  onClick={() => setTermF(opt.id)}
                  aria-pressed={active}
                  className={`zx-card rounded-full px-3.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] transition ${
                    active
                      ? 'bg-[#FF7A1A] text-white'
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

          {loading ? (
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
