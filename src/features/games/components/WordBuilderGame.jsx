/**
 * WordBuilderGame — the prototype-v3 spelling sprint for
 * `type: 'word_builder'` games (learner redesign step 4, the second
 * rebuilt mechanic).
 *
 * One 60-second round under the indigo game head: the clue (or, when
 * text-to-speech is available, sometimes just "🎧 tap what you hear"
 * with the word spoken aloud), the underline slots, the word's own
 * letters shuffled into tap tiles, and ⌫ Delete. A full set of slots
 * auto-checks — correct turns them green, pays 20 × combo and advances
 * to the next word (the queue recycles if the speller outruns it);
 * wrong shakes red, resets the combo and clears for another try. The
 * timer ending lands on the shared win screen (140/60 star thresholds).
 *
 * The backend contract is UNCHANGED (locked scope): the finished round
 * flows through useGameFinish → saveScore / badges / daily streak with
 * reportGameStart keeping the funnel, and the words still come from the
 * game doc's `questions` ({ question: clue, answer: word }) — only the
 * mechanic and the skin are the prototype's. PlayGame mounts it bare;
 * ✕ leaves to /games like the prototype's wbExit.
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
  ROUND_SECONDS,
  guessFrom,
  pickListenMode,
  roundResult,
  solveGain,
  starsForWordScore,
  tilesFor,
  wordQueue,
} from '../lib/wordBuilderCore'

function ttsOn() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Say the word aloud — best effort, silently skipped where unsupported. */
function speak(text) {
  try {
    if (!ttsOn()) return
    const u = new SpeechSynthesisUtterance(String(text).toLowerCase())
    u.lang = 'en-GB'
    u.rate = 0.8
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch { /* speech is a bonus, never a blocker */ }
}

/* ── Play screen ───────────────────────────────────────────────── */

function PlayScreen({ game, onExit, onEnd }) {
  // The word queue lives in a ref — it recycles mid-round without renders.
  const queueRef = useRef([])
  const [item, setItem] = useState(null)          // { word, clue }
  const [listen, setListen] = useState(false)
  const [tiles, setTiles] = useState([])
  const [placed, setPlaced] = useState([])
  const [verdict, setVerdict] = useState(null)    // null | 'ok' | 'no'
  const [score, setScore] = useState(0)
  const [time, setTime] = useState(ROUND_SECONDS)

  const round = useRef({ combo: 1, peakCombo: 1, solved: 0, misses: 0 })
  const timeouts = useRef([])
  const later = (fn, ms) => { timeouts.current.push(setTimeout(fn, ms)) }
  useEffect(() => () => timeouts.current.forEach(clearTimeout), [])

  const nextWord = () => {
    if (!queueRef.current.length) queueRef.current = wordQueue(game?.questions)
    const it = queueRef.current.shift()
    const listenNow = pickListenMode(ttsOn() && Boolean(it.word))
    setItem(it)
    setListen(listenNow)
    setTiles(tilesFor(it.word))
    setPlaced([])
    setVerdict(null)
    if (listenNow) later(() => speak(it.word), 300)
  }

  // First word on mount.
  useEffect(() => {
    queueRef.current = wordQueue(game?.questions)
    nextWord()
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

  const check = (nextPlaced, nextTiles) => {
    const guess = guessFrom(nextPlaced, nextTiles)
    if (guess === item.word) {
      const comboNow = round.current.combo
      const gained = solveGain(comboNow)
      round.current.solved += 1
      round.current.peakCombo = Math.max(round.current.peakCombo, comboNow)
      round.current.combo = comboNow + 1
      playCorrect()
      setScore((s) => s + gained)
      setVerdict('ok')
      later(nextWord, 650)
    } else {
      round.current.misses += 1
      round.current.combo = 1
      playWrong()
      setVerdict('no')
      later(() => {
        setPlaced([])
        setTiles((ts) => ts.map((t) => ({ ...t, used: false })))
        setVerdict(null)
      }, 600)
    }
  }

  const place = (index) => {
    if (endedRef.current || verdict === 'ok' || !item) return
    if (tiles[index].used || placed.length >= item.word.length) return
    const nextTiles = tiles.map((t, i) => (i === index ? { ...t, used: true } : t))
    const nextPlaced = [...placed, index]
    setTiles(nextTiles)
    setPlaced(nextPlaced)
    setVerdict(null)
    if (nextPlaced.length === item.word.length) check(nextPlaced, nextTiles)
  }

  const backspace = () => {
    if (endedRef.current || verdict === 'ok' || !placed.length) return
    const index = placed[placed.length - 1]
    setPlaced(placed.slice(0, -1))
    setTiles(tiles.map((t, i) => (i === index ? { ...t, used: false } : t)))
    setVerdict(null)
  }

  if (!item) return null

  return (
    <>
      <div className="lhx-nt-head">
        <GameTopBar onExit={onExit} time={time} timeMax={ROUND_SECONDS} score={score} />
        <div className="lhx-nt-goal">
          <div className="lhx-nt-goal-lab">SPELL THE WORD</div>
          <div className="lhx-wb-clue">{listen ? '🎧 Tap what you hear, then spell it' : item.clue || 'Spell it!'}</div>
        </div>
        <div className="lhx-nt-best">{round.current.solved} spelt · combo ×{round.current.combo}</div>
      </div>

      {ttsOn() && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button type="button" className="lhx-wb-speak" onClick={() => speak(item.word)}>
            🔊 Hear the word
          </button>
        </div>
      )}

      <div className="lhx-wb-slots" aria-label={`${item.word.length} letters`}>
        {Array.from({ length: item.word.length }, (_, i) => (
          <div key={i} className={`lhx-wb-slot ${verdict === 'ok' ? 'is-ok' : verdict === 'no' ? 'is-no' : ''}`}>
            {placed[i] !== undefined ? tiles[placed[i]].letter : ''}
          </div>
        ))}
      </div>

      <div className="lhx-wb-tiles">
        {tiles.map((t, i) => (
          <button
            key={i}
            type="button"
            className={`lhx-wb-tile ${t.used ? 'is-used' : ''}`}
            aria-label={t.used ? `${t.letter}, placed` : t.letter}
            disabled={t.used}
            onClick={() => place(i)}
          >
            {t.letter}
          </button>
        ))}
      </div>

      <div style={{ textAlign: 'center' }}>
        <button type="button" className="lhx-wb-del" onClick={backspace}>⌫ Delete</button>
      </div>
    </>
  )
}

/* ── The engine ────────────────────────────────────────────────── */

export default function WordBuilderGame({ game }) {
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
            stars={starsForWordScore(outcome.score)}
            title="Word Builder done!"
            sub={`You spelt ${outcome.solved} ${outcome.solved === 1 ? 'word' : 'words'} correctly! Great spelling.`}
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
