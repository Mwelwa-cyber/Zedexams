/**
 * WordBuilderGame — the prototype-v3 spelling sprint for
 * `type: 'word_builder'` games (learner redesign step 4, the second
 * rebuilt mechanic).
 *
 * A fixed set of `ROUND_WORDS` words under the indigo game head: the
 * clue (or, when text-to-speech is available, sometimes just "🎧 tap
 * what you hear" with the word spoken aloud), the underline slots, the
 * word's own letters shuffled into tap tiles, and ⌫ Delete. A full set
 * of slots auto-checks — correct turns them green, pays 20 × combo and
 * advances to the next word; wrong shakes red, resets the combo and
 * clears for another try, with the word staying live. The last word
 * lands on the shared win screen (140/60 star thresholds).
 *
 * There is no countdown (PROMPT 7b), and of the five engines this is
 * the one it mattered most for: spelling is accuracy, never speed, so a
 * clock here punished the slower speller the game exists to help. The
 * head's bar fills with progress through the set instead of draining,
 * and a word the learner is mid-way through building can never be cut
 * off — nothing ends the round except finishing it.
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
import { readJson, writeJson } from '../../../shared/utils/safeStorage'
import { isKnownPack, loadWordPack } from '../lib/spellingPack'
import { coachFor, tapChunk } from '../lib/spellingCoachCore'
import {
  composeStage,
  entryFor,
  recordCorrect,
  recordMiss,
  sessionsToMastery,
} from '../lib/spellingStagesCore'
import {
  ROUND_WORDS,
  playableWords,
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

const progressKey = (gameId) => `zedexams:spelling:${gameId || 'default'}`

function PlayScreen({ game, questions, onExit, onEnd, progress, onProgress }) {
  // The word queue lives in a ref — it recycles mid-render without renders.
  const queueRef = useRef([])
  // The coach shown after a miss, and the chunks rebuilt so far.
  const [coach, setCoach] = useState(null)
  const [rebuilt, setRebuilt] = useState([])
  // One session per mount. Mastery counts SESSIONS, not right answers, so
  // this id is what stops three rights in one sitting mastering a word.
  const sessionRef = useRef(`s${Date.now()}`)
  const firstTryRef = useRef(true)
  const [item, setItem] = useState(null)          // { word, clue }
  const [listen, setListen] = useState(false)
  const [tiles, setTiles] = useState([])
  const [placed, setPlaced] = useState([])
  const [verdict, setVerdict] = useState(null)    // null | 'ok' | 'no'
  const [score, setScore] = useState(0)

  const round = useRef({ combo: 1, peakCombo: 1, solved: 0, misses: 0 })
  const startedAtRef = useRef(Date.now())
  const timeouts = useRef([])
  const later = (fn, ms) => { timeouts.current.push(setTimeout(fn, ms)) }
  useEffect(() => () => timeouts.current.forEach(clearTimeout), [])

  /**
   * The stage's words: the ones due back from this device's pool first, then
   * fresh ones — and never an unmastered word arriving as a "new" one, which
   * is what would make the spacing quietly not happen. A pack that yields
   * nothing falls back to the plain shuffled queue, which is what every game
   * without a pool did before this.
   */
  const buildQueue = () => {
    const items = playableWords(questions)
    if (!items.length) return wordQueue(questions)
    const stage = composeStage({
      items,
      pool: progress.pool,
      stage: progress.stage,
      salt: game?.id || 'default',
      size: ROUND_WORDS,
    })
    return stage.words.length ? stage.words : wordQueue(questions)
  }

  const nextWord = () => {
    if (!queueRef.current.length) queueRef.current = buildQueue()
    const it = queueRef.current.shift()
    setCoach(null)
    setRebuilt([])
    firstTryRef.current = true
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
    queueRef.current = buildQueue()
    nextWord()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ending the round. `endedRef` is claimed SYNCHRONOUSLY so the last word
  // of the set can only finish the round once, however many taps land
  // inside one React batch.
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
      // Mastery is three rights in three SEPARATE sessions, and only a
      // first-try right counts: a word spelled correctly on the third attempt
      // in the same breath is not a word the learner knows.
      if (firstTryRef.current) {
        onProgress((current) => ({
          ...current,
          pool: recordCorrect(current.pool, item.word, { session: sessionRef.current, stage: current.stage }),
        }))
      }
      // The score is read here, synchronously — `setScore` above is async and
      // the end-of-round callback must not close over a stale value.
      if (round.current.solved >= ROUND_WORDS) later(() => endRound(score + gained), 650)
      else later(nextWord, 650)
    } else {
      round.current.misses += 1
      round.current.combo = 1
      playWrong()
      setVerdict('no')
      firstTryRef.current = false
      onProgress((current) => ({
        ...current,
        pool: recordMiss(current.pool, item.word, { stage: current.stage }),
      }))
      // The coach is the help AFTER a miss — it appears only for a word the
      // pack has actually broken up, never on a guessed split.
      setCoach(coachFor(item.source))
      setRebuilt([])
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
        <GameTopBar onExit={onExit} done={round.current.solved} total={ROUND_WORDS} score={score} />
        <div className="lhx-nt-goal">
          <div className="lhx-nt-goal-lab">SPELL THE WORD</div>
          <div className="lhx-wb-clue">{listen ? '🎧 Tap what you hear, then spell it' : item.clue || 'Spell it!'}</div>
        </div>
        <div className="lhx-nt-best">
          Word {Math.min(ROUND_WORDS, round.current.solved + 1)} of {ROUND_WORDS} · combo ×{round.current.combo}
        </div>
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

      <div className="lhx-wb-coach-slot" aria-live="polite">
        {coach && (
          <div className="lhx-wb-coach">
            <div className="lhx-wb-coach-head">
              <b>Break it up</b>
              <span>{coach.label}</span>
            </div>
            <p className="lhx-wb-coach-blurb">{coach.blurb}</p>
            <div className="lhx-wb-chunks">
              {coach.chunks.map((chunk, index) => (
                <button
                  key={`${chunk}-${index}`}
                  type="button"
                  className={`lhx-wb-chunk ${rebuilt.includes(index) ? 'is-placed' : ''} ${coach.trap === index ? 'is-trap' : ''}`}
                  aria-label={coach.trap === index ? `${chunk}, the tricky bit` : chunk}
                  onClick={() => {
                    // Out of order is refused, not punished: the coach is help
                    // after a miss, not a second test.
                    const next = tapChunk(rebuilt, index, coach.chunks.length)
                    if (next.accepted) setRebuilt(next.placed)
                  }}
                >
                  {chunk}
                </button>
              ))}
            </div>
            {rebuilt.length >= coach.chunks.length && (
              <p className="lhx-wb-coach-done">
                <b>{coach.word}</b> — now spell it.
              </p>
            )}
            {coach.why && <p className="lhx-wb-coach-why">{coach.why}</p>}
            {sessionsToMastery(entryFor(progress.pool, item.word)) > 0 && (
              <p className="lhx-wb-coach-mastery">
                {sessionsToMastery(entryFor(progress.pool, item.word))} more
                {sessionsToMastery(entryFor(progress.pool, item.word)) === 1 ? ' session' : ' sessions'} to master this one.
              </p>
            )}
          </div>
        )}
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
  // Spelling progress is per DEVICE: mastery counts sessions, and there is no
  // server-side per-word model to hang it on. Score, XP and badges stay the
  // server-backed truth through useGameFinish.
  const [progress, setProgress] = useState(() => ({
    stage: 0,
    pool: {},
    ...(readJson(progressKey(game?.id), null) || {}),
  }))
  const { saveResult, newBadges, streakResult, finish } = useGameFinish()

  // The word pack. A game document may name one (`wordPack: 'grade7-spelling'`)
  // instead of carrying hundreds of words itself — see lib/spellingPack.js for
  // why the bank is fetched rather than bundled. `null` means "still loading";
  // an empty result means the pack failed and the document's own questions
  // stand, so a spelling game always has something to play.
  // Starts at [] for a game with no pack, so the great majority of games
  // never render the waiting line at all — only a game that actually has a
  // pack to fetch waits for one.
  const [packQuestions, setPackQuestions] = useState(() => (isKnownPack(game?.wordPack) ? null : []))
  const packId = game?.wordPack
  useEffect(() => {
    if (!isKnownPack(packId)) { setPackQuestions([]); return undefined }
    let cancelled = false
    loadWordPack(packId)
      .then((rows) => { if (!cancelled) setPackQuestions(rows) })
      // loadWordPack swallows its own failures, but a throw in the setter
      // above would otherwise leave the round waiting for ever.
      .catch(() => { if (!cancelled) setPackQuestions([]) })
    return () => { cancelled = true }
  }, [packId])

  // The pack wins when it has words; otherwise the document's own.
  const questions = packQuestions?.length ? packQuestions : game?.questions

  const updateProgress = (fn) => {
    setProgress((current) => {
      const next = typeof fn === 'function' ? fn(current) : fn
      writeJson(progressKey(game?.id), next)
      return next
    })
  }

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
    // The stage advances on finishing, which is what the word spacing counts
    // in: a word missed at stage 4 is due back at stage 6.
    updateProgress((current) => ({ ...current, stage: (current.stage || 0) + 1 }))
    // The shared end-of-round plumbing: score save, badges, daily streak.
    finish(roundResult({ game, ...result }))
  }

  return (
    <div className="lhx">
      <div className="lhx-page">
        {/* The round waits for a NAMED pack rather than starting on the
            document's ten and switching mid-stage: the stage the learner is
            handed has to be composed from the whole bank, or the spacing that
            decides which words come back is computed against the wrong set.
            A local dynamic import resolves in milliseconds. */}
        {screen === 'play' && packQuestions === null && (
          <p className="lhx-wb-packing">Getting your words ready…</p>
        )}
        {screen === 'play' && packQuestions !== null && (
          <PlayScreen
            game={game}
            questions={questions}
            progress={progress}
            onProgress={updateProgress}
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
