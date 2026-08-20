/**
 * FractionLadderGame — the `fraction_ladder` engine: nine levels, and an
 * answer the learner WRITES rather than picks.
 *
 * Ported from three prototypes (docs/learner/zedexams-fraction-levels.html,
 * -maths-notation.html and -maths-game.html), and the three things they argue
 * for are the three things this engine does that a multiple-choice quiz cannot:
 *
 *   THE LADDER GATES ON PREREQUISITES, NOT ON STARS. A level opens when the one
 *   before it is passed and every level it names is passed; a locked level
 *   NAMES what opens it rather than showing a padlock. A learner who scrapes a
 *   pass moves on — `levelState` has nowhere to read a score.
 *
 *   THE ANSWER IS WRITTEN, AND FORM IS PART OF IT. Two boxes and a keypad, and
 *   `markFractionAnswer` decides: 2/4 is right for 1/2 and says how it
 *   simplifies, unless the question asked for lowest terms.
 *
 *   A WRONG ANSWER HAS A NAME. The question's own `traps` map answers "1/2 +
 *   1/4 = 2/6" with "the bottoms were added too" instead of a red cross.
 *
 * The fraction itself is drawn by one renderer with the DIGITS aria-hidden and
 * the WORDS as the accessible name, so a screen reader says "three quarters"
 * rather than "3 4" — and the two can never drift, because there is one of it.
 *
 * Progress is per-device (localStorage, like the Number Path level path):
 * there is no server-side per-level model and building one is out of scope.
 * Score, XP and badges stay the server-backed truth through useGameFinish.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { useGameFinish } from '../hooks/useGameFinish'
import { reportGameStart } from '../services/gamesService'
import { playCorrect, playWrong, playWin, primeSounds } from '../lib/gameSounds'
import { BadgePop, GameTopBar, WinScreen, buildSaveNote } from './protoGameChrome'
import { readJson, writeJson } from '../../../shared/utils/safeStorage'
import {
  FRACTION_LEVELS,
  answerGain,
  blockerText,
  fracWords,
  levelState,
  markFractionAnswer,
  mixedWords,
  questionsForLevel,
  roundResult,
  starsForScore,
} from '../lib/fractionLadderCore'

const passedKey = (gameId) => `zedexams:fraction-ladder:${gameId || 'default'}`

/**
 * The one fraction renderer. Digits are aria-hidden and the words are the
 * accessible name, so the screen reader and the page can never disagree.
 */
function Frac({ n, d, whole = 0 }) {
  return (
    <span className="lhx-fr" role="math" aria-label={whole ? mixedWords(whole, n, d) : fracWords(n, d)}>
      {whole ? <span className="lhx-fr-w" aria-hidden="true">{whole}</span> : null}
      <span className="lhx-fr-stack" aria-hidden="true">
        <span className="lhx-fr-n">{n}</span>
        <span className="lhx-fr-d">{d}</span>
      </span>
    </span>
  )
}

/* ── Ladder ────────────────────────────────────────────────────── */

function LadderScreen({ game, passed, onPick, onExit }) {
  const groups = []
  for (const level of FRACTION_LEVELS) {
    if (!groups.length || groups[groups.length - 1].name !== level.group) {
      groups.push({ name: level.group, levels: [] })
    }
    groups[groups.length - 1].levels.push(level)
  }

  return (
    <>
      <div className="lhx-nt-head">
        <div className="lhx-nt-top">
          <button type="button" className="lhx-nt-x" aria-label="Leave the game" onClick={onExit}>✕</button>
          <div className="lhx-nt-title">{game?.title || 'Fraction Ladder'}</div>
        </div>
        <div className="lhx-nt-best">{passed.length} of {FRACTION_LEVELS.length} levels passed</div>
      </div>

      <div className="lhx-fl-ladder">
        {groups.map((group) => (
          <div key={group.name}>
            <div className="lhx-fl-group">{group.name}</div>
            {group.levels.map((level) => {
              const state = levelState(level.id, passed)
              const questions = questionsForLevel(game, level.id).length
              const playable = state.state !== 'locked' && questions > 0
              // The lock reason sits inside the button, so it lands in the
              // button's accessible name by default — "…Opens after Level 2 —
              // Equal fractions" — and every level that names another becomes
              // findable by that other level's name. An explicit label keeps
              // the reason (a screen reader needs it) while making the level's
              // own identity the thing the name starts with.
              const label = `Level ${level.order}: ${level.name}`
                + (state.state === 'done' ? ', passed' : '')
                + (state.state === 'locked' ? `, locked — opens after ${blockerText(state.blockers)}` : '')
                + (state.state !== 'locked' && questions === 0 ? ', no questions in this pack yet' : '')
              return (
                <button
                  key={level.id}
                  type="button"
                  className={`lhx-fl-level is-${state.state}`}
                  aria-label={label}
                  disabled={!playable}
                  onClick={() => onPick(level.id)}
                >
                  <span className={`lhx-fl-badge is-${state.state}`} aria-hidden="true">
                    {state.state === 'done' ? '✓' : state.state === 'locked' ? '🔒' : level.order}
                  </span>
                  <span className="lhx-fl-text">
                    <b>{level.name}</b>
                    <small>{level.blurb}</small>
                    {state.state === 'locked' && (
                      <em className="lhx-fl-why">Opens after {blockerText(state.blockers)}</em>
                    )}
                    {state.state !== 'locked' && questions === 0 && (
                      <em className="lhx-fl-why">No questions in this pack yet</em>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

/* ── Play ──────────────────────────────────────────────────────── */

function PlayScreen({ game, levelId, onExit, onEnd }) {
  const questions = useMemo(() => questionsForLevel(game, levelId), [game, levelId])
  const [index, setIndex] = useState(0)
  const [num, setNum] = useState('')
  const [den, setDen] = useState('')
  const [whole, setWhole] = useState('')
  const [focus, setFocus] = useState('num')
  const [verdict, setVerdict] = useState(null)
  const [score, setScore] = useState(0)

  const question = questions[index]
  const wantsDecimal = question?.form === 'decimal'
  const round = useRef({ combo: 1, peakCombo: 1, solved: 0, misses: 0 })
  const startedAtRef = useRef(Date.now())
  const timeouts = useRef([])
  const later = (fn, ms) => { timeouts.current.push(setTimeout(fn, ms)) }
  useEffect(() => () => timeouts.current.forEach(clearTimeout), [])

  const endedRef = useRef(false)
  const onEndRef = useRef(onEnd)
  useEffect(() => { onEndRef.current = onEnd }, [onEnd])
  const endRound = (finalScore) => {
    if (endedRef.current) return
    endedRef.current = true
    onEndRef.current({
      score: finalScore,
      solved: round.current.solved,
      misses: round.current.misses,
      peakCombo: round.current.peakCombo,
      timeSpent: Math.round((Date.now() - startedAtRef.current) / 1000),
      levelId,
      passedLevel: round.current.solved >= Math.ceil(questions.length * 0.6),
    })
  }

  const clear = () => { setNum(''); setDen(''); setWhole(''); setFocus('num') }

  const tapDigit = (digit) => {
    if (verdict?.correct) return
    if (wantsDecimal) { setNum((current) => (current.length < 6 ? current + digit : current)); return }
    if (focus === 'whole') setWhole((current) => (current.length < 2 ? current + digit : current))
    else if (focus === 'num') setNum((current) => (current.length < 3 ? current + digit : current))
    else setDen((current) => (current.length < 3 ? current + digit : current))
  }

  const backspace = () => {
    if (verdict?.correct) return
    if (wantsDecimal || focus === 'num') setNum((current) => current.slice(0, -1))
    else if (focus === 'whole') setWhole((current) => current.slice(0, -1))
    else setDen((current) => current.slice(0, -1))
  }

  const check = () => {
    if (!question || verdict?.correct) return
    const entry = wantsDecimal
      ? { mode: 'decimal', decimal: num }
      : { mode: 'fraction', whole, num, den }
    const marked = markFractionAnswer(entry, question)
    setVerdict(marked)
    if (marked.correct) {
      const comboNow = round.current.combo
      const gained = answerGain(comboNow)
      round.current.solved += 1
      round.current.peakCombo = Math.max(round.current.peakCombo, comboNow)
      round.current.combo = comboNow + 1
      playCorrect()
      setScore((s) => s + gained)
      const nextScore = score + gained
      later(() => {
        if (index + 1 >= questions.length) endRound(nextScore)
        else { setIndex((i) => i + 1); clear(); setVerdict(null) }
      }, 1500)
    } else if (marked.reason !== 'blank') {
      round.current.misses += 1
      round.current.combo = 1
      playWrong()
    }
  }

  if (!question) return null

  return (
    <>
      <div className="lhx-nt-head">
        <GameTopBar onExit={onExit} done={index} total={questions.length} score={score} />
        <div className="lhx-nt-goal">
          <div className="lhx-nt-goal-lab">{FRACTION_LEVELS.find((l) => l.id === levelId)?.name.toUpperCase()}</div>
        </div>
        <div className="lhx-nt-best">
          Question {index + 1} of {questions.length} · combo ×{round.current.combo}
        </div>
      </div>

      <div className="lhx-fl-q">{question.question}</div>

      {wantsDecimal ? (
        <div className={`lhx-fl-answer ${verdict ? (verdict.correct ? 'is-ok' : 'is-no') : ''}`}>
          <input
            className="lhx-fl-dec"
            inputMode="decimal"
            aria-label="Your answer as a decimal"
            value={num}
            onChange={(event) => setNum(event.target.value.replace(/[^\d.]/g, '').slice(0, 6))}
          />
        </div>
      ) : (
        <div className={`lhx-fl-answer ${verdict ? (verdict.correct ? 'is-ok' : 'is-no') : ''}`}>
          <button
            type="button"
            className={`lhx-fl-box is-whole ${focus === 'whole' ? 'is-focus' : ''}`}
            aria-label={`Whole number${whole ? `, ${whole}` : ', empty'}`}
            onClick={() => setFocus('whole')}
          >
            {whole}
          </button>
          <span className="lhx-fl-stack">
            <button
              type="button"
              className={`lhx-fl-box ${focus === 'num' ? 'is-focus' : ''}`}
              aria-label={`Top number${num ? `, ${num}` : ', empty'}`}
              onClick={() => setFocus('num')}
            >
              {num}
            </button>
            <span className="lhx-fl-bar" aria-hidden="true" />
            <button
              type="button"
              className={`lhx-fl-box ${focus === 'den' ? 'is-focus' : ''}`}
              aria-label={`Bottom number${den ? `, ${den}` : ', empty'}`}
              onClick={() => setFocus('den')}
            >
              {den}
            </button>
          </span>
        </div>
      )}

      <div className="lhx-fl-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button key={digit} type="button" className="lhx-fl-key" onClick={() => tapDigit(digit)}>{digit}</button>
        ))}
        <button type="button" className="lhx-fl-key is-fn" onClick={backspace}>⌫</button>
        <button type="button" className="lhx-fl-key" onClick={() => tapDigit('0')}>0</button>
        {wantsDecimal
          ? <button type="button" className="lhx-fl-key is-fn" onClick={() => tapDigit('.')}>.</button>
          : <button type="button" className="lhx-fl-key is-fn" onClick={clear}>Clear</button>}
      </div>

      <button type="button" className="lhx-fl-check" onClick={check} disabled={verdict?.correct}>
        Check my answer
      </button>

      <div className="lhx-fl-feedback" aria-live="polite">
        {verdict && (
          <div className={`lhx-fl-fb ${verdict.correct ? 'is-ok' : 'is-no'}`}>
            <div className="lhx-fl-fb-title">
              <span aria-hidden="true">{verdict.correct ? '✓' : '✗'}</span>
              <span>{verdict.headline}</span>
            </div>
            {(verdict.note || verdict.why) && <div>{verdict.note || verdict.why}</div>}
          </div>
        )}
      </div>
    </>
  )
}

/* ── The engine ────────────────────────────────────────────────── */

export default function FractionLadderGame({ game }) {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [screen, setScreen] = useState('ladder')
  const [levelId, setLevelId] = useState(null)
  const [outcome, setOutcome] = useState({ score: 0, solved: 0 })
  const [passed, setPassed] = useState(() => readJson(passedKey(game?.id), []) || [])
  const { saveResult, newBadges, streakResult, finish } = useGameFinish()

  useEffect(() => {
    primeSounds()
    reportGameStart(game)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const endRound = (result) => {
    setOutcome(result)
    playWin()
    setScreen('win')
    if (result.passedLevel && !passed.includes(result.levelId)) {
      const next = [...passed, result.levelId]
      setPassed(next)
      writeJson(passedKey(game?.id), next)
    }
    finish(roundResult({ game, ...result }))
  }

  return (
    <div className="lhx lhx-bare">
      <div className="lhx-page">
        {screen === 'ladder' && (
          <LadderScreen
            game={game}
            passed={passed}
            onExit={() => navigate('/games')}
            onPick={(id) => { setLevelId(id); setScreen('play') }}
          />
        )}
        {screen === 'play' && (
          <PlayScreen
            game={game}
            levelId={levelId}
            onExit={() => setScreen('ladder')}
            onEnd={endRound}
          />
        )}
        {screen === 'win' && (
          <WinScreen
            stars={starsForScore(outcome.score)}
            title={outcome.passedLevel ? 'Level passed!' : 'Round finished'}
            sub={outcome.passedLevel
              ? 'The next level is open.'
              : 'Play it again — the level opens once most of it is right.'}
            score={outcome.score}
            saveNote={buildSaveNote({ signedIn: !!currentUser, saveResult, streakResult })}
            continueLabel="BACK TO THE LEVELS ▸"
            onContinue={() => setScreen('ladder')}
          />
        )}
      </div>
      <BadgePop badges={newBadges} />
    </div>
  )
}

export { Frac }
