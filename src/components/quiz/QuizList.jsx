import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import UpgradeModal from '../subscription/UpgradeModal'
import { AttemptCounter } from '../subscription/PremiumGate'
import ComingSoon from '../ui/ComingSoon'

// ── Design tokens ──────────────────────────────────────────────────────────
const GRADES = ['4', '5', '6']
const TERMS  = ['1', '2', '3']

const SUBJECTS = [
  { id: 'Mathematics',       label: 'Mathematics',       icon: '➗', color: 'blue'   },
  { id: 'English',           label: 'English',           icon: '📝', color: 'violet' },
  { id: 'Integrated Science',label: 'Integrated Science',icon: '🔬', color: 'orange' },
  { id: 'Social Studies',    label: 'Social Studies',    icon: '🌍', color: 'teal'   },
  { id: 'Technology Studies',label: 'Technology Studies',icon: '⚙️', color: 'cyan'   },
  { id: 'Home Economics',    label: 'Home Economics',    icon: '🏠', color: 'pink'   },
  { id: 'Expressive Arts',   label: 'Expressive Arts',   icon: '🎨', color: 'rose'   },
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
  '6': { badge: 'bg-purple-100 text-purple-700',   dot: 'bg-purple-500'  },
}

function getSubjectMeta(subjectId) {
  const sub = SUBJECTS.find(s => s.id === subjectId)
  if (!sub) return { icon: '📝', style: SUBJECT_STYLES.gray, label: subjectId }
  return { icon: sub.icon, style: SUBJECT_STYLES[sub.color], label: sub.label }
}

// ── Filter chip ────────────────────────────────────────────────────────────
function Chip({ label, active, onClick, icon }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold transition-all min-h-0 whitespace-nowrap ${
        active
          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
          : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50'
      }`}>
      {icon && <span className="text-xs">{icon}</span>}
      {label}
    </button>
  )
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 animate-pulse border-l-4 border-l-gray-200">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-gray-200 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2.5 pt-0.5">
          <div className="h-4 bg-gray-200 rounded-lg w-3/4" />
          <div className="h-3 bg-gray-200 rounded-lg w-1/2" />
          <div className="flex gap-2 mt-1">
            <div className="h-5 bg-gray-200 rounded-full w-20" />
            <div className="h-5 bg-gray-200 rounded-full w-14" />
            <div className="h-5 bg-gray-200 rounded-full w-16" />
          </div>
        </div>
        <div className="w-20 h-9 bg-gray-200 rounded-xl flex-shrink-0" />
      </div>
    </div>
  )
}

// ── Quiz card ──────────────────────────────────────────────────────────────
function QuizCard({ quiz, onStart, isAtLimit }) {
  const { icon, style } = getSubjectMeta(quiz.subject)
  const gradeStyle = GRADE_STYLES[quiz.grade] ?? GRADE_STYLES['6']
  const diffColor = quiz.questionCount > 30
    ? 'text-red-500' : quiz.questionCount > 15
    ? 'text-amber-500' : 'text-green-500'

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 border-l-4 ${style.accent} shadow-sm hover:shadow-md transition-all duration-200 group`}>
      <div className="p-4 flex items-start gap-4">
        {/* Subject icon */}
        <div className={`${style.icon} w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0 group-hover:scale-105 transition-transform`}>
          {icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-black text-gray-900 text-sm leading-snug group-hover:text-indigo-700 transition-colors line-clamp-2">
            {quiz.title}
          </h3>
          {quiz.topic && (
            <p className="text-gray-500 text-xs mt-0.5 truncate">{quiz.topic}</p>
          )}
          <div className="flex gap-1.5 mt-2 flex-wrap items-center">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${style.badge}`}>{quiz.subject}</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${gradeStyle.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${gradeStyle.dot}`} />
              Grade {quiz.grade}
            </span>
            {quiz.term && (
              <span className="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-0.5 rounded-full">Term {quiz.term}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className={`text-xs font-bold flex items-center gap-1 ${diffColor}`}>
              <span>◎</span> {quiz.questionCount ?? '?'} questions
            </span>
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <span>⏱</span> {quiz.duration} min
            </span>
            {quiz.totalMarks && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <span>⭐</span> {quiz.totalMarks} marks
              </span>
            )}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() => onStart(quiz.id)}
          disabled={isAtLimit}
          className={`flex-shrink-0 flex flex-col items-center justify-center gap-0.5 px-4 py-2.5 rounded-xl font-black text-sm min-h-0 transition-all ${
            isAtLimit
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-200 hover:shadow-md hover:-translate-y-0.5'
          }`}>
          {isAtLimit ? '🔒' : '▶'}
          <span className="text-xs font-bold">{isAtLimit ? 'Locked' : 'Start'}</span>
        </button>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function QuizList() {
  const { getQuizzes } = useFirestore()
  const { refreshProfile } = useAuth()
  const { isAtLimit, isPremium, tryStartQuiz } = useSubscription()
  const navigate = useNavigate()

  const [quizzes, setQuizzes]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [gradeF, setGradeF]           = useState('')
  const [subjectF, setSubjectF]       = useState('')
  const [termF, setTermF]             = useState('')
  const [showUpgrade, setShowUpgrade] = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await getQuizzes({ grade: gradeF, subject: subjectF, term: termF })
      setQuizzes(data)
      setLoading(false)
    }
    load()
  }, [gradeF, subjectF, termF])

  const filtered = quizzes.filter(q =>
    !search || q.title.toLowerCase().includes(search.toLowerCase()) ||
    (q.topic ?? '').toLowerCase().includes(search.toLowerCase())
  )

  async function handleStart(quizId) {
    if (isAtLimit) { setShowUpgrade(true); return }
    const { allowed } = await tryStartQuiz()
    if (!allowed) { setShowUpgrade(true); return }
    await refreshProfile()
    navigate(`/quiz/${quizId}`)
  }

  const hasActiveFilter = gradeF || subjectF || termF || search

  return (
    <div className="min-h-screen bg-slate-50">
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

      {/* ── Hero banner ────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 px-4 pt-6 pb-8">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-white/20 text-white text-xs font-black px-3 py-1 rounded-full backdrop-blur-sm">
                  📝 Quiz Library
                </span>
              </div>
              <h1 className="text-2xl font-black text-white leading-tight mt-2">
                Test Your Knowledge
              </h1>
              <p className="text-indigo-200 text-sm mt-1">
                Practice quizzes for Grades 4 · 5 · 6 — CBC aligned
              </p>
            </div>
            {!loading && (
              <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3 text-center flex-shrink-0">
                <p className="text-2xl font-black text-white">{quizzes.length}</p>
                <p className="text-indigo-200 text-xs font-bold">Quizzes</p>
              </div>
            )}
          </div>

          {/* Search bar */}
          <div className="relative mt-4">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-indigo-300">🔍</span>
            <input
              type="search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by title or topic…"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/15 backdrop-blur-sm text-white placeholder-indigo-300 border border-white/20 focus:outline-none focus:bg-white/25 text-sm font-medium"
            />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 -mt-3">
        {/* Attempt counter (premium gate) */}
        <div className="mb-4">
          <AttemptCounter onUpgradeClick={() => setShowUpgrade(true)} />
        </div>

        {/* ── Filters ────────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-5 space-y-3">
          {/* Grade filter */}
          <div>
            <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-2">Grade</p>
            <div className="flex gap-2 flex-wrap">
              <Chip label="All" active={!gradeF} onClick={() => setGradeF('')} />
              {GRADES.map(g => (
                <Chip key={g} label={`Grade ${g}`} active={gradeF === g}
                  onClick={() => setGradeF(g === gradeF ? '' : g)} />
              ))}
            </div>
          </div>

          {/* Subject filter */}
          <div>
            <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-2">Subject</p>
            <div className="flex gap-2 flex-wrap">
              <Chip label="All" active={!subjectF} onClick={() => setSubjectF('')} />
              {SUBJECTS.map(s => (
                <Chip key={s.id} label={s.label} icon={s.icon} active={subjectF === s.id}
                  onClick={() => setSubjectF(s.id === subjectF ? '' : s.id)} />
              ))}
            </div>
          </div>

          {/* Term filter */}
          <div>
            <p className="text-xs font-black text-gray-400 uppercase tracking-wider mb-2">Term</p>
            <div className="flex gap-2 flex-wrap">
              <Chip label="All Terms" active={!termF} onClick={() => setTermF('')} />
              {TERMS.map(t => (
                <Chip key={t} label={`Term ${t}`} active={termF === t}
                  onClick={() => setTermF(t === termF ? '' : t)} />
              ))}
            </div>
          </div>

          {/* Clear */}
          {hasActiveFilter && (
            <button
              onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setTermF('') }}
              className="text-xs text-red-500 font-bold hover:text-red-700 min-h-0 bg-transparent shadow-none p-0 flex items-center gap-1">
              ✕ Clear all filters
            </button>
          )}
        </div>

        {/* Results header */}
        {!loading && filtered.length > 0 && (
          <p className="text-xs text-gray-400 font-bold mb-3 px-1">
            {filtered.length} quiz{filtered.length !== 1 ? 'zes' : ''} found
            {hasActiveFilter && ' (filtered)'}
          </p>
        )}

        {/* ── Quiz list ─────────────────────────────────────────────────────── */}
        <div className="space-y-3 pb-10">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          ) : quizzes.length === 0 ? (
            <ComingSoon
              title="Quizzes Coming Soon"
              message="No quizzes have been published yet. Check back soon!"
              icon="📝"
              showQuizBtn={false}
            />
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 py-14 text-center shadow-sm">
              <div className="text-4xl mb-3">🔍</div>
              <p className="font-black text-gray-700">No quizzes match your filters</p>
              <p className="text-gray-400 text-sm mt-1">Try adjusting the grade, subject, or term</p>
              <button
                onClick={() => { setSearch(''); setGradeF(''); setSubjectF(''); setTermF('') }}
                className="mt-4 text-indigo-600 font-black text-sm hover:underline min-h-0 bg-transparent shadow-none">
                Clear filters →
              </button>
            </div>
          ) : (
            filtered.map(quiz => (
              <QuizCard
                key={quiz.id}
                quiz={quiz}
                onStart={handleStart}
                isAtLimit={isAtLimit}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
