import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, CheckCircleIcon, ChevronRight, PencilLine, Search, Target, TrophyIcon, X } from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useFirestore } from '../../hooks/useFirestore'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'

const SUBJECTS = [
  'Mathematics', 'English', 'Integrated Science', 'Social Studies',
  'Technology Studies', 'Home Economics', 'Expressive Arts',
]

const subjectBadge = {
  Mathematics:           'bg-blue-100 text-blue-700',
  English:               'bg-violet-100 text-violet-700',
  'Integrated Science':  'bg-orange-100 text-orange-700',
  'Social Studies':      'bg-teal-100 text-teal-700',
  'Technology Studies':  'bg-cyan-100 text-cyan-700',
  'Home Economics':      'bg-pink-100 text-pink-700',
  'Expressive Arts':     'bg-rose-100 text-rose-700',
  // legacy
  Science:               'bg-orange-100 text-orange-700',
}

function pctColor(p) {
  if (p >= 70) return 'text-green-600'
  if (p >= 50) return 'text-yellow-600'
  return 'text-red-500'
}
function pctBg(p) {
  if (p >= 70) return 'bg-green-500'
  if (p >= 50) return 'bg-yellow-400'
  return 'bg-red-400'
}

function ResultSkeleton() {
  return (
    <div className="theme-card rounded-2xl border theme-border p-4 shadow-elev-sm">
      <div className="flex items-center gap-3">
        <Skeleton shape="circle" size={48} />
        <div className="flex-1 space-y-2">
          <Skeleton height={14} width="75%" />
          <Skeleton height={10} width="50%" />
        </div>
        <Skeleton height={32} width={32} />
      </div>
    </div>
  )
}

export default function MyResults() {
  const { userProfile } = useAuth()
  const { getUserResults } = useFirestore()
  const navigate = useNavigate()

  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [subjectF, setSubjectF] = useState('')
  const [modeF, setModeF]       = useState('')

  useEffect(() => {
    async function load() {
      if (!userProfile?.id) return
      const data = await getUserResults(userProfile.id, 50)
      setResults(data)
      setLoading(false)
    }
    load()
  }, [userProfile?.id])

  function fmt(ts) {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const filtered = results.filter(r =>
    (!subjectF || r.subject === subjectF) &&
    (!modeF    || r.mode === modeF)
  )

  const totalQuizzes = filtered.length
  const avgScore = totalQuizzes > 0
    ? Math.round(filtered.reduce((s, r) => s + (r.percentage ?? 0), 0) / totalQuizzes) : 0
  const passed = filtered.filter(r => (r.percentage ?? 0) >= 50).length

  return (
    <div className="max-w-2xl md:max-w-3xl mx-auto px-4 py-6">
      <div className="mb-5">
        <p className="text-eyebrow">Your progress</p>
        <h1 className="text-display-xl theme-text mt-1 flex items-center gap-2">
          <Icon as={BarChart3} size="lg" strokeWidth={2.1} /> My results
        </h1>
        <p className="theme-text-muted text-body-sm mt-1">Your complete quiz history</p>
      </div>

      {/* Summary */}
      {!loading && results.length > 0 && (
        <div className="stats-row stats-row-3 mb-5 stagger">
          {[
            { icon: PencilLine,      label: 'Total',   val: totalQuizzes,    t: 't-purple' },
            { icon: Target,          label: 'Average', val: `${avgScore}%`,  t: 't-mint'   },
            { icon: CheckCircleIcon, label: 'Passed',  val: passed,          t: 't-amber'  },
          ].map(s => (
            <div key={s.label} className={`stat-tile ${s.t} animate-slide-in-soft`}>
              <div className="stat-tile-icon" aria-hidden="true">
                <Icon as={s.icon} size="md" strokeWidth={2.2} />
              </div>
              <div className="stat-num">{s.val}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-5">
        <select value={subjectF} onChange={e => setSubjectF(e.target.value)}
          className="border-2 theme-border rounded-xl px-3 py-2 text-sm focus:outline-none theme-input focus:border-[var(--accent)]">
          <option value="">All Subjects</option>
          {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={modeF} onChange={e => setModeF(e.target.value)}
          className="border-2 theme-border rounded-xl px-3 py-2 text-sm focus:outline-none theme-input focus:border-[var(--accent)]">
          <option value="">All Modes</option>
          <option value="practice">Practice</option>
          <option value="exam">Exam</option>
        </select>
        {(subjectF || modeF) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSubjectF(''); setModeF('') }}
            leadingIcon={<Icon as={X} size="sm" />}
          >
            Clear
          </Button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <ResultSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="surface rounded-radius-lg py-16 text-center">
          <Icon as={results.length === 0 ? Target : Search} size="xl" strokeWidth={2.1} className="mx-auto mb-3 theme-text-muted" />
          <p className="text-display-md theme-text">
            {results.length === 0 ? 'No results yet' : 'No results match your filters'}
          </p>
          <p className="theme-text-muted text-body-sm mt-1">
            {results.length === 0 ? 'Complete a quiz to see your results here' : 'Try clearing your filters'}
          </p>
          {results.length === 0 && (
            <div className="mt-4 inline-flex">
              <Button
                variant="primary"
                size="md"
                onClick={() => navigate('/quizzes')}
                trailingIcon={<Icon as={ChevronRight} size="sm" />}
              >
                Start a quiz
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <button key={r.id} onClick={() => navigate(`/results/${r.id}`)}
              className="w-full theme-card rounded-2xl border theme-border p-4 shadow-elev-sm hover:-translate-y-0.5 hover:shadow-elev-md hover:border-[var(--accent)] transition-all duration-base ease-out text-left group min-h-0">
              <div className="flex items-center gap-3">
                {/* Score circle */}
                <div className="relative w-12 h-12 flex-shrink-0">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 44 44">
                    <circle cx="22" cy="22" r="18" fill="none" stroke="#e5e7eb" strokeWidth="4" />
                    <circle cx="22" cy="22" r="18" fill="none"
                      stroke={r.percentage >= 70 ? '#16a34a' : r.percentage >= 50 ? '#eab308' : '#dc2626'}
                      strokeWidth="4"
                      strokeDasharray={`${2 * Math.PI * 18}`}
                      strokeDashoffset={`${2 * Math.PI * 18 * (1 - (r.percentage ?? 0) / 100)}`}
                      strokeLinecap="round" />
                  </svg>
                  <span className={`absolute inset-0 flex items-center justify-center font-black text-xs ${pctColor(r.percentage ?? 0)}`}>
                    {r.percentage ?? 0}%
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-black theme-text text-sm leading-snug truncate group-hover:text-[var(--accent-fg)] transition-colors">
                    {r.quizTitle ?? 'Quiz'}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${subjectBadge[r.subject] ?? 'bg-gray-100 text-gray-600'}`}>
                      {r.subject}
                    </span>
                    <span className="text-gray-400 text-xs">G{r.grade}</span>
                    <span className="flex items-center gap-1 text-gray-400 text-xs">
                      <Icon as={r.mode === 'exam' ? TrophyIcon : PencilLine} size="xs" strokeWidth={2.1} /> {r.mode}
                    </span>
                    <span className="text-gray-400 text-xs">{fmt(r.completedAt)}</span>
                  </div>
                </div>

                {/* Score text + arrow */}
                <div className="flex-shrink-0 text-right">
                  <p className={`font-black text-sm ${pctColor(r.percentage ?? 0)}`}>{r.score}/{r.totalMarks}</p>
                  <Icon as={ChevronRight} size="xs" strokeWidth={2.1} className="ml-auto text-gray-300 transition-colors group-hover:text-green-400" />
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-2.5 w-full theme-bg-subtle rounded-full h-1.5">
                <div className={`h-1.5 rounded-full transition-all ${pctBg(r.percentage ?? 0)}`}
                  style={{ width: `${r.percentage ?? 0}%` }} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
