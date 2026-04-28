import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import { buildQuizDisplaySections } from '../../utils/quizSections.js'
import UpgradeModal from '../subscription/UpgradeModal'
import QuizTip from './QuizTip'
import ZoomableImage from './ZoomableImage'
import { getPakoTip } from '../../config/curriculum'
import { checkAnswerWithAI } from '../../utils/geminiChecker'
// RichContent renders legacy HTML strings AND Tiptap JSON; getRichPlainText
// extracts plain text from either format. Legacy richTextToPlainText is
// only HTML-aware, so we prefer getRichPlainText wherever we have a choice.
import RichContent, { getRichPlainText } from '../../editor/RichContent'
import { saveQuizSession, loadQuizSession, clearQuizSession } from '../../hooks/useQuizPersistence'

function fmt(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function isTextAnswerType(type) {
  return type === 'short_answer' || type === 'diagram'
}

function OptionButton({ label, selected, revealed, correct, wrong, onClick, children }) {
  let classes = 'theme-card theme-text flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-all '
  if (revealed && correct) classes += 'border-green-400 bg-green-50 text-green-800'
  else if (revealed && wrong) classes += 'border-red-300 bg-red-50 text-red-700'
  else if (selected) classes += 'border-[var(--accent)] theme-accent-bg theme-accent-text'
  else classes += 'theme-border hover:border-[var(--accent)] hover:theme-bg-subtle'

  return (
    <button type="button" onClick={onClick} disabled={revealed} className={classes}>
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-black ${
        revealed && correct ? 'bg-green-500 text-white'
          : revealed && wrong ? 'bg-red-500 text-white'
          : selected ? 'theme-accent-fill theme-on-accent'
          : 'theme-bg-subtle theme-text-muted'
      }`}>
        {label}
      </span>
      <span className="flex-1 text-sm font-semibold leading-snug">{children}</span>
      {revealed && correct && <span className="text-lg">✅</span>}
    </button>
  )
}

function PreQuizCard({ quiz, canExam, onStart }) {
  const [mode, setMode] = useState('practice')

  return (
    <div className="theme-bg theme-text min-h-screen px-4 py-10">
      <div className="theme-card theme-border theme-shadow mx-auto max-w-md overflow-hidden rounded-[28px] border shadow-[0_24px_64px_var(--shadow)]">
        <div className="theme-hero px-6 py-5 text-white">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-bold text-white/75">
            <span>{quiz.subject}</span>
            <span>·</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5">Grade {quiz.grade}</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5">Term {quiz.term}</span>
          </div>
          <h1 className="text-xl font-black leading-tight">{quiz.title}</h1>
        </div>
        <div className="p-6">
          <div className="mb-6 grid grid-cols-3 gap-3">
            {[
              ['❓', quiz.questionCount ?? '—', 'Questions'],
              ['⏱️', quiz.duration ?? '—', 'Minutes'],
              ['⭐', quiz.totalMarks ?? '—', 'Marks'],
            ].map(([icon, value, label]) => (
              <div key={label} className="theme-accent-bg rounded-2xl py-4 text-center">
                <div className="mb-1 text-2xl">{icon}</div>
                <div className="theme-text text-lg font-black">{value}</div>
                <div className="theme-text-muted text-xs font-bold">{label}</div>
              </div>
            ))}
          </div>

          <p className="theme-text-muted mb-3 text-center text-xs font-black uppercase tracking-[0.18em]">Choose Mode</p>
          <div className="mb-6 grid grid-cols-2 gap-3">
            {[
              { id: 'practice', icon: '🌱', label: 'Practice', sub: 'See answers live', locked: false },
              { id: 'exam', icon: '🏆', label: 'Exam', sub: canExam ? 'Timed · no hints' : 'Premium only', locked: !canExam },
            ].map(item => {
              const active = mode === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => !item.locked && setMode(item.id)}
                  className={`relative rounded-2xl border-2 p-4 text-left transition-all ${
                    active ? 'border-[var(--accent)] theme-accent-bg' : 'theme-border theme-card'
                  } ${item.locked ? 'opacity-55' : ''}`}
                >
                  {item.locked && <span className="absolute right-3 top-3 text-xs">🔒</span>}
                  <div className="mb-1 text-2xl">{item.icon}</div>
                  <div className="theme-text text-sm font-black">{item.label}</div>
                  <div className="theme-text-muted mt-0.5 text-xs">{item.sub}</div>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => onStart(mode)}
            className="theme-accent-fill theme-on-accent w-full rounded-2xl py-4 text-lg font-black shadow-[0_12px_28px_var(--shadow)] transition-colors hover:opacity-90"
          >
            🚀 Start {mode === 'practice' ? 'Practice' : 'Exam'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function QuizRunnerV2() {
  const { quizId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { getQuizById, getQuestions, saveResult } = useFirestore()
  const { canUseExamMode, canAccessFullContent } = useSubscription()

  const [quiz, setQuiz] = useState(null)
  const [sections, setSections] = useState([])
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)
  const [mode, setMode] = useState('practice')
  const [activeSectionIndex, setActiveSectionIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [flagged, setFlagged] = useState({})
  const [revealed, setRevealed] = useState({})
  const [timeLeft, setTimeLeft] = useState(0)
  // endTime is a Unix-ms timestamp; timeLeft is always derived from it so
  // a page refresh can't reset the clock.
  const [endTime, setEndTime] = useState(null)
  const [startTime, setStartTime] = useState(null)
  const [showSubmit, setShowSubmit] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [actionError, setActionError] = useState('')
  const [feedbackType, setFeedbackType] = useState(null)
  const [pakoTip, setPakoTip] = useState({ visible: false, text: '', isCorrect: null, questionId: null })
  const [shortText, setShortText] = useState({})
  const [aiChecking, setAiChecking] = useState({})
  const [aiResults, setAiResults] = useState({})
  const timerRef = useRef(null)
  const autoRef = useRef(false)
  const submitRef = useRef(null)

  useEffect(() => {
    async function load() {
      try {
        const [quizDoc, questionDocs] = await Promise.all([getQuizById(quizId), getQuestions(quizId)])
        if (!quizDoc) {
          setError('Quiz not found')
          setLoading(false)
          return
        }
        if (!quizDoc.isDemo && !canAccessFullContent) {
          navigate('/quizzes', { replace: true, state: { blocked: true } })
          return
        }

        const built = buildQuizDisplaySections(questionDocs, quizDoc.passages || [])
        setQuiz(quizDoc)
        setSections(built.sections)
        setQuestions(built.questions)

        // Auto-resume any in-progress session saved in localStorage
        if (currentUser) {
          const saved = loadQuizSession(quizId, currentUser.uid)
          if (saved) {
            setMode(saved.mode)
            setAnswers(saved.answers || {})
            setFlagged(saved.flagged || {})
            setRevealed(saved.revealed || {})
            setShortText(saved.shortText || {})
            setAiResults(saved.aiResults || {})
            setActiveSectionIndex(Math.min(saved.activeSectionIndex || 0, built.sections.length - 1))
            if (saved.endTime) setEndTime(saved.endTime)
            setStartTime(saved.startTime || Date.now())
            setStarted(true)
          }
        }
      } catch (err) {
        console.error('QuizRunner load failed', err)
        setError('Could not load quiz. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    load()
    return () => clearInterval(timerRef.current)
  }, [quizId, getQuizById, getQuestions, canAccessFullContent, navigate, currentUser])

  function handleStart(nextMode) {
    if (nextMode === 'exam' && !canUseExamMode) {
      setShowUpgrade(true)
      return
    }
    const now = Date.now()
    setMode(nextMode)
    setStarted(true)
    setStartTime(now)
    if (nextMode === 'exam') {
      // Store a fixed deadline so a refresh can never extend the countdown.
      const deadline = now + (quiz.duration || 30) * 60 * 1000
      setEndTime(deadline)
    }
  }

  useEffect(() => {
    if (!started || mode !== 'exam' || !endTime) return

    // Tick every 500 ms so the displayed second never lags more than half a beat.
    // timeLeft is always re-computed from the fixed endTime, never decremented,
    // so a page refresh can't add time back.
    const tick = () => {
      const remaining = Math.max(0, Math.round((endTime - Date.now()) / 1000))
      setTimeLeft(remaining)
      if (remaining <= 0) {
        clearInterval(timerRef.current)
        if (!autoRef.current) {
          autoRef.current = true
          submitRef.current?.(true)
        }
      }
    }

    tick() // apply immediately on mount / resume
    timerRef.current = setInterval(tick, 500)
    return () => clearInterval(timerRef.current)
  }, [started, mode, endTime])

  // Persist state whenever anything meaningful changes.
  // endTime / startTime are stable after the session starts, so we omit them
  // from deps — they're captured in the closure and written as part of the payload.
  useEffect(() => {
    if (!started || !currentUser) return
    saveQuizSession(quizId, currentUser.uid, {
      mode,
      answers,
      flagged,
      revealed,
      shortText,
      aiResults,
      activeSectionIndex,
      endTime,
      startTime,
      savedAt: Date.now(),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, flagged, revealed, shortText, aiResults, activeSectionIndex, started])

  // Warn the user before they navigate away mid-exam.
  useEffect(() => {
    if (!started || mode !== 'exam') return
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = 'Your exam is in progress — leaving will not stop the timer.'
      return e.returnValue
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [started, mode])

  function pick(questionId, optionIndex) {
    setAnswers(current => ({ ...current, [questionId]: optionIndex }))
    if (mode === 'practice') {
      setRevealed(current => ({ ...current, [questionId]: true }))
      const currentQuestion = questions.find(question => question.id === questionId)
      const isCorrect = currentQuestion && optionIndex === currentQuestion.correctAnswer
      setFeedbackType(isCorrect ? 'correct' : 'wrong')
      setTimeout(() => setFeedbackType(null), 1300)
      const tipText = getRichPlainText(currentQuestion?.explanation) || getPakoTip(currentQuestion?.topic, isCorrect)
      setPakoTip({ visible: true, text: tipText, isCorrect, questionId })
    }
  }

  async function checkShortAnswer(questionId) {
    const currentQuestion = questions.find(question => question.id === questionId)
    const typedAnswer = shortText[questionId]?.trim()
    if (!typedAnswer || !currentQuestion) return

    const questionText = [
      getRichPlainText(currentQuestion.sharedInstruction),
      getRichPlainText(currentQuestion.text),
      String(currentQuestion.diagramText ?? '').trim(),
    ].filter(Boolean).join('\n')
    if (!questionText) {
      setActionError('This question needs question text before AI can check it.')
      return
    }

    setAiChecking(current => ({ ...current, [questionId]: true }))
    setActionError('')
    try {
      const result = await checkAnswerWithAI({
        question: questionText,
        correctAnswer: String(currentQuestion.correctAnswer ?? '').trim(),
        studentAnswer: typedAnswer,
        subject: quiz?.subject ?? '',
        grade: quiz?.grade ?? '',
      })
      setAiResults(current => ({ ...current, [questionId]: result }))
      setAnswers(current => ({ ...current, [questionId]: { text: typedAnswer, correct: result.correct } }))
      if (mode === 'practice') {
        setRevealed(current => ({ ...current, [questionId]: true }))
        setFeedbackType(result.correct ? 'correct' : 'wrong')
        setTimeout(() => setFeedbackType(null), 1300)
        setPakoTip({ visible: true, text: result.feedback, isCorrect: result.correct, questionId })
      }
    } catch (error) {
      console.error('AI check failed:', error)
      setActionError(error?.message || 'AI marking is temporarily unavailable. Please try again.')
    } finally {
      setAiChecking(current => ({ ...current, [questionId]: false }))
    }
  }

  const handleSubmit = useCallback(async (auto = false) => {
    if (!auto) setShowSubmit(false)
    setSubmitting(true)
    try {
      const timeSpent = startTime ? Math.round((Date.now() - startTime) / 1000) : 0
      let score = 0
      let total = 0
      const topicScores = {}

      questions.forEach(question => {
        const correct = isTextAnswerType(question.type)
          ? answers[question.id]?.correct === true
          : answers[question.id] === question.correctAnswer
        total += question.marks || 1
        if (correct) score += question.marks || 1
        const topic = question.topic || 'General'
        topicScores[topic] ??= { correct: 0, total: 0 }
        topicScores[topic].total += question.marks || 1
        if (correct) topicScores[topic].correct += question.marks || 1
      })

      const percentage = total > 0 ? Math.round((score / total) * 100) : 0
      const resultId = await saveResult({
        userId: currentUser.uid,
        quizId,
        quizTitle: quiz.title,
        subject: quiz.subject,
        grade: quiz.grade,
        score,
        totalMarks: total,
        percentage,
        mode,
        answers,
        topicScores,
        timeSpent,
      })
      // Clear saved session now that results are safely in Firestore
      clearQuizSession(quizId, currentUser.uid)
      navigate(`/results/${resultId}`)
    } catch (error) {
      console.error(error)
      setSubmitting(false)
      setActionError('Failed to save your results. Please check your connection and try again.')
    }
  }, [answers, questions, quiz, quizId, currentUser, mode, startTime, saveResult, navigate])
  submitRef.current = handleSubmit

  if (loading) {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-3 text-5xl animate-bounce">📝</div>
          <p className="theme-accent-text text-lg font-bold">Loading quiz...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center px-4">
        <div className="theme-card theme-border rounded-3xl border p-8 text-center shadow-sm">
          <div className="mb-3 text-4xl">😕</div>
          <p className="font-bold text-red-600">{error}</p>
          <button type="button" onClick={() => navigate('/quizzes')} className="theme-accent-fill theme-on-accent mt-4 rounded-full px-5 py-2 font-bold">
            ← Back
          </button>
        </div>
      </div>
    )
  }

  if (!started) {
    return (
      <>
        {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
        <PreQuizCard quiz={quiz} canExam={canUseExamMode} onStart={handleStart} />
      </>
    )
  }

  if (submitting) {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-3 text-5xl animate-spin">⏳</div>
          <p className="theme-accent-text text-xl font-black">Saving results...</p>
        </div>
      </div>
    )
  }

  const activeSection = sections[activeSectionIndex]
  if (!activeSection) return null

  const answered = Object.keys(answers).length
  const progress = questions.length ? Math.round((answered / questions.length) * 100) : 0
  const warn = mode === 'exam' && timeLeft <= 60

  function renderQuestion(question) {
    const isRevealed = mode === 'practice' && revealed[question.id]
    const userAnswer = answers[question.id]
    const checking = aiChecking[question.id]
    const aiResult = aiResults[question.id]
    const checked = !!aiResult
    const typed = shortText[question.id] ?? ''

    return (
      <div key={question.id} className="theme-card theme-border theme-text space-y-4 rounded-[24px] border p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="theme-accent-bg theme-accent-text rounded-full px-3 py-1 text-xs font-black">Q{question.questionNumber}</span>
            {question.topic && <span className="theme-bg-subtle theme-text-muted rounded-full px-2.5 py-1 text-xs font-bold">{question.topic}</span>}
            {question.marks > 1 && <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-700">{question.marks} marks</span>}
          </div>
          <button
            type="button"
            onClick={() => setFlagged(current => ({ ...current, [question.id]: !current[question.id] }))}
            className={`rounded-full p-2 transition-colors ${flagged[question.id] ? 'bg-amber-100 text-amber-700' : 'theme-bg-subtle theme-text-muted'}`}
            title={flagged[question.id] ? 'Unflag' : 'Flag for review'}
          >
            🚩
          </button>
        </div>

        {question.imageUrl && (
          <div className="theme-border theme-bg-subtle overflow-hidden rounded-2xl border p-3">
            <ZoomableImage
              src={question.imageUrl}
              alt="Question illustration"
              className="mx-auto max-h-[80vh] w-full rounded-xl object-contain"
            />
          </div>
        )}

        <div>
          {question.sharedInstruction && (
            <div className="theme-accent-bg theme-border theme-accent-text mb-3 rounded-2xl border px-3 py-2 text-sm font-bold leading-relaxed">
              <RichContent value={question.sharedInstruction} className="theme-accent-text text-sm font-bold leading-relaxed" />
            </div>
          )}
          <RichContent value={question.text} className="text-[17px] font-bold leading-relaxed" />
          {question.diagramText && (
            <p className="theme-bg-subtle theme-text-muted mt-2 rounded-xl px-3 py-2 text-xs font-bold leading-relaxed">{question.diagramText}</p>
          )}
        </div>

        {isTextAnswerType(question.type) ? (
          <div className="space-y-3">
            <div className={`overflow-hidden rounded-2xl border-2 ${checked && mode === 'practice'
              ? aiResult.correct ? 'border-green-300' : 'border-orange-300'
              : 'theme-border'}`}>
              <div className="theme-border theme-bg-subtle theme-text-muted border-b px-4 py-2 text-sm">🤖 AI-checked answer</div>
              <div className="flex items-center gap-2 p-3">
                <input
                  type="text"
                  value={typed}
                  onChange={event => {
                    setShortText(current => ({ ...current, [question.id]: event.target.value }))
                    if (actionError) setActionError('')
                    if (checked) {
                      setAiResults(current => {
                        const next = { ...current }
                        delete next[question.id]
                        return next
                      })
                      setAnswers(current => {
                        const next = { ...current }
                        delete next[question.id]
                        return next
                      })
                      setRevealed(current => {
                        const next = { ...current }
                        delete next[question.id]
                        return next
                      })
                    }
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && typed.trim() && !checking && !checked) checkShortAnswer(question.id)
                  }}
                  disabled={checking}
                  placeholder="Type your answer here..."
                  className="theme-text flex-1 bg-transparent text-base font-semibold outline-none"
                />
                {checking && <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />}
                {checked && mode === 'practice' && <span className="text-xl">{aiResult.correct ? '✅' : '❌'}</span>}
              </div>
            </div>

            {!checked && (
              <button
                type="button"
                onClick={() => checkShortAnswer(question.id)}
                disabled={!typed.trim() || checking}
                className="theme-accent-fill theme-on-accent w-full rounded-2xl py-3.5 font-black transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--border)] disabled:text-[var(--text-muted)]"
              >
                {checking ? '🤖 AI is checking...' : mode === 'exam' ? '🤖 Save Answer' : '🤖 Check My Answer'}
              </button>
            )}

            {checked && mode === 'practice' && (
              <>
                <div className={`rounded-2xl border-2 p-4 ${aiResult.correct ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
                  {aiResult.correct ? (
                    <>
                      <p className="text-lg font-black text-green-700">🌟 Correct! Well done!</p>
                      <p className="mt-1 text-sm text-green-700">{aiResult.feedback}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-black text-orange-700">💡 Not quite!</p>
                      <p className="mt-1 text-sm text-orange-700">{aiResult.feedback}</p>
                      {question.correctAnswer && <p className="theme-text-muted mt-1.5 text-xs">Expected: <strong>{question.correctAnswer}</strong></p>}
                    </>
                  )}
                </div>
                {question.explanation && (
                  <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-wide text-sky-700">Teacher explanation</p>
                    <RichContent value={question.explanation} className="mt-2 text-sm leading-relaxed text-sky-950" />
                  </div>
                )}
                <QuizTip
                  isCorrect={aiResult.correct}
                  tipText={pakoTip.text}
                  visible={pakoTip.visible && pakoTip.questionId === question.id}
                  onDismiss={() => setPakoTip(current => ({ ...current, visible: false }))}
                />
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {question.options.map((option, optionIndex) => (
                <OptionButton
                  key={`${question.id}-${optionIndex}`}
                  label={['A', 'B', 'C', 'D'][optionIndex]}
                  selected={!isRevealed && userAnswer === optionIndex}
                  revealed={isRevealed}
                  correct={isRevealed && optionIndex === question.correctAnswer}
                  wrong={isRevealed && userAnswer === optionIndex && userAnswer !== question.correctAnswer}
                  onClick={() => !isRevealed && pick(question.id, optionIndex)}
                >
                  {option}
                </OptionButton>
              ))}
            </div>

            {isRevealed && (
              <>
                <QuizTip
                  isCorrect={userAnswer === question.correctAnswer ? true : userAnswer === undefined ? null : false}
                  tipText={pakoTip.text}
                  visible={pakoTip.visible && pakoTip.questionId === question.id}
                  onDismiss={() => setPakoTip(current => ({ ...current, visible: false }))}
                />
                <div className={`rounded-2xl border-2 p-4 ${
                  userAnswer === question.correctAnswer ? 'border-green-200 bg-green-50'
                    : userAnswer === undefined ? 'theme-border theme-bg-subtle'
                    : 'border-orange-200 bg-orange-50'
                }`}>
                  {userAnswer === question.correctAnswer ? (
                    <>
                      <p className="text-lg font-black text-green-700">🌟 Excellent! Well done!</p>
                      <p className="mt-1 text-sm text-green-700">The answer is <strong>{question.options[question.correctAnswer]}</strong></p>
                    </>
                  ) : userAnswer === undefined ? (
                    <>
                      <p className="theme-text text-lg font-black">⏭️ Skipped</p>
                      <p className="theme-text-muted mt-1 text-sm">Correct: <strong>{question.options[question.correctAnswer]}</strong></p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-black text-orange-700">💡 Not quite — you can do it!</p>
                      <p className="mt-1 text-sm text-orange-700">Correct answer: <strong>{question.options[question.correctAnswer]}</strong></p>
                    </>
                  )}
                </div>
                {question.explanation && (
                  <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                    <p className="text-xs font-black uppercase tracking-wide text-sky-700">Explanation</p>
                    <RichContent value={question.explanation} className="mt-2 text-sm leading-relaxed text-sky-950" />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  function sectionAnswered(section) {
    const items = section.kind === 'passage' ? section.questions : [section.question]
    return items.every(question => answers[question.id] !== undefined)
  }

  function sectionFlagged(section) {
    const items = section.kind === 'passage' ? section.questions : [section.question]
    return items.some(question => flagged[question.id])
  }

  return (
    <div className="theme-bg theme-text min-h-screen">
      {actionError && (
        <div className="fixed left-1/2 top-4 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 animate-slide-up">
          <div className="flex items-start gap-3 rounded-2xl border-2 border-orange-300 bg-orange-50 px-4 py-3 text-orange-900 shadow-xl">
            <span className="mt-0.5 text-lg">⚠️</span>
            <p className="flex-1 text-sm font-bold leading-snug">{actionError}</p>
            <button type="button" onClick={() => setActionError('')} className="min-h-0 bg-transparent p-0 text-lg text-orange-700 shadow-none">×</button>
          </div>
        </div>
      )}

      {feedbackType && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          {feedbackType === 'correct' ? (
            <div className="flex flex-col items-center animate-pop">
              <div className="text-8xl">⭐</div>
              <div className="mt-2 rounded-2xl bg-green-500 px-7 py-2.5 text-xl font-black text-white shadow-xl">Correct! 🎉</div>
            </div>
          ) : (
            <div className="flex flex-col items-center animate-pop">
              <div className="text-7xl">💪</div>
              <div className="mt-2 rounded-2xl bg-orange-400 px-6 py-2.5 text-lg font-black text-white shadow-xl">Keep going!</div>
            </div>
          )}
        </div>
      )}

      {showSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="theme-card theme-border w-full max-w-sm rounded-3xl border p-6 text-center shadow-2xl">
            <div className="mb-3 text-5xl">📤</div>
            <h2 className="mb-2 text-xl font-black">Submit Quiz?</h2>
            {questions.length - answered > 0 ? (
              <p className="theme-text-muted mb-5 text-sm">You have <span className="font-black text-orange-500">{questions.length - answered} unanswered</span> — they&apos;ll be marked incorrect.</p>
            ) : (
              <p className="theme-text-muted mb-5 text-sm">All {questions.length} questions answered. Ready!</p>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowSubmit(false)} className="theme-border theme-text-muted flex-1 rounded-2xl border-2 py-3 font-bold">← Keep Going</button>
              <button type="button" onClick={() => handleSubmit(false)} className="theme-accent-fill theme-on-accent flex-1 rounded-2xl py-3 font-black">Submit ✓</button>
            </div>
          </div>
        </div>
      )}

      <div className="theme-hero sticky top-0 z-30 text-white shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-white/70">{quiz.subject} · Grade {quiz.grade}</p>
              <p className="truncate text-sm font-black leading-tight">{quiz.title}</p>
            </div>
            <div className="flex items-center gap-2">
              {mode === 'exam' && <div className={`rounded-full px-3 py-1.5 text-sm font-black tabular-nums ${warn ? 'bg-red-500' : 'bg-white/20'}`}>⏱️ {fmt(timeLeft)}</div>}
              {mode === 'practice' && <span className="rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold">🌱 Practice</span>}
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-[linear-gradient(90deg,#22c55e,#a3e635)] transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] font-bold text-white/65">
            <span>{answered} answered</span>
            <span>{questions.length - answered} left</span>
          </div>
        </div>
      </div>

      <div className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-5xl flex-1 flex-col px-4 py-4 pb-44">
        {activeSection.kind === 'passage' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <div className="theme-card theme-border overflow-hidden rounded-[24px] border shadow-sm">
                <div className="theme-accent-bg theme-border border-b px-5 py-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="theme-card theme-border theme-accent-text rounded-full border px-3 py-1 text-xs font-black">Comprehension Passage</span>
                    <span className="theme-bg-subtle theme-text-muted rounded-full px-2.5 py-1 text-xs font-bold">{activeSection.questions.length} question{activeSection.questions.length === 1 ? '' : 's'}</span>
                  </div>
                  {activeSection.passage.title && <h2 className="theme-text text-lg font-black">{activeSection.passage.title}</h2>}
                  {activeSection.passage.instructions && (
                    <RichContent value={activeSection.passage.instructions} className="theme-accent-text mt-2 text-sm font-bold" />
                  )}
                </div>
                {activeSection.passage.imageUrl && (
                  <div className="theme-border theme-bg-subtle border-b p-4">
                    <ZoomableImage
                      src={activeSection.passage.imageUrl}
                      alt="Passage illustration"
                      className="mx-auto max-h-[80vh] w-full rounded-2xl object-contain"
                    />
                  </div>
                )}
                <div className="p-5">
                  <RichContent value={activeSection.passage.passageText} className="text-sm leading-7" />
                </div>
              </div>
            </div>
            <div className="space-y-4">
              {activeSection.questions.map(renderQuestion)}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl">
            {renderQuestion(activeSection.question)}
          </div>
        )}
      </div>

      <div className="theme-card theme-border fixed bottom-0 left-0 right-0 z-30 border-t backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="theme-text-muted text-xs font-black">Section <span className="theme-accent-text">{activeSectionIndex + 1}</span> of {sections.length}</span>
            <span className="theme-text-muted text-xs font-bold">{answered}/{questions.length} answered</span>
          </div>
          {sections.length <= 20 ? (
            <div className="mb-3 flex gap-1.5">
              {sections.map((section, index) => {
                const current = index === activeSectionIndex
                const complete = sectionAnswered(section)
                const flaggedSection = sectionFlagged(section)
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => {
                      if (index > activeSectionIndex && !sectionAnswered(activeSection)) {
                        setActionError('Please answer the current question before jumping ahead.')
                        return
                      }
                      setActiveSectionIndex(index)
                    }}
                    title={`Section ${index + 1}${complete ? ' ✓' : ''}${flaggedSection ? ' 🚩' : ''}`}
                    className="min-h-0 flex-1 rounded-full transition-all"
                    style={{
                      height: 8,
                      background: current ? 'var(--accent)' : flaggedSection ? '#f59e0b' : complete ? 'var(--accent-bg)' : 'var(--border)',
                      outline: current ? '2px solid var(--accent)' : 'none',
                      outlineOffset: 1,
                    }}
                  />
                )
              })}
            </div>
          ) : (
            <div className="theme-border mb-3 h-2 overflow-hidden rounded-full bg-[var(--border)]">
              <div className="theme-accent-fill h-full rounded-full transition-all duration-300" style={{ width: `${sections.length ? Math.round(((activeSectionIndex + 1) / sections.length) * 100) : 0}%` }} />
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setActiveSectionIndex(index => Math.max(0, index - 1))} disabled={activeSectionIndex === 0} className="theme-border theme-text-muted rounded-2xl border-2 px-5 py-2.5 text-sm font-bold disabled:opacity-35">
              ← Prev
            </button>
            {activeSectionIndex < sections.length - 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (!sectionAnswered(activeSection)) {
                    setActionError('Please answer this question before moving to the next one.')
                    return
                  }
                  setActiveSectionIndex(index => index + 1)
                }}
                className="theme-accent-fill theme-on-accent rounded-2xl px-7 py-2.5 text-sm font-black shadow-[0_4px_14px_var(--shadow)]"
              >
                Next →
              </button>
            ) : (
              <button type="button" onClick={() => setShowSubmit(true)} className="rounded-2xl bg-amber-400 px-7 py-2.5 text-sm font-black text-slate-900 shadow-[0_4px_14px_rgba(245,158,11,0.35)]">
                Submit 🏁
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
