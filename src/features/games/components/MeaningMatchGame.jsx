/**
 * MeaningMatchGame — the prototype-v3 tap-pair engine for
 * `type: 'memory_match'` games (learner redesign step 4, the third
 * rebuilt mechanic; it replaces the card-flip Memory Match).
 *
 * One 60-second round under the indigo game head: boards of up to four
 * pairs, words down the left column, their meanings shuffled down the
 * right. Tap a word, tap a meaning — right locks the pair green and
 * pays 20 × combo, wrong shakes both red and resets the combo. A
 * cleared board deals the next from a recycling pool, and the timer
 * ending lands on the shared win screen (140/60 star thresholds).
 *
 * The backend contract is UNCHANGED (locked scope): pairs still come
 * from the game doc's `questions` ({ question: left, answer: right } —
 * the shape memory_match games already carried, so fraction↔percent
 * and country↔capital games play unchanged), and the finished round
 * flows through useGameFinish → saveScore / badges / daily streak with
 * reportGameStart keeping the funnel. PlayGame mounts it bare; ✕
 * leaves to /games like the prototype's mmExit.
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
import {
  ROUND_SECONDS,
  dealBoard,
  matchGain,
  meaningOrder,
  pairPool,
  playablePairs,
  roundResult,
  starsForScore,
} from '../lib/meaningMatchCore'

/* ── Play screen ───────────────────────────────────────────────── */

function PlayScreen({ game, onExit, onEnd }) {
  const allPairs = useMemo(() => playablePairs(game?.questions), [game])
  const poolRef = useRef(null)
  const [board, setBoard] = useState([])
  const [order, setOrder] = useState([])
  const [matched, setMatched] = useState([])   // board indices locked green
  const [selWord, setSelWord] = useState(null) // selected word's board index
  const [wrong, setWrong] = useState(null)     // { word, meaning } shaking red
  const [score, setScore] = useState(0)
  const [time, setTime] = useState(ROUND_SECONDS)

  const round = useRef({ combo: 1, peakCombo: 1, solved: 0, misses: 0 })
  const timeouts = useRef([])
  const later = (fn, ms) => { timeouts.current.push(setTimeout(fn, ms)) }
  useEffect(() => () => timeouts.current.forEach(clearTimeout), [])

  const nextBoard = () => {
    const dealt = dealBoard(poolRef.current ?? [], allPairs)
    poolRef.current = dealt.pool
    setBoard(dealt.board)
    setOrder(meaningOrder(dealt.board.length))
    setMatched([])
    setSelWord(null)
    setWrong(null)
  }

  // First board on mount.
  useEffect(() => {
    poolRef.current = pairPool(game?.questions)
    nextBoard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The countdown — closure reads through refs, so it is stale-proof.
  const endedRef = useRef(false)
  const scoreRef = useRef(0)
  useEffect(() => { scoreRef.current = score }, [score])
  const onEndRef = useRef(onEnd)
  useEffect(() => { onEndRef.current = onEnd }, [onEnd])
  useEffect(() => {
    const iv = setInterval(() => {
      setTime((t) => {
        if (t <= 1) {
          clearInterval(iv)
          if (!endedRef.current) {
            endedRef.current = true
            onEndRef.current({
              score: scoreRef.current,
              solved: round.current.solved,
              misses: round.current.misses,
              peakCombo: round.current.peakCombo,
            })
          }
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  const tapWord = (index) => {
    if (endedRef.current || matched.includes(index) || wrong) return
    setSelWord(index)
  }

  const tapMeaning = (index) => {
    if (endedRef.current || matched.includes(index) || wrong || selWord === null) return
    if (index === selWord) {
      const comboNow = round.current.combo
      const gained = matchGain(comboNow)
      round.current.solved += 1
      round.current.peakCombo = Math.max(round.current.peakCombo, comboNow)
      round.current.combo = comboNow + 1
      playCorrect()
      setScore((s) => s + gained)
      const nowMatched = [...matched, index]
      setMatched(nowMatched)
      setSelWord(null)
      if (nowMatched.length >= board.length) later(nextBoard, 500)
    } else {
      round.current.misses += 1
      round.current.combo = 1
      playWrong()
      setWrong({ word: selWord, meaning: index })
      later(() => {
        setWrong(null)
        setSelWord(null)
      }, 500)
    }
  }

  return (
    <>
      <div className="lhx-nt-head">
        <GameTopBar onExit={onExit} time={time} timeMax={ROUND_SECONDS} score={score} />
        <div className="lhx-nt-goal">
          <div className="lhx-nt-goal-lab">MATCH THE WORD TO ITS MEANING</div>
        </div>
        <div className="lhx-nt-best">{round.current.solved} matched · combo ×{round.current.combo}</div>
      </div>

      <div className="lhx-mm-board">
        <div className="lhx-mm-col" aria-label="Words">
          {board.map((pair, i) => (
            <button
              key={`w-${pair.word}-${i}`}
              type="button"
              className={`lhx-mm-chip lhx-mm-word ${matched.includes(i) ? 'is-matched' : selWord === i ? 'is-sel' : ''} ${wrong?.word === i ? 'is-wrong' : ''}`}
              aria-pressed={selWord === i}
              disabled={matched.includes(i)}
              onClick={() => tapWord(i)}
            >
              {pair.word}
            </button>
          ))}
        </div>
        <div className="lhx-mm-col" aria-label="Meanings">
          {order.map((boardIndex) => (
            <button
              key={`m-${board[boardIndex]?.meaning}-${boardIndex}`}
              type="button"
              className={`lhx-mm-chip ${matched.includes(boardIndex) ? 'is-matched' : ''} ${wrong?.meaning === boardIndex ? 'is-wrong' : ''}`}
              disabled={matched.includes(boardIndex)}
              onClick={() => tapMeaning(boardIndex)}
            >
              {board[boardIndex]?.meaning}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

/* ── The engine ────────────────────────────────────────────────── */

export default function MeaningMatchGame({ game }) {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [screen, setScreen] = useState('play')
  const [outcome, setOutcome] = useState({ score: 0, solved: 0 })
  const { saveResult, newBadges, streakResult, finish } = useGameFinish()

  // The round starts the moment the engine mounts (prototype behaviour).
  useEffect(() => {
    primeSounds()
    reportGameStart(game)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const endRound = (result) => {
    setOutcome(result)
    playWin()
    setScreen('win')
    // The shared end-of-round plumbing: score save, badges, daily streak.
    finish(roundResult({ game, ...result }))
  }

  return (
    <div className="lhx">
      <div className="lhx-page">
        {screen === 'play' && (
          <PlayScreen
            game={game}
            onExit={() => navigate('/games')}
            onEnd={endRound}
          />
        )}
        {screen === 'win' && (
          <WinScreen
            stars={starsForScore(outcome.score)}
            title="Meaning Match done!"
            sub={`You matched ${outcome.solved} ${outcome.solved === 1 ? 'pair' : 'pairs'}! Sharp thinking.`}
            score={outcome.score}
            saveNote={buildSaveNote({ signedIn: !!currentUser, saveResult, streakResult })}
            onContinue={() => navigate('/games')}
          />
        )}
      </div>
      <BadgePop badges={newBadges} />
    </div>
  )
}
