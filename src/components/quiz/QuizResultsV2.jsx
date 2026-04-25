import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, RotateCcw, ListChecks, Sparkles, Check, Volume2, VolumeX } from '../ui/icons'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { buildQuizDisplaySections } from '../../utils/quizSections.js'
import { getRoleLandingPath } from '../../utils/navigation'
import { explainQuizAnswer } from '../../utils/aiAssistant'
import useSoundEffects from '../../hooks/useSoundEffects'
// Format-aware renderer + plain-text extractor. Works for both legacy HTML
// quizzes and Tiptap JSON quizzes saved by the new editor.
import RichContent, { getRichPlainText } from '../../editor/RichContent'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Skeleton from '../ui/Skeleton'

function ScoreCircle({ percentage }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percentage / 100) * circumference
  const color = percentage >= 70 ? '#16a34a' : percentage >= 50 ? '#eab308' : '#dc2626'

  return (
    <div className="relative mx-auto h-36 w-36">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--border)" strokeWidth="10" />
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
        <span className="theme-text-muted text-xs font-bold">SCORE</span>
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
  const { isMuted, toggleMute, playSuccess, playClick, playWarning, primeSounds } = useSoundEffects()

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

  // Play a soft success / warning chime once the result is on screen.
  // Wrapped in try/catch upstream — autoplay blocks fail silently.
  useEffect(() => {
    if (!result) return
    const pct = result.percentage ?? 0
    if (pct < 50) {
      playWarning()
    } else {
      playSuccess()
    }
  }, [result, playSuccess, playWarning])

  async function handleExplainAnswer(question, userAnswer) {
    setAiLoading(current => ({ ...current, [question.id]: true }))
    try {
      const explanation = await explainQuizAnswer({
        question: [getRichPlainText(question.sharedInstruction), getRichPlainText(question.text), question.diagramText]
          .filter(Boolean)
          .join('\n'),
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
      <div className="theme-bg min-h-screen px-4 py-10">
        <div className="mx-auto max-w-xl space-y-4">
          <div className="theme-card theme-border rounded-3xl border p-6 text-center shadow-elev-md">
            <Skeleton shape="circle" size={144} className="mx-auto" />
            <div className="mx-auto mt-4 max-w-[50%]"><Skeleton height={22} /></div>
            <div className="mx-auto mt-2 max-w-[72%]"><Skeleton height={14} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="theme-card theme-border rounded-2xl border p-3">
                <Skeleton height={16} />
                <div className="mt-2"><Skeleton height={10} width="60%" /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center p-4">
        <div className="theme-text text-center">
          <div className="mb-3 text-5xl" aria-hidden="true">😕</div>
          <p className="text-display-md text-danger">Result not found</p>
          <div className="mt-4 inline-flex">
            <Button variant="primary" size="md" onClick={() => navigate(homePath)}>Home</Button>
          </div>
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
      <div key={question.id} className={`theme-card theme-text rounded-2xl border-2 p-4 shadow-sm ${
        correct ? 'border-green-200' : userAnswer === undefined ? 'border-gray-200' : 'border-red-200'
      }`}>
        <div className="mb-2 flex items-start gap-2">
          <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-black ${
            correct ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {correct ? '✓' : '✗'}
          </span>
          <div className="min-w-0 flex-1">
            {question.sharedInstruction && (
              <div className="theme-accent-bg theme-border theme-accent-text mb-2 rounded-2xl border px-3 py-2 text-sm font-bold leading-relaxed">
                <RichContent value={question.sharedInstruction} className="theme-accent-text text-sm font-bold leading-relaxed" />
              </div>
            )}
            <div className="text-sm font-bold leading-snug">
              <p>Q{question.questionNumber}.</p>
              <RichContent value={question.text} className="mt-1" />
            </div>
            {question.topic && <p className="theme-text-muted mt-1 text-xs font-bold">{question.topic}</p>}
          </div>
        </div>
        <div className="ml-9 space-y-1">
          {(question.options || []).length ? (
            question.options.map((option, optionIndex) => (
              <div key={`${question.id}-${optionIndex}`} className={`rounded-lg px-2 py-1 text-sm ${
                optionIndex === question.correctAnswer ? 'bg-green-50 font-bold text-green-700'
                  : optionIndex === userAnswer && !correct ? 'bg-red-50 text-red-600 line-through'
                  : 'theme-text-muted'
              }`}>
                {['A', 'B', 'C', 'D'][optionIndex]}. {option}
                {optionIndex === question.correctAnswer && ' ✅'}
                {optionIndex === userAnswer && !correct && ' (your answer)'}
              </div>
            ))
          ) : (
            <div className="space-y-1 text-sm">
              <p className="theme-text-muted">Your answer: <span className="font-bold">{answerToText(question, userAnswer)}</span></p>
              <p className="text-green-700">Expected answer: <span className="font-bold">{answerToText(question, question.correctAnswer)}</span></p>
            </div>
          )}

          <div className="mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleExplainAnswer(question, userAnswer)}
              loading={aiLoading[question.id]}
              leadingIcon={<Icon as={Sparkles} size="sm" />}
            >
              {aiLoading[question.id] ? 'Explaining…' : 'Explain this answer'}
            </Button>
          </div>
          {aiExplanations[question.id] && (
            <div className="theme-accent-bg theme-border theme-text mt-2 rounded-xl border px-3 py-2 text-sm leading-relaxed">
              <p className="theme-accent-text mb-1 text-xs font-black">Zed explains</p>
              {aiExplanations[question.id]}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="theme-text mx-auto max-w-4xl px-4 py-6 animate-slide-up">
      <div className="theme-card theme-border relative mb-4 rounded-3xl border p-6 text-center shadow-elev-lg">
        <button
          type="button"
          onClick={() => { primeSounds(); toggleMute() }}
          aria-label={isMuted ? 'Unmute sound effects' : 'Mute sound effects'}
          aria-pressed={isMuted}
          title={isMuted ? 'Unmute sound effects' : 'Mute sound effects'}
          className="theme-text-muted hover:theme-text absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border theme-border transition-colors duration-fast"
        >
          <Icon as={isMuted ? VolumeX : Volume2} size="sm" />
        </button>
        <ScoreCircle percentage={percentage} />
        <div className="mb-1 mt-3 text-4xl animate-pop" aria-hidden="true">{message.emoji}</div>
        <h1 className="text-display-xl theme-text">{message.text}</h1>
        <p className="theme-text-muted text-body mt-1">{message.sub}</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 stagger">
        {[
          { label: 'Score', value: `${result.score}/${result.totalMarks}` },
          { label: 'Mode', value: result.mode === 'exam' ? '🏆 Exam' : '🌱 Practice' },
          { label: 'Time', value: `${mins}m ${secs}s` },
          { label: 'Grade', value: `Grade ${result.grade}` },
        ].map(stat => (
          <div key={stat.label} className="theme-card theme-border rounded-2xl border p-3 text-center shadow-elev-sm animate-slide-in-soft">
            <div className="text-display-md theme-text leading-tight" style={{ fontSize: 16 }}>{stat.value}</div>
            <div className="text-eyebrow mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {topics.length > 0 && (
        <div className="theme-card theme-border mb-4 rounded-2xl border p-4 shadow-elev-md">
          <h2 className="text-display-md theme-text mb-3 flex items-center gap-2">
            <span aria-hidden="true">📊</span> Topic breakdown
          </h2>
          <div className="space-y-2.5">
            {topics.map(topic => (
              <div key={topic.topic}>
                <div className="mb-0.5 flex justify-between text-sm">
                  <span className="font-bold">{topic.topic}</span>
                  <span className={`font-black ${topic.pct >= 70 ? 'text-green-600' : topic.pct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {topic.correct}/{topic.total} ({topic.pct}%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-[var(--border)]">
                  <div className={`h-2.5 rounded-full ${topic.pct >= 70 ? 'bg-green-500' : topic.pct >= 50 ? 'bg-yellow-400' : 'bg-red-500'}`} style={{ width: `${topic.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {questions.length > 0 && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowReview(current => !current)}
            aria-expanded={showReview}
            className="theme-card theme-border flex w-full items-center justify-between rounded-2xl border p-4 text-left font-black shadow-elev-sm hover:shadow-elev-md transition-all duration-fast ease-out"
          >
            <span className="flex items-center gap-2 text-display-md theme-text" style={{ fontSize: 16 }}>
              <Icon as={ListChecks} size="md" /> Review answers <span className="theme-text-muted text-sm font-bold">({questions.length})</span>
            </span>
            <Icon as={showReview ? ChevronUp : ChevronDown} size="md" className="theme-text-muted" />
          </button>
          {showReview && (
            <div className="mt-2 space-y-4 animate-slide-up">
              {sections.map(section => (
                section.kind === 'passage' ? (
                  <div key={section.id} className="theme-accent-bg theme-border space-y-3 rounded-[28px] border p-4">
                    <div className="theme-card theme-border rounded-2xl border p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="theme-accent-bg theme-accent-text rounded-full px-3 py-1 text-xs font-black">Comprehension Passage</span>
                        <span className="theme-bg-subtle theme-text-muted rounded-full px-2.5 py-1 text-xs font-bold">{section.questions.length} question{section.questions.length === 1 ? '' : 's'}</span>
                      </div>
                      {section.passage.title && <p className="text-lg font-black">{section.passage.title}</p>}
                      {section.passage.instructions && (
                        <RichContent value={section.passage.instructions} className="theme-accent-text mt-1 text-sm font-bold" />
                      )}
                      {section.passage.imageUrl && <img src={section.passage.imageUrl} alt="Passage illustration" className="mt-3 max-h-72 w-full rounded-2xl object-contain" />}
                      <RichContent value={section.passage.passageText} className="mt-3 text-sm leading-7" />
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
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onClick={() => { playClick(); navigate(`/quiz/${result.quizId}`) }}
          leadingIcon={<Icon as={RotateCcw} size="sm" />}
        >
          Try again
        </Button>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => { playClick(); navigate('/quizzes') }}
          leadingIcon={<Icon as={ListChecks} size="sm" />}
        >
          More quizzes
        </Button>
      </div>
      <div className="mt-3 text-center">
        <span className="bg-success-subtle text-success inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold">
          <Icon as={Check} size="xs" /> Result saved to your history
        </span>
      </div>
    </div>
  )
}
