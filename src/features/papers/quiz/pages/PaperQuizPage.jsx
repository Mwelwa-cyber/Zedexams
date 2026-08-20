/**
 * /papers/:paperId/quiz — the past-paper quiz.
 *
 * Three screens behind one route: cover → runner → results. One route rather
 * than three, deliberately, and the reason is §1's "only one thing ends an
 * exam early": a route change is a back button away from ending an attempt,
 * and the browser back button is exactly the accident this design refuses to
 * punish. The screens are state, the attempt is the server's, and the URL does
 * not carry either.
 *
 * ── What replaced what ───────────────────────────────────────────────────
 *
 * This supersedes `PublicQuizRunner`, which was a single always-instant-
 * feedback runner with a free-set boundary and no exam mode. Two of that
 * file's properties are carried over intact and one is deliberately not:
 *
 *   • KEPT — nothing renders at the free-set boundary. Completing the last
 *     free question goes to the results screen, where the score, the wrong
 *     answers and the weakest topic are free on every plan. No modal, no
 *     wall, no route to a paywall.
 *   • KEPT — `useActivity('quiz_active')` for the whole run, so no gate can
 *     interrupt a learner mid-paper.
 *   • RETIRED — the zero-Firestore-write property, and with it that route's
 *     role as the Assessment Engine's Phase-3 canary. Exam mode needs a
 *     server-anchored attempt; a clock and a score the client owns are not an
 *     exam. `test:paper-quiz-zero-write` now pins the PRACTICE path instead,
 *     which is still the anonymous, crawled, write-free one.
 *
 * Anonymous visitors get practice, exactly as before — the cover offers exam
 * mode only to a signed-in learner who holds the whole paper, and says so
 * rather than hiding it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '../../../../contexts/AuthContext'
import { hasPremiumAccess } from '../../../../engines/payment-engine/subscriptionConfig'
import { getPaperById } from '../../../../utils/pastPaperLookup'
import { LEARNER_QUIZ_PENDING_TEXT, paperQuizIsAttached } from '../../../../utils/pastPaperQuizStatus'
import { QUIZ_LOAD, QUIZ_LOAD_TEXT, loadPublicQuiz } from '../../../../utils/pastPaperQuiz'
import { resolveFreeSet } from '../../../../services/entitlements/freeSet'
import { useActivity } from '../../../../services/entitlements/activity'
import { validateQuizSubjectIntegrity } from '../../../../utils/quizSubjectIntegrity'
import { reportClientError } from '../../../../utils/clientErrorReporting'
import { capture } from '../../../../utils/analytics'
import { PAPER_SUBJECTS } from '../../../../config/curriculum'
import SeoHelmet from '../../../../shared/components/SeoHelmet'
import Skeleton from '../../../../shared/components/Skeleton'
import { useQuizDisplayPrefs } from '../../../../hooks/useQuizDisplayPrefs'
import { useQuizReadAloud } from '../../../../hooks/useQuizReadAloud'
import { PAPER_BOOKMARKS_KEY } from '../../lib/paperStorageKeys'

import { QUIZ_MODE, isExam } from '../lib/quizModes'
import { QUIZ_EVENT, buildEventProps } from '../lib/quizAnalytics'
import { resolveExamAccess } from '../lib/examAccess'
import { clockOffset } from '../lib/examClock'
import { fromServerRows, markPaper } from '../lib/attemptMarking'
import { correctIndexOf } from '../lib/answerKey'
import { resumeIndex } from '../lib/practiceSession'
import { usePaperQuizAttempt } from '../hooks/usePaperQuizAttempt'
import { listPaperAttempts, summarizeAttempts } from '../services/paperQuizHistory'
import PaperQuizCover from '../components/PaperQuizCover'
import QuizRunner from '../components/QuizRunner'
import QuizResults from '../components/QuizResults'
import '../paperQuiz.css'

const SCREEN = { COVER: 'cover', RUNNER: 'runner', RESULTS: 'results' }

/** Read the bookmark list the hub and the viewer share. */
function readBookmarks() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(PAPER_BOOKMARKS_KEY) || '[]'))
  } catch { return new Set() }
}

export default function PaperQuizPage() {
  const { paperId } = useParams()
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const uid = currentUser?.uid || null
  const unlocked = useMemo(() => hasPremiumAccess(userProfile), [userProfile])

  const { prefs, displayVars } = useQuizDisplayPrefs()
  const readAloud = useQuizReadAloud(prefs.readAloud)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [paper, setPaper] = useState(null)
  const [catalogueQuestions, setCatalogueQuestions] = useState([])
  const [history, setHistory] = useState(null)
  const [screen, setScreen] = useState(SCREEN.COVER)
  const [mode, setMode] = useState(QUIZ_MODE.EXAM)
  const [strictForward, setStrictForward] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const modeReported = useRef(null)

  // The whole run is a blocked context: even a surface that forgot to ask the
  // interruption budget is refused while a learner is working (§8).
  useActivity('quiz_active')

  const attempt = usePaperQuizAttempt({ paperId, uid })

  // ── Load the paper and its quiz ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setScreen(SCREEN.COVER)
    setHistory(null)

    ;(async () => {
      try {
        const p = await getPaperById(paperId)
        if (cancelled) return
        if (!p) { setError('Paper not found.'); return }
        setPaper(p)
        // Derived, not `!p.quizId`: a paper published with the Studio's Quiz
        // step skipped can carry the id of a quiz with no questions in it.
        if (!paperQuizIsAttached(p)) { setError(LEARNER_QUIZ_PENDING_TEXT); return }

        const payload = await loadPublicQuiz(p.quizId)
        if (cancelled) return
        if (payload.outcome !== QUIZ_LOAD.OK) {
          reportClientError(
            payload.error || new Error(`past-paper quiz ${payload.outcome}`),
            `past-paper-quiz:${payload.outcome}`,
          )
          setError(QUIZ_LOAD_TEXT[payload.outcome] || QUIZ_LOAD_TEXT[QUIZ_LOAD.FAILED])
          return
        }
        // FAIL CLOSED on a subject/grade mismatch between the paper and its
        // linked quiz — we must never render a Maths question under a Social
        // Studies heading.
        const integrity = validateQuizSubjectIntegrity({ paper: p, quiz: payload.quiz, questions: payload.questions })
        if (!integrity.ok) {
          console.error('[PaperQuizPage] subject-integrity check failed — refusing to render', {
            paperId, quizId: p.quizId, violations: integrity.violations.map((v) => v.code),
          })
          setError('This quiz is temporarily unavailable while we check its content. Please try another paper.')
          return
        }
        setCatalogueQuestions(payload.questions)
        capture(QUIZ_EVENT.MODE_SELECTED, buildEventProps(QUIZ_EVENT.MODE_SELECTED, { mode: 'cover_opened', paperId }))
      } catch (err) {
        console.warn('[PaperQuizPage] load failed', err)
        if (!cancelled) setError('We could not load this quiz. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [paperId])

  // The learner's own history for this paper — the best-score card.
  useEffect(() => {
    let cancelled = false
    if (!uid || !paperId) return undefined
    // `listPaperAttempts` already swallows its own failures and resolves to
    // [], so the catch here is the lint rule's belt to that braces — a
    // rejection would leave the cover with no best-score card, which is the
    // same as a learner's first attempt and is a fine thing to render.
    listPaperAttempts(uid, paperId)
      .then((rows) => { if (!cancelled) setHistory(summarizeAttempts(rows)) })
      .catch(() => { if (!cancelled) setHistory(null) })
    return () => { cancelled = true }
  }, [uid, paperId])

  useEffect(() => { setBookmarked(readBookmarks().has(paperId)) }, [paperId])

  const total = catalogueQuestions.length
  const freeSet = useMemo(() => resolveFreeSet(paper, total), [paper, total])
  const examAccess = useMemo(
    () => resolveExamAccess({ signedIn: Boolean(uid), unlocked, freeSet, totalQuestions: total }),
    [uid, unlocked, freeSet, total],
  )
  const subjectMeta = paper && PAPER_SUBJECTS.find((s) => s.id === paper.subject)
  const durationMin = Number(paper?.durationMinutes) > 0 ? Number(paper.durationMinutes) : 90

  // The mode choice is announced once per selection, not once per render.
  useEffect(() => {
    if (modeReported.current === mode) return
    modeReported.current = mode
    capture(QUIZ_EVENT.MODE_SELECTED, buildEventProps(QUIZ_EVENT.MODE_SELECTED, { mode, paperId }))
  }, [mode, paperId])

  const toggleBookmark = useCallback(() => {
    const next = readBookmarks()
    if (next.has(paperId)) next.delete(paperId)
    else next.add(paperId)
    try { window.localStorage.setItem(PAPER_BOOKMARKS_KEY, JSON.stringify([...next])) } catch { /* private mode */ }
    setBookmarked(next.has(paperId))
  }, [paperId])

  const handleStart = useCallback(async () => {
    const started = await attempt.start({ mode, strictForward, questions: catalogueQuestions, freeSet, unlocked })
    if (!started.ok) return
    setScreen(SCREEN.RUNNER)
    capture(
      isExam(mode) ? QUIZ_EVENT.EXAM_STARTED : QUIZ_EVENT.PRACTICE_STARTED,
      buildEventProps(isExam(mode) ? QUIZ_EVENT.EXAM_STARTED : QUIZ_EVENT.PRACTICE_STARTED, {
        paperId,
        questions: total,
        durationMin,
        strictForward,
        resumed: started.resumed,
      }),
    )
  }, [attempt, mode, strictForward, catalogueQuestions, freeSet, unlocked, paperId, total, durationMin])

  const handleChoose = useCallback((question, index) => {
    const correct = isExam(mode)
      ? null
      : correctIndexOf(question) === index
    attempt.choose({ question, index, reveal: !isExam(mode) })
    if (!isExam(mode)) {
      capture(QUIZ_EVENT.PRACTICE_ANSWER, buildEventProps(QUIZ_EVENT.PRACTICE_ANSWER, { paperId, correct }))
      capture(QUIZ_EVENT.COACHING_SHOWN, buildEventProps(QUIZ_EVENT.COACHING_SHOWN, {
        paperId,
        approved: question?.explanationStatus === 'approved',
        hasDistractorCopy: Boolean(question?.distractors && Object.keys(question.distractors).length),
      }))
    }
    return correct === true
  }, [attempt, mode, paperId])

  const handleSubmit = useCallback(async ({ reason }) => {
    const out = await attempt.submit({ questions: attempt.questions })
    if (!out.ok) return
    setScreen(SCREEN.RESULTS)
    if (isExam(mode)) {
      capture(
        reason === 'timeup' ? QUIZ_EVENT.EXAM_TIMEUP : QUIZ_EVENT.EXAM_SUBMITTED,
        buildEventProps(reason === 'timeup' ? QUIZ_EVENT.EXAM_TIMEUP : QUIZ_EVENT.EXAM_SUBMITTED, {
          paperId,
          percent: out.marked?.percent,
          blanks: out.marked?.blanks,
          answered: Object.keys(attempt.answers).length,
          timeUsedSec: out.timeUsedSec,
        }),
      )
    }
  }, [attempt, mode, paperId])

  const handleAbandon = useCallback(async () => {
    capture(QUIZ_EVENT.EXAM_ABANDONED, buildEventProps(QUIZ_EVENT.EXAM_ABANDONED, {
      paperId,
      answered: Object.keys(attempt.answers).length,
      secondsIn: attempt.secondsIn(),
    }))
    await attempt.abandon()
    setScreen(SCREEN.COVER)
  }, [attempt, paperId])

  const handleSwitchToPractice = useCallback(async () => {
    setMode(QUIZ_MODE.PRACTICE)
    const started = await attempt.start({
      mode: QUIZ_MODE.PRACTICE, strictForward: false, questions: catalogueQuestions, freeSet, unlocked,
    })
    if (started.ok) setScreen(SCREEN.RUNNER)
    else setScreen(SCREEN.COVER)
  }, [attempt, catalogueQuestions, freeSet, unlocked])

  const handleFixup = useCallback(() => {
    const ids = attempt.marked?.rows.filter((r) => !r.correct).map((r) => r.questionId) || []
    capture(QUIZ_EVENT.FIXUP_STARTED, buildEventProps(QUIZ_EVENT.FIXUP_STARTED, { paperId, count: ids.length }))
    setMode(QUIZ_MODE.PRACTICE)
    attempt.startFixup(ids)
    setScreen(SCREEN.RUNNER)
  }, [attempt, paperId])

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="pq">
        <div className="pq-cover">
          <div className="pq-cover-inner" style={{ display: 'grid', gap: 14, paddingTop: 24 }}>
            <Skeleton className="h-8 w-48 rounded-radius-md" />
            <Skeleton className="h-32 rounded-radius-md" />
            <Skeleton className="h-24 rounded-radius-md" />
            <Skeleton className="h-24 rounded-radius-md" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !paper) {
    return (
      <div className="pq">
        <div className="pq-cover">
          <div className="pq-cover-inner" style={{ paddingTop: 60, textAlign: 'center' }}>
            <h1 className="pq-title">Quiz not available</h1>
            <p className="pq-tagline">{error || 'We could not load this quiz.'}</p>
            <div className="pq-stack" />
            <button type="button" className="pq-cta is-secondary" onClick={() => navigate('/papers')}>
              Back to papers
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (screen === SCREEN.RUNNER && attempt.ready) {
    return (
      <div style={displayVars.style} {...displayVars.attrs}>
        <SeoHelmet
          title={`${paper.title} — ${isExam(mode) ? 'exam' : 'practice'}`}
          description={`Sitting the ${paper.title} past paper.`}
          path={`/papers/${paperId}/quiz`}
          noIndex
        />
        <QuizRunner
          mode={mode}
          questions={attempt.questions}
          attempt={attempt.record}
          clockOffsetMs={attempt.clockOffsetMs}
          answers={attempt.answers}
          flags={attempt.flags}
          revealed={attempt.revealed}
          strictForward={strictForward}
          currentIndex={attempt.currentIndex}
          resumed={attempt.resumed}
          readAloud={readAloud}
          submitting={attempt.submitting}
          onChoose={handleChoose}
          onNavigate={attempt.goTo}
          onToggleFlag={attempt.toggleFlag}
          onSubmit={handleSubmit}
          onAbandon={handleAbandon}
          onSwitchToPractice={handleSwitchToPractice}
          onExit={() => setScreen(SCREEN.COVER)}
        />
      </div>
    )
  }

  if (screen === SCREEN.RESULTS && attempt.marked) {
    return (
      <>
        <SeoHelmet
          title={`${paper.title} — results`}
          description={`Your score on the ${paper.title} past paper.`}
          path={`/papers/${paperId}/quiz`}
          noIndex
        />
        <QuizResults
          paper={paper}
          mode={mode}
          marked={attempt.marked}
          questions={attempt.questions}
          timeUsedSec={attempt.timeUsedSec}
          flagCount={Object.keys(attempt.flags).length}
          reason={attempt.finishReason}
          unverifiedTiming={attempt.record?.unverifiedTiming}
          onFixup={handleFixup}
          onRetry={() => { attempt.reset(); setScreen(SCREEN.COVER) }}
          onDone={() => navigate('/papers')}
          onOpenNote={(topicId) => capture(QUIZ_EVENT.NOTE_OPENED, buildEventProps(QUIZ_EVENT.NOTE_OPENED, { paperId, topicId }))}
          onOpenGame={(slug) => capture(QUIZ_EVENT.GAME_OPENED, buildEventProps(QUIZ_EVENT.GAME_OPENED, { paperId, slug }))}
        />
      </>
    )
  }

  return (
    <div className="pq">
      <SeoHelmet
        title={`${paper.title} — past-paper quiz`}
        description={`Practise ${paper.title} (${paper.year || ''}) with instant feedback, or sit it as a timed exam.`}
        path={`/papers/${paperId}/quiz`}
      />
      <PaperQuizCover
        paper={paper}
        totalQuestions={total}
        durationMin={durationMin}
        subjectLabel={subjectMeta?.label}
        history={history}
        examAccess={examAccess}
        mode={mode}
        onModeChange={setMode}
        strictForward={strictForward}
        onStrictForwardChange={setStrictForward}
        onStart={handleStart}
        starting={attempt.starting}
        startError={attempt.startError}
        bookmarked={bookmarked}
        onToggleBookmark={toggleBookmark}
        onOpenHistory={() => navigate('/my-papers')}
        onBack={() => navigate(`/papers/${paperId}`)}
      />
    </div>
  )
}

/** Re-exported for the tests, which drive the marking without a DOM. */
export { markPaper, fromServerRows, clockOffset, resumeIndex }
