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

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { hasPremiumAccess } from '../../utils/subscriptionConfig'
import { getPaperById } from '../../utils/pastPapers'
import {
  FREE_QUESTION_LIMIT,
  getAnsweredCount,
  hasReachedFreeLimit,
  loadPublicQuiz,
  recordAnsweredQuestion,
  resetCounter,
} from '../../utils/pastPaperQuiz'
import { paywall } from '../../utils/paywall'
import { SUBJECTS } from '../../config/curriculum'
import SeoHelmet from '../seo/SeoHelmet'
import Logo from '../ui/Logo'
import Skeleton from '../ui/Skeleton'
import RichContent, { getRichPlainText } from '../../editor/RichContent'
import DiagramSvg from '../diagrams/DiagramSvg'
import ZoomableImage from '../quiz/ZoomableImage'

function plainTextFromQuestion(q) {
  // Prefer Tiptap JSON, fall back to legacy HTML/plain text.
  return getRichPlainText(q?.textJSON ?? q?.text ?? '') || q?.text || ''
}

function plainTextFromOption(opt) {
  if (opt == null) return ''
  if (typeof opt === 'string') return opt
  if (typeof opt === 'object') {
    return getRichPlainText(opt.textJSON ?? opt.text ?? '') || opt.text || ''
  }
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
    const target = question.correctAnswer.trim().toLowerCase()
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

function OptionButton({ label, index, selected, revealed, correct, onClick, disabled, imageUrl, diagram }) {
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
      className={`w-full text-left px-4 py-3 rounded-radius-md flex items-start gap-3 font-bold text-sm transition-colors disabled:cursor-not-allowed ${cls}`}
    >
      <span className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-black bg-white/30 border border-current">
        {String.fromCharCode(65 + index)}
      </span>
      <span className="flex-1 min-w-0">
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
        {label && <span className="block whitespace-pre-wrap">{label}</span>}
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
        if (!p.quizId) {
          setError('This paper does not have a quiz yet.')
          return
        }
        const payload = await loadPublicQuiz(p.quizId)
        if (cancelled) return
        if (!payload) {
          setError('The quiz for this paper is not available right now.')
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
  const subjectMeta = paper && SUBJECTS.find((s) => s.id === paper.subject)

  function handleSelect(idx) {
    if (revealed) return
    setSelection(idx)
  }

  function handleCheck() {
    if (selection == null || !question || revealed) return
    setRevealed(true)
    const correct = isCorrectChoice(question, selection)
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

  return (
    <div className="min-h-screen theme-bg pb-24">
      <SeoHelmet
        title={`${paper.title} — past-paper quiz`}
        description={`Practise ${paper.title} (${paper.year || ''}) with instant feedback. Free preview, no sign-up required.`}
        path={`/papers/${paperId}/quiz`}
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
            <div className="flex items-center justify-between text-xs font-black mb-2">
              <span className="theme-text-muted uppercase tracking-widest">
                Question {currentIndex + 1} of {total}
              </span>
              <span className="theme-text-muted">
                Score {score}
              </span>
            </div>
            <Progress value={currentIndex + (revealed ? 1 : 0)} max={total} />
          </div>

          {/* Stem image / diagram — mirrors the editor preview. Library
              diagrams (imageDiagram.libraryKey) win; uploaded photos
              (imageUrl) are the fallback. Without this block the
              trapezium/figure questions show only their text and the
              learner can't actually answer them. */}
          {question.imageDiagram?.libraryKey ? (
            <div className="overflow-hidden rounded-radius-md border theme-border bg-white p-3">
              <DiagramSvg
                libraryKey={question.imageDiagram.libraryKey}
                params={question.imageDiagram.params}
                alt="Question diagram"
                className="mx-auto flex max-h-[60vh] w-full items-center justify-center"
              />
            </div>
          ) : question.imageUrl ? (
            <div className="overflow-hidden rounded-radius-md border theme-border bg-white p-3">
              <ZoomableImage
                src={question.imageUrl}
                alt="Question illustration"
                fallbackText={question.diagramText}
                className="mx-auto max-h-[60vh] w-full rounded-xl object-contain"
              />
            </div>
          ) : null}
          {question.diagramText && !question.imageDiagram?.libraryKey && !question.imageUrl && (
            <p className="whitespace-pre-line rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold leading-relaxed text-slate-700">
              {question.diagramText}
            </p>
          )}

          {/* Question prompt */}
          <div className="theme-text font-black text-base sm:text-lg leading-snug">
            {question.textJSON
              ? <RichContent value={question.textJSON} fallback={<p>{plainTextFromQuestion(question)}</p>} />
              : <p>{plainTextFromQuestion(question)}</p>}
          </div>

          {/* Options */}
          <div className="space-y-2.5">
            {options.map((opt, idx) => {
              const label = plainTextFromOption(opt)
              const optObj = (opt && typeof opt === 'object') ? opt : null
              return (
                <OptionButton
                  key={idx}
                  index={idx}
                  label={label}
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

          {/* Explanation after reveal */}
          {revealed && (question.explanation || question.explanationJSON) && (
            <div className="theme-bg-subtle border-l-4 theme-accent-border rounded-r-radius-md p-4">
              <p className="text-xs font-black theme-accent-text uppercase tracking-widest mb-1">
                Explanation
              </p>
              <div className="theme-text text-sm">
                {question.explanationJSON
                  ? <RichContent value={question.explanationJSON} fallback={<p>{getRichPlainText(question.explanation) || question.explanation}</p>} />
                  : <p>{getRichPlainText(question.explanation) || question.explanation}</p>}
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
