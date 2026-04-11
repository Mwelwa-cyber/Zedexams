import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import UpgradeModal from '../subscription/UpgradeModal'
import { AttemptCounter } from '../subscription/PremiumGate'
import ComingSoon from '../ui/ComingSoon'

const SUBJECTS = ['Mathematics', 'English', 'Science', 'Social Studies']
const GRADES   = ['5', '6', '7']
const TERMS    = ['1', '2', '3']

const subjectStyle = {
  Mathematics:    { bg: 'bg-blue-100',   text: 'text-blue-700',   icon: '🔢' },
  English:        { bg: 'bg-purple-100', text: 'text-purple-700', icon: '📖' },
  Science:        { bg: 'bg-orange-100', text: 'text-orange-700', icon: '🔬' },
  'Social Studies':{ bg: 'bg-teal-100',  text: 'text-teal-700',   icon: '🌍' },
}

function Chip({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-bold transition-all min-h-0 ${active ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
      {label}
    </button>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-gray-200 rounded-xl" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="flex gap-2 mt-2">
            <div className="h-5 bg-gray-200 rounded-full w-16" />
            <div className="h-5 bg-gray-200 rounded-full w-12" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function QuizList() {
  const { getQuizzes } = useFirestore()
  const { refreshProfile } = useAuth()
  const { isAtLimit, attemptsLeft, isPremium, tryStartQuiz } = useSubscription()
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
    !search || q.title.toLowerCase().includes(search.toLowerCase())
  )

  async function handleStart(quizId) {
    if (isAtLimit) { setShowUpgrade(true); return }
    const { allowed } = await tryStartQuiz()
    if (!allowed) { setShowUpgrade(true); return }
    // Refresh profile so AttemptCounter shows updated daily count immediately
    await refreshProfile()
    navigate(`/quiz/${quizId}`)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}

      <h1 className="text-2xl font-black text-gray-800 mb-1">📝 Quiz Library</h1>
      <p className="text-gray-500 text-sm mb-4">Find and start a quiz for your grade</p>

      <AttemptCounter onUpgradeClick={() => setShowUpgrade(true)} />

      {/* Search */}
      <input type="search" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="🔍 Search quizzes…"
        className="w-full mt-4 border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:border-green-500 focus:outline-none" />

      {/* Filters */}
      <div className="mt-3 space-y-2">
        <div className="flex gap-2 flex-wrap">
          <Chip label="All Grades" active={!gradeF} onClick={() => setGradeF('')} />
          {GRADES.map(g => <Chip key={g} label={`Grade ${g}`} active={gradeF === g} onClick={() => setGradeF(g === gradeF ? '' : g)} />)}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Chip label="All Subjects" active={!subjectF} onClick={() => setSubjectF('')} />
          {SUBJECTS.map(s => <Chip key={s} label={s} active={subjectF === s} onClick={() => setSubjectF(s === subjectF ? '' : s)} />)}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Chip label="All Terms" active={!termF} onClick={() => setTermF('')} />
          {TERMS.map(t => <Chip key={t} label={`Term ${t}`} active={termF === t} onClick={() => setTermF(t === termF ? '' : t)} />)}
        </div>
      </div>

      {/* Results */}
      <div className="mt-5 space-y-3">
        {loading ? (
          Array.from({length:4}).map((_,i) => <SkeletonCard key={i} />)
        ) : quizzes.length === 0 ? (
          // No quizzes in Firestore at all
          <ComingSoon
            title="Quizzes Coming Soon"
            message="No quizzes have been published yet. Check back soon — your teacher is working on it!"
            icon="✏️"
            showQuizBtn={false}
          />
        ) : filtered.length === 0 ? (
          // Quizzes exist but none match the current filters
          <ComingSoon
            onClearFilters={() => { setSearch(''); setGradeF(''); setSubjectF(''); setTermF('') }}
          />
        ) : filtered.map(quiz => {
          const s = subjectStyle[quiz.subject] ?? { bg:'bg-gray-100', text:'text-gray-700', icon:'📝' }
          return (
            <div key={quiz.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
              <div className={`${s.bg} ${s.text} w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0`}>{s.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-gray-800 leading-snug">{quiz.title}</p>
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  <span className={`${s.bg} ${s.text} text-xs font-bold px-2 py-0.5 rounded-full`}>{quiz.subject}</span>
                  <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">G{quiz.grade}</span>
                  <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">T{quiz.term}</span>
                  <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{quiz.questionCount ?? '?'}Q · {quiz.duration}m</span>
                </div>
              </div>
              <button onClick={() => handleStart(quiz.id)}
                disabled={isAtLimit}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-black text-sm px-4 py-2 rounded-xl flex-shrink-0 min-h-0 transition-colors">
                Start
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
