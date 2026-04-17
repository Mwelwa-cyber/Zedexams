import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { buildQuizDisplaySections } from '../../utils/quizSections'
import { getRoleLandingPath } from '../../utils/navigation'
import { explainQuizAnswer } from '../../utils/aiAssistant'
import RichContent, { getRichPlainText } from '../editor/RichContent'

function ScoreCircle({ percentage }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percentage / 100) * circumference
  const color = percentage >= 70 ? '#16a34a' : percentage >= 50 ? '#eab308' : '#dc2626'

  return (
    <div className="relative mx-auto h-36 w-36">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black" style={{ color }}>{percentage}%</span>
        <span className="text-xs font-bold text-gray-400">SCORE</span>
      </div>
    </div>
  )
}

function answerToText(question, answer) {
  if (answer === undefined || answer === null || answer === '') return 'No answer'
  const index = Number(answer)
  if (Array.isArray(question.options) && Number.isInteger(index) && question.options[index]) {
    return question.options[index]
  }
  if (typeof answer === 'object' && answer !== null && 'text' in answer) {
    return String(answer.text || '')
  }
  return String(answer)
}

export default function QuizResultsV2() {
  const { resultId } = useParams()
  const navigate = useNavigate()
  const { userProfile } = useAuth()
  const { getResultById, getQuestions, getQuizById } = useFirestore()
  const homePath = getRoleLandingPath(userProfile)

  const [result, setResult] = useState(null)
  const [sections, setSections] = useState([])
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showReview, setShowReview] = useState(false)
  const [aiExplanations, setAiExplanations] = useState({})
  const [aiLoading, setAiLoading] = useState({})

  useEffect(() => {
    async function load() {
      const resultDoc = await getResultById(resultId)
      if (!resultDoc) {
        setLoading(false)
        return
      }
      setResult(resultDoc)
      const [quizDoc, questionDocs] = await Promise.all([
        getQuizById(resultDoc.quizId),
        getQuestions(resultDoc.quizId),
      ])
      const built = buildQuizDisplaySections(questionDocs, quizDoc?.passages || [])
      setSections(built.sections)
      setQuestions(built.questions)
      setLoading(false)
    }
    load()
  }, [resultId, getResultById, getQuizById, getQuestions])

  async function handleExplainAnswer(question, userAnswer) {
    setAiLoading(current => ({ ...current, [question.id]: true }))
    try {
      const explanation = await explainQuizAnswer({
        question: getRichPlainText(question.text),
        learnerAnswer: answerToText(question, userAnswer),
        correctAnswer: answerToText(question, question.correctAnswer),
        subject: result.subject,
        grade: result.grade,
        topic: question.topic || '',
      })
      setAiExplanations(current => ({ ...current, [question.id]: explanation }))
    } catch (error) {
      setAiExplanations(current => ({ ...current, [question.id]: error.message }))
    } finally {
      setAiLoading(current => ({ ...current, [question.id]: false }))
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mb-3 animate-bounce text-5xl">📊</div>
          <p className="text-lg font-bold text-green-600">Loading results...</p>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center">
          <div className="mb-3 text-5xl">😕</div>
          <p className="font-bold text-red-600">Result not found</p>
          <button type="button" onClick={() => navigate(homePath)} className="mt-4 rounded-full bg-green-600 px-5 py-2 font-bold text-white">Home</button>
        </div>
      </div>
    )
  }

  const percentage = result.percentage ?? 0
  const message = percentage >= 80
    ? { emoji: '🏆', text: 'Excellent!', sub: 'You really know your stuff!' }
    : percentage >= 60
      ? { emoji: '👏', text: 'Good Job!', sub: 'Keep practicing to improve!' }
      : percentage >= 40
        ? { emoji: '💪', text: 'Getting There!', sub: 'Review the topics below to do better next time.' }
        : { emoji: '📖', text: 'Keep Practicing!', sub: 'Every attempt makes you stronger.' }

  const topics = result.topicScores
    ? Object.entries(result.topicScores).map(([topic, data]) => ({
        topic,
        correct: data.correct,
        total: data.total,
        pct: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
      })).sort((left, right) => left.pct - right.pct)
    : []

  const mins = result.timeSpent ? Math.floor(result.timeSpent / 60) : 0
  const secs = result.timeSpent ? result.timeSpent % 60 : 0

  function renderQuestion(question) {
    const userAnswer = result.answers?.[question.id]
    const correct = userAnswer === question.correctAnswer || userAnswer?.correct === true

    return (
      <div key={question.id} className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${
        correct ? 'border-green-200' : userAnswer === undefined ? 'border-gray-200' : 'border-red-200'
      }`}>
        <div className="mb-2 flex items-start gap-2">
          <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-black ${
            correct ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {correct ? '✓' : '✗'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold leading-snug text-gray-800"><span>Q{question.questionNumber}. </span><RichContent value={question.text} className="inline" /></div>
            {question.topic && <p className="mt-1 text-xs font-bold text-gray-400">{question.topic}</p>}
          </div>
        </div>
        <div className="ml-9 space-y-1">
          {(question.options || []).length ? (
            question.options.map((option, optionIndex) => (
              <div key={`${question.id}-${optionIndex}`} className={`rounded-lg px-2 py-1 text-sm ${
                optionIndex === question.correctAnswer ? 'bg-green-50 font-bold text-green-700'
                  : optionIndex === userAnswer && !correct ? 'bg-red-50 text-red-600 line-through'
                  : 'text-gray-500'
              }`}>
                {['A', 'B', 'C', 'D'][optionIndex]}. {option}
                {optionIndex === question.correctAnswer && ' ✅'}
                {optionIndex === userAnswer && !correct && ' (your answer)'}
              </div>
            ))
          ) : (
            <div className="space-y-1 text-sm">
              <p className="text-gray-500">Your answer: <span className="font-bold">{answerToText(question, userAnswer)}</span></p>
              <p className="text-green-700">Expected answer: <span className="font-bold">{answerToText(question, question.correctAnswer)}</span></p>
            </div>
          )}

          <button
            type="button"
            onClick={() => handleExplainAnswer(question, userAnswer)}
            disabled={aiLoading[question.id]}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs font-black text-sky-700 hover:bg-sky-100 disabled:opacity-60"
          >
            ✦ {aiLoading[question.id] ? 'Explaining...' : 'Explain this answer'}
          </button>
          {aiExplanations[question.id] && (
            <div className="mt-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-sm leading-relaxed text-sky-900">
              <p className="mb-1 text-xs font-black text-sky-700">Zed explains</p>
              {aiExplanations[question.id]}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 rounded-3xl bg-white p-6 text-center shadow-md">
        <ScoreCircle percentage={percentage} />
        <div className="mb-1 mt-3 text-4xl">{message.emoji}</div>
        <h1 className="text-2xl font-black text-gray-800">{message.text}</h1>
        <p className="mt-1 text-sm text-gray-500">{message.sub}</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Score', value: `${result.score}/${result.totalMarks}` },
          { label: 'Mode', value: result.mode === 'exam' ? '🏆 Exam' : '🌱 Practice' },
          { label: 'Time', value: `${mins}m ${secs}s` },
          { label: 'Grade', value: `Grade ${result.grade}` },
        ].map(stat => (
          <div key={stat.label} className="rounded-2xl border border-gray-100 bg-white p-3 text-center shadow-sm">
            <div className="text-sm font-black leading-tight text-gray-800">{stat.value}</div>
            <div className="mt-0.5 text-xs text-gray-400">{stat.label}</div>
          </div>
        ))}
      </div>

      {topics.length > 0 && (
        <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-black text-gray-800">📊 Topic Breakdown</h2>
          <div className="space-y-2.5">
            {topics.map(topic => (
              <div key={topic.topic}>
                <div className="mb-0.5 flex justify-between text-sm">
                  <span className="font-bold text-gray-700">{topic.topic}</span>
                  <span className={`font-black ${topic.pct >= 70 ? 'text-green-600' : topic.pct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {topic.correct}/{topic.total} ({topic.pct}%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-gray-200">
                  <div className={`h-2.5 rounded-full ${topic.pct >= 70 ? 'bg-green-500' : topic.pct >= 50 ? 'bg-yellow-400' : 'bg-red-500'}`} style={{ width: `${topic.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {questions.length > 0 && (
        <div className="mb-4">
          <button type="button" onClick={() => setShowReview(current => !current)} className="flex w-full items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 text-left font-black text-gray-800 shadow-sm">
            <span>📝 Review Answers ({questions.length})</span>
            <span className="text-gray-400">{showReview ? '▲' : '▼'}</span>
          </button>
          {showReview && (
            <div className="mt-2 space-y-4 animate-slide-up">
              {sections.map(section => (
                section.kind === 'passage' ? (
                  <div key={section.id} className="space-y-3 rounded-[28px] border border-orange-200 bg-orange-50/60 p-4">
                    <div className="rounded-2xl border border-orange-100 bg-white p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700">Comprehension Passage</span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{section.questions.length} question{section.questions.length === 1 ? '' : 's'}</span>
                      </div>
                      {section.passage.title && <p className="text-lg font-black text-gray-800">{section.passage.title}</p>}
                      {section.passage.instructions && <p className="mt-1 text-sm font-bold text-orange-700">{section.passage.instructions}</p>}
                      {section.passage.imageUrl && <img src={section.passage.imageUrl} alt="Passage illustration" className="mt-3 max-h-72 w-full rounded-2xl object-contain" />}
                      <RichContent value={section.passage.passageText} className="mt-3 text-sm leading-7 text-gray-700" />
                    </div>
                    {section.questions.map(renderQuestion)}
                  </div>
                ) : renderQuestion(section.question)
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={() => navigate(`/quiz/${result.quizId}`)} className="flex-1 rounded-2xl border-2 border-green-600 py-3 font-black text-green-600 hover:bg-green-50">
          🔄 Try Again
        </button>
        <button type="button" onClick={() => navigate('/quizzes')} className="flex-1 rounded-2xl bg-green-600 py-3 font-black text-white hover:bg-green-700">
          📝 More Quizzes
        </button>
      </div>
      <div className="mt-2 text-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1.5 text-xs font-bold text-green-600">✅ Result saved to your history</span>
      </div>
    </div>
  )
}
