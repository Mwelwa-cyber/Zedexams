/**
 * PunctuationProGame — the prototype-v3 tap-the-correct-sentence engine
 * for `type: 'punctuation'` games (learner redesign step 4, the fourth
 * and last rebuilt mechanic).
 *
 * A fixed set of `ROUND_ITEMS` sentences under the indigo game head:
 * each item deals two or three versions of the same sentence, shuffled,
 * with only one punctuated correctly. Tapping the right one locks it
 * green, pays 20 × combo and deals the next after a beat; a wrong tap
 * shakes red, resets the combo and leaves the item live for another try.
 * The last sentence lands on the shared win screen (140/60 stars).
 *
 * There is no countdown (PROMPT 7b). Spotting a missing comma is a
 * reading skill, not a reflex, and the clock used to end the round on
 * exactly the learners still reading the options. The head's bar fills
 * with progress through the set instead of draining.
 *
 * Content is the repo's standard MCQ shape ({ question: optional
 * prompt, options, answer }) with the prototype's items as fallback,
 * and the finished round flows through the KEPT backend plumbing:
 * useGameFinish → saveScore / badges / daily streak, reportGameStart
 * for the funnel. PlayGame mounts it bare; ✕ leaves to /games like the
 * prototype's pnExit.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import '../gamesProto.css'
import { useAuth } from '../../../contexts/AuthContext'
import { useGameFinish } from '../hooks/useGameFinish'
import { reportGameStart } from '../services/gamesService'
import { playCorrect, playWrong, playWin, primeSounds } from '../lib/gameSounds'
import { BadgePop, GameTopBar, WinScreen, buildSaveNote } from './protoGameChrome'
import {
  ROUND_ITEMS,
  dealOptions,
  itemQueue,
  pickGain,
  roundResult,
  starsForScore,
} from '../lib/punctuationCore'

/* ── Play screen ───────────────────────────────────────────────── */

function PlayScreen({ game, onExit, onEnd }) {
  const queueRef = useRef([])
  const [item, setItem] = useState(null)     // { prompt, options, answer }
  const [options, setOptions] = useState([])
  const [picked, setPicked] = useState(null) // { text, verdict: 'ok' | 'no' }
  const [score, setScore] = useState(0)

  const round = useRef({ combo: 1, peakCombo: 1, solved: 0, misses: 0 })
  const startedAtRef = useRef(Date.now())
  const timeouts = useRef([])
  const later = (fn, ms) => { timeouts.current.push(setTimeout(fn, ms)) }
  useEffect(() => () => timeouts.current.forEach(clearTimeout), [])

  const nextItem = () => {
    if (!queueRef.current.length) queueRef.current = itemQueue(game?.questions)
    const it = queueRef.current.shift()
    setItem(it)
    setOptions(dealOptions(it))
    setPicked(null)
  }

  // First item on mount.
  useEffect(() => {
    queueRef.current = itemQueue(game?.questions)
    nextItem()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ending the round. `endedRef` is claimed SYNCHRONOUSLY so the last
  // sentence of the set can only finish the round once, however many taps
  // land inside one React batch.
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
    })
  }

  const pick = (text) => {
    if (endedRef.current || !item || picked?.verdict === 'ok') return
    if (text === item.answer) {
      const comboNow = round.current.combo
      const gained = pickGain(comboNow)
      round.current.solved += 1
      round.current.peakCombo = Math.max(round.current.peakCombo, comboNow)
      round.current.combo = comboNow + 1
      playCorrect()
      setScore((s) => s + gained)
      setPicked({ text, verdict: 'ok' })
      // The score is read here, synchronously — `setScore` above is async and
      // the end-of-round callback must not close over a stale value.
      if (round.current.solved >= ROUND_ITEMS) later(() => endRound(score + gained), 500)
      else later(nextItem, 500)
    } else {
      round.current.misses += 1
      round.current.combo = 1
      playWrong()
      setPicked({ text, verdict: 'no' })
      later(() => setPicked((p) => (p?.verdict === 'no' ? null : p)), 450)
    }
  }

  if (!item) return null

  return (
    <>
      <div className="lhx-nt-head">
        <GameTopBar onExit={onExit} done={round.current.solved} total={ROUND_ITEMS} score={score} />
        <div className="lhx-nt-goal">
          <div className="lhx-nt-goal-lab">TAP THE CORRECTLY PUNCTUATED SENTENCE</div>
          {item.prompt && <div className="lhx-wb-clue">{item.prompt}</div>}
        </div>
        <div className="lhx-nt-best">
          Sentence {Math.min(ROUND_ITEMS, round.current.solved + 1)} of {ROUND_ITEMS} · combo ×{round.current.combo}
        </div>
      </div>

      <div className="lhx-pn-opts">
        {options.map((text) => (
          <button
            key={text}
            type="button"
            className={`lhx-pn-opt ${picked?.text === text ? (picked.verdict === 'ok' ? 'is-ok' : 'is-no') : ''}`}
            onClick={() => pick(text)}
          >
            {text}
          </button>
        ))}
      </div>
    </>
  )
}

/* ── The engine ────────────────────────────────────────────────── */

export default function PunctuationProGame({ game }) {
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
            title="Punctuation Pro done!"
            sub={`You punctuated ${outcome.solved} ${outcome.solved === 1 ? 'sentence' : 'sentences'} correctly!`}
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
