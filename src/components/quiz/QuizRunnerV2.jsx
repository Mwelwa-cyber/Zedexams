import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useFirestore } from '../../hooks/useFirestore'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import { buildQuizDisplaySections } from '../../utils/quizSections.js'
import UpgradeModal from '../subscription/UpgradeModal'
import QuizTip from './QuizTip'
import ZoomableImage from './ZoomableImage'
import DiagramSvg from '../diagrams/DiagramSvg'
import { getPakoTip } from '../../config/curriculum'
import { checkAnswerWithAI } from '../../utils/geminiChecker'
import { numericMatches, hotspotMatches } from '../../utils/examService'
// RichContent renders legacy HTML strings AND Tiptap JSON; getRichPlainText
// extracts plain text from either format. Legacy richTextToPlainText is
// only HTML-aware, so we prefer getRichPlainText wherever we have a choice.
import RichContent, { getRichPlainText } from '../../editor/RichContent'
import { saveQuizSession, loadQuizSession, clearQuizSession } from '../../hooks/useQuizPersistence'
import SeoHelmet from '../seo/SeoHelmet'

function fmt(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function isTextAnswerType(type) {
  return type === 'short_answer' || type === 'diagram'
}

function isNumericType(type) {
  return type === 'numeric'
}

function isHotspotType(type) {
  return type === 'hotspot'
}

// Maps the subject string stored on a quiz (e.g. "Integrated Science",
// "social-studies") to the mascot palette used on the /quizzes discovery page.
// The slug feeds the `quiz-theme-{slug}` CSS class so each quiz takes on its
// subject's colours, and the emoji/name show up in the quiz hero.
const SUBJECT_MASCOT_MAP = {
  mathematics:           { slug: 'mathematics', emoji: '🦊', name: 'Maths Fox' },
  maths:                 { slug: 'mathematics', emoji: '🦊', name: 'Maths Fox' },
  english:               { slug: 'english',     emoji: '🦉', name: 'Story Owl' },
  science:               { slug: 'science',     emoji: '🐢', name: 'Science Turtle' },
  'integrated science':  { slug: 'science',     emoji: '🐢', name: 'Science Turtle' },
  social:                { slug: 'social',      emoji: '🦁', name: 'Adventure Lion' },
  'social studies':      { slug: 'social',      emoji: '🦁', name: 'Adventure Lion' },
  'social-studies':      { slug: 'social',      emoji: '🦁', name: 'Adventure Lion' },
  technology:            { slug: 'technology',  emoji: '🤖', name: 'Tech Robot' },
  'technology studies':  { slug: 'technology',  emoji: '🤖', name: 'Tech Robot' },
  home:                  { slug: 'home',        emoji: '🐝', name: 'Home Bee' },
  'home economics':      { slug: 'home',        emoji: '🐝', name: 'Home Bee' },
  'home-economics':      { slug: 'home',        emoji: '🐝', name: 'Home Bee' },
  arts:                  { slug: 'arts',        emoji: '🎨', name: 'Art Parrot' },
  'expressive art':      { slug: 'arts',        emoji: '🎨', name: 'Art Parrot' },
  'expressive arts':     { slug: 'arts',        emoji: '🎨', name: 'Art Parrot' },
  'expressive-arts':     { slug: 'arts',        emoji: '🎨', name: 'Art Parrot' },
  cinyanja:              { slug: 'cinyanja',    emoji: '🦜', name: 'Nyanja Parrot' },
  chinyanja:             { slug: 'cinyanja',    emoji: '🦜', name: 'Nyanja Parrot' },
  nyanja:                { slug: 'cinyanja',    emoji: '🦜', name: 'Nyanja Parrot' },
}

const DEFAULT_QUIZ_MASCOT = { slug: '', emoji: '🎓', name: 'Quiz Buddy' }

function getQuizSubjectMascot(subject) {
  const key = String(subject || '').trim().toLowerCase()
  return SUBJECT_MASCOT_MAP[key] || DEFAULT_QUIZ_MASCOT
}

function OptionButton({ label, selected, revealed, correct, wrong, onClick, imageUrl, imageAlt, diagram, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={revealed}
      data-selected={selected ? 'true' : 'false'}
      data-correct={revealed && correct ? 'true' : 'false'}
      data-wrong={revealed && wrong ? 'true' : 'false'}
      className="zx-opt"
    >
      <span className="zx-opt-letter">{label}</span>
      <span className="flex-1 text-sm font-semibold leading-snug">
        {diagram ? (
          <DiagramSvg
            libraryKey={diagram.libraryKey}
            params={diagram.params}
            alt={imageAlt || ''}
            className="mb-1 flex max-h-40 w-full items-center justify-center"
          />
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt={imageAlt || ''}
            className="mb-1 max-h-40 w-full rounded-lg object-contain"
          />
        ) : null}
        {children}
      </span>
      {revealed && correct && <span className="text-lg">✅</span>}
    </button>
  )
}

// Layout class for the question image + text pair based on the saved
// imagePosition. Null/absent → 'above' (the only layout that existed before
// this field was added).
const IMAGE_POSITION_CLASSES = {
  above:  'flex flex-col gap-3',
  below:  'flex flex-col-reverse gap-3',
  left:   'flex flex-col gap-3 sm:flex-row sm:items-start',
  right:  'flex flex-col gap-3 sm:flex-row-reverse sm:items-start',
  inline: 'flex flex-col gap-3',
}
function imagePositionClasses(value) {
  return IMAGE_POSITION_CLASSES[value] || IMAGE_POSITION_CLASSES.above
}

function PreQuizCard({ quiz, canExam, onStart }) {
  const [mode, setMode] = useState('practice')
  const mascot = getQuizSubjectMascot(quiz.subject)

  return (
    <div className="theme-bg theme-text min-h-screen px-3 py-8 sm:px-4 sm:py-10">
      <div className="zx-card-shared mx-auto max-w-md overflow-hidden">
        <div className="border-b-2 border-slate-900 bg-orange-50 px-4 py-4 sm:px-6 sm:py-5">
          <div className="mb-2 flex items-center gap-3">
            <span aria-hidden="true" className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-[14px] border-2 border-slate-900 bg-orange-100 text-2xl">
              {mascot.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <span className="zx-eyebrow-shared">{mascot.name}</span>
              <p className="truncate text-xs font-semibold text-slate-700">{quiz.subject} · Grade {quiz.grade} · Term {quiz.term}</p>
            </div>
          </div>
          <h1 className="text-lg font-black leading-tight text-slate-900 sm:text-xl">{quiz.title}</h1>
        </div>
        <div className="p-4 sm:p-6">
          <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              ['❓', quiz.questionCount ?? '—', 'Questions'],
              ['⏱️', quiz.duration ?? '—', 'Minutes'],
              ['⭐', quiz.totalMarks ?? '—', 'Marks'],
            ].map(([icon, value, label]) => (
              <div key={label} className="rounded-[14px] border-2 border-slate-900 bg-orange-50 px-1 py-3 text-center shadow-[0_2px_0_#0F1B2D]">
                <div className="mb-1 text-xl sm:text-2xl">{icon}</div>
                <div className="text-base font-black text-slate-900 sm:text-lg">{value}</div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600">{label}</div>
              </div>
            ))}
          </div>

          <p className="mb-3 text-center text-xs font-black uppercase tracking-[0.18em] text-slate-600">Choose Mode</p>
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
                  className={`relative rounded-[14px] border-2 border-slate-900 p-4 text-left shadow-[0_2px_0_#0F1B2D] transition-all ${
                    active ? 'bg-orange-500 text-white' : 'bg-white text-slate-900'
                  } ${item.locked ? 'opacity-55' : ''}`}
                >
                  {item.locked && <span className="absolute right-3 top-3 text-xs">🔒</span>}
                  <div className="mb-1 text-2xl">{item.icon}</div>
                  <div className="text-sm font-black">{item.label}</div>
                  <div className={`mt-0.5 text-xs ${active ? 'text-white/85' : 'text-slate-600'}`}>{item.sub}</div>
                </button>
              )
            })}
          </div>

          <button type="button" onClick={() => onStart(mode)} className="zx-sb zx-sb-primary w-full text-base">
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
  const [searchParams] = useSearchParams()
  // Challenge Mode entry point: GradeHub passes ?difficulty=hard to surface
  // only the hardest questions for learners performing ≥ 80% in the subject.
  const difficultyFilter = (searchParams.get('difficulty') || '').toLowerCase()
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
  // null = no filter; 'active' = filter applied; 'fallback' = filter requested
  // but no matching questions, so the full quiz is running instead.
  const [difficultyState, setDifficultyState] = useState(null)
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

        // Apply ?difficulty=hard filter when present. If it would leave the
        // quiz empty, fall back to the full set so the learner is never sent
        // into a dead-end session — and surface a small notice in the header.
        let activeQuestionDocs = questionDocs
        if (difficultyFilter) {
          const matches = questionDocs.filter(
            q => (q.difficulty || '').toLowerCase() === difficultyFilter
          )
          if (matches.length > 0) {
            activeQuestionDocs = matches
            setDifficultyState('active')
          } else {
            setDifficultyState('fallback')
          }
        }

        const built = buildQuizDisplaySections(activeQuestionDocs, quizDoc.passages || [])
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
  }, [quizId, getQuizById, getQuestions, canAccessFullContent, navigate, currentUser, difficultyFilter])

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
          : isNumericType(question.type)
            // Server-authoritative re-grade — never trust the client's stored
            // `correct` flag; recompute from persisted correctAnswer + tolerance.
            ? numericMatches(answers[question.id], question.correctAnswer, question.tolerance)
            : isHotspotType(question.type)
              // Same server-authoritative principle for hotspot: re-derive
              // from persisted correctRegion + the learner's stored (x, y).
              ? hotspotMatches(answers[question.id], question.correctRegion)
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
        <SeoHelmet title="Quiz" path={`/quiz/${quizId}`} noIndex />
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
        <SeoHelmet title="Quiz" path={`/quiz/${quizId}`} noIndex />
        <div className="zx-card-shared p-8 text-center">
          <div className="mb-3 text-4xl">😕</div>
          <p className="font-bold text-red-600">{error}</p>
          <button type="button" onClick={() => navigate('/quizzes')} className="zx-sb zx-sb-primary mt-4 text-sm">
            ← Back
          </button>
        </div>
      </div>
    )
  }

  if (!started) {
    return (
      <>
        <SeoHelmet title={quiz?.title || 'Quiz'} path={`/quiz/${quizId}`} noIndex />
        {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
        <PreQuizCard quiz={quiz} canExam={canUseExamMode} onStart={handleStart} />
      </>
    )
  }

  if (submitting) {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center">
        <SeoHelmet title="Saving quiz" path={`/quiz/${quizId}`} noIndex />
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
      <div key={question.id} className="zx-card-shared space-y-4 p-4 text-slate-900 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="zx-pill-dark">Q{question.questionNumber}</span>
            {question.topic && (
              <span className="zx-pill-dark zx-pill-light">{question.topic}</span>
            )}
            {question.marks > 1 && (
              <span className="zx-pill-dark zx-pill-orange">{question.marks} marks</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFlagged(current => ({ ...current, [question.id]: !current[question.id] }))}
            className={`grid h-9 w-9 place-items-center rounded-full border-2 border-slate-900 shadow-[0_2px_0_#0F1B2D] transition-colors ${
              flagged[question.id] ? 'bg-amber-300' : 'bg-white'
            }`}
            title={flagged[question.id] ? 'Unflag' : 'Flag for review'}
          >
            🚩
          </button>
        </div>

        {/* Legacy / null / 'above' renders the image and text as two direct
            children of the `space-y-4` card root — preserving the exact DOM
            and spacing every learner saw before this field was added. The
            non-default positions wrap them in a flex container that overrides
            the parent's vertical rhythm. */}
        {(() => {
          const pos = question.imagePosition
          // Library diagram takes precedence over uploaded image when both
          // are set (which shouldn't happen — the editor enforces mutual
          // exclusivity — but the renderer is defensive in case stale data
          // arrives from Firestore).
          const imageBlock = question.imageDiagram?.libraryKey ? (
            <div className="overflow-hidden rounded-2xl border-2 border-slate-900 bg-slate-50 p-3">
              <DiagramSvg
                libraryKey={question.imageDiagram.libraryKey}
                params={question.imageDiagram.params}
                alt="Question diagram"
                className="mx-auto flex max-h-[80vh] w-full items-center justify-center"
              />
            </div>
          ) : question.imageUrl ? (
            <div className="overflow-hidden rounded-2xl border-2 border-slate-900 bg-slate-50 p-3">
              <ZoomableImage
                src={question.imageUrl}
                alt="Question illustration"
                className="mx-auto max-h-[80vh] w-full rounded-xl object-contain"
              />
            </div>
          ) : null
          const textBlock = (
            <div>
              {question.sharedInstruction && (
                <div className="mb-3 rounded-2xl border-2 border-slate-900 bg-orange-50 px-3 py-2 text-sm font-bold leading-relaxed text-slate-900">
                  <RichContent value={question.sharedInstruction} className="text-sm font-bold leading-relaxed text-slate-900" />
                </div>
              )}
              <RichContent value={question.text} className="text-[15px] font-bold leading-relaxed text-slate-900 sm:text-[17px]" />
              {question.diagramText && (
                <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold leading-relaxed text-slate-700">{question.diagramText}</p>
              )}
            </div>
          )
          if (!pos || pos === 'above' || pos === 'inline') {
            return (
              <>
                {imageBlock}
                {textBlock}
              </>
            )
          }
          return (
            <div className={imagePositionClasses(pos)}>
              {imageBlock}
              {textBlock}
            </div>
          )
        })()}

        {isHotspotType(question.type) ? (() => {
          // Hotspot branch — learner clicks on the image, we record the
          // normalised (x, y) into answers, then "Check" runs hotspotMatches
          // locally for immediate feedback. The submit pipeline re-grades
          // server-authoritatively from the persisted correctRegion.
          const hotspotResult = aiResults[question.id]
          const hotspotChecked = !!hotspotResult
          const tap = answers[question.id]
          const hasTap = tap && Number.isFinite(tap.x) && Number.isFinite(tap.y)
          function checkHotspot(qid) {
            const q = questions.find(qq => qq.id === qid)
            const t = answers[qid]
            if (!q || !t || !Number.isFinite(t.x)) return
            const correct = hotspotMatches(t, q.correctRegion)
            setAiResults(current => ({
              ...current,
              [qid]: {
                correct,
                feedback: correct
                  ? '✓ Spot on.'
                  : 'Not quite — try a different spot next time.',
              },
            }))
            if (mode === 'practice') {
              setRevealed(current => ({ ...current, [qid]: true }))
              setFeedbackType(correct ? 'correct' : 'wrong')
              setTimeout(() => setFeedbackType(null), 1300)
            }
          }
          return (
          <div className="space-y-3">
            <div className={`overflow-hidden rounded-2xl border-2 bg-white shadow-[0_2px_0_#0F1B2D] ${hotspotChecked && mode === 'practice'
              ? hotspotResult.correct ? 'border-emerald-600' : 'border-orange-500'
              : 'border-slate-900'}`}>
              <div className="border-b-2 border-slate-900 bg-orange-50 px-4 py-2 text-sm font-bold text-slate-900">👆 Tap the correct spot</div>
              <div className="p-3">
                {question.imageUrl ? (
                  <div
                    className={`relative w-full overflow-hidden rounded-xl border-2 border-slate-200 ${hotspotChecked ? 'cursor-default' : 'cursor-crosshair'}`}
                    onPointerDown={event => {
                      if (hotspotChecked) return
                      const rect = event.currentTarget.getBoundingClientRect()
                      if (rect.width <= 0 || rect.height <= 0) return
                      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
                      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
                      setAnswers(current => ({ ...current, [question.id]: { x, y } }))
                      if (actionError) setActionError('')
                    }}
                  >
                    <img
                      src={question.imageUrl}
                      alt="Click the answer"
                      draggable={false}
                      className="block w-full select-none object-contain"
                    />
                    {hasTap && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-orange-500 shadow"
                        style={{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }}
                      />
                    )}
                    {/* In practice mode, reveal the correct region after
                        the learner has checked their answer. */}
                    {hotspotChecked && mode === 'practice' && question.correctRegion && Number.isFinite(question.correctRegion.x) && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute rounded-full border-2 border-emerald-500 bg-emerald-500/20"
                        style={{
                          left: `${(question.correctRegion.x - question.correctRegion.radius) * 100}%`,
                          top: `${(question.correctRegion.y - question.correctRegion.radius) * 100}%`,
                          width: `${question.correctRegion.radius * 2 * 100}%`,
                          paddingTop: `${question.correctRegion.radius * 2 * 100}%`,
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-sm font-bold text-orange-600">This hotspot question is missing its image.</p>
                )}
              </div>
            </div>

            {!hotspotChecked && (
              <button
                type="button"
                onClick={() => checkHotspot(question.id)}
                disabled={!hasTap}
                className="zx-sb zx-sb-primary w-full text-sm"
              >
                {mode === 'exam' ? 'Save answer' : 'Check my answer'}
              </button>
            )}

            {hotspotChecked && mode === 'practice' && (
              <div className={`rounded-2xl border-2 p-4 ${hotspotResult.correct ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
                <p className={`text-sm font-bold ${hotspotResult.correct ? 'text-green-900' : 'text-orange-900'}`}>
                  {hotspotResult.correct ? '✅ Correct!' : '❌ Not quite.'}
                </p>
                <p className={`mt-1 text-sm ${hotspotResult.correct ? 'text-green-700' : 'text-orange-700'}`}>{hotspotResult.feedback}</p>
              </div>
            )}
          </div>
          )
        })() : isNumericType(question.type) ? (() => {
          // Numeric branch — local, synchronous check via numericMatches.
          // No AI call, no network round-trip. The submit pipeline re-grades
          // authoritatively from `correctAnswer + tolerance` on the
          // server-side _doSubmit path (for daily exams) or via the same
          // numericMatches helper here in handleSubmit (for practice quizzes).
          const numericResult = aiResults[question.id]
          const numericChecked = !!numericResult
          function checkNumeric(qid) {
            const q = questions.find(qq => qq.id === qid)
            if (!q) return
            const raw = shortText[qid] ?? ''
            if (raw.trim() === '') return
            const parsed = Number(raw)
            if (!Number.isFinite(parsed)) {
              setActionError('Please type a valid number.')
              return
            }
            const correct = numericMatches(parsed, q.correctAnswer, q.tolerance)
            setAiResults(current => ({
              ...current,
              [qid]: {
                correct,
                feedback: correct
                  ? '✓ That matches the correct answer.'
                  : `The accepted range is ${q.correctAnswer}${(q.tolerance ?? 0) > 0 ? ` ± ${q.tolerance}` : ''}.`,
              },
            }))
            setAnswers(current => ({ ...current, [qid]: { value: parsed, correct } }))
            if (mode === 'practice') {
              setRevealed(current => ({ ...current, [qid]: true }))
              setFeedbackType(correct ? 'correct' : 'wrong')
              setTimeout(() => setFeedbackType(null), 1300)
            }
          }
          return (
          <div className="space-y-3">
            <div className={`overflow-hidden rounded-2xl border-2 bg-white shadow-[0_2px_0_#0F1B2D] ${numericChecked && mode === 'practice'
              ? numericResult.correct ? 'border-emerald-600' : 'border-orange-500'
              : 'border-slate-900'}`}>
              <div className="border-b-2 border-slate-900 bg-orange-50 px-4 py-2 text-sm font-bold text-slate-900">🔢 Numeric answer</div>
              <div className="flex items-center gap-2 p-3">
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={typed}
                  onChange={event => {
                    setShortText(current => ({ ...current, [question.id]: event.target.value }))
                    if (actionError) setActionError('')
                    if (numericChecked) {
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
                    if (event.key === 'Enter' && typed.trim() && !numericChecked) checkNumeric(question.id)
                  }}
                  placeholder="Type a number…"
                  className="flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                />
                {numericChecked && mode === 'practice' && <span className="text-xl">{numericResult.correct ? '✅' : '❌'}</span>}
              </div>
            </div>

            {!numericChecked && (
              <button
                type="button"
                onClick={() => checkNumeric(question.id)}
                disabled={!typed.trim()}
                className="zx-sb zx-sb-primary w-full text-sm"
              >
                {mode === 'exam' ? 'Save answer' : 'Check my answer'}
              </button>
            )}

            {numericChecked && mode === 'practice' && (
              <div className={`rounded-2xl border-2 p-4 ${numericResult.correct ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
                <p className={`text-sm font-bold ${numericResult.correct ? 'text-green-900' : 'text-orange-900'}`}>
                  {numericResult.correct ? '✅ Correct!' : '❌ Not quite.'}
                </p>
                <p className={`mt-1 text-sm ${numericResult.correct ? 'text-green-700' : 'text-orange-700'}`}>{numericResult.feedback}</p>
              </div>
            )}
          </div>
          )
        })() : isTextAnswerType(question.type) ? (
          <div className="space-y-3">
            <div className={`overflow-hidden rounded-2xl border-2 bg-white shadow-[0_2px_0_#0F1B2D] ${checked && mode === 'practice'
              ? aiResult.correct ? 'border-emerald-600' : 'border-orange-500'
              : 'border-slate-900'}`}>
              <div className="border-b-2 border-slate-900 bg-orange-50 px-4 py-2 text-sm font-bold text-slate-900">🤖 AI-checked answer</div>
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
                  className="flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                />
                {checking && <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />}
                {checked && mode === 'practice' && <span className="text-xl">{aiResult.correct ? '✅' : '❌'}</span>}
              </div>
            </div>

            {!checked && (
              <button
                type="button"
                onClick={() => checkShortAnswer(question.id)}
                disabled={!typed.trim() || checking}
                className="zx-sb zx-sb-primary w-full text-sm"
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
            <div className="opt-grid">
              {question.options.map((option, optionIndex) => {
                const media = Array.isArray(question.optionMedia) ? question.optionMedia[optionIndex] : null
                return (
                  <OptionButton
                    key={`${question.id}-${optionIndex}`}
                    label={['A', 'B', 'C', 'D'][optionIndex]}
                    selected={!isRevealed && userAnswer === optionIndex}
                    revealed={isRevealed}
                    correct={isRevealed && optionIndex === question.correctAnswer}
                    wrong={isRevealed && userAnswer === optionIndex && userAnswer !== question.correctAnswer}
                    onClick={() => !isRevealed && pick(question.id, optionIndex)}
                    imageUrl={media?.imageUrl}
                    imageAlt={media?.alt}
                    diagram={media?.diagram}
                  >
                    {option}
                  </OptionButton>
                )
              })}
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

  const mascot = getQuizSubjectMascot(quiz?.subject)
  const themeClass = mascot.slug ? `quiz-theme-${mascot.slug}` : ''

  return (
    <div className={`${themeClass} theme-bg theme-text min-h-screen`}>
      <SeoHelmet title={quiz?.title || 'Quiz'} path={`/quiz/${quizId}`} noIndex />
      {actionError && (
        <div className="fixed inset-x-4 top-4 z-[60] mx-auto max-w-md animate-slide-up">
          <div className="zx-card-shared flex items-start gap-3 bg-amber-50 px-4 py-3 text-slate-900">
            <span className="mt-0.5 text-lg">⚠️</span>
            <p className="flex-1 text-sm font-bold leading-snug">{actionError}</p>
            <button type="button" onClick={() => setActionError('')} className="min-h-0 bg-transparent p-0 text-lg text-slate-700 shadow-none">×</button>
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
          <div className="zx-card-shared w-full max-w-sm p-6 text-center">
            <div className="mb-3 text-5xl">📤</div>
            <h2 className="mb-2 text-xl font-black text-slate-900">Submit Quiz?</h2>
            {questions.length - answered > 0 ? (
              <p className="mb-5 text-sm font-semibold text-slate-600">You have <span className="font-black text-orange-600">{questions.length - answered} unanswered</span> — they&apos;ll be marked incorrect.</p>
            ) : (
              <p className="mb-5 text-sm font-semibold text-slate-600">All {questions.length} questions answered. Ready!</p>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowSubmit(false)} className="zx-sb zx-sb-secondary flex-1">← Keep Going</button>
              <button type="button" onClick={() => handleSubmit(false)} className="zx-sb zx-sb-primary flex-1">Submit ✓</button>
            </div>
          </div>
        </div>
      )}

      <div className="zx-hero-strip sticky top-0 z-30">
        <div className="mx-auto max-w-5xl px-3 py-3 sm:px-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span aria-hidden="true" className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] border-2 border-slate-900 bg-orange-100 text-xl">
              {mascot.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <span className="zx-eyebrow-shared">{mascot.name}</span>
              <p className="truncate text-[11px] font-semibold text-slate-600">{quiz.subject} · Grade {quiz.grade}</p>
              <p className="truncate text-sm font-black leading-tight text-slate-900">{quiz.title}</p>
            </div>
            <div className="flex items-center gap-2">
              {difficultyState === 'active' && (
                <span className="zx-pill-dark zx-pill-orange">🔥 Hard only</span>
              )}
              {difficultyState === 'fallback' && (
                <span className="zx-pill-dark zx-pill-light" title="No hard questions in this quiz — running the full quiz instead.">🔥 Full quiz</span>
              )}
              {mode === 'exam' && <div className={`zx-timer ${warn ? 'zx-timer-warn' : ''}`}>⏱️ {fmt(timeLeft)}</div>}
              {mode === 'practice' && <span className="zx-pill-dark zx-pill-green">🌱 Practice</span>}
            </div>
          </div>
          <div className="h-3 overflow-hidden rounded-full border-2 border-slate-900 bg-white">
            <div className="h-full rounded-full bg-orange-500 transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] font-bold text-slate-600">
            <span>{answered} answered</span>
            <span>{questions.length - answered} left</span>
          </div>
        </div>
      </div>

      <div className="mx-auto flex min-h-[calc(100vh-10rem)] w-full max-w-5xl flex-1 flex-col px-3 py-4 pb-44 sm:px-4">
        {activeSection.kind === 'passage' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
              <div className="zx-card-shared overflow-hidden">
                <div className="border-b-2 border-slate-900 bg-orange-50 px-4 py-4 sm:px-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="zx-pill-dark zx-pill-orange">
                      {activeSection.passage.passageKind === 'map' ? 'Map Questions' : 'Comprehension Passage'}
                    </span>
                    <span className="zx-pill-dark zx-pill-light">{activeSection.questions.length} question{activeSection.questions.length === 1 ? '' : 's'}</span>
                  </div>
                  {activeSection.passage.title && <h2 className="text-base font-black text-slate-900 sm:text-lg">{activeSection.passage.title}</h2>}
                  {activeSection.passage.instructions && (
                    <RichContent value={activeSection.passage.instructions} className="mt-2 text-sm font-bold text-slate-700" />
                  )}
                </div>
                {activeSection.passage.imageUrl && (
                  <div className="border-b-2 border-slate-900 bg-slate-50 p-3 sm:p-4">
                    <ZoomableImage
                      src={activeSection.passage.imageUrl}
                      alt="Passage illustration"
                      className="mx-auto max-h-[80vh] w-full rounded-2xl object-contain"
                    />
                  </div>
                )}
                <div className="p-4 sm:p-5">
                  <RichContent value={activeSection.passage.passageText} className="text-sm leading-7 text-slate-900" />
                </div>
              </div>
            </div>
            <div className="min-w-0 space-y-4">
              {activeSection.questions.map(renderQuestion)}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl">
            {renderQuestion(activeSection.question)}
          </div>
        )}
      </div>

      <div className="zx-glass-bottom fixed bottom-0 left-0 right-0 z-30 safe-area-bottom">
        <div className="mx-auto max-w-3xl px-3 py-3 sm:px-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="zx-pill-dark zx-pill-light">Section {activeSectionIndex + 1} / {sections.length}</span>
            <span className="text-xs font-bold text-slate-700">{answered}/{questions.length} answered</span>
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
                    className="min-h-0 flex-1 rounded-full border-2 border-slate-900 transition-all"
                    style={{
                      height: 10,
                      background: current ? '#FF7A1A' : flaggedSection ? '#FBBF24' : complete ? '#10B981' : '#fff',
                      boxShadow: current ? '0 2px 0 #0F1B2D' : 'none',
                    }}
                  />
                )
              })}
            </div>
          ) : (
            <div className="mb-3 h-3 overflow-hidden rounded-full border-2 border-slate-900 bg-white">
              <div className="h-full rounded-full bg-orange-500 transition-all duration-300" style={{ width: `${sections.length ? Math.round(((activeSectionIndex + 1) / sections.length) * 100) : 0}%` }} />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <button type="button" onClick={() => setActiveSectionIndex(index => Math.max(0, index - 1))} disabled={activeSectionIndex === 0} className="zx-sb zx-sb-secondary flex-1 px-3 text-sm sm:flex-none sm:px-4">
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
                className="zx-sb zx-sb-primary flex-1 px-3 text-sm sm:flex-none sm:px-4"
              >
                Next →
              </button>
            ) : (
              <button type="button" onClick={() => setShowSubmit(true)} className="zx-sb zx-sb-amber flex-1 px-3 text-sm sm:flex-none sm:px-4">
                Submit 🏁
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
