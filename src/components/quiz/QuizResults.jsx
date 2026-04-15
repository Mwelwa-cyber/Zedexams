import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { getRoleLandingPath } from '../../utils/navigation'
import { explainQuizAnswer } from '../../utils/aiAssistant'

function ScoreCircle({ percentage }) {
  const r = 54, circ = 2 * Math.PI * r
  const offset = circ - (percentage / 100) * circ
  const color = percentage >= 70 ? '#16a34a' : percentage >= 50 ? '#eab308' : '#dc2626'
  return (
    <div className="relative w-36 h-36 mx-auto">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black" style={{ color }}>{percentage}%</span>
        <span className="text-xs text-gray-400 font-bold">SCORE</span>
      </div>
    </div>
  )
}

export default function QuizResults() {
  const { resultId } = useParams()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const { getResultById, getQuestions } = useFirestore()
  const homePath = getRoleLandingPath(userProfile)

  const [result, setResult]     = useState(null)
  const [questions, setQuestions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showReview, setShowReview] = useState(false)
  const [aiExplanations, setAiExplanations] = useState({})
  const [aiLoading, setAiLoading] = useState({})

  useEffect(() => {
    async function load() {
      const r = await getResultById(resultId)
      if (!r) { setLoading(false); return }
      setResult(r)
      const qs = await getQuestions(r.quizId)
      setQuestions(qs)
      setLoading(false)
    }
    load()
  }, [resultId])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center"><div className="text-5xl mb-3 animate-bounce">📊</div><p className="text-green-600 font-bold text-lg">Loading results…</p></div>
    </div>
  )

  if (!result) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center"><div className="text-5xl mb-3">😕</div><p className="text-red-600 font-bold">Result not found</p>
        <button onClick={() => navigate(homePath)} className="mt-4 bg-green-600 text-white font-bold px-5 py-2 rounded-full">Home</button></div>
    </div>
  )

  const pct = result.percentage ?? 0
  const msg = pct >= 80 ? { emoji: '🏆', text: 'Excellent!', sub: 'You really know your stuff!' }
    : pct >= 60 ? { emoji: '👏', text: 'Good Job!', sub: 'Keep practicing to improve!' }
    : pct >= 40 ? { emoji: '💪', text: 'Getting There!', sub: 'Review the topics below to do better next time.' }
    : { emoji: '📖', text: 'Keep Practicing!', sub: 'Every attempt makes you stronger.' }

  const topics = result.topicScores ? Object.entries(result.topicScores).map(([t, d]) => ({
    topic: t, correct: d.correct, total: d.total,
    pct: d.total > 0 ? Math.round((d.correct / d.total) * 100) : 0,
  })).sort((a, b) => a.pct - b.pct) : []

  const mins = result.timeSpent ? Math.floor(result.timeSpent / 60) : 0
  const secs = result.timeSpent ? result.timeSpent % 60 : 0

  function answerToText(q, answer) {
    if (answer === undefined || answer === null || answer === '') return 'No answer'
    const index = Number(answer)
    if (Array.isArray(q.options) && Number.isInteger(index) && q.options[index]) {
      return q.options[index]
    }
    return String(answer)
  }

  async function handleExplainAnswer(q, userAns) {
    setAiLoading(prev => ({ ...prev, [q.id]: true }))
    try {
      const explanation = await explainQuizAnswer({
        question: q.text,
        learnerAnswer: answerToText(q, userAns),
        correctAnswer: answerToText(q, q.correctAnswer),
        subject: result.subject,
        grade: result.grade,
        topic: q.topic || '',
      })
      setAiExplanations(prev => ({ ...prev, [q.id]: explanation }))
    } catch (error) {
      setAiExplanations(prev => ({ ...prev, [q.id]: error.message }))
    } finally {
      setAiLoading(prev => ({ ...prev, [q.id]: false }))
    }
  }

  return (
    <div className="max-w-xl md:max-w-2xl mx-auto px-4 py-6">
      {/* Score */}
      <div className="bg-white rounded-3xl shadow-md p-6 text-center mb-4 animate-scale-in">
        <ScoreCircle percentage={pct} />
        <div className="text-4xl mt-3 mb-1">{msg.emoji}</div>
        <h1 className="text-2xl font-black text-gray-800">{msg.text}</h1>
        <p className="text-gray-500 text-sm mt-1">{msg.sub}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Score', value: `${result.score}/${result.totalMarks}` },
          { label: 'Mode',  value: result.mode === 'exam' ? '🏆 Exam' : '🌱 Practice' },
          { label: 'Time',  value: `${mins}m ${secs}s` },
          { label: 'Grade', value: `Grade ${result.grade}` },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 text-center">
            <div className="font-black text-gray-800 text-sm leading-tight">{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Topic breakdown */}
      {topics.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
          <h2 className="font-black text-gray-800 mb-3">📊 Topic Breakdown</h2>
          <div className="space-y-2.5">
            {topics.map(t => (
              <div key={t.topic}>
                <div className="flex justify-between text-sm mb-0.5">
                  <span className="font-bold text-gray-700">{t.topic}</span>
                  <span className={`font-black ${t.pct >= 70 ? 'text-green-600' : t.pct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {t.correct}/{t.total} ({t.pct}%)
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div className={`h-2.5 rounded-full transition-all duration-700 ${t.pct >= 70 ? 'bg-green-500' : t.pct >= 50 ? 'bg-yellow-400' : 'bg-red-500'}`}
                    style={{ width: `${t.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Question review */}
      {questions.length > 0 && (
        <div className="mb-4">
          <button onClick={() => setShowReview(r => !r)}
            className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-left font-black text-gray-800 flex justify-between items-center min-h-0">
            <span>📝 Review Answers ({questions.length})</span>
            <span className="text-gray-400">{showReview ? '▲' : '▼'}</span>
          </button>
          {showReview && (
            <div className="mt-2 space-y-3 animate-slide-up">
              {questions.map((q, i) => {
                const userAns = result.answers?.[q.id]
                const correct = userAns === q.correctAnswer
                return (
                  <div key={q.id} className={`bg-white rounded-2xl shadow-sm border-2 p-4 ${correct ? 'border-green-200' : userAns === undefined ? 'border-gray-200' : 'border-red-200'}`}>
                    <div className="flex items-start gap-2 mb-2">
                      <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${correct ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                        {correct ? '✓' : '✗'}
                      </span>
                      <p className="text-sm font-bold text-gray-800 leading-snug">Q{i + 1}. {q.text}</p>
                    </div>
                    <div className="ml-9 space-y-1">
                      {(q.options || []).map((opt, oi) => (
                        <div key={oi} className={`text-sm px-2 py-1 rounded-lg ${oi === q.correctAnswer ? 'bg-green-50 text-green-700 font-bold' : oi === userAns && !correct ? 'bg-red-50 text-red-600 line-through' : 'text-gray-500'}`}>
                          {['A', 'B', 'C', 'D'][oi]}. {opt}
                          {oi === q.correctAnswer && ' ✅'}
                          {oi === userAns && !correct && ' (your answer)'}
                        </div>
                      ))}
                      {!q.options?.length && (
                        <div className="space-y-1 text-sm">
                          <p className="text-gray-500">Your answer: <span className="font-bold">{answerToText(q, userAns)}</span></p>
                          <p className="text-green-700">Expected answer: <span className="font-bold">{answerToText(q, q.correctAnswer)}</span></p>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleExplainAnswer(q, userAns)}
                        disabled={aiLoading[q.id]}
                        className="mt-3 inline-flex items-center gap-1.5 bg-sky-50 text-sky-700 border border-sky-100 font-black text-xs px-3 py-2 rounded-xl hover:bg-sky-100 disabled:opacity-60 min-h-0"
                      >
                        ✦ {aiLoading[q.id] ? 'Explaining…' : 'Explain this answer'}
                      </button>
                      {aiExplanations[q.id] && (
                        <div className="mt-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-sm text-sky-900 leading-relaxed">
                          <p className="font-black text-xs text-sky-700 mb-1">Zed explains</p>
                          {aiExplanations[q.id]}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={() => navigate(`/quiz/${result.quizId}`)}
          className="flex-1 border-2 border-green-600 text-green-600 font-black py-3 rounded-2xl min-h-0 hover:bg-green-50">
          🔄 Try Again
        </button>
        <button onClick={() => navigate('/quizzes')}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black py-3 rounded-2xl min-h-0">
          📝 More Quizzes
        </button>
      </div>
      <div className="text-center mt-2">
        <span className="inline-flex items-center gap-1 bg-green-50 text-green-600 text-xs font-bold px-3 py-1.5 rounded-full">
          ✅ Result saved to your history
        </span>
      </div>
    </div>
  )
}
