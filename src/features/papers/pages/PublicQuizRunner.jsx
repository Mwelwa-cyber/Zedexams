/**
 * /papers/:paperId/quiz — the past-paper quiz, runnable by both
 * signed-in and anonymous visitors.
 *
 * Why a fresh component rather than re-using QuizRunnerV2: the v2
 * runner is wired to the authenticated session (uid required, Firestore
 * `results` write on submit, badge updates, subscription nudges,
 * localStorage session keyed on uid). The past-paper preview has a
 * different contract — no auth, no result persistence, a 30-question
 * free preview gate, and a short-and-sweet score card at the end.
 *
 * Counter: every answered question increments a localStorage tally
 * via pastPaperQuiz.recordAnsweredQuestion. When the tally hits 30 and
 * the visitor is not premium, the existing paywall bus fires the
 * `quiz-preview-limit` scenario and the runner blocks further answers
 * behind a modal CTA.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { hasPremiumAccess } from '../../../utils/subscriptionConfig'
import { getPaperById } from '../../../utils/pastPaperLookup'
import {
  LEARNER_QUIZ_PENDING_TEXT,
  paperQuizIsAttached,
} from '../../../utils/pastPaperQuizStatus'
import {
  FREE_QUESTION_LIMIT,
  QUIZ_LOAD,
  QUIZ_LOAD_TEXT,
  getAnsweredCount,
  hasReachedFreeLimit,
  loadPublicQuiz,
  recordAnsweredQuestion,
  resetCounter,
} from '../../../utils/pastPaperQuiz'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { useAssessmentEngineFlag } from '../../../hooks/useAssessmentEngineFlag'
import { fromQuiz, markAttempt, unrenderableTypes } from '../../../engines/assessment-engine'
import { ChoiceQuestion } from '../../../engines/assessment-engine/render'
import { capture } from '../../../utils/analytics'
import { BUILD_ID } from '../../../utils/buildId'
import { paywall } from '../../../utils/paywall'
import { validateQuizSubjectIntegrity } from '../../../utils/quizSubjectIntegrity'
import { PAPER_SUBJECTS } from '../../../config/curriculum'
import SeoHelmet from '../../../components/seo/SeoHelmet'
import Logo from '../../../components/ui/Logo'
import Skeleton from '../../../components/ui/Skeleton'
import RichContent, { getRichPlainText } from '../../../editor/RichContent'
import { useQuizDisplayPrefs } from '../../../hooks/useQuizDisplayPrefs'
import { useQuizReadAloud } from '../../../hooks/useQuizReadAloud'
import ReadingSettingsButton from '../../../components/quiz/reading/ReadingSettingsButton'
import ReadingSettingsSheet from '../../../components/quiz/reading/ReadingSettingsSheet'
import TextToSpeechButton from '../../../components/quiz/reading/TextToSpeechButton'
import { optionsToReadAloudText } from '../../../utils/readAloudText'
import DiagramSvg from '../../../components/diagrams/DiagramSvg'
import ZoomableImage from '../../../components/quiz/ZoomableImage'
import { imagePositionClasses, resolveQuestionFigure, usesFigurePositionWrapper } from '../../../utils/questionFigure'
import ExtraQuestionImages from '../../../components/quiz/ExtraQuestionImages'

function plainTextFromQuestion(q) {
  // Prefer Tiptap JSON, fall back to legacy HTML/plain text.
  return getRichPlainText(q?.textJSON ?? q?.text ?? '') || q?.text || ''
}

function plainTextFromOption(opt) {
  if (opt == null) return ''
  if (typeof opt === 'string') {
    // An option may be a plain string ("117 kg"), legacy HTML, OR a
    // stringified Tiptap doc ('{"type":"doc",...}'). getRichPlainText handles
    // all three — for a stringified doc it extracts the readable text (e.g.
    // "1/32"), for a plain string it returns it unchanged. Routing strings
    // through it is what stops raw JSON leaking into the option label.
    return getRichPlainText(opt) || opt
  }
  if (typeof opt === 'object') {
    return getRichPlainText(opt.textJSON ?? opt.text ?? '') || opt.text || ''
  }
  return String(opt)
}

// The value to hand <RichContent> for an option, so it renders with real
// stacked fractions / KaTeX like the question stem instead of plain text.
// Mirrors plainTextFromOption's shape handling.
function richOptionValue(opt) {
  if (opt == null) return ''
  if (typeof opt === 'string') return opt
  if (typeof opt === 'object') return opt.textJSON ?? opt.text ?? ''
  return String(opt)
}

function isCorrectChoice(question, optionIndex) {
  // The platform's question schema stores the correct answer in a few
  // shapes depending on how the question was authored. Accept any of:
  //   correctAnswerIndex (int)
  //   correctIndex       (int)
  //   correctAnswer      (int OR text matching an option's plain text)
  //   options[i].isCorrect (bool, on each option)
  if (Number.isInteger(question.correctAnswerIndex)) {
    return question.correctAnswerIndex === optionIndex
  }
  if (Number.isInteger(question.correctIndex)) {
    return question.correctIndex === optionIndex
  }
  if (Number.isInteger(question.correctAnswer)) {
    return question.correctAnswer === optionIndex
  }
  const opt = question.options?.[optionIndex]
  if (opt && typeof opt === 'object' && opt.isCorrect) return true
  if (typeof question.correctAnswer === 'string') {
    const raw = question.correctAnswer.trim()
    // Exact option-text match wins FIRST: options ["B","C","A","D"] with key
    // "A" means the option whose text is "A", not position 0. Only when no
    // option's text equals the key is a single letter read as a position —
    // the legacy shape where rich options made text matching impossible.
    const options = Array.isArray(question.options) ? question.options : []
    const textHit = options.findIndex((o) =>
      plainTextFromOption(o).trim().toLowerCase() === raw.toLowerCase())
    if (textHit >= 0) return textHit === optionIndex
    const letterIndex = /^[A-Ha-h]$/.test(raw) ? raw.toUpperCase().charCodeAt(0) - 65 : -1
    if (letterIndex >= 0 && letterIndex < options.length) {
      return letterIndex === optionIndex
    }
    // Text key: compare plain projections of BOTH sides, because the key may
    // be stored rich exactly as the option is ("\frac{1}{32}" vs a fraction
    // node). Projecting only one side compares two different alphabets and
    // fails on every maths question.
    const target = (getRichPlainText(raw) || raw).trim().toLowerCase()
    return plainTextFromOption(opt).trim().toLowerCase() === target
  }
  return false
}

function FilterPill({ children }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full theme-bg-subtle theme-text-muted text-xs font-bold px-2.5 py-1">
      {children}
    </span>
  )
}

function Progress({ value, max }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100))
  return (
    <div className="theme-bg-subtle rounded-full h-2 w-full overflow-hidden" aria-hidden="true">
      <div
        className="theme-accent-fill h-full transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function OptionButton({ label, optionValue, index, selected, revealed, correct, onClick, disabled, imageUrl, diagram }) {
  let cls = 'theme-card border-2 theme-border'
  if (revealed) {
    if (correct) cls = 'border-2 border-emerald-500 bg-emerald-50 text-emerald-900'
    else if (selected) cls = 'border-2 border-rose-500 bg-rose-50 text-rose-900'
    else cls = 'theme-card border-2 theme-border opacity-60'
  } else if (selected) {
    cls = 'theme-accent-fill theme-on-accent border-2 border-transparent'
  }
  const hasVisual = Boolean(diagram?.libraryKey) || Boolean(imageUrl)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full min-h-[56px] text-left px-4 py-3 rounded-radius-md flex items-start gap-3 transition-colors disabled:cursor-not-allowed ${cls}`}
    >
      <span className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black bg-white/30 border border-current">
        {String.fromCharCode(65 + index)}
      </span>
      <span className="answer-text flex-1 min-w-0">
        {hasVisual && (
          <span className="block mb-2 rounded-md overflow-hidden border theme-border bg-white">
            {diagram?.libraryKey ? (
              <DiagramSvg
                libraryKey={diagram.libraryKey}
                params={diagram.params}
                alt={`Option ${String.fromCharCode(65 + index)} diagram`}
                className="mx-auto flex max-h-48 w-full items-center justify-center p-2"
              />
            ) : (
              <img
                src={imageUrl}
                alt={`Option ${String.fromCharCode(65 + index)}`}
                className="mx-auto block max-h-48 w-full object-contain"
              />
            )}
          </span>
        )}
        {/* Render the option as rich content (stacked fractions, KaTeX) just
            like the stem. RichContent handles Tiptap JSON, a stringified
            Tiptap doc, legacy HTML, and plain strings; the plain-text label
            is the fallback so an option is never blank or shows raw JSON. */}
        {optionValue
          ? <RichContent value={optionValue} className="block whitespace-pre-wrap" fallback={label ? <span className="block whitespace-pre-wrap">{label}</span> : null} />
          : (label && <span className="block whitespace-pre-wrap">{label}</span>)}
      </span>
      {revealed && correct && <span aria-hidden="true">✓</span>}
      {revealed && selected && !correct && <span aria-hidden="true">✗</span>}
    </button>
  )
}

export default function PublicQuizRunner() {
  const { paperId } = useParams()
  const { currentUser, userProfile } = useAuth()
  const uid = currentUser?.uid || null
  const isPremium = useMemo(() => hasPremiumAccess(userProfile), [userProfile])
  // Learner reading preferences (display-only; never affects scoring or the
  // free-question limit).
  const { prefs: quizDisplayPrefs, setPref: setQuizDisplayPref, resetPrefs: resetQuizDisplayPrefs, displayVars: quizDisplayVars, saving: savingDisplayPrefs } = useQuizDisplayPrefs()
  const [showReadingSettings, setShowReadingSettings] = useState(false)
  const readAloud = useQuizReadAloud(quizDisplayPrefs.readAloud)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [paper, setPaper] = useState(null)
  const [quiz, setQuiz] = useState(null)
  const [questions, setQuestions] = useState([])

  const [currentIndex, setCurrentIndex] = useState(0)
  const [selection, setSelection] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [score, setScore] = useState(0)
  const [answeredIds, setAnsweredIds] = useState(() => new Set())
  // Mirrors the localStorage counter so we re-render when it bumps.
  const [previewCount, setPreviewCount] = useState(0)
  const [finished, setFinished] = useState(false)

  // Stop read-aloud audio when moving to another question so it never bleeds over.
  useEffect(() => {
    readAloud.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPaper(null)
    setQuiz(null)
    setQuestions([])
    setCurrentIndex(0)
    setSelection(null)
    setRevealed(false)
    setScore(0)
    setAnsweredIds(new Set())
    setFinished(false)

    ;(async () => {
      try {
        const p = await getPaperById(paperId)
        if (cancelled) return
        if (!p) { setError('Paper not found.'); return }
        setPaper(p)
        // Derived, not `!p.quizId`: a paper published with the Studio's Quiz
        // step skipped can be carrying the id of a quiz that has no questions
        // in it yet. Nothing in the UI links here in that state, but a
        // bookmarked or shared /quiz URL still lands on this route.
        if (!paperQuizIsAttached(p)) {
          setError(LEARNER_QUIZ_PENDING_TEXT)
          return
        }
        const payload = await loadPublicQuiz(p.quizId)
        if (cancelled) return
        if (payload.outcome !== QUIZ_LOAD.OK) {
          // The paper SAYS it has a quiz (quizStatus attached + a quizId), so
          // a failure here is a broken link, not a paper without a quiz.
          // Report it: an admin who unpublishes the linked quiz, or deletes
          // it from /admin/content, otherwise gets no signal at all — the
          // learner sees a dead end and nobody upstream ever hears about it.
          console.error('[PublicQuizRunner] linked quiz could not be loaded', {
            paperId,
            quizId: p.quizId,
            outcome: payload.outcome,
            denied: payload.denied,
          })
          reportClientError(
            payload.error || new Error(`past-paper quiz ${payload.outcome}`),
            `past-paper-quiz:${payload.outcome}`,
          )
          setError(QUIZ_LOAD_TEXT[payload.outcome] || QUIZ_LOAD_TEXT[QUIZ_LOAD.FAILED])
          return
        }
        // FAIL CLOSED on a subject/grade/curriculum identity mismatch between
        // the paper and its linked quiz (the "Social Studies quiz shows a Maths
        // question" defect). We must NEVER render a quiz from a different
        // subject under this paper's heading — refuse and show a safe message
        // rather than silently substituting mismatched content.
        const integrity = validateQuizSubjectIntegrity({
          paper: p,
          quiz: payload.quiz,
          questions: payload.questions,
        })
        if (!integrity.ok) {
          console.error('[PublicQuizRunner] subject-integrity check failed — refusing to render', {
            paperId,
            quizId: p.quizId,
            violations: integrity.violations.map((v) => v.code),
          })
          setError('This quiz is temporarily unavailable while we check its content. Please try another paper.')
          return
        }
        setQuiz(payload.quiz)
        setQuestions(payload.questions)
        setPreviewCount(getAnsweredCount(paperId, uid))
      } catch (err) {
        console.warn('[PublicQuizRunner] load failed', err)
        if (!cancelled) setError('We could not load this quiz. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [paperId, uid])

  const question = questions[currentIndex] || null
  const total = questions.length
  const subjectMeta = paper && PAPER_SUBJECTS.find((s) => s.id === paper.subject)

  // ── The Phase 3 canary (docs/phase3-plan.md §5.0) ─────────────────────────
  //
  // This route is the first cutover because it persists nothing: if the engine
  // is wrong here the failure is a bad render, visible immediately, reverted by
  // one toggle. The flag selects the QUESTION CARD and the VERDICT — the chrome
  // around them (loading, SEO, the free-preview counter, the paywall, the score
  // card) is shared code, so it cannot differ between paths by construction.
  // During a canary any visible difference must mean defect, and the way to
  // afford that rule is to keep everything that is not under test identical.
  const engineFlag = useAssessmentEngineFlag('pastPaperQuiz')

  // The canonical assessment, or null when the engine path must not serve.
  //
  // Null on ANY doubt — a normalise failure, a question type the renderers
  // refuse, or an index misalignment — because the fallback is the old runner,
  // which is known-good. The alignment check matters most: `fromQuiz` validates
  // rather than filters, but if the two lists ever disagreed on order or
  // length, the free-limit tally, "Question 3 of 20" and the score would each
  // silently describe a DIFFERENT question per path. That class of bug does not
  // throw; it has to be refused structurally.
  const engineAssessment = useMemo(() => {
    // `resolved` gates the mount (the hook's own contract): before both reads
    // have settled the hook reports a PROVISIONAL decision, and serving the
    // engine card on it briefly shows a returning learner a card their eventual
    // uid may not be in the rollout for — then swaps it mid-question.
    if (!engineFlag.resolved || !engineFlag.engine || !quiz || questions.length === 0) return null
    try {
      const assessment = fromQuiz({ quiz, questions, source: 'pastPaperQuiz' })
      const aligned = assessment.questions.length === questions.length
        && assessment.questions.every((q, i) => q.id === questions[i]?.id)
      if (!aligned) {
        reportClientError(new Error('canonical questions misaligned with source'), 'paper-quiz-engine')
        return null
      }
      // The canonical key is derived ONLY from an integer `correctAnswer`
      // today; the legacy shapes the old card scores (`correctAnswerIndex`,
      // `correctIndex`, option-level `isCorrect`, a string/letter key)
      // normalise to a null correctIndex — a card that paints no answer green
      // and marks every selection wrong. Until the normaliser learns those
      // shapes, a paper carrying one is the old runner's to serve.
      if (assessment.questions.some((q) => q.correctIndex == null)) return null
      // "Can this learner be shown this whole paper" — one unsupported type
      // anywhere and the old runner serves all of it. A per-question mix of
      // engine and old cards would make a render bug impossible to attribute.
      if (unrenderableTypes(assessment).length > 0) return null
      return assessment
    } catch (err) {
      reportClientError(err, 'paper-quiz-engine')
      return null
    }
  }, [engineFlag.resolved, engineFlag.engine, quiz, questions])
  const engineActive = engineAssessment != null
  const engineQuestion = engineActive ? engineAssessment.questions[currentIndex] || null : null

  // §7.2: ONE PostHog event per runner entry, both paths, aggregate only.
  // `engine` records which card actually SERVED — a flag that said engine while
  // normalisation refused it reports false, because false is what the learner
  // saw. Fired once per mount, after the decision is resolved and the quiz has
  // loaded (an event for a quiz that never rendered would count phantom entries).
  const pathReported = useRef(false)
  useEffect(() => {
    // Gated on `final`, not `resolved`: in the watchdog window under a partial
    // rollout the hook's answer (and `latched` with it) is provisional, and a
    // once-only event recorded then is permanently wrong whenever settlement
    // overturns it (Codex P2 on #2153, r3733460759).
    if (pathReported.current || !engineFlag.final || loading || !quiz) return
    pathReported.current = true
    capture('assessment_engine_path', {
      runner: 'pastPaperQuiz',
      engine: engineActive,
      flagSource: engineFlag.source,
      // Distinguishes the watchdog hold (engine:false, latched:true, an
      // engine-selecting source) from a normalisation refusal (engine:false,
      // latched:false) — without this the two are one telemetry bucket and
      // the hold's frequency cannot be counted (Codex P2 on #2152,
      // r3733390982).
      latched: engineFlag.latched,
      // The shell mix during a hold (see buildId.js): rows from stale shells
      // are expected while the service worker turns over, and this is what
      // separates them from rows that need explaining.
      build: BUILD_ID,
    })
  }, [engineFlag.final, engineFlag.source, engineFlag.latched, engineActive, loading, quiz])

  function handleSelect(idx) {
    // `lockedOut` was enforced only by the old card's disabled attribute; the
    // engine card routes every press through here, so the guard lives here for
    // both paths.
    if (revealed || lockedOut) return
    setSelection(idx)
  }

  function handleCheck() {
    if (selection == null || !question || revealed) return
    setRevealed(true)
    // The verdict seam. On the engine path the session asks `markAttempt` and
    // never scores inline (the marking rule the engine was built around); the
    // card paints its ✓/✗ from the same canonical `correctIndex`, so the tally
    // and the highlight cannot disagree. The old path is untouched.
    const correct = engineActive
      ? markAttempt({
        assessment: engineAssessment,
        answers: { [engineQuestion.id]: selection },
        strategy: 'clientKey',
      }).score > 0
      : isCorrectChoice(question, selection)
    if (correct) setScore((s) => s + 1)

    // Only the FIRST time this question is graded counts toward the
    // free-preview pool; revisiting after a back-button shouldn't burn
    // a fresh quota slot.
    if (!answeredIds.has(question.id)) {
      const nextSet = new Set(answeredIds)
      nextSet.add(question.id)
      setAnsweredIds(nextSet)
      if (!isPremium) {
        const next = recordAnsweredQuestion(paperId, uid)
        setPreviewCount(next)
      }
    }
  }

  function handleNext() {
    // Gate AFTER the current answer has been recorded, so the visitor
    // sees the explanation for the 30th question before the wall drops.
    if (!isPremium && hasReachedFreeLimit(paperId, uid) && currentIndex < total - 1) {
      paywall.show('quiz-preview-limit', {
        paperId,
        paperTitle: paper?.title || 'this paper',
        limit: FREE_QUESTION_LIMIT,
      })
      return
    }
    if (currentIndex >= total - 1) {
      setFinished(true)
      return
    }
    setCurrentIndex((i) => i + 1)
    setSelection(null)
    setRevealed(false)
  }

  function handleRetry() {
    setCurrentIndex(0)
    setSelection(null)
    setRevealed(false)
    setScore(0)
    setAnsweredIds(new Set())
    setFinished(false)
    if (isPremium) {
      resetCounter(paperId, uid)
      setPreviewCount(0)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen theme-bg px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48 rounded-radius-md" />
          <Skeleton className="h-24 rounded-radius-md" />
          <Skeleton className="h-12 rounded-radius-md" />
          <Skeleton className="h-12 rounded-radius-md" />
          <Skeleton className="h-12 rounded-radius-md" />
        </div>
      </div>
    )
  }

  if (error || !paper || !quiz) {
    return (
      <div className="min-h-screen theme-bg flex items-center justify-center px-4">
        <div className="theme-card border theme-border rounded-radius-md p-8 max-w-md text-center">
          <div className="text-4xl mb-3" aria-hidden="true">📄</div>
          <h1 className="font-display font-black text-xl theme-text">Quiz not available</h1>
          <p className="theme-text-muted text-sm mt-2">{error || 'We could not load this quiz.'}</p>
          <Link
            to="/papers"
            className="inline-block mt-5 theme-accent-fill theme-on-accent font-black text-sm rounded-full px-5 py-2 hover:opacity-90"
          >
            Back to papers
          </Link>
        </div>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="min-h-screen theme-bg flex items-center justify-center px-4">
        <div className="theme-card border theme-border rounded-radius-md p-8 max-w-md text-center">
          <div className="text-4xl mb-3" aria-hidden="true">📝</div>
          <h1 className="font-display font-black text-xl theme-text">No questions yet</h1>
          <p className="theme-text-muted text-sm mt-2">
            This paper&apos;s quiz is being prepared. Check back shortly.
          </p>
          <Link
            to={`/papers/${paperId}`}
            className="inline-block mt-5 theme-accent-fill theme-on-accent font-black text-sm rounded-full px-5 py-2 hover:opacity-90"
          >
            View the paper
          </Link>
        </div>
      </div>
    )
  }

  if (finished) {
    const pct = Math.round((score / total) * 100)
    return (
      <div className="min-h-screen theme-bg px-4 py-10">
        <SeoHelmet
          title={`${paper.title} — quiz results`}
          description={`Your score on the ${paper.title} past-paper quiz.`}
          path={`/papers/${paperId}/quiz`}
          noIndex
        />
        <div className="max-w-2xl mx-auto theme-card border theme-border rounded-radius-md p-8 text-center">
          <div className="text-5xl mb-3" aria-hidden="true">🎯</div>
          <p className="theme-accent-text text-xs font-black uppercase tracking-widest">You finished</p>
          <h1 className="font-display font-black text-3xl theme-text mt-1">{paper.title}</h1>
          <p className="theme-text-muted text-sm mt-2">
            {subjectMeta?.label || paper.subject} · Grade {paper.grade} · {paper.year}
          </p>
          <div className="mt-8 inline-flex items-baseline gap-1">
            <span className="font-display font-black text-6xl theme-text">{score}</span>
            <span className="theme-text-muted font-bold">/ {total}</span>
          </div>
          <p className="theme-text-muted text-sm mt-1">{pct}% correct</p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <button
              type="button"
              onClick={handleRetry}
              className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90"
            >
              Try again
            </button>
            <Link
              to="/papers"
              className="theme-card border-2 theme-border rounded-full px-5 py-2 text-sm font-black theme-text hover:theme-bg-subtle"
            >
              More past papers
            </Link>
            {!currentUser && (
              <Link
                to="/register"
                className="rounded-full px-5 py-2 text-sm font-black bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Create a free account
              </Link>
            )}
          </div>
        </div>
      </div>
    )
  }

  const options = Array.isArray(question.options) ? question.options : []
  const remaining = Math.max(0, FREE_QUESTION_LIMIT - previewCount)
  const lockedOut = !isPremium && hasReachedFreeLimit(paperId, uid)

  const { className: _quizShellClass, style: quizDisplayStyle, ...quizDisplayAttrs } = quizDisplayVars

  return (
    <div className="min-h-screen theme-bg pb-24" style={quizDisplayStyle} {...quizDisplayAttrs}>
      <SeoHelmet
        title={`${paper.title} — past-paper quiz`}
        description={`Practise ${paper.title} (${paper.year || ''}) with instant feedback. Free preview, no sign-up required.`}
        path={`/papers/${paperId}/quiz`}
      />
      <ReadingSettingsSheet
        open={showReadingSettings}
        onClose={() => setShowReadingSettings(false)}
        prefs={quizDisplayPrefs}
        setPref={setQuizDisplayPref}
        resetPrefs={resetQuizDisplayPrefs}
        saving={savingDisplayPrefs}
      />

      {/* Header */}
      <header className="theme-hero px-4 pt-6 pb-10" data-bg-gradient="true">
        <div className="max-w-2xl mx-auto">
          <Link to="/papers" className="inline-flex items-center gap-1.5 text-white/85 hover:text-white text-xs font-bold mb-3">
            <Logo className="h-6 w-auto" />
          </Link>
          <p className="text-white/80 font-black text-xs uppercase tracking-widest">Past-paper quiz</p>
          <h1 className="text-white text-2xl sm:text-3xl font-black mt-1 leading-tight">{paper.title}</h1>
          <div className="flex flex-wrap gap-2 mt-3">
            <FilterPill>
              <span aria-hidden="true">{subjectMeta?.icon || '📄'}</span>
              {subjectMeta?.label || paper.subject}
            </FilterPill>
            <FilterPill>Grade {paper.grade}</FilterPill>
            {paper.year ? <FilterPill>{paper.year}</FilterPill> : null}
            <FilterPill>{total} questions</FilterPill>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 -mt-6">
        <div className="theme-card border theme-border rounded-radius-md shadow-elev-sm p-5 sm:p-6 space-y-5">
          {/* Progress */}
          <div>
            <div className="flex items-center justify-between gap-2 text-xs font-black mb-2">
              <span className="theme-text-muted uppercase tracking-widest">
                Question {currentIndex + 1} of {total}
              </span>
              <span className="flex items-center gap-2">
                <span className="theme-text-muted">Score {score}</span>
                <ReadingSettingsButton onClick={() => setShowReadingSettings(true)} />
              </span>
            </div>
            <Progress value={currentIndex + (revealed ? 1 : 0)} max={total} />
          </div>

          {/* Stem figure + prompt. Library diagrams win over uploaded photos
              (resolveQuestionFigure); without a figure block at all the
              trapezium questions show only their text and the learner can't
              actually answer them. The saved imagePosition is honoured here
              too — this surface ignored it until #2209's follow-up, so a
              teacher who chose "Image below text" got it on the quiz runner
              and the daily exam but not on the public papers runner. */}
          {(() => {
            const pos = question.imagePosition
            const figure = resolveQuestionFigure(question)
            const imageBlock = figure.kind === 'diagram' ? (
              <div className="overflow-hidden rounded-radius-md border theme-border bg-white p-3">
                <DiagramSvg
                  libraryKey={figure.libraryKey}
                  params={figure.params}
                  alt="Question diagram"
                  className="mx-auto flex max-h-[60vh] w-full items-center justify-center"
                />
              </div>
            ) : figure.kind === 'image' ? (
              <div className="overflow-hidden rounded-radius-md border theme-border bg-white p-3">
                <ZoomableImage
                  src={figure.imageUrl}
                  alt="Question illustration"
                  fallbackText={question.diagramText}
                  className="mx-auto max-h-[60vh] w-full rounded-xl object-contain"
                />
              </div>
            ) : null
            const textBlock = (
              <div className="min-w-0 flex-1">
                {/* Question prompt — regular weight; only intentionally-marked
                    words (bold/underline/highlight) stand out. */}
                <div className="flex items-start gap-2">
                  <div className="question-text flex-1">
                    {/* A legacy question has no textJSON, only an HTML `text`
                        string — which RichContent renders (it is the same value
                        the main quiz runner renders). The old plain branch
                        handed that HTML to getRichPlainText, which returns
                        non-JSON strings VERBATIM, so the learner read escaped
                        raw markup as the question. */}
                    <RichContent
                      value={question.textJSON ?? question.text ?? ''}
                      fallback={<p>{plainTextFromQuestion(question)}</p>}
                    />
                  </div>
                  <TextToSpeechButton
                    id={`q:${currentIndex}`}
                    label="question"
                    getText={() => plainTextFromQuestion(question)}
                    tts={readAloud}
                    className="mt-0.5 shrink-0"
                  />
                </div>
              </div>
            )
            // diagramText is the no-figure fallback (a described diagram we
            // could not draw), so it is mutually exclusive with imageBlock and
            // never needs a place inside the position wrapper.
            const diagramTextFallback = figure.kind === 'none' && question.diagramText ? (
              <p className="whitespace-pre-line rounded-xl bg-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-700">
                {question.diagramText}
              </p>
            ) : null
            if (!usesFigurePositionWrapper(pos, Boolean(imageBlock))) {
              return (
                <>
                  {imageBlock}
                  <ExtraQuestionImages question={question} />
                  {diagramTextFallback}
                  {textBlock}
                </>
              )
            }
            return (
              <>
                <div className={imagePositionClasses(pos)} data-image-position={pos}>
                  {imageBlock}
                  {textBlock}
                </div>
                <ExtraQuestionImages question={question} />
              </>
            )
          })()}

          {/* Options */}
          {readAloud.enabled && options.length > 0 && (
            <div className="flex items-center gap-2 text-xs font-bold theme-text-muted">
              <span>Answer options</span>
              <TextToSpeechButton
                id={`opts:${currentIndex}`}
                label="answer options"
                getText={() => optionsToReadAloudText(options.map(plainTextFromOption))}
                tts={readAloud}
              />
            </div>
          )}
          {/* The canary's flag boundary (docs/phase3-plan.md §5.0): the
              CHOICE CARD is the engine's or the old runner's, never a mix.
              Everything around it — stem, TTS, explanation, navigation, the
              free-limit counter — is the same code on both paths, which is
              what makes "any visible difference means defect" an enforceable
              rule rather than a hope. `data-engine-runner` is how a test (and
              a bug report) tells the two cards apart. */}
          {engineActive ? (
            <div data-engine-runner="pastPaperQuiz" className="space-y-2.5">
              <ChoiceQuestion
                question={engineQuestion}
                answer={selection}
                revealed={revealed}
                onAnswer={handleSelect}
                disabled={lockedOut}
              />
            </div>
          ) : (
            <div className="space-y-2.5">
              {options.map((opt, idx) => {
                const label = plainTextFromOption(opt)
                const optObj = (opt && typeof opt === 'object') ? opt : null
                return (
                  <OptionButton
                    key={idx}
                    index={idx}
                    label={label}
                    optionValue={richOptionValue(opt)}
                    imageUrl={optObj?.imageUrl}
                    diagram={optObj?.diagram}
                    selected={selection === idx}
                    revealed={revealed}
                    correct={isCorrectChoice(question, idx)}
                    onClick={() => handleSelect(idx)}
                    disabled={revealed || lockedOut}
                  />
                )
              })}
              {options.length === 0 && (
                <p className="theme-text-muted text-sm italic">
                  This question has no options configured yet.
                </p>
              )}
            </div>
          )}

          {/* Explanation after reveal */}
          {revealed && (question.explanation || question.explanationJSON) && (
            <div className="theme-bg-subtle border-l-4 theme-accent-border rounded-r-radius-md p-4">
              <p className="text-xs font-black theme-accent-text uppercase tracking-widest mb-1">
                Explanation
              </p>
              <div className="theme-text text-sm">
                {/* Same shape as the stem: a legacy explanation is an HTML
                    string, and RichContent is the renderer that can draw it. */}
                <RichContent
                  value={question.explanationJSON ?? question.explanation ?? ''}
                  fallback={<p>{getRichPlainText(question.explanation) || question.explanation}</p>}
                />
              </div>
            </div>
          )}

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t theme-border">
            {!revealed ? (
              <button
                type="button"
                onClick={handleCheck}
                disabled={selection == null || lockedOut}
                className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Check answer
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                className="theme-accent-fill theme-on-accent rounded-full px-5 py-2 text-sm font-black hover:opacity-90"
              >
                {currentIndex >= total - 1 ? 'See your score' : 'Next question →'}
              </button>
            )}
            {!isPremium && (
              <span className="theme-text-muted text-xs font-bold ml-auto">
                {remaining > 0
                  ? `${remaining} free question${remaining === 1 ? '' : 's'} left`
                  : 'Free preview ended'}
              </span>
            )}
          </div>

          {lockedOut && (
            <div className="theme-bg-subtle border theme-border rounded-radius-md p-4 text-sm">
              <p className="theme-text font-black mb-1">Your free preview ended</p>
              <p className="theme-text-muted">
                Upgrade to unlock the rest of this paper, every past-paper quiz, and the full
                Grade {paper.grade} learning pack.
              </p>
              <button
                type="button"
                onClick={() => paywall.show('quiz-preview-limit', {
                  paperId,
                  paperTitle: paper.title,
                  limit: FREE_QUESTION_LIMIT,
                })}
                className="mt-3 rounded-full px-4 py-2 text-xs font-black theme-accent-fill theme-on-accent"
              >
                Upgrade to keep going
              </button>
            </div>
          )}
        </div>

        {/* Footer hint for anon visitors */}
        {!currentUser && (
          <p className="text-center theme-text-muted text-xs mt-6">
            No sign-up needed for the free preview. {' '}
            <Link to="/register" className="theme-accent-text font-black underline">
              Create an account
            </Link>
            {' '}to save your progress.
          </p>
        )}
      </div>
    </div>
  )
}
