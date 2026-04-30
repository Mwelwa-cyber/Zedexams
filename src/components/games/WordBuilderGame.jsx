import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowPathIcon,
  BookOpenIcon,
  CheckBadgeIcon,
  TrophyIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid'
import { shuffle } from '../../utils/gamesService'
import { playCorrect, playWrong, playWin, playTick, primeSounds } from '../../utils/gameSounds'
import { useGameFinish } from './useGameFinish'
import { SaveBanner, StreakBanner, DoneStat } from './DoneBanners'
import BadgeToast from './BadgeToast'
import ShareButton from './ShareButton'
import Confetti from './Confetti'
import Leaderboard from './Leaderboard'
import MascotCelebration from './MascotCelebration'
import MascotGreeting from './MascotGreeting'
import SmartFeedback from './SmartFeedback'
import { RatingStars } from './gamesUi'

/**
 * Engine for any `type: "word_builder"` game document.
 *
 * Content shape: `game.questions` is an array of { question, answer } where
 *   question = the clue (e.g. "🦁 King of the jungle.")
 *   answer   = the word to spell (upper or lower case — we normalise)
 *
 * Players tap letter tiles (with decoys) to fill the slots above. A wrong
 * combo is shown and the player can tap a slot to remove a letter.
 */
export default function WordBuilderGame({ game }) {
  const points = Number(game.points) || 10
  const words = useMemo(
    () => (game.questions || []).filter((q) => q.answer),
    [game.questions],
  )

  const [phase, setPhase] = useState('ready') // ready | playing | done
  const [order, setOrder] = useState([])
  const [pos, setPos] = useState(0)
  const [solvedCount, setSolvedCount] = useState(0)
  const [tiles, setTiles] = useState([])     // [{ letter, placed }]
  const [slots, setSlots] = useState([])     // tileIdx or null
  const [solvedThisWord, setSolvedThisWord] = useState(false)
  const [mistakes, setMistakes] = useState(0)
  const [confettiKey, setConfettiKey] = useState(0)
  const startRef = useRef(null)

  const { saveResult, newBadges, streakResult, finish, reset } = useGameFinish()

  const current = words[order[pos] ?? 0] || { question: '', answer: '' }
  const target = String(current.answer || '').toUpperCase()

  // Load letters whenever the word index changes
  useEffect(() => {
    if (phase !== 'playing' || !target) return
    setTiles(makeTiles(target))
    setSlots(Array(target.length).fill(null))
    setSolvedThisWord(false)
  }, [phase, order, pos, target])

  function start() {
    primeSounds()
    reset()
    setPhase('playing')
    const idxOrder = shuffle(words.map((_, i) => i), Date.now())
    setOrder(idxOrder)
    setPos(0)
    setSolvedCount(0)
    setMistakes(0)
    startRef.current = Date.now()
  }

  function placeTile(tileIdx) {
    if (solvedThisWord || tiles[tileIdx]?.placed) return
    const emptySlot = slots.findIndex((v) => v === null)
    if (emptySlot === -1) return
    playTick()
    const nextSlots = slots.slice()
    nextSlots[emptySlot] = tileIdx
    setSlots(nextSlots)
    const nextTiles = tiles.slice()
    nextTiles[tileIdx] = { ...nextTiles[tileIdx], placed: true }
    setTiles(nextTiles)

    if (nextSlots.every((v) => v !== null)) {
      const guess = nextSlots.map((idx) => nextTiles[idx].letter).join('')
      if (guess === target) {
        playCorrect()
        setSolvedThisWord(true)
        setSolvedCount((c) => c + 1)
      } else {
        playWrong()
        setMistakes((m) => m + 1)
      }
    }
  }

  function removeFromSlot(slotIdx) {
    if (solvedThisWord || slots[slotIdx] === null) return
    playTick()
    const tileIdx = slots[slotIdx]
    const nextSlots = slots.slice()
    nextSlots[slotIdx] = null
    setSlots(nextSlots)
    const nextTiles = tiles.slice()
    nextTiles[tileIdx] = { ...nextTiles[tileIdx], placed: false }
    setTiles(nextTiles)
  }

  function clearAll() {
    if (solvedThisWord) return
    setSlots(Array(target.length).fill(null))
    setTiles(tiles.map((t) => ({ ...t, placed: false })))
  }

  async function nextWord() {
    if (pos + 1 >= order.length) {
      await endRound()
    } else {
      setPos(pos + 1)
    }
  }

  async function endRound() {
    playWin()
    setConfettiKey((k) => k + 1)
    setPhase('done')
    const totalWords = order.length
    const accuracy = Math.round((solvedCount / Math.max(totalWords, 1)) * 100)
    const bonusBestStreak = solvedCount // approximation — solved all in a row
    const score = solvedCount * points + Math.max(0, solvedCount * points - mistakes * 2)
    const timeSpent = startRef.current ? Math.round((Date.now() - startRef.current) / 1000) : 0

    await finish({
      game,
      score,
      correct: solvedCount,
      wrong: totalWords - solvedCount,
      accuracy,
      bestStreak: bonusBestStreak,
      timeSpent,
    })
  }

  if (phase === 'ready') return <ReadyCard game={game} wordCount={words.length} onStart={start} />
  if (phase === 'done') {
    const totalWords = order.length
    const accuracy = Math.round((solvedCount / Math.max(totalWords, 1)) * 100)
    const score = solvedCount * points + Math.max(0, solvedCount * points - mistakes * 2)
    return (
      <>
        <Confetti fire={confettiKey} />
        <DoneCard
          game={game}
          score={score}
          solved={solvedCount}
          total={totalWords}
          accuracy={accuracy}
          mistakes={mistakes}
          saveResult={saveResult}
          newBadges={newBadges}
          streakResult={streakResult}
          onRestart={start}
        />
      </>
    )
  }

  // Playing
  const allFilled = slots.every((v) => v !== null)
  const isWrong = allFilled && !solvedThisWord

  return (
    <div className="space-y-5">
      <div className="zx-card-dark flex items-center justify-between rounded-[22px] px-4 py-3">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-amber-300">
          Word {pos + 1} of {order.length}
        </span>
        <span className="text-sm font-black text-white">
          Solved: <span className="text-amber-300">{solvedCount}</span>
        </span>
      </div>

      <div className="zx-card rounded-[22px] bg-white p-6 sm:p-8">
        <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-[14px] border-2 border-slate-900 bg-blue-100 text-slate-900">
          <BookOpenIcon className="h-6 w-6" />
        </span>
        <p className="text-center text-slate-700 font-bold mb-6">
          {stripLeadingEmoji(current.question)}
        </p>

        <div className="flex flex-wrap justify-center gap-2 mb-6">
          {slots.map((tileIdx, i) => {
            const letter = tileIdx !== null ? tiles[tileIdx].letter : ''
            const base = 'w-12 h-14 sm:w-14 sm:h-16 rounded-[12px] border-2 border-slate-900 font-black text-2xl sm:text-3xl flex items-center justify-center transition'
            const tone = solvedThisWord
              ? 'bg-emerald-100 text-emerald-900'
              : isWrong
              ? 'bg-rose-100 text-rose-900'
              : letter
              ? 'bg-blue-100 text-slate-900'
              : 'bg-slate-50 border-dashed text-slate-400'
            return (
              <button
                key={i}
                type="button"
                onClick={() => removeFromSlot(i)}
                className={`${base} ${tone}`}
              >
                {letter || '_'}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {tiles.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={() => placeTile(i)}
              disabled={t.placed || solvedThisWord}
              className={`zx-card w-12 h-12 sm:w-14 sm:h-14 rounded-[12px] font-black text-xl sm:text-2xl transition active:translate-y-[2px] active:shadow-none ${
                t.placed
                  ? 'bg-slate-100 text-slate-300 opacity-60'
                  : 'bg-white text-slate-900'
              }`}
            >
              {t.letter}
            </button>
          ))}
        </div>

        {solvedThisWord && (
          <div className="zx-card mt-6 rounded-[14px] p-4 bg-emerald-100 text-emerald-900 font-bold text-center">
            <span className="inline-flex items-center gap-2">
              <CheckBadgeIcon className="h-5 w-5" />
              Great! That spells <b>{target}</b>.
            </span>
          </div>
        )}
        {isWrong && (
          <div className="zx-card mt-6 rounded-[14px] p-4 bg-rose-100 text-rose-900 font-bold text-center">
            <span className="inline-flex items-center gap-2">
              <XCircleIcon className="h-5 w-5" />
              Not quite. Tap a letter above to take it back and try again.
            </span>
          </div>
        )}
      </div>

      <div className="flex justify-between gap-3">
        <button
          type="button"
          onClick={clearAll}
          disabled={solvedThisWord}
          className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-3.5 py-2.5 text-sm"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={nextWord}
          disabled={!solvedThisWord && !isWrong}
          className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-4 py-2.5 text-sm"
        >
          {pos + 1 >= order.length ? 'Finish round' : 'Next word'}
        </button>
      </div>
    </div>
  )
}

function ReadyCard({ game, wordCount, onStart }) {
  return (
    <div className="zx-card rounded-[22px] bg-white p-8 sm:p-10 text-center">
      <MascotGreeting game={game} intro={`Ready for ${game.title}?`} />
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-blue-100 text-slate-900">
        <BookOpenIcon className="h-8 w-8" />
      </span>
      <h2 className="font-display text-3xl font-bold mb-2 mt-4 text-slate-900">{game.title}</h2>
      <p className="text-slate-700 max-w-md mx-auto mb-6">{game.description}</p>
      <ul className="text-sm text-slate-700 max-w-sm mx-auto text-left mb-7 space-y-1.5">
        <li>{wordCount} words to spell</li>
        <li>+{game.points || 10} points per solved word</li>
        <li>Small penalties apply for wrong attempts</li>
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-5 py-3 text-base"
      >
        <BookOpenIcon className="h-4 w-4" />
        Start spelling
      </button>
    </div>
  )
}

function DoneCard({ game, score, solved, total, accuracy, mistakes, saveResult, newBadges, streakResult, onRestart }) {
  return (
    <div className="space-y-5">
      {streakResult?.isDaily && <StreakBanner result={streakResult} />}
      {newBadges?.length > 0 && <BadgeToast badges={newBadges} />}

      <div className="zx-card rounded-[22px] bg-white p-8 text-center">
        <MascotCelebration game={game} accuracy={accuracy} score={score} />
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border-2 border-slate-900 bg-slate-900 text-white">
          <TrophyIcon className="h-8 w-8 text-amber-300" />
        </span>
        <h2 className="font-display text-3xl font-bold mb-1 mt-4 text-slate-900">{score} pts</h2>
        <div className="my-4 flex justify-center">
          <RatingStars filled={accuracy >= 90 ? 5 : accuracy >= 70 ? 4 : accuracy >= 50 ? 3 : 2} />
        </div>
        <div className="grid grid-cols-3 gap-3 max-w-md mx-auto my-5">
          <DoneStat label="Solved"    value={`${solved}/${total}`} tone="emerald" />
          <DoneStat label="Accuracy"  value={`${accuracy}%`} tone="sky" />
          <DoneStat label="Mistakes"  value={mistakes} tone="rose" />
        </div>
        <SaveBanner saveResult={saveResult} />
        <SmartFeedback
          game={game}
          result={{ score, accuracy, correct: solved, wrong: total - solved, bestStreak: solved }}
          saveResult={saveResult}
        />
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <button
            type="button"
            onClick={onRestart}
            className="zx-sticker-btn zx-sticker-btn-primary rounded-[14px] px-4 py-2.5 text-sm"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Play again
          </button>
          <ShareButton game={game} score={score} accuracy={accuracy} bestStreak={solved} />
          <Link
            to={`/games/g/${game.grade}/${game.subject}`}
            className="zx-sticker-btn zx-sticker-btn-secondary rounded-[14px] px-4 py-2.5 text-sm"
          >
            More games
          </Link>
        </div>
      </div>

      <Leaderboard gameId={game.id} />
    </div>
  )
}

/* ── helpers ─────────────────────────────────────────────────── */

function makeTiles(word) {
  const letters = Array.from(word)
  // Add a few decoys when the word is short
  const decoyPool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => !word.includes(l))
  const decoyCount = word.length <= 4 ? 2 : word.length <= 6 ? 1 : 0
  for (let i = 0; i < decoyCount; i++) {
    const idx = Math.floor(Math.random() * decoyPool.length)
    letters.push(decoyPool.splice(idx, 1)[0])
  }
  // shuffle
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[letters[i], letters[j]] = [letters[j], letters[i]]
  }
  return letters.map((letter) => ({ letter, placed: false }))
}

function stripLeadingEmoji(s) {
  if (!s) return ''
  return String(s).replace(/^\s*\p{Extended_Pictographic}+\s*/u, '').trim()
}
