import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { BarChart3, BeakerIcon, BookOpen, Clock, ClipboardList, Home, Lock, Palette, Play, Search, Settings, ChevronRight, Sparkles, PencilLine, StarIcon, X } from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import { useSubscription } from '../../hooks/useSubscription'
import UpgradeModal from '../subscription/UpgradeModal'
import ComingSoon from '../ui/ComingSoon'
import SubjectScroller from '../ui/SubjectScroller'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'

// ── Design tokens ──────────────────────────────────────────────────────────
const GRADES = ['4', '5', '6']
const TERMS  = ['1', '2', '3']

const SUBJECTS = [
  { id: 'Mathematics',       label: 'Mathematics',       icon: BarChart3,  color: 'blue'   },
  { id: 'English',           label: 'English',           icon: PencilLine, color: 'violet' },
  { id: 'Integrated Science',label: 'Integrated Science',icon: BeakerIcon, color: 'orange' },
  { id: 'Social Studies',    label: 'Social Studies',    icon: BookOpen,   color: 'teal'   },
  { id: 'Technology Studies',label: 'Technology Studies',icon: Settings,   color: 'cyan'   },
  { id: 'Home Economics',    label: 'Home Economics',    icon: Home,       color: 'pink'   },
  { id: 'Expressive Arts',   label: 'Expressive Arts',   icon: Palette,    color: 'rose'   },
]

const SUBJECT_STYLES = {
  blue:   { bg: 'bg-blue-50',   border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700',   accent: 'border-l-blue-500',   icon: 'bg-blue-100 text-blue-600',   ring: 'ring-blue-400'   },
  violet: { bg: 'bg-violet-50', border: 'border-violet-200', badge: 'bg-violet-100 text-violet-700',accent: 'border-l-violet-500', icon: 'bg-violet-100 text-violet-600', ring: 'ring-violet-400' },
  orange: { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700',accent: 'border-l-orange-500', icon: 'bg-orange-100 text-orange-600', ring: 'ring-orange-400' },
  teal:   { bg: 'bg-teal-50',   border: 'border-teal-200',   badge: 'bg-teal-100 text-teal-700',   accent: 'border-l-teal-500',   icon: 'bg-teal-100 text-teal-600',   ring: 'ring-teal-400'   },
  cyan:   { bg: 'bg-cyan-50',   border: 'border-cyan-200',   badge: 'bg-cyan-100 text-cyan-700',   accent: 'border-l-cyan-500',   icon: 'bg-cyan-100 text-cyan-600',   ring: 'ring-cyan-400'   },
  pink:   { bg: 'bg-pink-50',   border: 'border-pink-200',   badge: 'bg-pink-100 text-pink-700',   accent: 'border-l-pink-500',   icon: 'bg-pink-100 text-pink-600',   ring: 'ring-pink-400'   },
  rose:   { bg: 'bg-rose-50',   border: 'border-rose-200',   badge: 'bg-rose-100 text-rose-700',   accent: 'border-l-rose-500',   icon: 'bg-rose-100 text-rose-600',   ring: 'ring-rose-400'   },
  gray:   { bg: 'bg-gray-50',   border: 'border-gray-200',   badge: 'bg-gray-100 text-gray-700',   accent: 'border-l-gray-400',   icon: 'bg-gray-100 text-gray-600',   ring: 'ring-gray-300'   },
}

const GRADE_STYLES = {
  '4': { badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  '5': { badge: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500'    },
  '6': { badge: 'bg-orange-100 text-orange-700',   dot: 'bg-orange-500'  },
}

function getSubjectMeta(subjectId) {
  const sub = SUBJECTS.find(s => s.id === subjectId)
  if (!sub) return { icon: PencilLine, style: SUBJECT_STYLES.gray, label: subjectId }
  return { icon: sub.icon, style: SUBJECT_STYLES[sub.color], label: sub.label }
}

// ── Filter chip ────────────────────────────────────────────────────────────
function Chip({ label, active, onClick, icon }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition-all min-h-0 whitespace-nowrap ${
        active
          ? 'theme-accent-fill theme-on-accent shadow-md'
          : 'theme-card border theme-border theme-text-muted hover:theme-bg-subtle hover:theme-text'
      }`}>
      {icon && (
        <span className="text-xs">
          {typeof icon === 'function' ? <Icon as={icon} size="xs" strokeWidth={2.1} /> : icon}
        </span>
      )}
      {label}
    </button>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="theme-card rounded-2xl border theme-border p-4 border-l-4 border-l-[var(--border)]">
      <div className="flex items-start gap-4">
        <Skeleton shape="circle" size={48} />
        <div className="flex-1 space-y-2.5 pt-0.5">
          <Skeleton height={16} width="75%" />
          <Skeleton height={12} width="50%" />
          <div className="flex gap-2 mt-1">
            <Skeleton height={20} width={80} className="rounded-full" />
            <Skeleton height={20} width={56} className="rounded-full" />
            <Skeleton height={20} width={64} className="rounded-full" />
          </div>
        </div>
        <Skeleton height={36} width={80} />
      </div>
    </div>
  )
}

// ── Quiz card ──────────────────────────────────────────────────────────────
function QuizCard({ quiz, onStart, locked }) {
  const { icon, style } = getSubjectMeta(quiz.subject)
  const gradeStyle = GRADE_STYLES[quiz.grade] ?? GRADE_STYLES['6']
  const diffColor = quiz.questionCount > 30
    ? 'text-red-500' : quiz.questionCount > 15
    ? 'text-amber-500' : 'text-green-500'

  return (
    <div className={`theme-card rounded-2xl border theme-border border-l-4 ${style.accent} theme-shadow hover:shadow-md transition-all duration-200 group ${locked ? 'opacity-75' : ''}`}>
      <div className="p-4 flex items-start gap-4">
        {/* Subject icon */}
        <div className={`${style.icon} w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0 group-hover:scale-105 transition-transform`}>
          <Icon as={icon} size="lg" strokeWidth={2.1} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <h3 className="font-black theme-text text-sm leading-snug group-hover:theme-accent-text transition-colors line-clamp-2">
              {quiz.title}
            </h3>
            {quiz.isDemo && (
              <span className="bg-green-100 text-green-700 text-xs font-black px-2 py-0.5 rounded-full flex-shrink-0">Demo</span>
            )}
            {locked && !quiz.isDemo && (
              <span className="theme-bg-subtle theme-text-muted inline-flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-full flex-shrink-0">
                <Icon as={Lock} size="xs" strokeWidth={2.1} /> Locked
              </span>
            )}
          </div>
          {quiz.topic && (
            <p className="theme-text-muted text-xs mt-0.5 truncate">{quiz.topic}</p>
          )}
          <div className="flex gap-1.5 mt-2 flex-wrap items-center">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${style.badge}`}>{quiz.subject}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${gradeStyle.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${gradeStyle.dot}`} />
              Grade {quiz.grade}
            </span>
            {quiz.term && (
              <span className="theme-bg-subtle theme-text-muted text-xs font-bold px-2 py-0.5 rounded-full">Term {quiz.term}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className={`text-xs font-bold flex items-center gap-1 ${diffColor}`}>
              <Icon as={ClipboardList} size="xs" strokeWidth={2.1} /> {quiz.questionCount ?? '?'} questions
            </span>
            <span className="text-xs theme-text-muted flex items-center gap-1">
              <Icon as={Clock} size="xs" strokeWidth={2.1} /> {quiz.duration} min
            </span>
            {quiz.totalMarks && (
              <span className="text-xs theme-text-muted flex items-center gap-1">
                <Icon as={StarIcon} size="xs" strokeWidth={2.1} /> {quiz.totalMarks} marks
              </span>
            )}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() => onStart(quiz.id, locked)}
          aria-label={locked ? 'Locked — upgrade to access' : `Start ${quiz.title}`}
          className={`flex-shrink-0 flex flex-col items-center justify-center gap-0.5 px-4 py-2.5 rounded-xl font-black text-sm min-h-0 transition-all duration-fast ease-out ${
            locked
              ? 'theme-bg-subtle theme-text-muted cursor-not-allowed'
              : 'theme-accent-fill theme-on-accent shadow-elev-sm shadow-elev-inner-hl hover:-translate-y-0.5 hover:shadow-elev-md active:scale-[0.97]'
          }`}>
          <Icon as={locked ? Lock : Play} size="sm" />
          <span className="text-xs font-bold">{locked ? 'Locked' : 'Start'}</span>
        </button>
      </div>
    </div>
  )
}

// ── Locked content banner ──────────────────────────────────────────────────
function LockedBanner({ onUpgrade }) {
  return (
    <div className="theme-card rounded-2xl border-2 border-dashed theme-border p-5 text-center mb-3 shadow-elev-sm">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full theme-bg-subtle theme-text-muted">
        <Icon as={Lock} size="lg" />
      </div>
      <p className="text-display-md theme-text">Full library locked</p>
      <p className="theme-text-muted text-body-sm mt-1 mb-4">
        You're viewing demo quizzes only. Upgrade to access all quizzes.
      </p>
      <div className="inline-flex">
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
  const navigate = useNavigate()
  const location = useLocation()

  const [quizzes, setQuizzes]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [gradeF, setGradeF]           = useState('')
  const [subjectF, setSubjectF]       = useState('')
  const [termF, setTermF]             = useState('')
  const [sortBy, setSortBy]           = useState('newest')
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [blockedToast, setBlockedToast] = useState(location.state?.blocked || false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      // For demo-only users, fetch all published quizzes (we'll show locked state on non-demo ones)
      const data = await getQuizzes({ grade: gradeF, subject: subjectF, term: termF })
      setQuizzes(data)
      setLoading(false)
    }
    load()
  }, [gradeF, subjectF, termF])

  // Auto-dismiss blocked toast after 4s
  useEffect(() => {
    if (!blockedToast) return
    const t = setTimeout(() => setBlockedToast(false), 4000)
    return () => clearTimeout(t)
  }, [blockedToast])

  const filtered = quizzes
    .filter(q =>
      !search || q.title.toLowerCase().includes(search.toLowerCase()) ||
      (q.topic ?? '').toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'az')      return (a.title ?? '').localeCompare(b.title ?? '')
      if (sortBy === 'grade')   return (a.grade ?? '').localeCompare(b.grade ?? '')
      if (sortBy === 'subject') return (a.subject ?? '').localeCompare(b.subject ?? '')
      // newest (default): use createdAt desc (already sorted from Firestore)
      return 0
    })

  function handleStart(quizId, locked) {
    if (locked) { setShowUpgrade(true); return }
    navigate(`/quiz/${quizId}`)
  }

  function isLocked(quiz) {
    return isDemoOnly && !quiz.isDemo
  }

  const hasActiveFilter = gradeF || subjectF || termF || search

  const demoCount = quizzes.filter(q => q.isDemo).length

  return (
    <div className="min-h-screen theme-bg">
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

      {/* Blocked toast */}
      {blockedToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-orange-500 text-white font-black text-sm px-5 py-3 rounded-2xl shadow-lg animate-slide-up flex items-center gap-2">
          <Icon as={Lock} size="sm" strokeWidth={2.1} /> Upgrade required to access that quiz
          <button onClick={() => setBlockedToast(false)} className="text-white/70 hover:text-white min-h-0 p-0 bg-transparent shadow-none text-lg leading-none">×</button>
        </div>
      )}

      {/* ── Hero banner ────────────────────────────────────────────────────── */}
      <div className="theme-hero px-4 pt-6 pb-8">
        <div className="max-w-2xl md:max-w-4xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-eyebrow bg-white/20 text-white px-3 py-1 rounded-full backdrop-blur-sm" style={{ color: 'rgba(255,255,255,0.95)' }}>
                  Quiz Library
                </span>
                {/* Access badge in header */}
                <span className={`inline-flex items-center gap-1 text-xs font-black px-3 py-1 rounded-full backdrop-blur-sm ${
                  accessBadge.color === 'green'  ? 'bg-green-500/30 text-green-100' :
                  accessBadge.color === 'blue'   ? 'bg-blue-500/30 text-blue-100' :
                  accessBadge.color === 'yellow' ? 'bg-yellow-500/30 text-yellow-100' :
                  'bg-white/20 text-white/70'
                }`}>
                  <Icon as={Sparkles} size="xs" strokeWidth={2.1} /> {accessBadge.label}
                </span>
              </div>
              <h1 className="text-display-xl text-white mt-2">
                Test your knowledge
              </h1>
              <p className="theme-hero-muted text-body-sm mt-1">
                {isDemoOnly
                  ? `${demoCount} demo quiz${demoCount !== 1 ? 'zes' : ''} available · Upgrade for full access`
                  : `${quizzes.length} quizzes · Grades 4–6 — CBC aligned`
                }
              </p>
            </div>
            {!loading && (
              <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3 text-center flex-shrink-0">
                <p className="text-2xl font-black text-white">{isDemoOnly ? demoCount : quizzes.length}</p>
                <p className="theme-hero-muted text-xs font-bold">{isDemoOnly ? 'Demo' : 'Quizzes'}</p>
              </div>
            )}
          </div>

          {/* Search bar */}
          <div className="relative mt-4">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 theme-hero-muted inline-flex items-center" style={{ color: 'rgba(255,255,255,0.75)' }}>
              <Icon as={Search} size="sm" />
            </span>
            <input
              type="search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by title or topic…"
              aria-label="Search quizzes"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/15 backdrop-blur-sm text-white placeholder-white/70 border border-white/20 focus:bg-white/25 text-sm font-medium"
            />
          </div>
        </div>
      </div>

      <div className="max-w-2xl md:max-w-4xl mx-auto px-4 -mt-3">
        {/* Locked banner for demo-only users (access badge already shown in hero) */}
        {isDemoOnly && <LockedBanner onUpgrade={() => setShowUpgrade(true)} />}

        {/* ── Filters ────────────────────────────────────────────────────────── */}
        <div className="theme-card rounded-2xl border theme-border theme-shadow p-4 mb-5 space-y-3">
          {/* Grade filter */}
          <div>
            <p className="text-xs font-black theme-text-muted uppercase tracking-wider mb-2">Grade</p>
            <div className="flex gap-2 flex-wrap">
              <Chip label="All" active={!gradeF} onClick={() => setGradeF('')} />
              {GRADES.map(g => (
                <Chip key={g} label={`Grade ${g}`} active={gradeF === g}
                  onClick={() => setGradeF(g === gradeF ? '' : g)} />
              ))}
            </div>
          </div>

          {/* Term filter */}
          <div>
            <p className="text-xs font-black theme-text-muted uppercase tracking-wider mb-2">Term</p>
            <div className="flex gap-2 flex-wrap">
              <Chip label="All Terms" active={!termF} onClick={() => setTermF('')} />
              {TERMS.map(t => (
                <Chip key={t} label={`Term ${t}`} active={termF === t}
                  onClick={() => setTermF(t === termF ? '' : t)} />
              ))}
            </div>
          </div>

          {/* Subject filter */}
          <div>
            <p className="text-xs font-black theme-text-muted uppercase tracking-wider mb-2">Subject</p>
            <SubjectScroller
              subjects={SUBJECTS}
              value={subjectF}
              onChange={setSubjectF}
              variant="indigo"
            />
          </div>

          {/* Sort + clear row */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <p className="text-xs font-black theme-text-muted uppercase tracking-wider">Sort</p>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="text-xs font-bold rounded-lg px-2 py-1.5 border theme-input focus:outline-none focus:border-[var(--accent)] transition-colors"
              >
                <option value="newest">Newest</option>
                <option value="az">A–Z</option>
                <option value="grade">Grade</option>
                <option value="subject">Subject</option>
              </select>
            </div>
            {hasActiveFilter && (
              <button
                onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setTermF('') }}
                className="text-xs text-red-500 font-bold hover:text-red-700 min-h-0 bg-transparent shadow-none p-0 flex items-center gap-1">
                <Icon as={X} size="xs" strokeWidth={2.1} /> Clear all filters
              </button>
            )}
          </div>
        </div>

        {/* Results header */}
        {!loading && filtered.length > 0 && (
          <p className="text-xs theme-text-muted font-bold mb-3 px-1">
            {filtered.length} quiz{filtered.length !== 1 ? 'zes' : ''} found
            {hasActiveFilter && ' (filtered)'}
            {isDemoOnly && ' (demo only)'}
          </p>
        )}

        {/* ── Quiz grid ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-10">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          ) : quizzes.length === 0 ? (
            <div className="col-span-full">
              <ComingSoon
                title="Quizzes Coming Soon"
                message="No quizzes have been published yet. Check back soon!"
                icon={PencilLine}
                showQuizBtn={false}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="col-span-full theme-card rounded-2xl border theme-border py-14 text-center theme-shadow">
              <Icon as={Search} size="xl" strokeWidth={2.1} className="mx-auto mb-3 theme-text-muted" />
              <p className="font-black theme-text">No quizzes match your filters</p>
              <p className="theme-text-muted text-sm mt-1">Try adjusting the grade, subject, or term</p>
              <button
                onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setTermF('') }}
                className="mt-4 theme-accent-text font-black text-sm hover:underline min-h-0 bg-transparent shadow-none">
                Clear filters →
              </button>
            </div>
          ) : (
            filtered.map(quiz => (
              <QuizCard
                key={quiz.id}
                quiz={quiz}
                onStart={handleStart}
                locked={isLocked(quiz)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
