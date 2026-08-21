/**
 * §2 and §3 — the runner. One component, two modes.
 *
 * The chrome is shared and the DIFFERENCES are all data-driven off
 * `MODE_RULES`: the clock renders when the mode has one, the review grid when
 * navigation is free, the coaching panel when feedback is instant. Two
 * components would have been easier to write and would have drifted by the
 * second change — an exam and a practice run are the same paper and have to
 * feel like it.
 *
 * ── The three things this screen guarantees ──────────────────────────────
 *
 * 1. **The clock is never counted down.** `secondsLeft` is recomputed from the
 *    attempt's `expiresAt` on every tick and on every wake. A phone that slept
 *    for twenty minutes wakes to a clock twenty minutes shorter, because that
 *    is what happened.
 * 2. **Answers persist as they are given.** Every tap writes locally and
 *    debounces to the server. Nothing is held in memory until submit.
 * 3. **Only the exit sheet ends an exam.** `beforeunload` warns; going through
 *    with it lands back here. Backgrounding, rotating and reloading all
 *    resume.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { QUIZ_MODE, isExam } from '../lib/quizModes'
import { formatClock, remainingSeconds, timerTone } from '../lib/examClock'
import { buildGrid, gridSummary, isLastQuestion, nextIndex, prevIndex, submitSheetLines } from '../lib/reviewGrid'
import { resolveCoaching, shouldCelebrateStreak } from '../lib/coaching'
import { correctIndexOf } from '../lib/answerKey'
import QuestionCard from './QuestionCard'
import CoachingPanel from './CoachingPanel'
import { Confetti, StreakPop } from './Celebration'
import { ExitSheet, ReviewGridSheet, SubmitSheet } from './QuizSheets'
import { IconAa, IconBack, IconClock, IconFlag, IconGrid, IconNext, IconPrev } from './QuizIcons'

const FONT_STEPS = [1, 1.15, 1.3, 0.9]

/**
 * The live clock.
 *
 * Its own component so the whole runner does not re-render once a second —
 * on a 60-question paper that would re-render every option row sixty times a
 * minute on a phone that cannot spare it.
 */
function ExamClock({ expiresAtMs, offsetMs, onExpire }) {
  const [seconds, setSeconds] = useState(() => remainingSeconds({ expiresAtMs, nowMs: Date.now(), offsetMs }))
  const firedRef = useRef(false)

  useEffect(() => {
    function read() {
      const left = remainingSeconds({ expiresAtMs, nowMs: Date.now(), offsetMs })
      setSeconds(left)
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true
        onExpire()
      }
    }
    read()
    const id = setInterval(read, 1000)
    // A backgrounded tab throttles its timers to once a minute or stops them
    // outright. Reading again on wake is what stops a learner returning to a
    // clock that says what it said when they left.
    document.addEventListener('visibilitychange', read)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', read)
    }
  }, [expiresAtMs, offsetMs, onExpire])

  const tone = timerTone(seconds)
  return (
    <div
      className={`pq-timer ${tone === 'warn' ? 'is-warn' : tone === 'danger' ? 'is-danger' : ''}`}
      role="timer"
      aria-live="off"
      aria-label={`${Math.floor(seconds / 60)} minutes left`}
    >
      <IconClock size={15} />
      <span>{formatClock(seconds)}</span>
    </div>
  )
}

export default function QuizRunner({
  mode,
  questions,
  attempt,
  clockOffsetMs,
  answers,
  flags,
  revealed,
  strictForward,
  currentIndex,
  resumed,
  readAloud,
  submitting,
  onChoose,
  onNavigate,
  onToggleFlag,
  onSubmit,
  onAbandon,
  onSwitchToPractice,
  onExit,
}) {
  const [fontStep, setFontStep] = useState(0)
  const [sheet, setSheet] = useState(null)
  const [shakingIndex, setShakingIndex] = useState(null)
  const [celebrateToken, setCelebrateToken] = useState(0)
  const [streak, setStreak] = useState(0)
  const [showResumed, setShowResumed] = useState(resumed)
  const scrollRef = useRef(null)

  const exam = isExam(mode)
  const total = questions.length
  const question = questions[currentIndex] || null
  const chosen = question ? answers[question.id] : null
  const isRevealed = Boolean(question && revealed[question.id])

  // Practice holds the key (§5.4), so it can resolve it. Exam mode was handed
  // stripped questions, so this is null there — which is exactly the property
  // that makes "the client physically cannot show the answer early" true of
  // the code and not only of the intention.
  const correctIndex = useMemo(
    () => (isRevealed && question ? correctIndexOf(question) : null),
    [isRevealed, question],
  )

  const cells = useMemo(
    () => buildGrid({ questions, answers, flags, currentIndex }),
    [questions, answers, flags, currentIndex],
  )
  const summary = useMemo(() => gridSummary(cells), [cells])
  const last = isLastQuestion({ currentIndex, total })

  const coaching = useMemo(() => {
    if (!exam && isRevealed && question) {
      return resolveCoaching({ question, selectedIndex: chosen, correctIndex })
    }
    return null
  }, [exam, isRevealed, question, chosen, correctIndex])

  // The resume banner fades rather than persisting: it answers one question
  // ("did I lose my exam?") and then it is clutter on a screen that needs none.
  useEffect(() => {
    if (!resumed) return undefined
    setShowResumed(true)
    const t = setTimeout(() => setShowResumed(false), 4200)
    return () => clearTimeout(t)
  }, [resumed])

  // Scroll to the top of the question on every move. Without it a learner who
  // scrolled to the bottom of question 12's options lands at the bottom of
  // question 13's, which reads as the app having skipped one.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0, behavior: 'auto' })
  }, [currentIndex])

  /**
   * §1 — a MANUAL refresh gets a confirm, "a chance to cancel the accident".
   * Going through with it still lands back in the exam. Warned, not punished.
   */
  useEffect(() => {
    if (!exam) return undefined
    function onBeforeUnload(e) {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [exam])

  const handleChoose = useCallback((index) => {
    if (!question) return
    if (isRevealed) return
    const wasCorrect = onChoose(question, index)
    if (exam) return
    // Practice: the option locks and the coaching opens. A correct answer
    // celebrates; a wrong one shakes once and stops (§3).
    if (wasCorrect) {
      setStreak((s) => {
        const next = s + 1
        if (shouldCelebrateStreak(next)) setCelebrateToken((t) => t + 1)
        return next
      })
      setCelebrateToken((t) => t + 1)
    } else {
      setStreak(0)
      setShakingIndex(index)
      setTimeout(() => setShakingIndex(null), 480)
    }
  }, [question, isRevealed, onChoose, exam])

  const goTo = useCallback((index) => {
    onNavigate(Math.max(0, Math.min(total - 1, index)))
  }, [onNavigate, total])

  const handleExit = useCallback(() => {
    if (exam) setSheet('exit')
    else onExit()
  }, [exam, onExit])

  const pct = total > 0 ? (currentIndex / total) * 100 : 0

  return (
    <div className="pq" style={{ '--pq-fs': FONT_STEPS[fontStep] }}>
      <div className="pq-runner">
        {/* The sheet. On a phone it is the whole screen and this wrapper
            costs nothing; on a large screen it is a bounded page of the
            paper, centred on the backdrop. `.pq-runner` is `position:
            fixed; inset: 0`, so without it the chrome is nailed to the
            viewport's own corners: on a tall window four options sat at
            the top and Next sat five hundred pixels below the last of
            them, with nothing in between. The sheet keeps a FIXED height
            rather than hugging its content, because the header and the
            Next button have to stay where the learner last tapped them
            across sixty questions of wildly different lengths. */}
        <div className="pq-runner-sheet">
          <div className="pq-runner-top">
            <button type="button" className="pq-icon-btn is-ghost" onClick={handleExit} aria-label={exam ? 'Leave the exam' : 'Leave practice'}>
              <IconBack size={20} />
            </button>
            {exam && attempt?.expiresAtMs ? (
              <ExamClock
                expiresAtMs={attempt.expiresAtMs}
                offsetMs={clockOffsetMs}
                onExpire={() => onSubmit({ reason: 'timeup' })}
              />
            ) : (
              <div className="pq-mode-pill is-practice">Practice</div>
            )}
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="pq-icon-btn is-ghost"
              onClick={() => setFontStep((s) => (s + 1) % FONT_STEPS.length)}
              aria-label="Change the text size"
            >
              <IconAa size={19} />
            </button>
            {exam && (
              <button type="button" className="pq-icon-btn is-ghost" onClick={() => setSheet('grid')} aria-label="Review all questions">
                <IconGrid size={19} />
              </button>
            )}
          </div>

          <div className="pq-progress-track">
            <div className="pq-progress-fill" style={{ width: `${pct}%` }} />
          </div>

          {showResumed && (
            <div className="pq-resume-banner" role="status">
              <IconClock size={16} />
              {exam ? 'Welcome back — your exam is still running.' : 'Welcome back — carrying on where you left off.'}
            </div>
          )}

          <div className="pq-qmeta">
            <span>{`Question ${currentIndex + 1} of ${total}`}</span>
            {question?.section ? <><span aria-hidden="true">·</span><span className="pq-part">{question.section}</span></> : null}
            {exam && question && (
              <button
                type="button"
                className="pq-flag-btn"
                aria-pressed={flags[question.id] === true}
                onClick={() => onToggleFlag(question.id)}
              >
                <IconFlag size={13} />
                {flags[question.id] ? 'Flagged' : 'Flag'}
              </button>
            )}
          </div>

          <div className="pq-qscroll" ref={scrollRef}>
            <QuestionCard
              question={question}
              index={currentIndex}
              chosen={chosen}
              revealed={isRevealed}
              correctIndex={correctIndex}
              onChoose={handleChoose}
              shakingIndex={shakingIndex}
              readAloud={readAloud}
            />
            {coaching && (
              <div className="pq-qwrap">
                <CoachingPanel
                  coaching={coaching}
                  seed={currentIndex}
                  noteHref={coaching.noteRef ? `/notes?topic=${encodeURIComponent(coaching.noteRef)}` : ''}
                  gameHref={coaching.gameSlug ? `/games/${encodeURIComponent(coaching.gameSlug)}` : ''}
                  gameLabel={coaching.gameSlug ? coaching.gameSlug.replace(/-/g, ' ') : ''}
                />
              </div>
            )}
          </div>

          <div className="pq-runner-foot">
            <div className="pq-foot-inner">
              {exam ? (
                <>
                  {prevIndex({ currentIndex, strictForward }) != null && (
                    <button type="button" className="pq-nav-btn" onClick={() => goTo(currentIndex - 1)}>
                      <IconPrev size={18} />
                      Back
                    </button>
                  )}
                  {last ? (
                    <button type="button" className="pq-nav-btn is-finish" onClick={() => setSheet('submit')}>
                      Finish and submit
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pq-nav-btn is-primary"
                      onClick={() => goTo(nextIndex({ currentIndex, total, strictForward }))}
                    >
                      Next
                      <IconNext size={18} />
                    </button>
                  )}
                </>
              ) : isRevealed ? (
                <button
                  type="button"
                  className={`pq-nav-btn ${last ? 'is-finish' : 'is-primary'}`}
                  onClick={() => (last ? onSubmit({ reason: 'completed' }) : goTo(currentIndex + 1))}
                  disabled={submitting}
                >
                  {last ? (submitting ? 'Marking…' : 'See how you did') : 'Continue'}
                  <IconNext size={18} />
                </button>
              ) : (
                <div className="pq-hint-foot">Tap the answer you think is right</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Confetti token={celebrateToken} />
      <StreakPop streak={streak} token={shouldCelebrateStreak(streak) ? celebrateToken : 0} />

      {sheet === 'grid' && (
        <ReviewGridSheet
          cells={cells}
          summary={summary}
          currentIndex={currentIndex}
          onJump={(i) => { setSheet(null); goTo(i) }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'submit' && (
        <SubmitSheet
          summary={summary}
          lines={submitSheetLines(summary)}
          secondsLeft={remainingSeconds({ expiresAtMs: attempt?.expiresAtMs, nowMs: Date.now(), offsetMs: clockOffsetMs })}
          showClock={exam && Boolean(attempt?.expiresAtMs)}
          submitting={submitting}
          onGoToBlank={(i) => { setSheet(null); goTo(i) }}
          onSubmit={() => { setSheet(null); onSubmit({ reason: 'submitted' }) }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'exit' && (
        <ExitSheet
          answered={summary.answered}
          total={total}
          onStay={() => setSheet(null)}
          onSwitchToPractice={() => { setSheet(null); onSwitchToPractice() }}
          onLeave={() => { setSheet(null); onAbandon() }}
        />
      )}
    </div>
  )
}

QuizRunner.MODE = QUIZ_MODE
