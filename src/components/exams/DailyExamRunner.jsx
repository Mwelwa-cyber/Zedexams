/**
 * DailyExamRunner — /exam/:examId
 *
 * Exam-only runner (no practice mode toggle).
 *
 * Flow on mount:
 *   1. Load quiz + questions from Firestore
 *   2. Check daily lock:
 *        submitted  → show "Already Completed" screen
 *        in_progress → restoreExam() (endTime from Firestore, tamper-proof)
 *        no lock    → startExam() (creates attempt + lock, writes endTime)
 *   3. Start countdown timer derived from endTime (never from seconds remaining)
 *   4. Auto-save answers + section index to localStorage on every change
 *   5. Auto-submit when timer reaches zero
 *   6. Manual submit → calculate score → navigate to /exam-results/:attemptId
 *
 * Anti-cheat guarantees:
 *   - endTime is written once to Firestore and never modified
 *   - On restore, endTime is read from Firestore (not localStorage)
 *   - Daily lock blocks any second attempt even if localStorage is cleared
 *   - beforeunload warns the user before navigating away
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  getExamWithQuestions,
  checkDailyLock,
  startExam,
  restoreExam,
  saveProgress,
  submitExam,
  autoSubmitExam,
} from '../../utils/examService'
import RichContent from '../../editor/RichContent'

// ── Tiny utilities ─────────────────────────────────────────────────────────────

function fmt(seconds) {
  const m = Math.floor(seconds / 60)
  const s = String(seconds % 60).padStart(2, '0')
  return `${m}:${s}`
}

function isTextType(type) {
  return type === 'short_answer' || type === 'diagram'
}

// ── Option button (MCQ) ────────────────────────────────────────────────────────

function OptionButton({ label, selected, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-all ${
        selected
          ? 'border-[var(--accent)] theme-accent-bg theme-accent-text'
          : 'theme-card theme-border theme-text hover:border-[var(--accent)] hover:theme-bg-subtle'
      }`}
    >
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-black ${
        selected ? 'theme-accent-fill theme-on-accent' : 'theme-bg-subtle theme-text-muted'
      }`}>
        {label}
      </span>
      <span className="flex-1 text-sm font-semibold leading-snug">{children}</span>
    </button>
  )
}

// ── Already-completed screen ───────────────────────────────────────────────────

function AlreadyDoneScreen({ attemptId, timeExpired }) {
  return (
    <div className="theme-bg flex min-h-screen items-center justify-center px-4">
      <div className="theme-card theme-border w-full max-w-sm rounded-3xl border p-8 text-center shadow-xl">
        <div className="mb-3 text-5xl">{timeExpired ? '⏰' : '✅'}</div>
        <h2 className="mb-2 text-xl font-black theme-text">
          {timeExpired ? 'Time Expired' : 'Exam Submitted'}
        </h2>
        <p className="theme-text-muted mb-6 text-sm">
          {timeExpired
            ? 'Your time ran out and the exam was auto-submitted.'
            : 'You have already completed today\'s exam for this subject.'}
        </p>
        <div className="flex flex-col gap-3">
          {attemptId && (
            <Link
              to={`/exam-results/${attemptId}`}
              className="theme-accent-fill theme-on-accent w-full rounded-2xl py-3 text-sm font-black text-center hover:opacity-90 transition-opacity"
            >
              📊 View Results & Leaderboard
            </Link>
          )}
          <Link
            to="/exams"
            className="theme-border theme-text-muted w-full rounded-2xl border-2 py-3 text-sm font-black text-center hover:theme-bg-subtle transition-colors"
          >
            ← All Daily Exams
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DailyExamRunner() {
  const { examId } = useParams()
  const navigate   = useNavigate()
  const { currentUser, userProfile } = useAuth()

  // Core data
  const [quiz, setQuiz]           = useState(null)
  const [sections, setSections]   = useState([])
  const [questions, setQuestions] = useState([])

  // UI state
  const [status, setStatus]     = useState('loading') // loading | ready | submitted | error
  const [error, setError]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [actionError, setActionError] = useState('')

  // Exam session
  const [attemptId, setAttemptId]               = useState(null)
  const [alreadyDone, setAlreadyDone]           = useState(false)
  const [timeExpiredDone, setTimeExpiredDone]   = useState(false)
  const [answers, setAnswers]                   = useState({})
  const [flagged, setFlagged]                   = useState({})
  const [shortText, setShortText]               = useState({})
  const [activeSectionIndex, setActiveSectionIndex] = useState(0)

  // Timer
  const [endTime, setEndTime]   = useState(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const timerRef  = useRef(null)
  const autoRef   = useRef(false)
  const submitRef = useRef(null)

  // ── Load exam + initialise session ────────────────────────────────────────

  useEffect(() => {
    if (!currentUser || !examId) return
    let cancelled = false

    async function init() {
      try {
        // 1. Fetch quiz + questions
        const data = await getExamWithQuestions(examId)
        if (!data) { setError('Exam not found.'); setStatus('error'); return }

        if (cancelled) return
        setQuiz(data.quiz)
        setSections(data.sections)
        setQuestions(data.questions)

        // 2. Check lock
        const lock = await checkDailyLock(currentUser.uid, data.quiz.subject)

        if (lock?.status === 'submitted') {
          setAlreadyDone(true)
          setAttemptId(lock.attemptId)
          setStatus('ready')
          return
        }

        // 3. Start or restore
        const displayName = userProfile?.displayName || currentUser.displayName || 'Student'
        const session = lock?.status === 'in_progress'
          ? await restoreExam(currentUser.uid, lock.attemptId)
          : await startExam(currentUser.uid, displayName, data.quiz)

        if (cancelled) return

        if (session.alreadySubmitted) {
          setAlreadyDone(true)
          setTimeExpiredDone(!!session.timeExpired)
          setAttemptId(session.attemptId)
          setStatus('ready')
          return
        }

        setAttemptId(session.attemptId)
        setAnswers(session.answers || {})
        setFlagged(session.flagged || {})
        setActiveSectionIndex(
          Math.min(session.currentSectionIndex || 0, data.sections.length - 1),
        )
        setEndTime(session.endTime)
        setStatus('ready')
      } catch (e) {
        console.error('DailyExamRunner init:', e)
        if (!cancelled) { setError(e.message || 'Failed to load exam.'); setStatus('error') }
      }
    }

    init()
    return () => {
      cancelled = true
      clearInterval(timerRef.current)
    }
  }, [currentUser, examId, userProfile])

  // ── Timer — driven by endTime, not decremented seconds ────────────────────

  useEffect(() => {
    if (status !== 'ready' || alreadyDone || !endTime) return

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

    tick()
    timerRef.current = setInterval(tick, 500)
    return () => clearInterval(timerRef.current)
  }, [status, alreadyDone, endTime])

  // ── Auto-save on state changes ─────────────────────────────────────────────

  useEffect(() => {
    if (status !== 'ready' || alreadyDone || !attemptId || !currentUser) return
    saveProgress(currentUser.uid, examId, {
      answers,
      flagged,
      currentSectionIndex: activeSectionIndex,
    })
  }, [answers, flagged, activeSectionIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── beforeunload warning ───────────────────────────────────────────────────

  useEffect(() => {
    if (status !== 'ready' || alreadyDone) return
    const handler = e => {
      e.preventDefault()
      e.returnValue = 'Your exam is in progress — the timer will keep running.'
      return e.returnValue
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [status, alreadyDone])

  // ── Submit handler ─────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (auto = false) => {
    if (!auto) setShowConfirm(false)
    if (submitting) return
    setSubmitting(true)
    clearInterval(timerRef.current)

    try {
      const result = await submitExam(currentUser.uid, attemptId, questions, answers)
      if (result.alreadySubmitted) {
        navigate(`/exam-results/${attemptId}`, { replace: true })
        return
      }
      navigate(`/exam-results/${result.attemptId}`, { replace: true })
    } catch (e) {
      console.error('submitExam:', e)
      setActionError('Failed to submit. Please check your connection and try again.')
      setSubmitting(false)
    }
  }, [currentUser, attemptId, questions, answers, navigate, submitting])

  submitRef.current = handleSubmit

  // ── Render helpers ─────────────────────────────────────────────────────────

  function pickAnswer(questionId, value) {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  function sectionAnswered(section) {
    const qs = section.kind === 'passage' ? section.questions : [section.question]
    return qs.every(q => answers[q.id] !== undefined)
  }

  function tryNext() {
    if (!sectionAnswered(sections[activeSectionIndex])) {
      setActionError('Please answer this question before moving to the next one.')
      return
    }
    setActiveSectionIndex(i => i + 1)
  }

  function renderQuestion(question) {
    const userAnswer = answers[question.id]
    const typed = shortText[question.id] ?? ''

    return (
      <div key={question.id} className="theme-card theme-border theme-text space-y-4 rounded-[24px] border p-5 shadow-sm">
        {/* Question header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="theme-accent-bg theme-accent-text rounded-full px-3 py-1 text-xs font-black">
              Q{question.questionNumber}
            </span>
            {question.topic && (
              <span className="theme-bg-subtle theme-text-muted rounded-full px-2.5 py-1 text-xs font-bold">
                {question.topic}
              </span>
            )}
            {question.marks > 1 && (
              <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-700">
                {question.marks} marks
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFlagged(prev => ({ ...prev, [question.id]: !prev[question.id] }))}
            className={`rounded-full p-2 transition-colors ${
              flagged[question.id] ? 'bg-amber-100 text-amber-700' : 'theme-bg-subtle theme-text-muted'
            }`}
            title={flagged[question.id] ? 'Unflag' : 'Flag for review'}
          >
            🚩
          </button>
        </div>

        {/* Question image */}
        {question.imageUrl && (
          <div className="theme-border theme-bg-subtle overflow-hidden rounded-2xl border p-3">
            <img
              src={question.imageUrl}
              alt="Question"
              className="max-h-72 w-full rounded-xl object-contain"
              loading="lazy"
            />
          </div>
        )}

        {/* Question text */}
        <div>
          {question.sharedInstruction && (
            <div className="theme-accent-bg theme-border theme-accent-text mb-3 rounded-2xl border px-3 py-2 text-sm font-bold leading-relaxed">
              <RichContent value={question.sharedInstruction} className="theme-accent-text text-sm font-bold leading-relaxed" />
            </div>
          )}
          <RichContent value={question.text} className="text-[17px] font-bold leading-relaxed" />
          {question.diagramText && (
            <p className="theme-bg-subtle theme-text-muted mt-2 rounded-xl px-3 py-2 text-xs font-bold leading-relaxed">
              {question.diagramText}
            </p>
          )}
        </div>

        {/* Answer input */}
        {isTextType(question.type) ? (
          <div className="overflow-hidden rounded-2xl border-2 theme-border">
            <div className="theme-border theme-bg-subtle theme-text-muted border-b px-4 py-2 text-sm font-bold">
              ✍️ Write your answer
            </div>
            <div className="p-3">
              <input
                type="text"
                value={typed}
                onChange={e => {
                  const val = e.target.value
                  setShortText(prev => ({ ...prev, [question.id]: val }))
                  // Store the raw text as the answer; AI-checking happens at submit
                  setAnswers(prev => ({ ...prev, [question.id]: val || undefined }))
                }}
                placeholder="Type your answer here…"
                className="theme-text w-full bg-transparent text-base font-semibold outline-none"
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {question.options?.map((option, idx) => (
              <OptionButton
                key={`${question.id}-${idx}`}
                label={['A', 'B', 'C', 'D'][idx]}
                selected={userAnswer === idx}
                onClick={() => pickAnswer(question.id, idx)}
              >
                {option}
              </OptionButton>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-3 text-5xl animate-bounce">📝</div>
          <p className="theme-accent-text text-lg font-bold">Loading exam…</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center px-4">
        <div className="theme-card theme-border w-full max-w-sm rounded-3xl border p-8 text-center shadow-xl">
          <div className="mb-3 text-4xl">😕</div>
          <p className="font-bold text-red-600 mb-4">{error}</p>
          <Link to="/exams" className="theme-accent-fill theme-on-accent rounded-2xl px-5 py-2.5 font-bold text-sm inline-block">
            ← Back to Exams
          </Link>
        </div>
      </div>
    )
  }

  if (alreadyDone) {
    return <AlreadyDoneScreen attemptId={attemptId} timeExpired={timeExpiredDone} />
  }

  if (submitting) {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-3 text-5xl animate-spin">⏳</div>
          <p className="theme-accent-text text-xl font-black">Submitting exam…</p>
        </div>
      </div>
    )
  }

  const activeSection = sections[activeSectionIndex]
  if (!activeSection) return null

  const answered = Object.keys(answers).length
  const progress = questions.length ? Math.round((answered / questions.length) * 100) : 0
  const warn = timeLeft <= 60

  return (
    <div className="theme-bg theme-text min-h-screen">

      {/* Action error toast */}
      {actionError && (
        <div className="fixed left-1/2 top-4 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 animate-slide-up">
          <div className="flex items-start gap-3 rounded-2xl border-2 border-orange-300 bg-orange-50 px-4 py-3 text-orange-900 shadow-xl">
            <span className="mt-0.5 text-lg">⚠️</span>
            <p className="flex-1 text-sm font-bold leading-snug">{actionError}</p>
            <button type="button" onClick={() => setActionError('')} className="min-h-0 bg-transparent p-0 text-lg text-orange-700 shadow-none">×</button>
          </div>
        </div>
      )}

      {/* Submit confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="theme-card theme-border w-full max-w-sm rounded-3xl border p-6 text-center shadow-2xl">
            <div className="mb-3 text-5xl">📤</div>
            <h2 className="mb-2 text-xl font-black">Submit Exam?</h2>
            {questions.length - answered > 0 ? (
              <p className="theme-text-muted mb-5 text-sm">
                You have{' '}
                <span className="font-black text-orange-500">{questions.length - answered} unanswered</span>{' '}
                — they will be marked incorrect.
              </p>
            ) : (
              <p className="theme-text-muted mb-5 text-sm">
                All {questions.length} questions answered. Ready to submit?
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="theme-border theme-text-muted flex-1 rounded-2xl border-2 py-3 font-bold"
              >
                ← Keep Going
              </button>
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                className="theme-accent-fill theme-on-accent flex-1 rounded-2xl py-3 font-black"
              >
                Submit ✓
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky header */}
      <div className="theme-hero sticky top-0 z-30 text-white shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-white/70">
                {quiz?.subject} · Grade {quiz?.grade} · Daily Exam
              </p>
              <p className="truncate text-sm font-black leading-tight">{quiz?.title}</p>
            </div>
            {/* Timer — red when ≤ 60 s */}
            <div className={`rounded-full px-3 py-1.5 text-sm font-black tabular-nums ${warn ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`}>
              ⏱️ {fmt(timeLeft)}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-2 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#22c55e,#a3e635)] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] font-bold text-white/65">
            <span>{answered} answered</span>
            <span>{questions.length - answered} left</span>
          </div>
        </div>
      </div>

      {/* Question area */}
      <div className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-5xl flex-1 flex-col px-4 py-4 pb-44">
        {activeSection.kind === 'passage' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <div className="theme-card theme-border overflow-hidden rounded-[24px] border shadow-sm">
                <div className="theme-accent-bg theme-border border-b px-5 py-4">
                  {activeSection.passage.title && (
                    <h2 className="theme-text text-lg font-black">{activeSection.passage.title}</h2>
                  )}
                  {activeSection.passage.instructions && (
                    <RichContent value={activeSection.passage.instructions} className="theme-accent-text mt-2 text-sm font-bold" />
                  )}
                </div>
                {activeSection.passage.imageUrl && (
                  <div className="theme-border theme-bg-subtle border-b p-4">
                    <img src={activeSection.passage.imageUrl} alt="Passage" className="max-h-72 w-full rounded-2xl object-contain" loading="lazy" />
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

      {/* Fixed bottom nav */}
      <div className="theme-card theme-border fixed bottom-0 left-0 right-0 z-30 border-t backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3">
          {/* Section dots */}
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="theme-text-muted text-xs font-black">
              Section <span className="theme-accent-text">{activeSectionIndex + 1}</span> of {sections.length}
            </span>
            <span className="theme-text-muted text-xs font-bold">{answered}/{questions.length} answered</span>
          </div>

          {sections.length <= 20 ? (
            <div className="mb-3 flex gap-1.5">
              {sections.map((section, idx) => {
                const current  = idx === activeSectionIndex
                const complete = sectionAnswered(section)
                const isFlagged = (section.kind === 'passage' ? section.questions : [section.question])
                  .some(q => flagged[q.id])
                return (
                  <button
                    key={section.id ?? idx}
                    type="button"
                    title={`Section ${idx + 1}${complete ? ' ✓' : ''}${isFlagged ? ' 🚩' : ''}`}
                    onClick={() => {
                      if (idx > activeSectionIndex && !sectionAnswered(sections[activeSectionIndex])) {
                        setActionError('Please answer the current question before jumping ahead.')
                        return
                      }
                      setActiveSectionIndex(idx)
                    }}
                    className="min-h-0 flex-1 rounded-full transition-all"
                    style={{
                      height: 8,
                      background: current ? 'var(--accent)' : isFlagged ? '#f59e0b' : complete ? 'var(--accent-bg)' : 'var(--border)',
                      outline: current ? '2px solid var(--accent)' : 'none',
                      outlineOffset: 1,
                    }}
                  />
                )
              })}
            </div>
          ) : (
            <div className="theme-border mb-3 h-2 overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="theme-accent-fill h-full rounded-full transition-all duration-300"
                style={{ width: `${sections.length ? Math.round(((activeSectionIndex + 1) / sections.length) * 100) : 0}%` }}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setActiveSectionIndex(i => Math.max(0, i - 1))}
              disabled={activeSectionIndex === 0}
              className="theme-border theme-text-muted rounded-2xl border-2 px-5 py-2.5 text-sm font-bold disabled:opacity-35"
            >
              ← Prev
            </button>

            {activeSectionIndex < sections.length - 1 ? (
              <button
                type="button"
                onClick={tryNext}
                className="theme-accent-fill theme-on-accent rounded-2xl px-7 py-2.5 text-sm font-black shadow-[0_4px_14px_var(--shadow)]"
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                className="rounded-2xl bg-amber-400 px-7 py-2.5 text-sm font-black text-slate-900 shadow-[0_4px_14px_rgba(245,158,11,0.35)]"
              >
                Submit 🏁
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
