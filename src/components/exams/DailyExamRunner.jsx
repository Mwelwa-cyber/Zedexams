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
} from '../../utils/examService'
import RichContent from '../../editor/RichContent'
import SeoHelmet from '../seo/SeoHelmet'
import ErrorBoundary from '../ui/ErrorBoundary'

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
      data-selected={selected ? 'true' : 'false'}
      className="zx-opt"
    >
      <span className="zx-opt-letter">{label}</span>
      <span className="flex-1 text-sm font-semibold leading-snug">{children}</span>
    </button>
  )
}

// ── Already-completed screen ───────────────────────────────────────────────────

function AlreadyDoneScreen({ attemptId, timeExpired }) {
  return (
    <div className="theme-bg flex min-h-screen items-center justify-center px-4">
      <div className="zx-card-shared w-full max-w-sm p-8 text-center">
        <div className="mb-3 text-5xl">{timeExpired ? '⏰' : '✅'}</div>
        <h2 className="mb-2 text-xl font-black text-slate-900">
          {timeExpired ? 'Time Expired' : 'Exam Submitted'}
        </h2>
        <p className="mb-6 text-sm font-semibold text-slate-600">
          {timeExpired
            ? 'Your time ran out and the exam was auto-submitted.'
            : 'You have already completed today\'s exam for this subject.'}
        </p>
        <div className="flex flex-col gap-3">
          {attemptId && (
            <Link to={`/exam-results/${attemptId}`} className="zx-sb zx-sb-primary w-full text-sm">
              📊 View Results & Leaderboard
            </Link>
          )}
          <Link to="/exams" className="zx-sb zx-sb-secondary w-full text-sm">
            ← All Daily Exams
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Friendly error card ────────────────────────────────────────────────────────
// Replaces the legacy screen that printed raw exception messages like
// "s.forEach is not a function" at learners. Whatever the underlying cause —
// a malformed Firestore field, a flaky network, a transient render throw —
// the recovery surface stays the same: try again in place, or back out to
// the exams list. The technical message is preserved for devs in DEV builds
// only, so we still get a fast diagnostic loop without scaring learners.
function ExamRecoveryCard({ examId, onRetry, technicalMessage }) {
  return (
    <div className="theme-bg flex min-h-screen items-center justify-center px-4">
      <SeoHelmet title="Exam" path={`/exam/${examId}`} noIndex />
      <div className="zx-card-shared w-full max-w-sm p-8 text-center">
        <div className="mb-3 text-4xl">😕</div>
        <h2 className="mb-2 text-xl font-black text-slate-900">We hit a snag loading this exam</h2>
        <p className="mb-6 text-sm font-semibold text-slate-600">
          This usually clears with a quick retry. Your timer and answers are
          saved on our side — nothing is lost.
        </p>
        <div className="flex flex-col gap-3">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="zx-sb zx-sb-primary w-full text-sm"
            >
              ↻ Try again
            </button>
          )}
          <Link to="/exams" className="zx-sb zx-sb-secondary w-full text-sm">
            ← Back to Exams
          </Link>
        </div>
        {import.meta.env.DEV && technicalMessage && (
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-xs font-bold text-slate-500">
              Developer details
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">
              {technicalMessage}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

function DailyExamRunnerInner() {
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
  // Bumped by the recovery card's "Try again" button so the init effect
  // re-runs from scratch without forcing a full page reload (which would
  // restart the timer fetch and re-flash the loading screen needlessly).
  const [initAttempt, setInitAttempt] = useState(0)

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
        // Coerce to plain objects/arrays at the boundary so a malformed
        // session payload (e.g. session.answers landing as null/array)
        // can't throw later via `Object.keys(answers)` or `flagged[q.id]`.
        const safeAnswers = (session.answers && typeof session.answers === 'object' && !Array.isArray(session.answers))
          ? session.answers
          : {}
        const safeFlagged = (session.flagged && typeof session.flagged === 'object')
          ? session.flagged
          : {}
        setAnswers(safeAnswers)
        setFlagged(safeFlagged)
        const safeSectionLen = Array.isArray(data.sections) ? data.sections.length : 0
        const requestedIdx = Number.isFinite(session.currentSectionIndex) ? session.currentSectionIndex : 0
        setActiveSectionIndex(
          safeSectionLen > 0 ? Math.min(requestedIdx, safeSectionLen - 1) : 0,
        )
        setEndTime(session.endTime)
        setStatus('ready')
      } catch (e) {
        // Whatever the underlying cause, learners see ExamRecoveryCard's
        // friendly text + Retry button. The raw `e.message` is kept in
        // local state so the DEV-only details panel can still surface it
        // for diagnostics; production builds never render it.
        console.error('DailyExamRunner init:', e)
        if (!cancelled) {
          setError(e?.message ? `${e.message}` : 'Failed to load exam.')
          setStatus('error')
        }
      }
    }

    init()
    return () => {
      cancelled = true
      clearInterval(timerRef.current)
    }
  }, [currentUser, examId, userProfile, initAttempt])

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
      <div key={question.id} className="zx-card-shared space-y-4 p-5 text-slate-900">
        {/* Question header */}
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
            onClick={() => setFlagged(prev => ({ ...prev, [question.id]: !prev[question.id] }))}
            className={`grid h-9 w-9 place-items-center rounded-full border-2 border-slate-900 shadow-[0_2px_0_#0F1B2D] transition-colors ${
              flagged[question.id] ? 'bg-amber-300' : 'bg-white'
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
            <div className="mb-3 rounded-2xl border-2 border-slate-900 bg-orange-50 px-3 py-2 text-sm font-bold leading-relaxed text-slate-900">
              <RichContent value={question.sharedInstruction} className="text-sm font-bold leading-relaxed text-slate-900" />
            </div>
          )}
          <RichContent value={question.text} className="text-[17px] font-bold leading-relaxed text-slate-900" />
          {question.diagramText && (
            <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold leading-relaxed text-slate-700">
              {question.diagramText}
            </p>
          )}
        </div>

        {/* Answer input */}
        {isTextType(question.type) ? (
          <div className="overflow-hidden rounded-2xl border-2 border-slate-900 bg-white shadow-[0_2px_0_#0F1B2D]">
            <div className="border-b-2 border-slate-900 bg-orange-50 px-4 py-2 text-sm font-bold text-slate-900">
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
                className="w-full bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:text-slate-400"
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
        <SeoHelmet title="Exam" path={`/exam/${examId}`} noIndex />
        <div className="text-center">
          <div className="mb-3 text-5xl animate-bounce">📝</div>
          <p className="theme-accent-text text-lg font-bold">Loading exam…</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <ExamRecoveryCard
        examId={examId}
        onRetry={() => {
          setError('')
          setStatus('loading')
          setInitAttempt(n => n + 1)
        }}
        technicalMessage={error}
      />
    )
  }

  if (alreadyDone) {
    return (
      <>
        <SeoHelmet title="Exam already submitted" path={`/exam/${examId}`} noIndex />
        <AlreadyDoneScreen attemptId={attemptId} timeExpired={timeExpiredDone} />
      </>
    )
  }

  if (submitting) {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center">
        <SeoHelmet title="Submitting exam" path={`/exam/${examId}`} noIndex />
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
      <SeoHelmet title={quiz?.title || 'Exam'} path={`/exam/${examId}`} noIndex />

      {/* Action error toast */}
      {actionError && (
        <div className="fixed inset-x-4 top-4 z-[60] mx-auto max-w-md animate-slide-up">
          <div className="zx-card-shared flex items-start gap-3 bg-amber-50 px-4 py-3 text-slate-900">
            <span className="mt-0.5 text-lg">⚠️</span>
            <p className="flex-1 text-sm font-bold leading-snug">{actionError}</p>
            <button type="button" onClick={() => setActionError('')} className="min-h-0 bg-transparent p-0 text-lg text-slate-700 shadow-none">×</button>
          </div>
        </div>
      )}

      {/* Submit confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="zx-card-shared w-full max-w-sm p-6 text-center">
            <div className="mb-3 text-5xl">📤</div>
            <h2 className="mb-2 text-xl font-black text-slate-900">Submit Exam?</h2>
            {questions.length - answered > 0 ? (
              <p className="mb-5 text-sm font-semibold text-slate-600">
                You have{' '}
                <span className="font-black text-orange-600">{questions.length - answered} unanswered</span>{' '}
                — they will be marked incorrect.
              </p>
            ) : (
              <p className="mb-5 text-sm font-semibold text-slate-600">
                All {questions.length} questions answered. Ready to submit?
              </p>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowConfirm(false)} className="zx-sb zx-sb-secondary flex-1">
                ← Keep Going
              </button>
              <button type="button" onClick={() => handleSubmit(false)} className="zx-sb zx-sb-primary flex-1">
                Submit ✓
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky header — game-themed white strip with navy border */}
      <div className="zx-hero-strip sticky top-0 z-30">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="zx-eyebrow-shared">
                {quiz?.subject} · Grade {quiz?.grade} · Daily Exam
              </span>
              <p className="truncate text-sm font-black leading-tight text-slate-900">{quiz?.title}</p>
            </div>
            {/* Timer — red when ≤ 60 s */}
            <div className={`zx-timer ${warn ? 'zx-timer-warn' : ''}`}>
              ⏱️ {fmt(timeLeft)}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-3 overflow-hidden rounded-full border-2 border-slate-900 bg-white">
            <div
              className="h-full rounded-full bg-orange-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] font-bold text-slate-600">
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
              <div className="zx-card-shared overflow-hidden">
                <div className="border-b-2 border-slate-900 bg-orange-50 px-5 py-4">
                  {activeSection.passage.title && (
                    <h2 className="text-lg font-black text-slate-900">{activeSection.passage.title}</h2>
                  )}
                  {activeSection.passage.instructions && (
                    <RichContent value={activeSection.passage.instructions} className="mt-2 text-sm font-bold text-slate-700" />
                  )}
                </div>
                {activeSection.passage.imageUrl && (
                  <div className="border-b-2 border-slate-900 bg-slate-50 p-4">
                    <img src={activeSection.passage.imageUrl} alt="Passage" className="max-h-72 w-full rounded-2xl object-contain" loading="lazy" />
                  </div>
                )}
                <div className="p-5">
                  <RichContent value={activeSection.passage.passageText} className="text-sm leading-7 text-slate-900" />
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

      {/* Fixed bottom action bar — glass strip */}
      <div className="zx-glass-bottom fixed bottom-0 left-0 right-0 z-30 safe-area-bottom">
        <div className="mx-auto max-w-5xl px-4 py-3">
          {/* Section dots */}
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="zx-pill-dark zx-pill-light">
              Section {activeSectionIndex + 1} / {sections.length}
            </span>
            <span className="text-xs font-bold text-slate-700">{answered}/{questions.length} answered</span>
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
                    className="min-h-0 flex-1 rounded-full border-2 border-slate-900 transition-all"
                    style={{
                      height: 10,
                      background: current ? '#FF7A1A' : isFlagged ? '#FBBF24' : complete ? '#10B981' : '#fff',
                      boxShadow: current ? '0 2px 0 #0F1B2D' : 'none',
                    }}
                  />
                )
              })}
            </div>
          ) : (
            <div className="mb-3 h-3 overflow-hidden rounded-full border-2 border-slate-900 bg-white">
              <div
                className="h-full rounded-full bg-orange-500 transition-all duration-300"
                style={{ width: `${sections.length ? Math.round(((activeSectionIndex + 1) / sections.length) * 100) : 0}%` }}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setActiveSectionIndex(i => Math.max(0, i - 1))}
              disabled={activeSectionIndex === 0}
              className="zx-sb zx-sb-secondary text-sm"
            >
              ← Prev
            </button>

            {activeSectionIndex < sections.length - 1 ? (
              <button type="button" onClick={tryNext} className="zx-sb zx-sb-primary text-sm">
                Next →
              </button>
            ) : (
              <button type="button" onClick={() => setShowConfirm(true)} className="zx-sb zx-sb-amber text-sm">
                Submit 🏁
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Outer wrapper exists for one reason: render-time exceptions inside the
// runner (e.g. a question with an unexpected shape that slips past the
// data-layer coercions) used to escape to the global ErrorBoundary, which
// shows a generic full-page "Something went wrong" card with no exam-aware
// recovery. The local ErrorBoundary here keeps the recovery surface
// consistent with the async-init failure mode: a friendly retry / back-out
// card. Pair this with the data-shape coercions in examService +
// quizSections so the path from "bad Firestore doc" to "blank page
// mid-exam" stays closed end-to-end.
export default function DailyExamRunner() {
  const { examId } = useParams()
  return (
    <ErrorBoundary
      inline
      resetKey={examId}
      fallback={({ retry, error }) => (
        <ExamRecoveryCard
          examId={examId}
          onRetry={retry}
          technicalMessage={error?.message}
        />
      )}
    >
      <DailyExamRunnerInner />
    </ErrorBoundary>
  )
}
