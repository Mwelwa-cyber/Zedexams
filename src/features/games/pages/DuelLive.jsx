/**
 * DuelLive — the REAL learner-vs-learner race (PROMPT 9 slice B), on the
 * server model merged in #2465: queue by writing your own duelQueue doc,
 * learn the match from the server's stamp, race the shared question set,
 * submit raw answers to the grading callable.
 *
 * Prototype flow: searching → VS → race → result. Two honesty rules:
 * - There is NO live opponent progress bar. The match doc carries only
 *   settled scores, so the race shows YOUR progress and the result
 *   waits for the opponent's real score — a bar animating a pretend
 *   opponent is exactly what the robot duel exists to avoid faking.
 * - The score on the result screen is the SERVER's grading, read back
 *   from the match doc — never the local echo.
 *
 * Compliance: the opponent is a first name + initial avatar from the
 * match doc, and there is no way to message them from here (or anywhere).
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { duelAllowed } from '../lib/duelAccess'
import { correctIndexFor } from '../lib/timedQuizCore'
import { joinQueue, watchMatch, submitAnswers } from '../services/duelService'
import { playCorrect, playWrong, playWin, primeSounds } from '../lib/gameSounds'
import SeoHelmet from '../../../shared/components/SeoHelmet'

export default function DuelLive() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const uid = currentUser?.uid || null
  const grade = Number(userProfile?.grade) || null
  const challengesAllowed = duelAllowed(currentUser, userProfile)

  const [screen, setScreen] = useState('search') // search | vs | race | waiting | result | error
  const [match, setMatch] = useState(null)
  const [count, setCount] = useState(3)
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState(null)
  const [error, setError] = useState('')
  const answersRef = useRef([])
  const cancelRef = useRef(() => {})
  const matchUnsubRef = useRef(() => {})

  // Queue on mount; the cancel function doubles as leave-queue on unmount
  // so a closed page never strands a ghost entry.
  useEffect(() => {
    if (!challengesAllowed || !uid || !grade) return undefined
    if (screen !== 'search') return undefined
    const cancel = joinQueue({
      grade,
      onMatched: (matchId) => {
        matchUnsubRef.current()
        matchUnsubRef.current = watchMatch(matchId, (m) => {
          if (!m) return
          setMatch(m)
          setScreen((s) => (s === 'search' ? 'vs' : s))
          // The opponent's settled score arrives through this same watch.
          if (m.state === 'done') setScreen('result')
        }, () => setError('We lost the match connection.'))
      },
      onError: () => { setError('We couldn’t join the queue.'); setScreen('error') },
    })
    cancelRef.current = cancel
    return cancel
  }, [challengesAllowed, uid, grade, screen])

  useEffect(() => () => matchUnsubRef.current(), [])

  // VS countdown → race.
  useEffect(() => {
    if (screen !== 'vs') return undefined
    if (count < 0) return undefined
    const t = setTimeout(() => {
      if (count === 0) { primeSounds(); setScreen('race') } else setCount((c) => c - 1)
    }, count === 0 ? 500 : 900)
    return () => clearTimeout(t)
  }, [screen, count])

  const questions = match?.questions || []
  const question = questions[index]
  const opponentUid = (match?.players || []).find((p) => p !== uid) || null
  const opponentName = (match?.names && opponentUid && match.names[opponentUid]) || 'Your opponent'

  const pick = async (optionIndex) => {
    if (picked !== null || !question) return
    setPicked(optionIndex)
    const isCorrect = optionIndex === correctIndexFor(question)
    if (isCorrect) playCorrect(); else playWrong()
    answersRef.current[index] = optionIndex
    setTimeout(async () => {
      if (index + 1 < questions.length) {
        setIndex((i) => i + 1)
        setPicked(null)
        return
      }
      // Finished — the server grades; we only ever send raw indexes.
      try {
        const res = await submitAnswers(match.id, answersRef.current)
        if (res?.done) playWin()
        setScreen(res?.done ? 'result' : 'waiting')
      } catch {
        setError('We couldn’t hand in your answers — check your connection and try again.')
        setScreen('error')
      }
    }, 650)
  }

  const rematch = () => {
    matchUnsubRef.current()
    setMatch(null); setIndex(0); setPicked(null); setCount(3)
    answersRef.current = []
    setScreen('search')
  }

  const exit = () => { cancelRef.current(); matchUnsubRef.current(); navigate('/games') }

  if (!challengesAllowed || !uid) {
    return (
      <div className="lhx"><div className="lhx-page"><div className="lhx-vs-wrap">
        <SeoHelmet title="Live Challenge" path="/games/duel/live" noIndex />
        <div className="lhx-vs-sub">
          {uid
            ? 'Challenges are switched off for this account. A parent or guardian controls this in the Guardian Zone.'
            : 'Sign in to race another learner.'}
        </div>
        <button type="button" className="lhx-btn lhx-btn-primary" onClick={() => navigate('/games')}>Back to games</button>
      </div></div></div>
    )
  }

  const myScore = match?.scores?.[uid]
  const theirScore = opponentUid != null ? match?.scores?.[opponentUid] : undefined
  const verdict = match?.state === 'done'
    ? (match.draw ? 'tie' : match.winner === uid ? 'win' : 'lose')
    : null

  return (
    <div className="lhx">
      <SeoHelmet title="Live Challenge" path="/games/duel/live" noIndex />
      <div className="lhx-page">
        {screen === 'search' && (
          <div className="lhx-vs-wrap">
            <div className="lhx-vs-kicker">LIVE CHALLENGE{grade ? ` · GRADE ${grade}` : ''}</div>
            <div className="lhx-vs-name" style={{ fontSize: 17 }}>Finding an opponent…</div>
            <div className="lhx-vs-sub">Matching you with another Grade {grade} learner. Same questions, fastest correct answers win.</div>
            <div className="lhx-skel" style={{ height: 10, borderRadius: 99, margin: '18px 0' }} />
            <button type="button" className="lhx-btn lhx-btn-block" style={{ background: 'var(--lhx-card)', color: 'var(--lhx-indigo-text)', boxShadow: 'var(--lhx-shadow)' }} onClick={exit}>
              Cancel
            </button>
          </div>
        )}

        {screen === 'vs' && match && (
          <div className="lhx-vs-wrap">
            <div className="lhx-vs-kicker">LIVE CHALLENGE{grade ? ` · GRADE ${grade}` : ''}</div>
            <div className="lhx-vs-avatars">
              <div>
                <div className="lhx-vs-big" style={{ background: 'linear-gradient(135deg,#ffb199,#ff6b3d)' }}>
                  {(userProfile?.displayName || 'You').trim().charAt(0).toUpperCase()}
                </div>
                <div className="lhx-vs-name">You</div>
              </div>
              <div className="lhx-vs-label" aria-hidden="true">VS</div>
              <div>
                <div className="lhx-vs-big" style={{ background: 'linear-gradient(135deg,#7c8bf5,#5b63dd)' }}>
                  {opponentName.charAt(0).toUpperCase()}
                </div>
                <div className="lhx-vs-name">{opponentName}</div>
              </div>
            </div>
            <div className="lhx-vs-sub">Same questions · the server keeps score</div>
            <div className="lhx-vs-count" aria-live="polite">{count > 0 ? count : 'GO!'}</div>
          </div>
        )}

        {screen === 'race' && question && (
          <>
            <div className="lhx-quiz-top">
              <button type="button" className="lhx-quiz-x" aria-label="Leave the race" onClick={exit}>✕</button>
              <div className="lhx-quiz-bar" aria-hidden="true">
                <i style={{ width: `${((index + (picked !== null ? 1 : 0)) / questions.length) * 100}%` }} />
              </div>
            </div>
            <div className="lhx-quiz-kicker">QUESTION {index + 1} OF {questions.length} · VS {opponentName.toUpperCase()}</div>
            <div className="lhx-quiz-q">{question.question}</div>
            <div className="lhx-opts">
              {(question.options || []).map((option, i) => {
                const revealed = picked !== null
                const cls = revealed && i === correctIndexFor(question) ? 'is-correct' : revealed && i === picked ? 'is-wrong' : ''
                return (
                  <button key={`${index}-${i}`} type="button" className={`lhx-opt ${cls}`} disabled={revealed} onClick={() => pick(i)}>
                    <span className="lhx-opt-letter" aria-hidden="true">{'ABCDE'[i] || '•'}</span>
                    <span className="lhx-opt-text">{String(option)}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {screen === 'waiting' && (
          <div className="lhx-vs-wrap">
            <div className="lhx-vs-kicker">LIVE CHALLENGE</div>
            <div className="lhx-vs-name" style={{ fontSize: 17 }}>You’re in! 🏁</div>
            <div className="lhx-vs-sub">{opponentName} is still racing — the result appears the moment they finish.</div>
            <div className="lhx-skel" style={{ height: 10, borderRadius: 99, margin: '18px 0' }} />
            <button type="button" className="lhx-btn lhx-btn-block" style={{ background: 'var(--lhx-card)', color: 'var(--lhx-indigo-text)', boxShadow: 'var(--lhx-shadow)' }} onClick={exit}>
              Back to games
            </button>
          </div>
        )}

        {screen === 'result' && verdict && (
          <div className="lhx-win" style={{ minHeight: 'calc(100dvh - 40px)' }}>
            <div className="lhx-win-middle">
              <div className="lhx-win-stars" aria-hidden="true">{verdict === 'win' ? '⭐⭐⭐' : verdict === 'tie' ? '⭐⭐☆' : '⭐☆☆'}</div>
              <h2 className="lhx-win-title">
                {verdict === 'win' ? 'You won! 🏆' : verdict === 'tie' ? 'Dead heat! ⚡' : `${opponentName} takes it!`}
              </h2>
              <p className="lhx-win-sub">
                {verdict === 'win' ? 'Fastest correct answers in the grade.' : verdict === 'tie' ? 'Nothing between you — one more settles it.' : 'A rematch settles it.'}
              </p>
              <div className="lhx-win-cards">
                <div className="lhx-win-stat ws-xp">
                  <div className="lhx-win-stat-label">YOU</div>
                  <div className="lhx-win-stat-body">{Number.isFinite(myScore) ? myScore : '—'}</div>
                </div>
                <div className="lhx-win-stat ws-score">
                  <div className="lhx-win-stat-label">{opponentName.toUpperCase()}</div>
                  <div className="lhx-win-stat-body">{Number.isFinite(theirScore) ? theirScore : '—'}</div>
                </div>
              </div>
              <p className="lhx-win-note">Scores graded by the server — same questions for both of you.</p>
            </div>
            <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={rematch}>⚔️ REMATCH</button>
            <div style={{ height: 10 }} />
            <button type="button" className="lhx-btn lhx-btn-block" style={{ background: 'var(--lhx-card)', color: 'var(--lhx-indigo-text)', boxShadow: 'var(--lhx-shadow)' }} onClick={exit}>
              Back to games
            </button>
          </div>
        )}

        {screen === 'error' && (
          <div className="lhx-vs-wrap">
            <div className="lhx-vs-name" style={{ fontSize: 17 }}>Oops</div>
            <div className="lhx-vs-sub">{error || 'Something went wrong.'}</div>
            <button type="button" className="lhx-btn lhx-btn-primary" onClick={rematch}>Try again</button>
            <div style={{ height: 10 }} />
            <button type="button" className="lhx-btn lhx-btn-block" style={{ background: 'var(--lhx-card)', color: 'var(--lhx-indigo-text)', boxShadow: 'var(--lhx-shadow)' }} onClick={exit}>
              Back to games
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
