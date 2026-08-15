import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useFirestore } from '../../../hooks/useFirestore'
import { optionLabel } from '../../../utils/mcqChoices'
import { useAuth } from '../../../contexts/AuthContext'
import { useDataSaver } from '../../../contexts/DataSaverContext'
import { useSubscription } from '../../../hooks/useSubscription'
import { buildQuizDisplaySections, shuffleQuizSections } from '../../../utils/quizSections.js'
import UpgradeModal from '../../../components/subscription/UpgradeModal'
import QuizTip from '../components/QuizTip'
import ZoomableImage from '../../../shared/components/ZoomableImage'
import ExtraQuestionImages from '../../../shared/components/ExtraQuestionImages'
import DiagramSvg from '../../../curriculum/diagrams/DiagramSvg'
import { getPakoTip } from '../../../config/curriculum'
import { checkAnswerWithAI } from '../../../utils/geminiChecker'
import { numericMatches, hotspotMatches } from '../../../utils/examService'
// RichContent renders legacy HTML strings AND Tiptap JSON; getRichPlainText
// extracts plain text from either format. Legacy richTextToPlainText is
// only HTML-aware, so we prefer getRichPlainText wherever we have a choice.
import RichContent, { getRichPlainText } from '../../../editor/RichContent'
import { useQuizDisplayPrefs } from '../../../hooks/useQuizDisplayPrefs'
import { useQuizReadAloud } from '../../../hooks/useQuizReadAloud'
import ReadingSettingsButton from '../../../shared/components/ReadingSettingsButton'
import { ReadingThemePicker } from '../../learnerSettings'
import ReadingSettingsSheet from '../../../shared/components/ReadingSettingsSheet'
import TextToSpeechButton from '../../../shared/components/TextToSpeechButton'
import PassageViewer from '../../../shared/components/PassageViewer'
import QuizReviewScreen from '../../../shared/components/QuizReviewScreen'
import { optionsToReadAloudText, questionToReadAloudText } from '../../../utils/readAloudText'
import { saveQuizSession, loadQuizSession, clearQuizSession } from '../../../hooks/useQuizPersistence'
import {
  isTextAnswerType,
  isNumericType,
  isHotspotType,
  isFillBlanksType,
  isDiagramLabelType,
  isMatchingType,
  isSequenceType,
} from '../../../utils/quizScoring'
import { buildQuizResultPayload } from '../../../utils/quizResultPayload'
import { useAssessmentEngineFlag } from '../../../hooks/useAssessmentEngineFlag'
import { fromQuiz, markAttempt, unrenderableTypes } from '../../../engines/assessment-engine'
import { ChoiceQuestion } from '../../../engines/assessment-engine/render'
// `persist/` is reached as an AREA, not through the front door — the past-paper
// canary imports the front door and must remain structurally unable to write
// (`test:paper-quiz-zero-write`). Same idiom as `render/` above.
import { buildResultDocument } from '../../../engines/assessment-engine/persist'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { capture } from '../../../utils/analytics'
import { BUILD_ID } from '../../../utils/buildId'
import { imagePositionClasses, resolveQuestionFigure, usesFigurePositionWrapper } from '../../../utils/questionFigure'
import { fillBlanksLayout, gradeFillBlanks } from '../../../utils/fillBlanks'
import { diagramLabelLayout, gradeDiagramLabels } from '../../../utils/diagramLabelGrading'
import { gradeMatching } from '../../../utils/matchingGrading'
import { gradeSequence } from '../../../utils/sequenceGrading'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import ErrorState from '../../../shared/components/ErrorState'
import { friendlyTemplate, toFriendlyError } from '../../../utils/friendlyErrors'

function fmt(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// Gathers every learner-facing image URL in a display section (passage
// illustration, question illustrations, and any per-option images) so the
// next section's pictures can be warmed in the browser cache before the
// learner navigates to it — no more waiting on a cold fetch after pressing
// "Next".
function collectSectionImageUrls(section) {
  if (!section) return []
  const urls = []
  const pushQuestion = (q) => {
    if (!q) return
    if (q.imageUrl) urls.push(q.imageUrl)
    if (Array.isArray(q.optionMedia)) {
      q.optionMedia.forEach((m) => { if (m?.imageUrl) urls.push(m.imageUrl) })
    }
  }
  if (section.kind === 'passage') {
    if (section.passage?.imageUrl) urls.push(section.passage.imageUrl)
    ;(section.questions || []).forEach(pushQuestion)
  } else {
    pushQuestion(section.question)
  }
  return urls
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

function OptionButton({ label, selected, revealed, correct, wrong, onClick, imageUrl, imageAlt, diagram, optionValue, children }) {
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
      <span className="answer-text flex-1 leading-snug">
        {diagram ? (
          <DiagramSvg
            libraryKey={diagram.libraryKey}
            params={diagram.params}
            alt={imageAlt || ''}
            className="quiz-option-image"
          />
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt={imageAlt || ''}
            className="quiz-option-image"
            decoding="async"
            onError={event => {
              // Stay tappable, just hide the broken icon — the option text
              // below still names the choice so the learner can pick it.
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : null}
        {/* optionValue may be plain text, a Tiptap JSON object, or a JSON
            string. RichContent handles all three transparently — and falls
            back to the supplied children if there's nothing rich to render
            (keeps the legacy quiz path working). */}
        {optionValue ? <RichContent value={optionValue} className="rich-option" /> : children}
      </span>
      {/* Icon + label pair so correctness is never signalled by colour alone. */}
      {revealed && correct && (
        <span className="zx-opt-state text-lg" role="img" aria-label="Correct">✓</span>
      )}
      {revealed && wrong && (
        <span className="zx-opt-state text-lg" role="img" aria-label="Incorrect">✗</span>
      )}
    </button>
  )
}

// The layout classes for the question image + text pair, and the rule for
// which figure a question carries, now live in src/utils/questionFigure.js —
// this file held the only copy, and the three other surfaces that render a
// question each reimplemented part of it (see that module's header).

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
  // Shuffle escape hatch: an assigned quiz launched with ?shuffle=1 randomises
  // question order. Derived at component scope (like difficultyFilter) so the
  // load effect can depend on the stable string rather than the searchParams
  // object.
  const shuffleParam = (searchParams.get('shuffle') || '').toLowerCase()
  const { currentUser } = useAuth()
  const { getQuizById, getQuestions, saveResult } = useFirestore()
  const { canUseExamMode, canAccessFullContent } = useSubscription()
  const { dataSaver } = useDataSaver()
  // Learner reading preferences (text size / spacing / theme / highlight …).
  // displayVars is spread onto the runner root so every question, option, and
  // passage inherits the chosen theme + scale. Display-only — never touches
  // answers or scoring.
  const { prefs: quizDisplayPrefs, setPref: setQuizDisplayPref, resetPrefs: resetQuizDisplayPrefs, displayVars: quizDisplayVars, saving: savingDisplayPrefs } = useQuizDisplayPrefs()
  const [showReadingSettings, setShowReadingSettings] = useState(false)
  // Read-aloud (text-to-speech). Gated by the readAloud reading preference —
  // when off, no speaker buttons render and nothing is ever spoken.
  const readAloud = useQuizReadAloud(quizDisplayPrefs.readAloud)

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
  // Set when an exam is resumed after its deadline already passed — the
  // auto-submit effect finalises the saved answers instead of dropping them.
  const expiredResumeRef = useRef(false)

  // Stop any read-aloud audio when the learner moves to another section, so
  // audio never bleeds across questions.
  useEffect(() => {
    readAloud.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionIndex])
  // Synchronous re-entry guard. `submitting` state is async, so a timer
  // auto-fire and a manual tap landing in the same tick would both pass a
  // state check and write two `results` docs. A ref flips immediately.
  const submittedRef = useRef(false)

  useEffect(() => {
    async function load() {
      try {
        const [quizDoc, questionDocs] = await Promise.all([getQuizById(quizId), getQuestions(quizId)])
        if (!quizDoc) {
          setError(friendlyTemplate('quizNotFound'))
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
        // Shuffle ONLY when shuffle is explicitly enabled — either the quiz
        // doc carries a truthy `shuffleQuestions` flag (set when an assignment
        // requested shuffling) or the launch URL passes `?shuffle=1`. By
        // default we preserve the document order the parser produced.
        // shuffleQuizSections keeps Parts and passages intact (it only
        // reorders within those boundaries), so the section structure stays
        // correct while the questions a learner sees are randomised.
        const shuffleEnabled = Boolean(quizDoc.shuffleQuestions)
          || ['1', 'true', 'yes'].includes(shuffleParam)
        const displaySections = shuffleEnabled
          ? shuffleQuizSections(built.sections)
          : built.sections
        setSections(displaySections)
        setQuestions(built.questions)

        // Seed sequence questions with their on-screen starting order (the
        // array of filled item indices in display order). gradeSequence reads
        // `answers[qid]` as this ordering, so seeding means an untouched
        // sequence grades against exactly what the learner sees rather than
        // counting as unanswered. Saved-session answers win over the seed.
        const seedSequence = {}
        for (const q of built.questions) {
          if (q.type === 'sequence') {
            seedSequence[q.id] = (Array.isArray(q.sequenceItems) ? q.sequenceItems : [])
              .map((it, i) => (String(it ?? '').trim() ? i : -1))
              .filter(i => i >= 0)
          }
        }

        // Auto-resume any in-progress session saved in localStorage. Opt into
        // includeExpired so an exam whose timer ran out while the app was
        // closed is reconstructed and submitted (below) rather than silently
        // discarded — otherwise the learner loses the whole attempt.
        if (currentUser) {
          const saved = loadQuizSession(quizId, currentUser.uid, { includeExpired: true })
          if (saved) {
            setMode(saved.mode)
            setAnswers({ ...seedSequence, ...(saved.answers || {}) })
            setFlagged(saved.flagged || {})
            setRevealed(saved.revealed || {})
            setShortText(saved.shortText || {})
            setAiResults(saved.aiResults || {})
            setActiveSectionIndex(Math.max(0, Math.min(saved.activeSectionIndex || 0, built.sections.length - 1)))
            if (saved.endTime) setEndTime(saved.endTime)
            setStartTime(saved.startTime || Date.now())
            setStarted(true)
            // Expired exam: flag it so the auto-submit effect finalises the
            // saved answers once questions/state are in place.
            if (saved.expired) expiredResumeRef.current = true
          } else if (Object.keys(seedSequence).length) {
            setAnswers(seedSequence)
          }
        } else if (Object.keys(seedSequence).length) {
          setAnswers(seedSequence)
        }
      } catch (err) {
        console.error('QuizRunner load failed', err)
        // A read failure is usually a dropped connection, not a missing quiz —
        // let the translator pick the right card (offline / retryable generic).
        setError(toFriendlyError(err, { online: typeof navigator !== 'undefined' ? navigator.onLine : undefined }))
      } finally {
        setLoading(false)
      }
    }

    load()
    return () => clearInterval(timerRef.current)
  }, [quizId, getQuizById, getQuestions, canAccessFullContent, navigate, currentUser, difficultyFilter, shuffleParam])

  // Warm the next section's images in the browser cache while the learner
  // is still on the current one, so advancing shows the picture instantly
  // instead of kicking off a cold fetch. Skipped under Data Saver — that
  // mode deliberately avoids speculative downloads on metered connections.
  useEffect(() => {
    if (dataSaver || !sections.length) return
    if (typeof window === 'undefined' || typeof Image === 'undefined') return
    const nextSection = sections[activeSectionIndex + 1]
    const urls = collectSectionImageUrls(nextSection)
    if (!urls.length) return
    // Hold references until unmount so the GC can't reclaim the in-flight
    // requests before the bytes land in cache.
    const loaders = urls.map((url) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      return img
    })
    return () => { loaders.forEach((img) => { img.src = '' }) }
  }, [sections, activeSectionIndex, dataSaver])

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

  // Finalise an exam that was resumed after its deadline. The restore path sets
  // expiredResumeRef; once the session is started and questions are in state
  // (so handleSubmit's closure holds the recovered answers) we submit exactly
  // once. autoRef is shared with the live timer path so the two can never
  // double-submit. Without this the learner's saved answers would be lost.
  useEffect(() => {
    if (!expiredResumeRef.current) return
    if (!started || !questions.length || autoRef.current) return
    autoRef.current = true
    submitRef.current?.(true)
  }, [started, questions])

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

  // ── The Phase 3 quiz cutover (docs/phase3-plan.md §5.0, second flip) ───────
  //
  // Past-paper was the canary because it persists nothing. This route is the
  // first that WRITES, so the engine's `persist/` builder ships here — and it
  // is the builder the replay harness has been diffing against the old path on
  // every fixture since #2125 (`test:replay-engine-comparison`). The flag
  // selects the CHOICE CARD, the VERDICT and the RESULT DOCUMENT; every other
  // thing on the screen — stem, figures, sections, passages, timer, bookmark,
  // review screen, navigation — is the same code on both paths, so a visible
  // difference during the ramp means defect rather than "the new one is
  // different".
  const engineFlag = useAssessmentEngineFlag('quiz')

  // The canonical assessment, or null when the engine path must not serve.
  //
  // Null on ANY doubt, because the fallback is the known-good old runner. The
  // refusals below are what keep this cutover honest at a runner that renders
  // eleven question types while the engine draws two: a quiz containing a
  // single short-answer, fill-blanks or matching question is served ENTIRELY by
  // the old runner. There is no per-question mix — a learner meets one card
  // design per attempt, and a render bug stays attributable to one path.
  const engineAssessment = useMemo(() => {
    // `resolved` gates the decision (the hook's contract): acting on the
    // provisional answer would swap the card out from under a learner who has
    // already answered, and an answer held in one card's state is not carried
    // into the other's.
    if (!engineFlag.resolved || !engineFlag.engine || !quiz || questions.length === 0) return null
    try {
      const assessment = fromQuiz({
        quiz,
        questions,
        source: 'quiz',
        timed: mode === 'exam',
      })
      // `fromQuiz` validates rather than filters, but if the two lists ever
      // disagreed on order or length then the answer map, the score and the
      // review screen would each silently describe a DIFFERENT question per
      // path. That class of bug does not throw, so it is refused structurally.
      const aligned = assessment.questions.length === questions.length
        && assessment.questions.every((q, i) => q.id === questions[i]?.id)
      if (!aligned) {
        reportClientError(new Error('canonical questions misaligned with source'), 'quiz-engine')
        return null
      }
      // The written document takes its `quizId` from the assessment's id
      // (persist/resultDocument.js), so an id that failed to carry across
      // would file a learner's result against the wrong quiz — or against ''.
      // Nothing on screen would reveal it: the attempt renders and submits
      // normally, and only the results page, the teacher's analytics and the
      // learner's history are wrong. Refused rather than trusted, because this
      // is the first cutover that writes.
      if (assessment.id !== quizId) {
        reportClientError(new Error('canonical assessment id does not match the route quiz id'), 'quiz-engine')
        return null
      }
      // "Can this learner be shown this whole quiz." One unsupported type
      // anywhere and the old runner serves all of it.
      if (unrenderableTypes(assessment).length > 0) return null
      // Option MEDIA is a refusal the type check cannot make, because it is a
      // property of the data rather than of the type. The old card draws a
      // picture or a diagram per option (`question.optionMedia`); the canonical
      // model has no field for one and `ChoiceQuestion` draws only text. So an
      // engine-served question whose options ARE the pictures — routine in
      // maths and science MCQs — would render four blank-looking rows and be
      // unanswerable, which is the exact failure `render/supportedTypes.js`
      // exists to refuse: "not a crash, not a red test, just a learner losing
      // marks for something nobody drew." Removing this refusal means teaching
      // the model and the renderer about media, not deleting the check.
      const hasOptionMedia = questions.some((q) => Array.isArray(q?.optionMedia)
        && q.optionMedia.some((m) => m?.imageUrl || m?.diagram))
      if (hasOptionMedia) return null
      // A topic the two paths would KEY DIFFERENTLY, which is a divergence in
      // the written document rather than on the screen (Codex P2 on #2329,
      // r3777973394 — arriving nine minutes after that PR merged).
      //
      // `fromQuiz.topicIdsOf` trims, and drops a whitespace-only topic
      // entirely; the old path hands `question.topic` to `computeQuizScore`
      // untouched and only falls back to 'General' when it is falsy. So
      // `' Algebra '` keys as `' Algebra '` on one path and `'Algebra'` on the
      // other, and `'   '` keys as `'   '` versus `'General'`. `topicScores`
      // feeds the results page and weakness analytics, so that silently splits
      // or merges a learner's topic aggregates — and `timeSpent` is the ONLY
      // deviation this cutover declared.
      //
      // The replay harness did not catch it because no fixture carries an
      // untrimmed topic: the comparison is exact, so the gap was in the corpus
      // rather than in the differ. Refusing keeps the write byte-compatible;
      // the alternative — trimming on the old path too — changes documents the
      // engine is not serving, which is a data decision and not a cutover one.
      const topicKeysWouldDiverge = questions.some((q) => {
        const topic = q?.topic
        if (topic === undefined || topic === null || topic === '') return false
        // A truthy NON-string keys itself on the old path and 'General' on the
        // engine, because `topicIdsOf` only accepts strings.
        if (typeof topic !== 'string') return Boolean(topic)
        return topic !== topic.trim()
      })
      if (topicKeysWouldDiverge) return null
      // The canonical key is derived only from an integer `correctAnswer`
      // today; every other stored shape normalises to a null correctIndex — a
      // card that paints nothing green and marks every selection wrong. A quiz
      // carrying one is the old runner's to serve until the normaliser learns
      // that shape.
      if (assessment.questions.some((q) => q.correctIndex == null)) return null
      return assessment
    } catch (err) {
      reportClientError(err, 'quiz-engine')
      return null
    }
  }, [engineFlag.resolved, engineFlag.engine, quiz, questions, mode, quizId])
  // The decision is LATCHED for the duration of an attempt (Codex P2 on #2329,
  // r3777973386). `resolved` gates the decision but does not gate the mount:
  // the quiz document can load before the flag settles, so a learner could
  // press Start and answer on the old card, and the memo above would then turn
  // non-null when the decision landed — swapping the card mid-attempt, which is
  // the exact thing the hook's latch exists to prevent. The comment here used
  // to claim `resolved` prevented that; it did not.
  //
  // Latching at Start rather than blocking Start is deliberate: gating the
  // start card on a Firestore round trip costs every learner a wait to protect
  // a rare race, and the conservative direction is free — an attempt that began
  // before the decision landed simply finishes on the known-good old runner.
  const attemptEngineRef = useRef(null)
  const attemptLatchedRef = useRef(false)
  if (started && !attemptLatchedRef.current) {
    attemptLatchedRef.current = true
    attemptEngineRef.current = engineAssessment
  } else if (!started && attemptLatchedRef.current) {
    // Re-arm for the next attempt: "Try again" returns to the start card, and
    // a stale latch would pin a whole session to the first attempt's decision.
    attemptLatchedRef.current = false
    attemptEngineRef.current = null
  }
  // The latch holds in ONE direction only, which is the whole point of it
  // (Codex P1 on #2336, r3778380753 — the first version held in both).
  //
  // false→true is held: an attempt that began before the decision landed
  // finishes on the old runner, because swapping a learner onto the engine
  // mid-question is the harm.
  //
  // true→false is NOT held: an operator disabling the flag is an emergency
  // rollback, and it must reach the learners currently on the engine — who are
  // precisely the population the rollback is for. Held in both directions, an
  // in-flight attempt kept the engine renderer, verdict AND result writer after
  // the switch was thrown, which is `flags.js`'s stated rule inverted: "a
  // rollback that spares the people most likely to be staff is a rollback that
  // leaves the failure running for exactly the group that would otherwise
  // notice it stopped." The hook says the same in one line — a ramp-up never
  // moves a learner mid-question, a rollback always does.
  const attemptAssessment = started
    ? (engineAssessment ? attemptEngineRef.current : null)
    : engineAssessment
  // The latch held this attempt on the old card even though the decision now
  // says engine — a CONSUMER-level hold the hook's own `latched` cannot see
  // (Codex P2 on #2336, r3778380755). Without its own dimension the event
  // reports `engine:false, latched:false`, which is indistinguishable from a
  // normalisation refusal — and the refusal rate is the number the ramp
  // decision is made on, so a hold counted as a refusal argues against a ramp
  // the engine is in fact ready for.
  const heldByAttemptLatch = started && engineAssessment != null && attemptAssessment == null
  const engineActive = attemptAssessment != null
  // Looked up by id rather than by index: this runner draws whole sections at
  // a time, so there is no single "current" question to index into.
  const engineQuestionsById = useMemo(() => {
    if (!attemptAssessment) return null
    return new Map(attemptAssessment.questions.map((q) => [q.id, q]))
  }, [attemptAssessment])

  // §7.2: ONE PostHog event per runner entry, both paths, aggregate only.
  // `engine` records which card actually SERVED — a flag that said engine while
  // normalisation refused it reports false, because false is what the learner
  // saw.
  const pathReported = useRef(false)
  useEffect(() => {
    // Gated on `final`, not `resolved`: under a partial rollout the hook's
    // answer is provisional during the auth watchdog window, and a once-only
    // event recorded then is permanently wrong whenever settlement overturns it.
    if (pathReported.current || !engineFlag.final || loading || !quiz || !started) return
    pathReported.current = true
    capture('assessment_engine_path', {
      runner: 'quiz',
      engine: engineActive,
      flagSource: engineFlag.source,
      // Separates the watchdog hold (engine:false, latched:true) from a
      // normalisation refusal (engine:false, latched:false) — without it the
      // two are one bucket and the refusal rate cannot be read, which at this
      // runner is the number that says how much of the corpus the engine can
      // actually serve.
      latched: engineFlag.latched,
      // A dead `settings/global` subscription forces the decision closed, and
      // the resolver then reports the SAME `runner-off` source as a flag an
      // operator turned off — so without this, a client that lost its config
      // feed is indistinguishable in PostHog from an intentional rollback, and
      // the ramp's denominator quietly changes for a reason nobody can see.
      // The hook's own docblock asks consumers to send it (Codex P2 on #2329,
      // r3777973366).
      live: engineFlag.live,
      // The attempt-level hold, distinct from the hook's `latched`: this quiz
      // was ELIGIBLE and the engine was on, but the attempt had already begun
      // before the decision landed. Counting it as a refusal would understate
      // how much of the corpus the engine can serve.
      heldByAttemptLatch,
      build: BUILD_ID,
    })
  }, [engineFlag.final, engineFlag.source, engineFlag.latched, engineFlag.live, engineActive,
    heldByAttemptLatch, loading, quiz, started])

  /**
   * Is this choice correct? The verdict seam.
   *
   * On the engine path the session asks `markAttempt` and never scores inline;
   * the card paints its ✓/✗ from the same canonical `correctIndex`, so the
   * tally, the highlight and the written result cannot disagree. The old path
   * keeps its own comparison, untouched.
   */
  function isChoiceCorrect(question, optionIndex) {
    const engineQuestion = engineActive ? engineQuestionsById.get(question.id) : null
    if (!engineQuestion) return question && optionIndex === question.correctAnswer
    return markAttempt({
      assessment: attemptAssessment,
      answers: { [engineQuestion.id]: optionIndex },
      strategy: 'clientKey',
    }).score > 0
  }

  function pick(questionId, optionIndex) {
    setAnswers(current => ({ ...current, [questionId]: optionIndex }))
    if (mode === 'practice') {
      setRevealed(current => ({ ...current, [questionId]: true }))
      const currentQuestion = questions.find(question => question.id === questionId)
      const isCorrect = currentQuestion && isChoiceCorrect(currentQuestion, optionIndex)
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

    // Persist the raw answer up front so a failed/blocked AI call (offline,
    // rate-limited, unavailable) can never discard what the learner typed. The
    // AI verdict below only enriches it with the `correct` flag used for
    // scoring — it is never a precondition for the answer being saved.
    setAnswers(current => ({ ...current, [questionId]: { text: typedAnswer } }))

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
      if (result.graded === false) {
        // The AI grader could not evaluate this answer (burst throttle /
        // provider timeout / AI-budget). Save the response as PENDING — never
        // as wrong — so scoring excludes it and a transient failure can't lower
        // the learner's mark. Show the taxonomy message (a retryable throttle
        // says "try again in Ns"; a daily limit says "tomorrow").
        setAnswers(current => ({ ...current, [questionId]: { text: typedAnswer, pending: true } }))
        setActionError(result.feedback ||
          'Your answer is saved. We couldn’t mark it right now — that’s okay, keep going.')
      } else {
        setAnswers(current => ({ ...current, [questionId]: { text: typedAnswer, correct: result.correct } }))
        if (mode === 'practice') {
          setRevealed(current => ({ ...current, [questionId]: true }))
          setFeedbackType(result.correct ? 'correct' : 'wrong')
          setTimeout(() => setFeedbackType(null), 1300)
          setPakoTip({ visible: true, text: result.feedback, isCorrect: result.correct, questionId })
        }
      }
    } catch (error) {
      console.error('AI check failed:', error)
      // Marking was ATTEMPTED and failed unexpectedly (checkAnswerWithAI threw
      // instead of returning a pending verdict). Mark the answer PENDING — never
      // leave it as a bare {text} that computeQuizScore would score WRONG. This
      // is the same correctness guarantee as the graded:false branch above: a
      // transient failure can never lower a learner's mark. The attempt is then
      // persisted as provisional (finalScore null) at submit.
      setAnswers(current => ({ ...current, [questionId]: { text: typedAnswer, pending: true } }))
      if (mode === 'exam') {
        // The raw answer was saved above, so nothing is lost. Don't block the
        // learner or show a scary failure — marking just didn't happen now.
        setActionError('Your answer is saved. We couldn’t mark it right now — that’s okay, keep going.')
      } else {
        setActionError(error?.message || 'AI marking is temporarily unavailable. Please try again.')
      }
    } finally {
      setAiChecking(current => ({ ...current, [questionId]: false }))
    }
  }

  const handleSubmit = useCallback(async (auto = false) => {
    if (submittedRef.current) return
    submittedRef.current = true
    if (!auto) setShowSubmit(false)
    setSubmitting(true)
    try {
      // The payload is built by a pure function so the exact document this
      // path writes can be produced without rendering the runner — see
      // src/utils/quizResultPayload.js. Scoring, provisional grading and the
      // field set all live there now; this call site owns only the I/O.
      //
      // On the engine path the same document is built through the canonical
      // model instead: normalise → mark → build, which is exactly the sequence
      // `scripts/replay/replayEngineComparison.test.js` replays every recorded
      // attempt through and diffs against this builder's output. The two agree
      // field for field on every fixture, with one declared deviation —
      // `timeSpent` is null rather than 0 when the attempt's start is unknown,
      // because a duration that reads as measured but never was is worse than
      // an honest absence (persist/resultDocument.js).
      const nowMs = Date.now()
      const payload = engineActive
        ? buildResultDocument({
          assessment: attemptAssessment,
          attempt: {
            userId: currentUser.uid,
            answers,
            mode,
            startedAtMs: startTime,
          },
          verdict: markAttempt({
            assessment: attemptAssessment,
            answers,
            strategy: 'clientKey',
          }),
          nowMs,
        })
        : buildQuizResultPayload({
          quiz,
          quizId,
          questions,
          answers,
          mode,
          userId: currentUser.uid,
          startTime,
          nowMs,
        })
      const resultId = await saveResult(payload)
      // Clear saved session now that results are safely in Firestore
      clearQuizSession(quizId, currentUser.uid)
      navigate(`/results/${resultId}`)
    } catch (error) {
      console.error(error)
      // Allow a retry after a genuine save failure. The submit button is
      // disabled while `submitting` is true, so we can't get into this
      // catch block from two parallel submissions.
      // eslint-disable-next-line require-atomic-updates
      submittedRef.current = false
      setSubmitting(false)
      setActionError('Failed to save your results. Please check your connection and try again.')
    }
  // `engineActive`/`engineAssessment` are dependencies, not incidentals: the
  // auto-submit path fires this from a timer through `submitRef`, and a stale
  // closure would pick the builder for a decision that no longer holds.
  }, [answers, questions, quiz, quizId, currentUser, mode, startTime, saveResult, navigate,
    engineActive, attemptAssessment])
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
        <ErrorState
          friendly={error}
          inline
          onRetry={() => window.location.reload()}
          onGoBack={() => navigate('/quizzes')}
        />
      </div>
    )
  }

  if (!started) {
    // The paywall redirect (navigate → /quizzes) leaves this effect via an
    // early return, but the `finally` above still flips `loading` off while
    // `quiz` is still null. React Router usually unmounts us before this
    // paints, but if navigation is deferred we'd render PreQuizCard against a
    // null quiz and crash on `quiz.subject`. Hold the loading visual until a
    // quiz is actually present.
    if (!quiz) {
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
  // An empty quiz (0 questions), a fully difficulty-filtered section list,
  // or a malformed doc would otherwise render a blank white screen with no
  // way out. Show a recoverable empty state instead.
  if (!activeSection) {
    return (
      <div className="theme-bg flex min-h-screen items-center justify-center px-4">
        <SeoHelmet title={quiz?.title || 'Quiz'} path={`/quiz/${quizId}`} noIndex />
        <div className="zx-card-shared p-8 text-center">
          <div className="mb-3 text-4xl">📭</div>
          <p className="font-bold theme-text">No questions available for this quiz.</p>
          <p className="theme-text-muted mt-1 text-sm">It may still be in progress or filtered out by your settings.</p>
          <button type="button" onClick={() => navigate('/quizzes')} className="zx-sb zx-sb-primary mt-4 text-sm">
            ← Back to quizzes
          </button>
        </div>
      </div>
    )
  }

  const answered = Object.keys(answers).length
  const progress = questions.length ? Math.round((answered / questions.length) * 100) : 0
  const warn = mode === 'exam' && timeLeft <= 60

  function renderQuestion(question) {
    const isRevealed = mode === 'practice' && revealed[question.id]
    const userAnswer = answers[question.id]
    // Null unless the engine is serving this whole attempt. The refusals in
    // `engineAssessment` mean this is either set for every question or for
    // none of them — a per-question mix is what the whole-quiz check prevents.
    const engineQuestion = engineActive ? engineQuestionsById.get(question.id) ?? null : null
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
              flagged[question.id] ? 'bg-amber-300 text-slate-900' : 'bg-white text-slate-400'
            }`}
            title={flagged[question.id] ? 'Remove bookmark' : 'Bookmark this question'}
            aria-label={flagged[question.id] ? 'Remove bookmark from this question' : 'Bookmark this question'}
            aria-pressed={Boolean(flagged[question.id])}
          >
            {/* Bookmark icon — filled when active */}
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
              fill={flagged[question.id] ? 'currentColor' : 'none'}
              stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
            </svg>
          </button>
        </div>

        {/* Legacy / null / 'above' renders the image and text as two direct
            children of the `space-y-4` card root — preserving the exact DOM
            and spacing every learner saw before this field was added. The
            non-default positions wrap them in a flex container that overrides
            the parent's vertical rhythm. */}
        {(() => {
          const pos = question.imagePosition
          // Diagram-label questions render their image WITH numbered markers
          // in the branch below, so suppress the plain figure here to avoid
          // showing the picture twice (once unmarked, once marked). This stays
          // a fact about THIS surface's answer input, not about the question,
          // which is why it is not in resolveQuestionFigure — the surfaces
          // with no diagram-label answer UI must still draw the figure.
          const figure = isDiagramLabelType(question.type)
            ? { kind: 'none' }
            : resolveQuestionFigure(question)
          const imageBlock = figure.kind === 'diagram' ? (
            <div className="overflow-hidden rounded-2xl border-2 border-slate-900 bg-slate-50 p-3">
              <DiagramSvg
                libraryKey={figure.libraryKey}
                params={figure.params}
                alt="Question diagram"
                className="mx-auto flex max-h-[80vh] w-full items-center justify-center"
              />
            </div>
          ) : figure.kind === 'image' ? (
            <div className="overflow-hidden rounded-2xl border-2 border-slate-900 bg-slate-50 p-3">
              <ZoomableImage
                src={figure.imageUrl}
                alt="Question illustration"
                fallbackText={question.diagramText}
                priority
                className="mx-auto max-h-[80vh] w-full rounded-xl object-contain"
              />
            </div>
          ) : null
          const textBlock = (
            <div>
              {question.sharedInstruction && (
                <div className="mb-3 rounded-2xl border-2 border-slate-900 bg-orange-50 px-3 py-2 leading-relaxed text-slate-900">
                  {/* Regular weight by default; only intentionally-bold/underlined/
                      highlighted words (rendered as marks) stand out. */}
                  <RichContent value={question.sharedInstruction} className="text-sm leading-relaxed" />
                </div>
              )}
              <div className="flex items-start gap-2">
                <RichContent value={question.text} className="question-text flex-1" />
                <TextToSpeechButton
                  id={`q:${question.id}`}
                  label="question"
                  getText={() => questionToReadAloudText(question)}
                  tts={readAloud}
                  className="mt-0.5 shrink-0"
                />
              </div>
              {question.diagramText && (
                // whitespace-pre-line preserves the newlines that PR #653
                // routes into diagramText for flattened-table data (Q4's
                // oranges table renders as separate rows instead of
                // collapsing every \n into a single space).
                <p className="mt-2 whitespace-pre-line rounded-xl bg-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-700">{question.diagramText}</p>
              )}
            </div>
          )
          const extraImages = <ExtraQuestionImages question={question} />
          if (!usesFigurePositionWrapper(pos, Boolean(imageBlock))) {
            return (
              <>
                {imageBlock}
                {extraImages}
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
              {extraImages}
            </>
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
                      decoding="async"
                      fetchPriority="high"
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
        })() : isDiagramLabelType(question.type) ? (() => {
          // Diagram-label branch — the learner types the name of each numbered
          // part on the image. Graded deterministically (no AI) against the
          // per-marker answer key; the response is a flat array aligned to the
          // gradeable markers in author order, which is exactly what
          // computeQuizScore → gradeDiagramLabels re-runs at submit time.
          const layout = diagramLabelLayout(question)
          const response = Array.isArray(answers[question.id]) ? answers[question.id] : []
          const dlResult = aiResults[question.id]
          const dlChecked = !!dlResult

          function setLabel(flatIndex, value) {
            setAnswers(current => {
              const prev = Array.isArray(current[question.id]) ? [...current[question.id]] : []
              prev[flatIndex] = value
              return { ...current, [question.id]: prev }
            })
            if (actionError) setActionError('')
            // Editing invalidates a prior check.
            if (dlChecked) {
              setAiResults(current => {
                const next = { ...current }
                delete next[question.id]
                return next
              })
            }
          }

          function checkDiagramLabels() {
            const result = gradeDiagramLabels(question, answers[question.id])
            setAiResults(current => ({
              ...current,
              [question.id]: {
                correct: result.allCorrect,
                perLabel: result.perLabel,
                feedback: result.allCorrect
                  ? '🌟 Every part labelled correctly!'
                  : `${result.correctLabels} of ${result.totalLabels} parts correct.`,
              },
            }))
            if (mode === 'practice') {
              setRevealed(current => ({ ...current, [question.id]: true }))
              setFeedbackType(result.allCorrect ? 'correct' : 'wrong')
              setTimeout(() => setFeedbackType(null), 1300)
            }
          }

          const anyTyped = response.some(v => String(v ?? '').trim())

          return (
            <div className="space-y-4">
              <div className={`overflow-hidden rounded-2xl border-2 bg-white shadow-[0_2px_0_#0F1B2D] ${dlChecked && mode === 'practice'
                ? dlResult.correct ? 'border-emerald-600' : 'border-orange-500'
                : 'border-slate-900'}`}>
                <div className="border-b-2 border-slate-900 bg-orange-50 px-4 py-2 text-sm font-bold text-slate-900">🏷️ Name each numbered part</div>
                <div className="p-3">
                  {question.imageUrl ? (
                    <div className="relative w-full overflow-hidden rounded-xl border-2 border-slate-200">
                      <img
                        src={question.imageUrl}
                        alt="Label the parts of this diagram"
                        draggable={false}
                        decoding="async"
                        fetchPriority="high"
                        className="block w-full select-none object-contain"
                      />
                      {layout.map(label => (
                        <span
                          key={label.number}
                          aria-hidden="true"
                          className="pointer-events-none absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-orange-500 text-xs font-black text-white shadow"
                          style={{ left: `${label.x * 100}%`, top: `${label.y * 100}%` }}
                        >
                          {label.number}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm font-bold text-orange-600">This diagram-label question is missing its image.</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {layout.map(label => {
                  const labelCorrect = dlChecked ? dlResult.perLabel?.[label.index] : null
                  // Accepted answers may list variants ("Vegetable/Vegetables");
                  // show just the first when revealing the expected label.
                  const expected = label.text.split(/\s*[/|]\s*/)[0]
                  return (
                    <div key={label.number} className="flex items-center gap-3">
                      <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full border-2 border-slate-900 bg-orange-50 text-sm font-black text-slate-900">{label.number}</span>
                      <input
                        type="text"
                        value={response[label.index] ?? ''}
                        onChange={event => setLabel(label.index, event.target.value)}
                        disabled={dlChecked && mode === 'practice'}
                        aria-label={`Name of part ${label.number}`}
                        placeholder="Type the name of this part…"
                        className={`flex-1 rounded-xl border-2 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none ${
                          labelCorrect === true ? 'border-emerald-600 text-emerald-700'
                            : labelCorrect === false ? 'border-orange-500 text-orange-700'
                              : 'border-slate-400 focus:border-[var(--accent)]'
                        }`}
                      />
                      {dlChecked && mode === 'practice' && labelCorrect === false && (
                        <span className="flex-shrink-0 text-xs font-bold text-emerald-700" title="Correct answer">{expected}</span>
                      )}
                    </div>
                  )
                })}
              </div>

              {!dlChecked && (
                <button
                  type="button"
                  onClick={checkDiagramLabels}
                  disabled={!anyTyped}
                  className="zx-sb zx-sb-primary w-full text-sm"
                >
                  {mode === 'exam' ? 'Save Answer' : 'Check My Answers'}
                </button>
              )}

              {dlChecked && mode === 'practice' && (
                <div className={`rounded-2xl border-2 p-4 ${dlResult.correct ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
                  <p className={`text-sm font-bold ${dlResult.correct ? 'text-green-900' : 'text-orange-900'}`}>{dlResult.feedback}</p>
                </div>
              )}
            </div>
          )
        })() : isFillBlanksType(question.type) ? (() => {
          // Fill-in-the-Blanks branch — each statement renders on its own line
          // with an input for every blank. Graded deterministically (no AI)
          // against the per-blank answer key; the learner response is a flat
          // array aligned to the blanks in statement reading order, which is
          // exactly what computeQuizScore → gradeFillBlanks expects.
          const layout = fillBlanksLayout(question)
          const wordBank = Array.isArray(question.wordBank) ? question.wordBank : []
          const response = Array.isArray(answers[question.id]) ? answers[question.id] : []
          const fbResult = aiResults[question.id]
          const fbChecked = !!fbResult

          function setBlank(flatIndex, value) {
            setAnswers(current => {
              const prev = Array.isArray(current[question.id]) ? [...current[question.id]] : []
              prev[flatIndex] = value
              return { ...current, [question.id]: prev }
            })
            if (actionError) setActionError('')
            // Editing invalidates a prior check.
            if (fbChecked) {
              setAiResults(current => {
                const next = { ...current }
                delete next[question.id]
                return next
              })
            }
          }

          function checkFillBlanks() {
            const result = gradeFillBlanks(question, answers[question.id])
            setAiResults(current => ({
              ...current,
              [question.id]: {
                correct: result.allCorrect,
                perBlank: result.perBlank,
                feedback: result.allCorrect
                  ? '🌟 All blanks correct!'
                  : `${result.correctBlanks} of ${result.totalBlanks} blanks correct.`,
              },
            }))
          }

          const anyTyped = response.some(v => String(v ?? '').trim())

          return (
            <div className="space-y-4">
              {wordBank.length > 0 && (
                <div className="rounded-2xl border-2 border-slate-900 bg-white p-3">
                  <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Word bank</p>
                  <div className="flex flex-wrap gap-2">
                    {wordBank.map((word, i) => (
                      <span key={`${i}:${word}`} className="rounded-full border-2 border-slate-300 bg-slate-50 px-3 py-1 text-sm font-bold text-slate-800">{word}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {layout.map(statement => (
                  <div key={statement.index} className="flex flex-wrap items-center gap-x-1 gap-y-2 text-base leading-relaxed text-slate-900">
                    <strong className="mr-1">{statement.label}.</strong>
                    {statement.segments.map((segment, segIndex) => {
                      const flatIndex = statement.startFlatIndex + segIndex
                      const blankCorrect = fbChecked ? fbResult.perBlank?.[flatIndex] : null
                      return (
                        <span key={segIndex} className="inline-flex flex-wrap items-center gap-1">
                          {/* A generated maths statement is rich HTML (its
                              fraction spans survive the blank split as text
                              segments), so a segment carrying markup renders
                              through RichContent; plain segments — every
                              legacy quiz — take exactly the old path. */}
                          {/* Tag-shaped only: "x < 5" in prose stays plain. */}
                          {segment && (/<[a-z!/]/i.test(String(segment))
                            ? <RichContent value={segment} fallback={<span>{getRichPlainText(segment)}</span>} />
                            : <span>{segment}</span>)}
                          {segIndex < statement.segments.length - 1 && (
                            <input
                              type="text"
                              value={response[flatIndex] ?? ''}
                              onChange={event => setBlank(flatIndex, event.target.value)}
                              disabled={fbChecked && mode === 'practice'}
                              aria-label={`Blank ${flatIndex + 1}`}
                              className={`mx-1 w-28 border-b-2 bg-transparent px-1 pb-0.5 text-center text-sm font-semibold text-slate-900 outline-none ${
                                blankCorrect === true ? 'border-emerald-600 text-emerald-700'
                                  : blankCorrect === false ? 'border-orange-500 text-orange-700'
                                    : 'border-slate-400 focus:border-[var(--accent)]'
                              }`}
                            />
                          )}
                        </span>
                      )
                    })}
                  </div>
                ))}
              </div>

              {!fbChecked && (
                <button
                  type="button"
                  onClick={checkFillBlanks}
                  disabled={!anyTyped}
                  className="zx-sb zx-sb-primary w-full text-sm"
                >
                  {mode === 'exam' ? 'Save Answer' : 'Check My Answers'}
                </button>
              )}

              {fbChecked && mode === 'practice' && (
                <div className={`rounded-2xl border-2 p-4 ${fbResult.correct ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
                  <p className={`text-sm font-bold ${fbResult.correct ? 'text-green-900' : 'text-orange-900'}`}>{fbResult.feedback}</p>
                </div>
              )}
            </div>
          )
        })() : isMatchingType(question.type) ? (() => {
          // Matching branch — each prompt (matchingLeft) gets a dropdown of the
          // right-column options. Graded deterministically (no AI) against
          // matchingAnswer via gradeMatching — exactly what computeQuizScore
          // re-runs at submit time. The learner response stored in
          // answers[qid] is a flat array: response[i] = chosen right-index for
          // left[i] (or -1 when unset).
          const left = Array.isArray(question.matchingLeft) ? question.matchingLeft : []
          const right = Array.isArray(question.matchingRight) ? question.matchingRight : []
          const response = Array.isArray(answers[question.id]) ? answers[question.id] : []
          const mResult = aiResults[question.id]
          const mChecked = !!mResult

          function setMatch(rowIndex, value) {
            setAnswers(current => {
              const prev = Array.isArray(current[question.id]) ? [...current[question.id]] : []
              prev[rowIndex] = value === '' ? -1 : Number(value)
              return { ...current, [question.id]: prev }
            })
            if (actionError) setActionError('')
            if (mChecked) {
              setAiResults(current => {
                const next = { ...current }
                delete next[question.id]
                return next
              })
            }
          }

          function checkMatching() {
            const result = gradeMatching(question, answers[question.id])
            setAiResults(current => ({
              ...current,
              [question.id]: {
                correct: result.allCorrect,
                perRow: result.perRow,
                feedback: result.allCorrect
                  ? '🌟 All matched correctly!'
                  : `${result.correctPairs} of ${result.totalPairs} matched correctly.`,
              },
            }))
            if (mode === 'practice') {
              setRevealed(current => ({ ...current, [question.id]: true }))
              setFeedbackType(result.allCorrect ? 'correct' : 'wrong')
              setTimeout(() => setFeedbackType(null), 1300)
            }
          }

          const anyMatched = response.some(v => Number.isInteger(v) && v >= 0)

          return (
            <div className="space-y-4">
              <div className="space-y-2">
                {left.map((prompt, rowIndex) => {
                  if (!String(prompt ?? '').trim()) return null
                  const rowCorrect = mChecked ? mResult.perRow?.[rowIndex] : null
                  const selected = Number.isInteger(response[rowIndex]) && response[rowIndex] >= 0 ? response[rowIndex] : ''
                  return (
                    <div key={rowIndex} className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-slate-900 bg-white p-3 shadow-[0_2px_0_#0F1B2D]">
                      {/* A prompt may be rich (a fraction to match); RichContent
                          draws it, and a plain string renders as before. */}
                      <span className="min-w-[7rem] flex-1 text-sm font-bold text-slate-900">
                        {typeof prompt === 'string' && !/<[a-z!/]/i.test(prompt)
                          ? prompt
                          : <RichContent value={prompt} fallback={<span>{getRichPlainText(prompt)}</span>} />}
                      </span>
                      <span aria-hidden="true" className="font-black text-slate-400">→</span>
                      <select
                        value={selected}
                        onChange={event => setMatch(rowIndex, event.target.value)}
                        disabled={mChecked && mode === 'practice'}
                        aria-label={`Match for ${typeof prompt === 'string' && prompt ? prompt : `prompt ${rowIndex + 1}`}`}
                        className={`min-w-[9rem] rounded-xl border-2 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none ${
                          rowCorrect === true ? 'border-emerald-600 text-emerald-700'
                            : rowCorrect === false ? 'border-orange-500 text-orange-700'
                              : 'border-slate-400 focus:border-[var(--accent)]'
                        }`}
                      >
                        <option value="">— choose —</option>
                        {/* A native <option> can only hold text, so a RICH
                            right-hand value shows its plain projection —
                            "1/32" — rather than the old "Option N", which hid
                            the choice entirely. */}
                        {right.map((opt, optIndex) => (
                          <option key={optIndex} value={optIndex}>
                            {typeof opt === 'string' && !/<[a-z!/]/i.test(opt) && !opt.startsWith('{')
                              ? opt
                              : (String(getRichPlainText(opt) || '').trim() || `Option ${optIndex + 1}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>

              {!mChecked && (
                <button
                  type="button"
                  onClick={checkMatching}
                  disabled={!anyMatched}
                  className="zx-sb zx-sb-primary w-full text-sm"
                >
                  {mode === 'exam' ? 'Save Answer' : 'Check My Answers'}
                </button>
              )}

              {mChecked && mode === 'practice' && (
                <div className={`rounded-2xl border-2 p-4 ${mResult.correct ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
                  <p className={`text-sm font-bold ${mResult.correct ? 'text-green-900' : 'text-orange-900'}`}>{mResult.feedback}</p>
                </div>
              )}
            </div>
          )
        })() : isSequenceType(question.type) ? (() => {
          // Sequence branch — the learner reorders the items with up/down
          // controls into the correct order. The working order stored in
          // answers[qid] is an array of item indices (a permutation of the
          // filled rows), seeded on load to the on-screen order. gradeSequence
          // re-grades it against sequenceAnswer at submit time.
          const items = Array.isArray(question.sequenceItems) ? question.sequenceItems : []
          const fallbackOrder = items
            .map((it, i) => (String(it ?? '').trim() ? i : -1))
            .filter(i => i >= 0)
          const order = Array.isArray(answers[question.id]) && answers[question.id].length
            ? answers[question.id]
            : fallbackOrder
          const sResult = aiResults[question.id]
          const sChecked = !!sResult

          function moveItem(position, direction) {
            const target = position + direction
            if (target < 0 || target >= order.length) return
            setAnswers(current => {
              const base = Array.isArray(current[question.id]) && current[question.id].length
                ? [...current[question.id]]
                : [...fallbackOrder]
              ;[base[position], base[target]] = [base[target], base[position]]
              return { ...current, [question.id]: base }
            })
            if (actionError) setActionError('')
            if (sChecked) {
              setAiResults(current => {
                const next = { ...current }
                delete next[question.id]
                return next
              })
            }
          }

          function checkSequence() {
            const result = gradeSequence(question, answers[question.id] ?? fallbackOrder)
            setAiResults(current => ({
              ...current,
              [question.id]: {
                correct: result.allCorrect,
                perItem: result.perItem,
                feedback: result.allCorrect
                  ? '🌟 Perfect order!'
                  : `${result.correctItems} of ${result.totalItems} in the right place.`,
              },
            }))
            if (mode === 'practice') {
              setRevealed(current => ({ ...current, [question.id]: true }))
              setFeedbackType(result.allCorrect ? 'correct' : 'wrong')
              setTimeout(() => setFeedbackType(null), 1300)
            }
          }

          return (
            <div className="space-y-4">
              <ol className="space-y-2">
                {order.map((itemIndex, position) => {
                  const itemCorrect = sChecked ? sResult.perItem?.[itemIndex] : null
                  return (
                    <li
                      key={itemIndex}
                      className={`flex items-center gap-3 rounded-2xl border-2 bg-white p-3 shadow-[0_2px_0_#0F1B2D] ${
                        itemCorrect === true ? 'border-emerald-600'
                          : itemCorrect === false ? 'border-orange-500'
                            : 'border-slate-900'
                      }`}
                    >
                      <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full border-2 border-slate-900 bg-orange-50 text-sm font-black text-slate-900">{position + 1}</span>
                      {/* A rich sequence item used to render as an EMPTY string —
                          the learner ordered blanks. Rich values render; plain
                          strings take exactly the old path. */}
                      <span className="flex-1 text-sm font-bold text-slate-900">
                        {typeof items[itemIndex] === 'string' && !/<[a-z!/]/i.test(String(items[itemIndex]))
                          ? items[itemIndex]
                          : <RichContent value={items[itemIndex]} fallback={<span>{getRichPlainText(items[itemIndex])}</span>} />}
                      </span>
                      <div className="flex flex-shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => moveItem(position, -1)}
                          disabled={position === 0 || (sChecked && mode === 'practice')}
                          aria-label={`Move "${typeof items[itemIndex] === 'string' ? items[itemIndex] : `item ${position + 1}`}" up`}
                          className="grid h-7 w-7 place-items-center rounded-lg border-2 border-slate-900 bg-white text-xs font-black text-slate-900 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => moveItem(position, 1)}
                          disabled={position === order.length - 1 || (sChecked && mode === 'practice')}
                          aria-label={`Move "${typeof items[itemIndex] === 'string' ? items[itemIndex] : `item ${position + 1}`}" down`}
                          className="grid h-7 w-7 place-items-center rounded-lg border-2 border-slate-900 bg-white text-xs font-black text-slate-900 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ol>

              {!sChecked && (
                <button
                  type="button"
                  onClick={checkSequence}
                  className="zx-sb zx-sb-primary w-full text-sm"
                >
                  {mode === 'exam' ? 'Save Answer' : 'Check My Order'}
                </button>
              )}

              {sChecked && mode === 'practice' && (
                <div className={`rounded-2xl border-2 p-4 ${sResult.correct ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
                  <p className={`text-sm font-bold ${sResult.correct ? 'text-green-900' : 'text-orange-900'}`}>{sResult.feedback}</p>
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
                  aria-label="Numeric answer"
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
              {(() => {
                // Essay answers are long-form, so they get a multi-line
                // textarea (Enter inserts a newline rather than submitting);
                // short_answer / diagram keep the single-line input with
                // Enter-to-check. Both share one change handler + the same
                // AI-marking path (checkShortAnswer).
                const isEssay = question.type === 'essay'
                const handleType = (value) => {
                  setShortText(current => ({ ...current, [question.id]: value }))
                  if (actionError) setActionError('')
                  if (mode === 'exam') {
                    // Exam mode: persist the raw text on every keystroke so a
                    // dropped connection can never lose the answer (the old
                    // path only saved it after a successful AI call, so an
                    // offline learner's typing vanished). The optional
                    // "Save Answer" button below still enriches it with an AI
                    // verdict for scoring when online.
                    setAnswers(current => {
                      const next = { ...current }
                      const trimmed = value.trim()
                      if (trimmed) next[question.id] = { text: trimmed }
                      else delete next[question.id]
                      return next
                    })
                    // Editing invalidates any prior AI verdict so scoring never
                    // uses a stale mark against changed text.
                    if (aiResults[question.id]) {
                      setAiResults(current => {
                        const next = { ...current }
                        delete next[question.id]
                        return next
                      })
                    }
                    return
                  }
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
                }
                return (
                  <div className={`gap-2 p-3 ${isEssay ? 'flex flex-col' : 'flex items-center'}`}>
                    {isEssay ? (
                      <textarea
                        value={typed}
                        onChange={event => handleType(event.target.value)}
                        disabled={checking}
                        rows={6}
                        placeholder="Write your answer here…"
                        aria-label="Your answer"
                        className="w-full resize-y bg-transparent text-base font-semibold leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    ) : (
                      <input
                        type="text"
                        value={typed}
                        onChange={event => handleType(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter' && typed.trim() && !checking && !checked) checkShortAnswer(question.id)
                        }}
                        disabled={checking}
                        placeholder="Type your answer here..."
                        aria-label="Your answer"
                        className="flex-1 bg-transparent text-base font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    )}
                    <div className={`flex items-center gap-2 ${isEssay ? 'self-end' : ''}`}>
                      {checking && <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />}
                      {checked && mode === 'practice' && <span className="text-xl">{aiResult.correct ? '✅' : '❌'}</span>}
                    </div>
                  </div>
                )
              })()}
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
        ) : (!Array.isArray(question.options) || question.options.length === 0) ? (
          // Defensive: every authorable type now has its own branch above, so
          // this only fires for malformed data (e.g. an MCQ that lost its
          // options). Show a clear notice instead of crashing on .map of an
          // empty array or rendering a blank, unanswerable option grid.
          <div className="rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50 p-4 text-sm font-bold text-orange-700">
            ⚠️ This question can’t be displayed right now. Please let your teacher know so they can fix it.
          </div>
        ) : (
          <div className="space-y-4">
            {readAloud.enabled && (
              <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                <span>Answer options</span>
                <TextToSpeechButton
                  id={`opts:${question.id}`}
                  label="answer options"
                  getText={() => optionsToReadAloudText(question.options)}
                  tts={readAloud}
                />
              </div>
            )}
            {/* The cutover's flag boundary (docs/phase3-plan.md §5.0): the
                CHOICE CARD is the engine's or the old runner's, never a mix.
                `data-engine-runner` is how a spec — and a bug report — tells
                the two apart. */}
            {engineQuestion ? (
              <div data-engine-runner="quiz">
                <ChoiceQuestion
                  question={engineQuestion}
                  answer={userAnswer ?? null}
                  revealed={isRevealed}
                  onAnswer={(optionIndex) => !isRevealed && pick(question.id, optionIndex)}
                />
              </div>
            ) : (
              <div className="opt-grid">
                {question.options.map((option, optionIndex) => {
                  const media = Array.isArray(question.optionMedia) ? question.optionMedia[optionIndex] : null
                  return (
                    <OptionButton
                      key={`${question.id}-${optionIndex}`}
                      label={optionLabel(optionIndex)}
                      // UNGATED by `isRevealed`, as of the §10.0 decision on
                      // the `selected` divergence (docs/phase3-plan.md). This
                      // card used to clear the selection on reveal and was the
                      // only one of the three that did — `PublicQuizRunner`'s
                      // card and the engine's `buildChoiceRows` both keep it,
                      // and both DERIVE the ✗ from it, so clearing it there
                      // would delete the wrong-answer marker outright. This
                      // card can clear it only because it takes `wrong` as a
                      // separate prop, which is a difference in wiring rather
                      // than a decision anyone made.
                      selected={userAnswer === optionIndex}
                      revealed={isRevealed}
                      correct={isRevealed && optionIndex === question.correctAnswer}
                      wrong={isRevealed && userAnswer === optionIndex && userAnswer !== question.correctAnswer}
                      onClick={() => !isRevealed && pick(question.id, optionIndex)}
                      imageUrl={media?.imageUrl}
                      imageAlt={media?.alt}
                      diagram={media?.diagram}
                      optionValue={option}
                    >
                      {/* Fallback text content for assistive tech + legacy
                          paths that don't read `optionValue` rich content. */}
                      {typeof option === 'string' ? option : (getRichPlainText(option) || '')}
                    </OptionButton>
                  )
                })}
              </div>
            )}

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
                      <p className="mt-1 text-sm text-green-700">The answer is <strong><RichContent value={question.options[question.correctAnswer]} className="rich-option" fallback={<span />} /></strong></p>
                    </>
                  ) : userAnswer === undefined ? (
                    <>
                      <p className="theme-text text-lg font-black">⏭️ Skipped</p>
                      <p className="theme-text-muted mt-1 text-sm">Correct: <strong><RichContent value={question.options[question.correctAnswer]} className="rich-option" fallback={<span />} /></strong></p>
                    </>
                  ) : (
                    <>
                      <p className="text-lg font-black text-orange-700">💡 Not quite — you can do it!</p>
                      <p className="mt-1 text-sm text-orange-700">Correct answer: <strong><RichContent value={question.options[question.correctAnswer]} className="rich-option" fallback={<span />} /></strong></p>
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
  // Reading-preference scope: data-quiz-* attrs + CSS custom properties. The
  // `quiz-shell` class returned by the resolver is dropped here so the reading
  // theme/size apply without forcing the shell's max-width on the full runner.
  const { className: _quizShellClass, style: quizDisplayStyle, ...quizDisplayAttrs } = quizDisplayVars

  return (
    <div
      className={`${themeClass} theme-bg theme-text min-h-screen`}
      style={quizDisplayStyle}
      {...quizDisplayAttrs}
    >
      <SeoHelmet title={quiz?.title || 'Quiz'} path={`/quiz/${quizId}`} noIndex />
      <ReadingSettingsSheet
        open={showReadingSettings}
        onClose={() => setShowReadingSettings(false)}
        prefs={quizDisplayPrefs}
        setPref={setQuizDisplayPref}
        resetPrefs={resetQuizDisplayPrefs}
        saving={savingDisplayPrefs}
      />
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

      {/* Pre-submit review: every question's answered/unanswered/bookmarked
          state (plus correct/incorrect for feedback already revealed in
          practice mode — never in exam mode), with filters, tap-to-jump, and
          the Finish button. Jumps from here are unrestricted, unlike the
          forward-blocking section dots — going back to a bookmarked or
          skipped question is the whole point of reviewing. */}
      <QuizReviewScreen
        open={showSubmit}
        onClose={() => setShowSubmit(false)}
        onJumpToSection={setActiveSectionIndex}
        onFinish={() => handleSubmit(false)}
        submitting={submitting}
        sections={sections}
        answers={answers}
        flagged={flagged}
        revealed={mode === 'practice' ? revealed : {}}
        aiResults={aiResults}
      />

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
              <ReadingThemePicker surface="quiz" />
              <ReadingSettingsButton onClick={() => setShowReadingSettings(true)} />
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
            <div id="quiz-passage-card" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
              <PassageViewer
                passage={activeSection.passage}
                questionCount={activeSection.questions.length}
                ttsId={`passage:${activeSectionIndex}`}
                tts={readAloud}
                showLineNumbers={quizDisplayPrefs.showPassageLineNumbers}
                keepOpen={quizDisplayPrefs.keepPassageOpen}
              />
            </div>
            <div className="min-w-0 space-y-4">
              {/* On mobile the passage sits above the questions — this jumps the
                  learner back to it without losing their place in the question. */}
              <button
                type="button"
                onClick={() => document.getElementById('quiz-passage-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="zx-pill-dark zx-pill-light lg:hidden"
              >
                ↑ Back to passage
              </button>
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
                    onClick={() => setActiveSectionIndex(index)}
                    title={`Section ${index + 1}${complete ? ' ✓' : ''}${flaggedSection ? ' 🚩' : ''}`}
                    className="min-h-0 flex-1 rounded-full border-2 border-slate-900 transition-all"
                    style={{
                      height: 10,
                      background: current ? '#D97757' : flaggedSection ? '#FBBF24' : complete ? '#10B981' : '#fff',
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

          {/* Learners can move freely: forward navigation is never blocked on
              answering the current question (they can skip/defer and come back
              via the section dots), and Submit is always reachable so a
              practice session — which has no timer — can never dead-end. The
              submit modal still warns about any unanswered questions. */}
          <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <button type="button" onClick={() => setActiveSectionIndex(index => Math.max(0, index - 1))} disabled={activeSectionIndex === 0} className="zx-sb zx-sb-secondary flex-1 px-3 text-sm sm:flex-none sm:px-4">
              ← Prev
            </button>
            <div className="flex flex-1 gap-2 sm:flex-none">
              <button type="button" onClick={() => setShowSubmit(true)} className="zx-sb zx-sb-amber flex-1 px-3 text-sm sm:flex-none sm:px-4">
                Submit 🏁
              </button>
              {activeSectionIndex < sections.length - 1 && (
                <button
                  type="button"
                  onClick={() => setActiveSectionIndex(index => Math.min(sections.length - 1, index + 1))}
                  className="zx-sb zx-sb-primary flex-1 px-3 text-sm sm:flex-none sm:px-4"
                >
                  Next →
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
