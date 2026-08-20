/**
 * DailyQuizPage — the five-a-day runner at `/daily`.
 *
 * One page, three states (intro → question/feedback → result), because the
 * whole thing is five questions long and a route change between each would
 * cost a chunk load in the middle of a child's turn.
 *
 * ── Two things here are decisions, not styling ───────────────────────
 *
 * 1. FEEDBACK IS IMMEDIATE, AND IT IS THE SERVER'S. Tapping an option marks
 *    that one question — `answerDailyQuizQuestion` returns whether it was
 *    right and one line of why. The client never holds the answer key and so
 *    never marks anything itself; the key for a question comes back only
 *    once the learner has committed to an answer for it, which leaks
 *    nothing. Answers are final: a repeat call returns the recorded verdict
 *    rather than re-marking, so nobody can walk the options.
 *
 *    Yes, answers will circulate between friends. That is fine — the daily
 *    quiz is a social habit, not an assessment, and nothing here feeds a
 *    report card.
 *
 * 2. THERE IS NO COUNTDOWN. Elapsed time is measured and sent, but only as
 *    the leaderboard's tie-break between learners on equal points. The child
 *    never sees a clock — the games rule.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTodaysQuiz, answerDailyQuizQuestion } from '../services/dailyQuizService'
import { buildPips, buildResultSummary, canPlay } from '../lib/dailyQuizCore'
import { optionLabel } from '../../../utils/mcqChoices'
// The bank stores a question's stem, its options and its explanation in
// whatever shape the editor that authored it produced: a plain string, legacy
// HTML, or a *stringified* Tiptap doc. RichContent renders all three (and
// hydrates KaTeX); getRichPlainText reads the same three as text. Rendering the
// stored value directly is how `{"type":"doc",...}` reached a learner's screen.
//
// Which of the two a surface gets is decided by whether it is TAPPED — see the
// option list below.
import RichContent, { getRichPlainText } from '../../../editor/RichContent'
import { capture } from '../../../utils/analytics'
import '../dailyQuiz.css'

export default function DailyQuizPage() {
  const navigate = useNavigate()
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [started, setStarted] = useState(false)
  const [index, setIndex] = useState(0)
  // marks[i] is 1 / 0 once question i has been answered, undefined before —
  // the distinction the pips depend on.
  const [marks, setMarks] = useState([])
  const [feedback, setFeedback] = useState(null)
  const [chosen, setChosen] = useState({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const startedAt = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getTodaysQuiz()
      setPayload(data)
      // A learner who already played lands straight on their result rather
      // than on an intro offering a run that would be refused.
      if (data?.alreadyPlayed && data.result) setResult(data.result)
    } catch (err) {
      console.error('daily quiz load failed', err)
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { capture('daily_quiz_opened') }, [])

  const questions = useMemo(() => payload?.questions || [], [payload])
  const summary = useMemo(() => buildResultSummary(result), [result])

  const begin = () => {
    startedAt.current = Date.now()
    setStarted(true)
    setIndex(0)
    setMarks([])
    setChosen({})
    setFeedback(null)
    capture('daily_quiz_started', { ranked: Boolean(payload?.ranked) })
  }

  const choose = async (question, optionIndex) => {
    // One answer per question, and it is final — the same contract the
    // server enforces. Re-answering would let a learner walk the options.
    if (feedback || busy) return
    setChosen((prev) => ({ ...prev, [question.id]: optionIndex }))

    // A practice set is never scored server-side (the server refuses), so
    // it advances with no verdict rather than surfacing an error to a child
    // who did nothing wrong.
    if (!payload?.ranked) {
      setFeedback({ practice: true })
      return
    }

    setBusy(true)
    try {
      const res = await answerDailyQuizQuestion({
        questionId: question.id,
        chosen: optionIndex,
        elapsedMs: startedAt.current ? Date.now() - startedAt.current : 0,
      })
      setFeedback(res)
      setMarks((prev) => {
        const next = [...prev]
        next[index] = res?.correct ? 1 : 0
        return next
      })
      if (res?.finalised && res.result) {
        // The last answer finalises the attempt, so the result arrives with
        // it — there is no separate submit to lose.
        setResult(res.result)
        capture('daily_quiz_submitted', {
          points: res.result.points ?? 0,
          ranked: Boolean(res.result.ranked),
        })
      }
    } catch (err) {
      console.error('daily quiz answer failed', err)
      // Let the learner retry this one question rather than losing the run.
      setChosen((prev) => {
        const next = { ...prev }
        delete next[question.id]
        return next
      })
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const advance = () => {
    setFeedback(null)
    if (index < questions.length - 1) setIndex((i) => i + 1)
  }

  if (loading) {
    return <div className="dq"><div className="dq-card">Loading today’s quiz…</div></div>
  }

  if (result && summary) {
    return <ResultView summary={summary} result={result} questions={questions} navigate={navigate} />
  }

  // An honest failure, with a way out. Never "no quiz today".
  if (error && !started) {
    return (
      <div className="dq">
        <div className="dq-card">
          <div className="dq-kicker">Today’s Quiz</div>
          <p style={{ margin: '0 0 4px', fontWeight: 800 }}>We couldn’t load it just now.</p>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--lhx-muted)' }}>
            Check your connection and try again.
          </p>
          <button type="button" className="dq-btn dq-btn-indigo" onClick={load}>Try again</button>
          <button type="button" className="dq-btn dq-btn-ghost" onClick={() => navigate('/dashboard')}>
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (!started) return <IntroView payload={payload} onStart={begin} navigate={navigate} />

  const q = questions[index]
  const picked = chosen[q.id]
  const answered = picked !== undefined
  const isLast = index === questions.length - 1

  return (
    <div className="dq">
      <div className="dq-pips" aria-hidden="true">
        {buildPips(questions.length, marks, index).map((state, i) => (
          <span key={i} className={`dq-pip is-${state}`} />
        ))}
      </div>

      <div className="dq-card">
        <div className="dq-qhead">
          <span className="dq-subject">{q.subject}</span>
          <span className="dq-qnum">Question {index + 1} of {questions.length}</span>
        </div>
        <div className="dq-stem">
          <RichContent value={q.text} fallback={<span />} />
        </div>

        <div className="dq-opts" role="group" aria-label={`Question ${index + 1} options`}>
          {q.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              className={`dq-opt${optionClass(feedback, picked, i)}`}
              disabled={answered || busy}
              onClick={() => choose(q, i)}
            >
              <span className="dq-opt-letter">{optionLabel(i)}</span>
              {/* An option is FLATTENED rather than rendered, and that is about
                  the tap and not about the text. RichContent paints plain text
                  first and replaces its own element once the renderer has
                  loaded — a swap that is invisible on a page but not under a
                  finger, because the node being tapped is gone by the time the
                  tap lands. A stem can afford that; a button cannot. What is
                  given up is a stacked fraction inside a four-option list; the
                  extractor still reads maths leaves as "1/32". */}
              <span className="dq-opt-text">{getRichPlainText(opt)}</span>
            </button>
          ))}
        </div>

        {feedback && !feedback.practice && (
          <div className={`dq-fb ${feedback.correct ? 'is-correct' : 'is-wrong'}`} role="status">
            <div className="dq-fb-title">
              {feedback.voided
                ? 'This question was removed'
                : feedback.correct ? 'Correct · +10 points' : 'Not this time'}
            </div>
            {feedback.voided
              ? 'Everyone gets the points for it.'
              : hasRichText(feedback.explanation)
                ? <RichContent value={feedback.explanation} fallback={<span />} />
                : feedback.correct ? 'Nicely done.' : 'Have another look at this one later.'}
          </div>
        )}
        {feedback?.practice && (
          <div className="dq-fb is-correct" role="status">
            <div className="dq-fb-title">Answer saved</div>
            Practice questions aren’t marked — they don’t count towards the board.
          </div>
        )}
      </div>

      {feedback && !isLast && (
        <button type="button" className="dq-btn dq-btn-primary" onClick={advance}>
          Next question
        </button>
      )}
      {feedback && isLast && !result && (
        <button
          type="button"
          className="dq-btn dq-btn-primary"
          onClick={() => setResult(localPracticeResult(questions, chosen))}
        >
          See your result
        </button>
      )}
      {busy && <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--lhx-muted)' }}>Marking…</p>}
    </div>
  )
}

/**
 * Does this stored value carry anything a learner would actually read?
 *
 * `Boolean(explanation)` is not that question. A bank row can hold an EMPTY
 * Tiptap doc — `{"type":"doc","content":[]}` — which is a truthy forty-character
 * string that renders to nothing, so using truthiness as the test puts a blank
 * where the encouraging line meant to stand in for it should be.
 */
function hasRichText(value) {
  return getRichPlainText(value).trim().length > 0
}

/**
 * Which options light up once the answer lands. The correct one is always
 * shown — a wrong answer with no right answer beside it teaches nothing.
 */
function optionClass(feedback, picked, i) {
  if (!feedback || feedback.practice) return picked === i ? ' is-correct' : ''
  if (feedback.correctAnswer != null && Number(feedback.correctAnswer) === i) return ' is-correct'
  if (picked === i) return ' is-wrong'
  return ''
}

/** The intro card — the mockup's hero. */
function IntroView({ payload, onStart, navigate }) {
  const total = payload?.questions?.length || 0
  const playable = canPlay(payload)

  return (
    <div className="dq">
      {!payload?.ranked && total > 0 && (
        <div className="dq-practice-note">
          No ranked quiz today — we don’t have enough new questions for your grade to make a fair
          one. Here are {total} for practice instead. They don’t count towards the leaderboard.
        </div>
      )}

      <div className="dq-hero">
        <div className="dq-hero-kicker">{payload?.ranked ? 'Today’s Quiz' : 'Practice'}</div>
        <h1>{total} questions. Once a day.</h1>
        <p>
          {payload?.ranked
            ? `Every Grade ${payload.grade} learner gets these same ${total} today.`
            : 'These are just for practice — take as long as you like.'}
        </p>
      </div>

      {playable ? (
        <button type="button" className="dq-btn dq-btn-primary" onClick={onStart}>
          {payload?.ranked ? 'Start today’s quiz' : `Practise ${total} anyway`}
        </button>
      ) : (
        // The bank has nothing at all for this grade. Say so plainly and
        // still offer somewhere real to go — never a card with no action.
        <div className="dq-card">
          <p style={{ margin: '0 0 4px', fontWeight: 800 }}>Nothing to practise yet</p>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--lhx-muted)' }}>
            We’re still writing questions for your grade. Try a quiz from the library in the
            meantime.
          </p>
          <button type="button" className="dq-btn dq-btn-indigo" onClick={() => navigate('/quizzes')}>
            Browse quizzes
          </button>
        </div>
      )}

      {payload?.ranked && (
        <button
          type="button"
          className="dq-btn dq-btn-ghost"
          onClick={() => navigate('/daily/leaderboard')}
        >
          This week’s leaderboard
        </button>
      )}
    </div>
  )
}

/** The result + review screen. Every number comes from the server. */
function ResultView({ summary, result, questions, navigate }) {
  const byId = new Map(questions.map((q) => [q.id, q]))

  return (
    <div className="dq">
      <div className="dq-card">
        <div className="dq-result">
          <div className="dq-result-emoji" aria-hidden="true">{summary.emoji}</div>
          <h2>{summary.headline}</h2>
          <p>{summary.pointsLine}</p>
          {summary.bonus && <div className="dq-badge">✨ All five · +10 bonus</div>}
          {result.rankHidden && (
            // The /child-safety promise, said warmly rather than as a refusal.
            <p style={{ marginTop: 10, fontSize: 12.5 }}>
              Your score is saved. You’ll appear on the leaderboard once your parent or guardian
              says it’s OK.
            </p>
          )}
        </div>
      </div>

      <div className="dq-card">
        <div className="dq-kicker">Your answers</div>
        {(result.perQuestion || []).map((row, i) => {
          const q = byId.get(row.questionId)
          // A bare index with no question left to resolve it against is not an
          // answer — `hasRichText` reads a number as nothing, so the line is
          // dropped rather than printed as "Answer: 1".
          const correctText = q && Number.isInteger(row.correctAnswer)
            ? q.options?.[row.correctAnswer]
            : row.correctAnswer
          return (
            <div key={row.questionId || i} className="dq-review-row">
              <span aria-hidden="true">{row.voided ? '➖' : row.correct ? '✅' : '❌'}</span>
              <div>
                <b>{row.subject || q?.subject}</b>
                {row.voided ? (
                  // A voided question was removed after the fact and everyone
                  // was credited. Say that, rather than showing it as correct.
                  <div style={{ fontSize: 12.5, color: 'var(--lhx-muted)' }}>
                    This question was removed — everyone got the points.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13 }}>
                      <RichContent value={q?.text} fallback={<span />} />
                    </div>
                    {!row.correct && hasRichText(correctText) && (
                      <div style={{ fontSize: 12.8, marginTop: 2 }}>
                        {/* The bold sits on RichContent's own element rather than
                            wrapping it: a rendered rich value is a <div>, and a
                            block inside <b> is invalid nesting that breaks the
                            line onto two. */}
                        Answer: <RichContent value={correctText} className="dq-answer" fallback={<span />} />
                      </div>
                    )}
                    {hasRichText(row.explanation) && (
                      <div style={{ fontSize: 12.5, color: 'var(--lhx-muted)', marginTop: 2 }}>
                        <RichContent value={row.explanation} fallback={<span />} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {summary.ranked && (
        <button
          type="button"
          className="dq-btn dq-btn-indigo"
          onClick={() => navigate('/daily/leaderboard')}
        >
          See the leaderboard
        </button>
      )}
      <button type="button" className="dq-btn dq-btn-ghost" onClick={() => navigate('/dashboard')}>
        Back to Home
      </button>
      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--lhx-muted)', fontWeight: 800 }}>
        Next quiz unlocks at midnight 🌙
      </p>
    </div>
  )
}

/**
 * The end-of-run summary for a PRACTICE set.
 *
 * Practice is not scored anywhere — the server refuses to mark it, so there
 * are no verdicts to show and no points to claim. This exists so finishing a
 * practice set still lands somewhere rather than dead-ending on the last
 * question, and it says plainly that nothing counted.
 */
function localPracticeResult(questions, chosen) {
  return {
    ranked: false,
    correct: 0,
    credited: 0,
    total: questions.length,
    points: 0,
    allCorrect: false,
    perQuestion: questions.map((q) => ({
      questionId: q.id,
      subject: q.subject,
      chosen: chosen[q.id] ?? null,
      correct: false,
      correctAnswer: null,
      explanation: '',
      voided: false,
    })),
  }
}
