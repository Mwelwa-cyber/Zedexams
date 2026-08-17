/**
 * DuelRace — /games/duel, the "Race Zed!" challenge (learner redesign
 * step 7). The prototype's duel screens, honestly framed: the learner
 * races ZED — openly tagged ROBOT COACH, with a plain sentence saying
 * no other players are involved — never a scripted bot pretending to
 * be a real learner.
 *
 * Flow: VS screen with a 3-2-1 countdown → a five-question race drawn
 * from an existing timed_quiz game (the learner's grade when one can
 * field a race) → the result screen with rematch. Zed's whole run is a
 * PRECOMPUTED timeline (duelCore.zedPlan/zedTimeline) read against the
 * race clock — deterministic under test, fair when the learner
 * finishes first, and never rubber-banded mid-race.
 *
 * The backend contract matches every rebuilt engine: the learner's
 * half flows through useGameFinish → saveScore / badges / daily streak
 * against the SOURCE game, with reportGameStart keeping the funnel.
 * Zed's score is displayed and then discarded — it is written nowhere.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { duelAllowed } from '../lib/duelAccess'
import { useGameFinish } from '../hooks/useGameFinish'
import { listGames, reportGameStart } from '../services/gamesService'
import { getFallbackGames } from '../../../data/gamesSeed'
import { playCorrect, playWrong, playWin, primeSounds } from '../lib/gameSounds'
import { BadgePop, buildSaveNote } from './../components/protoGameChrome'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import {
  DUEL_QUESTIONS,
  answerGain,
  duelVerdict,
  maxScoreAfter,
  pickDuelSource,
  roundResult,
  zedFinalScore,
  zedPlan,
  zedScoreAt,
  zedTimeline,
} from '../lib/duelCore'

// Zed's poses (step 8, from the uploaded pack): raring to go on the VS
// screen; the result screen reacts to the verdict.
const ZED_ART = '/images/characters/poses/zed-lets-go.webp'
const ZED_RESULT_ART = {
  win: '/images/characters/poses/zed-celebrate.webp',
  lose: '/images/characters/poses/zed-oops.webp',
  tie: '/images/characters/poses/zed-thinking.webp',
}

/* ── VS screen with countdown ──────────────────────────────────── */

function VsScreen({ grade, firstName, count }) {
  return (
    <div className="lhx-vs-wrap">
      <div className="lhx-vs-kicker">CHALLENGE MODE{grade ? ` · GRADE ${grade}` : ''}</div>
      <div className="lhx-vs-avatars">
        <div>
          <div className="lhx-vs-big" style={{ background: 'linear-gradient(135deg,#ffb199,#ff6b3d)' }}>
            {(firstName || 'You').charAt(0).toUpperCase()}
          </div>
          <div className="lhx-vs-name">You</div>
        </div>
        <div className="lhx-vs-label" aria-hidden="true">VS</div>
        <div>
          <div className="lhx-vs-big is-zed"><img src={ZED_ART} alt="" aria-hidden="true" /></div>
          <div className="lhx-vs-name">Zed</div>
          <div><span className="lhx-vs-bot-tag">🤖 ROBOT COACH</span></div>
        </div>
      </div>
      <div className="lhx-vs-sub">Same questions · fastest correct answers win</div>
      <div className="lhx-vs-count" aria-live="polite">{count > 0 ? count : 'GO!'}</div>
      <div className="lhx-vs-honest">
        Zed is our friendly robot — practise racing, no other players involved.
      </div>
    </div>
  )
}

/* ── Race screen ───────────────────────────────────────────────── */

function RaceScreen({ source, plan, firstName, onExit, onEnd }) {
  const timeline = useMemo(() => zedTimeline(plan), [plan])
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState(null)
  const [score, setScore] = useState(0)
  const [zedScore, setZedScore] = useState(0)

  const round = useRef({ combo: 1, peakCombo: 1, correct: 0, wrong: 0, startedAt: Date.now() })
  const timeouts = useRef([])
  const later = (fn, ms) => { timeouts.current.push(setTimeout(fn, ms)) }
  useEffect(() => () => timeouts.current.forEach(clearTimeout), [])

  // Zed's score reads off his precomputed timeline as the clock runs.
  useEffect(() => {
    const iv = setInterval(() => {
      setZedScore(zedScoreAt(timeline, Date.now() - round.current.startedAt))
    }, 500)
    return () => clearInterval(iv)
  }, [timeline])

  const question = source.questions[index]
  const maxBar = maxScoreAfter(DUEL_QUESTIONS)

  const pick = (optionIndex) => {
    if (picked !== null) return
    const isCorrect = optionIndex === question.correctIndex
    setPicked(optionIndex)
    // The final score is computed here, synchronously — the state setter
    // is async and the end-of-race callback must not read a stale value.
    let nextScore = score
    if (isCorrect) {
      const comboNow = round.current.combo
      round.current.correct += 1
      round.current.peakCombo = Math.max(round.current.peakCombo, comboNow)
      round.current.combo = comboNow + 1
      nextScore = score + answerGain(comboNow)
      playCorrect()
      setScore(nextScore)
    } else {
      round.current.wrong += 1
      round.current.combo = 1
      playWrong()
    }
    later(() => {
      if (index + 1 >= source.questions.length) {
        onEnd({
          score: nextScore,
          correct: round.current.correct,
          wrong: round.current.wrong,
          peakCombo: round.current.peakCombo,
          timeSpentMs: Date.now() - round.current.startedAt,
          zedScore: zedFinalScore(timeline),
        })
      } else {
        setIndex((i) => i + 1)
        setPicked(null)
      }
    }, 700)
  }

  return (
    <>
      <div className="lhx-quiz-top">
        <button type="button" className="lhx-quiz-x" aria-label="Leave the race" onClick={onExit}>✕</button>
        <div className="lhx-quiz-bar" aria-hidden="true">
          <i style={{ width: `${((index + (picked !== null ? 1 : 0)) / source.questions.length) * 100}%` }} />
        </div>
        <div className="lhx-quiz-hearts" aria-label={`Combo ×${round.current.combo}`}>🔥 x{round.current.combo}</div>
      </div>

      <div className="lhx-duel-strip" aria-label="Race scores">
        <div className="lhx-duel-row">
          <span className="lhx-duel-av" style={{ background: 'linear-gradient(135deg,#ffb199,#ff6b3d)' }}>
            {(firstName || 'You').charAt(0).toUpperCase()}
          </span>
          <div className="lhx-gc-bar"><i style={{ width: `${Math.min(100, (score / maxBar) * 100)}%` }} /></div>
          <span className="lhx-duel-score">{score}</span>
        </div>
        <div className="lhx-duel-row">
          <span className="lhx-duel-av" style={{ background: 'linear-gradient(135deg,#7c8bf5,#5b63dd)' }} aria-label="Zed the robot">🤖</span>
          <div className="lhx-gc-bar"><i style={{ width: `${Math.min(100, (zedScore / maxBar) * 100)}%`, background: 'linear-gradient(90deg,#7c8bf5,#5b63dd)' }} /></div>
          <span className="lhx-duel-score">{zedScore}</span>
        </div>
      </div>

      <div className="lhx-quiz-kicker">
        QUESTION {index + 1} OF {source.questions.length}
        {source.game.subject ? ` · ${String(source.game.subject).toUpperCase()}` : ''}
      </div>
      <div className="lhx-quiz-q">{question.question}</div>
      <div className="lhx-quiz-help">Keep your lead over Zed!</div>
      <div className="lhx-opts">
        {question.options.map((option, i) => {
          const revealed = picked !== null
          const cls = revealed && i === question.correctIndex
            ? 'is-correct'
            : revealed && i === picked
              ? 'is-wrong'
              : ''
          return (
            <button
              key={`${index}-${i}`}
              type="button"
              className={`lhx-opt ${cls}`}
              disabled={revealed}
              onClick={() => pick(i)}
            >
              <span className="lhx-opt-letter" aria-hidden="true">{'ABCDE'[i] || '•'}</span>
              <span className="lhx-opt-text">{option}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

/* ── Result screen ─────────────────────────────────────────────── */

const VERDICT_COPY = {
  win: { title: 'You beat Zed! 🏆', sub: 'Fastest fingers in the race — Zed wants a rematch.' },
  lose: { title: 'Zed takes this one! 🤖', sub: 'He got lucky — race him again and take it back.' },
  tie: { title: 'Dead heat! ⚡', sub: 'Nothing between you — one more race settles it.' },
}

function ResultScreen({ outcome, saveNote, onRematch, onBack }) {
  const verdict = duelVerdict(outcome.score, outcome.zedScore)
  const copy = VERDICT_COPY[verdict]
  return (
    <div className="lhx-win" style={{ minHeight: 'calc(100dvh - 40px)' }}>
      <div className="lhx-win-middle">
        <img
          src={ZED_RESULT_ART[verdict]}
          alt=""
          aria-hidden="true"
          style={{ width: 110, height: 138, objectFit: 'contain', marginBottom: 6 }}
        />
        <div className="lhx-win-stars" aria-hidden="true">{verdict === 'win' ? '⭐⭐⭐' : verdict === 'tie' ? '⭐⭐☆' : '⭐☆☆'}</div>
        <h2 className="lhx-win-title">{copy.title}</h2>
        <p className="lhx-win-sub">{copy.sub}</p>
        <div className="lhx-win-cards">
          <div className="lhx-win-stat ws-xp">
            <div className="lhx-win-stat-label">YOU</div>
            <div className="lhx-win-stat-body">{outcome.score}</div>
          </div>
          <div className="lhx-win-stat ws-score">
            <div className="lhx-win-stat-label">ZED 🤖</div>
            <div className="lhx-win-stat-body">{outcome.zedScore}</div>
          </div>
        </div>
        <p className="lhx-win-note">
          {saveNote || 'Score saved ✓'} · practice race — only your score counts on the leaderboard
        </p>
      </div>
      <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={onRematch}>
        ⚔️ REMATCH
      </button>
      <div style={{ height: 10 }} />
      <button
        type="button"
        className="lhx-btn lhx-btn-block"
        style={{ background: 'var(--lhx-card)', color: 'var(--lhx-indigo-text)', boxShadow: 'var(--lhx-shadow)' }}
        onClick={onBack}
      >
        Back to games
      </button>
    </div>
  )
}

/* ── The page ──────────────────────────────────────────────────── */

export default function DuelRace() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const firstName = (userProfile?.displayName || '').trim().split(/\s+/)[0] || ''
  const grade = Number(userProfile?.grade) || null
  const challengesAllowed = duelAllowed(currentUser, userProfile)

  const [screen, setScreen] = useState('loading') // loading | vs | race | result | empty
  const [source, setSource] = useState(null)
  const [plan, setPlan] = useState([])
  const [count, setCount] = useState(3)
  const [outcome, setOutcome] = useState(null)
  const { saveResult, newBadges, streakResult, finish, reset } = useGameFinish()

  // Draw the race: live games when they load, seed catalogue otherwise.
  useEffect(() => {
    // Nothing is drawn for a learner who may not race — the refusal above is
    // the whole screen, so loading a question bank behind it is a read spent
    // on something nobody will see.
    if (!challengesAllowed) return undefined
    let cancelled = false
    async function load() {
      let games = []
      try { games = await listGames() } catch { /* seed below */ }
      if (cancelled) return
      const pool = games.length ? games : getFallbackGames()
      const drawn = pickDuelSource(pool, { grade })
      if (!drawn) { setScreen('empty'); return }
      setSource(drawn)
      setPlan(zedPlan(drawn.questions.length))
      setScreen('vs')
      setCount(3)
    }
    load()
    return () => { cancelled = true }
  }, [grade, challengesAllowed])

  // The 3-2-1-GO! countdown, then the race.
  useEffect(() => {
    if (screen !== 'vs') return undefined
    if (count < 0) return undefined
    const t = setTimeout(() => {
      if (count === 0) {
        primeSounds()
        reportGameStart(source.game)
        setScreen('race')
      } else {
        setCount((c) => c - 1)
      }
    }, count === 0 ? 500 : 900)
    return () => clearTimeout(t)
  }, [screen, count, source])

  const endRace = (result) => {
    setOutcome(result)
    playWin()
    setScreen('result')
    // Only the learner's half is saved, against the SOURCE game.
    finish(roundResult({ game: source.game, ...result }))
  }

  const rematch = () => {
    reset()
    const games = source ? [source.game] : []
    const drawn = pickDuelSource(games, { grade }) || source
    setSource(drawn)
    setPlan(zedPlan(drawn.questions.length))
    setOutcome(null)
    setScreen('vs')
    setCount(3)
  }

  return (
    <div className="lhx">
      <SeoHelmet title="Race Zed!" description="Race Zed the robot through five quick questions on ZedExams." path="/games/duel" noIndex />
      <div className="lhx-page">
        {challengesAllowed && screen === 'loading' && <div className="lhx-vs-wrap"><div className="lhx-vs-sub">Getting the race ready…</div></div>}
        {/* The route, not just the card. A learner whose guardian switched
            live challenges off — or who is still in limited mode — can still
            type /games/duel or use a bookmark, so the capability is checked
            here too. It says who turned it off, because "not available" with
            no reason reads as the app being broken. */}
        {!challengesAllowed && (
          <div className="lhx-vs-wrap">
            <div className="lhx-vs-sub">
              Challenges are switched off for this account. A parent or guardian
              can turn them back on from the Guardian Zone.
            </div>
            <div style={{ height: 18 }} />
            <button type="button" className="lhx-btn lhx-btn-primary" onClick={() => navigate('/games')}>Back to games</button>
          </div>
        )}
        {challengesAllowed && screen === 'empty' && (
          <div className="lhx-vs-wrap">
            <div className="lhx-vs-sub">No race can start right now — check back soon!</div>
            <div style={{ height: 18 }} />
            <button type="button" className="lhx-btn lhx-btn-primary" onClick={() => navigate('/games')}>Back to games</button>
          </div>
        )}
        {challengesAllowed && screen === 'vs' && <VsScreen grade={source?.game?.grade || grade} firstName={firstName} count={count} />}
        {challengesAllowed && screen === 'race' && (
          <RaceScreen
            source={source}
            plan={plan}
            firstName={firstName}
            onExit={() => navigate('/games')}
            onEnd={endRace}
          />
        )}
        {challengesAllowed && screen === 'result' && (
          <ResultScreen
            outcome={outcome}
            saveNote={buildSaveNote({ signedIn: !!currentUser, saveResult, streakResult })}
            onRematch={rematch}
            onBack={() => navigate('/games')}
          />
        )}
      </div>
      <BadgePop badges={newBadges} />
    </div>
  )
}
