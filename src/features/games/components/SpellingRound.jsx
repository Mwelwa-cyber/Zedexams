/**
 * One stage of spelling: hear it, build it, check it.
 *
 * The mechanic is the mock-up's and every one of its refusals is deliberate.
 * NO COUNTDOWN, no lives, no game-over, no penalty for thinking — for spelling
 * the skill being measured is accuracy, and a clock punishes exactly the
 * learners the game exists for: the slower reader, the child on a cheap phone
 * with a laggy touchscreen, anyone who stops to work it out. The pull comes
 * from the streak, the stage bar and finishing the set.
 *
 * FOUR THINGS ARE NOT WHAT THE OLD ENGINE DID, and each is a correctness fix
 * rather than a preference:
 *
 *   THE LEARNER SUBMITS. The old engine auto-checked the moment the last slot
 *   filled, so a child who put the last letter in and THEN spotted their
 *   mistake had already been marked wrong. Nothing is judged until Check.
 *
 *   AN INTERFACE TAP IS NOT A SPELLING MISTAKE. Undo, Clear and re-hearing the
 *   word touch nothing that is scored. Only Check is an answer.
 *
 *   THERE ARE DECOY LETTERS. Tiles that are exactly the word's own letters
 *   make long words solvable by elimination — the last three slots fill
 *   themselves. Decoys are drawn only from letters the word does NOT use
 *   (`decoysFor`), so the exercise is never made impossible or misleading.
 *
 *   THE CONTEXT SENTENCE IS ON SCREEN, WITH THE WORD HIDDEN. "Our ___ helped
 *   us carry the water" gives the meaning without giving the spelling, which
 *   is the whole reason the bank carries a sentence per word.
 *
 * A miss re-queues the word LATER IN THE SAME STAGE (`REQUEUE_GAP`), with no
 * scaffolding when it returns. Getting it right the second time unaided is the
 * point of the exercise; it does not restore the first-try credit, which is
 * what the stars are counted from.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { coachFor, coachOutcome } from '../lib/spellingCoachCore'
import { recordCorrect, recordMiss } from '../lib/spellingStagesCore'
import { guessFrom, tilesWithDecoys } from '../lib/wordBuilderCore'
import { fillGap } from '../lib/spellingContentCore'
import { isMuted, playCorrect, playWrong, toggleMute } from '../lib/gameSounds'
import BreakItUpCoach from './BreakItUpCoach'
import { speakWord, speechAvailable } from '../lib/spellingSpeech'

/** How many words later a missed word comes back inside the same stage. */
export const REQUEUE_GAP = 2

/** Where the learner's own attempt first differs from the answer. */
export function firstDifference(guess, answer) {
  const a = String(guess || '')
  const b = String(answer || '')
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return i
  }
  return -1
}

export default function SpellingRound({
  words = [],
  stage,
  band = null,
  chapterTitle = '',
  grade = null,
  session,
  startIndex = 0,
  initialFirstTry = 0,
  initialMissed = [],
  onPoolChange,
  onPosition,
  onExit,
  onFinish,
  onEvent,
}) {
  /**
   * The queue is `words` plus re-queued misses, so its length grows during the
   * stage. `stageSize` is the number of DISTINCT words the stage is scored
   * over and never changes — the progress bar and the star thresholds both
   * read it, and a bar that got longer every time a child made a mistake
   * would tell them they were going backwards.
   */
  const stageSize = words.length
  const queueRef = useRef(words.map((item) => ({ ...item, retry: false })))
  const [index, setIndex] = useState(startIndex)

  const [tiles, setTiles] = useState([])
  const [placed, setPlaced] = useState([])
  const [verdict, setVerdict] = useState(null)      // null | 'ok' | 'no'
  const [coach, setCoach] = useState(null)          // the coach panel, when open
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [heard, setHeard] = useState(false)
  /**
   * The mute toggle lives in THIS header for the same reason it lives in
   * `GameTopBar` (#2556): this engine mounts bare, without GamesShell, so the
   * shell's nav — which holds the only other mute control — is not on the
   * page. Without it a learner could not silence a round mid-way, and the one
   * preference governs haptics too. This round draws its own header rather
   * than GameTopBar's, so it has to carry the control itself.
   */
  const [muted, setMuted] = useState(() => isMuted())

  const firstTryRef = useRef(initialFirstTry)
  const missedRef = useRef([...initialMissed])
  const attemptedRef = useRef(new Set())
  const startedAtRef = useRef(Date.now())
  const timeouts = useRef([])
  const later = useCallback((fn, ms) => { timeouts.current.push(setTimeout(fn, ms)) }, [])
  useEffect(() => () => timeouts.current.forEach(clearTimeout), [])

  const item = queueRef.current[index] || null
  const answer = item?.word || ''
  const canSpeak = speechAvailable()

  /* ── set up each word ────────────────────────────────────────────── */
  useEffect(() => {
    if (!item) return
    setTiles(tilesWithDecoys(item.word))
    setPlaced([])
    setVerdict(null)
    setCoach(null)
    setHeard(false)
    // The word is spoken on arrival. Listening then producing is the strongest
    // form of the exercise, and the word is never on screen to copy.
    later(() => { speakWord(item.word, { audioUrl: item.audio }); setHeard(true) }, 350)
    if (onPosition) onPosition({ index, firstTryCorrect: firstTryRef.current, missedWords: [...missedRef.current] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const guess = useMemo(() => guessFrom(placed, tiles), [placed, tiles])
  const full = placed.length === answer.length && answer.length > 0

  /* ── building ────────────────────────────────────────────────────── */
  const place = (tileIndex) => {
    if (verdict === 'ok' || coach || !item) return
    if (tiles[tileIndex]?.used || placed.length >= answer.length) return
    setTiles(tiles.map((t, i) => (i === tileIndex ? { ...t, used: true } : t)))
    setPlaced([...placed, tileIndex])
    // A learner correcting themselves clears the previous verdict rather than
    // leaving a red panel above a fresh attempt.
    setVerdict(null)
  }

  const undo = () => {
    if (verdict === 'ok' || coach || !placed.length) return
    const last = placed[placed.length - 1]
    setPlaced(placed.slice(0, -1))
    setTiles(tiles.map((t, i) => (i === last ? { ...t, used: false } : t)))
    setVerdict(null)
  }

  const clearAll = () => {
    if (verdict === 'ok' || coach) return
    setPlaced([])
    setTiles(tiles.map((t) => ({ ...t, used: false })))
    setVerdict(null)
  }

  /**
   * Typing is offered as well as tapping, for a learner on a laptop.
   *
   * It is NOT the primary interaction and it does not bypass the tiles: a
   * keystroke claims the matching unused tile, so the same decoy rules and the
   * same letter counts apply, and a letter the word does not have does nothing
   * at all rather than being recorded as a mistake.
   */
  useEffect(() => {
    if (!item || coach) return undefined
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.key === 'Backspace') { event.preventDefault(); undo(); return }
      if (event.key === 'Enter' && full && verdict !== 'ok') { event.preventDefault(); submit(); return }
      if (!/^[a-zA-Z]$/.test(event.key)) return
      const letter = event.key.toUpperCase()
      const at = tiles.findIndex((t) => !t.used && t.letter === letter)
      if (at >= 0) { event.preventDefault(); place(at) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ── checking ────────────────────────────────────────────────────── */
  const advance = () => {
    if (index + 1 >= queueRef.current.length) return finish()
    setIndex(index + 1)
    return undefined
  }

  const finishedRef = useRef(false)
  const finish = () => {
    // Claimed SYNCHRONOUSLY, so however many taps land inside one React batch
    // the stage settles once. The duplicate-reward guard upstream
    // (`applyStageResult`, keyed by runId) is the second line, not the first.
    if (finishedRef.current) return undefined
    finishedRef.current = true
    onFinish({
      firstTryCorrect: firstTryRef.current,
      bestStreak: Math.max(bestStreak, streak),
      missedWords: [...new Set(missedRef.current)],
      words: words.map((w) => w.word),
      timeSpent: Math.round((Date.now() - startedAtRef.current) / 1000),
      solved: attemptedRef.current.size,
    })
    return undefined
  }

  const submit = () => {
    if (!item || !full || verdict === 'ok') return
    const right = guess === answer
    const isRetry = Boolean(item.retry)
    attemptedRef.current.add(answer)

    // One event per submitted answer, whatever the verdict — the denominator
    // for every rate the learning analytics computes. Emitted BEFORE the
    // branch so a correct and an incorrect answer cannot drift apart.
    emit('word_attempted', { retry: isRetry })

    if (right) {
      playCorrect()
      setVerdict('ok')
      setStreak((s) => { const next = s + 1; setBestStreak((b) => Math.max(b, next)); return next })
      // FIRST-TRY ONLY counts toward mastery and stars. A word spelled
      // correctly on the second pass after being shown the answer is not a
      // word the learner knows yet — it comes back in a later stage to prove
      // it, which is what `recordCorrect`'s session rule is for.
      if (!isRetry) {
        firstTryRef.current += 1
        onPoolChange((current) => recordCorrect(current, answer, { session, stage, at: Date.now() }))
        emit('word_correct_first_try')
      } else {
        emit('word_correct_retry')
      }
      later(advance, 900)
      return
    }

    playWrong()
    setVerdict('no')
    setStreak(0)
    if (!isRetry) {
      missedRef.current.push(answer)
      onPoolChange((current) => recordMiss(current, answer, { stage, at: Date.now() }))
      emit('word_missed')
      // Back later in this same stage, with no help. Placed at a fixed gap so
      // it is not the very next thing — recall after other work is the bit
      // that proves it stuck.
      const at = Math.min(index + 1 + REQUEUE_GAP, queueRef.current.length)
      queueRef.current = [
        ...queueRef.current.slice(0, at),
        { ...item, retry: true },
        ...queueRef.current.slice(at),
      ]
    }
  }

  const emit = (name, extra = {}) => {
    // The ANSWER never travels in an analytics payload. A client event stream
    // carrying the correct spelling of every word served is an answer key.
    if (onEvent) onEvent(name, { stage, band, ...extra })
  }

  /* ── after a miss: coach, or carry on ────────────────────────────── */
  const availableCoach = item ? coachFor(item.source, { grade }) : null

  const openCoach = () => {
    emit('coach_started')
    setCoach(availableCoach)
  }

  const closeCoach = (kind) => {
    coachOutcome(kind)  // the word returns later whatever happened here
    emit(kind === 'completed' ? 'coach_completed' : 'coach_skipped')
    setCoach(null)
    advance()
  }

  const skipCoaching = () => {
    emit(availableCoach ? 'coach_skipped' : 'coach_unavailable')
    advance()
  }

  if (!item) return null

  if (coach) {
    return (
      <BreakItUpCoach
        coach={coach}
        attempt={guess}
        onDone={() => closeCoach('completed')}
        onSkip={() => closeCoach('skipped')}
      />
    )
  }

  const diffAt = verdict === 'no' ? firstDifference(guess, answer) : -1
  const doneCount = Math.min(stageSize, firstTryRef.current + missedRef.current.length)

  return (
    <div className="lhx-sp-round">
      <header className="lhx-sp-round-head">
        <button type="button" className="lhx-sp-back" onClick={onExit} aria-label="Leave this stage">‹</button>
        <div className="lhx-sp-dots" role="progressbar" aria-valuemin={0} aria-valuemax={stageSize}
          aria-valuenow={doneCount} aria-label={`Word ${Math.min(stageSize, doneCount + 1)} of ${stageSize}`}>
          {Array.from({ length: stageSize }, (_, i) => (
            <span key={i} className={`lhx-sp-dot ${i < doneCount ? 'is-done' : i === doneCount ? 'is-now' : ''}`} />
          ))}
        </div>
        <button
          type="button"
          className="lhx-sp-mute"
          aria-label={muted ? 'Unmute game sounds' : 'Mute game sounds'}
          onClick={() => setMuted(toggleMute())}
        >
          <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
        </button>
        <span className="lhx-sp-streak" aria-label={`Streak ${streak}`}>🔥 {streak}</span>
      </header>

      <p className="lhx-sp-stagelab">
        {stage === 'tricky' ? 'Your tricky words' : `Stage ${stage}`}
        {chapterTitle ? ` · ${chapterTitle}` : ''}
      </p>

      <section className="lhx-sp-hero">
        <p className="lhx-sp-kicker">
          Word {Math.min(stageSize, doneCount + 1)} of {stageSize}
          {item.retry && <span className="lhx-sp-again"> · one you missed</span>}
        </p>

        {canSpeak ? (
          <button type="button" className="lhx-sp-hear" onClick={() => { speakWord(answer, { audioUrl: item.audio }); setHeard(true) }}>
            🔊 {heard ? 'Hear it again' : 'Hear it'}
          </button>
        ) : (
          // No speech on this device. The sentence is then the only clue, so
          // it is promoted rather than the learner being left with nothing —
          // never a dead button that does nothing when tapped.
          <p className="lhx-sp-nospeech">Read the sentence and spell the missing word.</p>
        )}

        {item.clue && (
          <p className="lhx-sp-sentence">
            {item.clue.split('___').map((part, i, all) => (
              <span key={i}>
                {part}
                {i < all.length - 1 && <b className="lhx-sp-gap" aria-label="the missing word">· · ·</b>}
              </span>
            ))}
          </p>
        )}
      </section>

      <div className="lhx-sp-slots" aria-label={`${answer.length} letters`}>
        {Array.from({ length: answer.length }, (_, i) => {
          const letter = placed[i] !== undefined ? tiles[placed[i]].letter : ''
          const state = verdict === 'ok' ? 'is-ok' : verdict === 'no' && letter && letter !== answer[i] ? 'is-no' : letter ? 'is-filled' : ''
          return <span key={i} className={`lhx-sp-slot ${state}`}>{letter}</span>
        })}
      </div>

      <div className="lhx-sp-tiles">
        {tiles.map((tile, i) => (
          <button
            key={i}
            type="button"
            className={`lhx-sp-tile ${tile.used ? 'is-used' : ''}`}
            disabled={tile.used || verdict === 'ok'}
            aria-label={tile.used ? `${tile.letter}, already used` : `Add the letter ${tile.letter}`}
            onClick={() => place(i)}
          >
            {tile.letter}
          </button>
        ))}
      </div>

      <div className="lhx-sp-controls">
        <button type="button" className="lhx-sp-ghost" onClick={undo} disabled={!placed.length || verdict === 'ok'}>
          ⌫ Undo
        </button>
        <button type="button" className="lhx-sp-ghost" onClick={clearAll} disabled={!placed.length || verdict === 'ok'}>
          ↺ Clear
        </button>
      </div>

      {verdict !== 'ok' && (
        <button type="button" className="lhx-sp-check" onClick={submit} disabled={!full}>
          {full ? 'Check' : `${placed.length} of ${answer.length} letters`}
        </button>
      )}

      <div className="lhx-sp-feedback" aria-live="polite">
        {verdict === 'ok' && (
          <div className="lhx-sp-fb is-ok">
            <p className="lhx-sp-fb-title">✓ {item.retry ? 'You got it this time' : 'Correct'}</p>
            <p className="lhx-sp-fb-word">{answer}</p>
            {item.clue && <p className="lhx-sp-fb-sentence">{fillGap(answer.toLowerCase(), item.clue)}</p>}
          </div>
        )}

        {verdict === 'no' && (
          <div className="lhx-sp-fb is-no">
            <p className="lhx-sp-fb-title">Not quite — look again</p>
            <p className="lhx-sp-fb-you">You built <b>{guess}</b></p>
            <p className="lhx-sp-fb-word">
              {answer.split('').map((letter, i) => (
                <span key={i} className={i === diffAt ? 'lhx-sp-fb-mark' : ''}>{letter}</span>
              ))}
            </p>
            {diffAt >= 0 && (
              <p className="lhx-sp-fb-where">
                It goes wrong at letter {diffAt + 1} — you put <b>{guess[diffAt] || 'nothing'}</b>, it is <b>{answer[diffAt]}</b>.
              </p>
            )}
            <div className="lhx-sp-fb-actions">
              {/* The coach is offered, never forced — a learner who has seen
                  the answer and understood it should not be made to sit
                  through a lesson. Both doors re-queue the word identically. */}
              {availableCoach && (
                <button type="button" className="lhx-sp-fix" onClick={openCoach}>✂️ Let&apos;s fix this</button>
              )}
              <button type="button" className="lhx-sp-ghost" onClick={skipCoaching}>
                {availableCoach ? 'Skip — I’ve got it' : 'Got it →'}
              </button>
            </div>
            <p className="lhx-sp-fb-note">This one comes back later with no help.</p>
          </div>
        )}
      </div>
    </div>
  )
}
